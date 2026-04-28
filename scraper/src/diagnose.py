"""Per-source diagnostic harness.

Wraps a single source's fetch → parse → filter → dedup → ingest pipeline
with structured instrumentation. Emits a JSON report to
``data/reports/diagnose_<source>_<ISO-ts>.json`` so operators can see
exactly where rows die without grepping logs.

Public entry points:
    diagnose_source(name, target=100, no_ingest=False) -> dict
    diagnose_source_with(scraper, target=100, no_ingest=False) -> dict

The first looks the source up via registry; the second accepts a
pre-instantiated scraper and is the testable core.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from src.base import BaseSourceScraper
from src.logging_config import get_logger
from src.models import JobPosting
from src.normalizer import post_filter

log = get_logger(__name__)

# Overridable in tests via monkeypatch.
_REPORTS_DIR = Path(__file__).resolve().parents[1] / "data" / "reports"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stage(name: str, *, input_count: int | None = None, output_count: int,
           duration_ms: int, notes: str | None = None,
           failures: list[dict] | None = None) -> dict:
    d: dict[str, Any] = {"stage": name, "output_count": output_count,
                          "duration_ms": duration_ms}
    if input_count is not None:
        d["input_count"] = input_count
    if notes:
        d["notes"] = notes
    if failures:
        d["failures"] = failures
    return d


def _seed_count(scraper: BaseSourceScraper) -> int:
    """Best-effort count of seed companies/boards/tenants the scraper will
    iterate. Different scrapers use different attribute names."""
    for attr in ("boards", "companies", "tenants", "urls"):
        v = getattr(scraper, attr, None)
        if isinstance(v, list):
            return len(v)
    # Aggregators like RemoteOK/Adzuna/USAJobs don't have seeds.
    return 1


def _recency_hours(source_name: str) -> int:
    """Look up recency for this source. Uses recency_for_source if available
    (added in Task 5); falls back to settings.recency_hours; finally to 168."""
    try:
        from src.recency import recency_for_source  # type: ignore[attr-defined]
        return recency_for_source(source_name)
    except (ImportError, AttributeError):
        pass
    try:
        from config import settings
        return settings.recency_hours or 168
    except Exception:
        return 168


def diagnose_source_with(scraper: BaseSourceScraper, *, target: int = 100,
                          no_ingest: bool = False) -> dict:
    """Diagnose an already-instantiated scraper. Returns the report dict
    AND writes it to disk."""
    t_start = time.monotonic()
    started_at = _now()
    source_name = scraper.name
    recency_hours = _recency_hours(source_name)

    stages: list[dict] = []

    # Stage 1: fetch_seeds
    t0 = time.monotonic()
    seed_count = _seed_count(scraper)
    stages.append(_stage("fetch_seeds", output_count=seed_count,
                          duration_ms=int((time.monotonic() - t0) * 1000)))

    # Stages 2 + 3: fetch_listings + parse_listings (run together because
    # base.run() interleaves them; we recapitulate that here).
    t0 = time.monotonic()
    raw_records: list[dict[str, Any]] = []
    parsed: list[JobPosting] = []
    failures: list[dict] = []
    try:
        for raw in scraper.fetch_listings():
            raw_records.append(raw)
            try:
                job = scraper.parse_listing(raw)
            except Exception as e:
                failures.append({"reason": "parse_error", "error": str(e)[:200]})
                continue
            if job and job.company_name:
                job.source_platform = source_name
                parsed.append(job)
    except Exception as e:
        failures.append({"reason": "fetch_fatal", "error": str(e)[:200]})
    fetch_ms = int((time.monotonic() - t0) * 1000)

    stages.append(_stage("fetch_listings", input_count=seed_count,
                          output_count=len(raw_records), duration_ms=fetch_ms,
                          failures=failures or None))
    stages.append(_stage("parse_listings", input_count=len(raw_records),
                          output_count=len(parsed), duration_ms=0))

    # Stage 4: normalize (title + US filter + experience inference)
    t0 = time.monotonic()
    normalized = post_filter(parsed)
    stages.append(_stage("normalize", input_count=len(parsed),
                          output_count=len(normalized),
                          duration_ms=int((time.monotonic() - t0) * 1000)))

    # Stage 5: recency_filter
    t0 = time.monotonic()
    cutoff = started_at - timedelta(hours=recency_hours)
    survivors: list[JobPosting] = []
    for j in normalized:
        dt = j.date_posted_normalized
        if dt is None:
            survivors.append(j)  # never drop on missing date
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        if dt >= cutoff:
            survivors.append(j)
    stages.append(_stage("recency_filter", input_count=len(normalized),
                          output_count=len(survivors),
                          duration_ms=int((time.monotonic() - t0) * 1000),
                          notes=f"cutoff={cutoff.isoformat()} hours={recency_hours}"))

    # Stage 6: dedup_check — best-effort against Supabase if configured.
    t0 = time.monotonic()
    new_keys = [j.canonical_key() for j in survivors]
    dedup_survivors = survivors  # default: skip lookup when no backend
    dedup_note = "skipped (no backend)"
    try:
        if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"):
            from src.supabase_storage import SupabaseStorage
            storage = SupabaseStorage()
            existing = storage.existing_canonical_keys(new_keys) if hasattr(
                storage, "existing_canonical_keys") else set()
            dedup_survivors = [j for j, k in zip(survivors, new_keys)
                                if k not in existing]
            dedup_note = f"existing_in_db={len(existing)}"
    except Exception as e:
        dedup_note = f"error: {str(e)[:100]}"
    stages.append(_stage("dedup_check", input_count=len(survivors),
                          output_count=len(dedup_survivors),
                          duration_ms=int((time.monotonic() - t0) * 1000),
                          notes=dedup_note))

    # Stage 7: ingest
    t0 = time.monotonic()
    rows_written: int = 0
    ingest_note: str = ""
    if no_ingest:
        rows_written = 0
        ingest_note = "skipped (--no-ingest)"
    else:
        try:
            if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"):
                from src.supabase_storage import SupabaseStorage
                counts = SupabaseStorage().ingest(dedup_survivors)
                rows_written = sum(counts.values()) if isinstance(counts, dict) else len(dedup_survivors)
                ingest_note = f"counts={counts}"
            else:
                rows_written = 0
                ingest_note = "no backend configured"
        except Exception as e:
            rows_written = 0
            ingest_note = f"error: {str(e)[:100]}"
    stages.append(_stage("ingest", input_count=len(dedup_survivors),
                          output_count=rows_written,
                          duration_ms=int((time.monotonic() - t0) * 1000),
                          notes=ingest_note))

    # Summary
    dropped_recency = len(normalized) - len(survivors)
    dropped_dedup = len(survivors) - len(dedup_survivors)
    dropped_normalize = len(parsed) - len(normalized)
    http_failures = sum(1 for f in failures
                        if f.get("reason") in {"parse_error", "fetch_fatal"})
    top_failure = failures[0] if failures else None

    report = {
        "source": source_name,
        "started_at": started_at.isoformat(),
        "duration_seconds": round(time.monotonic() - t_start, 2),
        "config": {"recency_hours": recency_hours, "target": target,
                    "no_ingest": no_ingest},
        "stages": stages,
        "summary": {
            "rows_written": rows_written,
            "dropped_by": {
                "normalize": dropped_normalize,
                "recency": dropped_recency,
                "dedup": dropped_dedup,
            },
            "http_failures": http_failures,
            "top_failure_reason": top_failure.get("reason") if top_failure else None,
        },
    }

    # Persist report
    _REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    ts = started_at.strftime("%Y-%m-%dT%H-%M-%S")
    out_path = _REPORTS_DIR / f"diagnose_{source_name}_{ts}.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    log.info("diagnose.complete", source=source_name, path=str(out_path),
              rows_written=rows_written)

    try:
        scraper.close()
    except Exception:
        pass

    return report


def diagnose_source(name: str, *, target: int = 100,
                     no_ingest: bool = False) -> dict:
    """Look up `name` in the registry and run the diagnostic."""
    from src.sources.registry import all_scrapers

    found = next((s for s in all_scrapers() if s.name == name), None)
    if found is None:
        raise ValueError(f"unknown source: {name}")
    return diagnose_source_with(found, target=target, no_ingest=no_ingest)
