"""
Workspace graph repository.

High-level read/write operations against the migration-009 tables.
Every write is workspace-scoped and idempotent via the
(workspace_id, source, source_id) UNIQUE constraints on docs / graph_tasks
/ events. Webhook handlers and the initial-sync workers call into here.

Phase 2 §4.1 — the workspace graph is the moat. This module is the only
sanctioned write path; downstream code (GitHub connector, single agent
retrieval) goes through these functions.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable, Optional, Sequence

import asyncpg

# ─── Ventures ──────────────────────────────────────────────────────────────


async def upsert_venture(
    conn: asyncpg.Connection,
    workspace_id: str,
    name: str,
    *,
    slug: Optional[str] = None,
    owner_id: Optional[str] = None,
    h3ros_vertical_tag: Optional[str] = None,
    description: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> str:
    """Insert or update a venture by (workspace_id, slug). Returns venture id."""
    row = await conn.fetchrow(
        """
        INSERT INTO ventures (workspace_id, name, slug, owner_id, h3ros_vertical_tag,
                              description, metadata, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
        ON CONFLICT (workspace_id, slug) DO UPDATE
          SET name = EXCLUDED.name,
              owner_id = COALESCE(EXCLUDED.owner_id, ventures.owner_id),
              h3ros_vertical_tag = COALESCE(EXCLUDED.h3ros_vertical_tag, ventures.h3ros_vertical_tag),
              description = COALESCE(EXCLUDED.description, ventures.description),
              metadata = ventures.metadata || EXCLUDED.metadata,
              updated_at = NOW()
        RETURNING id
        """,
        workspace_id,
        name,
        slug,
        owner_id,
        h3ros_vertical_tag,
        description,
        json.dumps(metadata or {}),
    )
    return str(row["id"])


async def find_venture_by_metadata(
    conn: asyncpg.Connection,
    workspace_id: str,
    key: str,
    value: str,
) -> Optional[str]:
    """Find a venture by a JSONB metadata key/value (e.g. github_repo='owner/name')."""
    row = await conn.fetchrow(
        "SELECT id FROM ventures WHERE workspace_id=$1 AND metadata->>$2 = $3 AND deleted_at IS NULL",
        workspace_id, key, value,
    )
    return str(row["id"]) if row else None


# ─── Persons ───────────────────────────────────────────────────────────────


async def upsert_person(
    conn: asyncpg.Connection,
    workspace_id: str,
    *,
    email: Optional[str] = None,
    name: Optional[str] = None,
    user_id: Optional[str] = None,
    avatar_url: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> str:
    """
    Insert or update a person. If email present, dedupe via UNIQUE
    (workspace_id, email). If no email, always inserts a new row.
    """
    if email:
        row = await conn.fetchrow(
            """
            INSERT INTO persons (workspace_id, email, name, user_id, avatar_url,
                                 metadata, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
            ON CONFLICT (workspace_id, email) DO UPDATE
              SET name = COALESCE(EXCLUDED.name, persons.name),
                  user_id = COALESCE(EXCLUDED.user_id, persons.user_id),
                  avatar_url = COALESCE(EXCLUDED.avatar_url, persons.avatar_url),
                  metadata = persons.metadata || EXCLUDED.metadata,
                  updated_at = NOW()
            RETURNING id
            """,
            workspace_id, email, name, user_id, avatar_url,
            json.dumps(metadata or {}),
        )
    else:
        row = await conn.fetchrow(
            """
            INSERT INTO persons (workspace_id, name, user_id, avatar_url, metadata)
            VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id
            """,
            workspace_id, name, user_id, avatar_url,
            json.dumps(metadata or {}),
        )
    return str(row["id"])


# ─── Docs ──────────────────────────────────────────────────────────────────


async def upsert_doc(
    conn: asyncpg.Connection,
    workspace_id: str,
    source: str,
    source_kind: str,
    source_id: str,
    *,
    venture_id: Optional[str] = None,
    title: Optional[str] = None,
    body: Optional[str] = None,
    source_url: Optional[str] = None,
    author_person_id: Optional[str] = None,
    embedding: Optional[Sequence[float]] = None,
    metadata: Optional[dict] = None,
    source_created_at: Optional[datetime] = None,
    source_updated_at: Optional[datetime] = None,
) -> str:
    """
    Idempotent doc upsert keyed on (workspace_id, source, source_id).
    Webhook replays and re-syncs are safe — the latest body/embedding wins.
    """
    embedding_val = list(embedding) if embedding is not None else None
    row = await conn.fetchrow(
        """
        INSERT INTO docs (workspace_id, venture_id, source, source_kind, source_id,
                          source_url, title, body, embedding, metadata,
                          author_person_id, source_created_at, source_updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10::jsonb, $11, $12, $13)
        ON CONFLICT (workspace_id, source, source_id) DO UPDATE
          SET venture_id = COALESCE(EXCLUDED.venture_id, docs.venture_id),
              title = EXCLUDED.title,
              body = EXCLUDED.body,
              source_url = COALESCE(EXCLUDED.source_url, docs.source_url),
              embedding = COALESCE(EXCLUDED.embedding, docs.embedding),
              metadata = docs.metadata || EXCLUDED.metadata,
              author_person_id = COALESCE(EXCLUDED.author_person_id, docs.author_person_id),
              source_created_at = COALESCE(EXCLUDED.source_created_at, docs.source_created_at),
              source_updated_at = EXCLUDED.source_updated_at
        RETURNING id
        """,
        workspace_id, venture_id, source, source_kind, source_id, source_url,
        title, body,
        str(embedding_val) if embedding_val is not None else None,
        json.dumps(metadata or {}),
        author_person_id, source_created_at, source_updated_at,
    )
    return str(row["id"])


# ─── Graph Tasks ───────────────────────────────────────────────────────────


async def upsert_graph_task(
    conn: asyncpg.Connection,
    workspace_id: str,
    source: str,
    source_kind: str,
    source_id: str,
    title: str,
    *,
    venture_id: Optional[str] = None,
    body: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assignee_person_id: Optional[str] = None,
    source_url: Optional[str] = None,
    due_at: Optional[datetime] = None,
    metadata: Optional[dict] = None,
    source_created_at: Optional[datetime] = None,
    source_updated_at: Optional[datetime] = None,
    completed_at: Optional[datetime] = None,
) -> str:
    """Idempotent graph_tasks upsert keyed on (workspace_id, source, source_id)."""
    row = await conn.fetchrow(
        """
        INSERT INTO graph_tasks (workspace_id, venture_id, source, source_kind, source_id,
                                 source_url, title, body, status, priority,
                                 assignee_person_id, due_at, metadata,
                                 source_created_at, source_updated_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16)
        ON CONFLICT (workspace_id, source, source_id) DO UPDATE
          SET venture_id = COALESCE(EXCLUDED.venture_id, graph_tasks.venture_id),
              title = EXCLUDED.title,
              body = EXCLUDED.body,
              status = EXCLUDED.status,
              priority = COALESCE(EXCLUDED.priority, graph_tasks.priority),
              assignee_person_id = COALESCE(EXCLUDED.assignee_person_id, graph_tasks.assignee_person_id),
              due_at = COALESCE(EXCLUDED.due_at, graph_tasks.due_at),
              source_url = COALESCE(EXCLUDED.source_url, graph_tasks.source_url),
              metadata = graph_tasks.metadata || EXCLUDED.metadata,
              source_updated_at = EXCLUDED.source_updated_at,
              completed_at = COALESCE(EXCLUDED.completed_at, graph_tasks.completed_at)
        RETURNING id
        """,
        workspace_id, venture_id, source, source_kind, source_id, source_url,
        title, body, status, priority, assignee_person_id, due_at,
        json.dumps(metadata or {}),
        source_created_at, source_updated_at, completed_at,
    )
    return str(row["id"])


# ─── Events ────────────────────────────────────────────────────────────────


async def upsert_event(
    conn: asyncpg.Connection,
    workspace_id: str,
    source: str,
    source_kind: str,
    source_id: str,
    occurred_at: datetime,
    *,
    venture_id: Optional[str] = None,
    title: Optional[str] = None,
    payload: Optional[dict] = None,
    author_person_id: Optional[str] = None,
) -> str:
    """Idempotent event insert. Events never update — only first-write wins."""
    row = await conn.fetchrow(
        """
        INSERT INTO events (workspace_id, venture_id, source, source_kind, source_id,
                            title, payload, author_person_id, occurred_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        ON CONFLICT (workspace_id, source, source_id) DO NOTHING
        RETURNING id
        """,
        workspace_id, venture_id, source, source_kind, source_id,
        title, json.dumps(payload or {}), author_person_id, occurred_at,
    )
    if row:
        return str(row["id"])
    # Already existed — fetch the id for caller convenience
    row = await conn.fetchrow(
        "SELECT id FROM events WHERE workspace_id=$1 AND source=$2 AND source_id=$3",
        workspace_id, source, source_id,
    )
    return str(row["id"]) if row else ""


# ─── Edges ─────────────────────────────────────────────────────────────────

EDGE_KINDS = {"participates_in", "authored_by", "mentions", "derived_from"}
ENTITY_KINDS = {"person", "doc", "graph_task", "event", "venture"}


async def add_edge(
    conn: asyncpg.Connection,
    workspace_id: str,
    kind: str,
    subject_kind: str,
    subject_id: str,
    object_kind: str,
    object_id: str,
    *,
    confidence: float = 1.0,
    metadata: Optional[dict] = None,
) -> Optional[str]:
    """Insert an edge if it doesn't already exist. Returns id, or None on conflict."""
    if kind not in EDGE_KINDS:
        raise ValueError(f"Unknown edge kind: {kind}")
    if subject_kind not in ENTITY_KINDS:
        raise ValueError(f"Unknown subject_kind: {subject_kind}")
    if object_kind not in ENTITY_KINDS:
        raise ValueError(f"Unknown object_kind: {object_kind}")
    row = await conn.fetchrow(
        """
        INSERT INTO edges (workspace_id, kind, subject_kind, subject_id,
                           object_kind, object_id, confidence, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        workspace_id, kind, subject_kind, subject_id, object_kind, object_id,
        confidence, json.dumps(metadata or {}),
    )
    return str(row["id"]) if row else None


# ─── OAuth connections ─────────────────────────────────────────────────────


async def upsert_oauth_connection(
    conn: asyncpg.Connection,
    workspace_id: str,
    user_id: str,
    provider: str,
    access_token_encrypted: str,
    *,
    refresh_token_encrypted: Optional[str] = None,
    provider_user_id: Optional[str] = None,
    provider_user_login: Optional[str] = None,
    scopes: Optional[Iterable[str]] = None,
    expires_at: Optional[datetime] = None,
    metadata: Optional[dict] = None,
) -> str:
    """Insert or update one OAuth connection per (user_id, provider)."""
    row = await conn.fetchrow(
        """
        INSERT INTO oauth_connections (
            workspace_id, user_id, provider, access_token_encrypted,
            refresh_token_encrypted, provider_user_id, provider_user_login,
            scopes, expires_at, metadata, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
        ON CONFLICT (user_id, provider) DO UPDATE
          SET access_token_encrypted = EXCLUDED.access_token_encrypted,
              refresh_token_encrypted = COALESCE(EXCLUDED.refresh_token_encrypted, oauth_connections.refresh_token_encrypted),
              provider_user_id = COALESCE(EXCLUDED.provider_user_id, oauth_connections.provider_user_id),
              provider_user_login = COALESCE(EXCLUDED.provider_user_login, oauth_connections.provider_user_login),
              scopes = EXCLUDED.scopes,
              expires_at = EXCLUDED.expires_at,
              metadata = oauth_connections.metadata || EXCLUDED.metadata,
              revoked_at = NULL,
              updated_at = NOW()
        RETURNING id
        """,
        workspace_id, user_id, provider, access_token_encrypted,
        refresh_token_encrypted, provider_user_id, provider_user_login,
        list(scopes or []), expires_at, json.dumps(metadata or {}),
    )
    return str(row["id"])


async def get_oauth_connection(
    conn: asyncpg.Connection,
    user_id: str,
    provider: str,
) -> Optional[asyncpg.Record]:
    """Returns the row or None. Caller decrypts via oauth_encryption.decrypt_token."""
    return await conn.fetchrow(
        """
        SELECT * FROM oauth_connections
        WHERE user_id=$1 AND provider=$2 AND revoked_at IS NULL
        """,
        user_id, provider,
    )


async def revoke_oauth_connection(
    conn: asyncpg.Connection,
    user_id: str,
    provider: str,
) -> bool:
    """Soft-revoke a connection. Returns True if a row was updated."""
    result = await conn.execute(
        """
        UPDATE oauth_connections SET revoked_at = NOW(), updated_at = NOW()
        WHERE user_id=$1 AND provider=$2 AND revoked_at IS NULL
        """,
        user_id, provider,
    )
    return result.endswith(" 1")


# ─── Retrieval ─────────────────────────────────────────────────────────────


async def recent_events(
    conn: asyncpg.Connection,
    workspace_id: str,
    *,
    venture_id: Optional[str] = None,
    limit: int = 20,
) -> list[asyncpg.Record]:
    """Most recent events in a workspace (optionally scoped to one venture)."""
    if venture_id:
        return await conn.fetch(
            """
            SELECT * FROM events
            WHERE workspace_id=$1 AND venture_id=$2
            ORDER BY occurred_at DESC LIMIT $3
            """,
            workspace_id, venture_id, limit,
        )
    return await conn.fetch(
        """
        SELECT * FROM events WHERE workspace_id=$1
        ORDER BY occurred_at DESC LIMIT $2
        """,
        workspace_id, limit,
    )


async def semantic_search_docs(
    conn: asyncpg.Connection,
    workspace_id: str,
    query_embedding: Sequence[float],
    *,
    k: int = 20,
    venture_id: Optional[str] = None,
) -> list[asyncpg.Record]:
    """Cosine-similarity search over docs in the workspace."""
    qv = str(list(query_embedding))
    if venture_id:
        return await conn.fetch(
            """
            SELECT id, venture_id, source, source_kind, title, body, source_url,
                   1 - (embedding <=> $3::vector) AS similarity
            FROM docs
            WHERE workspace_id=$1 AND venture_id=$2
              AND embedding IS NOT NULL AND deleted_at IS NULL
            ORDER BY embedding <=> $3::vector
            LIMIT $4
            """,
            workspace_id, venture_id, qv, k,
        )
    return await conn.fetch(
        """
        SELECT id, venture_id, source, source_kind, title, body, source_url,
               1 - (embedding <=> $2::vector) AS similarity
        FROM docs
        WHERE workspace_id=$1 AND embedding IS NOT NULL AND deleted_at IS NULL
        ORDER BY embedding <=> $2::vector
        LIMIT $3
        """,
        workspace_id, qv, k,
    )
