"""Experience extractor — pulls structured years/level from free-text postings.

Portals rarely expose experience as a structured field (Workday and Taleo
sometimes do; Greenhouse / Lever / Ashby / SmartRecruiters / Workable never).
Everywhere else it lives inside the description HTML.

Strategy: run a cascade of regexes against plain-text description. Highest-
specificity patterns win (explicit "X-Y years", then "X+ years", then "at
least X years", then title-level heuristics).

Returns a tuple (min_years, max_years, level). Any component may be None.
"""
from __future__ import annotations

import re
from typing import Optional

_YEAR_RANGE = re.compile(
    r"(\d{1,2})\s*(?:-|to|–|—|\s+to\s+)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?\.?)",
    re.IGNORECASE,
)
_YEAR_PLUS = re.compile(
    r"(\d{1,2})\s*\+\s*(?:years?|yrs?\.?)",
    re.IGNORECASE,
)
_YEAR_MIN = re.compile(
    r"(?:at\s*least|minimum(?:\s*of)?|min\.?|over|more\s*than)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?\.?)",
    re.IGNORECASE,
)
_YEAR_SIMPLE = re.compile(
    r"(\d{1,2})\s*(?:years?|yrs?\.?)\s+(?:of\s+)?(?:experience|exp\.?|professional)",
    re.IGNORECASE,
)

# Negative patterns — "no experience required", "0-1 years", "entry level"
_NO_EXP = re.compile(
    r"\b(no\s+(?:prior\s+)?experience\s+(?:required|necessary)|"
    r"entry[-\s]?level|recent\s+grad(?:uate)?|new\s+grad(?:uate)?)\b",
    re.IGNORECASE,
)

# Level keywords (scanned in title first, then description). Order matters —
# "principal" must beat "senior" which must beat "junior".
_LEVEL_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(intern|internship)\b", re.I), "intern"),
    (re.compile(r"\b(principal)\b", re.I), "principal"),
    (re.compile(r"\b(staff\s+(?:engineer|analyst|scientist|designer))\b", re.I), "staff"),
    (re.compile(r"\b(director|vp|vice\s*president|head\s+of)\b", re.I), "director"),
    (re.compile(r"\b(lead|tech\s*lead)\b", re.I), "lead"),
    (re.compile(r"\b(senior|sr\.?|iii\b|iv\b)\b", re.I), "senior"),
    (re.compile(r"\b(mid(?:-|\s)level|ii\b|intermediate)\b", re.I), "mid"),
    (re.compile(r"\b(junior|jr\.?|associate|i\b)\b", re.I), "junior"),
    (re.compile(r"\b(entry|new\s*grad|graduate|trainee|early.career)\b", re.I), "entry"),
]

# Sanity bounds — reject obviously wrong matches ("10 years ago", "24 years old")
_MAX_PLAUSIBLE_YEARS = 25


def _first_match_years(patterns: list[tuple[re.Pattern[str], int]], text: str) -> Optional[int]:
    for pat, group in patterns:
        m = pat.search(text)
        if m:
            try:
                n = int(m.group(group))
                if 0 <= n <= _MAX_PLAUSIBLE_YEARS:
                    return n
            except (ValueError, IndexError):
                continue
    return None


def extract_years(text: str) -> tuple[Optional[int], Optional[int]]:
    """Return (min_years, max_years). Either may be None."""
    if not text:
        return None, None

    # 1. Range wins if present ("3-5 years").
    m = _YEAR_RANGE.search(text)
    if m:
        try:
            lo, hi = int(m.group(1)), int(m.group(2))
            if 0 <= lo <= hi <= _MAX_PLAUSIBLE_YEARS:
                return lo, hi
        except ValueError:
            pass

    # 2. "X+ years" → min X, no max
    m = _YEAR_PLUS.search(text)
    if m:
        try:
            lo = int(m.group(1))
            if 0 <= lo <= _MAX_PLAUSIBLE_YEARS:
                return lo, None
        except ValueError:
            pass

    # 3. "at least X years"
    m = _YEAR_MIN.search(text)
    if m:
        try:
            lo = int(m.group(1))
            if 0 <= lo <= _MAX_PLAUSIBLE_YEARS:
                return lo, None
        except ValueError:
            pass

    # 4. "X years of experience"
    m = _YEAR_SIMPLE.search(text)
    if m:
        try:
            lo = int(m.group(1))
            if 0 <= lo <= _MAX_PLAUSIBLE_YEARS:
                return lo, lo
        except ValueError:
            pass

    # 5. Explicit "no experience required"
    if _NO_EXP.search(text):
        return 0, 0

    return None, None


def extract_level(title: Optional[str], description: Optional[str] = None) -> Optional[str]:
    """Return a canonical seniority level from title first, description fallback."""
    # Title is more reliable than description (descriptions often mention
    # multiple levels when describing team structure).
    for source in (title, description):
        if not source:
            continue
        for pat, label in _LEVEL_PATTERNS:
            if pat.search(source):
                return label
    return None


def infer_years_from_level(level: Optional[str]) -> tuple[Optional[int], Optional[int]]:
    """Rough default bands when no explicit years are stated.

    Used only as a fallback so the experience filter still works on postings
    that say "Senior Analyst" with no number. Deliberately conservative.
    """
    return {
        "intern": (0, 0),
        "entry": (0, 2),
        "junior": (0, 2),
        "mid": (2, 5),
        "senior": (5, 10),
        "staff": (8, 15),
        "principal": (10, 20),
        "lead": (6, 12),
        "director": (10, 20),
    }.get(level or "", (None, None))


def extract(title: Optional[str], description: Optional[str]) -> tuple[Optional[int], Optional[int], Optional[str]]:
    """Single entry point — returns (min_years, max_years, level)."""
    text = " ".join(filter(None, [title or "", description or ""]))
    min_y, max_y = extract_years(text)
    level = extract_level(title, description)
    # Back-fill years from level ONLY when no explicit years found.
    if min_y is None and max_y is None:
        min_y, max_y = infer_years_from_level(level)
    return min_y, max_y, level
