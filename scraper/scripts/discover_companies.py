"""CLI: discover and validate company slugs for every source.

Usage:
    python scripts/discover_companies.py
    python scripts/discover_companies.py --source greenhouse lever
    python scripts/discover_companies.py --no-validate           # faster, noisier
    python scripts/discover_companies.py --no-apify              # skip Apify
    python scripts/discover_companies.py --no-sitemap            # skip sitemap probing

Outputs: data/companies/<source>.txt — one live slug per line.
The daily run_daily.py automatically unions these into the connectors.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.discovery.orchestrator import discover  # noqa: E402
from src.logging_config import configure_logging  # noqa: E402

# Every slug-consuming connector with a seed tuple in
# ``src/discovery/seed_lists.py::SEEDS``. Adding a source here lets an
# operator run ``python scripts/discover_companies.py --source <name>``
# to populate ``data/companies/<name>.txt``, which the registry then
# unions into the connector at daily-run time.
#
# API-aggregator connectors (``adzuna``, ``usajobs``, ``remoteok``) and
# the URL-driven ``custom_jsonld`` connector are intentionally absent —
# they don't take per-employer slugs. ``test_discover_cli.py`` pins
# this invariant so it doesn't drift again.
SUPPORTED = (
    "greenhouse", "lever", "ashby", "smartrecruiters", "workable",
    "workday", "icims", "recruitee", "personio", "jobvite",
    "jazzhr", "eightfold", "rippling", "teamtailor", "successfactors",
    "bamboohr", "paylocity", "ukg", "oracle_rc", "dayforce",
)


def main() -> int:
    configure_logging()
    p = argparse.ArgumentParser()
    p.add_argument("--source", nargs="*", choices=SUPPORTED, default=list(SUPPORTED))
    p.add_argument("--no-validate", action="store_true")
    p.add_argument("--no-apify", action="store_true")
    p.add_argument("--no-sitemap", action="store_true")
    p.add_argument("--no-crawl", action="store_true")
    args = p.parse_args()

    totals: dict[str, int] = {}
    for src in args.source:
        slugs = discover(
            src,
            validate=not args.no_validate,
            use_apify=not args.no_apify,
            use_sitemap=not args.no_sitemap,
            use_crawl=not args.no_crawl,
        )
        totals[src] = len(slugs)

    print("\nDiscovered company slugs (after validation):")
    for src, n in totals.items():
        print(f"  {src:<16} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
