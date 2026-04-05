"""Usage tracking and plan limit enforcement."""
import json
from app.db.postgres import get_pool
from app.db.cache import cache_get, cache_set
import structlog

log = structlog.get_logger()


async def get_workspace_plan(workspace_id: str) -> dict:
    """Get the plan + limits for a workspace. Cached 5 minutes."""
    cache_key = f"plan:{workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT p.id, p.name, p.price_monthly, p.limits, s.status, s.billing_cycle,
                      s.current_period_start, s.current_period_end
               FROM subscriptions s
               JOIN plans p ON s.plan_id = p.id
               WHERE s.workspace_id = $1""",
            workspace_id,
        )
    if not row:
        # Default to spark if no subscription exists
        result = {"plan_id": "spark", "plan_name": "Spark", "limits": {
            "copilot_messages": 25, "agent_runs": 10, "forge_operations": 3,
            "pipeline_runs": 0, "projects": 3, "knowledge_items": 50,
            "team_members": 1, "workspaces": 1,
        }, "status": "active"}
    else:
        limits = row["limits"] if isinstance(row["limits"], dict) else json.loads(row["limits"])
        result = {
            "plan_id": row["id"],
            "plan_name": row["name"],
            "price_monthly": row["price_monthly"],
            "limits": limits,
            "status": row["status"],
            "billing_cycle": row["billing_cycle"],
            "current_period_start": row["current_period_start"].isoformat() if row["current_period_start"] else None,
            "current_period_end": row["current_period_end"].isoformat() if row["current_period_end"] else None,
        }

    await cache_set(cache_key, result, ttl=300)
    return result


async def get_current_usage(workspace_id: str) -> dict:
    """Get current period usage counters."""
    cache_key = f"usage:{workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT copilot_messages, agent_runs, forge_operations, pipeline_runs
               FROM usage_tracking
               WHERE workspace_id = $1 AND period_start = date_trunc('month', NOW())::date""",
            workspace_id,
        )
    result = {
        "copilot_messages": row["copilot_messages"] if row else 0,
        "agent_runs": row["agent_runs"] if row else 0,
        "forge_operations": row["forge_operations"] if row else 0,
        "pipeline_runs": row["pipeline_runs"] if row else 0,
    }
    await cache_set(cache_key, result, ttl=60)
    return result


async def check_limit(workspace_id: str, resource: str) -> bool:
    """Check if workspace is under the limit for a resource. Returns True if allowed."""
    plan = await get_workspace_plan(workspace_id)
    limit = plan["limits"].get(resource, 0)
    if limit == -1:
        return True  # unlimited
    usage = await get_current_usage(workspace_id)
    current = usage.get(resource, 0)
    return current < limit


async def check_storage_limit(workspace_id: str, resource: str) -> bool:
    """Check storage limits (projects, knowledge_items) by counting rows."""
    plan = await get_workspace_plan(workspace_id)
    limit = plan["limits"].get(resource, 0)
    if limit == -1:
        return True

    table_map = {"projects": "projects", "knowledge_items": "knowledge_items"}
    table = table_map.get(resource)
    if not table:
        return True

    pool = await get_pool()
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            f"SELECT COUNT(*) FROM {table} WHERE workspace_id=$1",
            workspace_id,
        )
    return count < limit


async def increment_usage(workspace_id: str, resource: str, amount: int = 1):
    """Atomically increment a usage counter."""
    from app.db.cache import cache_invalidate
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            f"""INSERT INTO usage_tracking (workspace_id, period_start, {resource})
                VALUES ($1, date_trunc('month', NOW())::date, $2)
                ON CONFLICT (workspace_id, period_start)
                DO UPDATE SET {resource} = usage_tracking.{resource} + $2, updated_at = NOW()""",
            workspace_id, amount,
        )
    await cache_invalidate(f"usage:{workspace_id}")
