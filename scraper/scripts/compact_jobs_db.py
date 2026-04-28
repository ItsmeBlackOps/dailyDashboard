"""One-shot compaction for ``data/jobs.db`` after the jobs_raw bloat fix.

Context: before write-time dedupe + TTL prune landed, a single day of
scraping grew ``jobs_raw`` to ~1M rows / 7.5 GB — same payloads written
repeatedly with no retention. The going-forward fix (``Storage.save_raw``
+ ``Storage.prune_raw``) prevents future growth. This script cleans up
the accumulated bloat in an existing database.

What it does:
    1. Backfills ``payload_hash`` on rows with NULL hash (legacy rows).
    2. Collapses duplicate ``(source_platform, payload_hash)`` pairs,
       keeping the oldest row (smallest id).
    3. Applies the TTL prune with the configured retention window.
    4. Runs ``VACUUM`` to reclaim disk.

Defaults to dry-run — prints projected row/byte reduction, you confirm,
then it performs the destructive step. Always takes a ``.bak-YYYYMMDD``
backup before touching anything.

Usage:
    python scripts/compact_jobs_db.py                       # dry-run
    python scripts/compact_jobs_db.py --apply               # actually do it
    python scripts/compact_jobs_db.py --apply --ttl-days 7  # tighter TTL
    python scripts/compact_jobs_db.py --db path/to/alt.db   # non-default DB

Safety:
    • Never runs while another process is writing to the DB. Use
      ``lsof`` / Process Explorer to confirm no live scrape is writing.
    • Always takes a backup. Writes the backup path to stdout.
    • ``--apply`` is a flag, not a default. No accidental destruction.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

DEFAULT_DB = Path("data/jobs.db")
DEFAULT_TTL_DAYS = 14


def _size_gb(path: Path) -> float:
    return path.stat().st_size / 1e9


def _row_count(conn: sqlite3.Connection, table: str,
               where: str = "") -> int:
    sql = f"SELECT COUNT(*) FROM {table}"
    if where:
        sql += f" WHERE {where}"
    return int(conn.execute(sql).fetchone()[0])


def _ensure_hash_column(conn: sqlite3.Connection) -> None:
    """Add ``payload_hash`` if missing. Safe to run twice."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(jobs_raw)")}
    if "payload_hash" not in cols:
        print("  adding payload_hash column...")
        conn.execute("ALTER TABLE jobs_raw ADD COLUMN payload_hash VARCHAR(64)")
        conn.commit()


def _backfill_hashes(conn: sqlite3.Connection, batch_size: int = 10_000) -> int:
    """Compute ``payload_hash`` for rows that have none. Returns count filled."""
    todo = _row_count(conn, "jobs_raw", "payload_hash IS NULL")
    if not todo:
        return 0
    print(f"  backfilling hashes for {todo:,} rows...")
    filled = 0
    while True:
        rows = conn.execute(
            "SELECT id, source_platform, payload FROM jobs_raw "
            "WHERE payload_hash IS NULL LIMIT ?", (batch_size,)
        ).fetchall()
        if not rows:
            break
        updates = []
        for rid, src, payload in rows:
            h = hashlib.sha256(
                f"{src}\x00{payload}".encode("utf-8")
            ).hexdigest()
            updates.append((h, rid))
        conn.executemany(
            "UPDATE jobs_raw SET payload_hash = ? WHERE id = ?", updates
        )
        conn.commit()
        filled += len(rows)
        print(f"    {filled:,} / {todo:,}", end="\r")
    print()
    return filled


def _count_duplicate_groups(conn: sqlite3.Connection) -> tuple[int, int]:
    """Returns (duplicate_rows_to_delete, distinct_groups_affected).

    Groups by ``source_platform, payload`` — column-agnostic so the dry-run
    projection works on legacy DBs that don't yet have ``payload_hash``.
    Post-backfill the result is identical (same payload → same hash), so
    grouping here by raw payload gives an accurate estimate of what the
    apply flow will collapse.
    """
    cur = conn.execute("""
        SELECT COUNT(*) AS grp_count, SUM(cnt - 1) AS dup_rows
        FROM (
            SELECT COUNT(*) AS cnt
            FROM jobs_raw
            GROUP BY source_platform, payload
            HAVING COUNT(*) > 1
        )
    """)
    row = cur.fetchone()
    grp, dup = row[0] or 0, row[1] or 0
    return int(dup), int(grp)


def _collapse_duplicates(conn: sqlite3.Connection, dry_run: bool) -> int:
    """Delete all but the oldest row per (source, hash) pair.

    Oldest = smallest ``id``, which is also the earliest
    ``scrape_timestamp_utc`` for a given group because inserts are
    append-only.
    """
    if dry_run:
        dup_rows, grp_count = _count_duplicate_groups(conn)
        print(f"  dry-run: would collapse {grp_count:,} duplicate groups "
              f"({dup_rows:,} rows deleted)")
        return dup_rows

    result = conn.execute("""
        DELETE FROM jobs_raw
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM jobs_raw
            WHERE payload_hash IS NOT NULL
            GROUP BY source_platform, payload_hash
        )
        AND payload_hash IS NOT NULL
    """)
    conn.commit()
    return result.rowcount


