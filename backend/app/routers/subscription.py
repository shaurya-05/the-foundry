from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from app.dependencies import AuthContext, require_auth
from app.services.usage import get_workspace_plan, get_current_usage

router = APIRouter(prefix="/api/subscription", tags=["subscription"])


class CheckoutRequest(BaseModel):
    plan_id: str  # "pro" or "forge_team"
    billing_cycle: str = "monthly"  # "monthly" or "yearly"


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


@router.post("/checkout")
async def create_checkout(req: CheckoutRequest, auth: AuthContext = Depends(require_auth)):
    """Create a Stripe checkout session for plan upgrade."""
    if req.plan_id not in ("pro", "forge_team"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    if req.billing_cycle not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="Invalid billing cycle")

    try:
        from app.services.stripe_service import create_checkout_session
        url = await create_checkout_session(
            auth.workspace_id, auth.email, req.plan_id, req.billing_cycle,
        )
        return {"checkout_url": url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/portal")
async def create_portal(auth: AuthContext = Depends(require_auth)):
    """Create a Stripe customer portal session for managing billing."""
    try:
        from app.services.stripe_service import create_portal_session
        url = await create_portal_session(auth.workspace_id)
        return {"portal_url": url}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events."""
    payload = await request.body()
    sig = request.headers.get("Stripe-Signature", "")

    try:
        from app.services.stripe_service import handle_webhook
        await handle_webhook(payload, sig)
        return {"ok": True}
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid webhook")
