-- 015_agent_memory.sql
-- Phase 3, Task 1: minimal per-user persistent memory store for the
-- agent loop (Stage 4, not built yet). Deliberately simple -- a JSONB
-- array of provenance-tagged entries per (workspace_id, user_id), not a
-- vector-search/chunked memory system.
--
-- Idempotent -- safe to re-run.

CREATE TABLE IF NOT EXISTS agent_memory (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Array of {"text": str, "source": "user_stated"|"agent_inferred",
    -- "created_at": iso8601}. Source provenance is required per entry so
    -- a future planning/reflection step can distinguish a durable fact
    -- the user explicitly stated from something the agent inferred on
    -- its own -- agent-inferred entries are meant to require separate
    -- confirmation before being trusted (enforced by the loop once it
    -- exists, not by this table).
    content       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- updated_at auto-touch, same pattern as model_registry_touch (014).
CREATE OR REPLACE FUNCTION agent_memory_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_memory_touch ON agent_memory;
CREATE TRIGGER agent_memory_touch
    BEFORE UPDATE ON agent_memory
    FOR EACH ROW
    EXECUTE FUNCTION agent_memory_touch_updated_at();
