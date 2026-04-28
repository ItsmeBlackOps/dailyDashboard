"""Optional Apify-powered discovery.

Activated when APIFY_TOKEN is set. Runs ATS-specific Apify actors that
enumerate Greenhouse/Lever/Ashby tenants and extracts their slugs.

Default actors (override via env):
    APIFY_ACTOR_GREENHOUSE=jobo.world/greenhouse-jobs-search
    APIFY_ACTOR_LEVER=jobo.world/lever-jobs-search
    APIFY_ACTOR_ASHBY=                       # no public free actor; skipped

Most actors charge per job record, so we cap input tightly — we only need
the *company* slug, not full postings. We send a broad query (e.g. 'analyst')
and grab the unique company fields.
"""
from __future__ import annotations

import os
import time
from typing import Iterable

from src.http_client import HttpClient
from src.logging_config import get_logger

log = get_logger(__name__)


APIFY_API = "https://api.apify.com/v2"


def _actor_for(source: str) -> str | None:
    env_key = f"APIFY_ACTOR_{source.upper()}"
    explicit = os.getenv(env_key)
    if explicit:
        return explicit
    defaults = {
        "greenhouse": "jobo.world~greenhouse-jobs-search",
        "lever": "jobo.world~lever-jobs-search",
    }
    return defaults.get(source)


def _run_sync(http: HttpClient, actor: str, token: str, body: dict) -> list[dict]:
    """Synchronous Apify run-and-wait. Returns dataset items (capped)."""
    url = f"{APIFY_API}/acts/{actor}/run-sync-get-dataset-items"
    resp = http.post(
        url, json=body, headers={"Authorization": f"Bearer {token}"}
    )
    if not resp or resp.status_code not in (200, 201):
        log.warning("apify.failed", actor=actor,
                    status=getattr(resp, "status_code", None))
        return []
    try:
        data = resp.json()
    except ValueError:
        return []
    return data if isinstance(data, list) else []


def _extract_slugs(items: Iterable[dict], source: str) -> list[str]:
    out: list[str] = []
    for it in items:
        # Common fields returned by these actors.
        for key in ("companySlug", "company_slug", "slug", "board_token",
                    "boardToken", "company", "companyId"):
            v = it.get(key) if isinstance(it, dict) else None
            if isinstance(v, str) and v.strip():
                slug = v.strip()
                # Actors sometimes return full URLs; take the last path segment.
                if "/" in slug:
                    slug = slug.rstrip("/").rsplit("/", 1)[-1]
                out.append(slug)
                break
    return out


def fetch(source_name: str, http: HttpClient | None = None, *,
          max_items: int = 5000) -> list[str]:
    token = os.getenv("APIFY_TOKEN")
    if not token:
        log.info("apify.skipped", reason="no APIFY_TOKEN")
        return []
    actor = _actor_for(source_name)
    if not actor:
        return []
    owns_http = http is None
    http = http or HttpClient(timeout=120.0)
    try:
        # Broad search — 'analyst' surfaces most U.S. Data-Analyst-friendly companies.
        body = {
            "query": "analyst",
            "location": "United States",
            "limit": max_items,
            "keywords": ["analyst", "data"],
        }
        items = _run_sync(http, actor, token, body)
        slugs = _extract_slugs(items, source_name)
        log.info("apify.done", source=source_name, actor=actor,
                 items=len(items), slugs=len(slugs))
        return slugs
    finally:
        if owns_http:
            http.close()
