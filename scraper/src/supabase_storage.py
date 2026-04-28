"""Supabase / PostgREST persistence backend.

Implements the same public surface as ``src.storage.Storage`` so
``run_daily.py`` can swap between SQLite (local dev) and Supabase
(production) transparently via the ``SUPABASE_URL`` env var.

Design notes
------------
- Uses ``supabase-py`` with the **publishable** (anon) key.
  RLS is disabled on ``scraper_*`` tables so anon writes go through.
- PostgREST has no cross-table transactions. Atomicity for
  insert-or-update on ``scraper_jobs_clean`` is delegated to the
  Postgres unique index on ``canonical_key`` via ``.upsert()``.
- History events are best-effort appends — never fail ingest if the
  history write errors out.
- Dedup classification is simplified vs. the SQLite backend:
  we emit ``new`` on first insert, ``updated`` on subsequent upserts
  of the same ``canonical_key``. The three-tier lookup (canonical /
  requisition / content_hash / soft_key) from ``Storage.ingest`` is
  NOT reproduced here — Postgres' unique-index upsert handles the
  common case. If you need the full classifier semantics on Supabase,
  that's a follow-up.
"""
from __future__ import annotations

import hashlib
from concurrent.futures import ALL_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Optional

from supabase import Client, create_client

from src.logging_config import get_logger
from src.models import JobPosting

log = get_logger(__name__)

# Table names (prefixed to share the Supabase project with other apps).
T_RAW = "scraper_jobs_raw"
T_CLEAN = "scraper_jobs_clean"
T_HIST = "scraper_jobs_history"
T_RUNS = "scraper_runs"

# Concurrency knobs for ingest(). Exposed as module constants so tests
# and callers can tune them without touching private internals.
INGEST_PRECHECK_CHUNK = 100    # PostgREST .in_() URL-length safe size
INGEST_UPSERT_CHUNK = 200      # smaller to stay under Supabase Postgres statement_timeout on wide rows
INGEST_HISTORY_CHUNK = 500
INGEST_MAX_WORKERS = 2         # Windows + HTTP/2: >2 concurrent large POSTs
                               # saturate the socket buffer and trigger
                               # WSAEWOULDBLOCK / GOAWAY. See 2026-04-20.
INGEST_CHUNK_TIMEOUT_S = 60.0  # per-chunk HTTP budget
INGEST_RETRY_MAX = 3           # attempts per chunk (including first try)
INGEST_RETRY_BACKOFF_S = 0.5   # base backoff; doubled each retry
SAVE_RAW_CHUNK = 500           # raw payloads are larger; keep chunks small


# Transient HTTP / socket errors that should be retried. String-matched
# against ``str(exc)`` so we catch errors wrapped by Supabase client
# layers that would otherwise lose the original type.
_TRANSIENT_ERROR_MARKERS = (
    "WinError 10035",           # WSAEWOULDBLOCK — socket buffer full
    "ConnectionTerminated",     # HTTP/2 GOAWAY
    "RemoteProtocolError",
    "ConnectError",
    "ReadError",
    "WriteError",
    "ConnectTimeout",
    "ReadTimeout",
)


def _is_transient_error(exc: BaseException) -> bool:
    """True if ``exc`` is the kind of network blip worth retrying."""
    # Concrete httpx types — prefer isinstance over string match when we can.
    try:
        import httpx as _httpx  # lazy: test envs sometimes stub httpx
        if isinstance(exc, (
            _httpx.ConnectError, _httpx.ConnectTimeout,
            _httpx.ReadError, _httpx.ReadTimeout,
            _httpx.WriteError, _httpx.WriteTimeout,
            _httpx.RemoteProtocolError, _httpx.PoolTimeout,
        )):
            return True
    except Exception:
        pass
    # OSError with winerror=10035 (WSAEWOULDBLOCK) — the prod-observed error.
    if isinstance(exc, OSError):
        if getattr(exc, "winerror", None) == 10035:
            return True
        if getattr(exc, "errno", None) == 10035:
            return True
    # Fall back to string match for wrapped / unknown subclasses.
    s = str(exc) + " " + type(exc).__name__
    return any(marker in s for marker in _TRANSIENT_ERROR_MARKERS)

