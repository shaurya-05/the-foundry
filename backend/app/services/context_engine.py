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
    """Fetch deep workspace context — tasks, projects, knowledge, ideas, activity."""
    cache_key = f"ws_summary:{workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        # Knowledge — titles, summaries, and content excerpts
        knowledge_count = await conn.fetchval(
            "SELECT COUNT(*) FROM knowledge_items WHERE workspace_id=$1", workspace_id
        )
        knowledge_items = await conn.fetch(
            """SELECT title, summary, LEFT(content, 150) as excerpt, type, tags
               FROM knowledge_items WHERE workspace_id=$1
               ORDER BY created_at DESC LIMIT 15""",
            workspace_id
        )

        # Projects — with plan and notes excerpts
        projects = await conn.fetch(
            """SELECT id, title, status, LEFT(plan, 200) as plan_excerpt,
                      LEFT(notes, 200) as notes_excerpt
               FROM projects WHERE workspace_id=$1
               ORDER BY created_at DESC LIMIT 10""",
            workspace_id
        )

        # Tasks — individual open tasks with priority and due dates
        open_tasks = await conn.fetch(
            """SELECT title, status, priority, due_date, description,
                      (SELECT title FROM projects WHERE id=tasks.project_id) as project_name
               FROM tasks WHERE workspace_id=$1 AND status NOT IN ('completed')
               ORDER BY
                 CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                               WHEN 'medium' THEN 2 ELSE 3 END,
                 due_date NULLS LAST
               LIMIT 20""",
            workspace_id
        )

        # Task stats for overview
        task_stats = await conn.fetch(
            "SELECT status, COUNT(*) as cnt FROM tasks WHERE workspace_id=$1 GROUP BY status",
            workspace_id
        )

        # Ideas — domains and content
        ideas = await conn.fetch(
            """SELECT domains, LEFT(content, 200) as excerpt, metadata
               FROM ideas WHERE workspace_id=$1
               ORDER BY created_at DESC LIMIT 8""",
            workspace_id
        )

        # Recent activity — last 15 events
        activity = await conn.fetch(
            """SELECT type, title, created_at
               FROM activity_events WHERE workspace_id=$1
               ORDER BY created_at DESC LIMIT 15""",
            workspace_id
        )

    task_map = {r["status"]: r["cnt"] for r in task_stats}
    result = {
        "knowledge_count": knowledge_count,
        "knowledge": [
            {"title": r["title"], "summary": r["summary"], "excerpt": r["excerpt"],
             "type": r["type"], "tags": r["tags"]}
            for r in knowledge_items
        ],
        "projects": [
            {"id": str(r["id"]), "title": r["title"], "status": r["status"],
             "plan_excerpt": r["plan_excerpt"], "notes_excerpt": r["notes_excerpt"]}
            for r in projects
        ],
        "open_tasks": [
            {"title": r["title"], "status": r["status"], "priority": r["priority"],
             "due_date": r["due_date"].isoformat() if r["due_date"] else None,
             "description": (r["description"] or "")[:80],
             "project": r["project_name"]}
            for r in open_tasks
        ],
        "tasks": task_map,
        "ideas": [
            {"domains": r["domains"], "excerpt": r["excerpt"],
             "has_swot": bool(r["metadata"] and r["metadata"].get("swot"))}
            for r in ideas
        ],
        "activity": [
            {"type": r["type"], "title": r["title"],
             "time": r["created_at"].isoformat() if r["created_at"] else None}
            for r in activity
        ],
    }

    await cache_set(cache_key, result, ttl=300)
    return result


