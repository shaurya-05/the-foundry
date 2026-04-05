from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from app.db.postgres import get_pool
from app.services.context_engine import generate_insights
from app.services.graph import get_connections
from app.services.claude import stream_sse
from app.dependencies import AuthContext, require_auth

router = APIRouter(prefix="/api/context", tags=["context"])

SCAN_SYSTEM = """You are a system awareness engine for THE FOUNDRY. Analyze the workspace and generate 4 precise insights.
Each must: name a pattern or connection, explain its significance, recommend one specific action.
Use ## for each insight heading. Reference actual items by name. Use precise, system-level language."""

@router.get("/insights")
async def get_insights(auth: AuthContext = Depends(require_auth)):
    result = await generate_insights(auth.workspace_id)
    return {"insights": result}

@router.post("/insights/stream")
async def stream_insights(auth: AuthContext = Depends(require_auth)):
    from app.services.context_engine import get_workspace_summary
    summary = await get_workspace_summary(auth.workspace_id)
    prompt = f"""Workspace: {len(summary['knowledge'])} knowledge items, {len(summary['projects'])} projects, {summary['ideas']} ideas.
Items: {[k['title'] for k in summary['knowledge']]}
Projects: {[p['title'] for p in summary['projects']]}
Generate 4 insights."""
    return StreamingResponse(
        stream_sse(SCAN_SYSTEM, prompt, max_tokens=1200),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.get("/connections")
async def get_graph_connections(auth: AuthContext = Depends(require_auth)):
    connections = await get_connections(auth.workspace_id)
    return {"connections": connections}

@router.get("/timeline")
async def get_timeline(limit: int = 50, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT * FROM activity_events
               WHERE workspace_id=$1
               ORDER BY created_at DESC
               LIMIT $2""",
            auth.workspace_id, limit
        )
        events = []
        for r in rows:
            events.append({
                "id": str(r["id"]),
                "type": r["type"],
                "title": r["title"],
                "detail": r["detail"],
                "entity_type": r["entity_type"],
                "entity_id": str(r["entity_id"]) if r["entity_id"] else None,
                "created_at": r["created_at"].isoformat(),
            })
        return {"events": events}
