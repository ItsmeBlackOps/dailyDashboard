"""Paylocity — public recruiting JSON API (no auth).

Paylocity's careers widget — embedded via iframe on thousands of
mid-market US employer career pages — consumes an undocumented but
widely-used JSON endpoint to render its job grid::

    GET https://recruiting.paylocity.com/recruiting/JobsApi/JobList?companyId={UUID}

The ``companyId`` is a UUID (tenant GUID) that each Paylocity customer
is assigned. Operators discover it by loading the employer's careers
page and extracting the iframe ``src`` matching
``recruiting.paylocity.com/recruiting/jobs/All/{UUID}`` — that's
exactly the pattern ``src/discovery/detect.py`` already fingerprints at
confidence 3.

No authentication is required. The JSON endpoint is the same one the
public careers widget hits on every page load, so scraping it is
consistent with the intended public use.

Response shape (canonical)::

    {
      "Data": [
        {
          "JobId": 12345,
          "Title": "Senior Software Engineer",
          "Location": "Austin, TX",
          "Department": "Engineering",
          "JobType": "Full-Time",
          "PostedDate": "2026-04-10T00:00:00",
          "Description": "<p>...</p>",
          ...
        },
        ...
      ],
      "Total": 7
    }

Some tenants ship a bare list (no ``Data`` wrapper) and a few use
lowercase keys (``jobId``, ``title``). The parser handles both via the
same synonym-list pattern used elsewhere in this project.

Apply URL is synthesized as
``https://recruiting.paylocity.com/Recruiting/Jobs/Details/{JobId}``
— the canonical detail-page URL the careers widget links to.
"""
from __future__ import annotations

import json
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


# Tenant UUIDs look like 8-4-4-4-12 hex. Paylocity occasionally uses
# bare 32-hex too (no dashes) — accept both shapes loosely.
_JOB_LIST_URL = (
    "https://recruiting.paylocity.com/recruiting/JobsApi/JobList"
    "?companyId={company_id}"
)
_APPLY_URL = "https://recruiting.paylocity.com/Recruiting/Jobs/Details/{job_id}"
_CAREERS_URL = "https://recruiting.paylocity.com/Recruiting/Jobs/All/{company_id}"


class PaylocityScraper(BaseSourceScraper):
    name = "paylocity"
    display_name = "Paylocity"
    compliance_notes = (
        "Public recruiting JSON endpoint consumed by the Paylocity careers "
        "widget iframe; no auth required."
    )

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        # Each entry is the tenant UUID (the GUID from the careers-iframe src).
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for company_id in self.companies:
            data = self._fetch_one(company_id)
            if data is None:
                self.log.info("company.miss", company=company_id)
                continue
            for job in _iter_jobs(data):
                job = dict(job)  # shallow-copy, don't mutate caller
                job["_company_id"] = company_id
                yield job

    def _fetch_one(self, company_id: str) -> Optional[Any]:
        url = _JOB_LIST_URL.format(company_id=company_id)
        resp = self.http.get(
            url,
            headers={"Accept": "application/json, */*;q=0.5"},
        )
        if not resp or resp.status_code != 200 or not resp.text:
            return None
        # HTML interstitials (WAF / tenant private / iframe parent redirect)
        head = resp.text[:200].lstrip().lower()
        if head.startswith("<"):
            return None
        try:
            return json.loads(resp.text)
        except (json.JSONDecodeError, ValueError):
            return None

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = _first(raw, ("Title", "title", "JobTitle", "jobTitle"))
        if not title:
            return None

        company_id = raw.get("_company_id") or ""
        job_id = _first(raw, ("JobId", "jobId", "Id", "id", "RequisitionId", "requisitionId"))
        apply_url = (
            _APPLY_URL.format(job_id=job_id)
            if job_id is not None and str(job_id).strip() else None
        )

        location = _first(raw, ("Location", "location", "JobLocation", "jobLocation"))
        location_str, country = _normalize_location(location)

        remote_raw = _first(raw, ("RemoteType", "remoteType", "WorkplaceType", "workplaceType"))
        remote_type = _normalize_remote(remote_raw, location_str)

        department = _first(raw, ("Department", "department", "Category", "category"))
        employment = _first(raw, ("JobType", "jobType", "EmploymentType", "employmentType"))

        posted_raw = _first(
            raw,
            ("PostedDate", "postedDate", "DatePosted", "datePosted",
             "PostingDate", "postingDate"),
        )
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        description = _first(raw, ("Description", "description", "JobDescription", "jobDescription")) or ""
        snippet = clean_text(description, limit=400) if description else None
        full = clean_text(description) if description else None

        return JobPosting(
            job_title=str(title).strip(),
            company_name=None,  # Paylocity feed doesn't carry the employer name
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
            company_careers_url=_CAREERS_URL.format(company_id=company_id) if company_id else None,
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(job_id) if job_id is not None else None,
            requisition_id=str(job_id) if job_id is not None else None,
            raw=raw,
        )


# --------------------------------------------------------------------------
# Response-shape helpers
# --------------------------------------------------------------------------

def _iter_jobs(data: Any) -> Iterator[dict[str, Any]]:
    """Yield each job dict regardless of wrapper shape.

    Shapes observed::

        [ {..}, {..} ]
        {"Data": [ {..}, {..} ]}
        {"data": [ {..}, {..} ]}
        {"Jobs": [ {..} ]}
        {"Result": [ {..} ]}
    """
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                yield item
        return
    if not isinstance(data, dict):
        return
    for key in ("Data", "data", "Jobs", "jobs", "Result", "result", "Items", "items"):
        bucket = data.get(key)
        if isinstance(bucket, list):
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


def _normalize_location(loc: Any) -> tuple[Optional[str], Optional[str]]:
    """Coerce Paylocity's ``Location`` field into (display_string, country).

    Paylocity almost always ships a plain "City, ST" string but some
    tenants ship a dict ``{"City": "...", "State": "...", "Country": "..."}``.
    """
    if loc is None:
        return None, None
    if isinstance(loc, str):
        s = loc.strip()
        if not s:
            return None, None
        # Heuristic: detect a trailing country token "USA"/"US"/"United States"
        parts = [p.strip() for p in s.split(",") if p.strip()]
        country = None
        if parts and parts[-1].upper() in {"USA", "US", "UNITED STATES"}:
            country = parts[-1]
        return s, country
    if isinstance(loc, dict):
        city = str(loc.get("City") or loc.get("city") or "").strip()
        state = str(loc.get("State") or loc.get("state") or "").strip()
        country = str(loc.get("Country") or loc.get("country") or "").strip() or None
        parts = [p for p in (city, state) if p]
        if parts:
            display = ", ".join(parts)
            if country and country.upper() not in {p.upper() for p in parts}:
                display = f"{display}, {country}"
            return display, country
        return (country or None), country
    if isinstance(loc, list):
        # Multi-location → join the first few
        labels: list[str] = []
        for item in loc[:3]:
            sub, _ = _normalize_location(item)
            if sub:
                labels.append(sub)
        return (" / ".join(labels) or None), None
    return None, None


def _normalize_remote(remote_raw: Any, location_str: Optional[str]) -> Optional[str]:
    """Map Paylocity remote signals to our canonical ``remote_type``."""
    if isinstance(remote_raw, str):
        r = remote_raw.strip().lower()
        if r in {"remote", "fully remote", "work from home", "wfh"}:
            return "remote"
        if r in {"hybrid"}:
            return "hybrid"
        if r in {"on-site", "onsite", "in-office", "in office"}:
            return "onsite"
    if location_str and "remote" in location_str.lower():
        return "remote"
    return None
