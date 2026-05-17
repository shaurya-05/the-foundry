"""
GitHub webhook event processor.

Per Phase 2 §4.1.2 — once the initial sync lands, we keep the graph
fresh via webhooks. GitHub POSTs to /api/webhooks/github with an
X-Hub-Signature-256 HMAC of the body using the shared webhook secret.

Supported events (v1):
    push                - one event per commit in the head_commit list
    pull_request        - opened/closed/reopened/edited/synchronize
    issues              - opened/closed/reopened/edited
    issue_comment       - body becomes a doc; comment author edge
    pull_request_review - same shape as issue_comment for our purposes

All event handlers reuse the same graph_repo write path as the initial
sync. webhook_events is the idempotency ledger — we INSERT first; if
that fails the unique constraint we skip processing.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime
from typing import Any, Optional

import asyncpg
import structlog

from app.db.postgres import get_pool
from app.services import graph_repo

log = structlog.get_logger()


# ─── Signature verification ────────────────────────────────────────────────


def verify_signature(secret: str, body: bytes, signature_header: Optional[str]) -> bool:
    """Constant-time HMAC-SHA256 check on the raw request body."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)


# ─── Idempotency ledger ────────────────────────────────────────────────────


async def record_webhook(
    conn: asyncpg.Connection,
    *,
    delivery_id: str,
    provider: str,
    event_type: str,
    workspace_id: Optional[str],
    user_id: Optional[str],
    payload: dict,
) -> bool:
    """Returns True if recorded (proceed), False if duplicate (skip)."""
    row = await conn.fetchrow(
        """
        INSERT INTO webhook_events (provider, delivery_id, event_type, workspace_id,
                                    user_id, payload)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (provider, delivery_id) DO NOTHING
        RETURNING id
        """,
        provider, delivery_id, event_type, workspace_id, user_id, json.dumps(payload),
    )
    return row is not None


async def mark_webhook_processed(
    conn: asyncpg.Connection,
    delivery_id: str,
    *,
    provider: str = "github",
    error: Optional[str] = None,
) -> None:
    await conn.execute(
        """
        UPDATE webhook_events
        SET processed_at = NOW(), error = $3
        WHERE provider = $1 AND delivery_id = $2
        """,
        provider, delivery_id, error,
    )


# ─── Helpers ───────────────────────────────────────────────────────────────


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


async def _resolve_venture_from_repo(
    conn: asyncpg.Connection,
    workspace_id: str,
    repo: dict,
) -> str:
    full_name = repo.get("full_name")
    if not full_name:
        raise ValueError("repo missing full_name")
    existing = await graph_repo.find_venture_by_metadata(conn, workspace_id, "github_repo", full_name)
    if existing:
        return existing
    return await graph_repo.upsert_venture(
        conn,
        workspace_id,
        name=repo.get("name") or full_name,
        slug=full_name.replace("/", "__").lower(),
        description=repo.get("description"),
        metadata={
            "github_repo": full_name,
            "github_repo_id": repo.get("id"),
            "github_owner": (repo.get("owner") or {}).get("login"),
            "private": repo.get("private", False),
        },
    )


async def _upsert_github_actor(
    conn: asyncpg.Connection,
    workspace_id: str,
    actor: Optional[dict],
) -> Optional[str]:
    if not actor or not actor.get("login"):
        return None
    return await graph_repo.upsert_person(
        conn,
        workspace_id,
        name=actor.get("name") or actor.get("login"),
        avatar_url=actor.get("avatar_url"),
        metadata={
            "github_login": actor["login"],
            "github_user_id": actor.get("id"),
        },
    )


# ─── Event handlers ────────────────────────────────────────────────────────


async def handle_push(
    conn: asyncpg.Connection,
    workspace_id: str,
    payload: dict,
) -> None:
    repo = payload.get("repository") or {}
    venture_id = await _resolve_venture_from_repo(conn, workspace_id, repo)
    full_name = repo.get("full_name", "")
    commits = payload.get("commits") or []
    # GitHub sends up to 20 commits inline; the rest must be backfilled via initial sync.
    for c in commits:
        sha = c.get("id") or c.get("sha")
        if not sha:
            continue
        occurred_at = _parse_dt(c.get("timestamp"))
        if not occurred_at:
            continue
        author = c.get("author") or {}
        # author here is {name, email, username}; resolve via username if present
        actor = {"login": author.get("username")} if author.get("username") else None
        person_id = await _upsert_github_actor(conn, workspace_id, actor)
        event_id = await graph_repo.upsert_event(
            conn,
            workspace_id,
            source="github",
            source_kind="commit",
            source_id=f"{full_name}@{sha}",
            occurred_at=occurred_at,
            venture_id=venture_id,
            title=(c.get("message") or "")[:200],
            author_person_id=person_id,
            payload={
                "sha": sha,
                "url": c.get("url"),
                "author_login": author.get("username"),
                "author_name": author.get("name"),
                "author_email": author.get("email"),
                "added": c.get("added"),
                "removed": c.get("removed"),
                "modified": c.get("modified"),
            },
        )
        if person_id and event_id:
            await graph_repo.add_edge(
                conn, workspace_id, "participates_in",
                "person", person_id, "event", event_id,
            )


