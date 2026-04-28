"""Generic schema.org JobPosting extractor — the universal fallback.

Google requires employers to embed ``<script type="application/ld+json">`` with
``"@type": "JobPosting"`` to index their jobs in Google Jobs. That means a
huge fraction of custom career pages (and every ATS's hosted detail page)
ships structured job data inline with the HTML.

This module is the connector of last resort: when ``discovery.detect`` can't
classify a site under any known ATS, we still get a clean ``JobPosting``
out of the page provided the employer plays by Google's rules.

Parsing follows the JSON-LD spec:

* Each ``<script type="application/ld+json">`` block may hold a single
  object, an array, or a ``@graph`` wrapper.
* ``@type`` may itself be a list (``["JobPosting", "PodcastEpisode"]``).
* ``hiringOrganization`` may be a string or an object with ``name``.
* ``jobLocation`` may be a single object, an array, or nested in
  ``jobLocation.address``.
* ``datePosted`` / ``validThrough`` are usually ISO-8601 but can be plain
  ``YYYY-MM-DD``.
* ``identifier`` may be ``{"value": "R-1234"}`` — the single most useful
  field for cross-portal dedupe (see ``docs/RESEARCH.md``).

The extractor is defensive: it drops malformed blobs rather than raising.
"""
from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone
from typing import Any, Iterable, Iterator, Optional

from src.logging_config import get_logger
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted

log = get_logger(__name__)

_JSONLD_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


# ---------------------------------------------------------------------------
# JSON-LD discovery
# ---------------------------------------------------------------------------

def _iter_jsonld_blobs(body: str) -> Iterator[Any]:
    """Yield parsed JSON objects from every JSON-LD block in ``body``."""
    if not body:
        return
    for m in _JSONLD_RE.finditer(body):
        raw = m.group(1).strip()
        if not raw:
            continue
        # JSON-LD blocks regularly contain HTML-entity-encoded &amp; / &quot;
        # (especially when rendered by SSR frameworks). Decode once before
        # parsing so the loader doesn't choke on `"&quot;`.
        if "&amp;" in raw or "&quot;" in raw or "&#" in raw:
            raw = html.unescape(raw)
        # Some sites wrap the value in CDATA markers.
        raw = raw.replace("/*<![CDATA[*/", "").replace("/*]]>*/", "").strip()
        try:
            yield json.loads(raw)
        except (json.JSONDecodeError, ValueError) as e:
            log.debug("jsonld.parse_error", error=str(e)[:200])


def _iter_objects(obj: Any) -> Iterator[dict[str, Any]]:
    """Walk a JSON-LD blob: flatten arrays and ``@graph`` wrappers."""
    if isinstance(obj, list):
        for item in obj:
            yield from _iter_objects(item)
        return
    if not isinstance(obj, dict):
        return
    # @graph: JSON-LD's envelope for multiple entities in one block.
    if "@graph" in obj and isinstance(obj["@graph"], list):
        yield from _iter_objects(obj["@graph"])
    yield obj


def _is_job_posting(obj: dict[str, Any]) -> bool:
    t = obj.get("@type")
    if isinstance(t, list):
        return any(str(x) == "JobPosting" for x in t)
    return str(t) == "JobPosting"


def iter_job_postings(body: str) -> Iterator[dict[str, Any]]:
    """Pull every JobPosting-typed object out of a rendered HTML body."""
    for blob in _iter_jsonld_blobs(body):
        for obj in _iter_objects(blob):
            if _is_job_posting(obj):
                yield obj


# ---------------------------------------------------------------------------
# JobPosting -> our canonical JobPosting
# ---------------------------------------------------------------------------

def _pluck_text(value: Any) -> Optional[str]:
    """Coerce a JSON-LD value (str | dict with ``name`` | list) to a string."""
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, dict):
        for key in ("name", "value", "@id"):
            v = value.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None
    if isinstance(value, list):
        for item in value:
            got = _pluck_text(item)
            if got:
                return got
    return None


def _pluck_location(raw: Any) -> tuple[Optional[str], Optional[str]]:
    """Return (display_location, country) from a jobLocation field."""
    # Handle array: return first usable.
    if isinstance(raw, list):
        for item in raw:
            loc, country = _pluck_location(item)
            if loc or country:
                return loc, country
        return None, None
    if not isinstance(raw, dict):
        return _pluck_text(raw), None
    addr = raw.get("address")
    if isinstance(addr, dict):
        city = _pluck_text(addr.get("addressLocality"))
        region = _pluck_text(addr.get("addressRegion"))
        country = _pluck_text(addr.get("addressCountry"))
        parts = [p for p in (city, region) if p]
        return (", ".join(parts) or None), country
    # Fallback: flat string
    return _pluck_text(raw), None


def _pluck_salary(raw: Any) -> Optional[str]:
    if not isinstance(raw, dict):
        return None
    currency = _pluck_text(raw.get("currency")) or "USD"
    value = raw.get("value")
    if isinstance(value, dict):
        low = value.get("minValue")
        high = value.get("maxValue")
        unit = _pluck_text(value.get("unitText")) or ""
        if low and high:
            return f"{currency} {low}–{high} {unit}".strip()
        if low:
            return f"{currency} {low}+ {unit}".strip()
    if isinstance(value, (int, float, str)):
        return f"{currency} {value}".strip()
    return None


