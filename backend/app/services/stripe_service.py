"""Stripe integration for subscription management."""
import os
import stripe
import structlog
from app.db.postgres import get_pool
from app.db.cache import cache_invalidate

log = structlog.get_logger()

STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY

# Map plan IDs to Stripe price IDs (set these after creating products in Stripe dashboard)
STRIPE_PRICE_MAP = {
    "pro_monthly": os.getenv("STRIPE_PRICE_PRO_MONTHLY", ""),
    "pro_yearly": os.getenv("STRIPE_PRICE_PRO_YEARLY", ""),
    "forge_team_monthly": os.getenv("STRIPE_PRICE_TEAM_MONTHLY", ""),
    "forge_team_yearly": os.getenv("STRIPE_PRICE_TEAM_YEARLY", ""),
}


async def get_or_create_customer(workspace_id: str, email: str) -> str:
    """Get existing Stripe customer or create one."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT stripe_customer_id FROM subscriptions WHERE workspace_id=$1",
            workspace_id,
        )
        if row and row["stripe_customer_id"]:
            return row["stripe_customer_id"]

    # Create new customer
    customer = stripe.Customer.create(
        email=email,
        metadata={"workspace_id": workspace_id},
    )
    log.info("stripe_customer_created", workspace_id=workspace_id, customer_id=customer.id)
    return customer.id


async def create_checkout_session(workspace_id: str, email: str, plan_id: str, billing_cycle: str) -> str:
    """Create a Stripe checkout session and return the URL."""
    if not STRIPE_SECRET_KEY:
        log.warning("stripe_not_configured", message="Set STRIPE_SECRET_KEY to enable payments")
        raise ValueError("Payments not configured. Set STRIPE_SECRET_KEY.")

    price_key = f"{plan_id}_{billing_cycle}"
    price_id = STRIPE_PRICE_MAP.get(price_key)
    if not price_id:
        raise ValueError(f"No Stripe price configured for {price_key}")

    customer_id = await get_or_create_customer(workspace_id, email)

    # Save customer ID to subscription record
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO subscriptions (workspace_id, stripe_customer_id)
               VALUES ($1, $2)
               ON CONFLICT (workspace_id)
               DO UPDATE SET stripe_customer_id=$2, updated_at=NOW()""",
            workspace_id, customer_id,
        )

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{FRONTEND_URL}/settings?upgraded=true",
        cancel_url=f"{FRONTEND_URL}/pricing",
        metadata={"workspace_id": workspace_id, "plan_id": plan_id},
        subscription_data={"metadata": {"workspace_id": workspace_id, "plan_id": plan_id}},
    )
    log.info("stripe_checkout_created", workspace_id=workspace_id, plan=plan_id, cycle=billing_cycle)
    return session.url


async def create_portal_session(workspace_id: str) -> str:
    """Create a Stripe customer portal session for managing billing."""
    if not STRIPE_SECRET_KEY:
        raise ValueError("Payments not configured")

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT stripe_customer_id FROM subscriptions WHERE workspace_id=$1",
            workspace_id,
        )
    if not row or not row["stripe_customer_id"]:
        raise ValueError("No billing account found")

    session = stripe.billing_portal.Session.create(
        customer=row["stripe_customer_id"],
        return_url=f"{FRONTEND_URL}/settings",
    )
    return session.url


async def handle_webhook(payload: bytes, sig_header: str):
    """Process Stripe webhook events."""
    if not STRIPE_WEBHOOK_SECRET:
        log.warning("stripe_webhook_secret_missing")
        return

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        log.error("stripe_webhook_invalid_signature")
        raise ValueError("Invalid webhook signature")

    log.info("stripe_webhook", type=event["type"])

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        workspace_id = session["metadata"].get("workspace_id")
        plan_id = session["metadata"].get("plan_id")
        subscription_id = session.get("subscription")

        if workspace_id and plan_id:
            await _activate_subscription(workspace_id, plan_id, subscription_id)

    elif event["type"] == "customer.subscription.updated":
        sub = event["data"]["object"]
        workspace_id = sub["metadata"].get("workspace_id")
        if workspace_id:
            status = sub["status"]
            if status == "active":
                plan_id = sub["metadata"].get("plan_id", "pro")
                await _activate_subscription(workspace_id, plan_id, sub["id"])
            elif status in ("canceled", "unpaid", "past_due"):
                await _downgrade_to_spark(workspace_id)

    elif event["type"] == "customer.subscription.deleted":
        sub = event["data"]["object"]
        workspace_id = sub["metadata"].get("workspace_id")
        if workspace_id:
            await _downgrade_to_spark(workspace_id)

    elif event["type"] == "invoice.payment_failed":
        invoice = event["data"]["object"]
        customer_id = invoice.get("customer")
        log.warning("stripe_payment_failed", customer_id=customer_id)


async def _activate_subscription(workspace_id: str, plan_id: str, stripe_subscription_id: str = None):
    """Activate a plan for a workspace."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE subscriptions
               SET plan_id=$2, status='active', stripe_subscription_id=$3, updated_at=NOW(),
                   current_period_start=NOW(), current_period_end=NOW() + INTERVAL '30 days'
               WHERE workspace_id=$1""",
            workspace_id, plan_id, stripe_subscription_id,
        )
    await cache_invalidate(f"plan:{workspace_id}", f"usage:{workspace_id}")
    log.info("subscription_activated", workspace_id=workspace_id, plan=plan_id)


async def _downgrade_to_spark(workspace_id: str):
    """Downgrade workspace to free Spark plan."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE subscriptions
               SET plan_id='spark', status='active', stripe_subscription_id=NULL,
                   canceled_at=NOW(), updated_at=NOW()
               WHERE workspace_id=$1""",
            workspace_id,
        )
    await cache_invalidate(f"plan:{workspace_id}", f"usage:{workspace_id}")
    log.info("subscription_downgraded", workspace_id=workspace_id)
