"""Crawl well-known public GitHub repos + aggregators that link to ATS boards,
then regex-extract tenant slugs per source.

Every URL fetched here is a PUBLIC, compliant raw file (README.md / listings.json
/ HN "Who is Hiring?" archives) — no auth, no scraping of rendered apps. We
match canonical ATS URL patterns:

    boards.greenhouse.io/<slug>
    job-boards.greenhouse.io/<slug>
    jobs.lever.co/<slug>
    jobs.ashbyhq.com/<slug>
    jobs.smartrecruiters.com/<slug>      (+ careers.smartrecruiters.com/<slug>)
    apply.workable.com/<slug>

Two crawl inputs:
    DEFAULT_CRAWL_URLS      — fetched directly and regex-scanned
    SITEMAP_EXPANSION_URLS  — fetched first, every <loc> URL in the returned
                              XML is then added to the crawl queue (lets us
                              pull 300+ HN hiring threads with one seed URL)

Extra URLs can be appended via env var CRAWL_SLUG_URLS (comma-separated).
"""
from __future__ import annotations

import os
import re
from typing import Iterable

from src.http_client import HttpClient
from src.logging_config import get_logger

log = get_logger(__name__)

# Canonical public aggregators / job-list repos. All are static raw files —
# no API keys, no TOS tripwires.
DEFAULT_CRAWL_URLS: tuple[str, ...] = (
    # SimplifyJobs — current curated JSON + rendered README (each catches different slugs)
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2025-Internships/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2025-Internships/dev/README.md",
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
    # Historical SimplifyJobs — prior year still lists hundreds of active boards
    "https://raw.githubusercontent.com/SimplifyJobs/Summer2024-Internships/dev/.github/scripts/listings.json",
    # cvrve / ouckah (fork families of SimplifyJobs with distinct entries)
    "https://raw.githubusercontent.com/ouckah/Summer2025-Internships/main/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/cvrve/Summer2025-Internships/main/.github/scripts/listings.json",
    # vanshb03 — very active 2025/2026 trackers
    "https://raw.githubusercontent.com/vanshb03/Summer2026-Internships/main/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/vanshb03/New-Grad-2025/main/.github/scripts/listings.json",
    "https://raw.githubusercontent.com/vanshb03/New-Grad-2026/main/README.md",
    # SpeedyApply trackers
    "https://raw.githubusercontent.com/speedyapply/2025-SWE-College-Jobs/main/README.md",
    "https://raw.githubusercontent.com/speedyapply/2025-AI-College-Jobs/main/README.md",
    "https://raw.githubusercontent.com/speedyapply/2025-AI-ML-Internships/main/README.md",
    # jobright-ai trackers
    "https://raw.githubusercontent.com/jobright-ai/2025-Software-Engineer-Internship/master/README.md",
    "https://raw.githubusercontent.com/jobright-ai/2025-Data-Analysis-Internship/master/README.md",
    # ReaVNaiL — new-grad 2024 compendium
    "https://raw.githubusercontent.com/ReaVNaiL/New-Grad-2024/main/README.md",
    # Remote-first companies (many link out to Greenhouse/Lever/Ashby)
    "https://raw.githubusercontent.com/remoteintech/remote-jobs/main/README.md",
    "https://raw.githubusercontent.com/lukasz-madon/awesome-remote-job/master/README.md",
    # Curated "best companies" type lists
    "https://raw.githubusercontent.com/poteto/hiring-without-whiteboards/master/README.md",
    "https://raw.githubusercontent.com/jnv/lists/master/README.md",
    "https://raw.githubusercontent.com/tramcar/awesome-job-boards/master/README.md",
)

# URLs whose response is treated as a sitemap — every <loc> inside is pulled
# in as a secondary crawl target. HN "Who is Hiring?" archives are a goldmine:
# one sitemap → ~300 monthly threads → ~50 ATS URLs per thread.
SITEMAP_EXPANSION_URLS: tuple[str, ...] = (
    "https://hnhiring.com/sitemap.xml",
)
_LOC_RE = re.compile(r"<loc>([^<]+)</loc>", re.IGNORECASE)

