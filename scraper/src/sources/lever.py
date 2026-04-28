"""Lever — public Postings API (no auth).

Docs: https://help.lever.co/hc/en-us/articles/360005311192
Endpoint: https://api.lever.co/v0/postings/{company}?mode=json
Compliance: official public postings JSON endpoint. Safe.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from config import settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text


class LeverScraper(BaseSourceScraper):
    name = "lever"
    display_name = "Lever Postings"
    compliance_notes = "Official public Postings API — no auth required."

    BASE = "https://api.lever.co/v0/postings/{company}"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or settings.lever_companies

    # Mirror the greenhouse pattern: emit a progress log every
    # PROGRESS_EVERY companies so operators can see motion during the
    # long serial scrape (~500+ companies). Without this, a single hung
    # company would leave the run silent for minutes.
    PROGRESS_EVERY = 50

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        total = len(self.companies)
        jobs_seen = 0
        companies_ok = 0
        companies_miss = 0
        self.log.info("lever.scrape.start", companies_total=total)
        for i, company in enumerate(self.companies, start=1):
            url = self.BASE.format(company=company)
            resp = self.http.get(url, params={"mode": "json"})
            if not resp or resp.status_code != 200:
                companies_miss += 1
                self.log.warning(
                    "company.miss", company=company,
                    status=getattr(resp, "status_code", None),
                )
            else:
                try:
                    data = resp.json()
                except ValueError:
                    companies_miss += 1
                    data = None
                if isinstance(data, list):
                    companies_ok += 1
                    for job in data:
                        job["_company"] = company
                        jobs_seen += 1
                        yield job
                elif data is not None:
                    companies_miss += 1

            if i % self.PROGRESS_EVERY == 0 or i == total:
                self.log.info(
                    "lever.progress",
                    companies_done=i, companies_total=total,
                    companies_ok=companies_ok, companies_miss=companies_miss,
                    jobs_seen=jobs_seen,
                )

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("text") or raw.get("title")
        if not title:
            return None
        cats = raw.get("categories") or {}
        location = cats.get("location")
        commitment = cats.get("commitment")
        workplace = cats.get("workplaceType")
        team = cats.get("team") or cats.get("department")
        created_ms = raw.get("createdAt")
        posted_dt = (
            datetime.fromtimestamp(created_ms / 1000, tz=timezone.utc)
            if isinstance(created_ms, (int, float))
            else None
        )
        desc = clean_text(raw.get("descriptionPlain") or raw.get("description"), limit=400)
        full = clean_text(raw.get("descriptionPlain") or raw.get("description"))
        company = raw.get("_company", "")
        # Lever's public feed has no updatedAt, so rely on content_hash for edit detection.
        hosted = raw.get("hostedUrl") or ""
        apply_u = raw.get("applyUrl") or hosted
        return JobPosting(
            job_title=title.strip(),
            company_name=company.replace("-", " ").title(),
            location=location,
            country=None,
            employment_type=commitment,
            remote_type=(workplace or "").lower() or None,
            department=team,
            date_posted_raw=str(created_ms) if created_ms else None,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=hosted or apply_u,
            apply_url=apply_u,
            company_careers_url=f"https://jobs.lever.co/{company}",
            job_description_snippet=desc,
            full_job_description=full,
            source_job_id=raw.get("id"),
            raw=raw,
        )
