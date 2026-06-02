from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth

router = APIRouter(tags=["ventures"])


class CreateVentureRequest(BaseModel):
    name: str
    description: Optional[str] = None


class OnboardingStepRequest(BaseModel):
    step: int


# ─── Ventures ─────────────────────────────────────────────────────────────────

@router.post("/api/ventures")
async def create_venture(req: CreateVentureRequest, auth: AuthContext = Depends(require_auth)):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    pool = await get_pool()
    async with pool.acquire() as conn:
        venture = await conn.fetchrow(
            """INSERT INTO ventures (workspace_id, owner_id, name, description)
               VALUES ($1, $2, $3, $4)
               RETURNING id, name, description, status, created_at""",
            auth.workspace_id, auth.user_id, req.name.strip(), req.description,
        )
        return {
            "id": str(venture["id"]),
            "name": venture["name"],
            "description": venture["description"],
            "status": venture["status"],
            "created_at": venture["created_at"].isoformat(),
        }


@router.get("/api/ventures")
async def list_ventures(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, name, description, status, slug, h3ros_vertical_tag, created_at, updated_at
               FROM ventures
               WHERE workspace_id=$1 AND deleted_at IS NULL
               ORDER BY created_at DESC""",
            auth.workspace_id,
        )
        return {
            "ventures": [
                {
                    "id": str(r["id"]),
                    "name": r["name"],
                    "description": r["description"],
                    "status": r["status"],
                    "slug": r["slug"],
                    "h3ros_vertical_tag": r["h3ros_vertical_tag"],
                    "created_at": r["created_at"].isoformat(),
                    "updated_at": r["updated_at"].isoformat(),
                }
                for r in rows
            ]
        }


# ─── Onboarding Step ──────────────────────────────────────────────────────────

@router.patch("/api/workspaces/onboarding-step")
async def update_onboarding_step(req: OnboardingStepRequest, auth: AuthContext = Depends(require_auth)):
    if req.step < 0 or req.step > 10:
        raise HTTPException(status_code=400, detail="step must be between 0 and 10")
    pool = await get_pool()
    async with pool.acquire() as conn:
        current = await conn.fetchval(
            "SELECT onboarding_step FROM workspaces WHERE id=$1",
            auth.workspace_id,
        )
        if current is not None and req.step <= current:
            raise HTTPException(status_code=400, detail="step must advance")
        if req.step >= 3:
            await conn.execute(
                "UPDATE workspaces SET onboarding_step=$1, onboarding_completed_at=NOW() WHERE id=$2",
                req.step, auth.workspace_id,
            )
        else:
            await conn.execute(
                "UPDATE workspaces SET onboarding_step=$1 WHERE id=$2",
                req.step, auth.workspace_id,
            )
    return {"ok": True, "step": req.step}
