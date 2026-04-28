"""Employer-domain discovery — the automated loop that feeds ``detect.py``.

Given a seed list of US employer domains, this module:

    1. For each domain, calls ``discovery.detect.detect_domain()``.
    2. Groups results by platform. For known ATS platforms the emitted
       ``slug`` is written to ``data/companies/<platform>.txt`` — exactly
       the file the registry merges for every daily run.
    3. Domains where the detector found JSON-LD but no ATS (confidence
       ``0``) are written to ``data/companies/custom_jsonld.txt`` so the
       ``CustomJsonLdScraper`` picks them up on the next run.
    4. Domains with no signal (``-1``) are written to
       ``data/companies/unknown_domains.txt`` for operator review.

The result is the closed loop the user requested: a seed of employer
domains auto-classifies into per-platform slugs that the existing ATS
connectors then scrape programmatically — no hand-written config needed
per employer.

Compliance: each domain is fetched politely via the shared HttpClient
(per-host throttle + retries + rotating UA). The detector runs fully
client-side after the fetch, and pages that don't want to be read
(robots.txt / WAF) either 403 or redirect — in which case the detector
reports ``-1`` and we log+skip.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

from config import DATA_DIR
from src.discovery.detect import DetectionResult, detect_domain
from src.http_client import HttpClient
from src.logging_config import get_logger

log = get_logger(__name__)

COMPANIES_DIR = Path(DATA_DIR) / "companies"
COMPANIES_DIR.mkdir(parents=True, exist_ok=True)

# Placeholder files for the non-platform buckets.
CUSTOM_JSONLD_FILE = COMPANIES_DIR / "custom_jsonld.txt"
UNKNOWN_DOMAINS_FILE = COMPANIES_DIR / "unknown_domains.txt"


@dataclass
class EmployerDiscoveryReport:
    """Summary of one discovery pass over a domain list."""

    checked: int = 0
    by_platform: dict[str, list[str]] = field(default_factory=dict)
    custom_jsonld: list[str] = field(default_factory=list)
    unknown: list[str] = field(default_factory=list)

    def add(self, result: DetectionResult) -> None:
        self.checked += 1
        if result.platform and result.slug:
            self.by_platform.setdefault(result.platform, []).append(result.slug)
        elif result.has_jsonld and result.final_url:
            self.custom_jsonld.append(result.final_url)
        else:
            self.unknown.append(result.domain)

    def summary(self) -> dict[str, int]:
        out = {"checked": self.checked,
               "custom_jsonld": len(self.custom_jsonld),
               "unknown": len(self.unknown)}
        for plat, slugs in self.by_platform.items():
            out[plat] = len(slugs)
        return out


def discover_from_domains(
    domains: Iterable[str],
    *,
    concurrency: int = 8,
    http: Optional[HttpClient] = None,
) -> EmployerDiscoveryReport:
    """Run the detector over every domain, return a merged report.

    Threaded up to ``concurrency`` because the detector is I/O-bound
    (one to three HTTP fetches per domain). HttpClient is shared so
    per-host throttling still applies — distinct hosts run in parallel,
    same-host requests still serialize.
    """
    owned = http is None
    client = http or HttpClient(timeout=15.0)
    report = EmployerDiscoveryReport()
    # De-dupe before submitting so the same domain doesn't fire twice.
    seen: set[str] = set()
    unique: list[str] = []
    for d in domains:
        d = (d or "").strip()
        if not d:
            continue
        key = d.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(d)

    try:
        with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
            futs = {pool.submit(detect_domain, d, http=client): d for d in unique}
            for fut in as_completed(futs):
                domain = futs[fut]
                try:
                    result = fut.result()
                except Exception as e:
                    log.warning("employer.detect_error", domain=domain, error=str(e)[:200])
                    continue
                report.add(result)
    finally:
        if owned:
            client.close()

    log.info("employer.discovery_done", **report.summary())
    return report


def persist_report(
    report: EmployerDiscoveryReport,
    *,
    merge: bool = True,
) -> dict[str, Path]:
    """Write the per-platform slug files the registry already consumes.

    ``merge=True`` reads any existing slugs out of each file and unions
    them with the new ones (case-insensitive). This is the right default
    because discovery accumulates — one pass shouldn't nuke prior work.
    """
    written: dict[str, Path] = {}
    # Platform slugs
    for platform, slugs in report.by_platform.items():
        path = COMPANIES_DIR / f"{platform}.txt"
        merged = _merge_existing(path, slugs) if merge else _unique_sorted(slugs)
        path.write_text("\n".join(merged) + ("\n" if merged else ""), encoding="utf-8")
        written[platform] = path
    # Custom JSON-LD URLs
    if report.custom_jsonld:
        merged = _merge_existing(CUSTOM_JSONLD_FILE, report.custom_jsonld) if merge else _unique_sorted(report.custom_jsonld)
        CUSTOM_JSONLD_FILE.write_text("\n".join(merged) + ("\n" if merged else ""), encoding="utf-8")
        written["custom_jsonld"] = CUSTOM_JSONLD_FILE
    # Unknown — operator review queue
    if report.unknown:
        merged = _merge_existing(UNKNOWN_DOMAINS_FILE, report.unknown) if merge else _unique_sorted(report.unknown)
        UNKNOWN_DOMAINS_FILE.write_text("\n".join(merged) + ("\n" if merged else ""), encoding="utf-8")
        written["unknown"] = UNKNOWN_DOMAINS_FILE
    return written


# ---------- internals ------------------------------------------------------

def _merge_existing(path: Path, new: list[str]) -> list[str]:
    existing: list[str] = []
    if path.exists():
        existing = [
            ln.strip()
            for ln in path.read_text(encoding="utf-8").splitlines()
            if ln.strip()
        ]
    return _unique_sorted(existing + list(new))


def _unique_sorted(xs: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in xs:
        s = x.strip()
        if not s:
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return sorted(out, key=str.lower)


# Hand-seeded US employer domains for out-of-the-box use. Deliberately
# broad (public tech + industrials) so at least one of the 22 supported
# ATS platforms fires on most of them. Operators can extend via the
# EMPLOYER_DOMAINS env var (CSV).
DEFAULT_EMPLOYER_DOMAINS: tuple[str, ...] = (
    # Household-name tech
    "stripe.com", "airbnb.com", "openai.com", "anthropic.com", "datadoghq.com",
    "databricks.com", "snowflake.com", "cloudflare.com", "figma.com", "notion.so",
    "vercel.com", "hashicorp.com", "gitlab.com", "github.com",
    # Large consumer / fintech
    "doordash.com", "instacart.com", "affirm.com", "brex.com", "ramp.com",
    "robinhood.com", "coinbase.com", "plaid.com", "chime.com",
    # Fortune 500 industrials (often on Workday / SF / Eightfold)
    "capitalone.com", "walmart.com", "target.com", "bestbuy.com", "cisco.com",
    "vmware.com", "dell.com", "hp.com", "ibm.com", "intel.com",
    "amd.com", "nvidia.com", "salesforce.com", "servicenow.com", "workday.com",
    # Retail / brands
    "warbyparker.com", "peloton.com", "allbirds.com", "glossier.com",
    # Health / bio
    "tempus.com", "flatiron.com", "23andme.com", "ginkgobioworks.com",
    # Media / entertainment
    "netflix.com", "spotify.com", "roblox.com", "unity.com", "epicgames.com",
)


def default_domains_from_env(extra_env: str = "EMPLOYER_DOMAINS") -> list[str]:
    """Load the default seed + any ``EMPLOYER_DOMAINS`` CSV from env."""
    import os

    merged: list[str] = list(DEFAULT_EMPLOYER_DOMAINS)
    extra = (os.getenv(extra_env) or "").strip()
    if extra:
        merged.extend(s.strip() for s in extra.split(",") if s.strip())
    return _unique_sorted(merged)


# ---------- orchestrator integration -------------------------------------
#
# The orchestrator runs strategies per source — (source) -> list[str] slugs.
# But the detector naturally produces a per-platform mapping *once* for a
# given domain batch. So we cache the first invocation per process and
# serve per-source reads from the cache.

_CACHED_REPORT: Optional[EmployerDiscoveryReport] = None


def reset_cache() -> None:
    """Drop the cached report (tests + manual re-discovery)."""
    global _CACHED_REPORT
    _CACHED_REPORT = None


def get_or_run_report(
    domains: Optional[Iterable[str]] = None,
    *,
    http: Optional[HttpClient] = None,
) -> EmployerDiscoveryReport:
    """Return the cached report, or run discovery once and cache it.

    The first call runs ``discover_from_domains`` against the caller-
    supplied ``domains`` (or ``default_domains_from_env()`` if omitted)
    and caches the report module-globally. Subsequent calls — including
    across different sources in the same orchestrator run — reuse it.
    Use ``reset_cache()`` to force re-discovery.
    """
    global _CACHED_REPORT
    if _CACHED_REPORT is None:
        seed = list(domains) if domains is not None else default_domains_from_env()
        _CACHED_REPORT = discover_from_domains(seed, http=http)
    return _CACHED_REPORT


def slugs_for_source(
    source: str,
    *,
    domains: Optional[Iterable[str]] = None,
    http: Optional[HttpClient] = None,
) -> list[str]:
    """Return ATS slugs discovered for ``source`` from the employer seed.

    Wrapper that the orchestrator calls per source. Runs (or reuses) the
    cached detector pass and returns the per-platform slug list.
    """
    report = get_or_run_report(domains=domains, http=http)
    return list(report.by_platform.get(source, []))
