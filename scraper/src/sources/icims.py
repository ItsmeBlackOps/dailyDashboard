"""iCIMS — sitemap-based harvester.

iCIMS exposes every job on a tenant's career portal through a public sitemap:

    https://careers-{company}.icims.com/sitemap.xml

Each `<url>` element has:
  * `<loc>`     — URL of the form `/jobs/{id}/{slug}/job` (id is numeric,
                  slug is the title-as-URL). Numeric id is stable across
                  edits; a repost gets a new id.
  * `<lastmod>` — ISO timestamp that ticks on any edit. This is the single
                  most reliable freshness signal across any ATS we've surveyed.

Strategy:
  1. Fetch sitemap once per tenant.
  2. For each URL matching `/jobs/{id}/{slug}/job`, parse out id + slug.
  3. The slug is the title in URL form — we convert it back to a best-effort
     human title. This is enough for the TARGET_TITLES filter to decide
     whether to keep the listing.
  4. Emit a JobPosting with `date_updated_normalized=lastmod`. A follow-up
     hydration pass (not implemented here) can fetch the job page HTML when
     we actually want the full description.

This connector does NOT fetch per-job HTML — that would be expensive at
scale and the sitemap alone is enough to run title + freshness filtering
before the hydration step.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterator, Optional
from xml.etree import ElementTree as ET

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.recency import parse_posted


# /jobs/{id}/{slug}/job  — id is numeric, slug has hyphens
_JOB_URL_RX = re.compile(r"/jobs/(\d+)/([^/]+)/job/?")
_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def _slug_to_title(slug: str) -> str:
    # iCIMS slugs are lowercase-kebab-case, e.g. "senior-data-analyst-fraud".
    return slug.replace("-", " ").strip().title()


def _company_from_host(host: str) -> str:
    # careers-{company}.icims.com → {company}
    m = re.match(r"careers-([a-z0-9\-]+)\.icims\.com$", host, re.I)
    if m:
        return m.group(1).replace("-", " ").title()
    return host.split(".")[0].title()


class ICIMSScraper(BaseSourceScraper):
    name = "icims"
    display_name = "iCIMS"
    compliance_notes = (
        "Public sitemap.xml at careers-{company}.icims.com/sitemap.xml. "
        "iCIMS publishes sitemaps to enable crawlers, but gates them behind "
        "a WAF: requests from non-whitelisted IPs get a 403/405 'Your IP "
        "is not on a trusted network' page regardless of URL or UA. "
        "Operators must either run from a trusted egress IP or drop iCIMS."
    )

    SITEMAP = "https://careers-{company}.icims.com/sitemap.xml"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for company in self.companies:
            url = self.SITEMAP.format(company=company)
            # iCIMS sitemaps are XML — set the Accept header explicitly so the
            # WAF can at least distinguish us from a browser and decide
            # whether to serve the feed. Doesn't bypass the WAF itself.
            resp = self.http.get(
                url,
                headers={"Accept": "application/xml,text/xml,*/*;q=0.9"},
            )
            if not resp or resp.status_code != 200:
                # 403/405 here almost always means the iCIMS WAF blocked us
                # — expected on untrusted egress. Don't escalate to WARNING:
                # it would fire every cycle for every tenant and drown the
                # actually-actionable warnings from other sources.
                self.log.info(
                    "sitemap.blocked", company=company,
                    status=getattr(resp, "status_code", None),
                )
                continue
            # A 200 with HTML (WAF interstitial) is also a block — real
            # sitemaps start with `<?xml` or `<urlset`.
            head = (resp.text or "")[:200].lstrip().lower()
            if not head.startswith("<?xml") and "<urlset" not in head:
                self.log.info(
                    "sitemap.blocked", company=company, status=200,
                    reason="non-xml body (WAF interstitial)",
                )
                continue
            try:
                root = ET.fromstring(resp.text)
            except ET.ParseError as e:
                self.log.warning("sitemap.parse_error", company=company, error=str(e))
                continue
            for url_elem in root.findall(f"{_NS}url"):
                loc_elem = url_elem.find(f"{_NS}loc")
                if loc_elem is None or not loc_elem.text:
                    continue
                loc = loc_elem.text.strip()
                m = _JOB_URL_RX.search(loc)
                if not m:
                    continue
                job_id, slug = m.group(1), m.group(2)
                lastmod_elem = url_elem.find(f"{_NS}lastmod")
                lastmod = lastmod_elem.text.strip() if lastmod_elem is not None and lastmod_elem.text else None
                yield {
                    "_company": company,
                    "_loc": loc,
                    "_id": job_id,
                    "_slug": slug,
                    "_lastmod": lastmod,
                }

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = _slug_to_title(raw["_slug"])
        if not title:
            return None
        lastmod = raw.get("_lastmod")
        lastmod_dt = parse_posted(lastmod) if lastmod else None
        if lastmod_dt and lastmod_dt.tzinfo is None:
            lastmod_dt = lastmod_dt.replace(tzinfo=timezone.utc)
        company_slug = raw.get("_company", "")
        company_display = company_slug.replace("-", " ").title() if company_slug else "Unknown"
        url = raw["_loc"]
        return JobPosting(
            job_title=title,
            company_name=company_display,
            location=None,  # sitemap doesn't expose location — hydration pass would fill this
            country="US",   # all companies in our seed list are US employers; looks_us() needs
                            # this hint because location=None (sitemap has no location field).
            # iCIMS doesn't separate first-posted from last-modified in the sitemap,
            # so treat lastmod as both posted and updated. The classifier's
            # content_hash will still detect real edits via description diff
            # once the hydration pass runs.
            date_posted_raw=lastmod,
            date_posted_normalized=lastmod_dt,
            date_updated_raw=lastmod,
            date_updated_normalized=lastmod_dt,
            source_platform=self.name,
            source_url=url,
            apply_url=url,
            company_careers_url=f"https://careers-{company_slug}.icims.com/",
            source_job_id=raw["_id"],
            # iCIMS doesn't expose a separate requisition_id on the sitemap; the
            # numeric URL id is the closest stable analogue within a tenant.
            requisition_id=raw["_id"],
            raw=raw,
        )
