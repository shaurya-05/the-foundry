"""
Thin GitHub REST API client.

Just enough to walk the authed user's repos and pull commits, PRs, and
issues for the workspace-graph ingestion. No caching layer here —
upstream call sites handle idempotency via UNIQUE (workspace_id, source,
source_id) on the graph tables.

Rate limit handling:
    - Read X-RateLimit-Remaining / X-RateLimit-Reset on every response.
    - When Remaining drops near zero, sleep until Reset.
    - On 403 with "secondary rate limit", honor Retry-After.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncIterator, Optional

import httpx
import structlog

log = structlog.get_logger()

GITHUB_API = "https://api.github.com"
DEFAULT_TIMEOUT = httpx.Timeout(20.0, read=30.0)


class GitHubError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"GitHub {status}: {body[:200]}")
        self.status = status
        self.body = body


class GitHubClient:
    """One client per OAuth connection. Reuses httpx.AsyncClient."""

    def __init__(self, access_token: str):
        self._token = access_token
        self._client = httpx.AsyncClient(
            base_url=GITHUB_API,
            timeout=DEFAULT_TIMEOUT,
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "FOUND3RY/workspace-graph",
                "Authorization": f"Bearer {self._token}",
            },
        )

    async def aclose(self):
        await self._client.aclose()

    async def __aenter__(self) -> "GitHubClient":
        return self

    async def __aexit__(self, *exc):
        await self.aclose()

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        # Retry loop for rate limits and transient 5xx
        for attempt in range(3):
            r = await self._client.request(method, path, **kwargs)
            if r.status_code == 403 and "secondary rate limit" in r.text.lower():
                wait = int(r.headers.get("Retry-After", "60"))
                log.warning("github_secondary_ratelimit", wait=wait)
                await asyncio.sleep(min(wait, 120))
                continue
            remaining = r.headers.get("X-RateLimit-Remaining")
            if r.status_code == 200 and remaining and int(remaining) <= 5:
                reset = int(r.headers.get("X-RateLimit-Reset", "0"))
                pause = max(0, reset - int(time.time())) + 1
                if pause > 0:
                    log.info("github_ratelimit_pause", seconds=pause)
                    await asyncio.sleep(min(pause, 120))
            if 500 <= r.status_code < 600:
                await asyncio.sleep(1 + attempt * 2)
                continue
            return r
        return r

    async def get(self, path: str, **params) -> Any:
        r = await self._request("GET", path, params=params or None)
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise GitHubError(r.status_code, r.text)
        return r.json()

    async def paginate(
        self,
        path: str,
        *,
        per_page: int = 100,
        max_pages: int = 20,
        **params,
    ) -> AsyncIterator[dict]:
        """Yield items across paginated endpoints. Stops after max_pages."""
        page = 1
        while page <= max_pages:
            r = await self._request(
                "GET", path, params={**params, "per_page": per_page, "page": page}
            )
            if r.status_code == 404:
                return
            if r.status_code >= 400:
                raise GitHubError(r.status_code, r.text)
            chunk = r.json()
            if not chunk:
                return
            for item in chunk:
                yield item
            # Honor "next" link
            link = r.headers.get("Link", "")
            if 'rel="next"' not in link:
                return
            page += 1

    # ─── Domain helpers ────────────────────────────────────────────

    async def viewer(self) -> Optional[dict]:
        return await self.get("/user")

    def list_repos(self, **params) -> AsyncIterator[dict]:
        """All repos the authed user can see — owner, collab, org member."""
        defaults = {"affiliation": "owner,collaborator,organization_member", "sort": "pushed"}
        return self.paginate("/user/repos", **{**defaults, **params})

    def list_commits(self, full_name: str, **params) -> AsyncIterator[dict]:
        return self.paginate(f"/repos/{full_name}/commits", **params)

    def list_pulls(self, full_name: str, **params) -> AsyncIterator[dict]:
        defaults = {"state": "all", "sort": "updated", "direction": "desc"}
        return self.paginate(f"/repos/{full_name}/pulls", **{**defaults, **params})

    def list_issues(self, full_name: str, **params) -> AsyncIterator[dict]:
        # /issues includes PRs by default; filter via has "pull_request" key downstream
        defaults = {"state": "all", "sort": "updated", "direction": "desc"}
        return self.paginate(f"/repos/{full_name}/issues", **{**defaults, **params})
