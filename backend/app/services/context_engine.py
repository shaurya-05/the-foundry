"""Context engine: generates workspace insights and assembles Copilot context."""
from app.db.postgres import get_pool
from app.db.cache import cache_get, cache_set
from app.services.claude import complete_claude
from typing import Dict, Any, List

INSIGHT_SYSTEM = """You are a system awareness engine for THE FOUNDRY. Analyze the workspace state and generate exactly 4 precise insights.

Each insight must:
- Name a pattern or connection between entities
- Explain its significance to the builder
- Recommend one specific, actionable next step

Format each insight as:
## [Insight Title]
[2-3 sentence analysis]. [Recommendation sentence]

Use precise, system-level language. Reference actual items by name. Be direct."""

async def get_workspace_summary(workspace_id: str) -> Dict[str, Any]:
    # Check Redis cache first (5-min TTL)
    cache_key = f"ws_summary:{workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        knowledge_count = await conn.fetchval(
            "SELECT COUNT(*) FROM knowledge_items WHERE workspace_id=$1", workspace_id
        )
        knowledge_titles = await conn.fetch(
            "SELECT title, summary FROM knowledge_items WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 10",
            workspace_id
        )
        projects = await conn.fetch(
            "SELECT title, status FROM projects WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 10",
            workspace_id
        )
        task_stats = await conn.fetch(
            "SELECT status, COUNT(*) as cnt FROM tasks WHERE workspace_id=$1 GROUP BY status",
            workspace_id
        )
        ideas = await conn.fetch(
            "SELECT domains FROM ideas WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 5",
            workspace_id
        )

    task_map = {r["status"]: r["cnt"] for r in task_stats}
    result = {
        "knowledge_count": knowledge_count,
        "knowledge": [{"title": r["title"], "summary": r["summary"]} for r in knowledge_titles],
        "projects": [{"title": r["title"], "status": r["status"]} for r in projects],
        "tasks": task_map,
        "ideas": [r["domains"] for r in ideas],
    }

    await cache_set(cache_key, result, ttl=300)
    return result

def build_copilot_system(summary: Dict[str, Any]) -> str:
    k_list = "\n".join(
        f"  - {k['title']}: {(k['summary'] or '')[:80]}"
        for k in summary["knowledge"]
    )
    p_list = "\n".join(
        f"  - {p['title']} [{p['status']}]"
        for p in summary["projects"]
    )
    t = summary["tasks"]
    active = t.get("in_progress", 0) + t.get("todo", 0)
    completed = t.get("completed", 0)
    blocked = t.get("blocked", 0)

    return f"""You are FORGE COPILOT, the operations intelligence of THE FOUNDRY by h3ros.
You have complete situational awareness of the builder's workspace.
Be precise and direct (under 200 words), use ## headers, reference actual items by name.
Speak like a sharp, experienced operator — not a generic AI.
Always end with one decisive next action.

FOUNDRY STATE:
Archive ({summary['knowledge_count']} entries):
{k_list or '  (empty)'}

Workshop ({len(summary['projects'])} builds):
{p_list or '  (none)'}

Crucible: {', '.join(summary['ideas']) or '(none)'}
Runsheet: {active} active, {completed} completed, {blocked} blocked"""

async def build_project_copilot_system(project_id: str, workspace_id: str) -> str:
    """Build a project-specific system prompt with full project context."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        project = await conn.fetchrow(
            "SELECT title, status, plan, notes FROM projects WHERE id=$1 AND workspace_id=$2",
            project_id, workspace_id,
        )
        if not project:
            return build_copilot_system(await get_workspace_summary(workspace_id))

        tasks = await conn.fetch(
            "SELECT title, status, description FROM tasks WHERE project_id=$1 ORDER BY created_at",
            project_id,
        )
        knowledge = await conn.fetch(
            "SELECT title, summary FROM knowledge_items WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 5",
            workspace_id,
        )

    task_list = "\n".join(
        f"  - [{t['status']}] {t['title']}" + (f": {t['description'][:80]}" if t['description'] else "")
        for t in tasks
    ) or "  (no tasks yet)"

    k_list = "\n".join(
        f"  - {k['title']}: {(k['summary'] or '')[:60]}"
        for k in knowledge
    ) or "  (none)"

    plan_excerpt = (project["plan"] or "")[:3000]
    notes_excerpt = (project["notes"] or "")[:1000]

    return f"""You are FORGE COPILOT, embedded in project "{project['title']}" [{project['status']}].
You have full context of this project's plan, tasks, and notes.
Help the builder refine their plan, suggest next steps, answer questions, and draft content.
Be specific — reference actual tasks and plan sections by name.
Keep responses under 300 words. Use ## headers. End with one decisive next action.

PROJECT PLAN:
{plan_excerpt or '(no plan generated yet)'}

PROJECT NOTES:
{notes_excerpt or '(no notes yet)'}

TASKS:
{task_list}

RELATED KNOWLEDGE:
{k_list}"""


async def generate_insights(workspace_id: str) -> str:
    summary = await get_workspace_summary(workspace_id)
    prompt = f"""Workspace State:
- Archive: {summary['knowledge_count']} knowledge items
- Knowledge titles: {[k['title'] for k in summary['knowledge']]}
- Projects: {[p['title'] + ' [' + p['status'] + ']' for p in summary['projects']]}
- Ideas: {summary['ideas']}
- Tasks: {summary['tasks']}

Generate 4 insights about this workspace."""
    return await complete_claude(INSIGHT_SYSTEM, prompt, max_tokens=1200)
