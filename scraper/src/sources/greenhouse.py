"""Greenhouse Job Boards — public JSON API (no auth).

Docs: https://developers.greenhouse.io/job-board.html
Endpoint: https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
Compliance: documented public API designed for programmatic use. Safe to scrape.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from config import settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text
from src.recency import parse_posted


class GreenhouseScraper(BaseSourceScraper):
    name = "greenhouse"
    display_name = "Greenhouse Boards"
    compliance_notes = "Official public Job Board API — no auth required."

    BASE = "https://boards-api.greenhouse.io/v1/boards/{board}/jobs"

    def __init__(self, boards: Optional[list[str]] = None, **kw: Any) -> None:
        super().__init__(**kw)
        self.boards = boards or settings.greenhouse_boards

    # Emit a progress log every PROGRESS_EVERY boards so operators can see
    # motion during the long serial scrape (~800+ boards). Without this,
    # a single hung board would leave the run silent for hours.
    PROGRESS_EVERY = 50

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        total = len(self.boards)
        jobs_seen = 0
        boards_ok = 0
        boards_miss = 0
        self.log.info(
            "greenhouse.scrape.start", boards_total=total,
        )
        for i, board in enumerate(self.boards, start=1):
            url = self.BASE.format(board=board)
            resp = self.http.get(url, params={"content": "true"})
            if not resp or resp.status_code != 200:
                boards_miss += 1
                self.log.warning(
                    "board.miss", board=board,
                    status=getattr(resp, "status_code", None),
                )
            else:
                try:
                    data = resp.json()
                except ValueError:
                    boards_miss += 1
                    data = None
                if data is not None:
                    boards_ok += 1
                    for job in data.get("jobs", []):
                        job["_board"] = board
                        jobs_seen += 1
                        yield job

            if i % self.PROGRESS_EVERY == 0 or i == total:
                self.log.info(
                    "greenhouse.progress",
                    boards_done=i, boards_total=total,
                    boards_ok=boards_ok, boards_miss=boards_miss,
                    jobs_seen=jobs_seen,
                )

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        title = raw.get("title")
        if not title:
            return None
        loc_obj = raw.get("location") or {}
        location = loc_obj.get("name") if isinstance(loc_obj, dict) else str(loc_obj)
        # first_published is the stable posting time; updated_at ticks on edits.
        first_published = raw.get("first_published")
        updated_at = raw.get("updated_at")
        posted_dt = parse_posted(first_published or updated_at) if (first_published or updated_at) else None
        if posted_dt and posted_dt.tzinfo is None:
            posted_dt = posted_dt.replace(tzinfo=timezone.utc)
        updated_dt = parse_posted(updated_at) if updated_at else None
        if updated_dt and updated_dt.tzinfo is None:
            updated_dt = updated_dt.replace(tzinfo=timezone.utc)
        board = raw.get("_board", "")
        desc = clean_text(raw.get("content"), limit=400)
        full_desc = clean_text(raw.get("content"))

        # Department — Greenhouse returns departments as a list of {id,name}.
        dept = None
        depts = raw.get("departments") or []
        if isinstance(depts, list) and depts:
            first = depts[0]
            if isinstance(first, dict):
                dept = first.get("name")

        # Requisition id — Greenhouse exposes both `requisition_id` (client-
        # assigned) and `internal_job_id`. Prefer the client-assigned one; fall
        # back to internal_job_id which is stable across post delete+recreate.
        req_id = raw.get("requisition_id")
        if not req_id:
            iji = raw.get("internal_job_id")
            if iji is not None:
                req_id = str(iji)

        return JobPosting(
            job_title=title.strip(),
            company_name=_company_from_board(board),
            location=location,
            country=None,
            employment_type=None,
            department=dept,
            date_posted_raw=first_published or updated_at,
            date_posted_normalized=posted_dt,
            date_updated_raw=updated_at,
            date_updated_normalized=updated_dt,
            source_platform=self.name,
            source_url=raw.get("absolute_url", ""),
            apply_url=raw.get("absolute_url") or None,
            company_careers_url=f"https://boards.greenhouse.io/{board}",
            job_description_snippet=desc,
            full_job_description=full_desc,
            source_job_id=str(raw.get("id")),
            requisition_id=str(req_id) if req_id else None,
            raw=raw,
        )


def _company_from_board(board: str) -> str:
    return board.replace("-", " ").replace("_", " ").title()
