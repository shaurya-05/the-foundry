-- ════════════════════════════════════════════════════════════════════════════
-- Migration 013 — Weekly Digest Tracking
-- ════════════════════════════════════════════════════════════════════════════
--
-- Adds last_digest_sent_at to workspaces so the weekly digest job can
-- deduplicate sends and avoid re-sending to the same workspace within 7 days.

ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS workspaces_digest_idx ON workspaces(last_digest_sent_at);
