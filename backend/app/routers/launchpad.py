from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.models.schemas import LaunchBriefRequest
from app.services.claude import stream_sse
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
    await increment_usage(auth.workspace_id, "forge_operations")
    return StreamingResponse(
        stream_sse(LAUNCH_BRIEF_SYSTEM, f"Concept: {req.concept}", max_tokens=1800),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
