"""End-to-end smoke test for the repost-detection ingest pipeline.

Runs a real GreenhouseScraper against a single small board and pipes its output
through the classifier → storage path twice. We deliberately skip `post_filter`
here because TARGET_TITLES restricts to data-analyst roles and many boards
have none today — this script exists to validate SCHEMA and CLASSIFIER
behavior, not role-match accuracy (covered by test_normalizer).

Usage:
    python -m scripts.smoke_test_ingest
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

# Force a clean sqlite DB so we can reason about counts deterministically.
_tmp = Path(tempfile.gettempdir()) / "scraper_smoke.db"
if _tmp.exists():
    _tmp.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"

from src.normalizer import (  # noqa: E402
    compute_content_hash, normalize_url,
)
from src.sources.greenhouse import GreenhouseScraper  # noqa: E402
from src.storage import Storage, jobs_history, jobs_clean  # noqa: E402


def hydrate(j):
    """Fill the repost-detection fingerprint + URL fields that post_filter would."""
    if not j.content_hash:
        j.content_hash = compute_content_hash(j)
    if not j.apply_url:
        j.apply_url = j.source_url
    if not j.canonical_url:
        j.canonical_url = normalize_url(j.source_url)
    if j.country is None:
        j.country = "US"
    return j


def run_once(label: str, storage: Storage, boards: list[str], limit: int = 50):
    scraper = GreenhouseScraper(boards=boards)
    try:
        parsed, _ = scraper.run()
    finally:
        scraper.close()
    jobs = [hydrate(j) for j in parsed[:limit]]
    counts = storage.ingest(jobs)
    trimmed = {k: v for k, v in counts.items() if v}
    print(f"[{label}] boards={boards} ingested={len(jobs)} classification={trimmed}")
    return jobs


def main() -> int:
    print(f"DB: {_tmp}")
    storage = Storage()

    # First run: a real small board → everything should classify as NEW.
    jobs_a = run_once("first", storage, ["faire"])
    assert jobs_a, "expected Faire to return at least one listing"

    # Second run of the same board → DUPLICATE for unchanged records.
    jobs_b = run_once("second", storage, ["faire"])
    assert jobs_b, "expected second run to return listings too"

    # Confirm schema fields actually got populated by the connector.
    enriched = [j for j in jobs_a if j.requisition_id or j.date_updated_normalized]
    print(
        f"\nConnector field coverage — requisition_id set: "
        f"{sum(bool(j.requisition_id) for j in jobs_a)}/{len(jobs_a)}, "
        f"date_updated set: "
        f"{sum(bool(j.date_updated_normalized) for j in jobs_a)}/{len(jobs_a)}, "
        f"apply_url set: {sum(bool(j.apply_url) for j in jobs_a)}/{len(jobs_a)}"
    )

    print(f"\njobs_clean total rows: {storage.count_clean()}")

    from sqlalchemy import desc, select
    with storage.engine.connect() as conn:
        rows = conn.execute(
            select(
                jobs_history.c.event,
                jobs_history.c.source_platform,
                jobs_history.c.reason,
                jobs_history.c.event_at,
            )
            .order_by(desc(jobs_history.c.id))
            .limit(10)
        ).all()
        print("\nLast 10 jobs_history events:")
        for r in rows:
            print(f"  {r.event_at.isoformat()}  {r.event:<9}  {r.source_platform:<12}  {r.reason}")

        # Sample row from jobs_clean to confirm new columns are populated.
        sample = conn.execute(
            select(
                jobs_clean.c.job_title,
                jobs_clean.c.company_norm,
                jobs_clean.c.content_hash,
                jobs_clean.c.requisition_id,
                jobs_clean.c.times_seen,
                jobs_clean.c.classification,
                jobs_clean.c.first_seen_at,
                jobs_clean.c.last_seen_at,
            )
            .limit(3)
        ).all()
        print("\nSample jobs_clean rows:")
        for r in sample:
            print(
                f"  {r.job_title[:40]:<40} | {r.company_norm} | "
                f"seen={r.times_seen} | class={r.classification} | "
                f"hash={(r.content_hash or '')[:12]}"
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
