"""LinkedIn — Apify actor `fantastic-jobs/advanced-linkedin-job-search-api`.

Same author as src/sources/fantastic_jobs.py (which scrapes 50+ career
sites); this one is the LinkedIn-specific cousin with LinkedIn-only
search filters (seniority, industry, easy-apply toggle).

We enforce ``noDirectApply=true`` at the actor level so easy-apply jobs
never enter the dataset. Skills + AI-enriched fields are preserved on
``raw`` for the downstream resume-match step.

Required env:
  APIFY_TOKEN              — Apify API token

Optional env (source self-disables when titles+descriptions+locations all empty):
  LINKEDIN_TITLES          — comma-sep job titles, ":*" suffix = prefix match
  LINKEDIN_LOCATIONS       — comma-sep "City, Region, Country"
  LINKEDIN_DESCRIPTIONS    — comma-sep keywords searched in title + body
  LINKEDIN_MAX_JOBS        — cap (default 100)
  LINKEDIN_TIME_RANGE      — 1h|24h|7d|6m (default 7d)
  LINKEDIN_REMOTE_ONLY     — true → remote=true filter
  LINKEDIN_INCLUDE_AI      — default true
  LINKEDIN_SENIORITY       — comma-sep ("Mid-Senior level,Director")
  LINKEDIN_EMPLOYMENT      — comma-sep ("FULL_TIME,CONTRACTOR")
  LINKEDIN_EXCLUDE_ATS_DUP — true → drop overlap with FantasticJobs

LINKEDIN_SEARCH_QUERIES (legacy from silentflow actor) is still consumed:
each entry becomes a titleSearch term. Prefer the structured envs above.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from config import settings
from src.base import BaseSourceScraper
from src.models import JobPosting
from src.normalizer import clean_text


ACTOR_ID = "fantastic-jobs/advanced-linkedin-job-search-api"


class LinkedInScraper(BaseSourceScraper):
    name = "linkedin"
    display_name = "LinkedIn (Apify advanced search)"
    compliance_notes = (
        "Apify actor fantastic-jobs/advanced-linkedin-job-search-api with "
        "noDirectApply=true to exclude easy-apply jobs."
    )

    def __init__(
        self,
        # New structured inputs (match fantastic_jobs schema):
        titles: Optional[list[str]] = None,
        locations: Optional[list[str]] = None,
        descriptions: Optional[list[str]] = None,
        max_items: Optional[int] = None,
        time_range: Optional[str] = None,
        remote_only: Optional[bool] = None,
        include_ai: Optional[bool] = None,
        seniority_filter: Optional[list[str]] = None,
        employment_filter: Optional[list[str]] = None,
        exclude_ats_dup: Optional[bool] = None,
        date_posted_after: Optional[str] = None,
        # Back-compat with the previous silentflow-actor signature:
        queries: Optional[list[str]] = None,           # → merged into titles
        max_jobs: Optional[int] = None,                # alias for max_items
        location: Optional[str] = None,                # singular alias
        days: Optional[int] = None,                    # → time_range
        token: Optional[str] = None,
        client: Any = None,
        **kw: Any,
    ) -> None:
        super().__init__(**kw)
        merged_titles: list[str] = []
        if titles is not None:
            merged_titles.extend(titles)
        elif settings.linkedin_titles:
            merged_titles.extend(settings.linkedin_titles)
        if queries:
            merged_titles.extend(queries)
        elif settings.linkedin_search_queries and not merged_titles:
            merged_titles.extend(settings.linkedin_search_queries)
        self.titles = merged_titles

        if locations is not None:
            self.locations = list(locations)
        elif settings.linkedin_locations:
            self.locations = list(settings.linkedin_locations)
        elif location:
            self.locations = [location]
        elif settings.linkedin_location:
            self.locations = [settings.linkedin_location]
        else:
            self.locations = []

        self.descriptions = (descriptions if descriptions is not None
                             else settings.linkedin_descriptions)
        self.max_items = max_items or max_jobs or settings.linkedin_max_jobs
        # Explicit time_range wins; otherwise legacy days= wins over env
        # default so old callers keep getting their custom recency window.
        if time_range:
            self.time_range = time_range
        elif days:
            self.time_range = f"{int(days) * 24}h"
        else:
            self.time_range = settings.linkedin_time_range or "7d"
        self.remote_only = (settings.linkedin_remote_only
                            if remote_only is None else remote_only)
        self.include_ai = (settings.linkedin_include_ai
                           if include_ai is None else include_ai)
        self.seniority_filter = (seniority_filter if seniority_filter is not None
                                 else settings.linkedin_seniority)
        self.employment_filter = (employment_filter if employment_filter is not None
                                  else settings.linkedin_employment)
        self.exclude_ats_dup = (settings.linkedin_exclude_ats_dup
                                if exclude_ats_dup is None else exclude_ats_dup)
        self.date_posted_after = date_posted_after
        self.token = token if token is not None else os.getenv("APIFY_TOKEN", "")
        self._injected_client = client

    def _make_client(self) -> Any:
        if self._injected_client is not None:
            return self._injected_client
        from apify_client import ApifyClient
        return ApifyClient(self.token)

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        if not (self.titles or self.descriptions or self.locations):
            self.log.info("linkedin.skip", reason="no_search_params")
            return
        if not self.token and self._injected_client is None:
            self.log.warning("linkedin.skip", reason="missing_APIFY_TOKEN")
            return

        run_input: dict[str, Any] = {
            "limit": int(self.max_items),
            "timeRange": self.time_range,
            "includeAi": bool(self.include_ai),
            "descriptionType": "text",
            "noDirectApply": True,        # exclude LinkedIn Easy Apply
        }
        if self.titles:
            run_input["titleSearch"] = list(self.titles)
        if self.locations:
            run_input["locationSearch"] = list(self.locations)
        if self.descriptions:
            run_input["descriptionSearch"] = list(self.descriptions)
        if self.remote_only:
            run_input["remote"] = True
        if self.seniority_filter:
            run_input["seniorityFilter"] = list(self.seniority_filter)
        if self.employment_filter:
            run_input["EmploymentTypeFilter"] = list(self.employment_filter)
        if self.exclude_ats_dup:
            run_input["excludeATSDuplicate"] = True
        if self.date_posted_after:
            run_input["datePostedAfter"] = self.date_posted_after

        client = self._make_client()
        actor = client.actor(ACTOR_ID)
        self.log.info(
            "linkedin.scrape.start",
            titles=len(self.titles), locations=len(self.locations),
            descriptions=len(self.descriptions), max_items=self.max_items,
            time_range=self.time_range, remote_only=self.remote_only,
            no_direct_apply=True,
        )
        t0 = time.monotonic()
        try:
            run = actor.call(run_input=run_input)
        except Exception as e:
            self.log.error("linkedin.actor.fail", error=str(e)[:300])
            return
        if not run:
            self.log.warning("linkedin.actor.empty_run")
            return
        ds_id = (run.get("defaultDatasetId") if isinstance(run, dict)
                 else getattr(run, "default_dataset_id", None))
        if not ds_id:
            self.log.warning("linkedin.actor.no_dataset")
            return

        seen = 0
        skipped_easy_apply = 0
        for item in client.dataset(ds_id).iterate_items():
            if item.get("directApply") is True or item.get("direct_apply") is True:
                skipped_easy_apply += 1
                continue
            seen += 1
            yield item
        self.log.info(
            "linkedin.scrape.done",
            jobs_seen=seen, skipped_easy_apply=skipped_easy_apply,
            elapsed_s=round(time.monotonic() - t0, 2),
        )

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        # Same snake_case schema as fantastic-jobs/career-site-job-listing-api
        # (same author). Accept camelCase for back-compat with old fixtures.
        def g(*keys: str) -> Any:
            for k in keys:
                v = raw.get(k)
                if v not in (None, "", [], {}):
                    return v
            return None

        title = g("title", "jobTitle")
        if not title:
            return None
        org = g("organization", "companyName") or {}
        if isinstance(org, dict):
            company = org.get("name") or ""
            careers = org.get("url")
        else:
            company = str(org)
            careers = None
        careers = careers or g("organization_url", "companyUrl")

        loc: Any = None
        cities = raw.get("cities_derived") or []
        regions = raw.get("regions_derived") or []
        countries = raw.get("countries_derived") or []
        if isinstance(cities, list) and cities:
            parts = [cities[0]]
            if regions:
                parts.append(str(regions[0]))
            if countries:
                parts.append(str(countries[0]))
            loc = ", ".join(p for p in parts if p)
        else:
            alt = (raw.get("locations_alt_raw") or raw.get("locationsRaw")
                   or raw.get("location"))
            if isinstance(alt, list) and alt:
                first = alt[0]
                if isinstance(first, str):
                    loc = first
                elif isinstance(first, dict):
                    loc = first.get("name") or first.get("address")
            elif isinstance(alt, str):
                loc = alt

        url = g("url", "jobUrl", "link") or ""
        apply_url = g("apply_url", "applyUrl") or url
        desc = g("description_text", "description", "descriptionText", "descriptionHtml")
        snippet = clean_text(desc, limit=400)
        full = clean_text(desc)

        posted_raw = g("date_posted", "datePosted", "postedAt", "listedAt")
        posted_dt: Optional[datetime] = None
        if isinstance(posted_raw, str):
            try:
                posted_dt = datetime.fromisoformat(posted_raw.replace("Z", "+00:00"))
                if posted_dt.tzinfo is None:
                    posted_dt = posted_dt.replace(tzinfo=timezone.utc)
            except ValueError:
                posted_dt = None
        elif isinstance(posted_raw, (int, float)):
            try:
                posted_dt = datetime.fromtimestamp(posted_raw / 1000, tz=timezone.utc)
            except (OSError, OverflowError, ValueError):
                posted_dt = None

        emp_type = g("ai_employment_type", "employment_type",
                     "aiEmploymentType", "employmentType")
        if isinstance(emp_type, list):
            emp_type = emp_type[0] if emp_type else None

        work = g("ai_work_arrangement", "aiWorkArrangement", "workArrangement")
        remote_type = None
        if isinstance(work, str):
            w = work.lower()
            if "remote" in w:
                remote_type = "remote"
            elif "hybrid" in w:
                remote_type = "hybrid"
            elif "on-site" in w or "onsite" in w:
                remote_type = "onsite"
        elif raw.get("remote_derived") is True or raw.get("remoteAllowed") is True:
            remote_type = "remote"

        skills = (raw.get("ai_key_skills") or raw.get("skills")
                  or raw.get("skillsRequired") or [])
        if isinstance(skills, list):
            raw["_skills_normalized"] = [str(s).strip().lower() for s in skills if s]

        salary = g("salary_raw", "salaryRaw", "salary")
        if isinstance(salary, dict):
            salary = salary.get("text") or salary.get("value") or None

        ats = g("source", "ats", "atsName")
        if ats:
            raw["_ats"] = ats

        return JobPosting(
            job_title=str(title).strip(),
            company_name=str(company).strip(),
            location=loc,
            country=(countries[0] if isinstance(countries, list) and countries
                     else raw.get("country")),
            remote_type=remote_type,
            employment_type=str(emp_type) if emp_type else None,
            seniority=g("ai_experience_level", "aiExperienceLevel",
                        "seniorityLevel", "seniority"),
            salary=str(salary) if salary else None,
            department=g("ai_taxonomies_a", "aiTaxonomyPrimary",
                         "function", "department"),
            date_posted_raw=str(posted_raw) if posted_raw else None,
            date_posted_normalized=posted_dt,
            source_platform=self.name,
            source_url=url,
            apply_url=apply_url,
            company_careers_url=careers,
            job_description_snippet=snippet,
            full_job_description=full,
            source_job_id=str(g("id", "jobId") or ""),
            raw=raw,
        )
