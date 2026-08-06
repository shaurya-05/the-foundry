"""
Real retrieval for the DOCUMENT tier, over the one table that actually
has data: knowledge_items (the `docs` table, tied to GitHub/Notion sync,
is empty on this deployment -- no connectors have ever been connected,
so there's nothing to retrieve from there; see the trust-gap comment in
ai_router.py for why DOCUMENT previously had zero retrieval behind it).

Same cosine-similarity pattern as
backend/app/routers/knowledge.py:118-149's /semantic-search endpoint --
factored out here so the DOCUMENT AI-routing tier can reuse it without
going through the router.
"""
import json
import math
import os
from typing import Optional

import structlog

from app.db.postgres import get_pool
from app.services.embeddings import embed_text

log = structlog.get_logger()

# Postgres/pgvector pushes the cosine-similarity computation into the DB
# (indexed, efficient at any real scale) via the <=> operator -- that
# path is unchanged below and still what the found3ry.com deployment
# uses. SQLite has no equivalent extension loaded (see schema.sql's
# comment on why sqlite-vec was deliberately skipped), so for the
# desktop build this computes cosine similarity in plain Python over
# every embedded row in the workspace. Fine at the realistic scale of a
# personal knowledge base (hundreds to low-thousands of rows); would
# need revisiting if that assumption ever stops holding.
_BACKEND = os.getenv("DATABASE_BACKEND", "postgres")

SIMILARITY_THRESHOLD = 0.3
MAX_CONTEXT_CHARS = 2500  # keeps injected context well within the local
                          # models' 4096-token window alongside the system
                          # prompt, history, and the question itself.


def is_configured() -> bool:
    return bool(os.getenv("VOYAGE_API_KEY"))


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


async def _sqlite_similarity_search(
    pool, workspace_id: str, query_embedding: list[float], limit: int,
) -> list[dict]:
    """Brute-force equivalent of the pgvector query above -- fetch every
    embedded row for the workspace, score in Python, keep the same
    threshold/ordering/limit semantics as the Postgres path."""
    async with pool.acquire() as conn:
        raw_rows = await conn.fetch(
            """SELECT title, summary, content, embedding
               FROM knowledge_items
               WHERE workspace_id=$1 AND embedding IS NOT NULL""",
            workspace_id,
        )

    scored = []
    for r in raw_rows:
        try:
            row_embedding = json.loads(r["embedding"])
        except (TypeError, ValueError):
            continue
        similarity = _cosine_similarity(query_embedding, row_embedding)
        if similarity > SIMILARITY_THRESHOLD:
            scored.append({
                "title": r["title"], "summary": r["summary"], "content": r["content"],
                "similarity": similarity,
            })

    scored.sort(key=lambda x: x["similarity"], reverse=True)
    return scored[:limit]


async def retrieve_context(workspace_id: str, query: str, limit: int = 5) -> Optional[str]:
    """
    Returns a formatted context block of the most relevant knowledge_items
    for this query, or None if retrieval is unavailable (no VOYAGE_API_KEY)
    or nothing scored above the similarity threshold. Callers must treat
    None as "no real context" and fall back to the honest caveat, not
    proceed with an empty-but-confident answer.
    """
    if not is_configured():
        return None

    query_embedding = await embed_text(query)
    if all(v == 0.0 for v in query_embedding):
        # embed_text() silently falls back to a zero vector on any
        # embedding-API failure (auth, network, etc.) -- a zero-vector
        # query would just return noise, not "no results", so this must
        # be checked explicitly rather than trusting the similarity
        # threshold to filter it out.
        log.warning("document_retrieval_zero_vector", workspace_id=workspace_id)
        return None

    pool = await get_pool()
    if _BACKEND == "sqlite":
        rows = await _sqlite_similarity_search(pool, workspace_id, query_embedding, limit)
    else:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """SELECT title, summary, content,
                          1 - (embedding <=> $2::vector) AS similarity
                   FROM knowledge_items
                   WHERE workspace_id=$1 AND embedding IS NOT NULL
                     AND 1 - (embedding <=> $2::vector) > $4
                   ORDER BY embedding <=> $2::vector
                   LIMIT $3""",
                workspace_id, str(query_embedding), limit, SIMILARITY_THRESHOLD,
            )

    if not rows:
        return None

    parts = []
    total_chars = 0
    for r in rows:
        body = r["content"] or r["summary"] or ""
        entry = f"### {r['title']} (similarity: {r['similarity']:.2f})\n{body}"
        if total_chars + len(entry) > MAX_CONTEXT_CHARS:
            remaining = MAX_CONTEXT_CHARS - total_chars
            if remaining < 100:
                break
            entry = entry[:remaining] + "..."
        parts.append(entry)
        total_chars += len(entry)
        if total_chars >= MAX_CONTEXT_CHARS:
            break

    return "\n\n".join(parts)
