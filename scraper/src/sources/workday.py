"""Workday (myworkdayjobs) — CXS public listing API.

Workday is mandatory for Fortune-500 coverage but is the highest-effort ATS
connector:

  * Endpoint: POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
  * Body:     {"appliedFacets":{},"limit":20,"offset":0,"searchText":""}
  * Detail:   GET .../job/{externalPath}
  * Date format: `postedOn` is a RELATIVE string ("Posted Yesterday",
    "Posted 30+ Days Ago"). We best-effort parse it; if it says "30+ Days
    Ago" we leave date_posted_normalized as None so the recency filter
    can drop it — don't trust the absolute value.

Tenant IDs are supplied as "tenant:wdN:site" triples, e.g.
"nvidia:wd5:NVIDIAExternalCareerSite". Each part is:

  tenant  — subdomain (e.g. "nvidia")
  wdN     — region cluster (wd1 / wd3 / wd5 / wd103 etc.)
  site    — external career-site name. Discover it from the public URL,
            e.g. `nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite`.

Every Workday tenant exposes the full triple in the careers-page URL:
  https://{tenant}.wd{N}.myworkdayjobs.com/en-US/{site}

Stable IDs:
  - `jobPostingId` (e.g. "R-12345") — tenant-assigned requisition. Survives
    edits; new one on new requisition. Perfect requisition_id.
  - `externalPath` — URL slug path, may change if title/location edited.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator, Optional

# Matches Workday aggregate location strings like "2 Locations", "1 Location",
# "10 Locations" — returned when a requisition spans multiple offices.
# All tenants in our seed list are US employers, so we map these to "United
# States" so that looks_us() in src/normalizer.py accepts them downstream.
_MULTI_LOCATION_RE = re.compile(r"^\d+\s+Locations?$", re.IGNORECASE)

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text


# Parse "Posted Yesterday", "Posted Today", "Posted 3 Days Ago",
# "Posted 30+ Days Ago" — returns approximate datetime or None.
_REL_PATTERNS = [
    (re.compile(r"\btoday\b", re.I), 0),
    (re.compile(r"\byesterday\b", re.I), 1),
    (re.compile(r"(\d+)\+?\s*day", re.I), None),  # captured
    (re.compile(r"(\d+)\+?\s*week", re.I), "week"),
    (re.compile(r"(\d+)\+?\s*month", re.I), "month"),
]


def _parse_workday_posted(txt: Optional[str]) -> Optional[datetime]:
    if not txt:
        return None
    now = datetime.now(timezone.utc)
    # "30+" is unreliable — it could be anywhere from 30 to infinity days old.
    # Return None so recency filter drops it rather than falsely including.
    if "30+" in txt:
        return None
    for rx, mul in _REL_PATTERNS:
        m = rx.search(txt)
        if not m:
            continue
        if mul == 0:
            return now
        if mul == 1:
            return now - timedelta(days=1)
        if mul is None:
            try:
                return now - timedelta(days=int(m.group(1)))
            except (IndexError, ValueError):
                return None
        if mul == "week":
            try:
                return now - timedelta(weeks=int(m.group(1)))
            except (IndexError, ValueError):
                return None
        if mul == "month":
            try:
                return now - timedelta(days=30 * int(m.group(1)))
            except (IndexError, ValueError):
                return None
    return None


def _parse_tenant_triple(spec: str) -> Optional[tuple[str, str, str]]:
    """Split 'tenant:wdN:site' → (tenant, wdN, site). Returns None if malformed."""
    parts = [p.strip() for p in spec.split(":") if p.strip()]
    if len(parts) != 3:
        return None
    tenant, wd, site = parts
    if not wd.lower().startswith("wd"):
        return None
    return tenant, wd.lower(), site


class WorkdayScraper(BaseSourceScraper):
    name = "workday"
    display_name = "Workday CXS"
    compliance_notes = (
        "Public CXS listing endpoint used by every myworkdayjobs careers page. "
        "No auth required; Akamai Bot Manager on some tenants — use realistic UA."
    )

    LIST_URL = "https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs"
    DETAIL_URL = "https://{tenant}.{wd}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/job{external_path}"
    VIEW_URL = "https://{tenant}.{wd}.myworkdayjobs.com/en-US/{site}{external_path}"

    PAGE_SIZE = 20

    def __init__(self, tenants: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.tenants = tenants or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for spec in self.tenants:
            triple = _parse_tenant_triple(spec)
            if not triple:
                self.log.warning("tenant.malformed", spec=spec)
                continue
            tenant, wd, site = triple
            url = self.LIST_URL.format(tenant=tenant, wd=wd, site=site)
            offset = 0
            while True:
                # Leave `appliedFacets` empty — the per-tenant location-country
                # GUIDs are not portable across Workday taxonomies. Downstream
                # `looks_us()` in normalizer.post_filter handles the US filter.
                resp = self.http.post(
                    url,
                    json={
                        "appliedFacets": {},
                        "limit": self.PAGE_SIZE,
                        "offset": offset,
                        "searchText": "",
                    },
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
                if not resp or resp.status_code != 200:
                    self.log.warning(
                        "tenant.miss", tenant=tenant, site=site,
                        status=getattr(resp, "status_code", None),
                    )
                    break
                try:
                    data = resp.json()
                except ValueError:
                    break
                postings = data.get("jobPostings") or []
                if not postings:
                    break
                for p in postings:
                    p["_tenant"] = tenant
                    p["_wd"] = wd
                    p["_site"] = site
                    yield p
                total = int(data.get("total") or 0)
                offset += self.PAGE_SIZE
                if offset >= total or offset >= 500:  # cap per-tenant
                    break

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("title")
        if not title:
            return None
        tenant = raw.get("_tenant", "")
        wd = raw.get("_wd", "wd1")
        site = raw.get("_site", "")
        external_path = raw.get("externalPath") or ""
        posted_raw = raw.get("postedOn")
        posted_dt = _parse_workday_posted(posted_raw)
        loc_raw = raw.get("locationsText") or raw.get("primaryLocation") or None
        # When Workday returns an aggregate like "2 Locations" it means the req
        # spans multiple US offices.  looks_us() cannot parse the literal, so we
        # normalise it to "United States" — all tenants in our list are US employers.
        if loc_raw and _MULTI_LOCATION_RE.match(loc_raw):
            loc = "United States"
        else:
            loc = loc_raw
        req_id = raw.get("bulletFields") or []  # often has [jobReqId]
        if isinstance(req_id, list) and req_id:
            req_id = str(req_id[0])
        else:
            req_id = None
        job_posting_id = raw.get("jobPostingId") or req_id
        view_url = self.VIEW_URL.format(
            tenant=tenant, wd=wd, site=site, external_path=external_path
        )
        return JobPosting(
            job_title=title.strip(),
            company_name=tenant.replace("-", " ").title(),
            location=loc,
            country=None,
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=view_url,
            apply_url=view_url,
            company_careers_url=f"https://{tenant}.{wd}.myworkdayjobs.com/en-US/{site}",
            source_job_id=external_path or job_posting_id,
            requisition_id=job_posting_id,
            job_description_snippet=clean_text(raw.get("shortDescription"), limit=400),
            raw=raw,
        )
