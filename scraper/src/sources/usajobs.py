"""USAJOBS — official U.S. government jobs API.

Docs: https://developer.usajobs.gov/
Requires: a free API key + User-Agent email header.
"""
from __future__ import annotations

from typing import Any, Iterator, Optional

from config import TARGET_TITLES, settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class USAJobsScraper(BaseSourceScraper):
    name = "usajobs"
    display_name = "USAJOBS"
    compliance_notes = "Official U.S. government jobs API (requires free key)."

    URL = "https://data.usajobs.gov/api/search"

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        if not settings.usajobs_api_key or not settings.usajobs_user_agent:
            self.log.info("usajobs.skipped", reason="missing API key or User-Agent")
            return
        headers = {
            "Authorization-Key": settings.usajobs_api_key,
            "Host": "data.usajobs.gov",
            "User-Agent": settings.usajobs_user_agent,
        }
        for keyword in TARGET_TITLES:
            page = 1
            while page <= 5:  # hard cap
                resp = self.http.get(
                    self.URL,
                    params={
                        "Keyword": keyword,
                        "LocationName": "United States",
                        "ResultsPerPage": 50,
                        "Page": page,
                        "DatePosted": 1,  # last day
                    },
                    headers=headers,
                )
                if not resp or resp.status_code != 200:
                    break
                try:
                    data = resp.json()
                except ValueError:
                    break
                items = (data.get("SearchResult", {}).get("SearchResultItems") or [])
                for item in items:
                    yield item
                if len(items) < 50:
                    break
                page += 1

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        job = (raw or {}).get("MatchedObjectDescriptor") or {}
        title = job.get("PositionTitle")
        if not title:
            return None
        locs = job.get("PositionLocation") or []
        location = locs[0].get("LocationName") if locs else None
        posted_raw = job.get("PublicationStartDate")
        posted_dt = parse_posted(posted_raw) if posted_raw else None
        # USAJobs exposes PositionStartDate / PositionEndDate / PublicationStartDate
        # as distinct fields. PublicationStartDate is our posted date; use
        # MatchedObjectId (control number) as the stable requisition.
        control_number = (raw or {}).get("MatchedObjectId") or job.get("PositionID")
        summary = (job.get("UserArea", {}).get("Details", {}) or {}).get("JobSummary")
        apply_u = job.get("ApplyURI")
        if isinstance(apply_u, list) and apply_u:
            apply_u = apply_u[0]
        dept = None
        dept_info = job.get("DepartmentName")
        if dept_info:
            dept = dept_info
        return JobPosting(
            job_title=title.strip(),
            company_name=job.get("OrganizationName") or "U.S. Federal Government",
            location=location,
            country="US",
            employment_type=(job.get("PositionSchedule") or [{}])[0].get("Name"),
            salary=_salary(job.get("PositionRemuneration")),
            department=dept,
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=job.get("PositionURI", ""),
            apply_url=apply_u or job.get("PositionURI"),
            company_careers_url="https://www.usajobs.gov/",
            # PositionID is USAJobs' human-readable req number (e.g. "RT-26-12345").
            # MatchedObjectId is the numeric control number — stable across edits.
            source_job_id=str(control_number) if control_number else None,
            requisition_id=job.get("PositionID"),
            job_description_snippet=clean_text(summary, limit=400),
            full_job_description=clean_text(summary),
            raw=raw,
        )


def _salary(rem: Any) -> Optional[str]:
    if not rem or not isinstance(rem, list):
        return None
    r = rem[0] or {}
    lo, hi, unit = r.get("MinimumRange"), r.get("MaximumRange"), r.get("RateIntervalCode")
    if lo and hi:
        return f"{lo}-{hi} {unit or ''}".strip()
    return None
