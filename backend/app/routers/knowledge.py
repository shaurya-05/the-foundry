from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.models.schemas import KnowledgeCreate, KnowledgeItem, KnowledgeQueryRequest
from app.db.postgres import get_pool
from app.services.claude import stream_sse, complete_claude
from app.services.embeddings import embed_text
from app.services.graph import upsert_knowledge_node
from app.dependencies import AuthContext, require_auth
import json

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

SUMMARY_SYSTEM = "You are an expert analyst. Generate a concise 2-3 sentence summary of the following content. Focus on the core insight or main points."

QUERY_SYSTEM = """You are an expert analyst. Based ONLY on the following knowledge:

{content}

Answer the user's question precisely and cite specific parts of the source."""

async def log_activity(conn, workspace_id: str, user_id: str, type: str, title: str, detail: str = None, entity_id: str = None):
    await conn.execute(
        """INSERT INTO activity_events (workspace_id, user_id, type, title, detail, entity_type, entity_id)
           VALUES ($1, $2, $3, $4, $5, 'knowledge', $6)""",
        workspace_id, user_id, type, title, detail, entity_id
    )

@router.post("", response_model=KnowledgeItem)
async def create_knowledge(item: KnowledgeCreate, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    summary = await complete_claude(
        SUMMARY_SYSTEM,
        item.content[:3000],
        max_tokens=200,
    )
    embedding = await embed_text(item.title + " " + item.content[:2000])

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO knowledge_items
               (workspace_id, user_id, title, content, summary, type, tags, embedding, source_url)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9)
               RETURNING *""",
            auth.workspace_id, auth.user_id,
            item.title, item.content, summary, item.type,
            item.tags or [], str(embedding), item.source_url
        )
        await log_activity(
            conn, auth.workspace_id, auth.user_id,
            "knowledge_added", f"Added: {item.title}",
            summary[:100] if summary else None, str(row["id"])
        )
        try:
            await upsert_knowledge_node(str(row["id"]), item.title, item.type, auth.workspace_id)
        except Exception:
            pass
        from app.db.cache import cache_invalidate
        await cache_invalidate(f"knowledge_list:{auth.workspace_id}", f"ws_summary:{auth.workspace_id}")
        return _row_to_knowledge(row)

@router.get("", response_model=list[KnowledgeItem])
async def list_knowledge(auth: AuthContext = Depends(require_auth)):
    from app.db.cache import cache_get, cache_set
    cache_key = f"knowledge_list:{auth.workspace_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, workspace_id, user_id, title, summary, type, source_url,
                      content, tags, visibility, metadata, created_at
               FROM knowledge_items WHERE workspace_id=$1 ORDER BY created_at DESC""",
            auth.workspace_id
        )
        result = [_row_to_knowledge(r).model_dump(mode='json') for r in rows]
        await cache_set(cache_key, result, ttl=300)
        return result

@router.delete("/{item_id}")
async def delete_knowledge(item_id: str, auth: AuthContext = Depends(require_auth)):
    from app.db.cache import cache_invalidate
    pool = await get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM knowledge_items WHERE id=$1 AND workspace_id=$2",
            item_id, auth.workspace_id
        )
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Not found")
    await cache_invalidate(f"knowledge_list:{auth.workspace_id}", f"ws_summary:{auth.workspace_id}")
    return {"ok": True}

@router.post("/{item_id}/query")
async def query_knowledge(item_id: str, req: KnowledgeQueryRequest, auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM knowledge_items WHERE id=$1 AND workspace_id=$2",
            item_id, auth.workspace_id
        )
    if not row:
        raise HTTPException(status_code=404, detail="Not found")

    system = QUERY_SYSTEM.format(content=row["content"][:6000])
    return StreamingResponse(
        stream_sse(system, req.question, max_tokens=1200),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.get("/semantic-search")
async def semantic_search(q: str, limit: int = 10, auth: AuthContext = Depends(require_auth)):
    """Semantic similarity search using pgvector embeddings."""
    if not q.strip():
        return []
    from app.services.embeddings import embed_text
    query_embedding = await embed_text(q)
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, title, summary, type, tags, source_url, content, created_at,
                      1 - (embedding <=> $2::vector) AS similarity
               FROM knowledge_items
               WHERE workspace_id=$1 AND embedding IS NOT NULL
                 AND 1 - (embedding <=> $2::vector) > 0.3
               ORDER BY embedding <=> $2::vector
               LIMIT $3""",
            auth.workspace_id, str(query_embedding), min(limit, 20)
        )
    return [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "summary": r["summary"],
            "type": r["type"],
            "tags": r["tags"],
            "excerpt": (r["content"] or "")[:200],
            "similarity": round(float(r["similarity"]), 3),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


@router.get("/search")
async def search_knowledge(q: str = "", type: str = "", auth: AuthContext = Depends(require_auth)):
    pool = await get_pool()
    async with pool.acquire() as conn:
        if not q:
            rows = await conn.fetch(
                "SELECT * FROM knowledge_items WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20",
                auth.workspace_id
            )
        else:
            rows = await conn.fetch(
                """SELECT *, ts_rank(to_tsvector('english', title || ' ' || content),
                   plainto_tsquery('english', $2)) AS rank
                   FROM knowledge_items
                   WHERE workspace_id=$1
                   AND to_tsvector('english', title || ' ' || content) @@ plainto_tsquery('english', $2)
                   ORDER BY rank DESC LIMIT 20""",
                auth.workspace_id, q
            )
    results = [_row_to_knowledge(r) for r in rows]
    if type:
        results = [r for r in results if r.type == type]
    return results

def _row_to_knowledge(row) -> KnowledgeItem:
    return KnowledgeItem(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        user_id=str(row["user_id"]),
        title=row["title"],
        content=row["content"],
        summary=row["summary"],
        type=row["type"],
        tags=row["tags"] or [],
        source_url=row["source_url"],
        visibility=row["visibility"] if "visibility" in row.keys() else "team",
        metadata=(json.loads(row["metadata"]) if isinstance(row["metadata"], str) else dict(row["metadata"])) if row["metadata"] else {},
        created_at=row["created_at"],
    )