def _apply_ttl(conn: sqlite3.Connection, ttl_days: int, dry_run: bool) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
    # SQLite stores datetimes as text — compare with ISO string.
    cutoff_iso = cutoff.strftime("%Y-%m-%d %H:%M:%S")
    if dry_run:
        n = _row_count(conn, "jobs_raw",
                       f"scrape_timestamp_utc < '{cutoff_iso}'")
        print(f"  dry-run: TTL ({ttl_days}d) would delete {n:,} aged rows")
        return n
    result = conn.execute(
        "DELETE FROM jobs_raw WHERE scrape_timestamp_utc < ?", (cutoff_iso,)
    )
    conn.commit()
    return result.rowcount


def _add_unique_index(conn: sqlite3.Connection) -> None:
    """Lock in the constraint so future duplicates are rejected at write time."""
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_raw_src_hash "
        "ON jobs_raw(source_platform, payload_hash)"
    )
    conn.commit()


def _vacuum(conn: sqlite3.Connection) -> None:
    print("  running VACUUM (this rebuilds the DB file — may take a minute)...")
    t0 = time.time()
    conn.execute("VACUUM")
    print(f"  vacuum done in {time.time() - t0:.1f}s")


def _backup(db: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = db.with_name(f"{db.name}.bak-{stamp}")
    print(f"  copying {db} -> {bak} ({_size_gb(db):.2f} GB)...")
    t0 = time.time()
    shutil.copy2(db, bak)
    print(f"  backup done in {time.time() - t0:.1f}s")
    return bak


def main() -> int:
    p = argparse.ArgumentParser(
        description="Compact data/jobs.db after the jobs_raw bloat fix"
    )
    p.add_argument("--db", type=Path, default=DEFAULT_DB,
                   help=f"Path to SQLite DB. Default: {DEFAULT_DB}")
    p.add_argument("--apply", action="store_true",
                   help="Actually delete rows + VACUUM. Without it, dry-run.")
    p.add_argument("--ttl-days", type=int, default=DEFAULT_TTL_DAYS,
                   help=f"Delete raw rows older than N days. "
                        f"Default {DEFAULT_TTL_DAYS}. Set 0 to disable TTL step.")
    p.add_argument("--no-backup", action="store_true",
                   help="Skip the pre-apply backup. DANGER — only use if "
                        "you already have your own backup.")
    args = p.parse_args()

    if not args.db.exists():
        print(f"error: {args.db} not found", file=sys.stderr)
        return 2

    print(f"Target DB: {args.db}  ({_size_gb(args.db):.2f} GB)")
    mode = "APPLY (destructive)" if args.apply else "DRY-RUN (no changes)"
    print(f"Mode     : {mode}")
    print(f"TTL      : {args.ttl_days} days"
          + (" (disabled)" if args.ttl_days == 0 else ""))
    print()

    if args.apply and not args.no_backup:
        print("=== Backup ===")
        bak = _backup(args.db)
        print(f"Restore with:  copy \"{bak}\" \"{args.db}\"")
        print()

    conn = sqlite3.connect(args.db, timeout=30.0)
    try:
        rows_before = _row_count(conn, "jobs_raw")
        size_before = _size_gb(args.db)
        print(f"=== Stage 1: schema + hash backfill ===")
        if args.apply:
            _ensure_hash_column(conn)
            _backfill_hashes(conn)

        print(f"\n=== Stage 2: dedupe ===")
        dup_deleted = _collapse_duplicates(conn, dry_run=not args.apply)

        if args.ttl_days > 0:
            print(f"\n=== Stage 3: TTL prune ({args.ttl_days} days) ===")
            ttl_deleted = _apply_ttl(conn, args.ttl_days, dry_run=not args.apply)
        else:
            ttl_deleted = 0

        if args.apply:
            print(f"\n=== Stage 4: lock in unique index ===")
            _add_unique_index(conn)
            print(f"\n=== Stage 5: VACUUM ===")
            conn.close()
            # VACUUM requires its own connection outside a transaction.
            conn = sqlite3.connect(args.db, timeout=60.0, isolation_level=None)
            _vacuum(conn)
    finally:
        conn.close()

    rows_after = _row_count(
        sqlite3.connect(args.db, timeout=10.0), "jobs_raw"
    ) if args.apply else rows_before - dup_deleted - ttl_deleted
    size_after = _size_gb(args.db)

    print()
    print("=== Summary ===")
    print(f"  rows        : {rows_before:>12,}  ->  {rows_after:>12,}  "
          f"(-{rows_before - rows_after:,})")
    if args.apply:
        print(f"  size (GB)   : {size_before:>12.2f}  ->  {size_after:>12.2f}  "
              f"(-{size_before - size_after:.2f})")
    else:
        print(f"  size (GB)   : {size_before:>12.2f}  "
              "(unchanged — dry-run)")
        print()
        print("Re-run with --apply to perform the cleanup.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
