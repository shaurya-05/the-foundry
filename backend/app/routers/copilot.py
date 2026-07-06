import asyncio
import json
import re
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.models.schemas import CopilotMessage, IntentRequest, IntentResponse
from app.services.claude import stream_claude
from app.services.ai_router import route_query, get_council_perspectives
from app.services.context_engine import get_workspace_summary, build_copilot_system, build_project_copilot_system
from app.services.usage import check_limit, increment_usage
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth

log = structlog.get_logger()

# Max time we wait AFTER the primary answer completes for the council task
# to finish. Council is fire-and-forget from the primary stream's POV —
# never blocks a text_delta yield.
COUNCIL_WAIT_S = 10.0

router = APIRouter(prefix="/api/copilot", tags=["copilot"])

INTENT_PATTERNS = [
    (r"\b(run|use|deploy|launch)\s+(field analyst|systems architect|market scout|launch strategist)\b", "run_agent"),
    (r"\b(run|start|execute)\s+(pipeline|deep recon|launch readiness|full forge|blueprint)\b", "run_pipeline"),
    (r"\b(create|add|make)\s+(a\s+)?(task|todo)\b", "create_task"),
    (r"\b(create|start|new)\s+(a\s+)?(project|build)\b", "create_project"),
    (r"\b(go to|open|navigate|show me)\s+(knowledge|archive|projects|workshop|ideas|crucible|tasks|runsheet|agents|crew|workspace|blueprint|launchpad|context|signal)\b", "navigate"),
    (r"\b(status|overview|how many|what's in|workspace)\b", "workspace_status"),
    (r"\b(find|search|connect|link|related|relationship)\b", "find_connections"),
    (r"\b(analyze|deep dive|review|breakdown|evaluate)\s+(project|build)\b", "analyze_project"),
]

@router.post("/message")
async def copilot_message(req: CopilotMessage, auth: AuthContext = Depends(require_auth)):
    if not await check_limit(auth.workspace_id, 'copilot_messages'):
        raise HTTPException(
            status_code=429,
            detail={'error': 'limit_exceeded', 'plan': 'spark', 'upgrade_url': '/billing/upgrade'},
        )

    pool = await get_pool()

    # Save user message
    import uuid as _uuid
    thread_id = req.thread_id or str(_uuid.uuid4())
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO copilot_messages (workspace_id, user_id, role, content, project_id, thread_id) VALUES ($1, $2, 'user', $3, $4, $5)",
            auth.workspace_id, auth.user_id, req.message, req.project_id, thread_id,
        )

    # Build context — project-specific or workspace-level
    if req.project_id:
        system = await build_project_copilot_system(req.project_id, auth.workspace_id)
    else:
        summary = await get_workspace_summary(auth.workspace_id)
        system = build_copilot_system(summary)

    async def stream_and_save():
        await increment_usage(auth.workspace_id, 'copilot_messages')
        full_text = []
        model_used = "claude-sonnet-4"
        first = True

        # Emit thread_id first so frontend can track it
        yield f"data: {json.dumps({'type': 'thread_id', 'thread_id': thread_id})}\n\n"

        # Kick off the council in the background. It runs alongside the
        # primary answer so the total wall-clock is max(primary, council)
        # not sum. Was previously `await`-ed which blocked the SSE stream
        # and produced empty responses — that regression is dead.
        council_task = asyncio.create_task(
            get_council_perspectives(system, req.message)
        )

        async for chunk in route_query(system, req.message, max_tokens=1200, model_override=req.model_override):
            if first:
                model_used = chunk
                first = False
                yield f"data: {json.dumps({'type': 'model_used', 'model': model_used})}\n\n"
                continue
            full_text.append(chunk)
            payload = json.dumps({"type": "text_delta", "text": chunk})
            yield f"data: {payload}\n\n"

        # Primary is done. Give council a bounded window to finish, then
        # move on. We don't want a slow council keeping the SSE stream
        # open indefinitely.
        try:
            if not council_task.done():
                yield f"data: {json.dumps({'type': 'status', 'text': 'gathering second opinions...'})}\n\n"
            perspectives = await asyncio.wait_for(council_task, timeout=COUNCIL_WAIT_S)
            if perspectives:
                yield f"data: {json.dumps({'type': 'council', 'perspectives': perspectives})}\n\n"
        except asyncio.TimeoutError:
            log.info("council_timeout", thread_id=thread_id, wait_s=COUNCIL_WAIT_S)
            council_task.cancel()
        except Exception as e:
            log.warning("council_error", thread_id=thread_id, error=str(e)[:200])

        yield 'data: {"type": "done"}\n\n'
        assistant_text = "".join(full_text)
        if assistant_text:
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO copilot_messages (workspace_id, user_id, role, content, project_id, model_used, thread_id) VALUES ($1, $2, 'assistant', $3, $4, $5, $6)",
                    auth.workspace_id, auth.user_id, assistant_text, req.project_id, model_used, thread_id,
                )

    return StreamingResponse(
        stream_and_save(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/history")
async def get_copilot_history(
    project_id: Optional[str] = Query(None),
    limit: int = 50,
    auth: AuthContext = Depends(require_auth),
):
    """Returns copilot conversation history. Filter by project_id for per-project chat."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        if project_id:
            rows = await conn.fetch(
                """SELECT id, role, content, created_at FROM copilot_messages
                   WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT $3""",
                auth.workspace_id, project_id, limit,
            )
        else:
            rows = await conn.fetch(
                """SELECT id, role, content, created_at FROM copilot_messages
                   WHERE workspace_id=$1 AND project_id IS NULL ORDER BY created_at DESC LIMIT $2""",
                auth.workspace_id, limit,
            )
        return [
            {"id": str(r["id"]), "role": r["role"], "content": r["content"], "created_at": r["created_at"].isoformat()}
            for r in reversed(rows)
        ]


@router.post("/intent", response_model=IntentResponse)
async def classify_intent(req: IntentRequest, auth: AuthContext = Depends(require_auth)):
    msg = req.message.lower()
    for pattern, intent in INTENT_PATTERNS:
        if re.search(pattern, msg):
            return IntentResponse(intent=intent, confidence=0.9)
    return IntentResponse(intent="query", confidence=0.7)

@router.get("/threads")
async def get_threads(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT ON (thread_id) thread_id as id,
                   SUBSTRING(content, 1, 60) as title,
                   created_at
            FROM copilot_messages
            WHERE workspace_id=$1 AND role='user' AND thread_id IS NOT NULL
            ORDER BY thread_id, created_at ASC
            """,
            auth.workspace_id,
        )
    return [{"id": str(r["id"]), "title": r["title"] or "Untitled", "created_at": r["created_at"].isoformat()} for r in rows]

@router.post("/save-to-drive")
async def save_to_drive(req: dict, auth: AuthContext = Depends(require_auth)):
    """Save a COFOUND3R response to Google Drive as a Doc."""
    from app.services.google_drive import create_doc
    title = req.get("title", "COFOUND3R Response")
    content = req.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="No content to save")
    try:
        result = await create_doc(auth.workspace_id, auth.user_id, title, content)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
