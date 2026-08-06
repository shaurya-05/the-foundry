-- 016_watches.sql
-- Phase 6b: user-created proactive watches. H3RO periodically re-searches
-- the topic and stores a quiet pending_notice when something meaningfully
-- new appears. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS watches (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query              TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at    TIMESTAMPTZ,
    last_seen_summary  TEXT,
    pending_notice     TEXT,
    notice_at          TIMESTAMPTZ,
    cancelled_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS watches_active_idx
    ON watches (workspace_id, user_id)
    WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS watches_due_idx
    ON watches (last_checked_at)
    WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS watches_notice_idx
    ON watches (workspace_id, user_id)
    WHERE pending_notice IS NOT NULL AND cancelled_at IS NULL;
