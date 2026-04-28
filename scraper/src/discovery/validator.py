"""Validate discovered slugs by pinging the source's public API.

We accept HTTP 200 as "live". 404 / 403 / unreachable → drop. This prunes
stale, misspelled, or non-existent tenants so the daily pipeline doesn't
waste calls.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable

from src.http_client import HttpClient
from src.logging_config import get_logger

log = get_logger(__name__)


def _probe(source: str, slug: str) -> tuple[str, str, dict | None]:
    """Return (method, url, json_body). Body is None for GET."""
    if source == "greenhouse":
        return "GET", f"https://boards-api.greenhouse.io/v1/boards/{slug}", None
    if source == "lever":
        return "GET", f"https://api.lever.co/v0/postings/{slug}?limit=1", None
    if source == "ashby":
        return "GET", f"https://api.ashbyhq.com/posting-api/job-board/{slug}", None
    if source == "smartrecruiters":
        return "GET", f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1", None
    if source == "workable":
        return "GET", f"https://apply.workable.com/{slug}/", None
    if source == "workday":
        # Triple ``tenant:wdN:site`` — e.g. ``nvidia:wd5:NVIDIAExternalCareerSite``.
        # Probe the public career-site landing page — a 200 confirms the
        # tenant + region-cluster + site combo is live. Malformed triples
        # return an empty URL so the validator drops them rather than
        # synthesizing a broken ``https://.wd.myworkdayjobs.com/...``.
        import re as _re
        raw = (slug or "").strip()
        if not raw:
            return "GET", "", None
        parts = raw.split(":")
        if len(parts) != 3:
            return "GET", "", None
        tenant, cluster, site = (p.strip() for p in parts)
        if not tenant or not cluster or not site:
            return "GET", "", None
        # ``wdN`` where N is one or more digits (wd1, wd3, wd5, wd12, wd103, …).
        if not _re.match(r"^wd\d+$", cluster):
            return "GET", "", None
        # Tenant + site are alphanumeric + ``_-`` (matches the subdomain
        # + path-segment character set Workday actually uses).
        if not _re.match(r"^[A-Za-z0-9][A-Za-z0-9_\-]*$", tenant):
            return "GET", "", None
        if not _re.match(r"^[A-Za-z0-9][A-Za-z0-9_\-]*$", site):
            return "GET", "", None
        return "GET", (
            f"https://{tenant}.{cluster}.myworkdayjobs.com/en-US/{site}"
        ), None
    if source == "icims":
        # iCIMS subdomain of ``careers-{X}.icims.com``. The ``/jobs`` landing
        # page is public though many egress IPs get 403/405 from the WAF —
        # ``validate()`` will drop those as non-200, which is correct: if
        # the operator's egress IP can't fetch the page, the daily scrape
        # running from the same IP won't either, so excluding the tenant
        # avoids wasting calls.
        import re as _re
        raw = (slug or "").strip()
        if not raw or not _re.match(r"^[A-Za-z0-9][A-Za-z0-9_\-]*$", raw):
            return "GET", "", None
        return "GET", f"https://careers-{raw}.icims.com/jobs", None
    if source == "recruitee":
        return "GET", f"https://{slug}.recruitee.com/api/offers/", None
    if source == "personio":
        return "GET", f"https://{slug}.jobs.personio.com/xml", None
    if source == "jobvite":
        # "legacy:{code}" entries probe the classic XML endpoint.
        if slug.startswith("legacy:"):
            code = slug.split(":", 1)[1]
            return "GET", f"https://app.jobvite.com/CompanyJobs/Xml.aspx?c={code}", None
        return "GET", f"https://jobs.jobvite.com/{slug}/feed/jobs", None
    if source == "jazzhr":
        return "GET", f"https://{slug}.applytojob.com/apply/jobs/feed?json=1", None
    if source == "eightfold":
        return "GET", f"https://{slug}.eightfold.ai/careers/api/jobs?domain={slug}&num=1", None
    if source == "rippling":
        return "GET", f"https://ats.rippling.com/{slug}/jobs", None
    if source == "teamtailor":
        return "GET", f"https://{slug}.teamtailor.com/jobs", None
    if source == "bamboohr":
        return "GET", f"https://{slug}.bamboohr.com/careers/list", None
    if source == "paylocity":
        return "GET", (
            f"https://recruiting.paylocity.com/recruiting/JobsApi/JobList?companyId={slug}"
        ), None
    if source == "ukg":
        # Composite "TENANT/UUID" (optionally prefixed with "SHARD|").
        # Probe the JobBoard HTML; a 200 confirms tenant + UUID are both valid.
        raw = slug
        shard_prefix = ""
        if "|" in raw:
            s, _, r = raw.partition("|")
            if s.isdigit() and len(s) == 1:
                shard_prefix = s
                raw = r
        if "/" not in raw:
            return "GET", "", None
        tenant, _, uuid = raw.partition("/")
        return "GET", (
            f"https://recruiting{shard_prefix}.ultipro.com/{tenant}/JobBoard/{uuid}"
        ), None
    if source == "oracle_rc":
        # Composite "host/region/site". Probe the public recruiting REST
        # endpoint with a minimal finder; Oracle returns 200 + JSON for a
        # valid External Candidate site even with zero open requisitions.
        parts = [p for p in slug.split("/") if p]
        if len(parts) != 3:
            return "GET", "", None
        host, region, site = parts
        return "GET", (
            f"https://{host}.fa.{region}.oraclecloud.com"
            f"/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
            f"?onlyData=true&finder=findReqs;siteNumber={site},limit=1"
        ), None
    if source == "dayforce":
        # Bare tenant (``acme``) or shard-pinned (``us58:acme`` /
        # ``us58/acme``). Both separators are accepted — ``:`` is the
        # env-var config form, ``/`` is the form ``detect.py`` emits from
        # its two-group composite pattern.
        #
        # Probe the CandidatePortal Posting/Search landing page — 200
        # confirms the tenant is live. The page is a thin SPA shell that
        # also sets any session cookie via Set-Cookie, but the HTTP
        # status alone suffices for liveness checking.
        #
        # Kept in sync with ``src.sources.dayforce._split_slug``: shard is
        # lowercase alnum ≤6 chars, tenant is alnum + ``_-`` only. Any
        # malformed input (``US58:tenant``, ``us58:``, ``a:b:c``, …) drops
        # before emitting a broken URL.
        import re as _re
        raw = (slug or "").strip()
        if not raw:
            return "GET", "", None
        _pin = _re.compile(
            r"^(?P<shard>[a-z0-9]{1,6})[:/](?P<tenant>[a-zA-Z0-9][a-zA-Z0-9_\-]*)$"
        )
        _bare = _re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_\-]*$")
        m = _pin.match(raw)
        if m:
            shard = m.group("shard")
            tenant = m.group("tenant")
        elif _bare.match(raw):
            shard = ""
            tenant = raw
        else:
            return "GET", "", None
        host = f"{shard}.dayforcehcm.com" if shard else f"{tenant}.dayforcehcm.com"
        return "GET", (
            f"https://{host}/CandidatePortal/en-US/{tenant}/Posting/Search"
        ), None
    if source == "successfactors":
        # Accept "N:company" explicit shard or bare company — probe career10
        # (mid-shard) by default, which is where most customers land.
        shard = 10
        company = slug
        if ":" in slug:
            s, c = slug.split(":", 1)
            try:
                shard = int(s)
                company = c
            except ValueError:
                pass
        return "GET", (
            f"https://career{shard}.successfactors.com/career"
            f"?company={company}&career_ns=job_listing_summary&resultType=XML"
        ), None
    return "GET", "", None


def validate(source: str, slugs: list[str], *, concurrency: int = 16,
             keep_on_error: bool = False) -> list[str]:
    """Return the subset of slugs that respond 200."""
    slugs = sorted({s.strip() for s in slugs if s and s.strip()})
    if not slugs:
        return []

    http = HttpClient(timeout=10.0)
    ok: list[str] = []

    def check(slug: str) -> tuple[str, bool]:
        method, url, body = _probe(source, slug)
        if not url:
            return slug, False
        resp = http.post(url, json=body) if method == "POST" else http.get(url)
        if resp is None:
            return slug, keep_on_error
        if resp.status_code != 200:
            return slug, False
        # Workable redirects unknown slugs to /oops — detect via final URL.
        if source == "workable" and "/oops" in str(resp.url):
            return slug, False
        return slug, True

    try:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(check, s) for s in slugs]
            for fut in as_completed(futures):
                slug, alive = fut.result()
                if alive:
                    ok.append(slug)
    finally:
        http.close()

    log.info("validate.done", source=source, checked=len(slugs), live=len(ok))
    return sorted(ok)
