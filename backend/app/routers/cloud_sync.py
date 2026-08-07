"""
Cloud sync API — Phase 7a link + Phase 7b push + Phase 7c pull.

Receiving (`POST /push`): last-write-wins upsert for projects/ideas.
Export (`GET /export`): cloud rows for a linked desktop to pull.
Sending (`POST /push-now` / `POST /pull-now`): desktop-only; reads
CLOUD_SYNC_* env. Push and pull use separate watermarks
(last_synced_at / last_pulled_at).

Pull reuses `_upsert_project` / `_upsert_idea` / `_serialize_local_row`
unchanged — no second LWW implementation.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth

router = APIRouter(prefix="/api/cloud-sync", tags=["cloud-sync"])

SYNC_TABLES = ("projects", "ideas")
PUSH_TABLES = SYNC_TABLES  # alias kept for callers / clarity

# Columns we accept/sync. embedding is intentionally excluded from projects.
PROJECT_COLS = (
    "id", "title", "plan", "status", "metadata", "created_at", "updated_at",
    "visibility", "clearance_level", "notes",
)
IDEA_COLS = (
    "id", "domains", "content", "metadata", "created_at", "updated_at",
    "visibility", "clearance_level",
)


def cloud_sync_enabled() -> bool:
    return os.getenv("CLOUD_SYNC_ENABLED", "0").lower() not in (
        "0", "false", "no", "off", "",
    )


def _require_enabled() -> None:
    if not cloud_sync_enabled():
        raise HTTPException(
            status_code=404,
            detail="Cloud sync is not enabled on this server (CLOUD_SYNC_ENABLED=0)",
        )


class LinkRequest(BaseModel):
    cloud_workspace_id: str = Field(..., min_length=1)
    cloud_user_id: str = Field(..., min_length=1)
    cloud_email: Optional[str] = None


class PushRequest(BaseModel):
    table: Literal["projects", "ideas"]
    rows: list[dict[str, Any]] = Field(default_factory=list)


def _empty_status(*, enabled: bool) -> dict:
    return {
        "enabled": enabled,
        "linked": False,
        "cloud_workspace_id": None,
        "cloud_user_id": None,
        "cloud_email": None,
        "linked_at": None,
        "last_synced_at": None,
        "last_pulled_at": None,
    }


def _row_to_status(row) -> dict:
    if row is None:
        return _empty_status(enabled=True)

    def _ts(v):
        if v is None:
            return None
        if hasattr(v, "isoformat"):
            return v.isoformat()
        return str(v)

    return {
        "enabled": True,
        "linked": True,
        "cloud_workspace_id": str(row["cloud_workspace_id"]),
        "cloud_user_id": str(row["cloud_user_id"]),
        "cloud_email": row["cloud_email"],
        "linked_at": _ts(row["linked_at"]),
        "last_synced_at": _ts(row["last_synced_at"]),
        "last_pulled_at": _ts(row.get("last_pulled_at")),
    }


def _parse_ts(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip()
        if not s:
            return None
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            # SQLite datetime('now') has no timezone / fractional seconds quirks
            for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
                try:
                    dt = datetime.strptime(s[:26], fmt)
                    break
                except ValueError:
                    continue
            else:
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _incoming_newer(incoming: Any, existing: Any) -> bool:
    a = _parse_ts(incoming)
    b = _parse_ts(existing)
    if a is None:
        return False
    if b is None:
        return True
    return a > b


def _normalize_metadata(value: Any) -> Any:
    if value is None:
        return {}
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value) if value else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _ts_for_db(value: Any) -> Any:
    """Return a datetime for Postgres TIMESTAMPTZ binds; strings ok for SQLite."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    parsed = _parse_ts(value)
    if os.getenv("DATABASE_BACKEND", "postgres").lower() == "sqlite":
        # Keep string form for SQLite TEXT columns.
        return str(value)
    return parsed


def _metadata_for_db(value: Any) -> Any:
    """Always bind metadata as a JSON string.

    SQLite stores TEXT; Postgres accepts the string with an explicit ``::jsonb``
    cast in the SQL (asyncpg without a JSON codec rejects raw dicts here).
    """
    return json.dumps(_normalize_metadata(value))


def _row_get(row: dict, *keys: str, default=None):
    for k in keys:
        if k in row and row[k] is not None:
            return row[k]
    return default


