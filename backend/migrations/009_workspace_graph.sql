-- ════════════════════════════════════════════════════════════════════════════
-- Migration 009 — Workspace Graph (Phase 2 §4.1.1)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Implements the entity + edge ontology from the WKH Phase 2 Engineering
-- Brief. The graph is the moat (per §1 Center of Gravity): passive ingestion
-- from external tools writes here, and the single agent (§4.1.4) reads from
-- here via retrieval + pgvector similarity.
--
-- Design choices:
--   • All entities carry workspace_id for tenant isolation.
--   • (workspace_id, source, source_id) UNIQUE on docs/graph_tasks/events
--     guarantees idempotent ingestion (webhook replays are safe).
--   • Polymorphic edges typed by (subject_kind, subject_id, object_kind, object_id)
--     in one edges table to avoid table-explosion across all type pairs.
--   • Soft-delete via deleted_at so disconnecting a source preserves history.
--   • pgvector ivfflat index on docs.embedding (already enabled in 001).
--   • Existing FOUND3RY tables (projects, knowledge_items, tasks, ideas)
--     are NOT migrated into the graph yet; ingestion writes only to graph
--     tables. A future migration can backfill ventures from projects.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Ventures ──────────────────────────────────────────────────────────────
-- A venture is one operating reality the founder is building (one product,
-- one company, one repo). Per the brief: "multi-venture operators" run more
-- than one at a time. h3ros_vertical_tag groups them under the parent.

