"""Abstract base class every source connector implements."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Iterator, Optional

from src.http_client import HttpClient
from src.logging_config import get_logger
from src.models import JobPosting


class BaseSourceScraper(ABC):
    """Plugin contract.

    Subclasses must implement:
      * name           — stable short id (used in DB + exports)
      * fetch_listings — yields raw records (dicts) from the source
      * parse_listing  — maps one raw record -> JobPosting (or None to skip)

    Optional:
      * fetch_job_detail — hydrate a JobPosting with full description
    """

    # ------------ metadata ------------
    name: str = "base"
    display_name: str = "Base"
    compliance_notes: str = "Override with source-specific compliance notes."

    def __init__(self, http: Optional[HttpClient] = None) -> None:
        self._own_http = http is None
        self.http = http or HttpClient()
        self.log = get_logger(f"source.{self.name}")

    def close(self) -> None:
        if self._own_http:
            self.http.close()

    # ------------ contract ------------
    @abstractmethod
    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        """Yield raw dicts. MUST handle pagination internally."""

    @abstractmethod
    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        """Map a raw record into a canonical JobPosting, or None to drop it."""

    def fetch_job_detail(self, job: JobPosting) -> JobPosting:
        """Optional hydration. Default: return as-is."""
        return job

    # ------------ driver ------------
    def run(self) -> tuple[list[JobPosting], list[dict[str, Any]]]:
        """Execute fetch -> parse pipeline. Returns (parsed_jobs, raw_records)."""
        parsed: list[JobPosting] = []
        raw_records: list[dict[str, Any]] = []
        try:
            for raw in self.fetch_listings():
                raw_records.append(raw)
                try:
                    job = self.parse_listing(raw)
                except Exception as e:
                    self.log.warning("parse.error", error=str(e))
                    continue
                if job:
                    if not job.company_name:
                        self.log.warning("parse.skip_no_company", title=job.job_title,
                                         source=self.name)
                        continue
                    job.source_platform = self.name
                    parsed.append(job)
        except Exception as e:
            self.log.error("fetch.fatal", error=str(e))
            raise
        self.log.info("source.complete", parsed=len(parsed), raw=len(raw_records))
        return parsed, raw_records
