from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.models.schemas import CopilotMessage, IntentRequest, IntentResponse
from app.services.claude import stream_sse
from app.services.context_engine import get_workspace_summary, build_copilot_system
from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth, RequireUsage
import re

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
async def copilot_message(req: CopilotMessage, auth: AuthContext = Depends(RequireUsage("copilot_messages"))):
    from app.services.usage import increment_usage
    await increment_usage(auth.workspace_id, "copilot_messages")

    # Save user message
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO copilot_messages (workspace_id, user_id, role, content) VALUES ($1, $2, 'user', $3)",
            auth.workspace_id, auth.user_id, req.message,
        )

    summary = await get_workspace_summary(auth.workspace_id)
    system = build_copilot_system(summary)

    async def stream_and_save():
        full_output = []
        async for chunk in stream_sse(system, req.message, max_tokens=500):
            full_output.append(chunk)
            yield chunk
        # Save assistant response after stream completes
        output_text = "".join(full_output)
        # Extract text content from SSE format
        lines = output_text.split("\n")
        content_parts = []
        for line in lines:
            if line.startswith("data: ") and line != "data: [DONE]":
                content_parts.append(line[6:])
        assistant_text = "".join(content_parts)
        if assistant_text:
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO copilot_messages (workspace_id, user_id, role, content) VALUES ($1, $2, 'assistant', $3)",
                    auth.workspace_id, auth.user_id, assistant_text,
                )

    return StreamingResponse(
        stream_and_save(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/history")
async def get_copilot_history(limit: int = 50, auth: AuthContext = Depends(require_auth)):
    """Returns recent copilot conversation history."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, role, content, created_at FROM copilot_messages
               WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT $2""",
            auth.workspace_id, limit,
        )
        return [
            {"id": str(r["id"]), "role": r["role"], "content": r["content"], "created_at": r["created_at"].isoformat()}
            for r in reversed(rows)  # Return oldest first for chat display
        ]


@router.post("/intent", response_model=IntentResponse)
async def classify_intent(req: IntentRequest, auth: AuthContext = Depends(require_auth)):
    msg = req.message.lower()
    for pattern, intent in INTENT_PATTERNS:
        if re.search(pattern, msg):
            return IntentResponse(intent=intent, confidence=0.9)
    return IntentResponse(intent="query", confidence=0.7)
