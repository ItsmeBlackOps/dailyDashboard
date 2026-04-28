"""Parse relative timestamps and filter to 'posted within N hours'."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from dateutil import parser as dateparser

_REL_RX = re.compile(
    r"(?P<num>\d+)\s*(?P<unit>minute|min|hour|hr|day|d|week|wk|month|mo)s?",
    re.IGNORECASE,
)
_UNIT_SECONDS = {
    "minute": 60, "min": 60,
    "hour": 3600, "hr": 3600,
    "day": 86400, "d": 86400,
    "week": 604800, "wk": 604800,
    "month": 2629800, "mo": 2629800,
}


def parse_posted(raw: Optional[str], *, now: Optional[datetime] = None) -> Optional[datetime]:
    """Best-effort parse of a 'date posted' string into a UTC datetime.

    Accepts: ISO 8601, RFC 2822, 'Just posted', 'today', 'yesterday',
    'posted 5 hours ago', '3 days ago', etc.
    Returns None if unparseable.
    """
    if not raw:
        return None
    s = raw.strip().lower()
    now = now or datetime.now(timezone.utc)

    if s in {"just posted", "just now", "today", "new", "recently posted"}:
        return now
    if s == "yesterday":
        return now - timedelta(days=1)

    m = _REL_RX.search(s)
    if m:
        num = int(m.group("num"))
        unit = m.group("unit").lower()
        seconds = _UNIT_SECONDS.get(unit)
        if seconds:
            return now - timedelta(seconds=num * seconds)

    # Absolute date parsing as last resort.
    try:
        dt = dateparser.parse(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


def is_within_hours(dt: Optional[datetime], hours: int, *, now: Optional[datetime] = None) -> bool:
    if dt is None:
        return False
    now = now or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (now - dt) <= timedelta(hours=hours)


def recency_for_source(name: str) -> int:
    """Return the recency window in hours for this source.

    Lookup order:
      1. RECENCY_HOURS_<SOURCE_UPPER> env var (via settings.recency_overrides)
      2. RECENCY_HOURS env var (settings.recency_hours)
      3. 168 (7 days)
    """
    # Late import: config reads env at import time, and tests reload it.
    from config import settings
    override = settings.recency_overrides.get(name.lower())
    if override is not None:
        return override
    return settings.recency_hours or 168
