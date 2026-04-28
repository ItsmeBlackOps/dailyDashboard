"""Smoke-test: verify SupabaseStorage.ingest() parallelizes at the HTTP layer.

Unit tests in tests/test_supabase_ingest_parallel.py pin the concurrency
*contract* with a fake client. This script pins the real thing: fire
~500 synthetic rows through the real Supabase HTTP endpoint and assert
the whole round-trip finishes well under the old serial baseline.

Why needed: the live greenhouse run's throughput is gated by an upstream
post_filter CPU stall on 56K jobs (unrelated to ingest). Waiting for it
to clear just to validate ingest would take hours. This test short-
circuits: synthesize rows in-memory, call ingest() against real Supabase,
prove rows land, clean up.

Run:  python scripts/smoke_parallel_ingest.py
"""
from __future__ import annotations

import os
import sys
import time
import uuid

# Allow `python scripts/smoke_parallel_ingest.py` from repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.models import JobPosting
from src.normalizer import compute_content_hash
from src.supabase_storage import SupabaseStorage


SMOKE_PLATFORM = "smoke_parallel_ingest"
N_JOBS = 500  # enough for ≥1 pre-check chunk (100) and ≥1 upsert chunk (500)


def _synth(run_id: str, i: int) -> JobPosting:
    j = JobPosting(
        job_title=f"Smoke Engineer {i:04d}",
        company_name=f"SmokeCo {i % 23}",
        location="New York, NY",
        source_platform=SMOKE_PLATFORM,
        source_url=f"https://smoke.example.com/{run_id}/{i}",
        source_job_id=f"{run_id}-{i}",
        full_job_description=f"Smoke role {i}. Run {run_id}.",
    )
    j.content_hash = compute_content_hash(j)
    return j


def main() -> int:
    if not (os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_KEY")):
        print("ERROR: SUPABASE_URL and SUPABASE_KEY must be set (e.g. via .env).")
        return 2

    store = SupabaseStorage()
    run_id = uuid.uuid4().hex[:8]

    print(f"[smoke] run_id={run_id} synthesizing {N_JOBS} rows ...")
    jobs = [_synth(run_id, i) for i in range(N_JOBS)]

    print(f"[smoke] calling ingest() against {os.getenv('SUPABASE_URL')} ...")
    t0 = time.perf_counter()
    counts = store.ingest(jobs)
    elapsed = time.perf_counter() - t0

    print(f"[smoke] ingest returned in {elapsed:.2f}s — counts={counts}")

    # Verify rows landed by counting via REST.
    import httpx  # already a project dep via supabase
    url = os.getenv("SUPABASE_URL").rstrip("/") + "/rest/v1/scraper_jobs_clean"
    headers = {
        "apikey": os.getenv("SUPABASE_KEY"),
        "Authorization": f"Bearer {os.getenv('SUPABASE_KEY')}",
        "Prefer": "count=exact",
        "Range": "0-0",
    }
    params = {"source_platform": f"eq.{SMOKE_PLATFORM}", "select": "canonical_key"}
    r = httpx.get(url, headers=headers, params=params, timeout=30.0)
    cr = r.headers.get("content-range", "")
    landed = int(cr.rsplit("/", 1)[-1]) if "/" in cr else -1
    print(f"[smoke] supabase reports {landed} rows with source_platform={SMOKE_PLATFORM}")

    # Cleanup — delete just this smoke's rows.
    del_url = url
    del_params = {"source_platform": f"eq.{SMOKE_PLATFORM}"}
    dr = httpx.delete(del_url, headers={
        "apikey": os.getenv("SUPABASE_KEY"),
        "Authorization": f"Bearer {os.getenv('SUPABASE_KEY')}",
        "Prefer": "return=minimal",
    }, params=del_params, timeout=60.0)
    print(f"[smoke] cleanup delete status={dr.status_code}")

    # Pass/fail decision.
    if landed != N_JOBS:
        print(f"[smoke] FAIL — expected {N_JOBS} rows, got {landed}")
        return 1
    # Old serial code took ~10–15 min on 5K rows → ~1–1.5 min on 500 rows.
    # New parallel code should be under 30s for 500 rows even with slow RTT.
    if elapsed > 60.0:
        print(f"[smoke] FAIL — ingest took {elapsed:.2f}s > 60s budget")
        return 1
    print(f"[smoke] PASS — {N_JOBS} rows ingested in {elapsed:.2f}s, all rows verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
