"""Identity & Access management API — Stage 1 remainder.

Teams, roles, role assignments, and the owner-gated audit read. Every mutation
here records before/after state to the audit log; every check names the specific
capability it needs rather than a role rank, so a second endpoint reaching the
same capability has to declare it too.

`access.manage` gates everything that changes who can do what. `audit.read`
gates the log. Neither is held by `engineer` or `observer`, which is the whole
point of the brief's role table.
"""
from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.db.postgres import get_pool
from app.dependencies import AuthContext, RequirePermission, require_auth
from app.services.access import record_audit, user_permissions

log = structlog.get_logger()
router = APIRouter(prefix="/api/access", tags=["access"])


# ─── Models ──────────────────────────────────────────────────────────────────
class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None


class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: Optional[str] = None
    permissions: list[str] = Field(default_factory=list)


class RolePermissionsUpdate(BaseModel):
    permissions: list[str]


class MemberRoleUpdate(BaseModel):
    team_id: str
    role_id: str


# ─── Self ────────────────────────────────────────────────────────────────────
@router.get("/me")
async def my_access(auth: AuthContext = Depends(require_auth)):
    """What the calling session can actually do.

    Deliberately requires no permission: every authenticated user may ask what
    they hold. A UI that has to guess which controls to render is a UI that
    renders controls the backend will refuse, which trains people to ignore
    errors.
    """
    perms = await user_permissions(auth.user_id, auth.workspace_id)
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT t.id AS team_id, t.name AS team_name, r.name AS role_name
            FROM team_members tm
            JOIN teams t ON t.id = tm.team_id
            JOIN roles r ON r.id = tm.role_id
            WHERE tm.user_id = $1 AND t.workspace_id = $2
            """,
            auth.user_id, auth.workspace_id,
        )
    return {
        "user_id": auth.user_id,
        "workspace_id": auth.workspace_id,
        "email": auth.email,
        "permissions": sorted(perms),
        "teams": [dict(r) for r in rows],
    }


# ─── Teams ───────────────────────────────────────────────────────────────────
@router.get("/teams")
async def list_teams(auth: AuthContext = Depends(RequirePermission("admin.read"))):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT t.id, t.name, t.description, t.is_default, t.created_at,
                   COUNT(tm.id) AS member_count
            FROM teams t
            LEFT JOIN team_members tm ON tm.team_id = t.id
            WHERE t.workspace_id = $1
            GROUP BY t.id
            ORDER BY t.is_default DESC, t.name
            """,
            auth.workspace_id,
        )
    return {"teams": [dict(r) for r in rows]}


@router.post("/teams", status_code=201)
async def create_team(
    req: TeamCreate, auth: AuthContext = Depends(RequirePermission("access.manage"))
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT id FROM teams WHERE workspace_id = $1 AND name = $2",
            auth.workspace_id, req.name,
        )
        if existing:
            raise HTTPException(status_code=409, detail=f"Team '{req.name}' already exists")
        row = await conn.fetchrow(
            """
            INSERT INTO teams (workspace_id, name, description)
            VALUES ($1, $2, $3) RETURNING id, name, description, is_default, created_at
            """,
            auth.workspace_id, req.name, req.description,
        )
    await record_audit(
        action="access.team.create", actor_id=auth.user_id, actor_email=auth.email,
        workspace_id=auth.workspace_id, target_type="team", target_id=str(row["id"]),
        before_state=None, after_state={"name": req.name, "description": req.description},
    )
    return dict(row)


