"""Real-Supabase smoke test for chunked, parallel save_raw.

The regression we're guarding against: before chunking, save_raw sent
one unchunked upsert of every raw payload for a source, which on
greenhouse (~56K records) produced a ~1 GB HTTP body and a multi-hour
stall. This script writes ~1,500 synthetic raw payloads to
``scraper_jobs_raw``, confirms they land, and cleans up.

Requires SUPABASE_URL + SUPABASE_KEY (service role) in the environment.
"""
from __future__ import annotations

import os
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.supabase_storage import SupabaseStorage  # noqa: E402


def main() -> int:
    if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_KEY"):
        print("[smoke] SKIP - SUPABASE_URL/SUPABASE_KEY not set")
        return 0

    run_id = uuid.uuid4().hex[:10]
    source = f"smoke_{run_id}"  # unique so we can cleanup without trampling real data

    recs = [
        {"id": f"{run_id}-{i}", "title": f"Role {i}", "blob": "x" * 128}
        for i in range(1_500)   # 3 chunks at SAVE_RAW_CHUNK=500
    ]
    store = SupabaseStorage()

    t0 = time.perf_counter()
    n = store.save_raw(source, recs)
    elapsed = time.perf_counter() - t0
    print(f"[smoke] save_raw wrote {n} rows in {elapsed:.2f}s")

    # Verify — count rows at this source_platform tag.
    got = (
        store._client.table("scraper_jobs_raw")
        .select("source_platform", count="exact")
        .eq("source_platform", source)
        .execute()
    )
    count = getattr(got, "count", None)
    print(f"[smoke] verified {count} rows present for source={source}")

    # Cleanup.
    store._client.table("scraper_jobs_raw").delete().eq(
        "source_platform", source
    ).execute()
    print("[smoke] cleaned up test rows")

    ok = (n >= 1_500) and (count == 1_500) and (elapsed < 30.0)
    if ok:
        print(f"[smoke] PASS - save_raw chunked {len(recs)} rows in {elapsed:.2f}s")
        return 0
    print(f"[smoke] FAIL - n={n} count={count} elapsed={elapsed:.2f}s")
    return 1


if __name__ == "__main__":
    sys.exit(main())
