"""Jobvite — public feed (no auth).

Canonical modern shape:
    GET https://jobs.jobvite.com/{slug}/feed/jobs

Older tenants still serve XML from:
    GET https://app.jobvite.com/CompanyJobs/Xml.aspx?c={code}

We try the JSON feed first (the widely-deployed modern shape) and fall
back to the legacy XML endpoint for tenants still stuck on the older
careers product.

Fields of interest (JSON):
    id, eId, title, location, city, state, country, category,
    department, description, requisitionId, datePosted, detailUrl

Fields of interest (XML):
    <job><title>, <requisitionId>, <location>, <description>,
    <postedDate>, <detailUrl>
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class JobviteScraper(BaseSourceScraper):
    name = "jobvite"
    display_name = "Jobvite"
    compliance_notes = "Public candidate feed on jobs.jobvite.com — no auth required."

    FEED_JSON = "https://jobs.jobvite.com/{slug}/feed/jobs"
    FEED_XML_LEGACY = "https://app.jobvite.com/CompanyJobs/Xml.aspx?c={code}"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        # Entries may be either "slug" (modern) or "legacy:{code}" (classic).
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for entry in self.companies:
            if entry.startswith("legacy:"):
                code = entry.split(":", 1)[1]
                yield from self._fetch_legacy_xml(code)
                continue
            yield from self._fetch_modern_json(entry)

    def _fetch_modern_json(self, slug: str) -> Iterator[dict[str, Any]]:
        url = self.FEED_JSON.format(slug=slug)
        resp = self.http.get(url, headers={"Accept": "application/json, */*;q=0.9"})
        if not resp or resp.status_code != 200:
            self.log.info(
                "company.miss",
                company=slug,
                status=getattr(resp, "status_code", None),
            )
            return
        try:
            data = resp.json()
        except ValueError:
            # Some tenants return XML on this path; hand off.
            yield from self._parse_xml_body(resp.text, slug=slug)
            return
        # Both ``{"jobs":[…]}`` and a bare list have been observed.
        jobs = data.get("jobs") if isinstance(data, dict) else data
        if not isinstance(jobs, list):
            return
        for job in jobs:
            if isinstance(job, dict):
                job["_slug"] = slug
                yield job

    def _fetch_legacy_xml(self, code: str) -> Iterator[dict[str, Any]]:
        url = self.FEED_XML_LEGACY.format(code=code)
        resp = self.http.get(url, headers={"Accept": "application/xml, text/xml, */*;q=0.9"})
        if not resp or resp.status_code != 200 or not resp.text:
            self.log.info("company.miss", company=f"legacy:{code}", status=getattr(resp, "status_code", None))
            return
        yield from self._parse_xml_body(resp.text, slug=f"legacy:{code}")

    def _parse_xml_body(self, body: str, *, slug: str) -> Iterator[dict[str, Any]]:
        try:
            root = ET.fromstring(body)
        except ET.ParseError:
            return
        for job in root.iter("job"):
            rec: dict[str, Any] = {"_slug": slug}
            for child in job:
                text = (child.text or "").strip()
                if text:
                    rec[child.tag] = text
            yield rec

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("title") or raw.get("jobTitle")
        if not title:
            return None
        slug = raw.get("_slug", "")
        city = raw.get("city") or ""
        state = raw.get("state") or ""
        country = raw.get("country") or None
        location = raw.get("location")
        if not location:
            parts = [p for p in (city, state) if p]
            location = ", ".join(parts) or None

        posted_raw = raw.get("datePosted") or raw.get("postedDate") or raw.get("published")
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        description = raw.get("description") or raw.get("jobDescription") or ""
        snippet = clean_text(description, limit=400)
        full = clean_text(description)

        apply_url = raw.get("detailUrl") or raw.get("jobUrl") or raw.get("apply_url")
        job_id = raw.get("id") or raw.get("eId")
        req_id = raw.get("requisitionId")

        return JobPosting(
            job_title=title.strip(),
            company_name=slug.split(":")[-1].replace("-", " ").title(),
            location=location,
            country=country,
            employment_type=raw.get("category"),
            department=raw.get("department") or raw.get("team"),
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=apply_url or "",
            apply_url=apply_url,
            company_careers_url=f"https://jobs.jobvite.com/{slug}/" if not slug.startswith("legacy:") else None,
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(job_id) if job_id else None,
            requisition_id=str(req_id) if req_id else None,
            raw=raw,
        )
