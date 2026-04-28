"""Ablation study: which filter is killing recall on 24h Senior DE search?

Drops one filter at a time from the title-only baseline (mode A) to see
which one is the dominant restriction. Cost ~$0.50 total at limit=200.
"""
from __future__ import annotations
import json, os, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from apify_client import ApifyClient  # noqa

ACTOR_ID = "fantastic-jobs/career-site-job-listing-api"
TITLES = [
    "Senior Data Engineer:*", "Staff Data Engineer:*", "Data Engineer:*",
    "Analytics Engineer:*", "Data Platform Engineer:*",
    "Streaming Data Engineer:*", "Lead Data Engineer:*",
    "ETL Developer:*", "Big Data Engineer:*",
]
BASE = {
    "limit": 200, "timeRange": "24h", "includeAi": True,
    "includeLinkedIn": False, "descriptionType": "text", "removeAgency": True,
    "titleSearch": TITLES,
    "locationSearch": ["United States"],
    "aiEmploymentTypeFilter": ["FULL_TIME", "CONTRACTOR"],
    "aiWorkArrangementFilter": ["On-site", "Hybrid", "Remote OK", "Remote Solely"],
    "aiExperienceLevelFilter": ["2-5", "5-10"],
}

def variant(name: str, mutate) -> dict:
    ri = dict(BASE)
    mutate(ri)
    return {"name": name, "input": ri}

VARIANTS = [
    variant("baseline_all_filters", lambda ri: None),
    variant("drop_location", lambda ri: ri.pop("locationSearch", None)),
    variant("drop_experience", lambda ri: ri.pop("aiExperienceLevelFilter", None)),
    variant("drop_employment", lambda ri: ri.pop("aiEmploymentTypeFilter", None)),
    variant("drop_work_arrangement", lambda ri: ri.pop("aiWorkArrangementFilter", None)),
    variant("drop_remove_agency", lambda ri: ri.update({"removeAgency": False})),
    variant("widen_to_7d", lambda ri: ri.update({"timeRange": "7d"})),
]

def run(c, v):
    t0 = time.monotonic()
    try:
        run = c.actor(ACTOR_ID).call(run_input=v["input"])
        items = list(c.dataset(run["defaultDatasetId"]).iterate_items())
    except Exception as e:
        return {**v, "count": 0, "elapsed_s": 0, "error": str(e)}
    return {**v, "count": len(items), "elapsed_s": round(time.monotonic()-t0, 1)}

def main():
    c = ApifyClient(os.environ["APIFY_TOKEN"])
    print(f"{'variant':30s} | {'count':>5s} | {'elapsed':>7s}")
    print("-" * 55)
    results = []
    for v in VARIANTS:
        r = run(c, v)
        print(f"{r['name']:30s} | {r['count']:>5d} | {r['elapsed_s']:>6.1f}s")
        results.append(r)
    out = ROOT / "data" / "samples" / "filter_ablation.json"
    out.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print(f"\nwrote {out}")

if __name__ == "__main__":
    sys.exit(main())