def _pluck_requisition_id(raw: Any) -> Optional[str]:
    """``identifier`` is the cross-portal gold standard (see RESEARCH.md)."""
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw.strip() or None
    if isinstance(raw, dict):
        val = raw.get("value") or raw.get("@id") or raw.get("name")
        if isinstance(val, str):
            return val.strip() or None
    if isinstance(raw, list):
        for x in raw:
            v = _pluck_requisition_id(x)
            if v:
                return v
    return None


def _pluck_employment_type(raw: Any) -> Optional[str]:
    """employmentType is often a list like ["FULL_TIME"]; pick the first."""
    if isinstance(raw, list) and raw:
        return _pluck_text(raw[0])
    return _pluck_text(raw)


def _is_remote(raw: dict[str, Any]) -> Optional[str]:
    """Detect TELECOMMUTE markers without inventing signal that isn't there."""
    jt = raw.get("jobLocationType")
    if isinstance(jt, str) and "telecommute" in jt.lower():
        return "remote"
    # Some employers put it on applicantLocationRequirements
    alr = raw.get("applicantLocationRequirements")
    if alr:
        text = json.dumps(alr).lower()
        if "remote" in text:
            return "remote"
    return None


def to_job_posting(
    raw: dict[str, Any],
    *,
    source_url: str = "",
    source_platform: str = "custom",
    company_hint: Optional[str] = None,
) -> Optional[JobPosting]:
    """Map one JSON-LD JobPosting dict into our canonical ``JobPosting``.

    Returns ``None`` if the blob is missing the two absolutely required
    fields (title + company/hiringOrganization). Everything else is
    best-effort.
    """
    title = _pluck_text(raw.get("title"))
    if not title:
        return None

    company = _pluck_text(raw.get("hiringOrganization")) or company_hint
    if not company:
        return None

    location, country = _pluck_location(raw.get("jobLocation"))
    if not country:
        # Some employers also set this at the root.
        country = _pluck_text(raw.get("country"))

    date_posted_raw = _pluck_text(raw.get("datePosted"))
    posted_dt = parse_posted(date_posted_raw) if date_posted_raw else None
    if posted_dt and posted_dt.tzinfo is None:
        posted_dt = posted_dt.replace(tzinfo=timezone.utc)

    valid_through_raw = _pluck_text(raw.get("validThrough"))
    updated_dt = parse_posted(valid_through_raw) if valid_through_raw else None
    if updated_dt and updated_dt.tzinfo is None:
        updated_dt = updated_dt.replace(tzinfo=timezone.utc)

    description_html = _pluck_text(raw.get("description"))
    snippet = clean_text(description_html, limit=400)
    full = clean_text(description_html)

    apply_url = _pluck_text(raw.get("url")) or source_url
    remote = _is_remote(raw)

    req_id = _pluck_requisition_id(raw.get("identifier"))

    return JobPosting(
        job_title=title,
        company_name=company,
        location=location,
        country=country,
        employment_type=_pluck_employment_type(raw.get("employmentType")),
        remote_type=remote,
        department=_pluck_text(raw.get("occupationalCategory")),
        date_posted_raw=date_posted_raw,
        date_posted_normalized=posted_dt,
        date_updated_raw=valid_through_raw,
        date_updated_normalized=updated_dt,
        source_platform=source_platform,
        source_url=source_url or apply_url or "",
        apply_url=apply_url,
        salary=_pluck_salary(raw.get("baseSalary")),
        job_description_snippet=snippet,
        full_job_description=full,
        requisition_id=req_id,
        raw={"jsonld": raw, "source_url": source_url},
    )


def extract_from_html(
    body: str,
    *,
    source_url: str = "",
    source_platform: str = "custom",
    company_hint: Optional[str] = None,
) -> list[JobPosting]:
    """High-level: fetch nothing, just parse a body and return JobPostings."""
    out: list[JobPosting] = []
    for jp_raw in iter_job_postings(body):
        try:
            jp = to_job_posting(
                jp_raw,
                source_url=source_url,
                source_platform=source_platform,
                company_hint=company_hint,
            )
        except Exception as e:
            log.debug("jsonld.to_jobposting_failed", error=str(e)[:200])
            continue
        if jp:
            out.append(jp)
    return out


def extract_from_urls(
    urls: Iterable[str],
    *,
    http,
    source_platform: str = "custom",
    company_hint: Optional[str] = None,
) -> list[JobPosting]:
    """Fetch each URL once and extract every JSON-LD JobPosting found."""
    out: list[JobPosting] = []
    for url in urls:
        resp = http.get(url)
        if resp is None or resp.status_code != 200 or not resp.text:
            continue
        out.extend(extract_from_html(
            resp.text,
            source_url=url,
            source_platform=source_platform,
            company_hint=company_hint,
        ))
    return out
