"""Teamtailor — JSON-LD on the public careers page.

Teamtailor's documented JSON API requires an API key (``Authorization:
Token token=…``) so we can't hit it without credentials. However:

1. Every Teamtailor-hosted careers page and every job-detail page ships
   schema.org ``JobPosting`` JSON-LD (they advertise it as part of their
   Google-for-Jobs integration).
2. The careers index at ``{slug}.teamtailor.com/jobs`` lists every open
   role with an absolute URL to the detail page.

So this connector is a thin wrapper around ``discovery.generic_extractor``:
fetch the index, scrape detail URLs, run the JSON-LD extractor over each
one, emit ``JobPosting``s with ``source_platform="teamtailor"``.

Compliance: the JSON-LD blob is intended for crawler consumption (Google
Jobs). This is the same data surface a search-engine bot reads. We pace
politely via the shared HttpClient.
"""
from __future__ import annotations

import re
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.discovery.generic_extractor import extract_from_html
from src.models import JobPosting

_JOB_HREF_RE = re.compile(r'href="(https?://[^"]+\.teamtailor\.com/jobs/[^"#?]+)"')


class TeamtailorScraper(BaseSourceScraper):
    name = "teamtailor"
    display_name = "Teamtailor (via JSON-LD)"
    compliance_notes = (
        "Public careers page parsed for schema.org JobPosting JSON-LD — "
        "same surface Google Jobs consumes."
    )

    INDEX = "https://{slug}.teamtailor.com/jobs"

    def __init__(self, companies: Optional[list[str]] = None, max_per_tenant: int = 100, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or []
        self.max_per_tenant = max_per_tenant

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for slug in self.companies:
            index_url = self.INDEX.format(slug=slug)
            resp = self.http.get(index_url)
            if not resp or resp.status_code != 200 or not resp.text:
                self.log.info(
                    "company.miss",
                    company=slug,
                    status=getattr(resp, "status_code", None),
                )
                continue
            # Teamtailor ships JSON-LD on the *index* too (often a summary
            # one per job). That alone is enough to cover most tenants.
            for jp in extract_from_html(
                resp.text,
                source_url=index_url,
                source_platform=self.name,
                company_hint=slug.replace("-", " ").title(),
            ):
                yield {"_jp": jp, "_slug": slug, "_source": "index"}

            # Best-effort: some tenants put JSON-LD only on detail pages.
            detail_urls = _extract_detail_urls(resp.text, max_items=self.max_per_tenant)
            for url in detail_urls:
                d_resp = self.http.get(url)
                if not d_resp or d_resp.status_code != 200 or not d_resp.text:
                    continue
                for jp in extract_from_html(
                    d_resp.text,
                    source_url=url,
                    source_platform=self.name,
                    company_hint=slug.replace("-", " ").title(),
                ):
                    yield {"_jp": jp, "_slug": slug, "_source": "detail"}

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        jp = raw.get("_jp")
        if jp is None:
            return None
        # Enforce the company_careers_url so downstream reporting can link
        # back even when the JSON-LD's ``url`` field points deep.
        slug = raw.get("_slug", "")
        jp.company_careers_url = f"https://{slug}.teamtailor.com/jobs"
        # Give raw dict a provenance breadcrumb for debugging.
        jp.raw = {"teamtailor": {"slug": slug, "via": raw.get("_source")},
                  **(jp.raw or {})}
        return jp


def _extract_detail_urls(html: str, *, max_items: int) -> list[str]:
    """Pull unique job-detail URLs out of an index page (bounded)."""
    seen: set[str] = set()
    out: list[str] = []
    for m in _JOB_HREF_RE.finditer(html):
        url = m.group(1)
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
        if len(out) >= max_items:
            break
    return out
