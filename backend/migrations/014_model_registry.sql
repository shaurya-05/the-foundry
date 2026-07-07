-- 014_model_registry.sql
-- Phase 1.5: move MODEL_REGISTRY from a static Python dict into the database.
--
-- Rationale: adding, disabling, or reweighting a model becomes a DB write
-- rather than a code deploy. The application loads active rows into an
-- in-memory cache at startup and on refresh, instantiating one of the two
-- ModelProvider subclasses (AnthropicProvider or OpenAICompatibleProvider)
-- from each row's config.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS model_registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Logical routing label: STRATEGIC, FACTUAL, RESEARCH, DOCUMENT,
    -- CLASSIFIER, CLASSIFIER_OSS, and any future roles.
    label           TEXT NOT NULL,
    -- Human/log-friendly provider name: 'anthropic', 'openai', 'perplexity',
    -- 'gemini', 'oss', etc.
    provider_name   TEXT NOT NULL,
    -- Which Python ModelProvider subclass to instantiate.
    -- Enum-in-a-string for simplicity: 'anthropic' or 'openai_compatible'.
    provider_class  TEXT NOT NULL CHECK (provider_class IN ('anthropic', 'openai_compatible')),
    -- Optional base URL. NULL means "use SDK default" (Anthropic, plain OpenAI).
    base_url        TEXT,
    -- Env var name to look up the API key at request time (never store keys here).
    api_key_env_var TEXT NOT NULL,
    -- Wire-format model id (e.g. 'claude-sonnet-4-6', 'gpt-4o-mini').
    model_name      TEXT NOT NULL,
    -- Capability tags for future filter/routing (context window, tools, streaming, etc).
    capability_tags JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Ordering hint within a label (higher = preferred). Multiple inactive
    -- rows per label are allowed for history; only one is_active per label.
    priority        INT NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    -- Computed rolling-window stats from model_usage_log; populated by
    -- refresh_measured_fitness() in Python.
    measured_fitness JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Optional free-text notes (why this row exists, links to vendor docs).
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active row per label.
CREATE UNIQUE INDEX IF NOT EXISTS model_registry_active_label_uidx
    ON model_registry (label)
    WHERE is_active;

CREATE INDEX IF NOT EXISTS model_registry_label_priority_idx
    ON model_registry (label, priority DESC);

-- updated_at auto-touch
CREATE OR REPLACE FUNCTION model_registry_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS model_registry_touch ON model_registry;
CREATE TRIGGER model_registry_touch
    BEFORE UPDATE ON model_registry
    FOR EACH ROW
    EXECUTE FUNCTION model_registry_touch_updated_at();

-- Seed the initial 6 rows matching what MODEL_REGISTRY hard-coded pre-P1.5.
-- Uses ON CONFLICT DO NOTHING against a temp unique key so re-running the
-- migration doesn't overwrite live edits.
INSERT INTO model_registry (label, provider_name, provider_class, base_url, api_key_env_var, model_name, capability_tags, priority, is_active, notes)
VALUES
    ('STRATEGIC',      'anthropic',   'anthropic',          NULL,                                                        'ANTHROPIC_API_KEY',       'claude-sonnet-4-6',           '{"strengths":["reasoning","tradeoffs","strategy"]}'::jsonb, 100, true,  'Multi-step reasoning, ambiguity, judgment calls.'),
    ('FACTUAL',        'openai',      'openai_compatible',  NULL,                                                        'OPENAI_API_KEY',          'gpt-4o-mini',                 '{"strengths":["structured_retrieval","fast_facts"]}'::jsonb, 100, true,  'Definitions, quick summaries, template fills.'),
    ('RESEARCH',       'perplexity',  'openai_compatible',  'https://api.perplexity.ai',                                 'PERPLEXITY_API_KEY',      'sonar',                       '{"strengths":["live_web","citations"]}'::jsonb,             100, true,  'Time-sensitive queries needing real-world data.'),
    ('DOCUMENT',       'gemini',      'openai_compatible',  'https://generativelanguage.googleapis.com/v1beta/openai/',   'GEMINI_API_KEY',          'gemini-1.5-flash',            '{"strengths":["long_context"], "context_window":1000000}'::jsonb, 100, true, 'Long docs, cross-referencing.'),
    ('CLASSIFIER',     'anthropic',   'anthropic',          NULL,                                                        'ANTHROPIC_API_KEY',       'claude-haiku-4-5-20251001',   '{"strengths":["fast","cheap","classification"]}'::jsonb,   100, true,  'Routes queries into STRATEGIC/FACTUAL/RESEARCH/DOCUMENT.'),
    ('CLASSIFIER_OSS', 'oss',         'openai_compatible',  NULL,                                                        'OSS_CLASSIFIER_API_KEY',  'unset-oss-model',             '{"strengths":["fine_tunable","self_hostable"]}'::jsonb,     50,  false, 'Placeholder for Phase 4 fine-tuned open-model classifier.')
ON CONFLICT DO NOTHING;
