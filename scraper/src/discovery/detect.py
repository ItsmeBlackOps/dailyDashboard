"""ATS platform detector.

Given an employer domain or a careers-page URL, figure out which ATS is
hosting their jobs — or return `None` if the site is custom (and therefore
a candidate for the generic schema.org JSON-LD fallback extractor).

Signal hierarchy (matches ``docs/ATS_FINGERPRINTS.md``):

    URL pattern   > script/iframe src > window-global > meta-generator >
    CNAME/DOM class

The detector is deliberately conservative: we only claim a platform when at
least one *high-confidence* signal fires. Everything else falls through to
the JSON-LD fallback, where the connector-less extractor still gets us the
job. This avoids false routings that would silently drop real postings.

Runs fully offline given a fetched HTML body; the `detect_domain` helper
does the actual HTTP for convenience.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urljoin, urlparse

from src.http_client import HttpClient
from src.logging_config import get_logger

log = get_logger(__name__)

# --- URL-based detectors (highest confidence) --------------------------------
# Each entry: (platform, regex on URL, slug-group-index). Matched against the
# *final* URL after redirects.
#
# ``slug-group-index`` semantics:
#   - positive int N: slug = m.group(N) — the common single-capture case
#   - 0: no slug extracted (platform only)
#   - tuple of ints (N1, N2, …): slug = "/".join(m.group(Ni)) — composite
#     slugs for platforms with multi-part tenant identifiers (e.g. UKG's
#     ``tenant/uuid`` pair). The connector is responsible for splitting.
_URL_PATTERNS: list[tuple[str, re.Pattern[str], object]] = [
    ("greenhouse", re.compile(r"https?://(?:job-)?boards(?:\.eu)?\.greenhouse\.io/(?:embed/job_board\?for=)?([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})"), 1),
    ("greenhouse", re.compile(r"https?://boards-api\.greenhouse\.io/v1/boards/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})"), 1),
    ("lever", re.compile(r"https?://jobs(?:\.eu)?\.lever\.co/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})"), 1),
    ("ashby", re.compile(r"https?://jobs\.ashbyhq\.com/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})"), 1),
    ("smartrecruiters", re.compile(r"https?://(?:jobs|careers)\.smartrecruiters\.com/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})"), 1),
    ("workable", re.compile(r"https?://apply\.workable\.com/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})"), 1),
    ("workday", re.compile(r"https?://([a-zA-Z0-9][a-zA-Z0-9\-]{0,50})\.wd[0-9]{1,2}\.myworkdayjobs\.com"), 1),
    ("icims", re.compile(r"https?://(?:careers-)?([a-zA-Z0-9][a-zA-Z0-9\-]{0,50})\.icims\.com"), 1),
    ("taleo", re.compile(r"https?://([a-zA-Z0-9][a-zA-Z0-9\-]{0,50})\.taleo\.net"), 1),
    # Oracle RC: the fully-qualified tenant is (host, region, site). The
    # specific pattern (with ``/sites/{site}/`` path) wins first — that
    # captures the usable 3-part slug. The bare-host pattern that follows is
    # a fallback for employer URLs that landed on the Oracle domain without
    # the CandidateExperience path yet (still a confidence-3 ATS hit, but
    # the connector can't call the API without the site).
    ("oracle_rc", re.compile(
        r"https?://([a-zA-Z0-9\-]+)\.fa\.([a-z0-9]+)\.oraclecloud\.com"
        r"/hcmUI/CandidateExperience/[a-z]{2,5}/sites/([a-zA-Z0-9_\-]+)"
    ), (1, 2, 3)),
    ("oracle_rc", re.compile(r"https?://([a-zA-Z0-9\-]+)\.fa\.[a-z0-9]+\.oraclecloud\.com"), 1),
    ("successfactors", re.compile(r"https?://(?:career[0-9]{0,2}\.(?:successfactors|sapsf)\.com)/career\?company=([a-zA-Z0-9_\-]+)"), 1),
    ("successfactors", re.compile(r"https?://([a-zA-Z0-9\-]+)\.jobs\.hr\.cloud\.sap"), 1),
    ("phenom", re.compile(r"https?://([a-zA-Z0-9\-]+)\.phenompeople\.com"), 1),
    ("eightfold", re.compile(r"https?://([a-zA-Z0-9\-]+)\.eightfold\.ai"), 1),
    ("jobvite", re.compile(r"https?://jobs\.jobvite\.com/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})"), 1),
    ("jobvite", re.compile(r"https?://app\.jobvite\.com/CompanyJobs/Careers\.aspx\?c=([a-zA-Z0-9]+)", re.IGNORECASE), 1),
    ("bamboohr", re.compile(r"https?://([a-zA-Z0-9\-]+)\.bamboohr\.com"), 1),
    ("paylocity", re.compile(r"https?://(?:\d+)?recruiting\.paylocity\.com/recruiting/jobs/All/([0-9a-fA-F\-]+)"), 1),
    ("jazzhr", re.compile(r"https?://([a-zA-Z0-9\-]+)\.(?:applytojob|jazz|theresumator)\.(?:com|co)"), 1),
    ("recruitee", re.compile(r"https?://([a-zA-Z0-9\-]+)\.recruitee\.com"), 1),
    ("teamtailor", re.compile(r"https?://([a-zA-Z0-9\-]+)\.teamtailor\.com"), 1),
    ("personio", re.compile(r"https?://([a-zA-Z0-9\-]+)\.jobs\.personio\.(?:de|com)"), 1),
    ("ukg", re.compile(r"https?://recruiting[0-9]?\.ultipro\.com/([a-zA-Z0-9]+)/JobBoard/([0-9a-fA-F\-]+)"), (1, 2)),
    # Dayforce (Ceridian) URL families — in priority order:
    #   1) ``{tenant}.dayforcehcm.com/CandidatePortal/{locale}/{tenant}/`` —
    #      own-subdomain tenant (older/larger customers). The ``\1``
    #      backreference requires subdomain == path-tenant, so this pattern
    #      fires *only* on the own-subdomain case and emits the bare tenant.
    #   2) ``{shard}.dayforcehcm.com/CandidatePortal/{locale}/{tenant}/`` —
    #      shared-shard host (shard != tenant, e.g. ``us58``). The bare
    #      pattern doesn't try to pin shard==tenant, so it matches on the
    #      leftover (2 groups joined with ``/``). The connector's
    #      ``_split_slug`` accepts both ``shard:tenant`` (config form)
    #      and ``shard/tenant`` (detect form).
    #   3) ``jobs.dayforcehcm.com/{tenant}`` — legacy aggregate host.
    ("dayforce", re.compile(
        r"https?://([a-zA-Z0-9\-]+)\.dayforcehcm\.com"
        r"/CandidatePortal/[A-Za-z\-]{2,10}/\1(?:/|\b)"
    ), 1),
    ("dayforce", re.compile(
        r"https?://([a-zA-Z0-9\-]+)\.dayforcehcm\.com"
        r"/CandidatePortal/[A-Za-z\-]{2,10}/([a-zA-Z0-9_\-]+)"
    ), (1, 2)),
    ("dayforce", re.compile(r"https?://jobs\.dayforcehcm\.com/([a-zA-Z0-9]+)"), 1),
    ("rippling", re.compile(r"https?://ats\.rippling\.com/([a-zA-Z0-9\-]+)"), 1),
]

# --- HTML-embedded signals (script src, iframe src, inline JS, meta) ---------
_EMBED_SIGNALS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("greenhouse", re.compile(r"boards\.greenhouse\.io/embed/job_board(?:\.js)?\?for=([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})")),
    ("greenhouse", re.compile(r"window\.Grnhse\b")),
    ("greenhouse", re.compile(r'id=["\']grnhse_app["\']')),
    ("lever", re.compile(r"jobs\.lever\.co/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})")),
    ("lever", re.compile(r"data-lever-jobs")),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})/embed")),
    ("ashby", re.compile(r'id=["\']ashby_embed["\']')),
    ("smartrecruiters", re.compile(r'id=["\']sr-jobs["\']')),
    ("smartrecruiters", re.compile(r"careers\.smartrecruiters\.com/([A-Za-z0-9][A-Za-z0-9\-_]{0,80})")),
    ("workable", re.compile(r'class=["\']workable-widget["\']')),
    ("workable", re.compile(r'apply\.workable\.com/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})')),
    ("workday", re.compile(r"\.myworkdayjobs\.com/")),
    ("icims", re.compile(r"iCIMS_PageFoundation")),
    ("icims", re.compile(r"careers-([a-zA-Z0-9\-]+)\.icims\.com")),
    ("taleo", re.compile(r"taleo\.net/careersection", re.IGNORECASE)),
    ("oracle_rc", re.compile(r"/hcmRestApi/resources/[^\"'\s]*recruitingCEJobRequisitions", re.IGNORECASE)),
    ("successfactors", re.compile(r"career[0-9]{0,2}\.(?:successfactors|sapsf)\.com/career\?company=")),
    ("successfactors", re.compile(r"jobs\.hr\.cloud\.sap")),
    ("phenom", re.compile(r"window\.phApp\b")),
    ("phenom", re.compile(r"phenompeople\.com")),
    ("eightfold", re.compile(r"\.eightfold\.ai/careers")),
    ("eightfold", re.compile(r'id=["\']pcs-body-container["\']')),
    ("jobvite", re.compile(r"jobs\.jobvite\.com/([a-zA-Z0-9][a-zA-Z0-9\-_]{0,80})")),
    ("bamboohr", re.compile(r'([a-zA-Z0-9\-]+)\.bamboohr\.com/(?:jobs|careers)')),
    ("paylocity", re.compile(r"recruiting\.paylocity\.com/recruiting/jobs")),
    ("jazzhr", re.compile(r'([a-zA-Z0-9\-]+)\.applytojob\.com')),
    ("recruitee", re.compile(r'([a-zA-Z0-9\-]+)\.recruitee\.com')),
    ("teamtailor", re.compile(r'<meta\s+name=["\']generator["\']\s+content=["\']Teamtailor', re.IGNORECASE)),
    ("teamtailor", re.compile(r'([a-zA-Z0-9\-]+)\.teamtailor\.com')),
    ("personio", re.compile(r'([a-zA-Z0-9\-]+)\.jobs\.personio\.(?:de|com)')),
    ("ukg", re.compile(r"recruiting[0-9]?\.ultipro\.com/")),
    ("dayforce", re.compile(r"jobs\.dayforcehcm\.com/")),
    ("rippling", re.compile(r"ats\.rippling\.com/")),
)

# JSON-LD presence is not a platform by itself — it's the generic fallback.
_JSONLD_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)

# Paths an employer's careers page commonly lives under.
_CANDIDATE_PATHS: tuple[str, ...] = (
    "/careers", "/careers/", "/jobs", "/jobs/",
    "/about/careers", "/company/careers", "/careers/jobs",
    "/join", "/join-us", "/career",
)


@dataclass
class DetectionResult:
    """One platform guess for a domain.

    ``confidence`` is ordinal:
      3 = URL match (strongest)
      2 = script/iframe src or known window global
      1 = weak DOM / meta hint
      0 = no platform, JSON-LD was present (use generic extractor)
     -1 = unreachable or no signal at all
    """
    domain: str
    platform: Optional[str]
    slug: Optional[str]
    confidence: int
    final_url: Optional[str] = None
    has_jsonld: bool = False
    notes: Optional[str] = None

    @property
    def should_use_generic_fallback(self) -> bool:
        return self.platform is None and self.has_jsonld


# ----------------------------------------------------------------------------
# Core scanners — no HTTP inside these, so they are unit-testable standalone.
# ----------------------------------------------------------------------------

def detect_from_url(url: str) -> Optional[tuple[str, Optional[str]]]:
    """If the URL itself matches a known ATS host pattern, return (platform, slug).

    For platforms whose tenant identifier is multi-part (e.g. UKG's
    ``{tenant}/{uuid}`` path), ``group_idx`` is a tuple and the returned slug
    is the captures joined with ``/`` — connectors split on that separator.
    """
    if not url:
        return None
    for platform, pat, group_idx in _URL_PATTERNS:
        m = pat.search(url)
        if not m:
            continue
        slug: Optional[str] = None
        try:
            if isinstance(group_idx, tuple):
                parts = [m.group(i) for i in group_idx]
                if all(parts):
                    slug = "/".join(parts)
            elif isinstance(group_idx, int) and group_idx > 0:
                slug = m.group(group_idx)
        except IndexError:
            slug = None
        return platform, slug
    return None


def detect_from_html(html: str, base_url: str = "") -> list[tuple[str, Optional[str], int]]:
    """Scan an HTML body for embedded ATS signals.

    Returns a list of (platform, slug_or_none, confidence) candidates,
    strongest first, de-duplicated by platform.

    ``base_url`` is used only to resolve relative iframe/script srcs; absent
    that, absolute hrefs still match fine.
    """
    if not html:
        return []
    hits: dict[str, tuple[Optional[str], int]] = {}
    for platform, pat in _EMBED_SIGNALS:
        m = pat.search(html)
        if not m:
            continue
        slug: Optional[str] = None
        # Only the first capture group (when present) is the slug candidate.
        if m.groups():
            g = m.group(1)
            if g and len(g) <= 80:
                slug = g
        # URL-style patterns outrank pure DOM-class/meta ones. We approximate
        # that by letting `greenhouse/embed/job_board?for=` (captures slug)
        # score higher than `id=grnhse_app` (no slug).
        conf = 2 if slug else 1
        prev = hits.get(platform)
        if prev is None or conf > prev[1] or (conf == prev[1] and slug and not prev[0]):
            hits[platform] = (slug, conf)
    # Order: highest confidence first; slug-bearing before no-slug.
    ordered = sorted(
        hits.items(),
        key=lambda kv: (-kv[1][1], 0 if kv[1][0] else 1, kv[0]),
    )
    return [(plat, slug, conf) for plat, (slug, conf) in ordered]


def has_jsonld_jobposting(html: str) -> bool:
    """Quick check: does this HTML advertise a schema.org JobPosting?"""
    if not html:
        return False
    for m in _JSONLD_RE.finditer(html):
        blob = m.group(1)
        if "JobPosting" in blob:
            return True
    return False


# ----------------------------------------------------------------------------
# Convenience — actually go fetch the domain.
# ----------------------------------------------------------------------------

def _normalize_domain(domain_or_url: str) -> str:
    d = domain_or_url.strip()
    if not d:
        return ""
    if not d.startswith(("http://", "https://")):
        d = "https://" + d
    p = urlparse(d)
    return f"{p.scheme}://{p.netloc}"


def detect_domain(
    domain_or_url: str,
    *,
    http: Optional[HttpClient] = None,
    paths: tuple[str, ...] = _CANDIDATE_PATHS,
) -> DetectionResult:
    """Fetch a domain's careers page(s) and report the detected ATS, if any.

    We try ``/careers`` first (most common) and fall back through the
    ``paths`` tuple. The first URL that returns HTML is scanned. Caller
    should reuse an ``HttpClient`` when checking many domains.
    """
    base = _normalize_domain(domain_or_url)
    if not base:
        return DetectionResult(domain=domain_or_url, platform=None, slug=None, confidence=-1, notes="empty domain")
    own = http is None
    client = http or HttpClient(timeout=15.0)
    try:
        # 1. Short-circuit: the input is already an ATS-hosted URL.
        direct = detect_from_url(domain_or_url)
        if direct:
            plat, slug = direct
            return DetectionResult(
                domain=base,
                platform=plat,
                slug=slug,
                confidence=3,
                final_url=domain_or_url,
                notes="url-pattern",
            )

        for path in paths:
            url = urljoin(base + "/", path.lstrip("/"))
            resp = client.get(url)
            if resp is None:
                continue
            # Follow-redirect may have landed us on an ATS host directly.
            final = str(resp.url)
            from_final = detect_from_url(final)
            if from_final:
                plat, slug = from_final
                return DetectionResult(
                    domain=base,
                    platform=plat,
                    slug=slug,
                    confidence=3,
                    final_url=final,
                    notes="redirect-to-ats",
                )
            if resp.status_code != 200 or not resp.text:
                continue
            body = resp.text
            embed_hits = detect_from_html(body, base_url=final)
            jsonld = has_jsonld_jobposting(body)
            if embed_hits:
                plat, slug, conf = embed_hits[0]
                return DetectionResult(
                    domain=base,
                    platform=plat,
                    slug=slug,
                    confidence=conf,
                    final_url=final,
                    has_jsonld=jsonld,
                    notes="html-embed",
                )
            if jsonld:
                return DetectionResult(
                    domain=base,
                    platform=None,
                    slug=None,
                    confidence=0,
                    final_url=final,
                    has_jsonld=True,
                    notes="custom-site-with-jsonld",
                )
        return DetectionResult(domain=base, platform=None, slug=None, confidence=-1, notes="no-signal")
    finally:
        if own:
            client.close()
