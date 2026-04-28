"""Recruitee (Tellent) — public Careers Site API (no auth).

Docs: https://docs.recruitee.com/reference/intro-to-careers-site-api
Endpoint: GET https://{company}.recruitee.com/api/offers/

Compliance: documented public API designed for programmatic use. No auth
required for the careers-site read endpoints. The ``offers`` array is the
same one rendered on the careers page, so no TOS concern.

Fields we rely on
-----------------
- ``id`` (int) — stable while the posting is live; reused slot on re-post
  is rare but possible → still emit as ``source_job_id``, not as the
  repost fingerprint.
- ``slug`` — URL-stable; we join it to build ``careers_url``.
- ``title``, ``location``, ``country_code``, ``city``, ``remote``
- ``created_at``, ``published_at``, ``updated_at`` — ISO-8601.
- ``description`` — HTML. We run it through ``clean_text`` for the
  snippet and keep the full body for ``full_job_description``.
- ``department`` — string (optional).
"""
from __future__ import annotations

from typing import Any, Iterator, Optional

from config import settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class RecruiteeScraper(BaseSourceScraper):
    name = "recruitee"
    display_name = "Recruitee"
    compliance_notes = "Public Careers Site API (docs.recruitee.com) — no auth required."

    BASE = "https://{company}.recruitee.com/api/offers/"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for company in self.companies:
            url = self.BASE.format(company=company)
            resp = self.http.get(url)
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
            offers = data.get("offers") or []
            if not isinstance(offers, list):
                continue
            for offer in offers:
                if isinstance(offer, dict):
                    offer["_company"] = company
                    yield offer

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("title")
        if not title:
            return None
        company_slug = raw.get("_company", "")
        # Recruitee's "careers_url" is the canonical apply link when available.
        careers_url = raw.get("careers_url") or raw.get("careers_apply_url")
        slug = raw.get("slug") or ""
        if not careers_url and slug:
            careers_url = f"https://{company_slug}.recruitee.com/o/{slug}"

        # Location: prefer explicit city+country; else fall back to ``location`` string.
        city = raw.get("city")
        country = raw.get("country_code") or raw.get("country")
        if city and country:
            location = f"{city}, {country}"
        else:
            location = raw.get("location") or city or country

        remote = "remote" if raw.get("remote") else None

        posted_raw = raw.get("published_at") or raw.get("created_at")
        posted_dt = parse_posted(posted_raw) if posted_raw else None
        updated_raw = raw.get("updated_at")
        updated_dt = parse_posted(updated_raw) if updated_raw else None

        description = raw.get("description") or ""
        snippet = clean_text(description, limit=400)
        full = clean_text(description)

        department = None
        dept = raw.get("department")
        if isinstance(dept, dict):
            department = dept.get("name")
        elif isinstance(dept, str):
            department = dept

        job_id = raw.get("id")
        return JobPosting(
            job_title=title.strip(),
            company_name=str(raw.get("company_name") or company_slug).replace("-", " ").title(),
            location=location,
            country=country,
            remote_type=remote,
            employment_type=raw.get("employment_type_code") or raw.get("employment_type"),
            department=department,
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            date_updated_raw=updated_raw,
            date_updated_normalized=updated_dt,
            source_platform=self.name,
            source_url=careers_url or "",
            apply_url=careers_url,
            company_careers_url=f"https://{company_slug}.recruitee.com/",
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(job_id) if job_id is not None else None,
            requisition_id=None,
            raw=raw,
        )
