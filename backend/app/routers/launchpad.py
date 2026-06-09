import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.models.schemas import LaunchBriefRequest
from app.services.claude import stream_claude
from app.dependencies import AuthContext, require_auth, RequireUsage

router = APIRouter(prefix="/api/launchpad", tags=["launchpad"])

LAUNCH_BRIEF_SYSTEM = """You are a YC-level startup advisor. Generate a comprehensive launch brief.
Include:

## The Pitch
(2 sentences — elevator pitch)

## The Problem
(specific problem being solved)

## The Solution
(how this product solves it)

## Target Market
(TAM estimate with reasoning)

## MVP Feature Set
(Phase 1 only — max 5 features, bullet points)

## Go-To-Market Strategy
(first 90 days tactical plan)

## Key Metrics
(90-day targets — specific numbers)

## Funding Path
(bootstrapped/pre-seed/seed recommendation with reasoning)

Be specific and direct — no filler. Every section should have actionable information."""

@router.post("/forge-brief")
async def forge_launch_brief(req: LaunchBriefRequest, auth: AuthContext = Depends(RequireUsage("forge_operations"))):
    from app.services.usage import increment_usage
    from app.db.postgres import get_pool
    await increment_usage(auth.workspace_id, "forge_operations")
    pool = await get_pool()

    async def stream_and_save():
        output_text = ""
        async for text in stream_claude(LAUNCH_BRIEF_SYSTEM, f"Concept: {req.concept}", max_tokens=1800):
            output_text += text
            yield f"data: {json.dumps({'type': 'text_delta', 'text': text})}\n\n"
        content = output_text
        if content:
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO forge_outputs (workspace_id, user_id, type, input, output) VALUES ($1, $2, 'launch_brief', $3, $4)",
                    auth.workspace_id, auth.user_id, req.concept, content,
                )

    return StreamingResponse(
        stream_and_save(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
