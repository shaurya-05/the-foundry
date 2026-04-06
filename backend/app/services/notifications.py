"""Notification creation helper — inserts into the notifications table."""
import json
import structlog
from app.db.postgres import get_pool

log = structlog.get_logger()

# Notification types
TASK_ASSIGNED = "task_assigned"
TASK_COMPLETED = "task_completed"
TASK_OVERDUE = "task_overdue"
AGENT_RUN_COMPLETE = "agent_run_complete"
PIPELINE_COMPLETE = "pipeline_complete"
SWOT_GENERATED = "swot_generated"
MEMBER_JOINED = "member_joined"


async def create_notification(
    workspace_id: str,
    user_id: str,  # recipient
    type: str,
    title: str,
    body: str = None,
    metadata: dict = None,
):
    """Create a notification for a user. Optionally publish to Redis for real-time delivery."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO notifications (workspace_id, user_id, type, title, body, metadata)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            workspace_id, user_id, type, title, body,
            json.dumps(metadata) if metadata else None,
        )

    # Optionally push to Redis pubsub for real-time WebSocket delivery
    try:
        from app.db.redis import get_redis
        redis = await get_redis()
        await redis.publish(
            f"notifications:{user_id}",
            json.dumps({"type": type, "title": title, "body": body}),
        )
    except Exception:
        pass  # Redis unavailable — notification still saved to DB

    log.info("notification_created", type=type, user_id=user_id, title=title[:60])
