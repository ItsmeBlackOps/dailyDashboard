"""Dedup across heterogeneous sources.

Strategy:
  1. Canonical key: sha1(normalized_title | company | location | url | source_job_id)
  2. Fuzzy fallback: (normalized_title, company, location_city)

``StreamingDedupe`` carries the canonical-hash and fuzzy-soft sets across
calls to ``filter()`` so cross-source fuzzy dedupe holds when each source
is ingested independently as its future completes (see ``run_daily.main``).
``dedupe()`` is preserved as a thin wrapper for callers that want a
single batch call.
"""
from __future__ import annotations

import re
from typing import Iterable

from src.models import JobPosting
from src.normalizer import normalize_title


def _city(loc: str | None) -> str:
    if not loc:
        return ""
    # Take everything before the first comma — typically "City"
    return re.split(r"[,/]", loc, maxsplit=1)[0].strip().lower()


class StreamingDedupe:
    """Stateful dedupe that carries seen-sets across multiple ``filter()``
    calls. Used by the orchestrator's per-source ingest loop so fuzzy
    (title, company, city) collisions across sources still collapse to a
    single row — the earlier source wins, later duplicates are dropped."""

    def __init__(self) -> None:
        self._seen_hash: set[str] = set()
        self._seen_soft: set[tuple[str, str, str]] = set()

    def filter(self, jobs: Iterable[JobPosting]) -> tuple[list[JobPosting], int]:
        """Return ``(unique, removed_count)`` for this batch, updating the
        internal seen-sets so the next call knows what was already observed.
        """
        unique: list[JobPosting] = []
        removed = 0

        for j in jobs:
            h = j.canonical_key()
            if h in self._seen_hash:
                removed += 1
                continue
            soft = (
                normalize_title(j.job_title),
                (j.company_name or "").strip().lower(),
                _city(j.location),
            )
            if soft in self._seen_soft:
                removed += 1
                continue
            self._seen_hash.add(h)
            self._seen_soft.add(soft)
            unique.append(j)

        return unique, removed


def dedupe(jobs: Iterable[JobPosting]) -> tuple[list[JobPosting], int]:
    """Backwards-compatible single-batch dedupe.

    Thin wrapper over ``StreamingDedupe`` for callers that ingest one
    consolidated list. New code in the orchestrator uses the class
    directly so state carries across per-source calls.
    """
    return StreamingDedupe().filter(jobs)
