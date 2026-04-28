"""Centralized runtime configuration loaded from env vars."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
EXPORT_DIR = DATA_DIR / "exports"
REPORT_DIR = DATA_DIR / "reports"
LOG_DIR = ROOT / "logs"

for _d in (DATA_DIR, RAW_DIR, EXPORT_DIR, REPORT_DIR, LOG_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def _csv(name: str) -> list[str]:
    raw = os.getenv(name, "") or ""
    return [s.strip() for s in raw.split(",") if s.strip()]


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


# --------------------------------------------------------------------------
# US IT job taxonomy.
#
# The filter runs in two stages:
#   1. title must contain a TARGET_IT_KEYWORDS token (broad substring match)
#   2. title must NOT contain a TITLE_EXCLUSIONS token (leadership/sales/non-tech)
#
# TARGET_TITLES is kept for backwards-compat with the original narrow
# "data analyst" profile — set JOB_FILTER_MODE=narrow to use it, or
# JOB_FILTER_MODE=it (default) for the broad US IT taxonomy.
# --------------------------------------------------------------------------

# Narrow profile — original data-analyst-only use case.
TARGET_TITLES: tuple[str, ...] = (
    "data analyst",
    "junior data analyst",
    "business data analyst",
    "reporting analyst",
    "product analyst",
    "bi analyst",
    "business intelligence analyst",
    "sql analyst",
    "analytics analyst",
)

# Broad US IT taxonomy — any title containing one of these substrings is
# considered a US IT candidate. Deliberately broad; the exclusion list below
# trims out leadership, sales-adjacent, and non-technical variants.
TARGET_IT_KEYWORDS: tuple[str, ...] = (
    # Software engineering
    "software engineer", "software developer", "backend", "back-end", "back end",
    "frontend", "front-end", "front end", "full stack", "fullstack", "full-stack",
    "mobile engineer", "ios engineer", "android engineer", "web developer",
    "application developer", "embedded engineer", "firmware engineer",
    "systems engineer", "systems developer", "platform engineer",
    "distributed systems", "backend developer", "frontend developer",
    # Data
    "data engineer", "data analyst", "data scientist", "analytics engineer",
    "bi analyst", "business intelligence", "reporting analyst", "business analyst",
    "product analyst", "marketing analyst", "quant", "quantitative analyst",
    "analytics analyst", "sql analyst", "etl developer", "data architect",
    "data modeler", "database engineer", "database administrator", "dba",
    # ML / AI
    "machine learning", "ml engineer", "ai engineer", "mlops", "ml ops",
    "applied scientist", "research engineer", "research scientist",
    "nlp engineer", "computer vision", "perception engineer", "robotics engineer",
    "ai researcher", "llm engineer", "llm researcher", "ai safety",
    # DevOps / SRE / cloud / platform
    "devops", "dev ops", "site reliability", "sre", "platform engineer",
    "infrastructure engineer", "cloud engineer", "cloud architect",
    "solutions architect", "systems architect", "network engineer",
    "kubernetes engineer", "linux engineer", "production engineer",
    "reliability engineer", "release engineer", "build engineer", "tooling engineer",
    # Security
    "security engineer", "cybersecurity", "cyber security", "appsec",
    "application security", "infosec", "security analyst", "threat analyst",
    "detection engineer", "incident response", "offensive security",
    "penetration tester", "red team", "blue team", "vulnerability", "grc analyst",
    "iam engineer", "identity engineer", "cryptography engineer",
    # QA / test
    "qa engineer", "quality engineer", "test engineer", "sdet",
    "automation engineer", "test automation", "qa analyst", "qa tester",
    # Product / technical product
    "technical program manager", "tpm", "technical product manager",
    "developer advocate", "developer experience", "devrel",
    # IT infra / support / sysadmin (clearly IT)
    "it engineer", "it administrator", "it admin", "systems administrator",
    "sysadmin", "help desk", "service desk", "desktop support", "it support",
    "it specialist", "network administrator", "it operations", "itops",
    "technical support engineer",
)

# Tokens that, if present, disqualify a job even if it fuzzy-matched a target.
# Pruned for IT scope: leadership (VP/director/head-of), sales-engineering,
# non-tech adjacent roles, and the leadership+IC overlap (principal/staff are
# allowed IC roles in IT, so we do NOT exclude them in 'it' mode).
TITLE_EXCLUSIONS: tuple[str, ...] = (
    "manager,",  # trailing comma trick: only bare "manager" w/ comma
    "director",
    "vp ", "vice president",
    "head of",
    "chief ",  # CTO, CISO, CIO — titles, not IC work
    # sales / marketing adjacency that mentions "engineer" but isn't IC engineering
    "sales engineer", "solutions engineer", "pre-sales", "presales",
    "account executive", "customer success", "customer support",
    "recruiter", "recruiting coordinator", "sourcer",
    # clearly non-IT roles that fuzzy-match on "analyst"
    "financial analyst", "credit analyst", "risk analyst", "policy analyst",
    "legal analyst", "compliance analyst", "operations analyst",
    "logistics analyst", "supply chain analyst", "hr analyst",
    # Academic / teaching positions
    "professor", "lecturer", "tenure", "adjunct",
    # internship / non-FT unless specifically requested
    # (kept as info-only — not excluded here)
)

# Narrow mode exclusions (original project scope)
TITLE_EXCLUSIONS_NARROW: tuple[str, ...] = (
    "manager", "director", "vp", "head of", "principal", "staff",
    "lead data analyst", "engineer", "scientist", "machine learning", "ml ",
)


def _resolve_db_url(url: str) -> str:
    """Return a SQLAlchemy-compatible URL.

    Prisma Accelerate URLs (prisma+postgres://...) are not understood by
    SQLAlchemy. When DATABASE_URL is set to one (common in Next.js/Prisma
    projects), fall back to the local SQLite database so the scraper still runs.
    The direct Postgres URL can be provided via DATABASE_URL_POSTGRE instead.
    """
    if url.startswith("prisma+"):
        direct = os.getenv("DATABASE_URL_POSTGRE", "")
        if direct:
            if direct.startswith("postgres://"):
                direct = direct.replace("postgres://", "postgresql+psycopg2://", 1)
            return direct
        return f"sqlite:///{DATA_DIR / 'jobs.db'}"
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    return url


@dataclass(frozen=True)
class Settings:
    timezone: str = os.getenv("TIMEZONE", "America/New_York")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    recency_hours: int = _int("RECENCY_HOURS", 168)
    recency_overrides: dict[str, int] = field(default_factory=lambda: {
        k.removeprefix("RECENCY_HOURS_").lower(): int(v)
        for k, v in os.environ.items()
        if k.startswith("RECENCY_HOURS_") and v.strip().isdigit()
    })
    target_count: int = _int("TARGET_JOB_COUNT", 100)
    country_filter: str = os.getenv("COUNTRY_FILTER", "US")
    # "it" — broad US IT taxonomy (default); "narrow" — original data-analyst profile.
    job_filter_mode: str = os.getenv("JOB_FILTER_MODE", "it")
    request_timeout: float = _float("REQUEST_TIMEOUT_SECONDS", 20.0)
    max_retries: int = _int("REQUEST_MAX_RETRIES", 3)
    base_backoff: float = _float("REQUEST_BASE_BACKOFF_SECONDS", 1.5)
    # Retention window for ``jobs_raw`` (audit table). Rows older than this
    # are deleted by ``Storage.prune_raw`` at the end of every daily run.
    # Default 14 days balances "useful forensic window" against SQLite
    # bloat — at 1M rows/day with no cap, ``data/jobs.db`` had grown to
    # 8+ GB before the dedupe-and-prune fix landed. Set RAW_TTL_DAYS=0
    # to disable pruning (not recommended).
    raw_ttl_days: int = _int("RAW_TTL_DAYS", 14)

    database_url: str = field(default_factory=lambda: _resolve_db_url(
        os.getenv("DATABASE_URL", "sqlite:///./data/jobs.db")
    ))

    usajobs_api_key: str = os.getenv("USAJOBS_API_KEY", "")
    usajobs_user_agent: str = os.getenv("USAJOBS_USER_AGENT", "")
    adzuna_app_id: str = os.getenv("ADZUNA_APP_ID", "")
    adzuna_app_key: str = os.getenv("ADZUNA_APP_KEY", "")

    greenhouse_boards: list[str] = field(default_factory=lambda: _csv("GREENHOUSE_BOARDS"))
    lever_companies: list[str] = field(default_factory=lambda: _csv("LEVER_COMPANIES"))
    ashby_companies: list[str] = field(default_factory=lambda: _csv("ASHBY_COMPANIES"))
    smartrecruiters_companies: list[str] = field(default_factory=lambda: _csv("SMARTRECRUITERS_COMPANIES"))
    workable_companies: list[str] = field(default_factory=lambda: _csv("WORKABLE_COMPANIES"))
    # Workday tenants are "tenant:wdN:site" triples, e.g.
    #   nvidia:wd5:NVIDIAExternalCareerSite
    workday_tenants: list[str] = field(default_factory=lambda: _csv("WORKDAY_TENANTS"))
    # iCIMS tenants are the subdomain portion of careers-{X}.icims.com
    icims_companies: list[str] = field(default_factory=lambda: _csv("ICIMS_COMPANIES"))
    # Tellent/Recruitee — subdomain slug of {X}.recruitee.com
    recruitee_companies: list[str] = field(default_factory=lambda: _csv("RECRUITEE_COMPANIES"))
    # Personio — subdomain slug of {X}.jobs.personio.com (or .de)
    personio_companies: list[str] = field(default_factory=lambda: _csv("PERSONIO_COMPANIES"))
    # Jobvite — entries may be "slug" (modern) or "legacy:{code}" (legacy XML feed)
    jobvite_companies: list[str] = field(default_factory=lambda: _csv("JOBVITE_COMPANIES"))
    # JazzHR — subdomain slug of {X}.applytojob.com
    jazzhr_companies: list[str] = field(default_factory=lambda: _csv("JAZZHR_COMPANIES"))
    # Eightfold — subdomain slug of {X}.eightfold.ai
    eightfold_tenants: list[str] = field(default_factory=lambda: _csv("EIGHTFOLD_TENANTS"))
    # Rippling ATS — subdomain slug of ats.rippling.com/{X}
    rippling_companies: list[str] = field(default_factory=lambda: _csv("RIPPLING_COMPANIES"))
    # Teamtailor — subdomain slug of {X}.teamtailor.com
    teamtailor_companies: list[str] = field(default_factory=lambda: _csv("TEAMTAILOR_COMPANIES"))
    # Custom-JSON-LD — list of career-page URLs (prefix with "index:" for
    # index-follow mode).  Operator-curated.
    custom_jsonld_urls: list[str] = field(default_factory=lambda: _csv("CUSTOM_JSONLD_URLS"))
    # SAP SuccessFactors — companyId; prefix "N:" to pin the shard
    # (e.g. "10:acme" → career10.successfactors.com). Bare entries probe
    # shards 1..10.
    successfactors_companies: list[str] = field(default_factory=lambda: _csv("SUCCESSFACTORS_COMPANIES"))
    # BambooHR — subdomain slug of {X}.bamboohr.com/careers
    bamboohr_companies: list[str] = field(default_factory=lambda: _csv("BAMBOOHR_COMPANIES"))
    # Paylocity — tenant UUID (the GUID from the iframe URL
    # recruiting.paylocity.com/Recruiting/Jobs/All/{UUID}). Each tenant
    # is one UUID; bare dashes are preserved as-is.
    paylocity_companies: list[str] = field(default_factory=lambda: _csv("PAYLOCITY_COMPANIES"))
    # UKG UltiPro — composite ``TENANT/UUID`` (optionally ``SHARD|TENANT/UUID``).
    # Example: ``USG1006/11111111-2222-3333-4444-555555555555`` or
    # ``2|abc123/deadbeef-0000-0000-0000-000000000000``.
    ukg_companies: list[str] = field(default_factory=lambda: _csv("UKG_COMPANIES"))
    # Oracle Recruiting Cloud — composite ``host/region/site``.
    # Example: ``ecqj/us2/CX`` (means https://ecqj.fa.us2.oraclecloud.com
    # with siteNumber=CX).
    oracle_rc_companies: list[str] = field(default_factory=lambda: _csv("ORACLE_RC_COMPANIES"))
    # Dayforce (Ceridian) — bare tenant slug ``acme`` (uses
    # ``acme.dayforcehcm.com``) or ``SHARD:tenant`` pinned form
    # (e.g. ``us58:mycompany`` → ``us58.dayforcehcm.com``).
    dayforce_companies: list[str] = field(default_factory=lambda: _csv("DAYFORCE_COMPANIES"))

    # LinkedIn (Apify actor silentflow/linkedin-jobs-scraper-ppr).
    # Disabled when LINKEDIN_SEARCH_QUERIES is empty.
    linkedin_search_queries: list[str] = field(default_factory=lambda: _csv("LINKEDIN_SEARCH_QUERIES"))
    linkedin_max_jobs: int = _int("LINKEDIN_MAX_JOBS", 100)
    linkedin_location: str = os.getenv("LINKEDIN_LOCATION", "")
    linkedin_days: int = _int("LINKEDIN_DAYS", 7)
    # fantastic-jobs/advanced-linkedin-job-search-api inputs:
    linkedin_titles: list[str] = field(default_factory=lambda: _csv("LINKEDIN_TITLES"))
    linkedin_locations: list[str] = field(default_factory=lambda: _csv("LINKEDIN_LOCATIONS"))
    linkedin_descriptions: list[str] = field(default_factory=lambda: _csv("LINKEDIN_DESCRIPTIONS"))
    linkedin_time_range: str = os.getenv("LINKEDIN_TIME_RANGE", "7d")
    linkedin_remote_only: bool = os.getenv("LINKEDIN_REMOTE_ONLY", "false").lower() in ("1", "true", "yes")
    linkedin_include_ai: bool = os.getenv("LINKEDIN_INCLUDE_AI", "true").lower() in ("1", "true", "yes")
    linkedin_seniority: list[str] = field(default_factory=lambda: _csv("LINKEDIN_SENIORITY"))
    linkedin_employment: list[str] = field(default_factory=lambda: _csv("LINKEDIN_EMPLOYMENT"))
    linkedin_exclude_ats_dup: bool = os.getenv("LINKEDIN_EXCLUDE_ATS_DUP", "false").lower() in ("1", "true", "yes")

    # Fantastic Jobs (Apify actor fantastic-jobs/career-site-job-listing-api).
    # Source skipped when titles + descriptions + locations are all empty.
    fantastic_jobs_titles: list[str] = field(default_factory=lambda: _csv("FANTASTIC_JOBS_TITLES"))
    fantastic_jobs_locations: list[str] = field(default_factory=lambda: _csv("FANTASTIC_JOBS_LOCATIONS"))
    fantastic_jobs_descriptions: list[str] = field(default_factory=lambda: _csv("FANTASTIC_JOBS_DESCRIPTIONS"))
    # 0 means "no operator-set cap" — scraper falls back to actor max (5000).
    fantastic_jobs_max: int = _int("FANTASTIC_JOBS_MAX", 0)
    # "auto" tries 1h then falls back to 24h. Or set 1h|24h|7d|6m explicitly.
    fantastic_jobs_time_range: str = os.getenv("FANTASTIC_JOBS_TIME_RANGE", "auto")
    fantastic_jobs_remote_only: bool = os.getenv("FANTASTIC_JOBS_REMOTE_ONLY", "false").lower() in ("1", "true", "yes")
    fantastic_jobs_include_ai: bool = os.getenv("FANTASTIC_JOBS_INCLUDE_AI", "true").lower() in ("1", "true", "yes")
    fantastic_jobs_include_linkedin: bool = os.getenv("FANTASTIC_JOBS_INCLUDE_LINKEDIN", "false").lower() in ("1", "true", "yes")
    fantastic_jobs_description_type: str = os.getenv("FANTASTIC_JOBS_DESCRIPTION_TYPE", "text")
    fantastic_jobs_remove_agency: bool = os.getenv("FANTASTIC_JOBS_REMOVE_AGENCY", "true").lower() in ("1", "true", "yes")
    fantastic_jobs_ats: list[str] = field(default_factory=lambda: _csv("FANTASTIC_JOBS_ATS"))
    fantastic_jobs_employment_type: list[str] = field(default_factory=lambda: _csv("FANTASTIC_JOBS_EMPLOYMENT_TYPE"))
    fantastic_jobs_work_arrangement: list[str] = field(default_factory=lambda: _csv("FANTASTIC_JOBS_WORK_ARRANGEMENT"))
    fantastic_jobs_experience_levels: list[str] = field(default_factory=lambda: _csv("FANTASTIC_JOBS_EXPERIENCE_LEVELS"))
    fantastic_jobs_visa_sponsorship: bool = os.getenv("FANTASTIC_JOBS_VISA_SPONSORSHIP", "false").lower() in ("1", "true", "yes")
    # Country post-filter on parsed countries_derived[] — case-insensitive
    # substring match. Default: "United States" so daily runs default to US
    # jobs without paying the locationSearch literal-match penalty.
    fantastic_jobs_country: str = os.getenv("FANTASTIC_JOBS_COUNTRY", "United States")


settings = Settings()
