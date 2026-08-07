-- 017_cloud_sync_foundation.sql
-- Phase 7a: updated_at triggers on projects/ideas (matching agent_memory_touch)
-- plus cloud_sync_link pairing table. No actual content sync in this phase.
-- Idempotent — safe to re-run.

-- ─── projects.updated_at ─────────────────────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE projects SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;
ALTER TABLE projects ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE projects ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION projects_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_touch ON projects;
CREATE TRIGGER projects_touch
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION projects_touch_updated_at();

-- ─── ideas.updated_at ────────────────────────────────────────────────────────
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE ideas SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;
ALTER TABLE ideas ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE ideas ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION ideas_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ideas_touch ON ideas;
CREATE TRIGGER ideas_touch
    BEFORE UPDATE ON ideas
    FOR EACH ROW
    EXECUTE FUNCTION ideas_touch_updated_at();

-- ─── cloud_sync_link (pairing only — tokens stay in Electron safeStorage) ───
CREATE TABLE IF NOT EXISTS cloud_sync_link (
    workspace_id        UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    cloud_workspace_id  UUID NOT NULL,
    cloud_user_id       UUID NOT NULL,
    cloud_email         TEXT,
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_synced_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cloud_sync_link_cloud_ws_idx
    ON cloud_sync_link (cloud_workspace_id);
