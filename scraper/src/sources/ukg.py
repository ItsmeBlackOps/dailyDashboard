"""UKG / Ultimate (UltiPro Recruiting) — public JobBoard search endpoint.

UKG's UltiPro Recruiting product (formerly Ultimate Software) hosts its
careers widget under a two-segment tenant path::

    https://recruiting{N}.ultipro.com/{TENANT}/JobBoard/{UUID}

where ``TENANT`` is a short alphanumeric (e.g. ``USG1006``) and ``UUID`` is
the customer's job-board GUID. Both must be known to fetch jobs.

The JobBoard page issues a POST to a sibling endpoint to render its
result grid::

    POST https://recruiting{N}.ultipro.com/{TENANT}/JobBoard/{UUID}/SearchJobs/
    Content-Type: application/json
    Body: {"opportunitySearch": {"Top": 100, "Skip": 0, ...}}

Response::

    {
      "opportunities": [
        {
          "Id": 12345,
          "Title": "...",
          "PrimaryLocation": {"Name": "Austin, TX"},
          "PostedDate": "2026-04-10T00:00:00",
          "EmploymentStatus": "Full Time",
          ...
        },
        ...
      ],
      "totalCount": 42
    }

The endpoint is called by the public JobBoard page on every load, so
scraping it is consistent with the intended public use. No auth is
required. Pagination is handled via ``Skip`` until ``totalCount`` is
reached.

Tenant slugs are the composite ``{TENANT}/{UUID}`` pair that
``src/discovery/detect.py`` emits when a `recruiting.ultipro.com` URL is
matched. Operators either seed them (rare — tenant/UUID pairs aren't
guessable) or let the employer-discovery loop populate
``data/companies/ukg.txt`` from real employer careers pages.

Apply URL is synthesized as
``https://recruiting{N}.ultipro.com/{TENANT}/JobBoard/{UUID}/OpportunityDetail?opportunityId={Id}``
— the canonical detail URL the careers widget links to.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted

# Page size — matches what the real JobBoard UI requests.
_PAGE_SIZE = 100
# Safety cap so a misbehaving tenant doesn't loop forever.
_MAX_PAGES = 50

# Tenant host prefix. Most tenants live on the bare ``recruiting.ultipro.com``
# but a meaningful minority are on shard ``recruiting2`` or ``recruiting3``.
# The composite slug stored on each line can optionally prefix the tenant
# with a shard index (e.g. ``2|USG1006/abc-...``) — the parser handles both.
_SHARD_RE = re.compile(r"^(?P<shard>\d)\|(?P<rest>.+)$")

_BASE_URL = "https://recruiting{shard}.ultipro.com/{tenant}/JobBoard/{uuid}"
_SEARCH_PATH = "/SearchJobs/"
_DETAIL_PATH = "/OpportunityDetail?opportunityId={opp_id}"


class UKGScraper(BaseSourceScraper):
    name = "ukg"
    display_name = "UKG (UltiPro Recruiting)"
    compliance_notes = (
        "Public JobBoard search endpoint consumed by the UltiPro careers "
        "widget; no authentication required."
    )

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        # Each entry is either ``TENANT/UUID`` or ``SHARD|TENANT/UUID``.
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for composite in self.companies:
            shard, tenant, uuid = _split_slug(composite)
            if not (tenant and uuid):
                self.log.info("slug.malformed", slug=composite)
                continue
            for raw in self._iter_pages(shard, tenant, uuid):
                raw["_tenant"] = tenant
                raw["_uuid"] = uuid
                raw["_shard"] = shard
                yield raw

    def _iter_pages(self, shard: str, tenant: str, uuid: str) -> Iterator[dict[str, Any]]:
        base = _BASE_URL.format(shard=shard, tenant=tenant, uuid=uuid)
        search_url = base + _SEARCH_PATH
        skip = 0
        for page in range(_MAX_PAGES):
            body = {
                "opportunitySearch": {
                    "Top": _PAGE_SIZE,
                    "Skip": skip,
                    "QueryString": "",
                    "OrderBy": [{"FieldName": "PostedDate", "Direction": "Descending"}],
                    "Filters": [],
                }
            }
            resp = self.http.post(
                search_url,
                json=body,
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Content-Type": "application/json",
                    "Referer": base,
                },
            )
            if not resp or resp.status_code != 200 or not resp.text:
                return
            head = resp.text[:200].lstrip().lower()
            if head.startswith("<"):
                # WAF / HTML interstitial
                return
            try:
                data = json.loads(resp.text)
            except (json.JSONDecodeError, ValueError):
                return
            jobs = _iter_jobs(data)
            page_count = 0
            for job in jobs:
                page_count += 1
                yield job
            total = _first(data, ("totalCount", "TotalCount", "total", "Total"))
            skip += page_count
            if page_count == 0:
                return
            if isinstance(total, (int, float)) and skip >= int(total):
                return
            if page_count < _PAGE_SIZE:
                return

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = _first(raw, ("Title", "title", "JobTitle", "jobTitle"))
        if not title:
            return None

        tenant = str(raw.get("_tenant") or "")
        uuid = str(raw.get("_uuid") or "")
        shard = str(raw.get("_shard") or "")

        opp_id = _first(raw, ("Id", "id", "OpportunityId", "opportunityId",
                              "JobId", "jobId", "RequisitionId", "requisitionId"))
        apply_url = None
        base = _BASE_URL.format(shard=shard, tenant=tenant, uuid=uuid) if tenant and uuid else None
        if base and opp_id is not None and str(opp_id).strip():
            apply_url = base + _DETAIL_PATH.format(opp_id=opp_id)

        location_raw = _first(
            raw,
            ("PrimaryLocation", "primaryLocation", "Location", "location",
             "Locations", "locations"),
        )
        location_str, country = _normalize_location(location_raw)

        remote_raw = _first(raw, ("WorkType", "workType", "RemoteType", "remoteType",
                                   "EmploymentType", "employmentType"))
        remote_type = _normalize_remote(remote_raw, location_str, raw)

        department = _first(raw, ("Department", "department", "Category", "category",
                                   "BusinessUnit", "businessUnit"))
        employment = _first(raw, ("EmploymentStatus", "employmentStatus",
                                   "JobType", "jobType", "FullTime", "fullTime"))

        posted_raw = _first(
            raw,
            ("PostedDate", "postedDate", "DatePosted", "datePosted",
             "PostingDate", "postingDate"),
        )
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        description = _first(raw, ("Description", "description",
                                    "JobDescription", "jobDescription",
                                    "FullDescription", "fullDescription")) or ""
        snippet = clean_text(description, limit=400) if description else None
        full = clean_text(description) if description else None

        careers_url = base or None

        return JobPosting(
            job_title=str(title).strip(),
            company_name=None,  # UKG feed doesn't carry the employer name
            location=location_str,
            country=country,
            remote_type=remote_type,
            employment_type=_coerce_employment(employment),
            department=str(department).strip() if department else None,
            date_posted_raw=str(posted_raw) if posted_raw else None,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=apply_url or "",
            apply_url=apply_url,
            company_careers_url=careers_url,
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(opp_id) if opp_id is not None else None,
            requisition_id=str(opp_id) if opp_id is not None else None,
            raw=raw,
        )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _split_slug(composite: str) -> tuple[str, str, str]:
    """Split ``[SHARD|]TENANT/UUID`` into (shard, tenant, uuid).

    ``shard`` is the digit appended to ``recruiting`` in the host — an
    empty string means the bare ``recruiting.ultipro.com`` host.
    """
    if not composite or not isinstance(composite, str):
        return "", "", ""
    s = composite.strip()
    shard = ""
    m = _SHARD_RE.match(s)
    if m:
        shard = m.group("shard")
        s = m.group("rest")
    if "/" not in s:
        return shard, "", ""
    tenant, _, uuid = s.partition("/")
    return shard, tenant.strip(), uuid.strip()


def _iter_jobs(data: Any) -> Iterator[dict[str, Any]]:
    """Yield each opportunity dict regardless of wrapper shape.

    Shapes observed::

        {"opportunities": [...]}
        {"Opportunities": [...]}
        {"jobs": [...]}
        {"data": {"opportunities": [...]}}
        [...]  # rare — bare list
    """
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                yield item
        return
    if not isinstance(data, dict):
        return
    for key in ("opportunities", "Opportunities", "jobs", "Jobs",
                 "results", "Results", "items", "Items"):
        bucket = data.get(key)
        if isinstance(bucket, list):
            for item in bucket:
                if isinstance(item, dict):
                    yield item
            return
    # Nested ``{"data": {"opportunities": [...]}}`` shape
    nested = data.get("data") or data.get("Data")
    if isinstance(nested, dict):
        yield from _iter_jobs(nested)


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


def _normalize_location(loc: Any) -> tuple[Optional[str], Optional[str]]:
    """Coerce UKG location payloads into (display_string, country).

    UKG typically ships a dict ``{"Name": "Austin, TX", "Country": "USA"}``
    but some tenants ship a bare string, a list of locations, or a nested
    ``{"Address": {"City": "...", "StateProvince": "...", "Country": "..."}}``.
    """
    if loc is None:
        return None, None
    if isinstance(loc, str):
        s = loc.strip()
        if not s:
            return None, None
        parts = [p.strip() for p in s.split(",") if p.strip()]
        country = None
        if parts and parts[-1].upper() in {"USA", "US", "UNITED STATES"}:
            country = parts[-1]
        return s, country
    if isinstance(loc, dict):
        # Most common shape: {"Name": "Austin, TX"} possibly with Country.
        name = _first(loc, ("Name", "name", "DisplayName", "displayName", "LocationName"))
        country = _first(loc, ("Country", "country", "CountryCode", "countryCode"))
        if name:
            display, country_from_str = _normalize_location(str(name))
            final_country = (country and str(country).strip()) or country_from_str
            return display, final_country or None
        # Fallback: try Address sub-dict or City/State/Country fields.
        addr = loc.get("Address") or loc.get("address")
        if isinstance(addr, dict):
            return _normalize_location(addr)
        city = str(loc.get("City") or loc.get("city") or "").strip()
        state = str(
            loc.get("StateProvince") or loc.get("State") or loc.get("state") or ""
        ).strip()
        country_str = str(loc.get("Country") or loc.get("country") or "").strip() or None
        parts = [p for p in (city, state) if p]
        if parts:
            display = ", ".join(parts)
            if country_str and country_str.upper() not in {p.upper() for p in parts}:
                display = f"{display}, {country_str}"
            return display, country_str
        return (country_str or None), country_str
    if isinstance(loc, list):
        labels: list[str] = []
        for item in loc[:3]:
            sub, _ = _normalize_location(item)
            if sub:
                labels.append(sub)
        return (" / ".join(labels) or None), None
    return None, None


def _normalize_remote(
    remote_raw: Any, location_str: Optional[str], raw: dict[str, Any]
) -> Optional[str]:
    """Map UKG remote signals to our canonical ``remote_type``.

    Falls back through: explicit field → ``IsRemote`` boolean →
    location-string substring.
    """
    if isinstance(remote_raw, str):
        r = remote_raw.strip().lower()
        if r in {"remote", "fully remote", "work from home", "wfh", "telecommute"}:
            return "remote"
        if r in {"hybrid", "flexible"}:
            return "hybrid"
        if r in {"on-site", "onsite", "in-office", "in office", "office"}:
            return "onsite"
    flag = raw.get("IsRemote") or raw.get("isRemote")
    if flag is True:
        return "remote"
    if location_str and "remote" in location_str.lower():
        return "remote"
    return None


def _coerce_employment(val: Any) -> Optional[str]:
    """UKG sometimes ships ``EmploymentStatus`` as a string and sometimes
    as a boolean ``FullTime`` flag — normalize both to a display string."""
    if val is None:
        return None
    if isinstance(val, bool):
        return "Full Time" if val else "Part Time"
    if isinstance(val, str):
        s = val.strip()
        return s or None
    return str(val)
