"""SAP SuccessFactors — public XML feed (no auth).

SAP documents this feed in KBA 2428902 (public article). It is the same
surface SF's own careers-widget and the Google-for-Jobs-aggregator uses,
so scraping it is compliant with the intended use.

Endpoints::

    https://career{shard}.successfactors.com/career?company={companyId}
        &career_ns=job_listing_summary&resultType=XML

``shard`` ∈ 1..10 — a company is pinned to one shard (determined by the
customer's SF data center). Config may pin it explicitly by prefixing::

    SUCCESSFACTORS_COMPANIES=acme,10:betaco

The first form probes shards 1..10 until one responds with XML. The
second form goes directly to ``career10.successfactors.com`` for
``betaco``.

Parsing
-------
The XML schema SF ships is fairly flat but tag names drift across
tenants. We key on the most commonly-observed names and fall back
through synonyms — unknown tags are kept in ``raw`` for debugging but
do not fail the parse.

Stable IDs
----------
``jobReqId`` is the SF-internal requisition number; it's durable across
edits on the same posting. We promote it to both ``source_job_id`` and
``requisition_id`` so the classifier's ``requisition_key`` dedup catches
cross-portal duplicates (e.g. same employer on SF + Eightfold).
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any, Iterator, Optional, Tuple

from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


# Tag-name synonyms observed across SF tenants. First match wins.
_TITLE_KEYS = ("jobTitle", "title", "name")
_LOCATION_KEYS = ("location", "city", "country")
_DEPT_KEYS = ("department", "businessUnit", "function", "jobFamily")
_EMPLOYMENT_KEYS = ("jobType", "employmentType", "scheduleType", "schedule")
_POSTED_KEYS = ("externalPostedTimestamp", "postedDate", "createdAt")
_REQID_KEYS = ("jobReqId", "reqId", "jobId", "id")
_DESC_KEYS = ("jobDescription", "description", "jobDetail", "externalJobDescription")
_PATH_KEYS = ("externalPath", "applyPath", "jobUrl")


class SuccessFactorsScraper(BaseSourceScraper):
    name = "successfactors"
    display_name = "SAP SuccessFactors"
    compliance_notes = "Public XML feed (SAP KBA 2428902) — no auth required."

    SHARDS: Tuple[int, ...] = tuple(range(1, 11))
    XML_URL = (
        "https://career{shard}.successfactors.com/career"
        "?company={company}&career_ns=job_listing_summary&resultType=XML"
    )
    CANDIDATE_URL = (
        "https://career{shard}.successfactors.com/career"
        "?company={company}&career_job_req_id={req}"
    )

    def __init__(self, companies: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.companies = companies or []

    def _parse_entry(self, entry: str) -> Tuple[Tuple[int, ...], str]:
        """Split a config entry into (shards_to_try, company_id)."""
        if ":" in entry:
            shard_s, company_id = entry.split(":", 1)
            try:
                return (int(shard_s),), company_id.strip()
            except ValueError:
                return self.SHARDS, entry
        return self.SHARDS, entry

    def _fetch_one(self, entry: str) -> Optional[Tuple[ET.Element, str, int]]:
        shards, company_id = self._parse_entry(entry)
        if not company_id:
            return None
        for shard in shards:
            url = self.XML_URL.format(shard=shard, company=company_id)
            resp = self.http.get(url, headers={"Accept": "application/xml, text/xml, */*;q=0.9"})
            if not resp or resp.status_code != 200 or not resp.text:
                continue
            head = resp.text[:200].lstrip().lower()
            # Guard against HTML error pages being served with 200.
            if not (head.startswith("<?xml") or head.startswith("<jobs") or head.startswith("<job")):
                continue
            try:
                root = ET.fromstring(resp.text)
            except ET.ParseError:
                continue
            return root, company_id, shard
        return None

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        for entry in self.companies:
            found = self._fetch_one(entry)
            if found is None:
                self.log.info("company.miss", company=entry)
                continue
            root, company_id, shard = found
            for job in _iter_jobs(root):
                yield _element_to_dict(job, company=company_id, shard=shard)

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = _first(raw, _TITLE_KEYS)
        if not title:
            return None
        req_id = _first(raw, _REQID_KEYS)
        company_id = raw.get("_company") or ""
        shard = raw.get("_shard") or 1
        posted_raw = _first(raw, _POSTED_KEYS)
        posted_dt = parse_posted(posted_raw) if posted_raw else None

        # Description — SF often ships description HTML in a single tag,
        # sometimes CDATA-wrapped.
        desc_html = _first(raw, _DESC_KEYS) or ""
        snippet = clean_text(desc_html, limit=400) if desc_html else None
        full = clean_text(desc_html) if desc_html else None

        # Apply URL: prefer explicit externalPath when present; otherwise
        # synthesize the standard SF candidate URL.
        path = _first(raw, _PATH_KEYS)
        if path:
            if path.startswith("http"):
                apply_url = path
            else:
                apply_url = f"https://career{shard}.successfactors.com{path if path.startswith('/') else '/' + path}"
        elif req_id:
            apply_url = self.CANDIDATE_URL.format(shard=shard, company=company_id, req=req_id)
        else:
            apply_url = None

        careers_url = (
            f"https://career{shard}.successfactors.com/career?company={company_id}"
            if company_id else None
        )

        return JobPosting(
            job_title=str(title).strip(),
            company_name=company_id.replace("-", " ").replace("_", " ").title() if company_id else None,
            location=_first(raw, _LOCATION_KEYS) or None,
            country=None,
            employment_type=_first(raw, _EMPLOYMENT_KEYS),
            seniority=None,
            department=_first(raw, _DEPT_KEYS),
            date_posted_raw=posted_raw,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=apply_url or careers_url or "",
            apply_url=apply_url,
            company_careers_url=careers_url,
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(req_id) if req_id else None,
            # SF jobReqId is durable across edits → promote to requisition_id.
            requisition_id=str(req_id) if req_id else None,
            raw=raw,
        )


# --------------------------------------------------------------------------
# XML helpers — tolerant of wrapper tag differences across SF tenants.
# --------------------------------------------------------------------------

def _iter_jobs(root: ET.Element) -> Iterator[ET.Element]:
    """Yield each <job>-like element from an SF XML tree.

    Variants observed:
      <jobs><job>…</job></jobs>
      <jobRequisitions><jobRequisition>…</jobRequisition></jobRequisitions>
      <result><item>…</item></result>
    We walk all immediate children and pick those that have a title-ish
    child — that's a reliable job record marker regardless of wrapper.
    """
    for child in list(root):
        # Direct match: tag is "job" or "jobRequisition"
        if _looks_like_job(child):
            yield child
    # If the top-level wasn't a list, maybe the root itself is a job record.
    if _looks_like_job(root):
        yield root
    # Last-resort deep walk — some tenants add a wrapper layer.
    for element in root.iter():
        tag = element.tag.lower()
        if tag in {"job", "jobrequisition", "position", "item"} and element is not root:
            if _looks_like_job(element):
                # Avoid yielding elements we already yielded at the top level.
                if element not in list(root):
                    yield element


def _looks_like_job(el: ET.Element) -> bool:
    tags = {child.tag for child in el}
    # Need at least one title-ish or req-id-ish child.
    return any(k in tags for k in _TITLE_KEYS) or any(k in tags for k in _REQID_KEYS)


def _element_to_dict(job: ET.Element, *, company: str, shard: int) -> dict[str, Any]:
    out: dict[str, Any] = {"_company": company, "_shard": shard}
    for child in job:
        text = (child.text or "").strip()
        if text:
            out[child.tag] = text
    return out


def _first(d: dict[str, Any], keys: Tuple[str, ...]) -> Optional[str]:
    for k in keys:
        v = d.get(k)
        if v:
            return str(v)
    return None
