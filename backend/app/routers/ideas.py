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

SWOT_SYSTEM = """You are a strategic analyst evaluating a startup/project idea. Generate a thorough SWOT analysis.

Format:
## Strengths
(3-4 internal advantages this idea has)

## Weaknesses
(3-4 internal limitations or challenges)

## Opportunities
(3-4 external factors to capitalize on)

## Threats
(3-4 external risks to watch for)

## Overall Score: X/10
One-sentence justification for the score.

## Recommended Next Step
One specific, actionable recommendation.

Be specific to THIS idea. Reference real market dynamics, technologies, and competitive realities. Don't be generic."""


@router.post("/{idea_id}/swot")
async def generate_swot(idea_id: str, auth: AuthContext = Depends(require_auth)):
    """Stream a SWOT analysis for a saved idea."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        idea = await conn.fetchrow(
            "SELECT * FROM ideas WHERE id=$1 AND workspace_id=$2",
            idea_id, auth.workspace_id,
        )
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")

    user_prompt = f"Idea domain: {idea['domains']}\n\nIdea content:\n{idea['content'][:4000]}"

    async def stream_and_save():
        full_output = []
        async for chunk in stream_sse(SWOT_SYSTEM, user_prompt, max_tokens=1500):
            full_output.append(chunk)
            yield chunk

        # Save SWOT to metadata
        import json as _json
        text_parts = []
        for line in full_output:
            if isinstance(line, str) and line.startswith("data: ") and line != "data: [DONE]":
                try:
                    data = _json.loads(line[6:])
                    if data.get("type") == "text_delta":
                        text_parts.append(data.get("text", ""))
                except Exception:
                    pass
        swot_text = "".join(text_parts)
        if swot_text:
            from datetime import datetime
            existing_meta = idea["metadata"] if isinstance(idea["metadata"], dict) else {}
            existing_meta["swot"] = swot_text
            existing_meta["swot_generated_at"] = datetime.utcnow().isoformat()
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE ideas SET metadata=$2 WHERE id=$1",
                    idea_id, _json.dumps(existing_meta),
                )
                await conn.execute(
                    """INSERT INTO activity_events (workspace_id, user_id, type, title, entity_type, entity_id)
                       VALUES ($1, $2, 'swot_generated', $3, 'idea', $4)""",
                    auth.workspace_id, auth.user_id, f"SWOT analysis: {idea['domains'][:60]}", idea_id,
                )

    return StreamingResponse(
        stream_and_save(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{idea_id}/swot")
async def get_swot(idea_id: str, auth: AuthContext = Depends(require_auth)):
    """Return cached SWOT analysis if it exists."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        idea = await conn.fetchrow(
            "SELECT metadata FROM ideas WHERE id=$1 AND workspace_id=$2",
            idea_id, auth.workspace_id,
        )
    if not idea:
        raise HTTPException(status_code=404, detail="Idea not found")
    meta = idea["metadata"] if isinstance(idea["metadata"], dict) else {}
    if "swot" not in meta:
        raise HTTPException(status_code=404, detail="No SWOT analysis yet")
    return {"swot": meta["swot"], "swot_generated_at": meta.get("swot_generated_at")}


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
