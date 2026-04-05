import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.models.schemas import IdeaCreate, IdeaForgeRequest, Idea
from app.db.postgres import get_pool
from app.services.claude import stream_sse
from app.services.graph import upsert_idea_node
from app.dependencies import AuthContext, require_auth, RequireUsage

router = APIRouter(prefix="/api/ideas", tags=["ideas"])

IDEA_SYSTEM = """You are a creative innovation strategist. Generate 3 distinct, concrete startup or project ideas for the given domain.

For each idea use this format:
## [Idea Name]
**One-line pitch:** (single sentence)
**Core problem solved:** (1-2 sentences)
**Unique insight or mechanism:** (what makes this different)
**Why now (market timing):** (why this is the right moment)

Be specific, not generic. Each idea should be meaningfully different from the others."""

@router.post("")
async def create_idea(req: IdeaCreate, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO ideas (workspace_id, user_id, domains, content)
               VALUES ($1, $2, $3, $4) RETURNING *""",
            auth.workspace_id, auth.user_id, req.domains, req.content
        )
        await conn.execute(
            """INSERT INTO activity_events (workspace_id, user_id, type, title, entity_type, entity_id)
               VALUES ($1, $2, 'idea_generated', $3, 'idea', $4)""",
            auth.workspace_id, auth.user_id, f"Ideas forged: {req.domains[:60]}", str(row["id"])
        )
        try:
            await upsert_idea_node(str(row["id"]), req.domains, auth.workspace_id)
        except Exception:
            pass
        return _row_to_idea(row)

@router.get("")
async def list_ideas(auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM ideas WHERE workspace_id=$1 ORDER BY created_at DESC",
            auth.workspace_id
        )
        return [_row_to_idea(r) for r in rows]

@router.delete("/{idea_id}")
async def delete_idea(idea_id: str, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM ideas WHERE id=$1 AND workspace_id=$2",
            idea_id, auth.workspace_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}

@router.post("/forge")
async def forge_ideas(req: IdeaForgeRequest, auth: AuthContext = Depends(RequireUsage("forge_operations"))):
    from app.services.usage import increment_usage
    await increment_usage(auth.workspace_id, "forge_operations")
    pool = await get_pool()

    async def stream_and_save():
        full_output = []
        async for chunk in stream_sse(IDEA_SYSTEM, f"Domain/problem space: {req.domains}", max_tokens=1500):
            full_output.append(chunk)
            yield chunk
        output_text = "".join(full_output)
        lines = output_text.split("\n")
        content = "".join(l[6:] for l in lines if l.startswith("data: ") and l != "data: [DONE]")
        if content:
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO forge_outputs (workspace_id, user_id, type, input, output) VALUES ($1, $2, 'idea_forge', $3, $4)",
                    auth.workspace_id, auth.user_id, req.domains, content,
                )

    return StreamingResponse(
        stream_and_save(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

def _row_to_idea(row) -> Idea:
    return Idea(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        user_id=str(row["user_id"]),
        domains=row["domains"],
        content=row["content"],
        visibility=row["visibility"] if "visibility" in row.keys() else "private",
        clearance_level=row["clearance_level"] if "clearance_level" in row.keys() else 0,
        metadata=(json.loads(row["metadata"]) if isinstance(row["metadata"], str) else dict(row["metadata"])) if row["metadata"] else {},
        created_at=row["created_at"],
    )
