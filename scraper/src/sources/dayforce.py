"""Dayforce (Ceridian Dayforce HCM) — CandidatePortal + JSON-LD detail pages.

Dayforce's public candidate portal exposes two URL families depending on
when the tenant was provisioned:

* **Own-subdomain tenants** (older / larger customers)::

    https://{tenant}.dayforcehcm.com/CandidatePortal/en-US/{tenant}/Posting/Search

* **Shared-shard tenants** (newer customers, e.g. ``us58``, ``us61``)::

    https://{shard}.dayforcehcm.com/CandidatePortal/en-US/{tenant}/Posting/Search

The browser widget drives both off the same ``Posting/Search`` landing
page and ``Posting/View/{id}`` detail pages. The detail pages universally
ship ``schema.org`` ``JobPosting`` JSON-LD (Dayforce explicitly documents
this in their Google-for-Jobs integration guide), so this connector is
a wrapper around the existing ``discovery.generic_extractor``:

1. Fetch the tenant's search landing page. This establishes any session
   cookie the portal needs — ``HttpClient``'s persistent ``Session``
   auto-carries cookies on subsequent requests, which sidesteps the
   "session-cookie required pre-search" issue flagged in the original
   fingerprint doc.
2. Scan the response for ``Posting/View/{id}`` anchors to build a
   detail-page URL list (capped at ``_MAX_POSTINGS_PER_TENANT``).
3. Also run the JSON-LD extractor on the landing page itself — some
   tenants pre-render job summaries inline (Google-for-Jobs friendly).
4. Fetch each detail page and run the JSON-LD extractor. Aggregate
   the resulting ``JobPosting``s.

Slug format
-----------

* ``tenant`` — bare tenant name, e.g. ``apollomed``. Uses the
  ``{tenant}.dayforcehcm.com`` host.
* ``shard:tenant`` — shard-pinned, e.g. ``us58:mycompany``. Uses
  ``{shard}.dayforcehcm.com`` as the host with the tenant in the path.

Compliance
----------
The JSON-LD JobPosting blob is the same surface Google Jobs crawls —
Dayforce publishes it explicitly for that purpose. We pace politely via
the shared ``HttpClient`` (per-host throttling preserved).
"""
from __future__ import annotations

import re
from typing import Any, Iterator, Optional

from src.base import BaseSourceScraper
from src.discovery.generic_extractor import extract_from_html
from src.discovery.detect import has_jsonld_jobposting
from src.models import JobPosting

_MAX_POSTINGS_PER_TENANT = 500

# Posting/View/{id} — the canonical detail-page URL. The id may be numeric
# or alphanumeric (some tenants use a short alpha prefix).
_POSTING_HREF_RE = re.compile(
    r'href="([^"#?\s]*?/CandidatePortal/[^"#?\s]*/Posting/View/[A-Za-z0-9_\-]+)"',
    re.IGNORECASE,
)
# Absolute posting URL (for when href is fully qualified rather than
# path-relative).
_ABSOLUTE_POSTING_RE = re.compile(
    r'https?://[A-Za-z0-9\-]+\.dayforcehcm\.com/CandidatePortal/[^"\s#?]*/Posting/View/[A-Za-z0-9_\-]+',
    re.IGNORECASE,
)

# Shard prefix: e.g. ``us58:mycompany`` or ``us58/mycompany`` — one to six
# lowercase alnum chars before the separator (matches Dayforce's ``usNN`` /
# ``caN`` / ``euN`` shards). Accept both ``:`` (env-var / config form) and
# ``/`` (the form emitted by ``src/discovery/detect.py`` when its two-group
# composite pattern fires — the slash is the tuple-join default). Tenant
# names are Dayforce-canonical: start with alnum, then alnum + ``_`` + ``-``
# only — no further separators inside the tenant segment.
_SHARD_RE = re.compile(
    r"^(?P<shard>[a-z0-9]{1,6})[:/](?P<tenant>[a-zA-Z0-9][a-zA-Z0-9_\-]*)$"
)


