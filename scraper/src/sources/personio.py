"""Personio — public XML feed (no auth).

Docs: https://developer.personio.de/docs/integration-via-iframe
Endpoint: GET https://{company}.jobs.personio.de/xml

Personio exposes the full public job list as an ``<XML>`` document that
any employer using their careers-site product can serve unauthenticated.
The shape has been stable for years and is what their own iframe widget
consumes.

Shape
-----
::

    <workzag-jobs>
      <position>
        <id>1234567</id>
        <subcompany>Engineering</subcompany>
        <office>Berlin</office>
        <department>Platform</department>
        <recruitingCategory>IT</recruitingCategory>
        <name>Senior Backend Engineer</name>
        <jobDescriptions>
          <jobDescription>
            <name>Your role</name>
            <value><![CDATA[<p>…HTML…</p>]]></value>
          </jobDescription>
        </jobDescriptions>
        <employmentType>permanent</employmentType>
        <seniority>senior</seniority>
        <schedule>full-time</schedule>
        <yearsOfExperience>5-7</yearsOfExperience>
        <keywords>python,aws</keywords>
        <occupation>software_engineering</occupation>
        <occupationCategory>IT</occupationCategory>
        <createdAt>2026-04-01T12:00:00+02:00</createdAt>
      </position>
    </workzag-jobs>
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class PersonioScraper(BaseSourceScraper):
    name = "personio"
    display_name = "Personio Jobs"
    compliance_notes = "Public XML feed (developer.personio.de) — no auth required."

    BASE_COM = "https://{company}.jobs.personio.com/xml"
    BASE_DE = "https://{company}.jobs.personio.de/xml"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or []

    def _fetch_one(self, company: str) -> Optional[ET.Element]:
        for tmpl in (self.BASE_COM, self.BASE_DE):
            url = tmpl.format(company=company)
            resp = self.http.get(url, headers={"Accept": "application/xml, text/xml, */*;q=0.9"})
            if not resp or resp.status_code != 200 or not resp.text:
                continue
            # Detect HTML interstitials that masquerade as 200s.
            head = resp.text[:200].lstrip().lower()
            if not head.startswith("<?xml") and "<workzag-jobs" not in head:
                continue
            try:
                return ET.fromstring(resp.text)
            except ET.ParseError:
                continue
        return None

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for company in self.companies:
            root = self._fetch_one(company)
            if root is None:
                self.log.info("company.miss", company=company)
                continue
            for pos in root.iter("position"):
                yield _element_to_dict(pos, company=company)

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("name")
        if not title:
            return None
        company_slug = raw.get("_company", "")
        office = raw.get("office") or ""
        department = raw.get("department") or None
        subcompany = raw.get("subcompany") or ""
        posted_raw = raw.get("createdAt")
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        description_parts: list[str] = []
        for block in raw.get("_descriptions", []):
            heading = block.get("name") or ""
            body = block.get("value") or ""
            if heading:
                description_parts.append(f"<h3>{heading}</h3>")
            description_parts.append(body)
        description_html = "\n".join(description_parts)
        snippet = clean_text(description_html, limit=400)
        full = clean_text(description_html)

        job_id = raw.get("id")
        apply_url = f"https://{company_slug}.jobs.personio.com/job/{job_id}" if job_id else None

        employment = raw.get("employmentType") or raw.get("schedule")
        seniority = raw.get("seniority") or None
        return JobPosting(
            job_title=title.strip(),
            company_name=(subcompany or company_slug).replace("-", " ").title(),
            location=office or None,
            country=None,
            employment_type=employment,
            seniority=seniority.lower() if isinstance(seniority, str) else None,
            department=department,
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=apply_url or "",
            apply_url=apply_url,
            company_careers_url=f"https://{company_slug}.jobs.personio.com/",
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(job_id) if job_id else None,
            # Personio's id is durable across edits on the same posting and is
            # the closest thing they expose to a requisition number, so we
            # promote it into requisition_id when present.
            requisition_id=str(job_id) if job_id else None,
            raw=raw,
        )


def _element_to_dict(pos: ET.Element, *, company: str) -> dict[str, Any]:
    """Collapse a <position> element into a flat dict our parser consumes."""
    out: dict[str, Any] = {"_company": company}
    for child in pos:
        tag = child.tag
        if tag == "jobDescriptions":
            blocks: list[dict[str, str]] = []
            for jd in child.iter("jobDescription"):
                blocks.append({
                    "name": (jd.findtext("name") or "").strip(),
                    "value": (jd.findtext("value") or "").strip(),
                })
            out["_descriptions"] = blocks
            continue
        text = (child.text or "").strip()
        if text:
            out[tag] = text
    return out