def build_copilot_system(summary: Dict[str, Any]) -> str:
    """Build a deep-context system prompt for the copilot."""

    # Knowledge section
    k_list = "\n".join(
        f"  - [{k.get('type','note')}] {k['title']}: {(k.get('summary') or k.get('excerpt') or '')[:100]}"
        for k in summary["knowledge"]
    ) or "  (empty)"

    # Projects section — with plan excerpts
    p_list = "\n".join(
        f"  - {p['title']} [{p['status']}]" +
        (f"\n    Plan: {p['plan_excerpt'][:150]}..." if p.get('plan_excerpt') else "")
        for p in summary["projects"]
    ) or "  (none)"

    # Open tasks — individual items with priority
    t_list = "\n".join(
        f"  - [{t['priority'] or 'medium'}] {t['title']} ({t['status']})" +
        (f" — due {t['due_date']}" if t.get('due_date') else "") +
        (f" [project: {t['project']}]" if t.get('project') else "") +
        (f"\n    {t['description']}" if t.get('description') else "")
        for t in summary.get("open_tasks", [])
    ) or "  (none)"

    # Task overview stats
    t = summary["tasks"]
    total = sum(t.values())
    active = t.get("in_progress", 0) + t.get("todo", 0) + t.get("backlog", 0)
    completed = t.get("completed", 0)
    blocked = t.get("blocked", 0)
    in_review = t.get("in_review", 0)

    # Ideas section
    i_list = "\n".join(
        f"  - {i['domains']}: {(i.get('excerpt') or '')[:120]}" +
        (" [SWOT done]" if i.get('has_swot') else "")
        for i in summary.get("ideas", [])
    ) or "  (none)"

    # Recent activity
    a_list = "\n".join(
        f"  - {a['type']}: {a['title']}"
        for a in summary.get("activity", [])[:10]
    ) or "  (none)"

    return f"""You are COFOUND3R, the operations intelligence of THE FOUNDRY by h3ros.
You have COMPLETE situational awareness of the builder's workspace — every project, task, knowledge item, and idea.
Your job: help them build faster. Be precise, reference items BY NAME, and always end with one decisive next action.

Keep responses under 250 words. Use ## headers. Speak like a sharp, experienced operator.

═══ WORKSPACE STATE ═══

ARCHIVE ({summary['knowledge_count']} knowledge items):
{k_list}

WORKSHOP ({len(summary['projects'])} projects):
{p_list}

RUNSHEET ({total} tasks: {active} active, {completed} done, {blocked} blocked, {in_review} in review):
{t_list}

CRUCIBLE ({len(summary.get('ideas', []))} ideas):
{i_list}

RECENT ACTIVITY:
{a_list}"""


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
            """SELECT title, status, priority, description, due_date
               FROM tasks WHERE project_id=$1
               ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                                      WHEN 'medium' THEN 2 ELSE 3 END, created_at""",
            project_id,
        )
        knowledge = await conn.fetch(
            "SELECT title, summary FROM knowledge_items WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 5",
            workspace_id,
        )

    task_list = "\n".join(
        f"  - [{t['priority'] or 'medium'}] [{t['status']}] {t['title']}" +
        (f": {t['description'][:80]}" if t['description'] else "") +
        (f" (due {t['due_date']})" if t['due_date'] else "")
        for t in tasks
    ) or "  (no tasks yet)"

    k_list = "\n".join(
        f"  - {k['title']}: {(k['summary'] or '')[:60]}"
        for k in knowledge
    ) or "  (none)"

    plan_excerpt = (project["plan"] or "")[:3000]
    notes_excerpt = (project["notes"] or "")[:1000]

    return f"""You are COFOUND3R, embedded in project "{project['title']}" [{project['status']}].
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
- Knowledge: {[k['title'] for k in summary['knowledge']]}
- Projects: {[p['title'] + ' [' + p['status'] + ']' for p in summary['projects']]}
- Open tasks: {[t['title'] + ' [' + (t['priority'] or 'medium') + ']' for t in summary.get('open_tasks', [])[:10]]}
- Ideas: {[i['domains'] for i in summary.get('ideas', [])]}
- Recent activity: {[a['title'] for a in summary.get('activity', [])[:5]]}

Generate 4 insights about this workspace."""
    return await complete_claude(INSIGHT_SYSTEM, prompt, max_tokens=1200)