async def _upsert_project(conn, auth: AuthContext, row: dict) -> dict:
    row_id = _row_get(row, "id")
    if not row_id:
        return {"id": None, "outcome": "error", "detail": "missing id"}

    existing = await conn.fetchrow("SELECT * FROM projects WHERE id=$1", row_id)
    title = _row_get(row, "title", default="")
    if not title and existing is None:
        return {"id": str(row_id), "outcome": "error", "detail": "missing title"}

    payload = {
        "title": title if title != "" else (existing["title"] if existing else ""),
        "plan": _row_get(row, "plan", default=existing["plan"] if existing else None),
        "status": _row_get(row, "status", default=existing["status"] if existing else "active"),
        "metadata": _normalize_metadata(
            _row_get(row, "metadata", default=existing["metadata"] if existing else {})
        ),
        "created_at": _row_get(row, "created_at", default=existing["created_at"] if existing else None),
        "updated_at": _row_get(row, "updated_at"),
        "visibility": _row_get(
            row, "visibility",
            default=existing["visibility"] if existing else "private",
        ),
        "clearance_level": int(
            _row_get(
                row, "clearance_level",
                default=existing["clearance_level"] if existing else 0,
            )
            or 0
        ),
        "notes": _row_get(row, "notes", default=existing["notes"] if existing else ""),
    }

    if existing is not None:
        if str(existing["workspace_id"]) != str(auth.workspace_id):
            return {
                "id": str(row_id),
                "outcome": "error",
                "detail": "id belongs to another workspace",
            }
        if not _incoming_newer(payload["updated_at"], existing.get("updated_at")):
            return {"id": str(row_id), "outcome": "skipped-older"}
        # Do not touch embedding. Force cloud workspace/user.
        await conn.execute(
            """
            UPDATE projects SET
                workspace_id=$2, user_id=$3,
                title=$4, plan=$5, status=$6, metadata=$7::jsonb,
                created_at=COALESCE($8, created_at),
                updated_at=$9,
                visibility=$10, clearance_level=$11, notes=$12
            WHERE id=$1
            """,
            row_id,
            auth.workspace_id,
            auth.user_id,
            payload["title"],
            payload["plan"],
            payload["status"],
            _metadata_for_db(payload["metadata"]),
            _ts_for_db(payload["created_at"]),
            _ts_for_db(payload["updated_at"]),
            payload["visibility"],
            payload["clearance_level"],
            payload["notes"] or "",
        )
        return {"id": str(row_id), "outcome": "updated"}

    await conn.execute(
        """
        INSERT INTO projects (
            id, workspace_id, user_id, title, plan, status, metadata,
            created_at, updated_at, visibility, clearance_level, notes
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb,
            COALESCE($8, NOW()), COALESCE($9, NOW()), $10, $11, $12
        )
        """,
        row_id,
        auth.workspace_id,
        auth.user_id,
        payload["title"],
        payload["plan"],
        payload["status"],
        _metadata_for_db(payload["metadata"]),
        _ts_for_db(payload["created_at"]),
        _ts_for_db(payload["updated_at"]),
        payload["visibility"],
        payload["clearance_level"],
        payload["notes"] or "",
    )
    return {"id": str(row_id), "outcome": "inserted"}


