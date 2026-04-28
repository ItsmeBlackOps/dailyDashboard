"""Ashby — public Job Board API (no auth).

Endpoint: https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true
Compliance: public endpoint backing every Ashby-hosted careers page.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from config import settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class AshbyScraper(BaseSourceScraper):
    name = "ashby"
    display_name = "Ashby Job Boards"
    compliance_notes = "Public Job Board API — no auth required."

    BASE = "https://api.ashbyhq.com/posting-api/job-board/{org}"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or settings.ashby_companies

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for org in self.companies:
            url = self.BASE.format(org=org)
            resp = self.http.get(url, params={"includeCompensation": "true"})
            if not resp or resp.status_code != 200:
                self.log.warning("org.miss", org=org, status=getattr(resp, "status_code", None))
                continue
            try:
                data = resp.json()
            except ValueError:
                continue
            for job in data.get("jobs", []):
                job["_org"] = org
                yield job

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("title")
        if not title:
            return None
        location = raw.get("location") or raw.get("locationName")
        published = raw.get("publishedAt") or raw.get("updatedAt")
        posted_dt = parse_posted(published) if published else None
        if posted_dt and posted_dt.tzinfo is None:
            posted_dt = posted_dt.replace(tzinfo=timezone.utc)
        org = raw.get("_org", "")
        desc = clean_text(raw.get("descriptionPlain") or raw.get("description"), limit=400)
        full = clean_text(raw.get("descriptionPlain") or raw.get("description"))
        comp = raw.get("compensation") or {}
        salary = None
        if comp and isinstance(comp, dict):
            summary = comp.get("compensationTierSummary") or comp.get("summary")
            if summary:
                salary = str(summary)
        team = raw.get("team") or raw.get("department")
        job_url = raw.get("jobUrl") or raw.get("applyUrl") or ""
        apply_u = raw.get("applyUrl") or job_url
        return JobPosting(
            job_title=title.strip(),
            company_name=org.replace("-", " ").title(),
            location=location,
            country=None,
            employment_type=raw.get("employmentType"),
            remote_type=(raw.get("workplaceType") or "").lower() or None,
            salary=salary,
            department=team,
            date_posted_raw=published,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=job_url,
            apply_url=apply_u,
            company_careers_url=f"https://jobs.ashbyhq.com/{org}",
            job_description_snippet=desc,
            full_job_description=full,
            source_job_id=raw.get("id"),
            raw=raw,
        )
