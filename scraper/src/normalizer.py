"""Normalize heterogeneous source records into the canonical JobPosting shape."""
from __future__ import annotations

import hashlib
import re
from typing import Iterable, Optional
from urllib.parse import urlparse, urlunparse

from config import (
    TARGET_IT_KEYWORDS,
    TARGET_TITLES,
    TITLE_EXCLUSIONS,
    TITLE_EXCLUSIONS_NARROW,
    settings,
)
from src.models import JobPosting

# ------------------------------ title match ------------------------------
_WS = re.compile(r"\s+")


def normalize_title(title: Optional[str]) -> str:
    if not title:
        return ""
    t = _WS.sub(" ", title).strip().lower()
    # Strip trailing department tags like " - Remote" or " (Contract)"
    t = re.sub(r"\s*[-|–]\s*(remote|hybrid|onsite|us|contract|full.?time|part.?time).*$", "", t)
    t = re.sub(r"\([^)]*\)", "", t).strip()
    return t


def title_matches_target(title: Optional[str]) -> bool:
    """Does this job title pass the configured filter?

    Two modes (set via JOB_FILTER_MODE env var):
      - "it" (default): broad US-IT taxonomy. Matches any software/data/ML/
        DevOps/cloud/security/QA/IT-infra role; excludes leadership, sales,
        and non-tech adjacency.
      - "narrow": original data-analyst-only profile; kept for backwards
        compatibility with existing runs.
    """
    t = normalize_title(title)
    if not t:
        return False
    mode = (settings.job_filter_mode or "it").lower()
    if mode == "narrow":
        for bad in TITLE_EXCLUSIONS_NARROW:
            if bad in t:
                return False
        return any(target in t for target in TARGET_TITLES)
    # "it" mode — broad taxonomy
    for bad in TITLE_EXCLUSIONS:
        if bad in t:
            return False
    return any(kw in t for kw in TARGET_IT_KEYWORDS)


# ------------------------------ location ------------------------------
_US_STATE_CODES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
    "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
    "VA","WA","WV","WI","WY","DC",
}
_US_HINTS = (
    "united states", "u.s.", "u.s.a", "usa", "us-", "remote - us", "remote us",
    "remote (us)", "united states of america",
)


def looks_us(location: Optional[str], *, country_hint: Optional[str] = None) -> bool:
    if country_hint and country_hint.upper() in {"US", "USA", "UNITED STATES"}:
        return True
    if not location:
        return False
    loc = location.lower()
    if any(h in loc for h in _US_HINTS):
        return True
    # "City, ST" or "City, ST 12345" pattern
    m = re.search(r",\s*([A-Z]{2})(\b|\s|,|$)", location)
    if m and m.group(1) in _US_STATE_CODES:
        return True
    return False


# ------------------------------ remote type ------------------------------
def infer_remote_type(location: Optional[str], description: Optional[str] = None) -> Optional[str]:
    blob = " ".join(filter(None, [location, description])).lower()
    if not blob:
        return None
    if "hybrid" in blob:
        return "hybrid"
    if "remote" in blob or "work from home" in blob:
        return "remote"
    if re.search(r"\bon.?site\b|\bin.?office\b", blob):
        return "onsite"
    return None


# ------------------------------ seniority ------------------------------
_SENIORITY_MAP = [
    (re.compile(r"\b(intern|internship)\b", re.I), "intern"),
    (re.compile(r"\b(junior|jr\.?|entry.level|early.career|i\b)\b", re.I), "junior"),
    (re.compile(r"\b(mid|mid.level|ii\b)\b", re.I), "mid"),
    (re.compile(r"\b(senior|sr\.?|iii\b|iv\b)\b", re.I), "senior"),
    (re.compile(r"\b(lead|principal|staff)\b", re.I), "lead"),
]


def infer_seniority(title: Optional[str]) -> Optional[str]:
    if not title:
        return None
    for rx, label in _SENIORITY_MAP:
        if rx.search(title):
            return label
    return None


# ------------------------------ snippet ------------------------------
_HTML = re.compile(r"<[^>]+>")
_EXTRA_WS = re.compile(r"\s{2,}")


def clean_text(raw: Optional[str], *, limit: int = 0) -> Optional[str]:
    if not raw:
        return None
    txt = _HTML.sub(" ", raw)
    txt = txt.replace("\xa0", " ")
    txt = _EXTRA_WS.sub(" ", txt).strip()
    if limit and len(txt) > limit:
        return txt[: limit - 1].rstrip() + "…"
    return txt


