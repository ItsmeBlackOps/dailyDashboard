"""Shared HTTP client: retries, backoff, rate limiting, rotating UA."""
from __future__ import annotations

import random
import threading
import time
from collections import defaultdict
from typing import Any, Optional
from urllib.parse import urlparse

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from config import settings
from src.logging_config import get_logger

log = get_logger(__name__)

# Realistic, rotating user-agents. Used politely — not to evade detection.
USER_AGENTS: tuple[str, ...] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0 Safari/537.36",
)

# Per-host minimum spacing in seconds (politeness). Overridden if Retry-After seen.
_HOST_MIN_INTERVAL = 0.75

_last_hit: dict[str, float] = defaultdict(lambda: 0.0)
_lock = threading.Lock()


def _throttle(url: str) -> None:
    host = urlparse(url).netloc
    with _lock:
        now = time.monotonic()
        delta = now - _last_hit[host]
        if delta < _HOST_MIN_INTERVAL:
            time.sleep(_HOST_MIN_INTERVAL - delta)
        _last_hit[host] = time.monotonic()


class HttpClient:
    """Thin wrapper over httpx.Client with retries + per-host pacing."""

    def __init__(
        self,
        *,
        timeout: Optional[float] = None,
        extra_headers: Optional[dict[str, str]] = None,
        http2: bool = True,
    ) -> None:
        self._timeout = httpx.Timeout(timeout or settings.request_timeout)
        headers = {
            "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        if extra_headers:
            headers.update(extra_headers)
        # httpx native transport retries handle connection errors; we add our own
        # application-level retry on top for 429/5xx.
        transport = httpx.HTTPTransport(retries=1)
        self._client = httpx.Client(
            timeout=self._timeout,
            headers=headers,
            http2=http2,
            follow_redirects=True,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "HttpClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def _headers_for(self, override: Optional[dict[str, str]] = None) -> dict[str, str]:
        h = {"User-Agent": random.choice(USER_AGENTS)}
        if override:
            h.update(override)
        return h

    # ----- public ----------------------------------------------------
    def get(
        self,
        url: str,
        *,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Optional[httpx.Response]:
        return self._request("GET", url, params=params, headers=headers)

    def post(
        self,
        url: str,
        *,
        json: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Optional[httpx.Response]:
        return self._request("POST", url, json=json, headers=headers)

    # ----- internal --------------------------------------------------
    def _request(
        self,
        method: str,
        url: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> Optional[httpx.Response]:
        @retry(
            reraise=True,
            retry=retry_if_exception_type(
                (httpx.TransportError, httpx.TimeoutException, _RetryableStatus)
            ),
            stop=stop_after_attempt(settings.max_retries),
            wait=wait_exponential(
                multiplier=settings.base_backoff, min=settings.base_backoff, max=20.0
            ),
        )
        def _do() -> httpx.Response:
            _throttle(url)
            resp = self._client.request(
                method,
                url,
                params=params,
                json=json,
                headers=self._headers_for(headers),
            )
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                retry_after = resp.headers.get("Retry-After")
                if retry_after:
                    try:
                        time.sleep(min(float(retry_after), 20.0))
                    except ValueError:
                        pass
                raise _RetryableStatus(
                    f"{method} {url} -> HTTP {resp.status_code}", resp.status_code
                )
            return resp

        try:
            return _do()
        except _RetryableStatus as e:
            log.warning("http.retry_exhausted", url=url, status=e.status)
            return None
        except httpx.HTTPError as e:
            log.warning("http.transport_error", url=url, error=str(e))
            return None


class _RetryableStatus(Exception):
    def __init__(self, msg: str, status: int):
        super().__init__(msg)
        self.status = status
