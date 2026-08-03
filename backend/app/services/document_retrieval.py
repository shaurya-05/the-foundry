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
import os
from typing import Optional

import structlog

from app.db.postgres import get_pool
from app.services.embeddings import embed_text

log = structlog.get_logger()

SIMILARITY_THRESHOLD = 0.3
MAX_CONTEXT_CHARS = 2500  # keeps injected context well within the local
                          # models' 4096-token window alongside the system
                          # prompt, history, and the question itself.


def is_configured() -> bool:
    return bool(os.getenv("VOYAGE_API_KEY"))


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
