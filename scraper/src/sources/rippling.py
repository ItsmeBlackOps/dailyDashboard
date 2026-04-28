"""Rippling ATS — public career page, JSON blob via ``__NEXT_DATA__``.

Rippling's candidate-facing career page is a Next.js SPA at
``https://ats.rippling.com/{slug}/jobs``. Every page ships its fully
hydrated state inside ``<script id="__NEXT_DATA__" type="application/json">``
under ``props.pageProps.jobs`` (path varies slightly across tenants — we
walk the blob defensively).

Why parse `__NEXT_DATA__` rather than calling their private API?
------------------------------------------------------------------
- The SPA's internal ``/api/ats/v1/...`` endpoints are undocumented and
  occasionally rate-limited per session.
- ``__NEXT_DATA__`` is a *documented* Next.js mechanism for SSR hydration
  and is a legitimate reading path for any HTML consumer (search
  engines, accessibility tools, etc.). Same surface Google sees.
- It yields the same data in one request per tenant — cheaper and more
  stable than paginating an XHR endpoint.

No ``updatedAt`` / ``publishedAt`` on the list view. Rippling does not
expose freshness metadata on the list endpoint (same caveat as Lever);
edit detection therefore falls through to ``content_hash``.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted

_NEXT_DATA_RE = re.compile(
    r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


class RipplingScraper(BaseSourceScraper):
    name = "rippling"
    display_name = "Rippling ATS"
    compliance_notes = (
        "Public Next.js career page on ats.rippling.com — parsed via the "
        "standard __NEXT_DATA__ hydration blob. No auth required."
    )

    BASE = "https://ats.rippling.com/{slug}/jobs"

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or []

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for slug in self.companies:
            url = self.BASE.format(slug=slug)
            resp = self.http.get(url, headers={"Accept": "text/html,*/*;q=0.9"})
            if not resp or resp.status_code != 200 or not resp.text:
                self.log.info(
                    "company.miss",
                    company=slug,
                    status=getattr(resp, "status_code", None),
                )
                continue
            blob = _extract_next_data(resp.text)
            if blob is None:
                self.log.info("company.no_next_data", company=slug)
                continue
            for job in _walk_jobs(blob):
                job["_slug"] = slug
                yield job

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("name") or raw.get("title") or raw.get("jobTitle")
        if not title:
            return None
        slug = raw.get("_slug", "")
        loc = raw.get("workLocation") or raw.get("location") or {}
        if isinstance(loc, dict):
            city = loc.get("city") or loc.get("name")
            state = loc.get("state") or loc.get("region")
            country = loc.get("country") or loc.get("countryCode")
            parts = [p for p in (city, state) if p]
            location = ", ".join(parts) or None
        elif isinstance(loc, str):
            location = loc
            country = None
        else:
            location = None
            country = None

        department = None
        dept = raw.get("department") or raw.get("team")
        if isinstance(dept, dict):
            department = dept.get("name")
        elif isinstance(dept, str):
            department = dept

        description = raw.get("description") or raw.get("descriptionHtml") or ""
        snippet = clean_text(description, limit=400)
        full = clean_text(description)

        job_id = raw.get("id") or raw.get("uuid")
        public_url = raw.get("url") or raw.get("publicJobUrl") or (
            f"https://ats.rippling.com/{slug}/jobs/{job_id}" if job_id else None
        )

        posted_raw = raw.get("postedAt") or raw.get("createdAt")
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        employment = raw.get("employmentType")
        if isinstance(employment, dict):
            employment = employment.get("name")

        return JobPosting(
            job_title=str(title).strip(),
            company_name=slug.replace("-", " ").title(),
            location=location,
            country=country,
            employment_type=employment,
            department=department,
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=public_url or "",
            apply_url=public_url,
            company_careers_url=f"https://ats.rippling.com/{slug}/jobs",
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(job_id) if job_id else None,
            requisition_id=None,
            raw=raw,
        )


# ---------- helpers (module-level so tests can exercise them directly) -----

def _extract_next_data(html: str) -> Optional[Any]:
    """Pull the parsed ``__NEXT_DATA__`` JSON blob from a rendered HTML body."""
    if not html:
        return None
    m = _NEXT_DATA_RE.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except (json.JSONDecodeError, ValueError):
        return None


def _walk_jobs(blob: Any) -> Iterator[dict[str, Any]]:
    """Find every job-shaped dict under ``pageProps`` without assuming layout.

    Rippling's Next.js shape has wandered across versions — jobs have been
    seen at ``props.pageProps.jobs`` and ``props.pageProps.board.jobs``. We
    walk depth-first and yield any list whose elements look like job dicts
    (have both a ``name``/``title`` key and an ``id``-ish key).
    """
    props = (blob or {}).get("props") if isinstance(blob, dict) else None
    page_props = (props or {}).get("pageProps") if isinstance(props, dict) else None
    if not isinstance(page_props, dict):
        return
    # Gather candidate lists.
    for val in _iter_values(page_props):
        if not isinstance(val, list) or not val:
            continue
        # Heuristic: first element has a title-ish + id-ish key.
        head = val[0]
        if not isinstance(head, dict):
            continue
        has_title = any(k in head for k in ("name", "title", "jobTitle"))
        has_id = any(k in head for k in ("id", "uuid", "jobId"))
        if has_title and has_id:
            for item in val:
                if isinstance(item, dict):
                    yield item


def _iter_values(obj: Any) -> Iterator[Any]:
    """Depth-first iterator over every value under a dict/list tree."""
    if isinstance(obj, dict):
        for v in obj.values():
            yield v
            yield from _iter_values(v)
    elif isinstance(obj, list):
        for v in obj:
            yield v
            yield from _iter_values(v)