# Fields on scraper_jobs_clean that come directly from JobPosting.
# Anything not in here is computed (keys, timestamps, classification).
_CLEAN_PASSTHROUGH_FIELDS = (
    "job_title", "company_name", "location", "country",
    "remote_type", "employment_type", "seniority", "salary",
    "department", "experience_min_years", "experience_max_years",
    "experience_level", "date_posted_raw", "date_updated_raw",
    "source_platform", "source_url", "canonical_url", "apply_url",
    "company_careers_url", "source_job_id", "requisition_id",
    "job_description_snippet", "full_job_description",
)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _posting_to_row(j: JobPosting, *, now: datetime) -> dict[str, Any]:
    """Convert a JobPosting into a scraper_jobs_clean row dict."""
    row: dict[str, Any] = {k: getattr(j, k) for k in _CLEAN_PASSTHROUGH_FIELDS}
    row["canonical_key"] = j.canonical_key()
    row["soft_key"] = j.soft_key()
    row["content_hash"] = j.content_hash
    row["requisition_key"] = j.requisition_key()
    row["date_posted_normalized"] = _iso(j.date_posted_normalized)
    row["date_updated_normalized"] = _iso(j.date_updated_normalized)
    row["scrape_timestamp_utc"] = _iso(j.scrape_timestamp_utc)
    row["first_seen_at"] = _iso(now)
    row["last_seen_at"] = _iso(now)
    row["times_seen"] = 1
    row["classification"] = "new"
    return row


