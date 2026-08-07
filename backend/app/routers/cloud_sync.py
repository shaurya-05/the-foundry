"""
Cloud sync link API — Phase 7a foundation only.

Stores the pairing between the local desktop workspace and a cloud
found3ry.com (or CLOUD_SYNC_API_URL) workspace. Tokens stay in Electron
safeStorage — this router never sees them.

Gated by CLOUD_SYNC_ENABLED (default off). No row content sync here.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth

router = APIRouter(prefix="/api/cloud-sync", tags=["cloud-sync"])


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


def _row_to_status(row) -> dict:
    if row is None:
        return {
            "enabled": True,
            "linked": False,
            "cloud_workspace_id": None,
            "cloud_user_id": None,
            "cloud_email": None,
            "linked_at": None,
            "last_synced_at": None,
        }

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
    }


@router.get("/status")
async def status(auth: AuthContext = Depends(require_auth)):
    if not cloud_sync_enabled():
        return {
            "enabled": False,
            "linked": False,
            "cloud_workspace_id": None,
            "cloud_user_id": None,
            "cloud_email": None,
            "linked_at": None,
            "last_synced_at": None,
        }
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
                last_synced_at = NULL
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
    return {
        "enabled": True,
        "linked": False,
        "cloud_workspace_id": None,
        "cloud_user_id": None,
        "cloud_email": None,
        "linked_at": None,
        "last_synced_at": None,
    }