async def _handle_issue_like(
    conn: asyncpg.Connection,
    workspace_id: str,
    payload: dict,
    kind: str,
) -> None:
    """Shared handler for issues + pull_request events."""
    repo = payload.get("repository") or {}
    venture_id = await _resolve_venture_from_repo(conn, workspace_id, repo)
    full_name = repo.get("full_name", "")
    # The interesting object lives at "issue" or "pull_request"
    obj = payload.get("issue") or payload.get("pull_request") or {}
    number = obj.get("number")
    if not number:
        return
    author = obj.get("user")
    person_id = await _upsert_github_actor(conn, workspace_id, author)
    status = obj.get("state")
    gtask_id = await graph_repo.upsert_graph_task(
        conn,
        workspace_id,
        source="github",
        source_kind=kind,
        source_id=f"{full_name}#{number}",
        title=(obj.get("title") or f"#{number}")[:200],
        venture_id=venture_id,
        body=obj.get("body"),
        status=status,
        source_url=obj.get("html_url"),
        source_created_at=_parse_dt(obj.get("created_at")),
        source_updated_at=_parse_dt(obj.get("updated_at")),
        completed_at=_parse_dt(obj.get("closed_at")),
        metadata={
            "number": number,
            "labels": [l.get("name") for l in (obj.get("labels") or [])],
            "is_pr": kind == "pull_request",
            "merged": obj.get("merged"),
            "author_login": (author or {}).get("login"),
            "action": payload.get("action"),
        },
    )
    if person_id and gtask_id:
        await graph_repo.add_edge(
            conn, workspace_id, "authored_by",
            "graph_task", gtask_id, "person", person_id,
        )


async def handle_issue_comment(
    conn: asyncpg.Connection,
    workspace_id: str,
    payload: dict,
) -> None:
    """Comments on issues + PRs. Body lands as a doc; author edge added."""
    repo = payload.get("repository") or {}
    venture_id = await _resolve_venture_from_repo(conn, workspace_id, repo)
    full_name = repo.get("full_name", "")
    comment = payload.get("comment") or {}
    issue = payload.get("issue") or payload.get("pull_request") or {}
    cid = comment.get("id")
    if not cid:
        return
    author = comment.get("user")
    person_id = await _upsert_github_actor(conn, workspace_id, author)
    body = comment.get("body") or ""
    # Embed the body so the agent can retrieve it via semantic search.
    embedding = None
    try:
        from app.services.embeddings import embed_text
        if body.strip():
            embedding = await embed_text(body)
    except Exception as e:
        log.warning("embed_comment_failed", error=str(e))

    doc_id = await graph_repo.upsert_doc(
        conn,
        workspace_id,
        source="github",
        source_kind="comment",
        source_id=f"{full_name}#{issue.get('number')}::comment::{cid}",
        venture_id=venture_id,
        title=f"Comment on #{issue.get('number')}",
        body=body,
        source_url=comment.get("html_url"),
        author_person_id=person_id,
        embedding=embedding,
        source_created_at=_parse_dt(comment.get("created_at")),
        source_updated_at=_parse_dt(comment.get("updated_at")),
        metadata={
            "issue_number": issue.get("number"),
            "comment_id": cid,
            "author_login": (author or {}).get("login"),
        },
    )
    if person_id and doc_id:
        await graph_repo.add_edge(
            conn, workspace_id, "authored_by",
            "doc", doc_id, "person", person_id,
        )


# ─── Top-level dispatch ────────────────────────────────────────────────────


async def process_event(
    workspace_id: str,
    delivery_id: str,
    event_type: str,
    payload: dict,
) -> None:
    """
    Persist the webhook (idempotency) and dispatch to a handler.

    Caller must already have verified the HMAC signature and resolved
    workspace_id (from the GitHub repo → oauth_connection chain). We
    take a fresh DB connection so the webhook ledger row commits even
    if a handler throws.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        proceed = await record_webhook(
            conn,
            delivery_id=delivery_id,
            provider="github",
            event_type=event_type,
            workspace_id=workspace_id,
            user_id=None,
            payload=payload,
        )
    if not proceed:
        log.info("github_webhook_duplicate", delivery_id=delivery_id, event_type=event_type)
        return

    err: Optional[str] = None
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                if event_type == "push":
                    await handle_push(conn, workspace_id, payload)
                elif event_type == "pull_request":
                    await _handle_issue_like(conn, workspace_id, payload, "pull_request")
                elif event_type == "issues":
                    await _handle_issue_like(conn, workspace_id, payload, "issue")
                elif event_type == "issue_comment":
                    await handle_issue_comment(conn, workspace_id, payload)
                else:
                    log.info("github_webhook_unhandled", event_type=event_type)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        log.error("github_webhook_handler_failed", event_type=event_type, error=err)

    async with pool.acquire() as conn:
        await mark_webhook_processed(conn, delivery_id, error=err)
