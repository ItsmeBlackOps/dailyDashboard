"""Smoke-test: ingest() survives prod-scale concurrent load without silent drops.

The 2026-04-20 greenhouse run sent 5,274 unique rows into ingest() and
only 1,000 landed in scraper_jobs_clean. _run_chunks logged 11 of 11
upsert chunks failed with WinError 10035 / ConnectionTerminated, but
those failures were masked as "best-effort" so ingest() returned
success.

This smoke test synthesizes MORE rows than that prod run (5,500) and
proves that with the retry + lowered-concurrency fix, every single row
lands.

Run:  python scripts/smoke_ingest_resilience.py
"""
from __future__ import annotations

import os
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.models import JobPosting
from src.normalizer import compute_content_hash
from src.supabase_storage import SupabaseStorage


SMOKE_PLATFORM = "smoke_ingest_resilience"
N_JOBS = 5_500


def _synth(run_id: str, i: int) -> JobPosting:
    j = JobPosting(
        job_title=f"Resilience Engineer {i:05d}",
        company_name=f"ResilienceCo {i % 163}",
        location="New York, NY",
        source_platform=SMOKE_PLATFORM,
        source_url=f"https://smoke.example.com/{run_id}/{i}",
        source_job_id=f"{run_id}-{i}",
        # Give each row a meaningful description to match real greenhouse
        # payload sizes (~4-8 KB typical). This is what triggered the
        # WSAEWOULDBLOCK at the socket layer in prod.
        full_job_description=(
            f"Resilience smoke role {i} in run {run_id}. " +
            ("Responsibilities include building robust, concurrent systems. "
             * 40)
        ),
    )
    j.content_hash = compute_content_hash(j)
    return j


def main() -> int:
    if not (os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_KEY")):
        print("ERROR: SUPABASE_URL and SUPABASE_KEY must be set (load .env).")
        return 2

    store = SupabaseStorage()
    run_id = uuid.uuid4().hex[:8]

    print(f"[smoke] run_id={run_id}  N_JOBS={N_JOBS}  synthesizing ...")
    jobs = [_synth(run_id, i) for i in range(N_JOBS)]

    print(f"[smoke] calling ingest() against {os.getenv('SUPABASE_URL')} ...")
    t0 = time.perf_counter()
    counts = store.ingest(jobs)
    elapsed = time.perf_counter() - t0
    print(f"[smoke] ingest() returned in {elapsed:.2f}s  counts={counts}")

    import httpx
    base = os.getenv("SUPABASE_URL").rstrip("/") + "/rest/v1/scraper_jobs_clean"
    auth = {
        "apikey": os.getenv("SUPABASE_KEY"),
        "Authorization": f"Bearer {os.getenv('SUPABASE_KEY')}",
    }

    # Exact-count via content-range (NOT capped at PostgREST default 1000).
    r = httpx.get(
        base,
        headers={**auth, "Prefer": "count=exact", "Range": "0-0"},
        params={"source_platform": f"eq.{SMOKE_PLATFORM}",
                "select": "canonical_key"},
        timeout=30.0,
    )
    cr = r.headers.get("content-range", "")
    landed = int(cr.rsplit("/", 1)[-1]) if "/" in cr else -1
    print(f"[smoke] supabase has {landed} rows for source_platform={SMOKE_PLATFORM}")

    # Cleanup
    dr = httpx.delete(
        base,
        headers={**auth, "Prefer": "return=minimal"},
        params={"source_platform": f"eq.{SMOKE_PLATFORM}"},
        timeout=120.0,
    )
    print(f"[smoke] cleanup delete status={dr.status_code}")

    if landed != N_JOBS:
        print(
            f"[smoke] FAIL - expected {N_JOBS} rows to land, got {landed}. "
            f"Lost {N_JOBS - landed} rows silently."
        )
        return 1
    print(
        f"[smoke] PASS - all {N_JOBS} rows landed in {elapsed:.2f}s. "
        f"Retry+concurrency fix verified under prod-scale load."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
