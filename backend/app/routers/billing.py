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
    if not settings.STRIPE_WEBHOOK_SECRET:
        log.error("stripe_billing_webhook_secret_missing", detail="Set STRIPE_WEBHOOK_SECRET env var")
        raise HTTPException(status_code=500, detail="Webhook not configured")

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        log.error("stripe_billing_webhook_bad_signature")
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    except ValueError as e:
        log.error("stripe_billing_webhook_bad_payload", error=str(e))
        raise HTTPException(status_code=400, detail="Invalid webhook payload")

    log.info("stripe_billing_webhook", type=event["type"])

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        workspace_id = (session.get("metadata") or {}).get("workspace_id")
        if not workspace_id:
            log.error("stripe_billing_webhook_missing_workspace_id",
                      session_id=session.get("id"),
                      detail="checkout.session.completed received with no workspace_id in metadata")
            return {"ok": True, "warning": "no workspace_id in metadata — plan not updated"}

        pool = await get_pool()
        async with pool.acquire() as conn:
            rows_updated = await conn.execute(
                "UPDATE workspaces SET plan = 'growth', plan_updated_at = NOW() WHERE id = $1",
                workspace_id,
            )
        await cache_invalidate(f"plan:{workspace_id}")

        if rows_updated == "UPDATE 0":
            log.error("stripe_billing_webhook_workspace_not_found", workspace_id=workspace_id)
        else:
            log.info("workspace_upgraded_to_growth", workspace_id=workspace_id)

    return {"ok": True}
