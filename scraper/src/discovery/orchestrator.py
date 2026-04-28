"""Discovery orchestrator.

Runs every strategy for a given source, unions results, optionally validates,
and writes data/companies/<source>.txt. That file is then read by the
registry so the daily pipeline scales to the full discovered surface.
"""
from __future__ import annotations

from pathlib import Path

from config import DATA_DIR
from src.discovery import apify, crawl, employers, github, seed_lists, sitemap, validator
from src.logging_config import get_logger
from src.sources.jobpulse_import import load_targets as jobpulse_load

log = get_logger(__name__)

COMPANIES_DIR = Path(DATA_DIR) / "companies"
COMPANIES_DIR.mkdir(parents=True, exist_ok=True)


def output_path(source: str) -> Path:
    return COMPANIES_DIR / f"{source}.txt"


def discover(source: str, *, validate: bool = True, use_apify: bool = True,
             use_sitemap: bool = True, use_crawl: bool = True,
             use_employers: bool = False) -> list[str]:
    """Run every strategy, union, optionally validate, persist, return.

    ``use_employers`` opts into the employer-domain detector loop
    (``src/discovery/employers.py``). Disabled by default because it
    issues ~50+ outbound fetches on the first call per process;
    callers that want it on should pass ``use_employers=True`` or wrap
    the call for a nightly batch run. Within a single orchestrator run
    the detector is cached, so enabling it for many sources only
    amortizes one detection pass.
    """
    union: set[str] = set()
    counts: dict[str, int] = {}

    for name, producer in [
        ("seed", lambda: seed_lists.seed(source)),
        ("jobpulse", lambda: jobpulse_load(source)),
        ("github", lambda: github.fetch(source)),
        ("crawl", lambda: crawl.crawl(source) if use_crawl else []),
        ("sitemap", lambda: sitemap.fetch(source) if use_sitemap else []),
        ("apify", lambda: apify.fetch(source) if use_apify else []),
        ("employers", lambda: employers.slugs_for_source(source) if use_employers else []),
    ]:
        try:
            found = producer() or []
        except Exception as e:
            log.warning("discovery.strategy_error", source=source, strategy=name, error=str(e))
            found = []
        counts[name] = len(found)
        for s in found:
            s_clean = s.strip()
            if s_clean:
                union.add(s_clean)

    slugs = sorted(union, key=str.lower)
    log.info("discovery.union", source=source, total=len(slugs), by_strategy=counts)

    if validate:
        slugs = validator.validate(source, slugs)

    # persist
    path = output_path(source)
    path.write_text("\n".join(slugs) + ("\n" if slugs else ""), encoding="utf-8")
    log.info("discovery.saved", source=source, path=str(path), kept=len(slugs))
    return slugs


def load_from_disk(source: str) -> list[str]:
    path = output_path(source)
    if not path.exists():
        return []
    return [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
