from __future__ import annotations

import asyncio
import random
import time
from collections.abc import Mapping
from typing import Any, Literal

import httpx
from tenacity import (
    RetryCallState,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

Kind = Literal["api", "download"]


class RetryableHTTPError(Exception):
    def __init__(self, message: str, status_code: int | None = None, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


class CircuitOpenError(RuntimeError):
    pass


class RateLimiter:
    def __init__(self, requests_per_second: float) -> None:
        self.min_interval = 1.0 / max(requests_per_second, 0.1)
        self._lock = asyncio.Lock()
        self._last = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self.min_interval - (now - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            await asyncio.sleep(random.uniform(0.1, 0.4))
            self._last = time.monotonic()


class CircuitBreaker:
    def __init__(self, threshold: int = 20) -> None:
        self.threshold = threshold
        self.consecutive = 0
        self._lock = asyncio.Lock()

    async def record_success(self) -> None:
        async with self._lock:
            self.consecutive = 0

    async def record_failure(self) -> None:
        async with self._lock:
            self.consecutive += 1
            if self.consecutive >= self.threshold:
                raise CircuitOpenError(
                    f"Stopped after {self.consecutive} consecutive failures. "
                    "The remote host is probably blocking requests. Wait and retry later."
                )


def _wait_factory(retry_state: RetryCallState) -> float:
    exc = retry_state.outcome.exception() if retry_state.outcome else None
    if isinstance(exc, RetryableHTTPError) and exc.retry_after is not None:
        return float(exc.retry_after)
    return wait_exponential_jitter(initial=1, max=30)(retry_state)


class HttpClient:
    def __init__(
        self,
        *,
        user_agent: str,
        connect_timeout: float,
        read_timeout: float,
        retries: int,
        requests_per_second: float,
        circuit: CircuitBreaker | None = None,
    ) -> None:
        self.retries = retries
        self.circuit = circuit or CircuitBreaker()
        self.api_limiter = RateLimiter(requests_per_second)
        timeout = httpx.Timeout(read_timeout, connect=connect_timeout)
        headers = {
            "User-Agent": user_agent,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
            "Referer": "https://www.digikala.com/",
            "Origin": "https://www.digikala.com",
        }
        try:
            self._client = httpx.AsyncClient(
                http2=True,
                follow_redirects=True,
                timeout=timeout,
                headers=headers,
            )
        except ImportError:
            self._client = httpx.AsyncClient(
                http2=False,
                follow_redirects=True,
                timeout=timeout,
                headers=headers,
            )

        retry_decorator = retry(
            stop=stop_after_attempt(retries),
            wait=_wait_factory,
            retry=retry_if_exception_type(
                (RetryableHTTPError, httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError)
            ),
            reraise=True,
        )
        self._request = retry_decorator(self._request_once)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get_json(self, url: str, *, params: Mapping[str, Any] | None = None) -> Any:
        response = await self.request("GET", url, params=params, kind="api")
        return response.json()

    async def get_bytes(
        self,
        url: str,
        *,
        kind: Kind = "download",
        headers: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        return await self.request("GET", url, kind=kind, headers=headers)

    async def request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        kind: Kind = "api",
    ) -> httpx.Response:
        try:
            response = await self._request(method, url, params=params, headers=headers, kind=kind)
        except Exception:
            await self.circuit.record_failure()
            raise
        await self.circuit.record_success()
        return response

    async def _request_once(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        kind: Kind = "api",
    ) -> httpx.Response:
        if kind == "api":
            await self.api_limiter.acquire()
        else:
            await asyncio.sleep(random.uniform(0.1, 0.4))
        try:
            response = await self._client.request(method, url, params=params, headers=headers)
        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError):
            raise
        if response.status_code == 429:
            raise RetryableHTTPError(
                "rate limited",
                status_code=429,
                retry_after=_parse_retry_after(response),
            )
        if response.status_code >= 500:
            raise RetryableHTTPError(
                f"server error {response.status_code}",
                status_code=response.status_code,
            )
        return response


def _parse_retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return max(float(raw), 0.0)
    except ValueError:
        return None
