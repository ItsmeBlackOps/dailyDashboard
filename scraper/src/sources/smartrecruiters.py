"""SmartRecruiters — public postings API.

Docs: https://dev.smartrecruiters.com/customer-api/posting-api/
Endpoint: https://api.smartrecruiters.com/v1/companies/{id}/postings
"""
from __future__ import annotations

from datetime import timezone
from typing import Any, Iterator, Optional

from config import settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class SmartRecruitersScraper(BaseSourceScraper):
    name = "smartrecruiters"
    display_name = "SmartRecruiters"
    compliance_notes = "Official public postings API — no auth required."

    BASE = "https://api.smartrecruiters.com/v1/companies/{company}/postings"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or settings.smartrecruiters_companies

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for company in self.companies:
            offset = 0
            while True:
                resp = self.http.get(
                    self.BASE.format(company=company),
                    params={"limit": 100, "offset": offset, "country": "us"},
                )
                if not resp or resp.status_code != 200:
                    break
                try:
                    data = resp.json()
                except ValueError:
                    break
                content = data.get("content", []) or []
                for job in content:
                    job["_company"] = company
                    yield job
                if len(content) < 100:
                    break
                offset += 100

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        name = raw.get("name")
        if not name:
            return None
        loc = raw.get("location") or {}
        loc_parts = [loc.get("city"), loc.get("region"), loc.get("country")]
        location = ", ".join(p for p in loc_parts if p)
        # releasedDate / createdOn = first publish; lastPublishedDate = edit time.
        released = raw.get("releasedDate") or raw.get("createdOn")
        last_pub = raw.get("lastPublishedDate")
        posted_dt = parse_posted(released) if released else None
        if posted_dt and posted_dt.tzinfo is None:
            posted_dt = posted_dt.replace(tzinfo=timezone.utc)
        updated_dt = parse_posted(last_pub) if last_pub else None
        if updated_dt and updated_dt.tzinfo is None:
            updated_dt = updated_dt.replace(tzinfo=timezone.utc)
        company = raw.get("_company", "")
        dept = (raw.get("department") or {}).get("label") if isinstance(raw.get("department"), dict) else None
        exp_level = None
        exp = raw.get("experienceLevel") or {}
        if isinstance(exp, dict):
            exp_level = exp.get("label") or exp.get("id")
        # Description lives in `jobAd.sections.jobDescription.text`.
        job_ad = raw.get("jobAd") or {}
        sections = (job_ad.get("sections") or {}) if isinstance(job_ad, dict) else {}
        desc_raw = None
        if isinstance(sections, dict):
            jd = sections.get("jobDescription") or {}
            if isinstance(jd, dict):
                desc_raw = jd.get("text")
        snippet = clean_text(desc_raw, limit=400)
        full = clean_text(desc_raw)
        return JobPosting(
            job_title=name.strip(),
            company_name=(raw.get("company", {}) or {}).get("name") or company,
            location=location or None,
            country=(loc.get("country") or "").upper() or None,
            employment_type=(raw.get("typeOfEmployment") or {}).get("id"),
            department=dept,
            experience_level=(exp_level or "").lower() or None,
            date_posted_raw=released,
            date_posted_normalized=posted_dt,
            date_updated_raw=last_pub,
            date_updated_normalized=updated_dt,
            source_platform=self.name,
            source_url=(raw.get("ref") or ""),
            apply_url=(raw.get("ref") or None),
            company_careers_url=f"https://careers.smartrecruiters.com/{company}",
            source_job_id=raw.get("id"),
            requisition_id=raw.get("refNumber"),
            job_description_snippet=snippet,
            full_job_description=full,
            raw=raw,
        )
