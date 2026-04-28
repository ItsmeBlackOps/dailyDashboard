"""Workable — public widget API.

Endpoint: https://apply.workable.com/api/v3/accounts/{subdomain}/jobs
"""
from __future__ import annotations

from typing import Any, Iterator, Optional

from config import settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class WorkableScraper(BaseSourceScraper):
    name = "workable"
    display_name = "Workable"
    compliance_notes = "Public job board widget API — no auth required."

    BASE = "https://apply.workable.com/api/v3/accounts/{sub}/jobs"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or settings.workable_companies

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for sub in self.companies:
            resp = self.http.post(
                self.BASE.format(sub=sub),
                json={"searchQuery": {"query": "analyst", "location": []}, "limit": 100},
            )
            if not resp or resp.status_code != 200:
                self.log.warning("company.miss", company=sub, status=getattr(resp, "status_code", None))
                continue
            try:
                data = resp.json()
            except ValueError:
                continue
            for job in data.get("results", []) or []:
                job["_sub"] = sub
                yield job

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("title")
        if not title:
            return None
        location = raw.get("locationString") or raw.get("city")
        published = raw.get("published") or raw.get("createdAt")
        updated = raw.get("updatedAt") or raw.get("modifiedAt")
        posted_dt = parse_posted(published) if published else None
        updated_dt = parse_posted(updated) if updated else None
        sub = raw.get("_sub", "")
        shortcode = raw.get("shortcode")
        url = f"https://apply.workable.com/{sub}/j/{shortcode}" if shortcode else ""
        return JobPosting(
            job_title=title.strip(),
            company_name=raw.get("company") or sub.title(),
            location=location,
            employment_type=raw.get("employmentType"),
            remote_type=(raw.get("remote") and "remote") or None,
            department=raw.get("department"),
            date_posted_raw=published,
            date_posted_normalized=posted_dt,
            date_updated_raw=updated,
            date_updated_normalized=updated_dt,
            source_platform=self.name,
            source_url=url,
            apply_url=url or None,
            company_careers_url=f"https://apply.workable.com/{sub}",
            # Workable's `shortcode` is URL-stable across edits (but changes on
            # delete+repost). `id` is the internal primary key.
            source_job_id=str(raw.get("id") or shortcode) if (raw.get("id") or shortcode) else None,
            requisition_id=shortcode,
            job_description_snippet=clean_text(raw.get("description"), limit=400),
            full_job_description=clean_text(raw.get("description")),
            raw=raw,
        )
