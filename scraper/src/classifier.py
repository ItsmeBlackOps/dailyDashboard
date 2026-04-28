"""Repost / duplicate / update classifier.

Every incoming job is scored against historical DB records and placed into one
of five buckets:

    NEW          — nothing in DB matches on any stable key. Insert fresh record.
    REPOST       — a previous record for this (company, title, location)
                   existed and is either gone (removed_at set) or dormant
                   (last_seen_at > 14 days ago), and the new posting hashes
                   differently / has a different source_job_id. Same role
                   resurfaced after removal.
    UPDATED      — same canonical_key or same (company, requisition_id) still
                   live; description / updated_at changed. Same posting, edited.
    DUPLICATE    — content_hash already present from the same platform within
                   the recent window. Pure resurface, no material change.
                   Skip insert, just bump last_seen_at.
    CROSS_DUP    — content_hash (or soft_key) matches a recent record on a
                   DIFFERENT platform. Same job cross-listed on an aggregator.
                   Keep the primary (first-seen) record.
    UNCERTAIN    — partial match (e.g. company + title but different location,
                   or content_hash matches but company changed). Flag for review.

The classifier is deliberately LOCAL — it takes a single incoming JobPosting
plus a set of lookup callables over existing DB state. No I/O here; I/O is in
storage.py. That keeps this testable.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Callable, Optional

from src.models import JobPosting


class Classification(str, Enum):
    NEW = "new"
    REPOST = "repost"
    UPDATED = "updated"
    DUPLICATE = "duplicate"
    CROSS_DUP = "cross_dup"
    UNCERTAIN = "uncertain"


@dataclass
class ExistingRecord:
    """Minimal projection of a DB row the classifier cares about."""
    id: int
    canonical_key: str
    content_hash: Optional[str]
    soft_key: Optional[str]
    requisition_key: Optional[str]
    source_platform: str
    source_job_id: Optional[str]
    requisition_id: Optional[str]
    date_updated_normalized: Optional[datetime]
    first_seen_at: Optional[datetime]
    last_seen_at: Optional[datetime]
    removed_at: Optional[datetime]


@dataclass
class ClassifierResult:
    classification: Classification
    matched_id: Optional[int] = None
    reason: str = ""


# Lookup callable signatures — storage.py implements these against SQL.
LookupByCanonical = Callable[[str], Optional[ExistingRecord]]
LookupByRequisition = Callable[[str], Optional[ExistingRecord]]
LookupByContentHash = Callable[[str], list[ExistingRecord]]
LookupBySoftKey = Callable[[str], list[ExistingRecord]]

# Windows (all in days)
REPOST_DORMANT_DAYS = 14      # DB record untouched > 14 days → repost candidate
CROSS_DUP_WINDOW_DAYS = 7     # cross-platform match within 7 days → cross-dup
DUP_WINDOW_DAYS = 30          # same-platform content_hash within 30 days → dup


def _days_ago(dt: Optional[datetime], now: datetime) -> Optional[int]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (now - dt).days


def classify(
    job: JobPosting,
    *,
    by_canonical: LookupByCanonical,
    by_requisition: LookupByRequisition,
    by_content_hash: LookupByContentHash,
    by_soft_key: LookupBySoftKey,
    now: Optional[datetime] = None,
) -> ClassifierResult:
    """Decide what bucket this job belongs in. Pure function, no I/O."""
    now = now or datetime.now(timezone.utc)

    # 1. Requisition_id match wins — most stable signal across repost.
    if job.requisition_id:
        rk = job.requisition_key()
        if rk:
            existing = by_requisition(rk)
            if existing:
                # Same requisition that disappeared then came back → REPOST.
                if existing.removed_at:
                    return ClassifierResult(
                        Classification.REPOST, existing.id,
                        "same requisition_id after prior removal",
                    )
                # Same requisition still live: content_hash tells us if it
                # was edited (UPDATED) or just re-indexed (DUPLICATE).
                if job.content_hash and existing.content_hash and \
                        job.content_hash != existing.content_hash:
                    return ClassifierResult(
                        Classification.UPDATED, existing.id,
                        "same requisition_id, content_hash changed",
                    )
                return ClassifierResult(
                    Classification.DUPLICATE, existing.id,
                    "same requisition_id, content unchanged",
                )

    # 2. Canonical key match — same source_job_id from same portal.
    existing = by_canonical(job.canonical_key())
    if existing:
        # content hash changed → UPDATED; else DUPLICATE (just a resurface).
        if job.content_hash and existing.content_hash and \
                job.content_hash != existing.content_hash:
            return ClassifierResult(
                Classification.UPDATED, existing.id,
                "canonical_key match, content_hash changed",
            )
        return ClassifierResult(
            Classification.DUPLICATE, existing.id,
            "canonical_key match, content unchanged",
        )

    # 3. Content hash or soft key match — repost with new source_job_id.
    if job.content_hash:
        hits = by_content_hash(job.content_hash)
        for h in hits:
            age = _days_ago(h.last_seen_at or h.first_seen_at, now)
            # Same platform, recent → DUPLICATE (portal re-indexed).
            if h.source_platform == job.source_platform and age is not None and age <= DUP_WINDOW_DAYS:
                return ClassifierResult(
                    Classification.DUPLICATE, h.id,
                    f"content_hash match same platform ({age}d ago)",
                )
            # Different platform, recent → CROSS_DUP.
            if h.source_platform != job.source_platform and age is not None and age <= CROSS_DUP_WINDOW_DAYS:
                return ClassifierResult(
                    Classification.CROSS_DUP, h.id,
                    f"content_hash match on {h.source_platform} ({age}d ago)",
                )
            # Same platform but dormant / removed → REPOST.
            if h.source_platform == job.source_platform:
                return ClassifierResult(
                    Classification.REPOST, h.id,
                    f"content_hash match, dormant {age}d",
                )

    soft = job.soft_key()
    soft_hits = by_soft_key(soft)
    for h in soft_hits:
        age_last = _days_ago(h.last_seen_at, now)
        same_platform = h.source_platform == job.source_platform
        if h.removed_at is not None and same_platform:
            return ClassifierResult(
                Classification.REPOST, h.id,
                "soft_key match, prior record removed",
            )
        if same_platform and age_last is not None and age_last > REPOST_DORMANT_DAYS:
            return ClassifierResult(
                Classification.REPOST, h.id,
                f"soft_key match, last seen {age_last}d ago",
            )
        if not same_platform and age_last is not None and age_last <= CROSS_DUP_WINDOW_DAYS:
            return ClassifierResult(
                Classification.CROSS_DUP, h.id,
                f"soft_key match on {h.source_platform} ({age_last}d ago)",
            )
        # Same platform but fresh + different source_job_id → UNCERTAIN.
        return ClassifierResult(
            Classification.UNCERTAIN, h.id,
            "soft_key match but ambiguous timing",
        )

    return ClassifierResult(Classification.NEW, None, "no match")
