"""One-shot backfill: fix Oracle RC ``company_name`` rows clobbered by the
numeric-tenant-suffix bug (see E.6 in ``docs/DISCOVERY_SYSTEM.md``).

Before the fix, Oracle Fusion Candidate Experience site slugs of the form
``cx_1001`` / ``cx1001`` / ``CX_1`` passed the exact-equality generic-codes
check and ``_prettify`` emitted ``"Cx 1001"`` (etc.) as the employer.
~29 % of today's fresh Oracle RC postings landed with a garbage company.

This script:

1. Reads every row in ``jobs_clean`` with ``source_platform='oracle_rc'``
   and ``company_name LIKE 'Cx %'``.
2. Reconstructs the ``(host, region, site)`` triple from ``source_url``.
3. Re-derives ``company_name`` via the fixed
   ``src.sources.oracle_rc._derive_company_name``.
4. Prints a before/after diff.
5. Prompts for confirmation, then issues the UPDATEs in a single
   transaction.

Safe to run alongside a live scrape (WAL mode assumed — the backfill
UPDATE takes a brief exclusive lock per row, releases between rows).
If the scraper is mid-commit you may see a transient ``database is
locked`` error; rerun.

Usage::

    python -m scripts.backfill_oracle_company_name
    python -m scripts.backfill_oracle_company_name --db data/jobs.db
    python -m scripts.backfill_oracle_company_name --dry-run
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

# Reuse the fixed helper so backfill and live parser agree by construction.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.sources.oracle_rc import _derive_company_name  # noqa: E402

# ``source_url`` shape:
#   https://{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/
#       {lang}/sites/{site}/job/{req_id}
_URL_RE = re.compile(
    r"^https?://(?P<host>[^.]+)\.fa\.(?P<region>[^.]+)\.oraclecloud\.com"
    r"/hcmUI/CandidateExperience/[^/]+/sites/(?P<site>[^/]+)/",
    re.IGNORECASE,
)


def _parse_triple(url: str) -> tuple[str, str, str] | None:
    if not url:
        return None
    m = _URL_RE.match(url.strip())
    if not m:
        return None
    return m.group("host"), m.group("region"), m.group("site")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--db", default="data/jobs.db",
        help="Path to jobs.db (default: data/jobs.db)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print the diff but never write, even on confirmation.",
    )
    parser.add_argument(
        "--yes", action="store_true",
        help="Skip interactive confirmation (for cron / scripting).",
    )
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"error: {db_path} does not exist", file=sys.stderr)
        return 2

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.execute(
        "SELECT id, company_name, source_url "
        "FROM jobs_clean "
        "WHERE source_platform = 'oracle_rc' "
        "  AND company_name LIKE 'Cx %'"
    )
    rows = cur.fetchall()

    if not rows:
        print("No rows matched — nothing to backfill.")
        conn.close()
        return 0

    plan: list[tuple[int, str, str]] = []  # (id, before, after)
    unparseable: list[tuple[int, str, str]] = []  # (id, company, url)

    for row in rows:
        triple = _parse_triple(row["source_url"] or "")
        if not triple:
            unparseable.append((row["id"], row["company_name"], row["source_url"] or ""))
            continue
        host, _region, site = triple
        new_name = _derive_company_name(host, site)
        if not new_name or new_name == row["company_name"]:
            # No improvement — skip.
            continue
        plan.append((row["id"], row["company_name"], new_name))

    print(f"Matched rows: {len(rows)}")
    print(f"  Will update: {len(plan)}")
    print(f"  Unparseable source_url: {len(unparseable)}")
    print(f"  Unchanged (derivation matches stored value): "
          f"{len(rows) - len(plan) - len(unparseable)}")
    print()

    if plan:
        print("Before → After (preview, up to 20):")
        for rid, before, after in plan[:20]:
            print(f"  id={rid:<7} {before!r:<20} → {after!r}")
        if len(plan) > 20:
            print(f"  … and {len(plan) - 20} more")
        print()

    if unparseable:
        print("Unparseable source_urls (first 5 — left untouched):")
        for rid, company, url in unparseable[:5]:
            print(f"  id={rid:<7} company={company!r}  url={url!r}")
        print()

    if not plan:
        print("Nothing to update.")
        conn.close()
        return 0

    if args.dry_run:
        print("--dry-run: no writes issued.")
        conn.close()
        return 0

    if not args.yes:
        resp = input(f"Apply {len(plan)} UPDATE(s) to {db_path}? [y/N] ").strip().lower()
        if resp not in ("y", "yes"):
            print("Aborted — no writes issued.")
            conn.close()
            return 1

    try:
        with conn:
            conn.executemany(
                "UPDATE jobs_clean SET company_name = ? WHERE id = ?",
                [(after, rid) for rid, _before, after in plan],
            )
    except sqlite3.OperationalError as exc:
        # Live scrape likely holds the write lock — surface a hint.
        print(f"error: {exc}", file=sys.stderr)
        print(
            "hint: scraper may be mid-commit; wait for the run to finish "
            "and retry.",
            file=sys.stderr,
        )
        conn.close()
        return 3

    print(f"Updated {len(plan)} row(s).")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
