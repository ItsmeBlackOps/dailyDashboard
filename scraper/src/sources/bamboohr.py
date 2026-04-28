"""BambooHR — careers-list JSON (no auth).

BambooHR exposes an undocumented but widely-used JSON endpoint that its
own careers-page widget consumes client-side::

    GET https://{company}.bamboohr.com/careers/list      (served as JSON)
    GET https://{company}.bamboohr.com/careers/list.json (alias)

No auth is required for public career-page tenants; BambooHR returns a
structured list of open postings with location, department, employment
status, and posting date. Because this is the same feed consumed by the
public careers page iframe, scraping it is consistent with BambooHR's
intended use.

Response shapes observed (all handled)::

    # Canonical modern shape
    {"result": [ {"id": 1, "jobOpeningName": "...", ...}, ... ]}

    # Nested variant (some tenants)
    {"result": {"jobs": [ {...}, ... ]}}

    # Legacy variant (rare)
    [ {...}, ... ]

Field mapping
-------------
- ``id``                       → ``source_job_id`` (durable per-posting)
- ``jobOpeningName`` / ``title`` → ``job_title``
- ``location.{city,state,country}`` → ``location`` string, ``country``
- ``department.name`` / ``departmentLabel`` / ``department`` → ``department``
- ``employmentStatusLabel`` / ``employmentStatus.label`` → ``employment_type``
- ``datePosted`` / ``openedDate`` → ``date_posted_*``
- ``jobOpeningStatus`` — we emit only "Open"/"Active" records
- ``description`` — if present (some tenants embed HTML here).

Apply URL is synthesized as
``https://{company}.bamboohr.com/careers/{id}``, the canonical
per-posting URL the careers page links to.
"""
from __future__ import annotations

import json
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


# Status tokens indicating the posting is live. BambooHR strings vary by
# tenant locale but "open" / "active" cover the English set we've seen.
_OPEN_STATES = {"open", "active", "posted"}


class BambooHRScraper(BaseSourceScraper):
    name = "bamboohr"
    display_name = "BambooHR"
    compliance_notes = (
        "Public careers-page JSON endpoint consumed by BambooHR's own "
        "widget; no auth required."
    )

    # We try the bare path first because some tenants 404 on the .json alias.
    _URL_TEMPLATES: tuple[str, ...] = (
        "https://{company}.bamboohr.com/careers/list",
        "https://{company}.bamboohr.com/careers/list.json",
    )

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for company in self.companies:
            data = self._fetch_one(company)
            if data is None:
                self.log.info("company.miss", company=company)
                continue
            for job in _iter_jobs(data):
                job = dict(job)  # shallow-copy so we don't mutate the caller's dict
                job["_company"] = company
                yield job

    def _fetch_one(self, company: str) -> Optional[Any]:
        for tmpl in self._URL_TEMPLATES:
            url = tmpl.format(company=company)
            resp = self.http.get(
                url,
                headers={"Accept": "application/json, */*;q=0.5"},
            )
            if not resp or resp.status_code != 200 or not resp.text:
                continue
            # Guard against HTML error pages masquerading as 200 (rare on
            # BambooHR but observed when a tenant goes private).
            head = resp.text[:200].lstrip().lower()
            if head.startswith("<"):
                continue
            try:
                return json.loads(resp.text)
            except (json.JSONDecodeError, ValueError):
                continue
        return None

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("jobOpeningName") or raw.get("title") or raw.get("name")
        if not title:
            return None

        status = (raw.get("jobOpeningStatus") or raw.get("status") or "").strip().lower()
        if status and status not in _OPEN_STATES:
            return None  # filled/closed postings are dropped

        company_slug = raw.get("_company") or ""
        job_id = raw.get("id") or raw.get("jobOpeningId")
        apply_url = (
            f"https://{company_slug}.bamboohr.com/careers/{job_id}"
            if (company_slug and job_id is not None) else None
        )

        location_str, country = _location(raw.get("location") or raw.get("jobLocation"))
        remote_flag = _truthy(raw, ("isRemote", "remote"))
        # Some tenants split remote into `locationType == "remote"`
        loc_type = (raw.get("locationType") or "").lower()
        if loc_type == "remote" or remote_flag:
            remote_type = "remote"
        else:
            remote_type = None

        department = _name_or_string(raw.get("department") or raw.get("departmentLabel"))
        employment = (
            _name_or_string(raw.get("employmentStatus"))
            or raw.get("employmentStatusLabel")
            or raw.get("employmentType")
        )

        posted_raw = (
            raw.get("datePosted")
            or raw.get("openedDate")
            or raw.get("publishedDate")
            or raw.get("dateCreated")
        )
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        description = raw.get("description") or raw.get("jobDescription") or ""
        snippet = clean_text(description, limit=400) if description else None
        full = clean_text(description) if description else None

        return JobPosting(
            job_title=str(title).strip(),
            company_name=company_slug.replace("-", " ").replace("_", " ").title() if company_slug else None,
            location=location_str,
            country=country,
            remote_type=remote_type,
            employment_type=employment,
            department=department,
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=apply_url or "",
            apply_url=apply_url,
            company_careers_url=f"https://{company_slug}.bamboohr.com/careers" if company_slug else None,
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(job_id) if job_id is not None else None,
            requisition_id=None,  # BambooHR doesn't ship a separate req# in this feed
            raw=raw,
        )


# --------------------------------------------------------------------------
# Response-shape helpers — tolerant of the 3 variants observed in the wild.
# --------------------------------------------------------------------------

def _iter_jobs(data: Any) -> Iterator[dict[str, Any]]:
    """Yield each job dict regardless of wrapper shape.

    Accepts::

        [ {..}, {..} ]
        {"result": [ {..}, {..} ]}
        {"result": {"jobs": [ {..}, {..} ]}}
        {"jobs": [ {..}, {..} ]}
    """
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                yield item
        return
    if not isinstance(data, dict):
        return
    candidates: list[Any] = []
    for key in ("result", "results", "jobs", "jobOpenings", "data"):
        if key in data:
            candidates.append(data[key])
    for c in candidates:
        if isinstance(c, list):
            for item in c:
                if isinstance(item, dict):
                    yield item
        elif isinstance(c, dict):
            # Recurse one level — `{"result": {"jobs": [...]}}`.
            for nested_key in ("jobs", "items", "result", "data"):
                inner = c.get(nested_key)
                if isinstance(inner, list):
                    for item in inner:
                        if isinstance(item, dict):
                            yield item
                    return


def _location(loc: Any) -> tuple[Optional[str], Optional[str]]:
    """Normalize BambooHR's ``location`` field into (display_string, country)."""
    if loc is None:
        return None, None
    if isinstance(loc, str):
        s = loc.strip()
        return (s or None), None
    if not isinstance(loc, dict):
        return None, None
    city = (loc.get("city") or "").strip()
    state = (loc.get("state") or loc.get("addressRegion") or "").strip()
    country = (loc.get("country") or loc.get("countryCode") or "").strip() or None
    parts = [p for p in (city, state) if p]
    if parts:
        display = ", ".join(parts)
        if country and country.upper() not in {p.upper() for p in parts}:
            display = f"{display}, {country}"
        return display, country
    return (country or None), country


def _name_or_string(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, dict):
        return v.get("name") or v.get("label")
    if isinstance(v, str):
        return v or None
    return None


def _truthy(raw: dict[str, Any], keys: tuple[str, ...]) -> bool:
    for k in keys:
        v = raw.get(k)
        if v in (True, "true", "True", 1, "1", "yes", "Yes"):
            return True
    return False