async def _upsert_idea(conn, auth: AuthContext, row: dict) -> dict:
    row_id = _row_get(row, "id")
    if not row_id:
        return {"id": None, "outcome": "error", "detail": "missing id"}

    existing = await conn.fetchrow("SELECT * FROM ideas WHERE id=$1", row_id)
    domains = _row_get(row, "domains", default="")
    content = _row_get(row, "content", default="")
    if existing is None and (domains == "" or content == ""):
        return {"id": str(row_id), "outcome": "error", "detail": "missing domains or content"}

    payload = {
        "domains": domains if domains != "" else (existing["domains"] if existing else ""),
        "content": content if content != "" else (existing["content"] if existing else ""),
        "metadata": _normalize_metadata(
            _row_get(row, "metadata", default=existing["metadata"] if existing else {})
        ),
        "created_at": _row_get(row, "created_at", default=existing["created_at"] if existing else None),
        "updated_at": _row_get(row, "updated_at"),
        "visibility": _row_get(
            row, "visibility",
            default=existing["visibility"] if existing else "private",
        ),
        "clearance_level": int(
            _row_get(
                row, "clearance_level",
                default=existing["clearance_level"] if existing else 0,
            )
            or 0
        ),
    }

    if existing is not None:
        if str(existing["workspace_id"]) != str(auth.workspace_id):
            return {
                "id": str(row_id),
                "outcome": "error",
                "detail": "id belongs to another workspace",
            }
        if not _incoming_newer(payload["updated_at"], existing.get("updated_at")):
            return {"id": str(row_id), "outcome": "skipped-older"}
        await conn.execute(
            """
            UPDATE ideas SET
                workspace_id=$2, user_id=$3,
                domains=$4, content=$5, metadata=$6::jsonb,
                created_at=COALESCE($7, created_at),
                updated_at=$8,
                visibility=$9, clearance_level=$10
            WHERE id=$1
            """,
            row_id,
            auth.workspace_id,
            auth.user_id,
            payload["domains"],
            payload["content"],
            _metadata_for_db(payload["metadata"]),
            _ts_for_db(payload["created_at"]),
            _ts_for_db(payload["updated_at"]),
            payload["visibility"],
            payload["clearance_level"],
        )
        return {"id": str(row_id), "outcome": "updated"}

    await conn.execute(
        """
        INSERT INTO ideas (
            id, workspace_id, user_id, domains, content, metadata,
            created_at, updated_at, visibility, clearance_level
        ) VALUES (
            $1, $2, $3, $4, $5, $6::jsonb,
            COALESCE($7, NOW()), COALESCE($8, NOW()), $9, $10
        )
        """,
        row_id,
        auth.workspace_id,
        auth.user_id,
        payload["domains"],
        payload["content"],
        _metadata_for_db(payload["metadata"]),
        _ts_for_db(payload["created_at"]),
        _ts_for_db(payload["updated_at"]),
        payload["visibility"],
        payload["clearance_level"],
    )
    return {"id": str(row_id), "outcome": "inserted"}


def _serialize_local_row(table: str, row: dict) -> dict:
    """Prepare a local row for the cloud push payload (no embedding)."""
    cols = PROJECT_COLS if table == "projects" else IDEA_COLS
    out: dict[str, Any] = {}
    for c in cols:
        if c not in row:
            continue
        v = row[c]
        if hasattr(v, "isoformat"):
            out[c] = v.isoformat()
        elif c == "metadata":
            out[c] = _normalize_metadata(v)
        else:
            out[c] = v if not hasattr(v, "hex") else str(v)  # UUID
            if c == "id" or c.endswith("_id"):
                out[c] = str(v)
    # Always stringify id
    if "id" in row:
        out["id"] = str(row["id"])
    return out


@router.get("/status")
async def status(auth: AuthContext = Depends(require_auth)):
    if not cloud_sync_enabled():
        return _empty_status(enabled=False)
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM cloud_sync_link WHERE workspace_id=$1",
            auth.workspace_id,
        )
    return _row_to_status(row)


