"""Central plugin registry. Add new sources here to make them available."""
from __future__ import annotations

from typing import Callable

from config import settings
from src.base import BaseSourceScraper
from src.discovery import seed_lists
from src.discovery.orchestrator import load_from_disk
from src.sources.adzuna import AdzunaScraper
from src.sources.ashby import AshbyScraper
from src.sources.bamboohr import BambooHRScraper
from src.sources.custom_jsonld import CustomJsonLdScraper
from src.sources.dayforce import DayforceScraper
from src.sources.eightfold import EightfoldScraper
from src.sources.fantastic_jobs import FantasticJobsScraper
from src.sources.greenhouse import GreenhouseScraper
from src.sources.icims import ICIMSScraper
from src.sources.jazzhr import JazzHRScraper
from src.sources.jobpulse_import import load_targets
from src.sources.jobvite import JobviteScraper
from src.sources.lever import LeverScraper
from src.sources.linkedin import LinkedInScraper
from src.sources.oracle_rc import OracleRCScraper
from src.sources.paylocity import PaylocityScraper
from src.sources.personio import PersonioScraper
from src.sources.recruitee import RecruiteeScraper
from src.sources.remoteok import RemoteOKScraper
from src.sources.rippling import RipplingScraper
from src.sources.smartrecruiters import SmartRecruitersScraper
from src.sources.successfactors import SuccessFactorsScraper
from src.sources.teamtailor import TeamtailorScraper
from src.sources.ukg import UKGScraper
from src.sources.usajobs import USAJobsScraper
from src.sources.workable import WorkableScraper
from src.sources.workday import WorkdayScraper


# Registry ordered by expected yield / compliance confidence. Runner consumes
# them in this order and stops when the target is met (but still records all).
REGISTRY: list[Callable[..., BaseSourceScraper]] = [
    GreenhouseScraper,
    LeverScraper,
    AshbyScraper,
    SmartRecruitersScraper,
    WorkableScraper,
    WorkdayScraper,
    ICIMSScraper,
    RecruiteeScraper,
    PersonioScraper,
    JobviteScraper,
    JazzHRScraper,
    EightfoldScraper,
    RipplingScraper,
    TeamtailorScraper,
    SuccessFactorsScraper,
    BambooHRScraper,
    PaylocityScraper,
    UKGScraper,
    OracleRCScraper,
    DayforceScraper,
    CustomJsonLdScraper,
    AdzunaScraper,
    USAJobsScraper,
    RemoteOKScraper,
    LinkedInScraper,
    FantasticJobsScraper,
]


def _merged_targets(source_name: str, configured: list[str]) -> list[str]:
    """Union slugs from every available source, in order:
        1. user-configured env var (explicit wins on tie)
        2. data/companies/<source>.txt (persisted discovery output)
        3. JobPulse-cloned lists
        4. embedded seed list

    De-duplicated, case-insensitive.
    """
    layers: list[list[str]] = [
        configured,
        load_from_disk(source_name),
        load_targets(source_name),
        seed_lists.seed(source_name),
    ]
    seen: set[str] = set()
    merged: list[str] = []
    for layer in layers:
        for slug in layer:
            s = slug.strip()
            if not s:
                continue
            k = s.lower()
            if k in seen:
                continue
            seen.add(k)
            merged.append(s)
    return merged


def _merged_custom_jsonld_urls(configured: list[str]) -> list[str]:
    """URLs (not slugs) union: env-configured + employer-discovery output.

    The employer-domain discovery strategy writes
    ``data/companies/custom_jsonld.txt`` when it detects a custom career
    site with JSON-LD. We read that file here so those URLs flow into the
    daily pipeline without further config.
    """
    from src.discovery.orchestrator import load_from_disk

    seen: set[str] = set()
    merged: list[str] = []
    for url in list(configured) + load_from_disk("custom_jsonld"):
        s = url.strip()
        if not s:
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        merged.append(s)
    return merged


def all_scrapers() -> list[BaseSourceScraper]:
    """Instantiate every registered source, scaling company lists to the full
    union of env + discovery + JobPulse + seeds."""
    return [
        GreenhouseScraper(boards=_merged_targets("greenhouse", settings.greenhouse_boards)),
        LeverScraper(companies=_merged_targets("lever", settings.lever_companies)),
        AshbyScraper(companies=_merged_targets("ashby", settings.ashby_companies)),
        SmartRecruitersScraper(
            companies=_merged_targets("smartrecruiters", settings.smartrecruiters_companies)
        ),
        WorkableScraper(companies=_merged_targets("workable", settings.workable_companies)),
        WorkdayScraper(tenants=_merged_targets("workday", settings.workday_tenants)),
        ICIMSScraper(companies=_merged_targets("icims", settings.icims_companies)),
        RecruiteeScraper(
            companies=_merged_targets("recruitee", settings.recruitee_companies)
        ),
        PersonioScraper(
            companies=_merged_targets("personio", settings.personio_companies)
        ),
        JobviteScraper(
            companies=_merged_targets("jobvite", settings.jobvite_companies)
        ),
        JazzHRScraper(
            companies=_merged_targets("jazzhr", settings.jazzhr_companies)
        ),
        EightfoldScraper(
            tenants=_merged_targets("eightfold", settings.eightfold_tenants)
        ),
        RipplingScraper(
            companies=_merged_targets("rippling", settings.rippling_companies)
        ),
        TeamtailorScraper(
            companies=_merged_targets("teamtailor", settings.teamtailor_companies)
        ),
        SuccessFactorsScraper(
            companies=_merged_targets("successfactors", settings.successfactors_companies)
        ),
        BambooHRScraper(
            companies=_merged_targets("bamboohr", settings.bamboohr_companies)
        ),
        PaylocityScraper(
            companies=_merged_targets("paylocity", settings.paylocity_companies)
        ),
        UKGScraper(
            companies=_merged_targets("ukg", settings.ukg_companies)
        ),
        OracleRCScraper(
            companies=_merged_targets("oracle_rc", settings.oracle_rc_companies)
        ),
        DayforceScraper(
            companies=_merged_targets("dayforce", settings.dayforce_companies)
        ),
        CustomJsonLdScraper(
            urls=_merged_custom_jsonld_urls(settings.custom_jsonld_urls)
        ),
        AdzunaScraper(),
        USAJobsScraper(),
        RemoteOKScraper(),
        LinkedInScraper(
            titles=settings.linkedin_titles,
            locations=settings.linkedin_locations,
            descriptions=settings.linkedin_descriptions,
            max_items=settings.linkedin_max_jobs,
            time_range=settings.linkedin_time_range,
            remote_only=settings.linkedin_remote_only,
            include_ai=settings.linkedin_include_ai,
            seniority_filter=settings.linkedin_seniority,
            employment_filter=settings.linkedin_employment,
            exclude_ats_dup=settings.linkedin_exclude_ats_dup,
            # legacy aliases honored inside the constructor:
            queries=settings.linkedin_search_queries,
            location=settings.linkedin_location,
            days=settings.linkedin_days,
        ),
        FantasticJobsScraper(
            titles=settings.fantastic_jobs_titles,
            locations=settings.fantastic_jobs_locations,
            descriptions=settings.fantastic_jobs_descriptions,
            max_items=settings.fantastic_jobs_max,
            time_range=settings.fantastic_jobs_time_range,
            remote_only=settings.fantastic_jobs_remote_only,
            include_ai=settings.fantastic_jobs_include_ai,
        ),
    ]
