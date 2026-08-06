-- Consolidated SQLite schema for the desktop build (DATABASE_BACKEND=sqlite).
-- Translated directly from the real live Postgres schema (pg_dump --schema-only
-- against the actual running local-prod database, not hand-traced through the
-- 18 incremental Postgres migrations -- the live schema is the real end-state,
-- migrations could have added/altered/dropped things along the way).
--
-- Translation rules applied throughout:
--   uuid                        -> TEXT (app already generates UUIDs in Python
--                                  for most inserts; DEFAULT (gen_random_uuid())
--                                  covers the few places that rely on a DB-side
--                                  default -- see sqlite.py's registered function)
--   jsonb                       -> TEXT (JSON string; app already does
--                                  json.dumps/json.loads at the call sites for
--                                  jsonb params, since asyncpg needs that too)
--   boolean                     -> INTEGER (0/1)
--   text[]                      -> TEXT (JSON array string)
--   vector(1024)                -> TEXT (JSON array of floats; similarity search
--                                  done in Python at query time for the one real,
--                                  tested vector path -- knowledge_items -- see
--                                  document_retrieval.py's backend branch.
--                                  Deliberately NOT sqlite-vec: that needs a
--                                  compiled native extension loaded at runtime,
--                                  real packaging complexity for an Electron-
--                                  bundled Python environment, for a workload
--                                  (one user's personal knowledge base, realistically
--                                  hundreds to low-thousands of rows) where a
--                                  brute-force Python cosine pass is fast enough
--                                  and has zero extra dependency.)
--   timestamp with time zone    -> TEXT (ISO8601 string, datetime('now') default)
--   date                        -> TEXT
--   numeric(p,s), real          -> REAL
--   CHECK (x = ANY (ARRAY[...])) -> CHECK (x IN (...))
--   Postgres GIN/ivfflat indexes (full-text search, vector index) -> dropped.
--   docs_fts_idx/knowledge_fts (full-text search on an unused/dead `docs`
--   table and on knowledge_items) aren't in any real, currently-exercised
--   query path this whole project -- knowledge retrieval goes through
--   document_retrieval.py's embedding similarity, not FTS. Not translating
--   a feature nothing calls.
--
-- PRAGMA foreign_keys must be turned ON by the connection layer (sqlite.py) --
-- SQLite ignores FK constraints by default unless a session explicitly enables
-- them, unlike Postgres where they're always enforced.

CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    description TEXT,
    onboarding_step INTEGER NOT NULL DEFAULT 0,
    plan TEXT,
    plan_updated_at TEXT,
    onboarding_completed_at TEXT,
    last_digest_sent_at TEXT
);
CREATE INDEX IF NOT EXISTS workspaces_digest_idx ON workspaces (last_digest_sent_at);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    email TEXT NOT NULL UNIQUE,
    workspace_id TEXT REFERENCES workspaces(id),
    role TEXT DEFAULT 'owner',
    preferences TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    password_hash TEXT,
    display_name TEXT,
    avatar_color TEXT DEFAULT '#E8231F',
    email_verified INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    terms_accepted_at TEXT
);

