import stripe
from fastapi import APIRouter, Request, HTTPException
from app.config import settings
from app.db.postgres import get_pool
from app.db.cache import cache_invalidate
import structlog

log = structlog.get_logger()

router = APIRouter(tags=["billing"])


@router.post("/billing/webhook")
async def stripe_billing_webhook(request: Request):
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    log.info("stripe_billing_webhook", type=event["type"])

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        workspace_id = (session.get("metadata") or {}).get("workspace_id")
        if workspace_id:
            pool = await get_pool()
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE workspaces SET plan = 'growth', plan_updated_at = NOW() WHERE id = $1",
                    workspace_id,
                )
            await cache_invalidate(f"plan:{workspace_id}")
            log.info("workspace_upgraded_to_growth", workspace_id=workspace_id)

    return {"ok": True}
