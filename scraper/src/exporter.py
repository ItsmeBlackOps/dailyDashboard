"""Export cleaned jobs to CSV + JSON and produce the ranked top-N."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

import pandas as pd

from config import EXPORT_DIR, settings
from src.models import JobPosting
from src.recency import is_within_hours


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _rank_key(j: JobPosting) -> tuple:
    """Freshness first, then richer records win ties."""
    dt = j.date_posted_normalized or datetime(1970, 1, 1, tzinfo=timezone.utc)
    completeness = sum(
        bool(x)
        for x in (j.salary, j.full_job_description, j.seniority, j.company_careers_url)
    )
    return (dt.timestamp(), completeness)


def rank_top(
    jobs: Iterable[JobPosting],
    limit: int | None = None,
    *,
    recency_hours: Optional[int] = None,
) -> list[JobPosting]:
    """Rank jobs freshness-first and slice to ``limit``.

    When ``recency_hours`` is supplied, rows whose
    ``date_posted_normalized`` is older than the cutoff — including rows
    where the value is ``None`` — are dropped before ranking. This is the
    query-time recency slice; ``run_daily.py`` passes
    ``settings.recency_hours`` by default and ``None`` when ``--no-recency``
    is set. The filter lives here (not in ``storage.ingest``) so the DB
    retains the full backlog; see docs/DISCOVERY_SYSTEM.md §E.9.
    """
    limit = limit or settings.target_count
    filtered: Iterable[JobPosting] = jobs
    if recency_hours is not None:
        filtered = [
            j for j in jobs
            if is_within_hours(j.date_posted_normalized, recency_hours)
        ]
    return sorted(filtered, key=_rank_key, reverse=True)[:limit]


def export(jobs: list[JobPosting], *, tag: str = "daily") -> dict[str, Path]:
    date = _stamp()
    base = Path(EXPORT_DIR)
    csv_path = base / f"jobs_{tag}_{date}.csv"
    json_path = base / f"jobs_{tag}_{date}.json"

    records = [j.to_export_dict() for j in jobs]
    if records:
        df = pd.DataFrame(records)
        df.to_csv(csv_path, index=False, encoding="utf-8")
    else:
        csv_path.write_text("", encoding="utf-8")

    json_path.write_text(
        json.dumps(records, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    return {"csv": csv_path, "json": json_path}