# ─── Roles ───────────────────────────────────────────────────────────────────
@router.get("/roles")
async def list_roles(auth: AuthContext = Depends(RequirePermission("admin.read"))):
    """Built-in roles plus any this org has defined, each with its grants.

    Two queries and a join in Python rather than one with ARRAY_AGG ... FILTER.
    That construct is Postgres-only, and since the desktop build runs the same
    code against SQLite, an endpoint that works on one backend and 500s on the
    other is exactly the split Stage 1 just spent effort closing.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        roles = await conn.fetch(
            """
            SELECT r.id, r.name, r.description, r.is_builtin
            FROM roles r
            WHERE r.workspace_id IS NULL OR r.workspace_id = $1
            ORDER BY r.is_builtin DESC, r.name
            """,
            auth.workspace_id,
        )
        grants = await conn.fetch(
            """
            SELECT rp.role_id, rp.permission_key
            FROM role_permissions rp
            JOIN roles r ON r.id = rp.role_id
            WHERE r.workspace_id IS NULL OR r.workspace_id = $1
            ORDER BY rp.permission_key
            """,
            auth.workspace_id,
        )

    by_role: dict[str, list[str]] = {}
    for g in grants:
        by_role.setdefault(str(g["role_id"]), []).append(g["permission_key"])

    return {
        "roles": [
            {**dict(r), "permissions": by_role.get(str(r["id"]), [])}
            for r in roles
        ]
    }


@router.get("/permissions")
async def list_permissions(_: AuthContext = Depends(RequirePermission("admin.read"))):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT key, description FROM permissions ORDER BY key")
    return {"permissions": [dict(r) for r in rows]}


@router.post("/roles", status_code=201)
async def create_role(
    req: RoleCreate, auth: AuthContext = Depends(RequirePermission("access.manage"))
):
    """Create an org-scoped role. This is the `ml_engineer` / `robotics_engineer`
    path — INSERTs, no migration, no deploy."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        known = {r["key"] for r in await conn.fetch("SELECT key FROM permissions")}
        unknown = sorted(set(req.permissions) - known)
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown permissions: {unknown}")

        clash = await conn.fetchrow(
            """
            SELECT id FROM roles
            WHERE name = $2 AND (workspace_id IS NULL OR workspace_id = $1)
            """,
            auth.workspace_id, req.name,
        )
        if clash:
            raise HTTPException(status_code=409, detail=f"Role '{req.name}' already exists")

        row = await conn.fetchrow(
            """
            INSERT INTO roles (workspace_id, name, description, is_builtin)
            VALUES ($1, $2, $3, FALSE) RETURNING id, name, description
            """,
            auth.workspace_id, req.name, req.description,
        )
        for key in req.permissions:
            await conn.execute(
                "INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2) "
                "ON CONFLICT DO NOTHING",
                row["id"], key,
            )
    await record_audit(
        action="access.role.create", actor_id=auth.user_id, actor_email=auth.email,
        workspace_id=auth.workspace_id, target_type="role", target_id=str(row["id"]),
        before_state=None,
        after_state={"name": req.name, "permissions": sorted(req.permissions)},
    )
    return {**dict(row), "permissions": sorted(req.permissions)}


@router.put("/roles/{role_id}/permissions")
async def set_role_permissions(
    role_id: str,
    req: RolePermissionsUpdate,
    auth: AuthContext = Depends(RequirePermission("access.manage")),
):
    pool = await get_pool()
    async with pool.acquire() as conn:
        role = await conn.fetchrow(
            "SELECT id, name, is_builtin, workspace_id FROM roles WHERE id = $1", role_id
        )
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        if role["is_builtin"]:
            # Built-ins are shared across every org. Letting one org edit them
            # would silently change another's access model.
            raise HTTPException(
                status_code=409,
                detail="Built-in role permissions cannot be modified; create an org role instead",
            )
        if str(role["workspace_id"]) != str(auth.workspace_id):
            raise HTTPException(status_code=404, detail="Role not found")

        known = {r["key"] for r in await conn.fetch("SELECT key FROM permissions")}
        unknown = sorted(set(req.permissions) - known)
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown permissions: {unknown}")

        before = sorted(
            r["permission_key"]
            for r in await conn.fetch(
                "SELECT permission_key FROM role_permissions WHERE role_id = $1", role_id
            )
        )
        await conn.execute("DELETE FROM role_permissions WHERE role_id = $1", role_id)
        for key in req.permissions:
            await conn.execute(
                "INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)",
                role_id, key,
            )
    await record_audit(
        action="access.role.permissions.update", actor_id=auth.user_id,
        actor_email=auth.email, workspace_id=auth.workspace_id,
        target_type="role", target_id=role_id,
        before_state={"permissions": before},
        after_state={"permissions": sorted(req.permissions)},
    )
    return {"role_id": role_id, "permissions": sorted(req.permissions)}


