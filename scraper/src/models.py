"""Canonical in-memory data model for a job posting."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional


@dataclass
class JobPosting:
    # required identity
    job_title: str
    company_name: str
    source_platform: str
    source_url: str

    # location
    location: Optional[str] = None
    country: Optional[str] = None
    remote_type: Optional[str] = None  # remote | hybrid | onsite

    # employment
    employment_type: Optional[str] = None
    seniority: Optional[str] = None
    salary: Optional[str] = None
    department: Optional[str] = None

    # timing
    date_posted_raw: Optional[str] = None
    date_posted_normalized: Optional[datetime] = None
    date_updated_raw: Optional[str] = None
    date_updated_normalized: Optional[datetime] = None
    scrape_timestamp_utc: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    # description
    job_description_snippet: Optional[str] = None
    full_job_description: Optional[str] = None

    # identity / linking — source_job_id is whatever the portal returns
    # (often unstable across delete+repost); requisition_id is the company's
    # internal HR requisition number when exposed (much more stable).
    source_job_id: Optional[str] = None
    requisition_id: Optional[str] = None
    company_careers_url: Optional[str] = None
    apply_url: Optional[str] = None
    canonical_url: Optional[str] = None

    # experience
    experience_min_years: Optional[int] = None
    experience_max_years: Optional[int] = None
    experience_level: Optional[str] = None  # intern|entry|junior|mid|senior|staff|principal|director

    # repost-detection fingerprint (filled by normalizer pipeline)
    content_hash: Optional[str] = None

    # debugging / provenance (not exported)
    raw: Optional[dict[str, Any]] = None

    # ---------- helpers ----------
    def canonical_key(self) -> str:
        """Stable cross-source fingerprint — the PORTAL's notion of identity.

        NOTE: this is NOT repost-proof — if the portal regenerates source_job_id
        on republish, this key changes too. That's why we also compute
        content_hash / soft-match keys in the classifier.
        """
        parts = [
            (self.job_title or "").strip().lower(),
            (self.company_name or "").strip().lower(),
            (self.location or "").strip().lower(),
            (self.source_url or "").strip().lower(),
            (self.source_job_id or "").strip().lower(),
        ]
        return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()

    def soft_key(self) -> str:
        """Repost-resistant fingerprint.

        Deliberately excludes source_job_id and source_url (both churn on
        delete+repost). Uses normalized company + title + location + first
        chunk of description — same role posted twice hashes to the same key.
        """
        from src.normalizer import normalize_company, normalize_location, normalize_title
        desc = (self.full_job_description or self.job_description_snippet or "")
        desc_head = " ".join(desc.lower().split())[:1500]
        parts = [
            normalize_company(self.company_name),
            normalize_title(self.job_title),
            normalize_location(self.location),
            desc_head,
        ]
        return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()

    def requisition_key(self) -> Optional[str]:
        """Company + requisition_id is the most stable signal across repost.

        Returns None when requisition_id is missing (most public ATS APIs
        don't expose it). When present, this key is the gold standard.
        """
        if not self.requisition_id:
            return None
        from src.normalizer import normalize_company
        return hashlib.sha1(
            f"{normalize_company(self.company_name)}|{self.requisition_id.strip().lower()}".encode("utf-8")
        ).hexdigest()

    def to_export_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("raw", None)
        # Stringify datetimes for CSV/JSON friendliness
        for f_name in ("date_posted_normalized", "date_updated_normalized"):
            v = d.get(f_name)
            if isinstance(v, datetime):
                d[f_name] = v.isoformat()
        d["scrape_timestamp_utc"] = self.scrape_timestamp_utc.isoformat()
        return d
