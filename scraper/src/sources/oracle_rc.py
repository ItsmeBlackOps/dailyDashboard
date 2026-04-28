"""Oracle Recruiting Cloud (Fusion HCM) — public hcmRestApi endpoint.

Oracle's Fusion HCM Recruiting product — branded "Oracle Recruiting
Cloud" — hosts candidate-facing job boards at a three-part URL::

    https://{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/{lang}/sites/{site}/jobs

The browser UI drives its job grid off a REST endpoint that is, by
design, publicly callable for tenants that run an External Candidate
site (no auth required)::

    GET https://{host}.fa.{region}.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions
        ?onlyData=true
        &expand=requisitionList.secondaryLocations,requisitionList.requisitionFlexFields
        &finder=findReqs;siteNumber={site},facetsList=LOCATIONS;CATEGORIES,
                limit=100,offset=0,sortBy=POSTING_DATES_DESC

Response::

    {
      "items": [
        {
          "Id": 12345,
          "Title": "Senior Software Engineer",
          "PrimaryLocation": "Austin, TX",
          "PostedDate": "2026-04-10T00:00:00",
          "ExternalURL": "https://{host}.fa.{region}.oraclecloud.com/.../jobs/{reqId}",
          ...
        },
        ...
      ],
      "count": 100,
      "hasMore": true,
      "limit": 100,
      "offset": 0
    }

Pagination: increment ``offset`` by ``limit`` until ``hasMore=false`` or
``count < limit``. Safety cap of 50 pages matches the UKG connector.

The tenant slug is the composite ``host/region/site`` triple that
``src/discovery/detect.py`` now emits for URLs matching
``{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/…/sites/{site}/…``.
Operators seed rarely (host/region/site isn't guessable); the
employer-discovery loop auto-fills ``data/companies/oracle_rc.txt`` from
real careers-page URLs.

Apply URL is synthesized as
``https://{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/{site}/job/{Id}``
— the canonical detail-page URL the careers widget links to.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted

_PAGE_SIZE = 100
_MAX_PAGES = 50

_API_URL = (
    "https://{host}.fa.{region}.oraclecloud.com/hcmRestApi/resources/latest"
    "/recruitingCEJobRequisitions"
)
_DETAIL_URL = (
    "https://{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience"
    "/en/sites/{site}/job/{req_id}"
)
_CAREERS_URL = (
    "https://{host}.fa.{region}.oraclecloud.com/hcmUI/CandidateExperience"
    "/en/sites/{site}/jobs"
)


class OracleRCScraper(BaseSourceScraper):
    name = "oracle_rc"
    display_name = "Oracle Recruiting Cloud"
    compliance_notes = (
        "Public hcmRestApi endpoint consumed by the Oracle Fusion HCM "
        "Candidate Experience careers widget; no authentication required "
        "for External Candidate sites."
    )

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        # Each entry is the composite slug ``host/region/site``.
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for composite in self.companies:
            host, region, site = _split_slug(composite)
            if not (host and region and site):
                self.log.info("slug.malformed", slug=composite)
                continue
            for raw in self._iter_pages(host, region, site):
                raw["_host"] = host
                raw["_region"] = region
                raw["_site"] = site
                yield raw

    def _iter_pages(self, host: str, region: str, site: str) -> Iterator[dict[str, Any]]:
        base = _API_URL.format(host=host, region=region)
        offset = 0
        for _ in range(_MAX_PAGES):
            # ``finder`` is a semicolon-separated expression — encode exactly
            # as the widget does. Query-param commas in finder are literal.
            finder = (
                f"findReqs;siteNumber={site},facetsList=LOCATIONS;CATEGORIES,"
                f"limit={_PAGE_SIZE},offset={offset},sortBy=POSTING_DATES_DESC"
            )
            params = {
                "onlyData": "true",
                "expand": (
                    "requisitionList.secondaryLocations,"
                    "requisitionList.requisitionFlexFields"
                ),
                "finder": finder,
            }
            resp = self.http.get(
                base,
                params=params,
                headers={
                    "Accept": "application/json, */*;q=0.5",
                    "Referer": _CAREERS_URL.format(host=host, region=region, site=site),
                },
            )
            if not resp or resp.status_code != 200 or not resp.text:
                return
            head = resp.text[:200].lstrip().lower()
            if head.startswith("<"):
                return
            try:
                data = json.loads(resp.text)
            except (json.JSONDecodeError, ValueError):
                return
            items = list(_iter_jobs(data))
            for job in items:
                yield job
            if not items:
                return
            # Oracle ships ``hasMore`` and ``count`` — the canonical signals.
            has_more = data.get("hasMore")
            if has_more is False:
                return
            if len(items) < _PAGE_SIZE:
                return
            offset += _PAGE_SIZE

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = _first(raw, ("Title", "title", "PostingTitle", "postingTitle"))
        if not title:
            return None

        host = str(raw.get("_host") or "")
        region = str(raw.get("_region") or "")
        site = str(raw.get("_site") or "")

        req_id = _first(
            raw,
            ("Id", "id", "RequisitionId", "requisitionId",
             "RequisitionNumber", "requisitionNumber", "Number", "number"),
        )
        apply_url = None
        if host and region and site and req_id is not None and str(req_id).strip():
            apply_url = _DETAIL_URL.format(
                host=host, region=region, site=site, req_id=req_id
            )
        # External URL (if present) wins — Oracle sometimes ships a vanity link.
        external = _first(raw, ("ExternalURL", "externalURL", "ExternalUrl", "externalUrl"))
        if external and isinstance(external, str):
            apply_url = external.strip() or apply_url

        location = _first(
            raw,
            ("PrimaryLocation", "primaryLocation", "Location", "location"),
        )
        secondary = raw.get("secondaryLocations") or raw.get("SecondaryLocations")
        location_str, country = _normalize_location(location, secondary)

        remote_raw = _first(raw, ("WorkplaceType", "workplaceType",
                                   "WorkType", "workType"))
        remote_type = _normalize_remote(remote_raw, location_str)

        department = _first(raw, ("Category", "category", "JobFamily", "jobFamily"))
        employment = _first(raw, ("JobType", "jobType", "WorkerType", "workerType",
                                   "EmploymentCategory", "employmentCategory"))

        posted_raw = _first(
            raw,
            ("PostedDate", "postedDate", "PostingDate", "postingDate",
             "PostingStartDate", "postingStartDate"),
        )
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        description = _first(
            raw,
            ("ExternalDescriptionStr", "externalDescriptionStr",
             "ShortDescription", "shortDescription",
             "Description", "description", "JobDescription", "jobDescription"),
        ) or ""
        snippet = clean_text(description, limit=400) if description else None
        full = clean_text(description) if description else None

        careers_url = None
        if host and region and site:
            careers_url = _CAREERS_URL.format(host=host, region=region, site=site)

        # Oracle's hcmRestApi payload doesn't carry the employer name
        # (a design choice of the Fusion HCM Candidate Experience API),
        # so we synthesize a deterministic company_name from the slug
        # parts. Without this, every parsed posting would ship
        # ``company_name=None`` and crash ingest at the NOT NULL
        # constraint on ``jobs_clean.company_name``. See
        # ``_derive_company_name`` for the precedence rules.
        company_name = _derive_company_name(host, site)

        return JobPosting(
            job_title=str(title).strip(),
            company_name=company_name,
            location=location_str,
            country=country,
            remote_type=remote_type,
            employment_type=str(employment).strip() if employment else None,
            department=str(department).strip() if department else None,
            date_posted_raw=str(posted_raw) if posted_raw else None,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=apply_url or "",
            apply_url=apply_url,
            company_careers_url=careers_url,
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(req_id) if req_id is not None else None,
            requisition_id=str(req_id) if req_id is not None else None,
            raw=raw,
        )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _split_slug(composite: str) -> tuple[str, str, str]:
    """Split ``host/region/site`` into its three parts."""
    if not composite or not isinstance(composite, str):
        return "", "", ""
    parts = [p.strip() for p in composite.strip().split("/") if p.strip()]
    if len(parts) != 3:
        return "", "", ""
    host, region, site = parts
    return host, region, site


def _iter_jobs(data: Any) -> Iterator[dict[str, Any]]:
    """Yield each requisition dict regardless of wrapper shape.

    Shapes observed::

        {"items": [...]}
        {"Items": [...]}
        {"requisitionList": [...]}
        [...]  # rare — bare list
        {"items": [{"requisitionList": [...]}]}  # Oracle's outer-shell layout
    """
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                # Handle the outer-shell variant: first item is a wrapper
                # with ``requisitionList``.
                inner = item.get("requisitionList")
                if isinstance(inner, list) and inner and all(isinstance(x, dict) for x in inner):
                    yield from inner
                else:
                    yield item
        return
    if not isinstance(data, dict):
        return
    for key in ("items", "Items", "requisitionList", "requisitions", "results"):
        bucket = data.get(key)
        if isinstance(bucket, list):
            if bucket and isinstance(bucket[0], dict) and "requisitionList" in bucket[0]:
                # ``items: [{"requisitionList": [...]}]`` outer-shell shape
                for wrapper in bucket:
                    inner = wrapper.get("requisitionList") if isinstance(wrapper, dict) else None
                    if isinstance(inner, list):
                        for item in inner:
                            if isinstance(item, dict):
                                yield item
                return
            for item in bucket:
                if isinstance(item, dict):
                    yield item
            return


def _first(raw: dict[str, Any], keys: tuple[str, ...]) -> Any:
    """Return the first non-empty value for any of ``keys``."""
    for k in keys:
        v = raw.get(k)
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        return v
    return None


def _normalize_location(
    primary: Any, secondary: Any = None
) -> tuple[Optional[str], Optional[str]]:
    """Coerce Oracle RC location payloads into (display_string, country).

    Oracle typically ships a plain string in ``PrimaryLocation`` (e.g.
    ``"Austin, TX, United States"``) with a ``secondaryLocations`` list
    of dicts for multi-site postings.
    """
    if isinstance(primary, str):
        s = primary.strip()
        display = s if s else None
    elif isinstance(primary, dict):
        # Some tenants ship a dict with Name/LocationName.
        name = _first(
            primary, ("Name", "name", "LocationName", "locationName",
                      "PrimaryLocation", "primaryLocation"),
        )
        display = str(name).strip() if name else None
    elif primary is None:
        display = None
    else:
        display = None

    # Append secondary labels if we have them — helps users see
    # multi-location postings at a glance.
    extra_labels: list[str] = []
    if isinstance(secondary, list):
        for loc in secondary[:3]:
            if isinstance(loc, dict):
                nm = _first(loc, ("Name", "name", "LocationName",
                                   "locationName", "PrimaryLocation"))
                if nm:
                    extra_labels.append(str(nm).strip())
            elif isinstance(loc, str) and loc.strip():
                extra_labels.append(loc.strip())
    if extra_labels:
        combined = display or ""
        extra = " / ".join(lbl for lbl in extra_labels if lbl and lbl != combined)
        if combined and extra:
            display = f"{combined} / {extra}"
        elif extra:
            display = extra

    if not display:
        return None, None
    # Detect trailing-country token.
    parts = [p.strip() for p in display.split(",") if p.strip()]
    country = None
    if parts:
        last = parts[-1].upper()
        if last in {"USA", "US", "UNITED STATES"}:
            country = parts[-1]
    return display, country


def _normalize_remote(remote_raw: Any, location_str: Optional[str]) -> Optional[str]:
    """Map Oracle RC remote signals to our canonical ``remote_type``."""
    if isinstance(remote_raw, str):
        r = remote_raw.strip().lower()
        if r in {"remote", "fully remote", "virtual", "telecommute", "work from home", "wfh"}:
            return "remote"
        if r in {"hybrid", "flexible"}:
            return "hybrid"
        if r in {"on-site", "onsite", "in-office", "in office", "office"}:
            return "onsite"
    if location_str:
        low = location_str.lower()
        if "remote" in low or "virtual" in low:
            return "remote"
    return None


# Site names that Oracle tenants universally use as generic candidate-
# experience identifiers rather than brand markers. When we see one of
# these, the ``host`` pod identifier is more discriminating. The set is
# lowercased; comparison is case-insensitive.
_GENERIC_SITE_CODES = frozenset({
    "cx", "ext", "external", "extcareers", "externalcareers",
    "candidate", "candidateexperience", "candidatesite",
    "careers", "careersite", "careers_site",
    "site", "sites", "job", "jobs",
    "default", "main", "global",
})

# Oracle Fusion routinely appends a numeric tenant id to the generic
# candidate-experience identifier: ``CX_1001``, ``cx1001``, ``ext_42``.
# Stripping the trailing ``[_-]?\d+`` before the ``_GENERIC_SITE_CODES``
# test lets these land on the blocklist so _derive_company_name falls
# back to the discriminating host pod. See E.6 in docs/DISCOVERY_SYSTEM.md.
_TENANT_SUFFIX_RE = re.compile(r"[_-]?\d+$")


def _prettify(token: str) -> str:
    """Turn ``ford-careers`` / ``FordCareersSite`` → ``Ford Careers Site``."""
    if not token:
        return ""
    # Insert a space before any uppercase letter that follows a lowercase
    # letter (handles ``FordCareersSite`` → ``Ford Careers Site``).
    import re as _re
    s = _re.sub(r"(?<=[a-z])(?=[A-Z])", " ", token)
    s = s.replace("-", " ").replace("_", " ")
    return " ".join(w.title() for w in s.split() if w)


def _derive_company_name(host: str, site: str) -> Optional[str]:
    """Best-guess employer name from Oracle RC slug parts.

    Precedence:
      1. ``site`` when it looks descriptive — alphanumeric, ≥4 chars, and
         not on the generic-codes blocklist. Site names like
         ``FordCareersSite`` or ``PepsiCoExternal`` carry the brand.
      2. ``host`` as fallback — the Oracle pod identifier (e.g. ``efds``,
         ``ecqj``) is opaque but stable per tenant, which is enough for
         row uniqueness and ingest's NOT NULL constraint.
      3. ``None`` if neither yields anything usable — the storage-layer
         guard then drops the record rather than crashing the run.

    Output is prettified (camelCase / kebab / snake → Title Case) so an
    operator eyeballing ``jobs_clean`` can at least tell tenants apart.
    Determinism is the core invariant: same slug → same company_name,
    across runs, so duplicate detection collapses repeat observations
    onto one row.
    """
    s = (site or "").strip()
    h = (host or "").strip()
    # Normalize for the blocklist check only: strip a trailing numeric
    # tenant suffix (``CX_1001`` → ``CX``, ``cx1001`` → ``cx``) so Oracle
    # Fusion's tenant-stamped candidate-experience shells hit the
    # generic-codes check. _prettify still sees the original slug, so
    # descriptive-with-digits sites like ``FordCareers2024`` are
    # preserved intact.
    s_norm = _TENANT_SUFFIX_RE.sub("", s).lower() if s else ""
    if s and s_norm not in _GENERIC_SITE_CODES and len(s) >= 4:
        pretty = _prettify(s)
        if pretty:
            return pretty
    if h:
        pretty = _prettify(h)
        if pretty:
            return pretty
        return h  # raw host slug — opaque but non-None, preserves NOT NULL
    return "Unknown (Oracle RC)"