@router.post("/link")
async def link(req: LinkRequest, auth: AuthContext = Depends(require_auth)):
    _require_enabled()
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO cloud_sync_link (
                workspace_id, cloud_workspace_id, cloud_user_id, cloud_email, linked_at
            ) VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (workspace_id) DO UPDATE SET
                cloud_workspace_id = EXCLUDED.cloud_workspace_id,
                cloud_user_id = EXCLUDED.cloud_user_id,
                cloud_email = EXCLUDED.cloud_email,
                linked_at = NOW(),
                last_synced_at = NULL,
                last_pulled_at = NULL
            RETURNING *
            """,
            auth.workspace_id,
            req.cloud_workspace_id,
            req.cloud_user_id,
            req.cloud_email,
        )
    return _row_to_status(row)


@router.post("/unlink")
async def unlink(auth: AuthContext = Depends(require_auth)):
    _require_enabled()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM cloud_sync_link WHERE workspace_id=$1",
            auth.workspace_id,
        )
    return _empty_status(enabled=True)


@router.get("/export")
async def export_rows(
    auth: AuthContext = Depends(require_auth),
    table: Literal["projects", "ideas"] = Query(...),
    since: Optional[str] = Query(None),
):
    """
    Cloud-side export for desktop pull. Scoped to auth.workspace_id.
    Not gated by CLOUD_SYNC_ENABLED (same reasoning as POST /push).
    """
    if table not in SYNC_TABLES:
        raise HTTPException(status_code=400, detail=f"Unsupported table: {table}")

    since_ts = _parse_ts(since) if since else None
    # For SQLite cloud (unlikely) keep the raw string; Postgres wants datetime.
    since_bind: Any = since_ts
    if since and os.getenv("DATABASE_BACKEND", "postgres").lower() == "sqlite":
        since_bind = since

    pool = await get_pool()
    async with pool.acquire() as conn:
        if since_bind is None:
            rows = await conn.fetch(
                f"SELECT * FROM {table} WHERE workspace_id=$1",
                auth.workspace_id,
            )
        else:
            rows = await conn.fetch(
                f"SELECT * FROM {table} WHERE workspace_id=$1 AND updated_at > $2",
                auth.workspace_id,
                since_bind,
            )

    payload = []
    for r in rows:
        pr = _serialize_local_row(table, dict(r))
        pr.pop("embedding", None)
        payload.append(pr)

    return {
        "table": table,
        "workspace_id": auth.workspace_id,
        "since": since,
        "count": len(payload),
        "rows": payload,
    }


@router.post("/push")
async def push(req: PushRequest, auth: AuthContext = Depends(require_auth)):
    """
    Receiving-side upsert (cloud or any instance).

    Auth determines the landing workspace — row.workspace_id is ignored.
    Not gated by CLOUD_SYNC_ENABLED so found3ry.com can accept desktop pushes
    without enabling outbound desktop sync on the server itself.
    """
    if req.table not in SYNC_TABLES:
        raise HTTPException(status_code=400, detail=f"Unsupported table: {req.table}")

    results: list[dict] = []
    pool = await get_pool()
    async with pool.acquire() as conn:
        for raw in req.rows:
            if not isinstance(raw, dict):
                results.append({"id": None, "outcome": "error", "detail": "row must be an object"})
                continue
            try:
                if req.table == "projects":
                    results.append(await _upsert_project(conn, auth, raw))
                else:
                    results.append(await _upsert_idea(conn, auth, raw))
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

    # Pushed rows bypass the normal POST/PATCH endpoints (and their
    # cache_invalidate calls) via raw SQL upsert — invalidate here too,
    # or a cached projects_list/ws_summary view stays stale until its
    # TTL expires even though the underlying row is already correct.
    if counts["inserted"] or counts["updated"]:
        from app.db.cache import cache_invalidate
        keys = [f"ws_summary:{auth.workspace_id}"]
        if req.table == "projects":
            keys.append(f"projects_list:{auth.workspace_id}")
        await cache_invalidate(*keys)

    return {
        "table": req.table,
        "workspace_id": auth.workspace_id,
        "results": results,
        "counts": counts,
    }


def _cloud_env_or_400() -> tuple[str, str]:
    access_token = (os.getenv("CLOUD_SYNC_ACCESS_TOKEN") or "").strip()
    api_url = (os.getenv("CLOUD_SYNC_API_URL") or "").rstrip("/")
    if not access_token:
        raise HTTPException(
            status_code=400,
            detail=(
                "CLOUD_SYNC_ACCESS_TOKEN is empty — link a cloud account and restart "
                "the desktop app so the token is loaded into the backend env"
            ),
        )
    if not api_url:
        raise HTTPException(
            status_code=400,
            detail="CLOUD_SYNC_API_URL is not configured",
        )
    return access_token, api_url


@router.post("/push-now")
async def push_now(auth: AuthContext = Depends(require_auth)):
    """
    Desktop sending side: push local projects/ideas to CLOUD_SYNC_API_URL.
    Requires CLOUD_SYNC_ENABLED and CLOUD_SYNC_ACCESS_TOKEN in the sidecar env.
    """
    _require_enabled()
    access_token, api_url = _cloud_env_or_400()

    pool = await get_pool()
    async with pool.acquire() as conn:
        link_row = await conn.fetchrow(
            "SELECT * FROM cloud_sync_link WHERE workspace_id=$1",
            auth.workspace_id,
        )
        if link_row is None:
            raise HTTPException(
                status_code=400,
                detail="No cloud account linked for this workspace",
            )

        last_synced = link_row.get("last_synced_at")
        push_started = datetime.now(timezone.utc)

        tables_out: dict[str, Any] = {}
        for table in SYNC_TABLES:
            if last_synced is None:
                rows = await conn.fetch(
                    f"SELECT * FROM {table} WHERE workspace_id=$1",
                    auth.workspace_id,
                )
            else:
                rows = await conn.fetch(
                    f"SELECT * FROM {table} WHERE workspace_id=$1 AND updated_at > $2",
                    auth.workspace_id,
                    last_synced,
                )
            payload_rows = [_serialize_local_row(table, dict(r)) for r in rows]
            for pr in payload_rows:
                pr.pop("embedding", None)

            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(
                        f"{api_url}/api/cloud-sync/push",
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "Content-Type": "application/json",
                            "Accept": "application/json",
                        },
                        json={"table": table, "rows": payload_rows},
                    )
            except httpx.HTTPError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to reach cloud API ({api_url}): {exc}",
                ) from exc

            if resp.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="Cloud session expired — unlink and relink your cloud account",
                )
            if resp.status_code >= 400:
                detail = resp.text[:400]
                try:
                    body = resp.json()
                    detail = body.get("detail") or detail
                except Exception:
                    pass
                raise HTTPException(
                    status_code=502,
                    detail=f"Cloud push rejected ({resp.status_code}): {detail}",
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
            raise HTTPException(
                status_code=502,
                detail="Cloud push completed with row errors; last_synced_at not advanced: "
                + "; ".join(hard_errors[:5]),
            )

        await conn.execute(
            """
            UPDATE cloud_sync_link
            SET last_synced_at=$2
            WHERE workspace_id=$1
            """,
            auth.workspace_id,
            push_started.isoformat(),
        )

    return {
        "ok": True,
        "pushed_at": push_started.isoformat(),
        "cloud_api_url": api_url,
        "tables": tables_out,
    }


@router.post("/pull-now")
async def pull_now(auth: AuthContext = Depends(require_auth)):
    """
    Desktop pull side: fetch cloud projects/ideas via GET /export and apply
    locally with the same LWW upserts used by POST /push.
    """
    _require_enabled()
    access_token, api_url = _cloud_env_or_400()

    pool = await get_pool()
    async with pool.acquire() as conn:
        link_row = await conn.fetchrow(
            "SELECT * FROM cloud_sync_link WHERE workspace_id=$1",
            auth.workspace_id,
        )
        if link_row is None:
            raise HTTPException(
                status_code=400,
                detail="No cloud account linked for this workspace",
            )

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

        for table in SYNC_TABLES:
            params: dict[str, str] = {"table": table}
            if since_param:
                params["since"] = since_param

            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.get(
                        f"{api_url}/api/cloud-sync/export",
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "Accept": "application/json",
                        },
                        params=params,
                    )
            except httpx.HTTPError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to reach cloud API ({api_url}): {exc}",
                ) from exc

            if resp.status_code == 401:
                raise HTTPException(
                    status_code=401,
                    detail="Cloud session expired — unlink and relink your cloud account",
                )
            if resp.status_code >= 400:
                detail = resp.text[:400]
                try:
                    body = resp.json()
                    detail = body.get("detail") or detail
                except Exception:
                    pass
                raise HTTPException(
                    status_code=502,
                    detail=f"Cloud export rejected ({resp.status_code}): {detail}",
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
                        results.append(await _upsert_project(conn, auth, raw))
                    else:
                        results.append(await _upsert_idea(conn, auth, raw))
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
            raise HTTPException(
                status_code=502,
                detail="Cloud pull completed with row errors; last_pulled_at not advanced: "
                + "; ".join(hard_errors[:5]),
            )

        await conn.execute(
            """
            UPDATE cloud_sync_link
            SET last_pulled_at=$2
            WHERE workspace_id=$1
            """,
            auth.workspace_id,
            pull_started.isoformat(),
        )

    if any_content_change:
        from app.db.cache import cache_invalidate
        await cache_invalidate(
            f"projects_list:{auth.workspace_id}",
            f"ws_summary:{auth.workspace_id}",
        )

    return {
        "ok": True,
        "pulled_at": pull_started.isoformat(),
        "cloud_api_url": api_url,
        "since": since_param,
        "tables": tables_out,
    }
