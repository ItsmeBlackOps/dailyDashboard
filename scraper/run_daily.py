"""Daily driver — orchestrates all sources, dedupes, filters, exports, reports.

Usage:
    python run_daily.py                  # default: target 100 jobs
    python run_daily.py --target 200     # raise target
    python run_daily.py --source greenhouse lever    # restrict sources
    python run_daily.py --no-recency     # disable 24h filter (debug only)
    python run_daily.py --no-sweep       # skip the mark-removed sweep
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from config import settings
from src.base import BaseSourceScraper
from src.deduplicator import StreamingDedupe
from src.exporter import export, rank_top
from src.logging_config import configure_logging, get_logger
from src.models import JobPosting
from src.normalizer import post_filter
from src.recency import is_within_hours
from src.report import render_console, write_report
from src.sources.registry import all_scrapers

log = get_logger(__name__)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Daily Data-Analyst job scraper")
    p.add_argument("--target", type=int, default=settings.target_count)
    p.add_argument("--source", nargs="*", help="Only run these source names.")
    p.add_argument("--no-recency", action="store_true", help="Disable 24h filter.")
    p.add_argument(
        "--no-sweep", action="store_true",
        help="Skip the per-source mark-removed sweep after ingest.",
    )
    p.add_argument(
        "--dormant-days", type=int, default=3,
        help="Days since last_seen before a row is flagged as removed in the sweep.",
    )
    p.add_argument(
        "--parallel", type=int, default=4,
        help="Max concurrent source workers. Default 4; use 1 to serialize.",
    )
    p.add_argument(
        "--diagnose", metavar="SOURCE",
        help="Run one source with per-stage diagnostics and exit. "
             "Emits data/reports/diagnose_<source>_<ts>.json.",
    )
    p.add_argument(
        "--no-ingest", action="store_true",
        help="Dry-run: skip storage writes. Only meaningful with --diagnose.",
    )
    return p.parse_args()


def _run_one(
    source: BaseSourceScraper,
) -> tuple[str, list[JobPosting], list[dict], str | None, float]:
    """Run one source end-to-end. Returns (name, parsed, raw, err, scrape_s)."""
    log.info("source.start", source=source.name)
    t0 = time.perf_counter()
    try:
        parsed, raw = source.run()
        scrape_s = time.perf_counter() - t0
        log.info(
            "source.scrape.done",
            source=source.name,
            parsed=len(parsed), raw=len(raw),
            elapsed_s=round(scrape_s, 2),
        )
        return source.name, parsed, raw, None, scrape_s
    except Exception as e:
        scrape_s = time.perf_counter() - t0
        log.error(
            "source.failed", source=source.name, error=str(e),
            elapsed_s=round(scrape_s, 2),
        )
        return source.name, [], [], f"{type(e).__name__}: {e}", scrape_s
    finally:
        try:
            source.close()
        except Exception:
            pass


def main() -> int:
    configure_logging()
    args = _parse_args()

    # --diagnose short-circuits normal ingest with per-stage instrumentation.
    if args.diagnose:
        from src.diagnose import diagnose_source
        import json as _json
        report = diagnose_source(
            args.diagnose,
            target=args.target,
            no_ingest=args.no_ingest,
        )
        print(_json.dumps({"source": report["source"],
                            "summary": report["summary"],
                            "stages": [{"stage": s["stage"],
                                        "input_count": s.get("input_count"),
                                        "output_count": s["output_count"]}
                                       for s in report["stages"]]},
                           indent=2))
        return 0

    # Import Storage lazily so --help works without heavy deps.
    # Picks Supabase backend if SUPABASE_URL is set, else SQLite via SQLAlchemy.
    import os as _os
    if _os.environ.get("SUPABASE_URL") and _os.environ.get("SUPABASE_KEY"):
        from src.supabase_storage import SupabaseStorage
        storage = SupabaseStorage()
        log.info("storage.backend", kind="supabase")
    else:
        from src.storage import Storage
        storage = Storage()
        log.info("storage.backend", kind="sqlalchemy")

    scrapers = all_scrapers()
    if args.source:
        wanted = set(args.source)
        scrapers = [s for s in scrapers if s.name in wanted]

    run_id = storage.start_run()
    started_at = datetime.now(timezone.utc)
    log.info("run.start", run_id=run_id, sources=[s.name for s in scrapers])

    failed_sources: list[str] = []
    succeeded_sources: set[str] = set()
    per_source_parsed: dict[str, int] = {}
    per_source_unique: dict[str, int] = {}
    all_parsed_count = 0
    all_unique: list[JobPosting] = []
    dup_count_total = 0
    classification_counts: dict[str, int] = {}

    # Stream: as each source's future completes, filter -> dedupe -> ingest
    # immediately. A single ``StreamingDedupe`` carries canonical-hash and
    # fuzzy-soft sets across calls so cross-source dedupe still works.
    # Rationale: pre-refactor we collected all 24 sources into one list and
    # ingested at the end — if the process died mid-run (e.g. during
    # greenhouse's 20-min fetch), Supabase got zero rows. Per-source ingest
    # ensures earlier sources' rows persist regardless of what happens later.
    streaming_dedupe = StreamingDedupe()

    # Run sources concurrently — they hit different hosts, so no cross-interference.
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        futures = {pool.submit(_run_one, s): s for s in scrapers}
        for fut in as_completed(futures):
            name, parsed, raw, err, scrape_s = fut.result()
            if err:
                failed_sources.append(f"{name}: {err}")
            else:
                succeeded_sources.add(name)

            # Stage 1: persist raw portal payloads (chunked+parallel — see
            # SupabaseStorage.save_raw). Emit a stage-done log so operators
            # can see motion even when a single source pushes many chunks.
            _t = time.perf_counter()
            raw_rows_written = storage.save_raw(name, raw)
            log.info(
                "source.save_raw.done",
                source=name, raw_in=len(raw), rows_written=raw_rows_written,
                elapsed_s=round(time.perf_counter() - _t, 2),
            )

            per_source_parsed[name] = len(parsed)
            all_parsed_count += len(parsed)

            # Stage 2: title + US filter (and inference of experience, content_hash, etc.)
            _t = time.perf_counter()
            filtered = post_filter(parsed)
            log.info(
                "source.postfilter.done",
                source=name, parsed=len(parsed), kept=len(filtered),
                dropped=len(parsed) - len(filtered),
                elapsed_s=round(time.perf_counter() - _t, 2),
            )

            # Stage 3: cross-source dedupe — seen-sets persist across calls.
            _t = time.perf_counter()
            unique_this_source, dup_this_source = streaming_dedupe.filter(filtered)
            dup_count_total += dup_this_source
            log.info(
                "source.dedupe.done",
                source=name, filtered=len(filtered),
                unique=len(unique_this_source), duplicates=dup_this_source,
                elapsed_s=round(time.perf_counter() - _t, 2),
            )

            # Stage 4: immediate write. Don't assume the backend's key set — the
            #    SQLite classifier emits new/updated/duplicate/cross_dup/
            #    uncertain/repost; Supabase only emits new/updated. Merge
            #    defensively via ``dict.get(k, 0) + v``.
            _t = time.perf_counter()
            counts = storage.ingest(unique_this_source) if unique_this_source else {}
            log.info(
                "source.ingest.done",
                source=name, unique=len(unique_this_source),
                classification=counts,
                elapsed_s=round(time.perf_counter() - _t, 2),
            )
            for k, v in counts.items():
                classification_counts[k] = classification_counts.get(k, 0) + v
            all_unique.extend(unique_this_source)
            per_source_unique[name] = len(unique_this_source)

            # Full-source roll-up — one line per source summarizing every
            # stage so operators can skim "what happened for X" at a glance.
            # NB: BaseSourceScraper.run() already emits ``source.complete``
            # for just the scrape stage. This ``source.pipeline.done`` event
            # covers scrape + save_raw + post_filter + dedupe + ingest.
            log.info(
                "source.pipeline.done",
                source=name,
                scrape_s=round(scrape_s, 2),
                parsed=len(parsed),
                raw_rows_written=raw_rows_written,
                filtered=len(filtered),
                unique=len(unique_this_source),
                duplicates=dup_this_source,
                classification=counts,
            )
            # Preserve the historical "source.ingested" event so any
            # existing dashboards / greps still fire.
            log.info(
                "source.ingested",
                source=name,
                parsed=len(parsed),
                filtered=len(filtered),
                written=len(unique_this_source),
                classification=counts,
            )

    log.info(
        "pipeline.filtered",
        total_parsed=all_parsed_count,
        unique=len(all_unique),
        duplicates=dup_count_total,
    )
    log.info("pipeline.classified", **classification_counts)

    # 4a. prune aged-out raw payloads. Raw blobs are audit-only (nothing in
    #     the pipeline reads them back); bounding their retention stops
    #     jobs_raw from dominating the DB. Skipped when RAW_TTL_DAYS=0.
    if settings.raw_ttl_days > 0:
        pruned = storage.prune_raw(ttl_days=settings.raw_ttl_days)
        if pruned:
            log.info("pipeline.raw_pruned", rows=pruned,
                     ttl_days=settings.raw_ttl_days)

    sweep_counts: dict[str, int] = {}
    if not args.no_sweep:
        # Group this run's canonical_keys per source so mark_removed knows what
        # was actually observed. Only sweep sources that completed successfully —
        # sweeping on a failed source would mark everything as removed.
        seen_by_source: dict[str, set[str]] = {}
        for j in all_unique:
            seen_by_source.setdefault(j.source_platform, set()).add(j.canonical_key())
        for src in succeeded_sources:
            keys = seen_by_source.get(src, set())
            sweep_counts[src] = storage.mark_removed(
                src, keys, dormant_days=args.dormant_days
            )
        log.info("pipeline.sweep", marked_removed=sweep_counts)

    # 5. export top-N (recency-sliced) + all-unique (full open backlog).
    #    Source of truth is ``jobs_clean`` now — today's run's rows were
    #    just ingested, and prior runs' still-open reqs are also in there.
    backlog = storage.fetch_open_jobs()
    recency_hours = None if args.no_recency else settings.recency_hours
    top = rank_top(backlog, limit=args.target, recency_hours=recency_hours)
    exports = export(top, tag="top")
    export(backlog, tag="all-unique")

    # 6. report — per-source counts reflect what we ingested this run (for
    #    operator visibility into which connectors actually produced).
    #    Backlog totals come from the DB.
    backlog_total = len(backlog)
    last_24h = sum(
        1 for j in backlog
        if is_within_hours(j.date_posted_normalized, 24)
    )

    summary = {
        "run_id": run_id,
        "started_at_utc": started_at.isoformat(),
        "total_fetched": all_parsed_count,
        "total_unique": len(all_unique),
        "total_exported": len(top),
        "backlog_total": backlog_total,
        "last_24h": last_24h,
        "per_source": per_source_unique,
        "failed_sources": failed_sources,
        "duplicates_removed": dup_count_total,
        "classification_counts": classification_counts,
        "marked_removed": sweep_counts,
        "target": args.target,
        "export_files": {k: str(v) for k, v in exports.items()},
    }
    write_report(summary)
    storage.finish_run(
        run_id,
        {
            "total_fetched": summary["total_fetched"],
            "total_unique": summary["total_unique"],
            "total_exported": summary["total_exported"],
            "per_source": summary["per_source"],
            "failed_sources": summary["failed_sources"],
            "duplicates_removed": summary["duplicates_removed"],
            "classification_counts": summary["classification_counts"],
            "notes": f"target={args.target} backlog={backlog_total} last_24h={last_24h}",
        },
    )

    print(render_console(summary))
    if len(top) < args.target:
        print(
            f"[warn] only {len(top)} / {args.target} jobs produced. "
            "Consider adding more source company slugs in .env.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception:
        traceback.print_exc()
        sys.exit(1)
