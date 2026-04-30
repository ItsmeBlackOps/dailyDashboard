"""Fantastic Jobs — Apify actor `fantastic-jobs/career-site-job-listing-api`.

Aggregates career-site postings across 50+ ATS platforms with optional
AI-enriched fields (employment type, work arrangement, salary,
experience level, visa sponsorship, industry taxonomy).

Compliance: actor is hosted by Apify; per-employer ToS posture is
delegated to the actor. We pay-per-result, so cap output via
``FANTASTIC_JOBS_MAX``.

Required env:
  APIFY_TOKEN — Apify API token

Optional env (all empty by default → source skipped):
  FANTASTIC_JOBS_TITLES        comma-sep job titles, ":*" suffix = prefix match
  FANTASTIC_JOBS_LOCATIONS     comma-sep "City, Region, Country" strings
  FANTASTIC_JOBS_DESCRIPTIONS  comma-sep keywords searched in title + body
  FANTASTIC_JOBS_MAX           max items per call (default 100, max 5000)
  FANTASTIC_JOBS_TIME_RANGE    1h | 24h | 7d | 6m (default 7d)
  FANTASTIC_JOBS_REMOTE_ONLY   true → only Remote OK / Remote Solely
  FANTASTIC_JOBS_INCLUDE_AI    default true
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


ACTOR_ID = "fantastic-jobs/career-site-job-listing-api"

# Defaults requested by operator (Apr 2026):
#   - timeRange: try 1h first, fall back to 24h if zero hits ("auto")
#   - limit: actor max (5000) ≈ "no limit"
#   - includeAi: true; includeLinkedIn: false; descriptionType: text
#   - removeAgency: true (drop recruiters / job boards)
#   - locationSearch: ["United States"]
#   - ats: omit (all ATS platforms)
#   - aiEmploymentTypeFilter: FULL_TIME + CONTRACTOR
#   - aiWorkArrangementFilter: omit (all arrangements)
# Empty by default — locationSearch is a literal token match that ALSO
# requires the candidate location string to contain the search term.
# Country names like "United States" miss most US jobs (their location
# strings contain city/state). For "all US jobs" use the country post-
# filter instead (FANTASTIC_JOBS_COUNTRY=United States).
DEFAULT_LOCATIONS: tuple[str, ...] = ()
DEFAULT_EMPLOYMENT: tuple[str, ...] = ("FULL_TIME", "CONTRACTOR")
DEFAULT_WORK_ARRANGEMENT: tuple[str, ...] = (
    "On-site", "Hybrid", "Remote OK", "Remote Solely",
)
DEFAULT_TIME_RANGE = "auto"        # auto = try 1h, fall back to 24h
ACTOR_MAX_LIMIT = 5000


def years_to_experience_levels(min_y: Optional[float], max_y: Optional[float]) -> list[str]:
    """Map a YoE window to actor's aiExperienceLevelFilter buckets.

    Buckets: 0-2, 2-5, 5-10, 10+ (half-open [b_lo, b_hi)).

    Rule: pick only buckets that **fit at or below** the candidate's
    actual max — i.e. b_hi <= max_y. This stops us from surfacing
    senior-level postings to mid-level candidates (a 3-5 yr candidate
    must NOT see 5-10 jobs even though that bucket's lower bound
    technically overlaps).

    If the strict filter returns empty (e.g. candidate at an exact
    bucket boundary like 5-5 or 7-7), fall back to the single bucket
    that *contains* their max — always at least one bucket so the
    actor still has a filter to apply.

    Examples:
      3-5  → ["2-5"]            (5-10 excluded: b_hi=10 > max=5)
      5-5  → ["5-10"]           (fallback: 5-10 contains 5)
      4-6  → ["2-5"]            (5-10 excluded: b_hi=10 > max=6)
      5-10 → ["5-10"]
      7-7  → ["5-10"]           (fallback)
      0-2  → ["0-2"]
      10+  → ["10+"]
    """
    if min_y is None and max_y is None:
        return []
    lo = 0.0 if min_y is None else float(min_y)
    hi = 50.0 if max_y is None else float(max_y)
    if hi < lo:
        lo, hi = hi, lo

    buckets = [("0-2", 0, 2), ("2-5", 2, 5), ("5-10", 5, 10), ("10+", 10, 50)]

    # Strict: bucket overlaps [lo, hi] AND b_hi <= hi (don't reach above
    # candidate's actual max experience).
    fitted = [
        name for (name, b_lo, b_hi) in buckets
        if b_hi > lo and b_lo < hi and b_hi <= hi
    ]
    if fitted:
        return fitted

    # Fallback: pick the single bucket containing hi.
    for (name, b_lo, b_hi) in buckets:
        if b_lo <= hi < b_hi:
            return [name]
        if name == "10+" and hi >= 10:
            return [name]
    return []


class FantasticJobsScraper(BaseSourceScraper):
    name = "fantastic_jobs"
    display_name = "Fantastic Jobs (Apify)"
    compliance_notes = (
        "Apify actor fantastic-jobs/career-site-job-listing-api aggregates "
        "career-site postings across 50+ ATS platforms."
    )

    def __init__(
        self,
        titles: Optional[list[str]] = None,
        locations: Optional[list[str]] = None,
        descriptions: Optional[list[str]] = None,
        max_items: Optional[int] = None,
        time_range: Optional[str] = None,
        remote_only: Optional[bool] = None,        # legacy — prefer work_arrangement
        include_ai: Optional[bool] = None,
        # New filters with operator-chosen defaults:
        include_linkedin: Optional[bool] = None,
        description_type: Optional[str] = None,
        remove_agency: Optional[bool] = None,
        ats: Optional[list[str]] = None,
        employment_type: Optional[list[str]] = None,
        work_arrangement: Optional[list[str]] = None,
        experience_levels: Optional[list[str]] = None,
        years_min: Optional[float] = None,
        years_max: Optional[float] = None,
        visa_sponsorship: Optional[bool] = None,
        country_filter: Optional[str] = None,    # post-filter on countries_derived
        date_posted_after: Optional[str] = None,  # ISO; sent as actor datePostedAfter
        token: Optional[str] = None,
        client: Any = None,
        **kw: Any,
    ) -> None:
        super().__init__(**kw)
        self.titles = titles if titles is not None else settings.fantastic_jobs_titles
        self.locations = (locations if locations is not None
                          else (settings.fantastic_jobs_locations
                                or list(DEFAULT_LOCATIONS)))
        self.descriptions = (descriptions if descriptions is not None
                             else settings.fantastic_jobs_descriptions)
        # "no limit" by default → cap at the actor's max (5000).
        self.max_items = max_items if max_items is not None else (
            settings.fantastic_jobs_max or ACTOR_MAX_LIMIT)
        # "auto" means try 1h then fall back to 24h. Anything else is passed through.
        self.time_range = time_range or settings.fantastic_jobs_time_range or DEFAULT_TIME_RANGE
        self.remote_only = (settings.fantastic_jobs_remote_only
                            if remote_only is None else remote_only)
        self.include_ai = (settings.fantastic_jobs_include_ai
                           if include_ai is None else include_ai)
        self.include_linkedin = (settings.fantastic_jobs_include_linkedin
                                 if include_linkedin is None else include_linkedin)
        self.description_type = (description_type
                                 or settings.fantastic_jobs_description_type
                                 or "text")
        self.remove_agency = (settings.fantastic_jobs_remove_agency
                              if remove_agency is None else remove_agency)
        self.ats = (ats if ats is not None else settings.fantastic_jobs_ats)
        # Default employment type = FULL_TIME + CONTRACTOR
        self.employment_type = (
            employment_type if employment_type is not None
            else (settings.fantastic_jobs_employment_type
                  or list(DEFAULT_EMPLOYMENT)))
        # Work arrangement: explicit arg > env > legacy remote_only=True
        # shortcut > default (all four buckets).
        if work_arrangement is not None:
            self.work_arrangement = list(work_arrangement)
        elif settings.fantastic_jobs_work_arrangement:
            self.work_arrangement = list(settings.fantastic_jobs_work_arrangement)
        elif remote_only is True:
            self.work_arrangement = ["Remote OK", "Remote Solely"]
        else:
            self.work_arrangement = list(DEFAULT_WORK_ARRANGEMENT)
        # Experience: explicit array wins; else derive from years_min/max;
        # else fall back to env-configured array.
        if experience_levels is not None:
            self.experience_levels = experience_levels
        elif years_min is not None or years_max is not None:
            self.experience_levels = years_to_experience_levels(years_min, years_max)
        else:
            self.experience_levels = settings.fantastic_jobs_experience_levels
        self.visa_sponsorship = (settings.fantastic_jobs_visa_sponsorship
                                 if visa_sponsorship is None else visa_sponsorship)
        self.country_filter = (country_filter if country_filter is not None
                               else settings.fantastic_jobs_country)
        self.date_posted_after = date_posted_after  # ISO 8601 string, optional
        self.token = token if token is not None else os.getenv("APIFY_TOKEN", "")
        self._injected_client = client

    def _make_client(self) -> Any:
        if self._injected_client is not None:
            return self._injected_client
        from apify_client import ApifyClient
        return ApifyClient(self.token)

    def fetch_listings(self) -> Iterator[dict[str, Any]]:
        if not (self.titles or self.descriptions or self.locations):
            self.log.info("fantastic_jobs.skip", reason="no_search_params")
            return
        if not self.token and self._injected_client is None:
            self.log.warning("fantastic_jobs.skip", reason="missing_APIFY_TOKEN")
            return

        # Build the static filters (everything except timeRange).
        base: dict[str, Any] = {
            "limit": int(self.max_items),
            "includeAi": bool(self.include_ai),
            "includeLinkedIn": bool(self.include_linkedin),
            "descriptionType": self.description_type,
            "removeAgency": bool(self.remove_agency),
        }
        if self.titles:
            base["titleSearch"] = list(self.titles)
        if self.locations:
            base["locationSearch"] = list(self.locations)
        if self.descriptions:
            base["descriptionSearch"] = list(self.descriptions)
        if self.ats:
            base["ats"] = list(self.ats)
        if self.employment_type:
            base["aiEmploymentTypeFilter"] = list(self.employment_type)
        # work_arrangement is always populated (defaulted at __init__).
        if self.work_arrangement:
            base["aiWorkArrangementFilter"] = list(self.work_arrangement)
        if self.experience_levels:
            base["aiExperienceLevelFilter"] = list(self.experience_levels)
        if self.visa_sponsorship:
            base["aiVisaSponsorshipFilter"] = True
        if self.date_posted_after:
            base["datePostedAfter"] = self.date_posted_after

        client = self._make_client()
        actor = client.actor(ACTOR_ID)

        # Resolve timeRange: "auto" tries 1h first, falls back to 24h on
        # zero hits. Any explicit value (1h/24h/7d/6m) is used as-is.
        attempts = (["1h", "24h"] if self.time_range == "auto"
                    else [self.time_range])

        items_emitted = 0
        for tr in attempts:
            run_input = {**base, "timeRange": tr}
            self.log.info(
                "fantastic_jobs.scrape.start",
                titles=len(self.titles), locations=len(self.locations),
                descriptions=len(self.descriptions),
                max_items=self.max_items, time_range=tr,
                ats_filter=len(self.ats) if self.ats else 0,
                employment=self.employment_type,
                work_arrangement=self.work_arrangement or "all",
                experience=self.experience_levels or "any",
                remove_agency=self.remove_agency,
            )
            t0 = time.monotonic()
            try:
                run = actor.call(run_input=run_input)
            except Exception as e:
                self.log.error("fantastic_jobs.actor.fail", error=str(e)[:300], time_range=tr)
                continue
            if not run:
                self.log.warning("fantastic_jobs.actor.empty_run", time_range=tr)
                continue
            ds_id = (run.get("defaultDatasetId") if isinstance(run, dict)
                     else getattr(run, "default_dataset_id", None))
            if not ds_id:
                self.log.warning("fantastic_jobs.actor.no_dataset", time_range=tr)
                continue

            count_this_window = 0
            country_dropped = 0
            cf = (self.country_filter or "").strip().lower()
            for item in client.dataset(ds_id).iterate_items():
                if cf:
                    derived = item.get("countries_derived") or []
                    if isinstance(derived, list) and derived:
                        if not any(cf in str(c).lower() for c in derived):
                            country_dropped += 1
                            continue
                    # Empty countries_derived: KEEP. The actor's own
                    # aiCountry filter already restricted results, so a
                    # missing derived field is a metadata gap, not a
                    # signal that the job is in a different country.
                    # (Previous behavior dropped these conservatively;
                    # in practice that lost a meaningful slice of valid
                    # postings whose geo wasn't populated.)
                count_this_window += 1
                items_emitted += 1
                yield item
            if country_dropped:
                self.log.info("fantastic_jobs.country_filter_dropped",
                              dropped=country_dropped, country=self.country_filter)
            self.log.info(
                "fantastic_jobs.window.done",
                time_range=tr, jobs_seen=count_this_window,
                elapsed_s=round(time.monotonic() - t0, 2),
            )
            # If this window produced rows, stop. Only fall through to the
            # next window when the current returned zero (the "auto" path).
            if count_this_window > 0:
                break

        self.log.info("fantastic_jobs.scrape.done", jobs_seen=items_emitted)

    def parse_listing(self, raw: dict[str, Any]) -> Optional[JobPosting]:
        # Actor schema is snake_case; we accept both for back-compat with
        # camelCase fixtures used in unit tests.
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

        # Location: derived city/region/country first, then fall back to
        # operator-supplied alt strings.
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
            alt = raw.get("locations_alt_raw") or raw.get("locationsRaw")
            if isinstance(alt, list) and alt:
                first = alt[0]
                if isinstance(first, str):
                    loc = first
                elif isinstance(first, dict):
                    loc = first.get("name") or first.get("address") or None

        url = g("url", "jobUrl") or ""
        apply_url = g("apply_url", "applyUrl") or url
        desc = g("description_text", "description", "descriptionText", "descriptionHtml")
        snippet = clean_text(desc, limit=400)
        full = clean_text(desc)

        posted_raw = g("date_posted", "datePosted", "postedAt")
        posted_dt: Optional[datetime] = None
        if isinstance(posted_raw, str):
            try:
                posted_dt = datetime.fromisoformat(posted_raw.replace("Z", "+00:00"))
                if posted_dt.tzinfo is None:
                    posted_dt = posted_dt.replace(tzinfo=timezone.utc)
            except ValueError:
                posted_dt = None

        emp_type = g("ai_employment_type", "employment_type", "aiEmploymentType", "employmentType")
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
        elif raw.get("remote_derived") is True and not remote_type:
            remote_type = "remote"

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
            country=(countries[0] if isinstance(countries, list) and countries else None),
            remote_type=remote_type,
            employment_type=str(emp_type) if emp_type else None,
            seniority=g("ai_experience_level", "aiExperienceLevel", "seniorityLevel"),
            salary=str(salary) if salary else None,
            department=g("ai_taxonomies_a", "aiTaxonomyPrimary", "department"),
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
