"""Persistence layer. SQLAlchemy Core — SQLite default, Postgres-compatible.

Schema supports repost / duplicate classification:

    jobs_clean     — one row per (canonical_key). Tracks first_seen_at,
                     last_seen_at, removed_at, reappeared_at, times_seen, and
                     the current classification bucket.
    jobs_history   — append-only audit log of every observation (NEW / REPOST
                     / UPDATED / DUPLICATE / CROSS_DUP / UNCERTAIN / SEEN).
                     One row per ingest event — lets you answer "when did we
                     first see this role, when did it disappear, when did it
                     come back".
    jobs_raw       — untouched raw payload per fetch, for forensics.
    scrape_runs    — per-run summary.

Idempotent: `metadata.create_all` handles fresh installs; an `_apply_migrations`
helper adds missing columns on existing SQLite databases so upgrades don't
require dropping data.
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, Optional

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    insert,
    inspect,
    select,
    text,
    update,
    func,
)

from config import settings
from src.classifier import Classification, ClassifierResult, ExistingRecord, classify
from src.logging_config import get_logger
from src.models import JobPosting

log = get_logger(__name__)

metadata = MetaData()

jobs_raw = Table(
    "jobs_raw",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("source_platform", String(64), nullable=False, index=True),
    Column("payload", Text, nullable=False),
    # SHA-256 of "{source}\x00{payload_json}". Used for write-time
    # dedupe: identical payloads from the same source land at most
    # once. Scoped per source so two ATSs that happen to emit the
    # same JSON stay separate (provenance preserved).
    Column("payload_hash", String(64), nullable=True, index=True),
    Column("scrape_timestamp_utc", DateTime, nullable=False, index=True),
    UniqueConstraint("source_platform", "payload_hash",
                     name="uq_jobs_raw_src_hash"),
)

jobs_clean = Table(
    "jobs_clean",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("canonical_key", String(64), nullable=False),
    Column("soft_key", String(64), index=True),
    Column("content_hash", String(64), index=True),
    Column("requisition_key", String(64), index=True),
    Column("job_title", String(512), nullable=False),
    Column("company_name", String(256), nullable=False, index=True),
    Column("company_norm", String(256), index=True),
    Column("location", String(256)),
    Column("location_norm", String(256)),
    Column("country", String(8)),
    Column("remote_type", String(16)),
    Column("employment_type", String(64)),
    Column("seniority", String(32)),
    Column("salary", String(128)),
    Column("department", String(128)),
    Column("experience_min_years", Integer),
    Column("experience_max_years", Integer),
    Column("experience_level", String(32)),
    Column("date_posted_raw", String(128)),
    Column("date_posted_normalized", DateTime, index=True),
    Column("date_updated_raw", String(128)),
    Column("date_updated_normalized", DateTime),
    Column("source_platform", String(64), nullable=False, index=True),
    Column("source_url", Text, nullable=False),
    Column("canonical_url", Text),
    Column("apply_url", Text),
    Column("company_careers_url", Text),
    Column("source_job_id", String(256)),
    Column("requisition_id", String(256)),
    Column("job_description_snippet", Text),
    Column("full_job_description", Text),
    Column("scrape_timestamp_utc", DateTime, nullable=False, index=True),
    # Repost-detection bookkeeping.
    Column("first_seen_at", DateTime, nullable=False, index=True),
    Column("last_seen_at", DateTime, nullable=False, index=True),
    Column("removed_at", DateTime),
    Column("reappeared_at", DateTime),
    Column("times_seen", Integer, default=1, nullable=False),
    Column("classification", String(16), default="new", nullable=False, index=True),
    UniqueConstraint("canonical_key", name="uq_jobs_clean_canonical"),
)

jobs_history = Table(
    "jobs_history",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("job_id", Integer, index=True),  # FK to jobs_clean.id (nullable if UNCERTAIN)
    Column("canonical_key", String(64), index=True),
    Column("event", String(16), nullable=False, index=True),
    Column("source_platform", String(64), nullable=False, index=True),
    Column("source_job_id", String(256)),
    Column("reason", Text),
    Column("event_at", DateTime, nullable=False, index=True),
)

scrape_runs = Table(
    "scrape_runs",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("started_at_utc", DateTime, nullable=False),
    Column("finished_at_utc", DateTime),
    Column("total_fetched", Integer, default=0),
    Column("total_unique", Integer, default=0),
    Column("total_exported", Integer, default=0),
    Column("per_source", JSON),
    Column("failed_sources", JSON),
    Column("duplicates_removed", Integer, default=0),
    Column("discarded_stale", Integer, default=0),
    Column("classification_counts", JSON),
    Column("notes", Text),
)


# ----------------------- light forward migrations -----------------------
_NEW_COLUMNS_CLEAN = (
    ("soft_key", "VARCHAR(64)"),
    ("content_hash", "VARCHAR(64)"),
    ("requisition_key", "VARCHAR(64)"),
    ("company_norm", "VARCHAR(256)"),
    ("location_norm", "VARCHAR(256)"),
    ("department", "VARCHAR(128)"),
    ("experience_min_years", "INTEGER"),
    ("experience_max_years", "INTEGER"),
    ("experience_level", "VARCHAR(32)"),
    ("date_updated_raw", "VARCHAR(128)"),
    ("date_updated_normalized", "DATETIME"),
    ("canonical_url", "TEXT"),
    ("apply_url", "TEXT"),
    ("requisition_id", "VARCHAR(256)"),
    ("first_seen_at", "DATETIME"),
    ("last_seen_at", "DATETIME"),
    ("removed_at", "DATETIME"),
    ("reappeared_at", "DATETIME"),
    ("times_seen", "INTEGER DEFAULT 1"),
    ("classification", "VARCHAR(16) DEFAULT 'new'"),
)

_NEW_COLUMNS_RUNS = (
    ("classification_counts", "JSON"),
)

_NEW_COLUMNS_RAW = (
    # Added retroactively for write-time dedupe. Nullable on purpose —
    # pre-existing rows have NULL hash until the compaction script
    # backfills them, and the UNIQUE(source, hash) constraint treats
    # NULLs as distinct, so legacy rows don't collide with each other.
    ("payload_hash", "VARCHAR(64)"),
)


def _apply_migrations(engine) -> None:
    """Add new columns to pre-existing tables. SQLite-friendly ALTER TABLE ADD."""
    insp = inspect(engine)
    if "jobs_clean" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("jobs_clean")}
        for col, ddl in _NEW_COLUMNS_CLEAN:
            if col not in existing:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE jobs_clean ADD COLUMN {col} {ddl}"))
    if "scrape_runs" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("scrape_runs")}
        for col, ddl in _NEW_COLUMNS_RUNS:
            if col not in existing:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE scrape_runs ADD COLUMN {col} {ddl}"))
    if "jobs_raw" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("jobs_raw")}
        for col, ddl in _NEW_COLUMNS_RAW:
            if col not in existing:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE jobs_raw ADD COLUMN {col} {ddl}"))
        # SQLite doesn't let us add a UNIQUE CONSTRAINT after the fact
        # via ALTER TABLE, but a UNIQUE INDEX does the job. Postgres
        # also accepts this form. ``IF NOT EXISTS`` makes it idempotent.
        with engine.begin() as conn:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_raw_src_hash "
                "ON jobs_raw(source_platform, payload_hash)"
            ))


_SQLITE_FALLBACK = f"sqlite:///{__import__('config').DATA_DIR / 'jobs.db'}"


class Storage:
    def __init__(self, url: Optional[str] = None) -> None:
        resolved = url or settings.database_url
        try:
            engine = create_engine(resolved, future=True)
            with engine.connect():
                pass
        except Exception:
            import logging as _log
            _log.getLogger(__name__).warning(
                "Cannot connect to %s — falling back to SQLite", resolved.split("@")[-1]
            )
            engine = create_engine(_SQLITE_FALLBACK, future=True)
        self.engine = engine
        metadata.create_all(self.engine)
        _apply_migrations(self.engine)

    # ---------- raw ----------
    def save_raw(self, source: str, records: Iterable[dict]) -> int:
        """Persist raw payloads with per-source content-hash dedupe.

        Returns the number of rows actually written (which may be less
        than ``len(records)`` if duplicates were skipped). Before this
        dedupe landed, a single day of scraping grew ``jobs_raw`` to
        ~1M rows / 7.5 GB — the same payload was re-stored on every
        run. Now identical payloads for the same source write once, and
        the caller can log the dedupe rate via the return value.
        """
        import hashlib

        now = datetime.now(timezone.utc)
        # Build (hash, row) tuples; collapse intra-batch duplicates up front.
        seen_in_batch: set[str] = set()
        candidates: list[dict] = []
        for r in records:
            payload_json = json.dumps(r, default=str, ensure_ascii=False)
            h = hashlib.sha256(
                f"{source}\x00{payload_json}".encode("utf-8")
            ).hexdigest()
            if h in seen_in_batch:
                continue
            seen_in_batch.add(h)
            candidates.append({
                "source_platform": source,
                "payload": payload_json,
                "payload_hash": h,
                "scrape_timestamp_utc": now,
            })

        if not candidates:
            return 0

        # Filter against rows already in the DB for this source.
        from sqlalchemy import select as _select
        hashes = [c["payload_hash"] for c in candidates]
        with self.engine.begin() as conn:
            existing_rows = conn.execute(
                _select(jobs_raw.c.payload_hash)
                .where(jobs_raw.c.source_platform == source)
                .where(jobs_raw.c.payload_hash.in_(hashes))
            ).all()
            existing = {r[0] for r in existing_rows}
            to_insert = [c for c in candidates if c["payload_hash"] not in existing]
            if not to_insert:
                return 0
            conn.execute(insert(jobs_raw), to_insert)
        return len(to_insert)

    def prune_raw(self, *, ttl_days: int) -> int:
        """Delete raw rows whose ``scrape_timestamp_utc`` is strictly
        older than ``now - ttl_days``.

        Returns the number of rows deleted. Idempotent: calling twice
        in a row returns 0 the second time (nothing left to prune).
        Scoped to ``jobs_raw`` only — never touches ``jobs_clean``.
        """
        from sqlalchemy import delete as _delete
        cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
        with self.engine.begin() as conn:
            result = conn.execute(
                _delete(jobs_raw).where(jobs_raw.c.scrape_timestamp_utc < cutoff)
            )
            return int(result.rowcount or 0)

    # ---------- classifier lookups (callables passed to classify()) ----------
    def _lookup_by_canonical(self, conn, key: str) -> Optional[ExistingRecord]:
        row = conn.execute(
            select(jobs_clean).where(jobs_clean.c.canonical_key == key).limit(1)
        ).mappings().first()
        return _to_existing(row) if row else None

    def _lookup_by_requisition(self, conn, key: str) -> Optional[ExistingRecord]:
        row = conn.execute(
            select(jobs_clean).where(jobs_clean.c.requisition_key == key).limit(1)
        ).mappings().first()
        return _to_existing(row) if row else None

    def _lookup_by_content_hash(self, conn, h: str) -> list[ExistingRecord]:
        rows = conn.execute(
            select(jobs_clean).where(jobs_clean.c.content_hash == h).limit(10)
        ).mappings().all()
        return [_to_existing(r) for r in rows]

    def _lookup_by_soft_key(self, conn, h: str) -> list[ExistingRecord]:
        rows = conn.execute(
            select(jobs_clean).where(jobs_clean.c.soft_key == h).limit(10)
        ).mappings().all()
        return [_to_existing(r) for r in rows]

    # ---------- ingestion (replaces upsert_clean) ----------
    def ingest(self, jobs: Iterable[JobPosting]) -> dict[str, int]:
        """Ingest incoming jobs with classification.

        Returns per-classification counts. Updates first_seen_at / last_seen_at /
        removed_at / reappeared_at / times_seen on the matched row; records
        every event into jobs_history for forensics.

        Defensive guard: any job missing a field that ``jobs_clean`` marks
        ``nullable=False`` is dropped with a warning rather than allowed to
        hit the DB and raise ``IntegrityError``. Pre-guard, a single bad
        record in a batch of thousands would abort the whole transaction
        (rolling back every good insert), terminate the run, and lose the
        entire scrape. This turns one bad row into a single dropped row.
        """
        counts: dict[str, int] = {c.value: 0 for c in Classification}
        now = datetime.now(timezone.utc)

        with self.engine.begin() as conn:
            for j in jobs:
                missing = _missing_required_fields(j)
                if missing:
                    log.warning(
                        "ingest.drop_missing_fields",
                        source=j.source_platform or "<unknown>",
                        title=(j.job_title or "")[:80],
                        source_url=(j.source_url or "")[:120],
                        missing=missing,
                    )
                    continue
                result = classify(
                    j,
                    by_canonical=lambda k: self._lookup_by_canonical(conn, k),
                    by_requisition=lambda k: self._lookup_by_requisition(conn, k),
                    by_content_hash=lambda h: self._lookup_by_content_hash(conn, h),
                    by_soft_key=lambda k: self._lookup_by_soft_key(conn, k),
                    now=now,
                )
                counts[result.classification.value] += 1
                self._apply_result(conn, j, result, now)
        return counts

    def _apply_result(self, conn, j: JobPosting, result: ClassifierResult,
                      now: datetime) -> None:
        """Route the classified job to the right DB operation."""
        from src.normalizer import normalize_company, normalize_location

        c = result.classification
        if c == Classification.NEW:
            values = _insert_values(j, now, classification="new")
            ins = conn.execute(insert(jobs_clean).values(**values))
            job_id = int(ins.inserted_primary_key[0])
            _record_history(conn, job_id, j, "new", result.reason, now)
            return

        matched_id = result.matched_id
        if matched_id is None:
            # UNCERTAIN with no matched id — still record history, insert fresh.
            values = _insert_values(j, now, classification="uncertain")
            ins = conn.execute(insert(jobs_clean).values(**values))
            job_id = int(ins.inserted_primary_key[0])
            _record_history(conn, job_id, j, "uncertain", result.reason, now)
            return

        # DUPLICATE / CROSS_DUP / UPDATED / REPOST all update the existing row.
        existing = conn.execute(
            select(jobs_clean).where(jobs_clean.c.id == matched_id).limit(1)
        ).mappings().first()
        if not existing:
            _record_history(conn, None, j, c.value, result.reason, now)
            return

        upd: dict = {
            "last_seen_at": now,
            "times_seen": (existing["times_seen"] or 0) + 1,
            "classification": c.value,
            "scrape_timestamp_utc": j.scrape_timestamp_utc,
        }
        if c == Classification.REPOST:
            upd["reappeared_at"] = now
            upd["source_job_id"] = j.source_job_id
            upd["source_url"] = j.source_url
            upd["canonical_url"] = j.canonical_url
            upd["apply_url"] = j.apply_url
            upd["content_hash"] = j.content_hash
            upd["date_posted_raw"] = j.date_posted_raw
            upd["date_posted_normalized"] = j.date_posted_normalized
        elif c == Classification.UPDATED:
            upd["content_hash"] = j.content_hash
            upd["date_updated_raw"] = j.date_updated_raw
            upd["date_updated_normalized"] = j.date_updated_normalized
            upd["full_job_description"] = j.full_job_description
            upd["job_description_snippet"] = j.job_description_snippet
            upd["salary"] = j.salary or existing["salary"]
        # DUPLICATE / CROSS_DUP: only bump last_seen_at + times_seen + classification.

        conn.execute(update(jobs_clean).where(jobs_clean.c.id == matched_id).values(**upd))
        _record_history(conn, matched_id, j, c.value, result.reason, now)

    # ---------- sweep for stale / removed jobs ----------
    def mark_removed(self, source: str, seen_canonical_keys: Iterable[str],
                     *, dormant_days: int = 3) -> int:
        """For a given source, any live row not seen in `dormant_days` and
        not in `seen_canonical_keys` this run is flagged as removed.

        Call this after ingesting a full sweep of a source. Enables REPOST
        classification on the next run.
        """
        seen = set(seen_canonical_keys)
        cutoff = datetime.now(timezone.utc)
        with self.engine.begin() as conn:
            rows = conn.execute(
                select(jobs_clean.c.id, jobs_clean.c.canonical_key,
                       jobs_clean.c.last_seen_at)
                .where(jobs_clean.c.source_platform == source)
                .where(jobs_clean.c.removed_at.is_(None))
            ).mappings().all()
            marked = 0
            for r in rows:
                if r["canonical_key"] in seen:
                    continue
                last = r["last_seen_at"]
                if last and last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                if last and (cutoff - last).days < dormant_days:
                    continue
                conn.execute(
                    update(jobs_clean)
                    .where(jobs_clean.c.id == r["id"])
                    .values(removed_at=cutoff)
                )
                conn.execute(
                    insert(jobs_history).values(
                        job_id=r["id"],
                        canonical_key=r["canonical_key"],
                        event="removed",
                        source_platform=source,
                        source_job_id=None,
                        reason=f"not observed for {dormant_days}+ days",
                        event_at=cutoff,
                    )
                )
                marked += 1
        return marked

    # ---------- runs ----------
    def start_run(self) -> int:
        with self.engine.begin() as conn:
            result = conn.execute(
                insert(scrape_runs).values(started_at_utc=datetime.now(timezone.utc))
            )
            return int(result.inserted_primary_key[0])

    def finish_run(self, run_id: int, summary: dict) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                update(scrape_runs)
                .where(scrape_runs.c.id == run_id)
                .values(finished_at_utc=datetime.now(timezone.utc), **summary)
            )

    def count_clean(self) -> int:
        with self.engine.connect() as conn:
            return int(conn.execute(select(func.count()).select_from(jobs_clean)).scalar() or 0)

    def fetch_open_jobs(self) -> list[JobPosting]:
        """Return all open (``removed_at IS NULL``) rows as ``JobPosting`` objects.

        Source of truth for the export layer post-E.9: ingest now keeps
        every record regardless of post-date, so the daily pipeline reads
        the backlog back out through this call and hands it to
        ``rank_top`` for ranking + the 24 h recency slice. Rows flagged
        ``removed_at`` by the mark-removed sweep are excluded — those are
        closed reqs, not current hiring.
        """
        with self.engine.connect() as conn:
            rows = conn.execute(
                select(jobs_clean).where(jobs_clean.c.removed_at.is_(None))
            ).mappings().all()
        return [_row_to_posting(r) for r in rows]


# ----------------------- helpers -----------------------

# Fields on ``jobs_clean`` that are declared ``nullable=False``. A job
# posting missing any of these cannot be inserted — attempting it raises
# ``sqlite3.IntegrityError`` / equivalent and aborts the ingest
# transaction. The ``ingest()`` guard drops such records up front.
#
# We check a subset that corresponds to connector-supplied fields —
# ``scrape_timestamp_utc`` / ``first_seen_at`` / ``last_seen_at`` are
# assigned inside ``_insert_values`` and always non-null; canonical_key
# is computed from the other fields.
_REQUIRED_FIELDS: tuple[str, ...] = (
    "job_title",
    "company_name",
    "source_platform",
    "source_url",
)


def _missing_required_fields(j: JobPosting) -> list[str]:
    """Return the subset of ``_REQUIRED_FIELDS`` that ``j`` leaves unset.

    "Unset" = ``None`` / empty / whitespace-only. Any of those values
    would land as ``NULL`` in SQLite for columns declared
    ``nullable=False`` (or an empty string for TEXT NOT NULL, which we
    also treat as missing — an empty source_url is as useless as no URL).
    """
    missing: list[str] = []
    for field in _REQUIRED_FIELDS:
        val = getattr(j, field, None)
        if val is None:
            missing.append(field)
            continue
        if isinstance(val, str) and not val.strip():
            missing.append(field)
    return missing


def _row_to_posting(row) -> JobPosting:
    """Reconstruct a ``JobPosting`` from a ``jobs_clean`` row mapping.

    Bookkeeping-only fields (``first_seen_at``, ``classification``,
    ``canonical_key``, etc.) are not part of the dataclass and get
    dropped; the round-trip covers everything the exporter and
    ``rank_top`` reference.

    SQLite-over-SQLAlchemy can return naive datetimes for UTC columns.
    Re-stamp them so ``is_within_hours`` / downstream comparisons see an
    aware datetime, matching what the source connectors produce at
    parse time.
    """
    def _aware(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    return JobPosting(
        job_title=row["job_title"],
        company_name=row["company_name"],
        source_platform=row["source_platform"],
        source_url=row["source_url"],
        location=row.get("location"),
        country=row.get("country"),
        remote_type=row.get("remote_type"),
        employment_type=row.get("employment_type"),
        seniority=row.get("seniority"),
        salary=row.get("salary"),
        department=row.get("department"),
        date_posted_raw=row.get("date_posted_raw"),
        date_posted_normalized=_aware(row.get("date_posted_normalized")),
        date_updated_raw=row.get("date_updated_raw"),
        date_updated_normalized=_aware(row.get("date_updated_normalized")),
        scrape_timestamp_utc=_aware(row.get("scrape_timestamp_utc"))
        or datetime.now(timezone.utc),
        job_description_snippet=row.get("job_description_snippet"),
        full_job_description=row.get("full_job_description"),
        source_job_id=row.get("source_job_id"),
        requisition_id=row.get("requisition_id"),
        company_careers_url=row.get("company_careers_url"),
        apply_url=row.get("apply_url"),
        canonical_url=row.get("canonical_url"),
        experience_min_years=row.get("experience_min_years"),
        experience_max_years=row.get("experience_max_years"),
        experience_level=row.get("experience_level"),
        content_hash=row.get("content_hash"),
    )


def _to_existing(row) -> ExistingRecord:
    return ExistingRecord(
        id=row["id"],
        canonical_key=row["canonical_key"],
        content_hash=row.get("content_hash"),
        soft_key=row.get("soft_key"),
        requisition_key=row.get("requisition_key"),
        source_platform=row["source_platform"],
        source_job_id=row.get("source_job_id"),
        requisition_id=row.get("requisition_id"),
        date_updated_normalized=row.get("date_updated_normalized"),
        first_seen_at=row.get("first_seen_at"),
        last_seen_at=row.get("last_seen_at"),
        removed_at=row.get("removed_at"),
    )


def _insert_values(j: JobPosting, now: datetime, *, classification: str) -> dict:
    from src.normalizer import normalize_company, normalize_location
    return dict(
        canonical_key=j.canonical_key(),
        soft_key=j.soft_key(),
        content_hash=j.content_hash,
        requisition_key=j.requisition_key(),
        job_title=j.job_title,
        company_name=j.company_name,
        company_norm=normalize_company(j.company_name),
        location=j.location,
        location_norm=normalize_location(j.location),
        country=j.country,
        remote_type=j.remote_type,
        employment_type=j.employment_type,
        seniority=j.seniority,
        salary=j.salary,
        department=j.department,
        experience_min_years=j.experience_min_years,
        experience_max_years=j.experience_max_years,
        experience_level=j.experience_level,
        date_posted_raw=j.date_posted_raw,
        date_posted_normalized=j.date_posted_normalized,
        date_updated_raw=j.date_updated_raw,
        date_updated_normalized=j.date_updated_normalized,
        source_platform=j.source_platform,
        source_url=j.source_url,
        canonical_url=j.canonical_url,
        apply_url=j.apply_url,
        company_careers_url=j.company_careers_url,
        source_job_id=j.source_job_id,
        requisition_id=j.requisition_id,
        job_description_snippet=j.job_description_snippet,
        full_job_description=j.full_job_description,
        scrape_timestamp_utc=j.scrape_timestamp_utc,
        first_seen_at=now,
        last_seen_at=now,
        times_seen=1,
        classification=classification,
    )


def _record_history(conn, job_id: Optional[int], j: JobPosting, event: str,
                    reason: str, now: datetime) -> None:
    conn.execute(
        insert(jobs_history).values(
            job_id=job_id,
            canonical_key=j.canonical_key(),
            event=event,
            source_platform=j.source_platform,
            source_job_id=j.source_job_id,
            reason=reason,
            event_at=now,
        )
    )