# Regex patterns per source. Slug = [a-zA-Z0-9][a-zA-Z0-9-_]* so we don't grab
# trailing query strings or paths.
_SLUG = r"([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})"
PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "greenhouse": [
        re.compile(rf"boards\.greenhouse\.io/embed/job_board\?for={_SLUG}"),
        re.compile(rf"boards\.greenhouse\.io/{_SLUG}"),
        re.compile(rf"job-boards\.greenhouse\.io/{_SLUG}"),
        re.compile(rf"boards-api\.greenhouse\.io/v1/boards/{_SLUG}"),
    ],
    "lever": [
        re.compile(rf"jobs\.lever\.co/{_SLUG}"),
        re.compile(rf"api\.lever\.co/v0/postings/{_SLUG}"),
    ],
    "ashby": [
        re.compile(rf"jobs\.ashbyhq\.com/{_SLUG}"),
        re.compile(rf"api\.ashbyhq\.com/posting-api/job-board/{_SLUG}"),
    ],
    "smartrecruiters": [
        re.compile(rf"jobs\.smartrecruiters\.com/{_SLUG}"),
        re.compile(rf"careers\.smartrecruiters\.com/{_SLUG}"),
        re.compile(rf"api\.smartrecruiters\.com/v1/companies/{_SLUG}"),
    ],
    "workable": [
        re.compile(rf"apply\.workable\.com/{_SLUG}"),
        re.compile(rf"https?://{_SLUG}\.workable\.com"),
    ],
    "recruitee": [
        re.compile(rf"https?://{_SLUG}\.recruitee\.com"),
    ],
    "personio": [
        re.compile(rf"https?://{_SLUG}\.jobs\.personio\.(?:de|com)"),
    ],
    "jobvite": [
        re.compile(rf"https?://jobs\.jobvite\.com/{_SLUG}"),
    ],
    "jazzhr": [
        re.compile(rf"https?://{_SLUG}\.applytojob\.com"),
        re.compile(rf"https?://{_SLUG}\.jazz\.co"),
        re.compile(rf"https?://{_SLUG}\.theresumator\.com"),
    ],
    "eightfold": [
        re.compile(rf"https?://{_SLUG}\.eightfold\.ai"),
    ],
    "rippling": [
        re.compile(rf"https?://ats\.rippling\.com/{_SLUG}"),
    ],
    "teamtailor": [
        re.compile(rf"https?://{_SLUG}\.teamtailor\.com"),
    ],
    "successfactors": [
        # `career{N}.successfactors.com/career?company={X}` (legacy)
        re.compile(rf"career[0-9]{{0,2}}\.successfactors\.com/career\?company={_SLUG}"),
        # `career{N}.sapsf.com/career?company={X}`
        re.compile(rf"career[0-9]{{0,2}}\.sapsf\.com/career\?company={_SLUG}"),
        # `{X}.jobs.hr.cloud.sap/`
        re.compile(rf"https?://{_SLUG}\.jobs\.hr\.cloud\.sap"),
    ],
    "bamboohr": [
        # `{X}.bamboohr.com/jobs` or `.bamboohr.com/careers`
        re.compile(rf"https?://{_SLUG}\.bamboohr\.com/(?:jobs|careers)"),
    ],
    "paylocity": [
        # `recruiting.paylocity.com/recruiting/jobs/All/{UUID}` — the
        # tenant GUID is the slug. Accept dashed or bare hex.
        re.compile(r"recruiting\.paylocity\.com/(?:[Rr]ecruiting)/[Jj]obs/[Aa]ll/([0-9a-fA-F][0-9a-fA-F\-]{7,63})"),
    ],
    "ukg": [
        # `recruiting{N}.ultipro.com/{TENANT}/JobBoard/{UUID}` — the tenant
        # and UUID together form the composite slug (``TENANT/UUID``).
        # Two capture groups → joined with `/` by _extract's multi-group path.
        re.compile(
            r"https?://recruiting[0-9]?\.ultipro\.com/"
            r"([a-zA-Z0-9]+)/JobBoard/([0-9a-fA-F][0-9a-fA-F\-]{7,63})"
        ),
    ],
    "oracle_rc": [
        # `{host}.fa.{region}.oraclecloud.com/.../sites/{site}/...` — the
        # composite slug is ``host/region/site`` (3 parts, slash-joined in
        # _extract from the three capture groups).
        re.compile(
            r"https?://"
            r"([a-zA-Z0-9\-]+)\.fa\.([a-z0-9]+)\.oraclecloud\.com"
            r"/hcmUI/CandidateExperience/[a-z]{2,5}/sites/([a-zA-Z0-9_\-]+)"
        ),
    ],
    "dayforce": [
        # `{tenant}.dayforcehcm.com/CandidatePortal/{locale}/{tenant}/...`
        # — own-subdomain tenants (older / larger customers). The
        # backreference ``\1`` pins subdomain == path-tenant so we only
        # emit the well-known "own-subdomain" case here; shared-shard
        # tenants (``us58.dayforcehcm.com``) aren't guessable from public
        # aggregators and flow in via env var / the discovery pipeline's
        # direct URL crawl (which writes SHARD:tenant slugs).
        re.compile(
            r"https?://([a-zA-Z0-9\-]+)\.dayforcehcm\.com"
            r"/CandidatePortal/[A-Za-z\-]{2,10}/\1/Posting"
        ),
        # `jobs.dayforcehcm.com/{tenant}/...` — legacy aggregate host,
        # single tenant segment.
        re.compile(
            r"https?://jobs\.dayforcehcm\.com/([a-zA-Z0-9_\-]+)"
        ),
    ],
}

