"""JazzHR (formerly Resumator) — public JSON feed (no auth).

URL: https://{company}.applytojob.com/apply/jobs/feed

Returned shape (as of 2026-04):

    {
      "jobs": [
        {
          "id": "abc123XYZ",
          "title": "Senior Software Engineer",
          "description": "<p>…HTML…</p>",
          "department": "Engineering",
          "city": "New York",
          "state": "NY",
          "country": "USA",
          "employment_type": "Full Time",
          "minimum_salary": "120000",
          "maximum_salary": "180000",
          "original_open_date": "2026-04-12T00:00:00Z",
          "board_code": "abc123",
          "apply_url": "https://…applytojob.com/apply/…"
        }
      ]
    }

Compliance: public candidate-facing feed, documented on jazzhr.com as the
canonical integration point. No auth required.
"""
from __future__ import annotations

from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class JazzHRScraper(BaseSourceScraper):
    name = "jazzhr"
    display_name = "JazzHR (applytojob.com)"
    compliance_notes = "Public JSON feed on applytojob.com — no auth required."

    BASE = "https://{company}.applytojob.com/apply/jobs/feed"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for company in self.companies:
            url = self.BASE.format(company=company)
            # `?json=1` forces JSON when the feed is ambiguous; safe no-op otherwise.
            resp = self.http.get(url, params={"json": "1"})
            if not resp or resp.status_code != 200:
                self.log.info(
                    "company.miss",
                    company=company,
                    status=getattr(resp, "status_code", None),
                )
                continue
            try:
                data = resp.json()
            except ValueError:
                continue
            # Tenants return either ``{"jobs":[…]}`` or a bare list; cope with both.
            jobs = data.get("jobs") if isinstance(data, dict) else data
            if not isinstance(jobs, list):
                continue
            for job in jobs:
                if isinstance(job, dict):
                    job["_company"] = company
                    yield job

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("title") or raw.get("job_title")
        if not title:
            return None
        company_slug = raw.get("_company", "")
        city = raw.get("city") or ""
        state = raw.get("state") or ""
        country = raw.get("country") or None
        parts = [p for p in (city, state) if p]
        location = ", ".join(parts) or None

        posted_raw = raw.get("original_open_date") or raw.get("open_date") or raw.get("published_date")
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        description = raw.get("description") or raw.get("original_description") or ""
        snippet = clean_text(description, limit=400)
        full = clean_text(description)

        apply_url = raw.get("apply_url") or raw.get("link") or (
            f"https://{company_slug}.applytojob.com/apply/{raw.get('board_code') or raw.get('id')}"
            if raw.get("board_code") or raw.get("id")
            else None
        )

        min_s = raw.get("minimum_salary")
        max_s = raw.get("maximum_salary")
        salary: Optional[str]
        if min_s and max_s:
            salary = f"USD {min_s}–{max_s}"
        elif min_s or max_s:
            salary = f"USD {min_s or max_s}"
        else:
            salary = None

        job_id = raw.get("id")
        return JobPosting(
            job_title=title.strip(),
            company_name=company_slug.replace("-", " ").title(),
            location=location,
            country=country,
            employment_type=raw.get("employment_type"),
            department=raw.get("department"),
            salary=salary,
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=apply_url or "",
            apply_url=apply_url,
            company_careers_url=f"https://{company_slug}.applytojob.com/",
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(job_id) if job_id else None,
            requisition_id=str(raw.get("board_code")) if raw.get("board_code") else None,
            raw=raw,
        )