CREATE TABLE IF NOT EXISTS workspace_members (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT REFERENCES workspaces(id),
    user_id TEXT REFERENCES users(id),
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members (user_id);
CREATE INDEX IF NOT EXISTS workspace_members_ws_idx ON workspace_members (workspace_id);

CREATE TABLE IF NOT EXISTS workspace_invitations (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT REFERENCES workspaces(id),
    invited_by TEXT REFERENCES users(id),
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    token TEXT NOT NULL UNIQUE DEFAULT (gen_random_hex_token(24)),
    accepted INTEGER DEFAULT 0,
    expires_at TEXT DEFAULT (datetime('now', '+7 days')),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE DEFAULT (gen_random_hex_token(32)),
    expires_at TEXT NOT NULL DEFAULT (datetime('now', '+24 hours')),
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_verification_token ON email_verification_tokens (token);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    user_id TEXT NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE DEFAULT (gen_random_hex_token(32)),
    expires_at TEXT NOT NULL DEFAULT (datetime('now', '+1 hours')),
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens (token);

CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_monthly INTEGER NOT NULL DEFAULT 0,
    price_yearly INTEGER NOT NULL DEFAULT 0,
    limits TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL UNIQUE,
    plan_id TEXT NOT NULL DEFAULT 'spark',
    status TEXT NOT NULL DEFAULT 'active',
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_start TEXT NOT NULL DEFAULT (datetime('now')),
    current_period_end TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
    canceled_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_tracking (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    copilot_messages INTEGER NOT NULL DEFAULT 0,
    agent_runs INTEGER NOT NULL DEFAULT 0,
    forge_operations INTEGER NOT NULL DEFAULT 0,
    pipeline_runs INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (workspace_id, period_start)
);
CREATE INDEX IF NOT EXISTS usage_tracking_ws_period_idx ON usage_tracking (workspace_id, period_start DESC);

CREATE TABLE IF NOT EXISTS ventures (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT,
    owner_id TEXT,
    h3ros_vertical_tag TEXT,
    status TEXT DEFAULT 'active',
    description TEXT,
    metadata TEXT DEFAULT '{}',
    deleted_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS ventures_owner_idx ON ventures (owner_id);
CREATE INDEX IF NOT EXISTS ventures_workspace_idx ON ventures (workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT,
    user_id TEXT,
    title TEXT NOT NULL,
    plan TEXT,
    status TEXT DEFAULT 'active',
    embedding TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    visibility TEXT NOT NULL DEFAULT 'private',
    clearance_level INTEGER NOT NULL DEFAULT 0,
    notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT,
    user_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    project_id TEXT,
    due_date TEXT,
    source TEXT DEFAULT 'manual',
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    assignee_id TEXT
);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (workspace_id, status);
CREATE INDEX IF NOT EXISTS tasks_workspace_idx ON tasks (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_items (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT,
    user_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    type TEXT DEFAULT 'text',
    tags TEXT,
    embedding TEXT,
    source_url TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    visibility TEXT NOT NULL DEFAULT 'team'
);
CREATE INDEX IF NOT EXISTS knowledge_workspace_idx ON knowledge_items (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    user_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'note',
    source TEXT,
    source_url TEXT,
    source_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_workspace_source_id ON knowledge (workspace_id, source, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    venture_id TEXT REFERENCES ventures(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_url TEXT,
    title TEXT,
    body TEXT,
    embedding TEXT,
    metadata TEXT DEFAULT '{}',
    author_person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    source_created_at TEXT,
    source_updated_at TEXT,
    deleted_at TEXT,
    ingested_at TEXT DEFAULT (datetime('now')),
    UNIQUE (workspace_id, source, source_id)
);
CREATE INDEX IF NOT EXISTS docs_source_idx ON docs (workspace_id, source, source_kind);
CREATE INDEX IF NOT EXISTS docs_venture_idx ON docs (venture_id, source_updated_at DESC);
CREATE INDEX IF NOT EXISTS docs_workspace_idx ON docs (workspace_id, source_updated_at DESC);

CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    name TEXT,
    email TEXT,
    user_id TEXT,
    avatar_url TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (workspace_id, email)
);
CREATE INDEX IF NOT EXISTS persons_user_idx ON persons (user_id);
CREATE INDEX IF NOT EXISTS persons_workspace_idx ON persons (workspace_id);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    venture_id TEXT,
    source TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT,
    payload TEXT DEFAULT '{}',
    author_person_id TEXT,
    occurred_at TEXT NOT NULL,
    ingested_at TEXT DEFAULT (datetime('now')),
    UNIQUE (workspace_id, source, source_id)
);
CREATE INDEX IF NOT EXISTS events_source_idx ON events (workspace_id, source, source_kind);
CREATE INDEX IF NOT EXISTS events_venture_occurred_idx ON events (venture_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_workspace_occurred_idx ON events (workspace_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS graph_tasks (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    venture_id TEXT,
    source TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_url TEXT,
    title TEXT NOT NULL,
    body TEXT,
    status TEXT,
    priority TEXT,
    assignee_person_id TEXT,
    due_at TEXT,
    metadata TEXT DEFAULT '{}',
    source_created_at TEXT,
    source_updated_at TEXT,
    completed_at TEXT,
    deleted_at TEXT,
    ingested_at TEXT DEFAULT (datetime('now')),
    UNIQUE (workspace_id, source, source_id)
);
CREATE INDEX IF NOT EXISTS graph_tasks_assignee_idx ON graph_tasks (assignee_person_id);
CREATE INDEX IF NOT EXISTS graph_tasks_venture_idx ON graph_tasks (venture_id, status);
CREATE INDEX IF NOT EXISTS graph_tasks_workspace_idx ON graph_tasks (workspace_id, source_updated_at DESC);

CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('participates_in', 'authored_by', 'mentions', 'derived_from')),
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('person', 'doc', 'graph_task', 'event', 'venture')),
    subject_id TEXT NOT NULL,
    object_kind TEXT NOT NULL CHECK (object_kind IN ('person', 'doc', 'graph_task', 'event', 'venture')),
    object_id TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE (workspace_id, kind, subject_kind, subject_id, object_kind, object_id)
);
CREATE INDEX IF NOT EXISTS edges_object_idx ON edges (object_kind, object_id);
CREATE INDEX IF NOT EXISTS edges_subject_idx ON edges (subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS edges_workspace_idx ON edges (workspace_id, kind);

CREATE TABLE IF NOT EXISTS revenue (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    venture_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT DEFAULT 'USD',
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    source TEXT DEFAULT 'manual',
    metadata TEXT DEFAULT '{}',
    recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS revenue_venture_period_idx ON revenue (venture_id, period_end DESC);

CREATE TABLE IF NOT EXISTS copilot_messages (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    model_used TEXT DEFAULT 'claude-sonnet-4',
    thread_id TEXT DEFAULT (gen_random_uuid())
);
CREATE INDEX IF NOT EXISTS copilot_messages_project_idx ON copilot_messages (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS copilot_messages_ws_idx ON copilot_messages (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_memory (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (workspace_id, user_id)
);
CREATE TRIGGER IF NOT EXISTS agent_memory_touch AFTER UPDATE ON agent_memory
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE agent_memory SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT,
    user_id TEXT,
    agent_id TEXT NOT NULL,
    context TEXT NOT NULL,
    output TEXT,
    tokens_used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forge_outputs (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS forge_outputs_ws_idx ON forge_outputs (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT,
    pipeline_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    current_step INTEGER DEFAULT 0,
    step_outputs TEXT DEFAULT '[]',
    input TEXT NOT NULL,
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_step_logs (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    run_id TEXT,
    step_index INTEGER NOT NULL,
    agent TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    input TEXT,
    output TEXT,
    tokens_used INTEGER DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS blueprint_canvas (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
    nodes TEXT NOT NULL DEFAULT '[]',
    edges TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS blueprint_canvas_ws_idx ON blueprint_canvas (workspace_id);

CREATE TABLE IF NOT EXISTS blueprint_ops (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    op_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS blueprint_ops_ws_idx ON blueprint_ops (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS command_history (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT REFERENCES workspaces(id),
    raw_input TEXT NOT NULL,
    parsed_action TEXT DEFAULT '{}',
    executed INTEGER DEFAULT 0,
    ts TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT,
    user_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    read INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT REFERENCES workspaces(id),
    user_id TEXT REFERENCES users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    entity_type TEXT,
    entity_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activity_workspace ON activity_events (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT,
    user_id TEXT,
    domains TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    visibility TEXT NOT NULL DEFAULT 'private',
    clearance_level INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ideas_workspace_idx ON ideas (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_connections (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT,
    provider_user_login TEXT,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    scopes TEXT DEFAULT '[]',
    expires_at TEXT,
    metadata TEXT DEFAULT '{}',
    last_sync_at TEXT,
    last_sync_error TEXT,
    revoked_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS oauth_connections_user_idx ON oauth_connections (user_id);
CREATE INDEX IF NOT EXISTS oauth_connections_workspace_idx ON oauth_connections (workspace_id, provider);

CREATE TABLE IF NOT EXISTS sync_jobs (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    connection_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    phase TEXT,
    progress TEXT DEFAULT '{}',
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sync_jobs_connection_idx ON sync_jobs (connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_jobs_status_idx ON sync_jobs (status, started_at);

CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    provider TEXT NOT NULL,
    delivery_id TEXT,
    event_type TEXT,
    payload TEXT NOT NULL,
    signature_valid INTEGER,
    processed_at TEXT,
    processing_error TEXT,
    received_at TEXT DEFAULT (datetime('now')),
    UNIQUE (provider, delivery_id)
);
CREATE INDEX IF NOT EXISTS webhook_events_received_idx ON webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_unprocessed_idx ON webhook_events (provider, received_at) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS model_registry (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    label TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    provider_class TEXT NOT NULL CHECK (provider_class IN ('anthropic', 'openai_compatible')),
    base_url TEXT,
    api_key_env_var TEXT NOT NULL,
    model_name TEXT NOT NULL,
    capability_tags TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    measured_fitness TEXT NOT NULL DEFAULT '{}',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS model_registry_active_label_uidx ON model_registry (label) WHERE is_active;
CREATE INDEX IF NOT EXISTS model_registry_label_priority_idx ON model_registry (label, priority DESC);
CREATE TRIGGER IF NOT EXISTS model_registry_touch AFTER UPDATE ON model_registry
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE model_registry SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS model_usage_log (
    id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()),
    workspace_id TEXT,
    model TEXT NOT NULL,
    query_type TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    latency_ms REAL,
    efficiency_score REAL,
    tokens_per_second REAL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS model_usage_log_created_idx ON model_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS model_usage_log_model_idx ON model_usage_log (model);
