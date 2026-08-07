"""
Phase 7d — background cloud sync loop + shared push/pull runners.

Extracted from the HTTP handlers so the lifespan loop can call the same
push-then-pull path without an AuthContext. Token refresh on 401 updates
in-memory / process env only — not Electron safeStorage (no callback path).
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
import structlog

from app.db.postgres import get_pool
from app.dependencies import AuthContext

log = structlog.get_logger()

DEFAULT_CLOUD_SYNC_INTERVAL_S = 600

# In-memory override after a successful refresh (process lifetime only).
_runtime_access_token: Optional[str] = None


class CloudSyncOpError(Exception):
    """Non-HTTP error from push/pull runners (routes map to HTTPException)."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def cloud_sync_enabled() -> bool:
    return os.getenv("CLOUD_SYNC_ENABLED", "0").lower() not in (
        "0", "false", "no", "off", "",
    )


def cloud_sync_interval_s() -> int:
    raw = os.getenv("CLOUD_SYNC_INTERVAL_S", str(DEFAULT_CLOUD_SYNC_INTERVAL_S))
    try:
        return max(60, int(raw))
    except ValueError:
        return DEFAULT_CLOUD_SYNC_INTERVAL_S


def get_cloud_env() -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Non-raising env read. Returns (access_token, refresh_token, api_url)."""
    global _runtime_access_token
    access = (_runtime_access_token or os.getenv("CLOUD_SYNC_ACCESS_TOKEN") or "").strip()
    refresh = (os.getenv("CLOUD_SYNC_REFRESH_TOKEN") or "").strip()
    api_url = (os.getenv("CLOUD_SYNC_API_URL") or "").rstrip("/")
    return access or None, refresh or None, api_url or None


def require_cloud_env() -> tuple[str, str]:
    access, _refresh, api_url = get_cloud_env()
    if not access:
        raise CloudSyncOpError(
            400,
            "CLOUD_SYNC_ACCESS_TOKEN is empty — link a cloud account and restart "
            "the desktop app so the token is loaded into the backend env",
        )
    if not api_url:
        raise CloudSyncOpError(400, "CLOUD_SYNC_API_URL is not configured")
    return access, api_url


def set_runtime_access_token(token: str) -> None:
    """Keep a refreshed access token for this process only."""
    global _runtime_access_token
    _runtime_access_token = token
    os.environ["CLOUD_SYNC_ACCESS_TOKEN"] = token


def clear_runtime_access_token_for_tests() -> None:
    global _runtime_access_token
    _runtime_access_token = None


async def refresh_cloud_access_token(api_url: str) -> Optional[str]:
    """
    POST /api/auth/refresh with CLOUD_SYNC_REFRESH_TOKEN.
    On success, stores the new access token in-memory (not Electron safeStorage).
    """
    _access, refresh, _url = get_cloud_env()
    if not refresh:
        log.warning("cloud_sync_refresh_skipped", reason="no refresh token")
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{api_url.rstrip('/')}/api/auth/refresh",
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                json={"refresh_token": refresh},
            )
    except httpx.HTTPError as exc:
        log.warning("cloud_sync_refresh_network_error", error=str(exc)[:200])
        return None
    if resp.status_code >= 400:
        log.warning("cloud_sync_refresh_rejected", status=resp.status_code)
        return None
    try:
        data = resp.json()
    except Exception:
        return None
    token = data.get("access_token")
    if not token:
        return None
    set_runtime_access_token(str(token))
    log.info("cloud_sync_access_token_refreshed")
    return str(token)


async def cloud_http(
    method: str,
    api_url: str,
    path: str,
    *,
    access_token: str,
    json_body: Any = None,
    params: Optional[dict] = None,
    retry_on_401: bool = True,
) -> httpx.Response:
    """Authenticated cloud call with one transparent refresh+retry on 401."""
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.request(
                method,
                f"{api_url.rstrip('/')}{path}",
                headers=headers,
                json=json_body,
                params=params,
            )
    except httpx.HTTPError as exc:
        raise CloudSyncOpError(502, f"Failed to reach cloud API ({api_url}): {exc}") from exc

    if resp.status_code == 401 and retry_on_401:
        new_token = await refresh_cloud_access_token(api_url)
        if new_token:
            return await cloud_http(
                method,
                api_url,
                path,
                access_token=new_token,
                json_body=json_body,
                params=params,
                retry_on_401=False,
            )
        raise CloudSyncOpError(
            401,
            "Cloud session expired — unlink and relink your cloud account",
        )
    if resp.status_code == 401:
        raise CloudSyncOpError(
            401,
            "Cloud session expired — unlink and relink your cloud account",
        )
    return resp


async def _local_auth_for_workspace(conn, workspace_id: str) -> AuthContext:
    """Resolve a local user to attribute pulled rows (owner preferred)."""
    row = await conn.fetchrow(
        """
        SELECT user_id FROM workspace_members
        WHERE workspace_id=$1
        ORDER BY CASE WHEN role='owner' THEN 0 WHEN role='admin' THEN 1 ELSE 2 END
        LIMIT 1
        """,
        workspace_id,
    )
    if row is None:
        raise CloudSyncOpError(400, "No local workspace member found for sync")
    user_id = str(row["user_id"])
    user = await conn.fetchrow("SELECT email FROM users WHERE id=$1", user_id)
    email = (user["email"] if user else "") or ""
    return AuthContext(user_id=user_id, workspace_id=str(workspace_id), email=email)


async def push_workspace(workspace_id: str) -> dict:
    """Push local projects/ideas for one workspace. Raises CloudSyncOpError."""
    # Import upsert helpers from the router module (single LWW implementation).
    from app.routers import cloud_sync as cs

    access_token, api_url = require_cloud_env()
    pool = await get_pool()
    async with pool.acquire() as conn:
        link_row = await conn.fetchrow(
            "SELECT * FROM cloud_sync_link WHERE workspace_id=$1",
            workspace_id,
        )
        if link_row is None:
            raise CloudSyncOpError(400, "No cloud account linked for this workspace")

        last_synced = link_row.get("last_synced_at")
        push_started = datetime.now(timezone.utc)
        tables_out: dict[str, Any] = {}

        for table in cs.SYNC_TABLES:
            if last_synced is None:
                rows = await conn.fetch(
                    f"SELECT * FROM {table} WHERE workspace_id=$1",
                    workspace_id,
                )
            else:
                rows = await conn.fetch(
                    f"SELECT * FROM {table} WHERE workspace_id=$1 AND updated_at > $2",
                    workspace_id,
                    last_synced,
                )
            payload_rows = [cs._serialize_local_row(table, dict(r)) for r in rows]
            for pr in payload_rows:
                pr.pop("embedding", None)

            resp = await cloud_http(
                "POST",
                api_url,
                "/api/cloud-sync/push",
                access_token=access_token,
                json_body={"table": table, "rows": payload_rows},
            )
            # Re-read access in case refresh updated it mid-loop
            access_token, _ = require_cloud_env()

            if resp.status_code >= 400:
                detail = resp.text[:400]
                try:
                    body = resp.json()
                    detail = body.get("detail") or detail
                except Exception:
                    pass
                raise CloudSyncOpError(
                    502,
                    f"Cloud push rejected ({resp.status_code}): {detail}",
                )

            tables_out[table] = {
                "sent": len(payload_rows),
                "response": resp.json(),
            }

        hard_errors = []
        for table, info in tables_out.items():
            for r in (info.get("response") or {}).get("results") or []:
                if r.get("outcome") == "error":
                    hard_errors.append(f"{table}:{r.get('id')}:{r.get('detail')}")
        if hard_errors:
            raise CloudSyncOpError(
                502,
                "Cloud push completed with row errors; last_synced_at not advanced: "
                + "; ".join(hard_errors[:5]),
            )

        await conn.execute(
            """
            UPDATE cloud_sync_link
            SET last_synced_at=$2
            WHERE workspace_id=$1
            """,
            workspace_id,
            push_started.isoformat(),
        )

    return {
        "ok": True,
        "pushed_at": push_started.isoformat(),
        "cloud_api_url": api_url,
        "tables": tables_out,
    }


async def pull_workspace(workspace_id: str) -> dict:
    """Pull cloud projects/ideas into one local workspace. Raises CloudSyncOpError."""
    from app.routers import cloud_sync as cs

    access_token, api_url = require_cloud_env()
    pool = await get_pool()
    async with pool.acquire() as conn:
        link_row = await conn.fetchrow(
            "SELECT * FROM cloud_sync_link WHERE workspace_id=$1",
            workspace_id,
        )
        if link_row is None:
            raise CloudSyncOpError(400, "No cloud account linked for this workspace")

        auth = await _local_auth_for_workspace(conn, workspace_id)
        last_pulled = link_row.get("last_pulled_at")
        pull_started = datetime.now(timezone.utc)
        since_param = None
        if last_pulled is not None:
            if hasattr(last_pulled, "isoformat"):
                since_param = last_pulled.isoformat()
            else:
                since_param = str(last_pulled)

        tables_out: dict[str, Any] = {}
        any_content_change = False

        for table in cs.SYNC_TABLES:
            params: dict[str, str] = {"table": table}
            if since_param:
                params["since"] = since_param

            resp = await cloud_http(
                "GET",
                api_url,
                "/api/cloud-sync/export",
                access_token=access_token,
                params=params,
            )
            access_token, _ = require_cloud_env()

            if resp.status_code >= 400:
                detail = resp.text[:400]
                try:
                    body = resp.json()
                    detail = body.get("detail") or detail
                except Exception:
                    pass
                raise CloudSyncOpError(
                    502,
                    f"Cloud export rejected ({resp.status_code}): {detail}",
                )

            export_body = resp.json()
            remote_rows = export_body.get("rows") or []
            results: list[dict] = []
            for raw in remote_rows:
                if not isinstance(raw, dict):
                    results.append({
                        "id": None,
                        "outcome": "error",
                        "detail": "row must be an object",
                    })
                    continue
                try:
                    if table == "projects":
                        results.append(await cs._upsert_project(conn, auth, raw))
                    else:
                        results.append(await cs._upsert_idea(conn, auth, raw))
                except Exception as exc:
                    results.append({
                        "id": str(raw.get("id")) if raw.get("id") is not None else None,
                        "outcome": "error",
                        "detail": str(exc),
                    })

            counts = {
                "inserted": 0,
                "updated": 0,
                "skipped-older": 0,
                "error": 0,
            }
            for r in results:
                outcome = r.get("outcome")
                if outcome in counts:
                    counts[outcome] += 1
            if counts["inserted"] or counts["updated"]:
                any_content_change = True

            tables_out[table] = {
                "fetched": len(remote_rows),
                "results": results,
                "counts": counts,
            }

        hard_errors = []
        for table, info in tables_out.items():
            for r in info.get("results") or []:
                if r.get("outcome") == "error":
                    hard_errors.append(f"{table}:{r.get('id')}:{r.get('detail')}")
        if hard_errors:
            raise CloudSyncOpError(
                502,
                "Cloud pull completed with row errors; last_pulled_at not advanced: "
                + "; ".join(hard_errors[:5]),
            )

        await conn.execute(
            """
            UPDATE cloud_sync_link
            SET last_pulled_at=$2
            WHERE workspace_id=$1
            """,
            workspace_id,
            pull_started.isoformat(),
        )

    if any_content_change:
        from app.db.cache import cache_invalidate
        await cache_invalidate(
            f"projects_list:{workspace_id}",
            f"ws_summary:{workspace_id}",
        )

    return {
        "ok": True,
        "pulled_at": pull_started.isoformat(),
        "cloud_api_url": api_url,
        "since": since_param,
        "tables": tables_out,
    }


async def sync_workspace(workspace_id: str) -> dict:
    """Push then pull for one linked workspace."""
    push_result = await push_workspace(workspace_id)
    pull_result = await pull_workspace(workspace_id)
    return {"ok": True, "push": push_result, "pull": pull_result}


async def run_cloud_sync_cycle() -> list[dict]:
    """One tick: sync every linked workspace. Safe no-op when disabled/unlinked."""
    if not cloud_sync_enabled():
        return []
    access, _refresh, api_url = get_cloud_env()
    if not access or not api_url:
        log.info("cloud_sync_cycle_skipped", reason="missing token or api url")
        return []

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT workspace_id FROM cloud_sync_link")

    results = []
    for row in rows:
        ws = str(row["workspace_id"])
        try:
            out = await sync_workspace(ws)
            results.append({"workspace_id": ws, "ok": True, **out})
            log.info("cloud_sync_workspace_ok", workspace_id=ws)
        except CloudSyncOpError as exc:
            log.warning(
                "cloud_sync_workspace_failed",
                workspace_id=ws,
                status=exc.status_code,
                error=exc.detail[:200],
            )
            results.append({
                "workspace_id": ws,
                "ok": False,
                "status": exc.status_code,
                "error": exc.detail[:200],
            })
        except Exception as exc:
            log.warning(
                "cloud_sync_workspace_failed",
                workspace_id=ws,
                error=str(exc)[:200],
            )
            results.append({
                "workspace_id": ws,
                "ok": False,
                "error": str(exc)[:200],
            })
    if results:
        log.info("cloud_sync_cycle_complete", workspaces=len(results))
    return results


async def cloud_sync_loop(stop_event) -> None:
    """Lifespan background loop — same shape as watch_loop."""
    if not cloud_sync_enabled():
        log.info("cloud_sync_loop_idle", reason="CLOUD_SYNC_ENABLED off")
        # Still wait on stop so cancel is clean; don't burn cycles.
        await stop_event.wait()
        return

    first_delay = min(30, cloud_sync_interval_s())
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=first_delay)
        return
    except asyncio.TimeoutError:
        pass

    while not stop_event.is_set():
        try:
            await run_cloud_sync_cycle()
        except Exception as e:
            log.warning("cloud_sync_loop_tick_failed", error=str(e)[:200])
        interval = cloud_sync_interval_s()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
            return
        except asyncio.TimeoutError:
            continue
