from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import AuthContext, require_auth
from app.services.usage import get_workspace_plan, get_current_usage

router = APIRouter(prefix="/api/subscription", tags=["subscription"])


@router.get("")
async def get_subscription(auth: AuthContext = Depends(require_auth)):
    """Returns current plan, limits, and usage for the workspace."""
    plan = await get_workspace_plan(auth.workspace_id)
    usage = await get_current_usage(auth.workspace_id)
    return {
        "plan": {
            "id": plan["plan_id"],
            "name": plan["plan_name"],
            "price_monthly": plan.get("price_monthly", 0),
            "limits": plan["limits"],
        },
        "status": plan["status"],
        "billing_cycle": plan.get("billing_cycle", "monthly"),
        "current_period_end": plan.get("current_period_end"),
        "usage": usage,
    }


@router.get("/plans")
async def list_plans():
    """Returns all available plans (public, no auth needed)."""
    from app.db.postgres import get_pool
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM plans ORDER BY price_monthly")
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "price_monthly": r["price_monthly"],
                "price_yearly": r["price_yearly"],
                "limits": r["limits"],
            }
            for r in rows
        ]
