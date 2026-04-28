"""Discover slugs by parsing vendor sitemaps (purely compliant: sitemaps
exist to be consumed).

Lever serves per-tenant pages under jobs.lever.co/{slug}. Their root sitemap
may list them; we also probe the /robots.txt for the sitemap URL.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from src.http_client import HttpClient
from src.logging_config import get_logger

log = get_logger(__name__)


LEVER_HOST = "jobs.lever.co"
ASHBY_HOST = "jobs.ashbyhq.com"
WORKABLE_HOST = "apply.workable.com"
GREENHOUSE_HOST = "boards.greenhouse.io"

_SITEMAP_URL_RX = re.compile(r"<loc>\s*([^<]+)\s*</loc>", re.I)
_LEVER_SLUG_RX = re.compile(r"https?://jobs\.lever\.co/([^/]+)", re.I)
_ASHBY_SLUG_RX = re.compile(r"https?://jobs\.ashbyhq\.com/([^/]+)", re.I)
_WORKABLE_SLUG_RX = re.compile(r"https?://apply\.workable\.com/([^/]+)", re.I)
_GREENHOUSE_SLUG_RX = re.compile(r"https?://boards\.greenhouse\.io/([^/]+)", re.I)


_HOST_RX = {
    "lever": _LEVER_SLUG_RX,
    "ashby": _ASHBY_SLUG_RX,
    "workable": _WORKABLE_SLUG_RX,
    "greenhouse": _GREENHOUSE_SLUG_RX,
}

_ROOT_URLS = {
    "lever": [
        "https://jobs.lever.co/sitemap.xml",
        "https://jobs.lever.co/robots.txt",
    ],
    "ashby": [
        "https://jobs.ashbyhq.com/sitemap.xml",
    ],
    "workable": [
        "https://apply.workable.com/sitemap.xml",
    ],
    "greenhouse": [
        "https://boards.greenhouse.io/sitemap.xml",
        "https://boards.greenhouse.io/robots.txt",
    ],
}


def fetch(source_name: str, http: HttpClient | None = None, *, max_nested: int = 8) -> list[str]:
    roots = _ROOT_URLS.get(source_name)
    rx = _HOST_RX.get(source_name)
    if not roots or not rx:
        return []
    owns_http = http is None
    http = http or HttpClient()
    slugs: set[str] = set()
    try:
        urls_to_scan: list[str] = list(roots)
        seen_sitemaps: set[str] = set()
        while urls_to_scan and len(seen_sitemaps) <= max_nested:
            url = urls_to_scan.pop(0)
            if url in seen_sitemaps:
                continue
            seen_sitemaps.add(url)
            resp = http.get(url)
            if not resp or resp.status_code != 200:
                continue
            body = resp.text
            # If it's a robots.txt, harvest sitemap URLs.
            if url.endswith("robots.txt"):
                for m in re.finditer(r"(?mi)^Sitemap:\s*(\S+)", body):
                    urls_to_scan.append(m.group(1).strip())
                continue
            locs = _SITEMAP_URL_RX.findall(body)
            if not locs:
                continue
            # Either a sitemap-index or a urlset — handle both.
            for loc in locs:
                if loc.endswith(".xml") or "sitemap" in loc:
                    urls_to_scan.append(loc)
                m = rx.search(loc)
                if m:
                    slugs.add(m.group(1).strip("/"))
        log.info("sitemap.done", source=source_name, found=len(slugs))
    finally:
        if owns_http:
            http.close()
    return sorted(slugs)
