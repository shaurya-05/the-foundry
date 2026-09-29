-- ─── Stage 4 / V-08: the table the code has always assumed existed ──────────
-- `014_model_registry.sql` mentions model_usage_log in a comment; nothing ever
-- created it. Meanwhile ai_router.py has been INSERTing into it inside a
-- try/except that swallows the failure, and admin.py selects from it for the
-- model-stats page.
--
-- So on any database built from the migration chain -- every CI run, every new
-- developer, and any rebuild of production -- every model usage write has been
-- failing silently and the model-stats page has been empty. It worked only
-- where somebody had created the table by hand at some point.
--
-- Same family as the 000b/000c bug Stage 0 existed to eliminate: code depending
-- on schema no migration creates, invisible because nobody rebuilt from cold.
-- This one survived Stage 0 because the swallowing `except` meant nothing ever
-- complained. The except is removed in the same change as this migration; a
-- table that exists but whose write errors are still hidden has only half a fix.
--
-- Columns match what ai_router.log_model_usage() actually writes and what
-- admin.py actually groups by, rather than what either of them might want.

CREATE TABLE IF NOT EXISTS model_usage_log (
    id BIGSERIAL PRIMARY KEY,
    model TEXT NOT NULL,
    query_type TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
    latency_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    efficiency_score INTEGER,
    tokens_per_second DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- admin.py groups by (model, query_type); the fitness refresh reads a recent
-- window. Both are covered rather than leaving the group-by to a sequential scan.
CREATE INDEX IF NOT EXISTS model_usage_log_model_type_idx
    ON model_usage_log(model, query_type);
CREATE INDEX IF NOT EXISTS model_usage_log_created_idx
    ON model_usage_log(created_at DESC);
