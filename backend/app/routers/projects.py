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

SECTION_PROMPTS = {
    # Project Plan sections
    'overview': '## Overview\n(2-3 sentences describing the project scope and vision)',
    'objectives': '## Core Objectives\n(3-5 specific, measurable bullet points)',
    'milestones': '## Key Milestones\n(4-6 milestones with rough timeline — Month 1-2, Month 3-4, etc.)',
    'technical': '## Technical Requirements\n(key technologies, architecture decisions, and constraints)',
    'success_criteria': '## Success Criteria\n(measurable outcomes that define success)',
    'tasks': """## Tasks
Generate 5-10 specific, actionable tasks. Each on its own line starting with "- [ ] " followed by the task title. Add priority in brackets [critical], [high], [medium], or [low].
Example:
- [ ] [high] Set up project repository and CI/CD pipeline
- [ ] [critical] Design core system architecture""",
    # Launch Brief sections
    'pitch': '## The Pitch\n(One compelling paragraph — the elevator pitch for this project)',
    'problem': '## The Problem\n(What pain exists? Include data points, market size of the problem, why current solutions fail)',
    'solution': '## The Solution\n(How this project solves it — key differentiation, technical approach, unique insight)',
    'target_market': '## Target Market\n(TAM/SAM/SOM breakdown, primary and secondary segments with sizing)',
    'mvp': '## MVP Feature Set\n(Minimum viable product — what ships first, what waits. Hardware AND software if applicable)',
    'go_to_market': '## Go-To-Market Strategy\n(Days 1-30, 31-60, 61-90 plan with specific channels, targets, and tactics)',
    'key_metrics': '## Key Metrics\n(30-day, 60-day, 90-day targets. Include a North Star metric)',
    'funding': '## Funding Path\n(Pre-seed/seed strategy, ideal investor profile, bootstrapping risk assessment, stage triggers)',
}

def build_plan_system(sections: list[str]) -> str:
    selected = [SECTION_PROMPTS[s] for s in sections if s in SECTION_PROMPTS]
    if not selected:
        selected = list(SECTION_PROMPTS.values())

    return f"""You are a senior project architect and startup strategist. Create a comprehensive project document for the given title.

Include the following sections:
{chr(10).join(selected)}

Be specific, practical, and actionable. Reference real technologies, real market dynamics, and real numbers where possible. Tasks should be concrete enough to assign to someone."""

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

@router.get("/{project_id}", response_model=Project)
async def get_project(project_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT id, workspace_id, user_id, title, status, plan, notes,
                      visibility, clearance_level, metadata, created_at
               FROM projects WHERE id=$1 AND workspace_id=$2""",
            project_id, auth.workspace_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        return _row_to_project(row)

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
async def forge_project_plan(project_id: str, sections: str = "", auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM projects WHERE id=$1 AND workspace_id=$2",
            project_id, auth.workspace_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    section_list = [s.strip() for s in sections.split(',') if s.strip()] if sections else list(SECTION_PROMPTS.keys())
    system_prompt = build_plan_system(section_list)
    # More sections = more tokens needed
    max_tok = min(800 + len(section_list) * 200, 4000)

    async def save_plan_and_stream():
        full_output = []
        async for chunk in stream_sse(system_prompt, f"Project: {row['title']}", max_tokens=max_tok):
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
            import re
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE projects SET plan=$1 WHERE id=$2",
                    plan_text, project_id
                )

                # Smart task extraction from plan
                task_count = 0
                for line in plan_text.split("\n"):
                    stripped = line.strip()

                    # Parse "- [ ] [priority] task title" format
                    checkbox_match = re.match(r'^-\s*\[[ x]\]\s*(?:\[(critical|high|medium|low)\]\s*)?(.+)', stripped)
                    if checkbox_match:
                        priority = checkbox_match.group(1) or "medium"
                        task_title = checkbox_match.group(2).strip()
                        if task_title and len(task_title) > 5 and task_count < 15:
                            await conn.execute(
                                """INSERT INTO tasks (workspace_id, user_id, title, project_id, priority, source)
                                   VALUES ($1, $2, $3, $4, $5, 'forge')""",
                                auth.workspace_id, auth.user_id, task_title[:200], project_id, priority,
                            )
                            task_count += 1
                            continue

                    # Fallback: catch "- " and "* " bullet points in Tasks/Milestones sections
                    if (stripped.startswith("- ") or stripped.startswith("* ")) and not stripped.startswith("- ["):
                        task_title = re.sub(r'^[-*]\s+', '', stripped)
                        # Skip short or header-like lines
                        if task_title and len(task_title) > 8 and task_count < 15 and not task_title.startswith("#"):
                            await conn.execute(
                                """INSERT INTO tasks (workspace_id, user_id, title, project_id, priority, source)
                                   VALUES ($1, $2, $3, $4, 'medium', 'forge')""",
                                auth.workspace_id, auth.user_id, task_title[:200], project_id,
                            )
                            task_count += 1

                # Log activity
                if task_count > 0:
                    await conn.execute(
                        """INSERT INTO activity_events (workspace_id, user_id, type, title, entity_type, entity_id)
                           VALUES ($1, $2, 'tasks_generated', $3, 'project', $4)""",
                        auth.workspace_id, auth.user_id,
                        f"{task_count} tasks auto-generated for {row['title']}", project_id,
                    )

                # Invalidate caches
                from app.db.cache import cache_invalidate
                await cache_invalidate(
                    f"projects_list:{auth.workspace_id}",
                    f"ws_summary:{auth.workspace_id}",
                    f"tasks_list:{auth.workspace_id}",
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