# ─── Members ─────────────────────────────────────────────────────────────────
@router.get("/members")
async def list_members(auth: AuthContext = Depends(RequirePermission("admin.read"))):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT u.id AS user_id, u.email, t.id AS team_id, t.name AS team_name,
                   r.id AS role_id, r.name AS role_name
            FROM team_members tm
            JOIN users u ON u.id = tm.user_id
            JOIN teams t ON t.id = tm.team_id
            JOIN roles r ON r.id = tm.role_id
            WHERE t.workspace_id = $1
            ORDER BY u.email
            """,
            auth.workspace_id,
        )
    return {"members": [dict(r) for r in rows]}


@router.put("/members/{user_id}/role")
async def set_member_role(
    user_id: str,
    req: MemberRoleUpdate,
    auth: AuthContext = Depends(RequirePermission("access.manage")),
):
    """Assign a role to a user on a team. This is the mutation `engineer` must
    be refused — it is the one that changes who can do what."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        team = await conn.fetchrow(
            "SELECT id FROM teams WHERE id = $1 AND workspace_id = $2",
            req.team_id, auth.workspace_id,
        )
        if not team:
            raise HTTPException(status_code=404, detail="Team not found in this workspace")

        role = await conn.fetchrow(
            """
            SELECT id, name FROM roles
            WHERE id = $1 AND (workspace_id IS NULL OR workspace_id = $2)
            """,
            req.role_id, auth.workspace_id,
        )
        if not role:
            raise HTTPException(status_code=404, detail="Role not available in this workspace")

        prev = await conn.fetchrow(
            """
            SELECT r.name AS role_name FROM team_members tm
            JOIN roles r ON r.id = tm.role_id
            WHERE tm.team_id = $1 AND tm.user_id = $2
            """,
            req.team_id, user_id,
        )
        await conn.execute(
            """
            INSERT INTO team_members (team_id, user_id, role_id) VALUES ($1, $2, $3)
            ON CONFLICT (team_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id
            """,
            req.team_id, user_id, req.role_id,
        )
    await record_audit(
        action="access.member.role.update", actor_id=auth.user_id, actor_email=auth.email,
        workspace_id=auth.workspace_id, target_type="user", target_id=user_id,
        before_state={"role": prev["role_name"]} if prev else None,
        after_state={"role": role["name"], "team_id": req.team_id},
    )
    return {"user_id": user_id, "team_id": req.team_id, "role": role["name"]}


# ─── Audit log, owner-gated ──────────────────────────────────────────────────
audit_router = APIRouter(prefix="/api/audit", tags=["audit"])


@audit_router.get("")
async def read_audit_log(
    auth: AuthContext = Depends(RequirePermission("audit.read")),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    action: Optional[str] = None,
    outcome: Optional[str] = None,
):
    """Read the audit log. `audit.read` is owner-only by the brief's role table.

    There is no write, update or delete endpoint here, and there will not be:
    the table rejects both at the database level.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, workspace_id, actor_id, actor_email, action, target_type,
                   target_id, before_state, after_state, outcome, trace_id, created_at
            FROM audit_log
            WHERE workspace_id = $1
              AND ($2::text IS NULL OR action LIKE $2 || '%')
              AND ($3::text IS NULL OR outcome = $3)
            ORDER BY created_at DESC, id DESC
            LIMIT $4 OFFSET $5
            """,
            auth.workspace_id, action, outcome, limit, offset,
        )
        total = await conn.fetchval(
            "SELECT COUNT(*) FROM audit_log WHERE workspace_id = $1", auth.workspace_id
        )
    return {"total": total, "limit": limit, "offset": offset,
            "entries": [dict(r) for r in rows]}