# ------------------------------ company / location normalizers ------------------------------
_COMPANY_SUFFIX = re.compile(
    r"\b(?:inc|incorporated|llc|l\.l\.c\.|ltd|limited|co|corp|corporation|"
    r"plc|gmbh|sa|s\.a\.|ag|bv|ab|oy|pte|pty|holdings?|group|technologies|"
    r"technology|systems|solutions|labs?|ai)\b\.?",
    re.IGNORECASE,
)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_company(name: Optional[str]) -> str:
    if not name:
        return ""
    n = name.strip().lower()
    # Strip punctuation and corporate suffixes before collapsing.
    n = _COMPANY_SUFFIX.sub(" ", n)
    n = _NON_ALNUM.sub(" ", n)
    return _WS.sub(" ", n).strip()


def normalize_location(loc: Optional[str]) -> str:
    """Collapse to 'city, st' or 'remote' or 'us'.

    Many portals return ugly variants of the same place: "New York, NY, USA",
    "New York, United States", "NYC". We only keep signal that survives
    repost: city name and state code.
    """
    if not loc:
        return ""
    raw = loc.strip().lower()
    if any(h in raw for h in _US_HINTS) and "," not in raw:
        # e.g. "remote - us" → "remote us"
        if "remote" in raw:
            return "remote us"
        return "us"
    if "remote" in raw:
        return "remote"
    # Keep city,ST
    m = re.search(r"([a-z][a-z .'-]{1,40}),\s*([A-Za-z]{2})\b", loc)
    if m:
        return f"{m.group(1).strip().lower()}, {m.group(2).upper()}"
    return _WS.sub(" ", _NON_ALNUM.sub(" ", raw)).strip()


# ------------------------------ URL normalizer ------------------------------
_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gh_src", "gh_jid", "ref", "referrer", "mc_cid", "mc_eid",
}


def normalize_url(url: Optional[str]) -> str:
    """Strip tracking params + fragment so apply/repost URL compares cleanly."""
    if not url:
        return ""
    try:
        p = urlparse(url.strip())
        if not p.scheme:
            return url.lower().rstrip("/")
        from urllib.parse import parse_qsl, urlencode
        query = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=False)
                 if k.lower() not in _TRACKING_PARAMS]
        path = p.path.rstrip("/") or "/"
        return urlunparse((p.scheme.lower(), p.netloc.lower(), path,
                           "", urlencode(query), ""))
    except Exception:
        return url.strip().lower()


# ------------------------------ content hash ------------------------------
def compute_content_hash(j: JobPosting) -> str:
    """Repost-resistant hash.

    Deliberately omits source_job_id, source_url, dates, and raw HTML — those
    all churn when an employer deletes + reposts. Uses stable signal only:
    normalized company + title + location + first 2000 chars of plaintext
    description. Same role reposted later hashes identically.
    """
    desc = clean_text(j.full_job_description or j.job_description_snippet) or ""
    desc_head = _WS.sub(" ", desc.lower())[:2000]
    parts = [
        normalize_company(j.company_name),
        normalize_title(j.job_title),
        normalize_location(j.location),
        desc_head,
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


# ------------------------------ public gate ------------------------------
def post_filter(jobs: Iterable[JobPosting]) -> list[JobPosting]:
    """Apply title + country + remote-type + experience inference in one pass.

    Also computes content_hash and fills canonical_url / apply_url so the
    classifier downstream has everything it needs.
    """
    from src.experience import extract as extract_experience
    out: list[JobPosting] = []
    for j in jobs:
        if not title_matches_target(j.job_title):
            continue
        if not looks_us(j.location, country_hint=j.country):
            continue
        if j.country is None:
            j.country = "US"
        if j.remote_type is None:
            j.remote_type = infer_remote_type(j.location, j.job_description_snippet)
        if j.seniority is None:
            j.seniority = infer_seniority(j.job_title)

        # Experience — prefer values already set by connector, fall back to extractor.
        if j.experience_min_years is None and j.experience_max_years is None and j.experience_level is None:
            desc = j.full_job_description or j.job_description_snippet
            mn, mx, lvl = extract_experience(j.job_title, desc)
            j.experience_min_years = mn
            j.experience_max_years = mx
            j.experience_level = lvl

        # Fill apply_url / canonical_url from source_url if connector left them blank.
        if not j.apply_url:
            j.apply_url = j.source_url
        if not j.canonical_url:
            j.canonical_url = normalize_url(j.source_url)

        # Content hash is the repost-detection signal.
        if not j.content_hash:
            j.content_hash = compute_content_hash(j)

        out.append(j)
    return out
