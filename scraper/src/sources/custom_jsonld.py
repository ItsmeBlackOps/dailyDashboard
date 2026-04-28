"""Generic custom-site source — runs the schema.org JSON-LD extractor
against an operator-supplied list of career-page URLs.

Purpose
-------
Not every US IT employer sits on one of the 22 ATS platforms we detect
natively. A long tail of large companies ship their own bespoke career
sites (Meta's `metacareers.com`, Google's `careers.google.com`,
Microsoft's `careers.microsoft.com`, etc.) but almost all of them embed
schema.org ``JobPosting`` JSON-LD because Google Jobs requires it.

This connector turns that universal signal into a first-class source: give
it a list of URLs pointing at (a) per-job detail pages, or (b) career
index pages that link to per-job detail pages, and it emits
``JobPosting``s exactly the same way a platform connector does.

Two modes
---------

* **Direct URL mode** — each entry is a job-detail URL; extract in place.
* **Index-follow mode** — prefix an entry with ``index:`` and we fetch
  the index, extract same-host ``<a href>`` candidates that look like
  job-detail URLs, then extract JSON-LD from each. Bounded by
  ``max_per_index`` so a huge index doesn't explode the run.

Config
------
Entries come from ``CUSTOM_JSONLD_URLS`` env var (CSV). Example::

    CUSTOM_JSONLD_URLS=\
        https://careers.example.com/job/12345,\
        index:https://careers.otherco.com/search?q=engineering

Compliance
----------
JSON-LD is intended for crawler consumption (Google Jobs). The same
politeness rules as the rest of the project (per-host throttling via
``HttpClient``) apply.
"""
from __future__ import annotations

import re
from typing import Any, Iterator, Optional
from urllib.parse import urljoin, urlparse

from src.base import BaseSourceScraper
from src.discovery.detect import has_jsonld_jobposting
from src.discovery.generic_extractor import extract_from_html
from src.models import JobPosting

# Detail-page candidates: any anchor href containing one of these substrings.
# Deliberately loose — tens of career-site URL styles exist in the wild.
_HREF_RE = re.compile(r'href="([^"#\s]+)"', re.IGNORECASE)
_DETAIL_HINTS: tuple[str, ...] = (
    "/jobs/", "/job/", "/careers/", "/career/",
    "/position/", "/opening/", "/opportunity/", "/req/",
    "jobid=", "requisitionid=",
)


class CustomJsonLdScraper(BaseSourceScraper):
    name = "custom_jsonld"
    display_name = "Custom career sites (JSON-LD)"
    compliance_notes = (
        "schema.org JobPosting JSON-LD — same surface Google Jobs consumes. "
        "Configured per-URL; operator-curated list."
    )

    def __init__(
        self,
        urls: Optional[list[str]] = None,
        *,
        max_per_index: int = 25,
        company_hints: Optional[dict[str, str]] = None,
        **kw: Any,
    ) -> None:
        super().__init__(**kw)
        self.urls = urls or []
        self.max_per_index = max_per_index
        # Map: host → company name override (lets operators give pretty names)
        self.company_hints = company_hints or {}

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for entry in self.urls:
            is_index = entry.startswith("index:")
            url = entry.split(":", 1)[1] if is_index else entry
            yield from self._scan(url, is_index=is_index)

    def _scan(self, url: str, *, is_index: bool) -> Iterator[dict[str, Any]]:
        resp = self.http.get(url)
        if not resp or resp.status_code != 200 or not resp.text:
            self.log.info("url.miss", url=url, status=getattr(resp, "status_code", None))
            return
        host = urlparse(url).netloc.lower()
        company_hint = self.company_hints.get(host) or _pretty_hint(host)

        # Direct extraction always runs — index pages often carry JSON-LD too.
        if has_jsonld_jobposting(resp.text):
            for jp in extract_from_html(
                resp.text,
                source_url=url,
                source_platform=self.name,
                company_hint=company_hint,
            ):
                yield {"_jp": jp, "_source_url": url, "_via": "direct"}

        if not is_index:
            return

        # Follow same-host detail-like anchors (bounded).
        for detail in _extract_detail_urls(resp.text, base=url, max_items=self.max_per_index):
            d = self.http.get(detail)
            if not d or d.status_code != 200 or not d.text:
                continue
            if not has_jsonld_jobposting(d.text):
                continue
            for jp in extract_from_html(
                d.text,
                source_url=detail,
                source_platform=self.name,
                company_hint=company_hint,
            ):
                yield {"_jp": jp, "_source_url": detail, "_via": "index"}

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        jp = raw.get("_jp")
        if jp is None:
            return None
        # Stamp provenance for debugging.
        jp.raw = {
            "custom_jsonld": {"via": raw.get("_via"), "src": raw.get("_source_url")},
            **(jp.raw or {}),
        }
        return jp


def _extract_detail_urls(html: str, *, base: str, max_items: int) -> list[str]:
    """Pull same-host job-detail URLs from an index page.

    Matches any ``<a href="...">`` whose href contains a detail-looking
    hint (``/jobs/``, ``/careers/``, ``jobId=``, …). Relative hrefs are
    resolved against ``base`` and cross-host anchors are dropped.
    """
    base_host = urlparse(base).netloc.lower()
    seen: set[str] = set()
    out: list[str] = []
    for m in _HREF_RE.finditer(html):
        href = m.group(1).strip()
        lowered = href.lower()
        if not any(hint in lowered for hint in _DETAIL_HINTS):
            continue
        # Normalize relative URLs against the index URL.
        absolute = urljoin(base, href)
        if urlparse(absolute).netloc.lower() != base_host:
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        out.append(absolute)
        if len(out) >= max_items:
            break
    return out


def _pretty_hint(host: str) -> Optional[str]:
    """Turn 'careers.example.com' → 'Example'."""
    if not host:
        return None
    bare = host
    for prefix in ("careers.", "jobs.", "www.", "join."):
        if bare.startswith(prefix):
            bare = bare[len(prefix):]
            break
    tld_cut = bare.rsplit(".", 1)[0] if "." in bare else bare
    if not tld_cut:
        return None
    return tld_cut.replace("-", " ").replace("_", " ").title()
