import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.models.schemas import ProjectCreate, ProjectUpdate, Project
from app.db.postgres import get_pool
from app.services.claude import stream_sse, complete_claude
from app.services.embeddings import embed_text
from app.services.graph import upsert_project_node
from app.dependencies import AuthContext, require_auth

router = APIRouter(prefix="/api/projects", tags=["projects"])

PLAN_SYSTEM = """You are a senior project architect. Create a structured project plan for the given title.
Include:
## Overview
(2-3 sentences describing the project)

## Core Objectives
(3-5 specific bullet points)

## Key Milestones
(4-6 milestones with rough timeline)

## Technical Requirements
(key technologies and constraints)

## Success Criteria
(measurable outcomes)

Be specific, practical, and actionable."""

@router.post("", response_model=Project)
async def create_project(req: ProjectCreate, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    embedding = await embed_text(req.title)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO projects (workspace_id, user_id, title, embedding)
               VALUES ($1, $2, $3, $4::vector) RETURNING *""",
            auth.workspace_id, auth.user_id, req.title, str(embedding)
        )
        await conn.execute(
            """INSERT INTO activity_events (workspace_id, user_id, type, title, entity_type, entity_id)
               VALUES ($1, $2, 'project_created', $3, 'project', $4)""",
            auth.workspace_id, auth.user_id, f"New build: {req.title}", str(row["id"])
        )
        try:
            await upsert_project_node(str(row["id"]), req.title, auth.workspace_id)
        except Exception:
            pass
        from app.db.cache import cache_invalidate
        await cache_invalidate(f"projects_list:{auth.workspace_id}", f"ws_summary:{auth.workspace_id}")
        return _row_to_project(row)

@router.get("")
async def list_projects(auth: AuthContext = Depends(require_auth)):
    from app.db.cache import cache_get, cache_set
    cache_key = f"projects_list:{auth.workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, workspace_id, user_id, title, status, plan, notes,
                      visibility, clearance_level, metadata, created_at
               FROM projects WHERE workspace_id=$1
               ORDER BY created_at DESC""",
            auth.workspace_id
        )
        result = [_row_to_project(r).model_dump(mode='json') for r in rows]
        await cache_set(cache_key, result, ttl=300)
        return result

@router.patch("/{project_id}", response_model=Project)
async def update_project(project_id: str, req: ProjectUpdate, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM projects WHERE id=$1 AND workspace_id=$2",
            project_id, auth.workspace_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Not found")
        updates = req.model_dump(exclude_none=True)
        if not updates:
            return _row_to_project(existing)
        set_clauses = [f"{k}=${i+2}" for i, k in enumerate(updates.keys())]
        values = [project_id] + list(updates.values())
        row = await conn.fetchrow(
            f"UPDATE projects SET {', '.join(set_clauses)} WHERE id=$1 RETURNING *",
            *values
        )
        return _row_to_project(row)

@router.delete("/{project_id}")
async def delete_project(project_id: str, auth: AuthContext = Depends(require_auth)):
    from app.db.cache import cache_invalidate
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM projects WHERE id=$1 AND workspace_id=$2",
            project_id, auth.workspace_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Not found")
    await cache_invalidate(f"projects_list:{auth.workspace_id}", f"ws_summary:{auth.workspace_id}")
    return {"ok": True}

@router.get("/{project_id}/export")
async def export_project(project_id: str, auth: AuthContext = Depends(require_auth)):
    """Export project as structured document data."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        project = await conn.fetchrow(
            "SELECT * FROM projects WHERE id=$1 AND workspace_id=$2",
            project_id, auth.workspace_id,
        )
        if not project:
            raise HTTPException(status_code=404, detail="Not found")
        tasks = await conn.fetch(
            "SELECT title, status, description, priority FROM tasks WHERE project_id=$1 ORDER BY created_at",
            project_id,
        )
    return {
        "title": project["title"],
        "status": project["status"],
        "plan": project["plan"] or "",
        "notes": project["notes"] or "",
        "tasks": [{"title": t["title"], "status": t["status"], "description": t["description"], "priority": t["priority"]} for t in tasks],
        "created_at": project["created_at"].isoformat(),
    }


@router.post("/{project_id}/forge-plan")
async def forge_project_plan(project_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM projects WHERE id=$1 AND workspace_id=$2",
            project_id, auth.workspace_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    async def save_plan_and_stream():
        full_output = []
        async for chunk in stream_sse(PLAN_SYSTEM, f"Project: {row['title']}", max_tokens=1500):
            full_output.append(chunk)
            yield chunk
        import json
        plan_text = ""
        for chunk in full_output:
            if chunk.startswith("data: "):
                try:
                    data = json.loads(chunk[6:])
                    if data.get("type") == "text_delta":
                        plan_text += data.get("text", "")
                except Exception:
                    pass
        if plan_text:
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE projects SET plan=$1 WHERE id=$2",
                    plan_text, project_id
                )
                lines = plan_text.split("\n")
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith("- ") or stripped.startswith("* "):
                        task_title = stripped[2:].strip()
                        if task_title and len(task_title) > 5:
                            await conn.execute(
                                """INSERT INTO tasks (workspace_id, user_id, title, project_id, source)
                                   VALUES ($1, $2, $3, $4, 'copilot')""",
                                auth.workspace_id, auth.user_id, task_title[:200], project_id
                            )

    return StreamingResponse(
        save_plan_and_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.post("/{project_id}/related")
async def get_related(project_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        project = await conn.fetchrow(
            "SELECT * FROM projects WHERE id=$1 AND workspace_id=$2",
            project_id, auth.workspace_id
        )
        if not project:
            raise HTTPException(status_code=404, detail="Not found")
        if project["embedding"]:
            knowledge = await conn.fetch(
                """SELECT id, title, summary, type
                   FROM knowledge_items
                   WHERE workspace_id=$1 AND embedding IS NOT NULL
                   ORDER BY embedding <=> $2::vector LIMIT 5""",
                auth.workspace_id, project["embedding"]
            )
        else:
            knowledge = []
        ideas = await conn.fetch(
            "SELECT id, domains FROM ideas WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 3",
            auth.workspace_id
        )
        tasks = await conn.fetch(
            "SELECT id, title, status FROM tasks WHERE project_id=$1 ORDER BY created_at DESC",
            project_id
        )
    return {
        "knowledge": [dict(r) for r in knowledge],
        "ideas": [dict(r) for r in ideas],
        "tasks": [dict(r) for r in tasks],
    }

def _row_to_project(row) -> Project:
    return Project(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        user_id=str(row["user_id"]),
        title=row["title"],
        plan=row["plan"],
        notes=row["notes"] if "notes" in row.keys() else "",
        status=row["status"],
        visibility=row["visibility"] if "visibility" in row.keys() else "private",
        clearance_level=row["clearance_level"] if "clearance_level" in row.keys() else 0,
        metadata=(json.loads(row["metadata"]) if isinstance(row["metadata"], str) else dict(row["metadata"])) if row["metadata"] else {},
        created_at=row["created_at"],
    )