class SupabaseStorage:
    """Supabase PostgREST persistence backend.

    Mirrors the public method surface of ``src.storage.Storage``.
    """

    def __init__(self, url: Optional[str] = None, key: Optional[str] = None) -> None:
        import os
        self._url = url or os.environ.get("SUPABASE_URL", "")
        self._key = key or os.environ.get("SUPABASE_KEY", "")
        if not self._url or not self._key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY must be set to use SupabaseStorage"
            )
        self._client: Client = create_client(self._url, self._key)
        log.info("supabase.storage.init", url=self._url[:40])

    # ------------------------------------------------------------------
    # Raw payload persistence
    # ------------------------------------------------------------------

    def save_raw(
        self,
        source: str,
        records: Iterable[dict],
        *,
        _chunk_timeout_s: float = INGEST_CHUNK_TIMEOUT_S,
    ) -> int:
        """Persist raw portal payloads. Dedup on (source_platform, payload_hash).

        Payloads are chunked into ``SAVE_RAW_CHUNK``-sized batches and
        dispatched across a thread pool. A single stuck chunk is bounded
        by ``_chunk_timeout_s`` (default ``INGEST_CHUNK_TIMEOUT_S``) so
        one slow upload can't strand the whole save. Historically this
        method sent one unchunked upsert of every raw record for a
        source — on greenhouse's ~56K rows that produced a ~1 GB HTTP
        body and a multi-hour stall.
        """
        rows: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc)
        for rec in records:
            import json
            payload = json.dumps(rec, default=str, ensure_ascii=False)
            h = hashlib.sha1(payload.encode("utf-8")).hexdigest()
            rows.append({
                "source_platform": source,
                "payload": payload,
                "payload_hash": h,
                "scrape_timestamp_utc": _iso(now),
            })
        if not rows:
            return 0

        chunks = [
            rows[i:i + SAVE_RAW_CHUNK]
            for i in range(0, len(rows), SAVE_RAW_CHUNK)
        ]

        def _worker(batch: list[dict[str, Any]]) -> int:
            resp = (
                self._client.table(T_RAW)
                .upsert(batch, on_conflict="source_platform,payload_hash",
                        ignore_duplicates=True)
                .execute()
            )
            return len(resp.data or [])

        try:
            rows_ok, _ok, failed = self._run_chunks(
                "save_raw", chunks, _worker, timeout_s=_chunk_timeout_s,
            )
            if failed:
                log.warning(
                    "supabase.save_raw.partial",
                    source=source, chunks_failed=failed, chunks_total=len(chunks),
                )
            return rows_ok
        except Exception as e:
            log.warning("supabase.save_raw.failed", source=source, error=str(e)[:200])
            return 0

    def prune_raw(self, *, ttl_days: int) -> int:
        """Delete raw rows older than ttl_days."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=ttl_days)
        try:
            resp = (
                self._client.table(T_RAW)
                .delete()
                .lt("scrape_timestamp_utc", _iso(cutoff))
                .execute()
            )
            return len(resp.data or [])
        except Exception as e:
            log.warning("supabase.prune_raw.failed", error=str(e)[:200])
            return 0

    # ------------------------------------------------------------------
    # Clean ingest — upsert on canonical_key
    # ------------------------------------------------------------------

    def _run_chunks(
        self,
        phase: str,
        chunks: list[Any],
        worker: Callable[[Any], int],
        *,
        timeout_s: float,
        max_workers: int = INGEST_MAX_WORKERS,
    ) -> tuple[int, int, int]:
        """Fan chunk workers out across a thread pool.

        Returns (rows_ok, chunks_ok, chunks_failed). A chunk is counted
        as failed if ``worker`` raises or the future exceeds
        ``timeout_s`` — failures do NOT abort the whole phase, so a
        single slow or broken chunk can't strand the run.
        """
        if not chunks:
            return 0, 0, 0
        rows_ok = 0
        chunks_ok = 0
        chunks_failed = 0
        total = len(chunks)
        workers = max(1, min(max_workers, total))
        # Manual executor lifecycle — we want `ingest()` to return even if a
        # chunk is stuck mid-HTTP, which `with ThreadPoolExecutor(...)`
        # doesn't permit (its __exit__ waits for all running threads). With
        # `shutdown(wait=False, cancel_futures=True)` a hung worker leaks a
        # thread but ingest proceeds; the thread dies naturally when its
        # HTTP request eventually completes or the process exits.
        ex = ThreadPoolExecutor(
            max_workers=workers,
            thread_name_prefix=f"ingest-{phase}",
        )

        def _retrying_worker(idx: int, chunk: Any) -> int:
            """Invoke ``worker(chunk)`` with bounded retry on transient errors.

            Transient errors (WSAEWOULDBLOCK, HTTP/2 GOAWAY, connect/read
            blips) retry up to ``INGEST_RETRY_MAX`` attempts with
            exponential backoff. Non-transient errors raise on the first
            attempt — data bugs shouldn't be masked by retries.
            """
            import time as _time
            attempt = 0
            while True:
                attempt += 1
                try:
                    return worker(chunk)
                except BaseException as e:  # noqa: BLE001 — decide via helper
                    if attempt >= INGEST_RETRY_MAX or not _is_transient_error(e):
                        raise
                    backoff = INGEST_RETRY_BACKOFF_S * (2 ** (attempt - 1))
                    log.warning(
                        "supabase.ingest.chunk.retry",
                        phase=phase, chunk=idx + 1, of=total,
                        attempt=attempt, of_max=INGEST_RETRY_MAX,
                        error=str(e)[:200], backoff_s=round(backoff, 2),
                    )
                    if backoff > 0:
                        _time.sleep(backoff)

        try:
            future_to_idx = {
                ex.submit(_retrying_worker, i, ch): i
                for i, ch in enumerate(chunks)
            }
            done, pending = wait(
                future_to_idx.keys(),
                timeout=timeout_s,
                return_when=ALL_COMPLETED,
            )
            for fut in done:
                idx = future_to_idx[fut]
                try:
                    n = fut.result()
                    rows_ok += int(n or 0)
                    chunks_ok += 1
                    log.info(
                        "supabase.ingest.chunk.done",
                        phase=phase, chunk=idx + 1, of=total, rows=int(n or 0),
                    )
                except Exception as e:  # noqa: BLE001 — best-effort phase
                    chunks_failed += 1
                    log.warning(
                        "supabase.ingest.chunk.failed",
                        phase=phase, chunk=idx + 1, of=total,
                        error=str(e)[:200],
                    )
            for fut in pending:
                idx = future_to_idx[fut]
                chunks_failed += 1
                log.warning(
                    "supabase.ingest.chunk.timeout",
                    phase=phase, chunk=idx + 1, of=total,
                    timeout_s=timeout_s,
                )
        finally:
            ex.shutdown(wait=False, cancel_futures=True)
        return rows_ok, chunks_ok, chunks_failed

    def ingest(
        self,
        jobs: Iterable[JobPosting],
        *,
        _chunk_timeout_s: float = INGEST_CHUNK_TIMEOUT_S,
    ) -> dict[str, int]:
        """Upsert clean rows. Returns {'new': N, 'updated': M, 'discarded': 0}.

        NOTE: without a pre-read we can't distinguish new vs. updated cheaply
        in a single round-trip. We approximate: count how many canonical_keys
        already existed before the upsert, call those 'updated'; the rest are
        'new'.
        """
        jobs_list = list(jobs)
        if not jobs_list:
            return {"new": 0, "updated": 0, "discarded": 0, "duplicate": 0, "uncertain": 0}

        now = datetime.now(timezone.utc)
        rows = [_posting_to_row(j, now=now) for j in jobs_list]

        # ------------------------------------------------------------------
        # Phase 1 — pre-check: which canonical_keys already exist?
        # ------------------------------------------------------------------
        keys = [r["canonical_key"] for r in rows]
        key_chunks = [
            keys[i:i + INGEST_PRECHECK_CHUNK]
            for i in range(0, len(keys), INGEST_PRECHECK_CHUNK)
        ]
        existing: set[str] = set()
        existing_lock = __import__("threading").Lock()

        def _precheck(chunk: list[str]) -> int:
            resp = (
                self._client.table(T_CLEAN)
                .select("canonical_key")
                .in_("canonical_key", chunk)
                .execute()
            )
            found = [row["canonical_key"] for row in (resp.data or [])]
            with existing_lock:
                existing.update(found)
            return len(found)

        self._run_chunks(
            "precheck", key_chunks, _precheck,
            timeout_s=_chunk_timeout_s,
        )

        # ------------------------------------------------------------------
        # Phase 2 — upsert
        # ------------------------------------------------------------------
        row_chunks = [
            rows[i:i + INGEST_UPSERT_CHUNK]
            for i in range(0, len(rows), INGEST_UPSERT_CHUNK)
        ]

        def _upsert(batch: list[dict]) -> int:
            resp = (
                self._client.table(T_CLEAN)
                .upsert(batch, on_conflict="canonical_key")
                .execute()
            )
            return len(resp.data or [])

        upserted, _ok, _failed = self._run_chunks(
            "upsert", row_chunks, _upsert,
            timeout_s=_chunk_timeout_s,
        )

        updated_count = sum(1 for r in rows if r["canonical_key"] in existing)
        new_count = upserted - updated_count
        if new_count < 0:
            new_count = 0

        # ------------------------------------------------------------------
        # Phase 3 — history append (best-effort, non-fatal).
        # ------------------------------------------------------------------
        hist_rows = [
            {
                "canonical_key": r["canonical_key"],
                "event": "updated" if r["canonical_key"] in existing else "new",
                "source_platform": r["source_platform"],
                "source_job_id": r.get("source_job_id"),
                "event_at": _iso(now),
            }
            for r in rows
        ]
        hist_chunks = [
            hist_rows[i:i + INGEST_HISTORY_CHUNK]
            for i in range(0, len(hist_rows), INGEST_HISTORY_CHUNK)
        ]

        def _history(batch: list[dict]) -> int:
            resp = self._client.table(T_HIST).insert(batch).execute()
            return len(resp.data or [])

        self._run_chunks(
            "history", hist_chunks, _history,
            timeout_s=_chunk_timeout_s,
        )

        log.info("supabase.ingest.done", total=upserted,
                 new=new_count, updated=updated_count)
        return {
            "new": new_count,
            "updated": updated_count,
            "duplicate": 0,
            "uncertain": 0,
            "discarded": 0,
        }

    # ------------------------------------------------------------------
    # Removal sweep
    # ------------------------------------------------------------------

    def mark_removed(
        self,
        source: str,
        seen_canonical_keys: Iterable[str],
        *,
        run_id: Optional[int] = None,
        dormant_days: int = 0,
        **_ignored: Any,
    ) -> int:
        """Mark jobs from this source NOT seen in this run as removed.

        If ``dormant_days > 0``, only flip rows whose ``last_seen_at`` is
        older than ``now - dormant_days`` (grace period for flaky sources).
        """
        seen = set(seen_canonical_keys)
        cutoff_iso: Optional[str] = None
        if dormant_days and dormant_days > 0:
            cutoff_iso = _iso(datetime.now(timezone.utc) - timedelta(days=dormant_days))
        try:
            # Fetch current open canonical_keys for this source, optionally
            # filtered by last_seen_at < cutoff.
            q = (
                self._client.table(T_CLEAN)
                .select("canonical_key,last_seen_at")
                .eq("source_platform", source)
                .is_("removed_at", "null")
            )
            if cutoff_iso:
                q = q.lt("last_seen_at", cutoff_iso)
            resp = q.execute()
            current_keys = {row["canonical_key"] for row in resp.data or []}
        except Exception as e:
            log.warning("supabase.mark_removed.fetch.failed",
                        source=source, error=str(e)[:200])
            return 0

        to_remove = list(current_keys - seen)
        if not to_remove:
            return 0

        now_iso = _iso(datetime.now(timezone.utc))
        updated = 0
        for i in range(0, len(to_remove), 100):
            chunk = to_remove[i:i + 100]
            try:
                resp = (
                    self._client.table(T_CLEAN)
                    .update({"removed_at": now_iso, "classification": "removed"})
                    .in_("canonical_key", chunk)
                    .execute()
                )
                updated += len(resp.data or [])
            except Exception as e:
                log.warning("supabase.mark_removed.update.failed",
                            chunk_start=i, error=str(e)[:200])

        return updated

    # ------------------------------------------------------------------
    # Run bookkeeping
    # ------------------------------------------------------------------

    def start_run(self) -> int:
        now_iso = _iso(datetime.now(timezone.utc))
        resp = (
            self._client.table(T_RUNS)
            .insert({"started_at_utc": now_iso})
            .execute()
        )
        return int(resp.data[0]["id"])

    def finish_run(self, run_id: int, summary: dict) -> None:
        payload = dict(summary)
        payload["finished_at_utc"] = _iso(datetime.now(timezone.utc))
        try:
            (
                self._client.table(T_RUNS)
                .update(payload)
                .eq("id", run_id)
                .execute()
            )
        except Exception as e:
            log.warning("supabase.finish_run.failed",
                        run_id=run_id, error=str(e)[:200])

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    def count_clean(self) -> int:
        try:
            resp = (
                self._client.table(T_CLEAN)
                .select("id", count="exact")
                .limit(1)
                .execute()
            )
            return int(resp.count or 0)
        except Exception as e:
            log.warning("supabase.count_clean.failed", error=str(e)[:200])
            return 0

    def fetch_open_jobs(self) -> list[JobPosting]:
        """Return all jobs with removed_at IS NULL as JobPosting instances."""
        out: list[JobPosting] = []
        offset = 0
        page = 1000
        while True:
            try:
                resp = (
                    self._client.table(T_CLEAN)
                    .select("*")
                    .is_("removed_at", "null")
                    .range(offset, offset + page - 1)
                    .execute()
                )
            except Exception as e:
                log.warning("supabase.fetch_open.failed", error=str(e)[:200])
                break
            rows = resp.data or []
            if not rows:
                break
            out.extend(_row_to_posting(r) for r in rows)
            if len(rows) < page:
                break
            offset += page
        return out


def _parse_dt(v: Any) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v
    if isinstance(v, str):
        try:
            s = v.replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            return None
    return None


def _row_to_posting(row: dict) -> JobPosting:
    """Reconstitute a JobPosting from a scraper_jobs_clean row.

    Bookkeeping fields (first_seen_at, classification, etc.) are not
    carried back onto the dataclass — they're DB-only.
    """
    return JobPosting(
        job_title=row.get("job_title") or "",
        company_name=row.get("company_name") or "",
        source_platform=row.get("source_platform") or "",
        source_url=row.get("source_url") or "",
        location=row.get("location"),
        country=row.get("country"),
        remote_type=row.get("remote_type"),
        employment_type=row.get("employment_type"),
        seniority=row.get("seniority"),
        salary=row.get("salary"),
        department=row.get("department"),
        date_posted_raw=row.get("date_posted_raw"),
        date_posted_normalized=_parse_dt(row.get("date_posted_normalized")),
        date_updated_raw=row.get("date_updated_raw"),
        date_updated_normalized=_parse_dt(row.get("date_updated_normalized")),
        scrape_timestamp_utc=_parse_dt(row.get("scrape_timestamp_utc"))
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
