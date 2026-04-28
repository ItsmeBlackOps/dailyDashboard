"""Empirical comparison of titleSearch vs descriptionSearch vs both.

Runs the fantastic-jobs/career-site-job-listing-api actor three times
with identical filters, varying only the search method:
  A) titleSearch only           (the actor's recommended primary filter)
  B) descriptionSearch only     (slower, hits title + body)
  C) titleSearch + descriptionSearch  (intersection — both must match)

Reports counts, dedup overlap, latency, and a sample of titles per mode.
Uses Syona Jaimy's resume profile (Senior Data Engineer) as the test
candidate.

Requires APIFY_TOKEN in env. Cost: ~$1.50 total at ~500 results × 3 runs.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apify_client import ApifyClient  # noqa: E402

ACTOR_ID = "fantastic-jobs/career-site-job-listing-api"

TITLES = [
    "Senior Data Engineer:*",
    "Staff Data Engineer:*",
    "Data Engineer:*",
    "Analytics Engineer:*",
    "Data Platform Engineer:*",
    "Streaming Data Engineer:*",
    "Lead Data Engineer:*",
    "ETL Developer:*",
    "Big Data Engineer:*",
]
DESCRIPTIONS = ["spark", "dbt", "kafka", "snowflake"]

COMMON: dict[str, Any] = {
    "limit": 500,
    "timeRange": "24h",
    "includeAi": True,
    "includeLinkedIn": False,
    "descriptionType": "text",
    "removeAgency": True,
    # locationSearch removed — was a literal token match that missed
    # most US jobs (location strings are "City, State, United States").
    # We rely on country post-filter on countries_derived[] instead.
    "aiEmploymentTypeFilter": ["FULL_TIME", "CONTRACTOR"],
    "aiWorkArrangementFilter": ["On-site", "Hybrid", "Remote OK", "Remote Solely"],
    "aiExperienceLevelFilter": ["2-5", "5-10"],
}

MODES = {
    "A_title_only": {**COMMON, "titleSearch": TITLES},
    "B_desc_only": {**COMMON, "descriptionSearch": DESCRIPTIONS},
    "C_both": {**COMMON, "titleSearch": TITLES, "descriptionSearch": DESCRIPTIONS},
}


def run_mode(client: ApifyClient, name: str, run_input: dict) -> dict:
    print(f"\n>>> Running {name}…")
    t0 = time.monotonic()
    actor = client.actor(ACTOR_ID)
    try:
        run = actor.call(run_input=run_input)
    except Exception as e:
        print(f"    FAIL: {e}")
        return {"name": name, "count": 0, "elapsed_s": 0, "ids": [], "error": str(e)}
    elapsed = time.monotonic() - t0
    ds = client.dataset(run["defaultDatasetId"])
    raw_items = list(ds.iterate_items())
    # Apply US country post-filter (mirrors FantasticJobsScraper default).
    items = [it for it in raw_items
             if any("united states" in str(c).lower()
                    for c in (it.get("countries_derived") or []))]
    ids = [str(it.get("id") or "") for it in items if it.get("id")]
    titles = [it.get("title") for it in items[:8]]
    print(f"    raw={len(raw_items)} after_us_filter={len(items)}")
    print(f"    count={len(items)}  elapsed={elapsed:.1f}s")
    for t in titles:
        print(f"      • {t}")
    return {
        "name": name,
        "count": len(items),
        "elapsed_s": round(elapsed, 2),
        "ids": ids,
        "sample_titles": titles,
    }


def main() -> int:
    if not os.getenv("APIFY_TOKEN"):
        print("APIFY_TOKEN not set", file=sys.stderr)
        return 2
    client = ApifyClient(os.environ["APIFY_TOKEN"])

    results = {name: run_mode(client, name, ri) for name, ri in MODES.items()}

    a, b, c = results["A_title_only"], results["B_desc_only"], results["C_both"]
    set_a = set(a["ids"])
    set_b = set(b["ids"])

    print("\n" + "=" * 70)
    print(f"{'mode':25s} | {'count':>6s} | {'elapsed':>8s}")
    print("-" * 70)
    for r in results.values():
        print(f"{r['name']:25s} | {r['count']:>6d} | {r['elapsed_s']:>7.1f}s")
    print()
    print(f"|A union B|     unique-jobs combined pool:        {len(set_a | set_b)}")
    print(f"|A intersect B| jobs in both title- and desc-only: {len(set_a & set_b)}")
    print(f"|A minus B|     title-only NOT in desc-only:       {len(set_a - set_b)}")
    print(f"|B minus A|     desc-only NOT in title-only:       {len(set_b - set_a)}")
    print(f"C count={c['count']} (should approximate |A intersect B| if actor ANDs)")

    out_dir = ROOT / "data" / "samples"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "search_mode_comparison.json"
    out_path.write_text(json.dumps({
        "actor": ACTOR_ID,
        "common_filters": COMMON,
        "titles_used": TITLES,
        "descriptions_used": DESCRIPTIONS,
        "results": results,
        "overlap": {
            "A_intersect_B": len(set_a & set_b),
            "A_minus_B": len(set_a - set_b),
            "B_minus_A": len(set_b - set_a),
            "A_union_B": len(set_a | set_b),
        },
    }, indent=2, default=str), encoding="utf-8")
    print(f"\nwrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