# Noise tokens that match the regex but are not real tenants.
_BAD_SLUGS = {
    "embed", "api", "v1", "v0", "jobs", "job", "board", "boards",
    "posting", "postings", "posting-api", "for", "j", "www", "help",
    "oops", "search", "apply", "widget", "widgets", "assets",
}


def _crawl_urls() -> list[str]:
    urls: list[str] = list(DEFAULT_CRAWL_URLS)
    extra = (os.getenv("CRAWL_SLUG_URLS") or "").strip()
    if extra:
        urls.extend(u.strip() for u in extra.split(",") if u.strip())
    # de-dupe, preserve order
    seen: set[str] = set()
    uniq: list[str] = []
    for u in urls:
        if u in seen:
            continue
        seen.add(u)
        uniq.append(u)
    return uniq


def _extract(source: str, text: str) -> set[str]:
    """Extract ATS tenant slugs from ``text``.

    Single-group patterns emit ``m.group(1)`` directly. Multi-group patterns
    (UKG ``TENANT/UUID``, Oracle RC ``host/region/site``) join all captured
    groups with ``/`` to form a composite slug — the same convention used by
    ``src/discovery/detect.py``.
    """
    found: set[str] = set()
    for pat in PATTERNS.get(source, []):
        for m in pat.finditer(text):
            groups = m.groups()
            if not groups:
                continue
            if len(groups) == 1:
                slug = (groups[0] or "").strip()
            else:
                parts = [(g or "").strip() for g in groups]
                if any(not p for p in parts):
                    continue
                slug = "/".join(parts)
            if not slug or slug.lower() in _BAD_SLUGS:
                continue
            found.add(slug)
    return found


def _expand_sitemaps(http: HttpClient, sitemap_urls: Iterable[str]) -> list[str]:
    """Fetch each sitemap URL and return every <loc> entry inside."""
    expanded: list[str] = []
    for sm in sitemap_urls:
        resp = http.get(sm)
        if resp is None or resp.status_code != 200 or not resp.text:
            log.info("crawl.sitemap_miss", url=sm, status=getattr(resp, "status_code", None))
            continue
        locs = [m.group(1).strip() for m in _LOC_RE.finditer(resp.text)]
        log.info("crawl.sitemap_expanded", url=sm, found=len(locs))
        expanded.extend(locs)
    return expanded


def crawl(source: str, *, urls: Iterable[str] | None = None) -> list[str]:
    """Fetch each URL once, extract ATS slugs for `source`, return dedup list."""
    base_urls = list(urls) if urls is not None else _crawl_urls()
    http = HttpClient(timeout=30.0)
    slugs: set[str] = set()
    try:
        # Expand sitemap seeds (HN hiring archive etc.) into hundreds of pages.
        sitemap_extra = _expand_sitemaps(http, SITEMAP_EXPANSION_URLS) if urls is None else []
        target_urls: list[str] = []
        seen: set[str] = set()
        for u in list(base_urls) + sitemap_extra:
            if not u or u in seen:
                continue
            seen.add(u)
            target_urls.append(u)
        if not target_urls:
            return []
        for url in target_urls:
            resp = http.get(url)
            if resp is None or resp.status_code != 200 or not resp.text:
                log.info("crawl.miss", url=url, status=getattr(resp, "status_code", None))
                continue
            hits = _extract(source, resp.text)
            if hits:
                log.info("crawl.hit", url=url, source=source, found=len(hits))
            slugs.update(hits)
    finally:
        http.close()
    return sorted(slugs)
