import json
from fastapi import APIRouter, Depends, HTTPException, Query
from app.models.schemas import TaskCreate, TaskUpdate, Task, BulkStatusUpdate
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth
from typing import Optional

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

@router.post("", response_model=Task)
async def create_task(req: TaskCreate, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO tasks (workspace_id, user_id, title, description, status, priority, project_id, due_date, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *""",
            auth.workspace_id, auth.user_id, req.title, req.description,
            req.status, req.priority, req.project_id, req.due_date, req.source
        )
        await conn.execute(
            """INSERT INTO activity_events (workspace_id, user_id, type, title, entity_type, entity_id)
               VALUES ($1, $2, 'task_created', $3, 'task', $4)""",
            auth.workspace_id, auth.user_id, f"Task added: {req.title}", str(row["id"])
        )
        from app.db.cache import cache_invalidate_pattern
        await cache_invalidate_pattern(f"tasks_list:{auth.workspace_id}:*")
        return _row_to_task(row)

@router.get("", response_model=list[Task])
async def list_tasks(
    project_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    auth: AuthContext = Depends(require_auth),
):
    from app.db.cache import cache_get, cache_set
    cache_key = f"tasks_list:{auth.workspace_id}:{project_id or ''}:{status or ''}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        conditions = ["workspace_id=$1"]
        params = [auth.workspace_id]
        if project_id:
            params.append(project_id)
            conditions.append(f"project_id=${len(params)}")
        if status:
            params.append(status)
            conditions.append(f"status=${len(params)}")
        where = " AND ".join(conditions)
        rows = await conn.fetch(
            f"""SELECT id, workspace_id, user_id, project_id, title, description,
                       status, priority, due_date, source, metadata, created_at, updated_at
                FROM tasks WHERE {where} ORDER BY created_at DESC""",
            *params
        )
        result = [_row_to_task(r) for r in rows]
        await cache_set(cache_key, result, ttl=120)  # 2-min TTL for tasks (change more often)
        return result

@router.patch("/{task_id}", response_model=Task)
async def update_task(task_id: str, req: TaskUpdate, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM tasks WHERE id=$1 AND workspace_id=$2",
            task_id, auth.workspace_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Not found")
        updates = req.model_dump(exclude_none=True)
        if not updates:
            return _row_to_task(existing)
        updates["updated_at"] = "NOW()"
        set_clauses = []
        values = [task_id]
        for k, v in updates.items():
            if v == "NOW()":
                set_clauses.append(f"{k}=NOW()")
            else:
                values.append(v)
                set_clauses.append(f"{k}=${len(values)}")
        row = await conn.fetchrow(
            f"UPDATE tasks SET {', '.join(set_clauses)} WHERE id=$1 RETURNING *",
            *values
        )
        if row and req.status == "completed":
            await conn.execute(
                """INSERT INTO activity_events (workspace_id, user_id, type, title, entity_type, entity_id)
                   VALUES ($1, $2, 'task_completed', $3, 'task', $4)""",
                auth.workspace_id, auth.user_id, f"Task done: {row['title']}", task_id
            )
    from app.db.cache import cache_invalidate_pattern
    await cache_invalidate_pattern(f"tasks_list:{auth.workspace_id}:*")
    return _row_to_task(row)

@router.delete("/{task_id}")
async def delete_task(task_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM tasks WHERE id=$1 AND workspace_id=$2",
            task_id, auth.workspace_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.patch("/bulk-status")
async def bulk_status_update(req: BulkStatusUpdate, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE tasks SET status=$1, updated_at=NOW() WHERE id=ANY($2::uuid[]) AND workspace_id=$3",
            req.status, req.task_ids, auth.workspace_id
        )
    return {"ok": True, "updated": len(req.task_ids)}

def _row_to_task(row) -> Task:
    return Task(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        user_id=str(row["user_id"]),
        title=row["title"],
        description=row["description"],
        status=row["status"],
        priority=row["priority"],
        project_id=str(row["project_id"]) if row["project_id"] else None,
        due_date=row["due_date"],
        source=row["source"],
        metadata=(json.loads(row["metadata"]) if isinstance(row["metadata"], str) else dict(row["metadata"])) if row["metadata"] else {},
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