class DayforceScraper(BaseSourceScraper):
    name = "dayforce"
    display_name = "Dayforce HCM (Ceridian)"
    compliance_notes = (
        "Public CandidatePortal + detail-page schema.org JobPosting JSON-LD — "
        "same surface Google Jobs consumes. Session cookie (if any) is "
        "obtained implicitly by fetching the landing page before details."
    )

    def __init__(
        self,
        companies: Optional[list[str]] = None,
        *,
        max_per_tenant: int = _MAX_POSTINGS_PER_TENANT,
        **kw: Any,
    ) -> None:
        super().__init__(**kw)
        self.companies = companies or []
        self.max_per_tenant = max_per_tenant

    # ---------------------------------------------------------- public API

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for raw_slug in self.companies:
            shard, tenant = _split_slug(raw_slug)
            if not tenant:
                self.log.info("slug.malformed", slug=raw_slug)
                continue

            landing = _landing_url(shard, tenant)
            resp = self.http.get(landing)
            if not resp or resp.status_code != 200 or not resp.text:
                self.log.info(
                    "company.miss",
                    company=raw_slug,
                    status=getattr(resp, "status_code", None),
                )
                continue

            body = resp.text
            company_hint = _pretty_hint(tenant)

            # 1. Extract JSON-LD off the landing page (many tenants pre-render
            #    per-job summary blobs for Google Jobs).
            if has_jsonld_jobposting(body):
                for jp in extract_from_html(
                    body,
                    source_url=landing,
                    source_platform=self.name,
                    company_hint=company_hint,
                ):
                    yield {"_jp": jp, "_slug": raw_slug, "_via": "landing"}

            # 2. Walk detail-page anchors.
            detail_urls = _extract_posting_urls(
                body, base=landing, max_items=self.max_per_tenant,
            )
            for url in detail_urls:
                d = self.http.get(url)
                if not d or d.status_code != 200 or not d.text:
                    continue
                if not has_jsonld_jobposting(d.text):
                    continue
                for jp in extract_from_html(
                    d.text,
                    source_url=url,
                    source_platform=self.name,
                    company_hint=company_hint,
                ):
                    yield {"_jp": jp, "_slug": raw_slug, "_via": "detail"}

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        jp = raw.get("_jp")
        if jp is None:
            return None
        slug = raw.get("_slug", "")
        shard, tenant = _split_slug(slug)
        jp.company_careers_url = _landing_url(shard, tenant)
        jp.raw = {
            "dayforce": {"slug": slug, "shard": shard, "tenant": tenant,
                         "via": raw.get("_via")},
            **(jp.raw or {}),
        }
        return jp


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _split_slug(raw: str) -> tuple[str, str]:
    """Return ``(shard, tenant)`` from a Dayforce slug.

    * ``"apollomed"``              → ``("", "apollomed")``
    * ``"us58:mycompany"``         → ``("us58", "mycompany")``
    * ``"us58/mycompany"``         → ``("us58", "mycompany")`` — detect.py form
    * ``""`` / malformed            → ``("", "")``

    A slug containing ``:`` or ``/`` must match the shard-prefix regex
    fully; otherwise we treat it as malformed and drop it. That prevents
    garbage like ``"us58:"`` or ``"toolongshard:tenant"`` from leaking
    through as a bare tenant with separator chars in the name (which
    would produce a broken ``https://us58:.dayforcehcm.com/...`` URL).
    """
    if not raw or not isinstance(raw, str):
        return "", ""
    s = raw.strip()
    if not s:
        return "", ""
    m = _SHARD_RE.match(s)
    if m:
        shard = m.group("shard").strip()
        tenant = m.group("tenant").strip()
        if not tenant:
            return "", ""
        return shard, tenant
    # Has a separator but didn't match the shard regex → malformed.
    if ":" in s or "/" in s:
        return "", ""
    return "", s


def _landing_url(shard: str, tenant: str) -> str:
    """Compose the tenant's CandidatePortal search URL.

    Own-subdomain tenants drop the shard, which is the Dayforce default.
    """
    host = f"{shard}.dayforcehcm.com" if shard else f"{tenant}.dayforcehcm.com"
    return f"https://{host}/CandidatePortal/en-US/{tenant}/Posting/Search"


def _extract_posting_urls(html: str, *, base: str, max_items: int) -> list[str]:
    """Pull unique ``Posting/View/{id}`` URLs from the landing HTML.

    Handles two href styles observed in the wild:
      * relative paths — resolved against ``base``
      * absolute URLs on the same ``*.dayforcehcm.com`` domain

    Hrefs that point at another dayforce tenant (rare, happens when an
    index page links out to a sibling tenant) are accepted as-is — the
    ``HttpClient`` session cookie carries over since the parent domain
    matches.
    """
    from urllib.parse import urljoin, urlparse

    base_host = urlparse(base).netloc.lower()
    seen: set[str] = set()
    out: list[str] = []

    # First pass: href attribute hits (may be relative).
    for m in _POSTING_HREF_RE.finditer(html):
        href = m.group(1).strip()
        absolute = urljoin(base, href)
        host = urlparse(absolute).netloc.lower()
        # Accept any dayforcehcm.com host — shard hopping is legal for
        # cross-shard postings.
        if not host.endswith("dayforcehcm.com"):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        out.append(absolute)
        if len(out) >= max_items:
            return out

    # Second pass: absolute URLs in plain text / script blobs (some
    # tenants embed the list as a JS array, not anchors).
    for m in _ABSOLUTE_POSTING_RE.finditer(html):
        url = m.group(0).strip()
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
        if len(out) >= max_items:
            return out

    # Keep output ordering stable: hrefs first (document order), absolutes
    # after. Don't de-duplicate the base_host against other hosts — the
    # SessionCookie still flows across shards on the same parent domain.
    _ = base_host  # keep reference so linters don't complain
    return out


def _pretty_hint(tenant: str) -> Optional[str]:
    """Turn ``acme-corp`` → ``Acme Corp`` for company_hint defaults."""
    if not tenant:
        return None
    return tenant.replace("-", " ").replace("_", " ").title()
