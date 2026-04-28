"""Adzuna — aggregator API (free tier ~250 calls/month).

Docs: https://developer.adzuna.com/docs/search
Note: Adzuna indexes Indeed-like listings under a *compliant license*, which is
why we use it instead of scraping Indeed directly.
"""
from __future__ import annotations

from typing import Any, Iterator, Optional

from config import TARGET_TITLES, settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class AdzunaScraper(BaseSourceScraper):
    name = "adzuna"
    display_name = "Adzuna (US)"
    compliance_notes = "Official aggregator API. Requires free App ID + Key."

    BASE = "https://api.adzuna.com/v1/api/jobs/us/search/{page}"

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        if not settings.adzuna_app_id or not settings.adzuna_app_key:
            self.log.info("adzuna.skipped", reason="missing credentials")
            return
        for keyword in TARGET_TITLES:
            for page in range(1, 4):  # cap to 3 pages per keyword
                resp = self.http.get(
                    self.BASE.format(page=page),
                    params={
                        "app_id": settings.adzuna_app_id,
                        "app_key": settings.adzuna_app_key,
                        "what_phrase": keyword,
                        "where": "United States",
                        "results_per_page": 50,
                        "max_days_old": 1,
                        "content-type": "application/json",
                    },
                )
                if not resp or resp.status_code != 200:
                    break
                try:
                    data = resp.json()
                except ValueError:
                    break
                results = data.get("results") or []
                for job in results:
                    yield job
                if len(results) < 50:
                    break

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("title")
        if not title:
            return None
        loc = (raw.get("location") or {}).get("display_name")
        posted = raw.get("created")
        posted_dt = parse_posted(posted) if posted else None
        salary = None
        if raw.get("salary_min") and raw.get("salary_max"):
            salary = f"${int(raw['salary_min'])}-${int(raw['salary_max'])} {raw.get('salary_is_predicted') and '(est.)' or ''}".strip()
        category = (raw.get("category") or {}).get("label")
        # Adzuna's `redirect_url` 302s through Adzuna to the underlying ATS URL.
        # The final resolved URL is the cross-portal join key, but resolving it
        # is expensive — keep it as-is and rely on content_hash instead.
        redirect = raw.get("redirect_url", "")
        return JobPosting(
            job_title=title.strip(),
            company_name=(raw.get("company") or {}).get("display_name", "Unknown"),
            location=loc,
            country="US",
            employment_type=raw.get("contract_type") or raw.get("contract_time"),
            salary=salary,
            department=category,
            date_posted_raw=posted,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=redirect,
            apply_url=redirect or None,
            source_job_id=str(raw.get("id")),
            # Adzuna re-indexes listings aggressively and doesn't expose the
            # underlying ATS requisition — treat content_hash as the dedupe key.
            job_description_snippet=clean_text(raw.get("description"), limit=400),
            full_job_description=clean_text(raw.get("description")),
            raw=raw,
        )
