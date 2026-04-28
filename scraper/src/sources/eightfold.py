"""Eightfold AI — public careers JSON (undocumented but stable).

Fingerprint (see ``docs/ATS_FINGERPRINTS.md``):
    GET https://{tenant}.eightfold.ai/careers/api/jobs
        ?domain={tenant}&start=0&num=100&sort_by=relevance

Response shape (abbreviated):

    {
      "positions": [
        {
          "id": 12345,
          "ats_job_id": "R-98765",   # <-- cross-ATS goldmine when Eightfold fronts Workday/SF
          "display_job_id": "ENG-21",
          "name": "Senior Software Engineer",
          "business_unit": "Platform",
          "department": "Engineering",
          "location": "Remote - US",
          "city": "…", "state": "…", "country": "US",
          "posted_on": "2026-04-10",
          "last_modified": "2026-04-12",
          "job_description": "<p>…</p>",
          "canonicalPositionUrl": "https://…eightfold.ai/careers?pid=12345"
        }
      ]
    }

Eightfold is important for cross-portal dedupe: for employers where
Eightfold is the candidate-facing layer over an underlying Workday or
SuccessFactors tenant, ``ats_job_id`` is exactly the requisition id the
underlying ATS emits. That lets the classifier link postings across
platforms.

Compliance: the endpoint powers their own careers UI and is unauthenticated;
rate limits are generous. We still page politely.
"""
from __future__ import annotations

from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class EightfoldScraper(BaseSourceScraper):
    name = "eightfold"
    display_name = "Eightfold AI"
    compliance_notes = "Public careers XHR endpoint on eightfold.ai — no auth required."

    BASE = "https://{tenant}.eightfold.ai/careers/api/jobs"
    PAGE_SIZE = 100

    def __init__(self, tenants: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.tenants = tenants or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for tenant in self.tenants:
            yield from self._fetch_tenant(tenant)

    def _fetch_tenant(self, tenant: str) -> Iterator[dict[str, Any]]:
        url = self.BASE.format(tenant=tenant)
        start = 0
        # Eightfold requires a Referer matching the careers page for some tenants.
        headers = {
            "Accept": "application/json",
            "Referer": f"https://{tenant}.eightfold.ai/careers",
        }
        while True:
            resp = self.http.get(
                url,
                params={
                    "domain": tenant,
                    "start": start,
                    "num": self.PAGE_SIZE,
                    "sort_by": "relevance",
                },
                headers=headers,
            )
            if not resp or resp.status_code != 200:
                self.log.info(
                    "tenant.miss",
                    tenant=tenant,
                    status=getattr(resp, "status_code", None),
                )
                return
            try:
                data = resp.json()
            except ValueError:
                return
            positions = data.get("positions") or []
            if not isinstance(positions, list) or not positions:
                return
            for pos in positions:
                if isinstance(pos, dict):
                    pos["_tenant"] = tenant
                    yield pos
            # Eightfold returns ``count`` as the grand total when present; if
            # we've already pulled enough or the page wasn't full, stop.
            total = data.get("count")
            start += len(positions)
            if isinstance(total, int) and start >= total:
                return
            if len(positions) < self.PAGE_SIZE:
                return

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("name") or raw.get("title")
        if not title:
            return None
        tenant = raw.get("_tenant", "")
        city = raw.get("city") or ""
        state = raw.get("state") or ""
        country = raw.get("country") or None
        location = raw.get("location")
        if not location:
            parts = [p for p in (city, state) if p]
            location = ", ".join(parts) or None

        posted_raw = raw.get("posted_on") or raw.get("date_posted")
        posted_dt = parse_posted(posted_raw) if posted_raw else None
        updated_raw = raw.get("last_modified") or raw.get("updated_on")
        updated_dt = parse_posted(updated_raw) if updated_raw else None

        description = raw.get("job_description") or raw.get("description") or ""
        snippet = clean_text(description, limit=400)
        full = clean_text(description)

        apply_url = (
            raw.get("canonicalPositionUrl")
            or raw.get("detail_url")
            or (f"https://{tenant}.eightfold.ai/careers?pid={raw.get('id')}" if raw.get("id") else None)
        )

        job_id = raw.get("id")
        # ``ats_job_id`` is the underlying ATS req id when Eightfold fronts
        # another platform; that's the most stable cross-portal key. Fall back
        # to ``display_job_id`` which is the req number shown to candidates.
        req_id = raw.get("ats_job_id") or raw.get("display_job_id")

        return JobPosting(
            job_title=title.strip(),
            company_name=tenant.replace("-", " ").title(),
            location=location,
            country=country,
            employment_type=raw.get("employment_type"),
            department=raw.get("department") or raw.get("business_unit"),
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            date_updated_raw=updated_raw,
            date_updated_normalized=updated_dt,
            source_platform=self.name,
            source_url=apply_url or "",
            apply_url=apply_url,
            company_careers_url=f"https://{tenant}.eightfold.ai/careers",
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(job_id) if job_id is not None else None,
            requisition_id=str(req_id) if req_id else None,
            raw=raw,
        )
