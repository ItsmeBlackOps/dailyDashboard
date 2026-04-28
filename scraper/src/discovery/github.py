"""Fetch slug lists from public GitHub raw URLs.

Users list URLs in .env via GITHUB_SLUG_URLS_<SOURCE>. Each URL should
return plain text (one slug per line) or JSON (a list of strings, or a
list of objects with `slug`/`board_token`/`company` keys).

Example .env:
    GITHUB_SLUG_URLS_GREENHOUSE=https://raw.githubusercontent.com/acme/tenants/main/greenhouse.txt
    GITHUB_SLUG_URLS_LEVER=https://raw.githubusercontent.com/acme/tenants/main/lever.json
"""
from __future__ import annotations

import json
import os

from src.http_client import HttpClient
from src.logging_config import get_logger

log = get_logger(__name__)


SLUG_KEYS = ("slug", "board_token", "boardToken", "company", "handle", "name")


def _parse(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    # JSON first
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if isinstance(data, list):
        out: list[str] = []
        for el in data:
            if isinstance(el, str):
                out.append(el.strip())
            elif isinstance(el, dict):
                for k in SLUG_KEYS:
                    if k in el and isinstance(el[k], str):
                        out.append(el[k].strip())
                        break
        return [s for s in out if s]
    # plain text, one slug per line
    return [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]


def fetch(source_name: str, http: HttpClient | None = None) -> list[str]:
    env_key = f"GITHUB_SLUG_URLS_{source_name.upper()}"
    urls = [u.strip() for u in (os.getenv(env_key) or "").split(",") if u.strip()]
    if not urls:
        return []
    owns_http = http is None
    http = http or HttpClient()
    slugs: list[str] = []
    try:
        for url in urls:
            resp = http.get(url)
            if not resp or resp.status_code != 200:
                log.warning("github.miss", source=source_name, url=url,
                            status=getattr(resp, "status_code", None))
                continue
            try:
                chunk = _parse(resp.text)
            except Exception as e:
                log.warning("github.parse_error", url=url, error=str(e))
                continue
            log.info("github.loaded", source=source_name, url=url, count=len(chunk))
            slugs.extend(chunk)
    finally:
        if owns_http:
            http.close()
    return slugs
