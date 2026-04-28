"""RemoteOK — public JSON feed. Remote jobs only; we keep US-eligible ones.

Endpoint: https://remoteok.com/api
Compliance: public API (see https://remoteok.com/api). Honor their rate limits.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class RemoteOKScraper(BaseSourceScraper):
    name = "remoteok"
    display_name = "RemoteOK"
    compliance_notes = "Public JSON API documented by RemoteOK."

    URL = "https://remoteok.com/api"

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        resp = self.http.get(self.URL)
        if not resp or resp.status_code != 200:
            return
        try:
            data = resp.json()
        except ValueError:
            return
        # First element is a legend object.
        for job in data[1:] if data and isinstance(data, list) else []:
            yield job

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("position") or raw.get("title")
        if not title:
            return None
        date = raw.get("date") or raw.get("epoch")
        posted_dt: Optional[datetime] = None
        if isinstance(date, (int, float)):
            posted_dt = datetime.fromtimestamp(float(date), tz=timezone.utc)
        else:
            posted_dt = parse_posted(date) if date else None

        location = raw.get("location") or "Remote"
        regions = [r.lower() for r in (raw.get("region") or []) if isinstance(r, str)]
        if regions and not any("usa" in r or "us-only" in r or "united states" in r or "worldwide" in r or "americas" in r for r in regions):
            # If regions are specified and none are US-compatible, skip.
            if "remote" not in location.lower():
                return None

        url = raw.get("url") or raw.get("apply_url") or ""
        apply_u = raw.get("apply_url") or url
        # RemoteOK's `slug` is stable across edits of the same posting and
        # changes on delete+repost — it's the best requisition analogue.
        slug = raw.get("slug")
        return JobPosting(
            job_title=title.strip(),
            company_name=raw.get("company") or "Unknown",
            location=location,
            country=None,
            remote_type="remote",
            salary=raw.get("salary") or (
                f"${raw['salary_min']}-${raw['salary_max']}"
                if raw.get("salary_min") and raw.get("salary_max")
                else None
            ),
            date_posted_raw=str(date) if date else None,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=url,
            apply_url=apply_u,
            company_careers_url=raw.get("company_logo"),
            source_job_id=str(raw.get("id") or slug),
            requisition_id=slug,
            job_description_snippet=clean_text(raw.get("description"), limit=400),
            full_job_description=clean_text(raw.get("description")),
            raw=raw,
        )
