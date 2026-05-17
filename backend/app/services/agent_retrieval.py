"""
Agent retrieval — assemble portfolio context from the workspace graph.

Per Phase 2 §4.1.4: "one agent with full context beats four agents with
thin context." This module produces the context block that gets jammed
into the single agent's system prompt.

The retrieval strategy is intentionally simple in v1:

    1. List the operator's ventures (so the model can refer to them by name)
    2. Most-recent events (commits + tasks) across the portfolio
    3. Semantic top-K docs against the user's question
    4. Recent open graph_tasks (PRs, issues) by status

Tight budgets — we slice each block aggressively because the model
needs room for the actual answer.
"""
from __future__ import annotations

import asyncpg
import json
from typing import Optional

from app.services import graph_repo
from app.services.embeddings import embed_text


MAX_VENTURES = 10
MAX_RECENT_EVENTS = 12
MAX_DOC_HITS = 6
MAX_DOC_BODY_CHARS = 800
MAX_OPEN_TASKS = 8


async def _list_ventures(conn: asyncpg.Connection, workspace_id: str) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT name, slug, h3ros_vertical_tag, description, metadata
        FROM ventures
        WHERE workspace_id=$1 AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT $2
        """,
        workspace_id, MAX_VENTURES,
    )
    return [dict(r) for r in rows]


async def _open_tasks(conn: asyncpg.Connection, workspace_id: str, venture_id: Optional[str]) -> list[dict]:
    if venture_id:
        rows = await conn.fetch(
            """
            SELECT gt.title, gt.status, gt.source_kind, gt.source_url, gt.source_updated_at,
                   v.name AS venture_name
            FROM graph_tasks gt
            LEFT JOIN ventures v ON v.id = gt.venture_id
            WHERE gt.workspace_id=$1 AND gt.venture_id=$2
              AND gt.status IN ('open', 'in_progress')
            ORDER BY gt.source_updated_at DESC NULLS LAST
            LIMIT $3
            """,
            workspace_id, venture_id, MAX_OPEN_TASKS,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT gt.title, gt.status, gt.source_kind, gt.source_url, gt.source_updated_at,
                   v.name AS venture_name
            FROM graph_tasks gt
            LEFT JOIN ventures v ON v.id = gt.venture_id
            WHERE gt.workspace_id=$1 AND gt.status IN ('open', 'in_progress')
            ORDER BY gt.source_updated_at DESC NULLS LAST
            LIMIT $2
            """,
            workspace_id, MAX_OPEN_TASKS,
        )
    return [dict(r) for r in rows]


def _format_metadata(md) -> dict:
    if not md:
        return {}
    if isinstance(md, dict):
        return md
    try:
        return json.loads(md)
    except (TypeError, ValueError):
        return {}


async def build_context(
    conn: asyncpg.Connection,
    workspace_id: str,
    question: str,
    *,
    venture_id: Optional[str] = None,
) -> dict:
    """
    Returns {
      "ventures":   [...],
      "events":     [...],
      "doc_hits":   [...],
      "open_tasks": [...],
      "context_md": "<markdown block ready to splice into system prompt>"
    }
    """
    ventures = await _list_ventures(conn, workspace_id)
    events = await graph_repo.recent_events(conn, workspace_id, venture_id=venture_id, limit=MAX_RECENT_EVENTS)
    events_l = [dict(r) for r in events]

    doc_hits: list[dict] = []
    try:
        q_vec = await embed_text(question)
        rows = await graph_repo.semantic_search_docs(
            conn, workspace_id, q_vec, k=MAX_DOC_HITS, venture_id=venture_id,
        )
        doc_hits = [dict(r) for r in rows]
    except Exception:
        # Embedding service can fail; degrade gracefully — the agent
        # still has events + ventures + tasks for context.
        pass

    open_tasks = await _open_tasks(conn, workspace_id, venture_id)

    # ── Build the markdown context block ────────────────────────────────
    md_parts: list[str] = []

    if ventures:
        md_parts.append("## Ventures in this operator's portfolio")
        for v in ventures:
            tag = f" ({v['h3ros_vertical_tag']})" if v.get("h3ros_vertical_tag") else ""
            desc = f" — {v['description']}" if v.get("description") else ""
            metadata = _format_metadata(v.get("metadata"))
            gh = metadata.get("github_repo")
            gh_note = f" [github:{gh}]" if gh else ""
            md_parts.append(f"- **{v['name']}**{tag}{gh_note}{desc}")
        md_parts.append("")

    if events_l:
        md_parts.append("## Recent activity (last events)")
        for e in events_l[:MAX_RECENT_EVENTS]:
            kind = e.get("source_kind") or "event"
            title = (e.get("title") or "").splitlines()[0][:140]
            when = e["occurred_at"].strftime("%Y-%m-%d %H:%M") if e.get("occurred_at") else ""
            md_parts.append(f"- [{kind}] {when} — {title}")
        md_parts.append("")

    if open_tasks:
        md_parts.append("## Open work")
        for t in open_tasks:
            vname = t.get("venture_name") or "—"
            md_parts.append(
                f"- [{t.get('source_kind')}] **{t.get('title','')[:120]}** ({vname}) — {t.get('status')}"
            )
        md_parts.append("")

    if doc_hits:
        md_parts.append("## Most relevant docs (semantic match)")
        for d in doc_hits:
            sim = float(d.get("similarity") or 0.0)
            body = (d.get("body") or "").strip().replace("\n", " ")
            if len(body) > MAX_DOC_BODY_CHARS:
                body = body[:MAX_DOC_BODY_CHARS] + "…"
            md_parts.append(
                f"- ({sim:.2f}) {d.get('title') or d.get('source_kind')} — {body}"
            )
        md_parts.append("")

    return {
        "ventures": ventures,
        "events": events_l,
        "doc_hits": doc_hits,
        "open_tasks": open_tasks,
        "context_md": "\n".join(md_parts).strip(),
    }


SYSTEM_PROMPT = """You are COFOUND3R — the single operator-grade agent inside FOUND3RY.

You serve a multi-venture operator. You see their entire portfolio: every venture, recent commits, open PRs, open issues, and the highest-signal docs across all their connected tools.

Rules:
- Refer to ventures by name. Never invent a venture that isn't in the portfolio.
- Connect dots across ventures when the question warrants it ("this is similar to what's happening in X").
- If the portfolio context is empty, say so and ask them to connect a tool.
- Be direct. Operators want signal, not warmth.
- Use markdown sparingly: bullet lists for parallel items, code fences only for code.
- If you cite specific work, include a URL in parentheses when the context block provides one.

The portfolio context appears below, generated fresh for this question.
"""


def build_system_prompt(context_md: str, venture_focus: Optional[str] = None) -> str:
    pieces = [SYSTEM_PROMPT]
    if venture_focus:
        pieces.append(f"\nFOCUS VENTURE: {venture_focus}\n")
    if context_md:
        pieces.append("\n---\n\n" + context_md)
    else:
        pieces.append("\n---\n\n_(no portfolio context — the operator has no connectors yet)_")
    return "\n".join(pieces)
