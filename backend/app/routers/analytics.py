"""Dashboard intelligence — velocity, project health, attention items."""
from fastapi import APIRouter, Depends
from app.db.postgres import get_pool
from app.db.cache import cache_get, cache_set
from app.dependencies import AuthContext, require_auth

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/velocity")
async def get_velocity(auth: AuthContext = Depends(require_auth)):
    """Tasks completed this week vs last week + trend."""
    cache_key = f"velocity:{auth.workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT
                 COUNT(*) FILTER (WHERE updated_at >= date_trunc('week', NOW())) as completed_this_week,
                 COUNT(*) FILTER (WHERE updated_at >= date_trunc('week', NOW()) - INTERVAL '7 days'
                                  AND updated_at < date_trunc('week', NOW())) as completed_last_week
               FROM tasks
               WHERE workspace_id=$1 AND status='completed'""",
            auth.workspace_id,
        )
        created = await conn.fetchrow(
            """SELECT
                 COUNT(*) FILTER (WHERE created_at >= date_trunc('week', NOW())) as created_this_week,
                 COUNT(*) FILTER (WHERE created_at >= date_trunc('week', NOW()) - INTERVAL '7 days'
                                  AND created_at < date_trunc('week', NOW())) as created_last_week
               FROM tasks WHERE workspace_id=$1""",
            auth.workspace_id,
        )

    this_w = int(row["completed_this_week"] or 0)
    last_w = int(row["completed_last_week"] or 0)
    ratio = round(this_w / max(last_w, 1), 2)
    trend = "up" if this_w > last_w else "down" if this_w < last_w else "flat"

    result = {
        "completed_this_week": this_w,
        "completed_last_week": last_w,
        "created_this_week": int(created["created_this_week"] or 0),
        "created_last_week": int(created["created_last_week"] or 0),
        "velocity_ratio": ratio,
        "trend": trend,
    }
    await cache_set(cache_key, result, ttl=300)
    return result


@router.get("/health")
async def get_project_health(auth: AuthContext = Depends(require_auth)):
    """Per-project health score based on blocked/overdue tasks."""
    cache_key = f"health:{auth.workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        projects = await conn.fetch(
            """SELECT p.id, p.title, p.status,
                      COUNT(t.id) as total_tasks,
                      COUNT(t.id) FILTER (WHERE t.status='completed') as completed,
                      COUNT(t.id) FILTER (WHERE t.status='blocked') as blocked,
                      COUNT(t.id) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status NOT IN ('completed','blocked')) as overdue
               FROM projects p
               LEFT JOIN tasks t ON t.project_id = p.id::text
               WHERE p.workspace_id=$1 AND p.status='active'
               GROUP BY p.id, p.title, p.status""",
            auth.workspace_id,
        )

    result = []
    for p in projects:
        total = int(p["total_tasks"] or 0)
        blocked = int(p["blocked"] or 0)
        overdue = int(p["overdue"] or 0)
        completed = int(p["completed"] or 0)

        if total == 0:
            score = 0.5  # No tasks = uncertain
        else:
            blocked_ratio = blocked / total
            overdue_ratio = overdue / total
            score = round(max(0, 1.0 - 0.3 * blocked_ratio - 0.4 * overdue_ratio), 2)

        label = "healthy" if score > 0.7 else "at_risk" if score > 0.4 else "critical"

        result.append({
            "project_id": str(p["id"]),
            "title": p["title"],
            "total_tasks": total,
            "completed": completed,
            "blocked": blocked,
            "overdue": overdue,
            "health_score": score,
            "health_label": label,
        })

    await cache_set(cache_key, result, ttl=300)
    return result


@router.get("/attention")
async def get_attention_items(auth: AuthContext = Depends(require_auth)):
    """Top 5 items needing immediate attention."""
    cache_key = f"attention:{auth.workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    items = []
    async with pool.acquire() as conn:
        # Overdue tasks (highest priority)
        overdue = await conn.fetch(
            """SELECT id, title, due_date, priority FROM tasks
               WHERE workspace_id=$1 AND due_date < CURRENT_DATE
                 AND status NOT IN ('completed', 'blocked')
               ORDER BY due_date LIMIT 3""",
            auth.workspace_id,
        )
        for t in overdue:
            items.append({
                "type": "overdue_task",
                "title": t["title"],
                "detail": f"Due {t['due_date']}",
                "entity_id": str(t["id"]),
                "entity_type": "task",
                "severity": "high",
            })

        # Blocked tasks
        blocked = await conn.fetch(
            """SELECT id, title FROM tasks
               WHERE workspace_id=$1 AND status='blocked'
               ORDER BY updated_at DESC LIMIT 2""",
            auth.workspace_id,
        )
        for t in blocked:
            items.append({
                "type": "blocked_task",
                "title": t["title"],
                "detail": "Needs unblocking",
                "entity_id": str(t["id"]),
                "entity_type": "task",
                "severity": "medium",
            })

        # Projects with no tasks
        empty_projects = await conn.fetch(
            """SELECT p.id, p.title FROM projects p
               LEFT JOIN tasks t ON t.project_id = p.id::text
               WHERE p.workspace_id=$1 AND p.status='active'
               GROUP BY p.id, p.title
               HAVING COUNT(t.id) = 0
               LIMIT 2""",
            auth.workspace_id,
        )
        for p in empty_projects:
            items.append({
                "type": "empty_project",
                "title": p["title"],
                "detail": "No tasks — forge a plan",
                "entity_id": str(p["id"]),
                "entity_type": "project",
                "severity": "low",
            })

    result = sorted(items, key=lambda x: {"high": 0, "medium": 1, "low": 2}[x["severity"]])[:5]
    await cache_set(cache_key, result, ttl=300)
    return result