CREATE TABLE IF NOT EXISTS ventures (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    slug                  TEXT,                            -- url-safe identifier per workspace
    owner_id              UUID REFERENCES users(id),
    h3ros_vertical_tag    TEXT,                            -- 'foundry'|'herm3s'|'t3rra'|'cr3ate'|<custom>
    status                TEXT DEFAULT 'active',           -- active|paused|archived
    description           TEXT,
    metadata              JSONB DEFAULT '{}',              -- e.g. {"github_repo": "owner/name"}
    deleted_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS ventures_workspace_idx ON ventures(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ventures_owner_idx ON ventures(owner_id);

-- ─── Persons ───────────────────────────────────────────────────────────────
-- Distinct from the `users` table. A Person exists in the graph regardless
-- of whether they ever sign up for FOUND3RY. They could be:
--   • a GitHub committer whose email is in the commit metadata
--   • a Linear assignee
--   • a Notion page author
--   • a teammate the founder mentions in a doc
-- If they later sign up, we link via user_id.

CREATE TABLE IF NOT EXISTS persons (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name                  TEXT,
    email                 TEXT,
    user_id               UUID REFERENCES users(id),       -- if this person is also a FOUND3RY user
    avatar_url            TEXT,
    metadata              JSONB DEFAULT '{}',              -- e.g. {"github_login": "octocat"}
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (workspace_id, email)
);

CREATE INDEX IF NOT EXISTS persons_workspace_idx ON persons(workspace_id);
CREATE INDEX IF NOT EXISTS persons_user_idx ON persons(user_id);

-- ─── Docs ──────────────────────────────────────────────────────────────────
-- Any text-bearing artifact in the graph. Sources: 'github_pr', 'github_issue',
-- 'github_readme', 'linear_issue', 'notion_page', 'foundry_note', etc.
-- The (workspace_id, source, source_id) idempotency key ensures webhook
-- replays update rather than duplicate.

CREATE TABLE IF NOT EXISTS docs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    venture_id            UUID REFERENCES ventures(id) ON DELETE SET NULL,
    source                TEXT NOT NULL,                   -- 'github'|'linear'|'notion'|'foundry'|...
    source_kind           TEXT NOT NULL,                   -- 'pr'|'issue'|'readme'|'page'|'note'|...
    source_id             TEXT NOT NULL,                   -- upstream ID (string, providers vary)
    source_url            TEXT,
    title                 TEXT,
    body                  TEXT,
    embedding             VECTOR(1024),                    -- Voyage AI voyage-large-2
    metadata              JSONB DEFAULT '{}',
    author_person_id      UUID REFERENCES persons(id) ON DELETE SET NULL,
    source_created_at     TIMESTAMPTZ,                     -- when the upstream artifact was created
    source_updated_at     TIMESTAMPTZ,                     -- when upstream last changed
    deleted_at            TIMESTAMPTZ,
    ingested_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (workspace_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS docs_workspace_idx ON docs(workspace_id, source_updated_at DESC);
CREATE INDEX IF NOT EXISTS docs_venture_idx ON docs(venture_id, source_updated_at DESC);
CREATE INDEX IF NOT EXISTS docs_source_idx ON docs(workspace_id, source, source_kind);
CREATE INDEX IF NOT EXISTS docs_embedding_idx ON docs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS docs_fts_idx ON docs USING GIN(to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')));

-- ─── Graph Tasks ───────────────────────────────────────────────────────────
-- Named graph_tasks to avoid colliding with the existing FOUND3RY `tasks`
-- table. Source = where the task came from (linear_issue, github_issue,
-- foundry — for tasks created inside FOUND3RY's own kanban).

CREATE TABLE IF NOT EXISTS graph_tasks (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    venture_id            UUID REFERENCES ventures(id) ON DELETE SET NULL,
    source                TEXT NOT NULL,                   -- 'github'|'linear'|'foundry'
    source_kind           TEXT NOT NULL,                   -- 'issue'|'task'|'todo'
    source_id             TEXT NOT NULL,
    source_url            TEXT,
    title                 TEXT NOT NULL,
    body                  TEXT,
    status                TEXT,                            -- raw upstream status string
    priority              TEXT,                            -- raw upstream priority string
    assignee_person_id    UUID REFERENCES persons(id) ON DELETE SET NULL,
    due_at                TIMESTAMPTZ,
    metadata              JSONB DEFAULT '{}',
    source_created_at     TIMESTAMPTZ,
    source_updated_at     TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    deleted_at            TIMESTAMPTZ,
    ingested_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (workspace_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS graph_tasks_workspace_idx ON graph_tasks(workspace_id, source_updated_at DESC);
CREATE INDEX IF NOT EXISTS graph_tasks_venture_idx ON graph_tasks(venture_id, status);
CREATE INDEX IF NOT EXISTS graph_tasks_assignee_idx ON graph_tasks(assignee_person_id);

-- ─── Events ────────────────────────────────────────────────────────────────
-- Time-ordered events flowing into the workspace from any source: commits,
-- PR opens/merges, issue state changes, call recordings, email threads.
-- payload holds the source-specific raw event JSON for later re-parsing.

CREATE TABLE IF NOT EXISTS events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    venture_id            UUID REFERENCES ventures(id) ON DELETE SET NULL,
    source                TEXT NOT NULL,                   -- 'github'|'linear'|'notion'|'foundry'
    source_kind           TEXT NOT NULL,                   -- 'commit'|'pr_opened'|'pr_merged'|'issue_opened'|...
    source_id             TEXT NOT NULL,                   -- upstream id (commit sha, etc.)
    title                 TEXT,
    payload               JSONB DEFAULT '{}',              -- raw event for re-parse / debugging
    author_person_id      UUID REFERENCES persons(id) ON DELETE SET NULL,
    occurred_at           TIMESTAMPTZ NOT NULL,            -- when upstream says it happened
    ingested_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (workspace_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS events_workspace_occurred_idx ON events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_venture_occurred_idx ON events(venture_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_source_idx ON events(workspace_id, source, source_kind);

-- ─── Revenue ───────────────────────────────────────────────────────────────
-- Per-venture revenue tracking. v1 allows manual entry (no Stripe ingestion
-- yet); the brief defers Stripe to Phase 3. period_start/period_end are
-- inclusive month/quarter boundaries.

CREATE TABLE IF NOT EXISTS revenue (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    venture_id            UUID NOT NULL REFERENCES ventures(id) ON DELETE CASCADE,
    amount_cents          BIGINT NOT NULL,                 -- stored as cents to avoid float
    currency              CHAR(3) DEFAULT 'USD',
    period_start          DATE NOT NULL,
    period_end            DATE NOT NULL,
    source                TEXT DEFAULT 'manual',           -- 'manual'|'stripe'|...
    metadata              JSONB DEFAULT '{}',
    recorded_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS revenue_venture_period_idx ON revenue(venture_id, period_end DESC);

-- ─── Edges (polymorphic) ───────────────────────────────────────────────────
-- One table for all directed graph edges. Edge kinds:
--   'participates_in' (subject=person, object=venture)
--   'authored_by'     (subject=doc|graph_task|event, object=person)
--   'mentions'        (subject=doc|event, object=venture|person|graph_task)
--   'derived_from'    (subject=doc, object=doc)
--
-- subject_kind / object_kind are enforced via CHECK and used by app code
-- to filter, e.g. `WHERE kind='mentions' AND subject_kind='doc'`.

CREATE TABLE IF NOT EXISTS edges (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind                  TEXT NOT NULL CHECK (kind IN ('participates_in', 'authored_by', 'mentions', 'derived_from')),
    subject_kind          TEXT NOT NULL CHECK (subject_kind IN ('person', 'doc', 'graph_task', 'event', 'venture')),
    subject_id            UUID NOT NULL,
    object_kind           TEXT NOT NULL CHECK (object_kind IN ('person', 'doc', 'graph_task', 'event', 'venture')),
    object_id             UUID NOT NULL,
    confidence            REAL DEFAULT 1.0,                -- 0.0–1.0 for fuzzy edges from entity-link
    metadata              JSONB DEFAULT '{}',
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (workspace_id, kind, subject_kind, subject_id, object_kind, object_id)
);

CREATE INDEX IF NOT EXISTS edges_workspace_idx ON edges(workspace_id, kind);
CREATE INDEX IF NOT EXISTS edges_subject_idx ON edges(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS edges_object_idx ON edges(object_kind, object_id);

-- ─── OAuth Connections ─────────────────────────────────────────────────────
-- Stores third-party OAuth tokens. Tokens are encrypted application-side
-- (via Fernet — see backend/app/services/oauth_encryption.py) before
-- insert; this table holds ciphertext only.

CREATE TABLE IF NOT EXISTS oauth_connections (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider                 TEXT NOT NULL,                -- 'github'|'linear'|'notion'
    provider_user_id         TEXT,                         -- upstream user identifier
    provider_user_login      TEXT,                         -- e.g. GitHub login
    access_token_encrypted   TEXT NOT NULL,
    refresh_token_encrypted  TEXT,                         -- null for providers without refresh
    scopes                   TEXT[] DEFAULT '{}',
    expires_at               TIMESTAMPTZ,                  -- null for non-expiring tokens
    metadata                 JSONB DEFAULT '{}',
    last_sync_at             TIMESTAMPTZ,                  -- last successful sync
    last_sync_error          TEXT,                         -- last error if a sync failed
    revoked_at               TIMESTAMPTZ,
    created_at               TIMESTAMPTZ DEFAULT NOW(),
    updated_at               TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, provider)                            -- one connection per user per provider
);

CREATE INDEX IF NOT EXISTS oauth_connections_workspace_idx ON oauth_connections(workspace_id, provider);
CREATE INDEX IF NOT EXISTS oauth_connections_user_idx ON oauth_connections(user_id);

-- ─── Sync Jobs ─────────────────────────────────────────────────────────────
-- Long-running initial-sync state per connection. Webhook ingestion writes
-- directly to docs/tasks/events; this table is for the bulk backfill that
-- happens immediately after OAuth connect.

CREATE TABLE IF NOT EXISTS sync_jobs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id         UUID NOT NULL REFERENCES oauth_connections(id) ON DELETE CASCADE,
    workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider              TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'running'|'complete'|'error'
    phase                 TEXT,                            -- 'repos'|'commits'|'issues'|'embeddings'
    progress              JSONB DEFAULT '{}',              -- e.g. {"repos_done": 12, "repos_total": 47}
    error                 TEXT,
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_jobs_connection_idx ON sync_jobs(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_jobs_status_idx ON sync_jobs(status, started_at);

-- ─── Webhook Events (raw log for replay/debug) ─────────────────────────────
-- Every incoming webhook is logged here BEFORE processing. Lets us replay
-- if the processor crashes, and gives us an audit trail.

CREATE TABLE IF NOT EXISTS webhook_events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider              TEXT NOT NULL,
    delivery_id           TEXT,                            -- provider-supplied unique id (GitHub: X-GitHub-Delivery)
    event_type            TEXT,                            -- e.g. 'push', 'pull_request', 'issues'
    payload               JSONB NOT NULL,
    signature_valid       BOOLEAN,                         -- HMAC verification result
    processed_at          TIMESTAMPTZ,
    processing_error      TEXT,
    received_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (provider, delivery_id)
);

CREATE INDEX IF NOT EXISTS webhook_events_received_idx ON webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx ON webhook_events(provider, received_at) WHERE processed_at IS NULL;
