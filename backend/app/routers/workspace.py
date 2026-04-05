import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth, RequireRole, ROLE_HIERARCHY
from app.services.email import send_workspace_invite_email

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


class InviteRequest(BaseModel):
    email: str
    role: str = "member"


class JoinRequest(BaseModel):
    token: str


class VisibilityUpdate(BaseModel):
    visibility: str  # private | team | public
    clearance_level: Optional[int] = None


class RoleUpdate(BaseModel):
    role: str


# ─── Members ─────────────────────────────────────────────────────────────────

@router.get("/members")
async def list_members(workspace_id: Optional[str] = None, auth: AuthContext = Depends(require_auth)):
    ws_id = workspace_id or auth.workspace_id
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT wm.id, wm.user_id, wm.role, wm.joined_at,
                      u.email, u.display_name, u.avatar_color
               FROM workspace_members wm
               JOIN users u ON wm.user_id = u.id
               WHERE wm.workspace_id=$1
               ORDER BY wm.joined_at""",
            ws_id,
        )
        return {
            "members": [
                {
                    "id": str(r["id"]),
                    "user_id": str(r["user_id"]),
                    "email": r["email"],
                    "display_name": r["display_name"] or r["email"].split("@")[0],
                    "avatar_color": r["avatar_color"] or "#E8231F",
                    "role": r["role"],
                    "joined_at": r["joined_at"].isoformat(),
                }
                for r in rows
            ]
        }


@router.post("/invite")
async def invite_member(req: InviteRequest, workspace_id: Optional[str] = None, auth: AuthContext = Depends(RequireRole("admin"))):
    if req.role not in ROLE_HIERARCHY:
        raise HTTPException(status_code=400, detail="Invalid role")
    ws_id = workspace_id or auth.workspace_id
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Get workspace name for email
        ws = await conn.fetchrow("SELECT name FROM workspaces WHERE id=$1", ws_id)
        ws_name = ws["name"] if ws else "Workspace"

        row = await conn.fetchrow(
            """INSERT INTO workspace_invitations (workspace_id, invited_by, email, role)
               VALUES ($1, $2, $3, $4)
               RETURNING id, token, expires_at""",
            ws_id, auth.user_id, req.email, req.role,
        )

        # Send invitation email
        await send_workspace_invite_email(req.email, row["token"], ws_name, auth.email)

        return {
            "id": str(row["id"]),
            "token": row["token"],
            "invite_url": f"/join?token={row['token']}",
            "expires_at": row["expires_at"].isoformat(),
        }


@router.post("/join")
async def join_workspace(req: JoinRequest, auth: Optional[AuthContext] = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        invite = await conn.fetchrow(
            """SELECT * FROM workspace_invitations
               WHERE token=$1 AND accepted=false AND expires_at > NOW()""",
            req.token,
        )
        if not invite:
            raise HTTPException(status_code=404, detail="Invalid or expired invitation")

        # Use authenticated user
        user_id = auth.user_id

        # Add as member
        await conn.execute(
            """INSERT INTO workspace_members (workspace_id, user_id, role)
               VALUES ($1, $2, $3) ON CONFLICT DO NOTHING""",
            invite["workspace_id"], user_id, invite["role"],
        )

        # Update user's active workspace
        await conn.execute(
            "UPDATE users SET workspace_id=$1 WHERE id=$2",
            invite["workspace_id"], user_id,
        )

        # Mark invite accepted
        await conn.execute(
            "UPDATE workspace_invitations SET accepted=true WHERE id=$1",
            invite["id"],
        )

        return {
            "user_id": user_id,
            "workspace_id": str(invite["workspace_id"]),
            "role": invite["role"],
        }


# ─── Role Management ─────────────────────────────────────────────────────────

@router.patch("/members/{target_user_id}/role")
async def update_member_role(target_user_id: str, req: RoleUpdate, auth: AuthContext = Depends(RequireRole("admin"))):
    if req.role not in ROLE_HIERARCHY:
        raise HTTPException(status_code=400, detail="Invalid role")

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Get caller's role
        caller = await conn.fetchrow(
            "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
            auth.workspace_id, auth.user_id,
        )
        caller_role = caller["role"] if caller else "viewer"

        # Admins cannot promote to admin or owner
        if caller_role == "admin" and req.role in ("admin", "owner"):
            raise HTTPException(status_code=403, detail="Admins cannot promote to admin or owner")

        # Cannot change own role
        if target_user_id == auth.user_id:
            raise HTTPException(status_code=400, detail="Cannot change your own role")

        result = await conn.execute(
            "UPDATE workspace_members SET role=$1 WHERE workspace_id=$2 AND user_id=$3",
            req.role, auth.workspace_id, target_user_id,
        )
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Member not found")

    return {"ok": True, "user_id": target_user_id, "role": req.role}


@router.delete("/members/{target_user_id}")
async def remove_member(target_user_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        # Self-removal (leaving)
        if target_user_id == auth.user_id:
            # Check not sole owner
            owner_count = await conn.fetchval(
                "SELECT COUNT(*) FROM workspace_members WHERE workspace_id=$1 AND role='owner'",
                auth.workspace_id,
            )
            my_role = await conn.fetchval(
                "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
                auth.workspace_id, auth.user_id,
            )
            if my_role == "owner" and owner_count <= 1:
                raise HTTPException(status_code=400, detail="Transfer ownership before leaving")
        else:
            # Removing others requires admin+
            caller = await conn.fetchrow(
                "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
                auth.workspace_id, auth.user_id,
            )
            if not caller or ROLE_HIERARCHY.get(caller["role"], 0) < ROLE_HIERARCHY["admin"]:
                raise HTTPException(status_code=403, detail="Requires admin role or higher")

        result = await conn.execute(
            "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
            auth.workspace_id, target_user_id,
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Member not found")

    return {"ok": True}


# ─── Visibility PATCH endpoints ─────────────────────────────────────────────

@router.patch("/projects/{project_id}/visibility")
async def set_project_visibility(project_id: str, req: VisibilityUpdate, auth: AuthContext = Depends(RequireRole("admin"))):
    if req.visibility not in ("private", "team", "public"):
        raise HTTPException(status_code=400, detail="visibility must be private | team | public")
    pool = await get_pool()
    async with pool.acquire() as conn:
        sets = ["visibility=$2"]
        vals = [project_id, req.visibility]
        if req.clearance_level is not None:
            sets.append(f"clearance_level=${len(vals)+1}")
            vals.append(req.clearance_level)
        row = await conn.fetchrow(
            f"UPDATE projects SET {', '.join(sets)} WHERE id=$1 RETURNING id, visibility, clearance_level",
            *vals,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"id": str(row["id"]), "visibility": row["visibility"], "clearance_level": row["clearance_level"]}


@router.patch("/ideas/{idea_id}/visibility")
async def set_idea_visibility(idea_id: str, req: VisibilityUpdate, auth: AuthContext = Depends(RequireRole("admin"))):
    if req.visibility not in ("private", "team", "public"):
        raise HTTPException(status_code=400, detail="visibility must be private | team | public")
    pool = await get_pool()
    async with pool.acquire() as conn:
        sets = ["visibility=$2"]
        vals = [idea_id, req.visibility]
        if req.clearance_level is not None:
            sets.append(f"clearance_level=${len(vals)+1}")
            vals.append(req.clearance_level)
        row = await conn.fetchrow(
            f"UPDATE ideas SET {', '.join(sets)} WHERE id=$1 RETURNING id, visibility, clearance_level",
            *vals,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Idea not found")
        return {"id": str(row["id"]), "visibility": row["visibility"], "clearance_level": row["clearance_level"]}


@router.patch("/knowledge/{item_id}/visibility")
async def set_knowledge_visibility(item_id: str, req: VisibilityUpdate, auth: AuthContext = Depends(RequireRole("admin"))):
    if req.visibility not in ("private", "team", "public"):
        raise HTTPException(status_code=400, detail="visibility must be private | team | public")
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "UPDATE knowledge_items SET visibility=$2 WHERE id=$1 RETURNING id, visibility",
            item_id, req.visibility,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Knowledge item not found")
        return {"id": str(row["id"]), "visibility": row["visibility"]}
