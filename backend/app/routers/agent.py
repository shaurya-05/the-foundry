"""
COFOUND3R — the single operator-grade agent.

Phase 2 §4.1.4: replaces the four-agent specialist surface. One agent
that reads the workspace graph (ventures + events + open tasks +
semantic doc hits) and answers in context.

Endpoints:
    POST /api/agent/ask        — streaming SSE answer
    GET  /api/agent/context    — preview the retrieval block (debugging)
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.db.postgres import get_pool
from app.dependencies import AuthContext, require_auth
from app.services.agent_retrieval import build_context, build_system_prompt
from app.services.claude import stream_claude
from app.services.usage import check_limit, increment_usage

router = APIRouter(prefix="/api/agent", tags=["agent"])


class AskRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    venture_id: Optional[str] = None
    venture_focus: Optional[str] = Field(None, description="Display name of a venture to focus on")


@router.post("/ask")
async def ask(
    body: AskRequest,
    auth: AuthContext = Depends(require_auth),
):
    """
    Streaming answer. SSE format identical to the legacy /api/agents
    endpoint so the existing copilot UI can consume it without changes.
    """
    if not await check_limit(auth.workspace_id, 'agent_runs'):
        raise HTTPException(
            status_code=429,
            detail={'error': 'limit_exceeded', 'plan': 'spark', 'upgrade_url': '/billing/upgrade'},
        )

    pool = await get_pool()
    async with pool.acquire() as conn:
        ctx = await build_context(
            conn, auth.workspace_id, body.query, venture_id=body.venture_id,
        )

    system = build_system_prompt(ctx["context_md"], venture_focus=body.venture_focus)

    async def event_stream():
        await increment_usage(auth.workspace_id, 'agent_runs')
        # Emit a context-preamble event so the UI can show "Pulled X
        # docs across Y ventures" before the answer starts streaming.
        preamble = {
            "type": "context",
            "ventures": len(ctx["ventures"]),
            "events": len(ctx["events"]),
            "doc_hits": len(ctx["doc_hits"]),
            "open_tasks": len(ctx["open_tasks"]),
        }
        yield f"data: {json.dumps(preamble)}\n\n"

        async for text in stream_claude(system, body.query, max_tokens=2400):
            yield f"data: {json.dumps({'type': 'text_delta', 'text': text})}\n\n"

        if ctx["doc_hits"]:
            citations = [
                {
                    "title": d.get("title") or d.get("source_kind") or "Document",
                    "source_type": d.get("source_kind") or "doc",
                    "source_url": d.get("source_url") or None,
                    "excerpt": (d.get("body") or "").strip().replace("\n", " ")[:400],
                }
                for d in ctx["doc_hits"]
            ]
            yield f"data: {json.dumps({'type': 'citations', 'citations': citations})}\n\n"

        yield "data: {\"type\": \"done\"}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/context")
async def context_preview(
    q: str,
    venture_id: Optional[str] = None,
    auth: AuthContext = Depends(require_auth),
):
    """
    Return the retrieval block without calling the model. Useful for
    debugging the graph and for the connections page to show what the
    agent has access to.
    """
    if not q.strip():
        raise HTTPException(status_code=400, detail="q is required")
    pool = await get_pool()
    async with pool.acquire() as conn:
        ctx = await build_context(conn, auth.workspace_id, q, venture_id=venture_id)
    return {
        "ventures": [
            {"name": v["name"], "slug": v.get("slug"), "description": v.get("description")}
            for v in ctx["ventures"]
        ],
        "counts": {
            "ventures": len(ctx["ventures"]),
            "events": len(ctx["events"]),
            "doc_hits": len(ctx["doc_hits"]),
            "open_tasks": len(ctx["open_tasks"]),
        },
        "context_md": ctx["context_md"],
    }
