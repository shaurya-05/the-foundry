"""Identity & Access — Stage 1.

Permission resolution and audit recording. Roles and permissions live in the
database (see migration 019), not in a code constant, so adding a role is an
INSERT rather than a deploy.

Resolution path: user → team_members → roles → role_permissions, scoped to the
workspace (the org). A user with no team membership in a workspace has no
permissions there, which is the correct default for a system that is about to
have more than one person in it.

Nothing here caches. A per-process permission cache would be the first
single-worker assumption this stage introduced, and the Foundation brief asks
for those to be documented rather than accumulated silently — so it isn't here.
"""
from __future__ import annotations

import json
from typing import Any, Optional

import structlog

from app.db.postgres import get_pool

log = structlog.get_logger()


async def user_permissions(user_id: str, workspace_id: str) -> set[str]:
    """Every permission key this user holds in this workspace, via any team."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT rp.permission_key
            FROM team_members tm
            JOIN teams t ON t.id = tm.team_id
            JOIN role_permissions rp ON rp.role_id = tm.role_id
            WHERE tm.user_id = $1 AND t.workspace_id = $2
            """,
            user_id, workspace_id,
        )
    return {r["permission_key"] for r in rows}


async def has_permission(user_id: str, workspace_id: str, permission: str) -> bool:
    """Single-permission check. Kept as its own query so the hot path does not
    fetch and materialise the user's whole permission set to answer one question."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT 1
            FROM team_members tm
            JOIN teams t ON t.id = tm.team_id
            JOIN role_permissions rp ON rp.role_id = tm.role_id
            WHERE tm.user_id = $1 AND t.workspace_id = $2 AND rp.permission_key = $3
            LIMIT 1
            """,
            user_id, workspace_id, permission,
        )
    return row is not None


async def record_audit(
    *,
    action: str,
    actor_id: Optional[str] = None,
    actor_email: Optional[str] = None,
    workspace_id: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    before_state: Optional[dict[str, Any]] = None,
    after_state: Optional[dict[str, Any]] = None,
    outcome: str = "allowed",
    trace_id: Optional[str] = None,
) -> None:
    """Append one row to the audit log.

    Denials are recorded as well as grants. An audit log that only contains
    successful privileged actions cannot answer the question you actually reach
    for it to answer, which is who tried.

    Audit failure never fails the caller's request — a privileged action that
    succeeded must not be reported as failed because logging it didn't work. The
    failure is logged loudly instead.
    """
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO audit_log
                    (workspace_id, actor_id, actor_email, action, target_type,
                     target_id, before_state, after_state, outcome, trace_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                workspace_id, actor_id, actor_email, action, target_type, target_id,
                json.dumps(before_state) if before_state is not None else None,
                json.dumps(after_state) if after_state is not None else None,
                outcome, trace_id,
            )
    except Exception as e:  # noqa: BLE001 — deliberate: see docstring
        log.error(
            "audit_write_failed",
            action=action,
            actor_id=actor_id,
            workspace_id=workspace_id,
            outcome=outcome,
            error=str(e),
        )
