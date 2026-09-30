-- ─── Stage 2: Observability ──────────────────────────────────────────────────
-- One request — goal in, agent loop, model calls, tool executions, response out
-- — is one trace, readable end to end. Spans form a tree via parent_span_id.
--
-- Retention is defined here rather than deferred, because the brief is right
-- that this is exactly what silently fills a disk: one machine, no autoscaling,
-- and a span row per model call and tool execution. `spans_created_at_idx`
-- exists specifically so the retention sweep is cheap, not for querying.

CREATE TABLE IF NOT EXISTS spans (
    span_id UUID PRIMARY KEY,
    trace_id UUID NOT NULL,
    parent_span_id UUID,

    -- Which of the five Stage 3 services emitted this. Recorded now so that
    -- when implementations move behind contracts in Stage 4, the traces from
    -- before and after the move are comparable rather than incomparable.
    service TEXT NOT NULL,
    name TEXT NOT NULL,

    workspace_id UUID,
    actor_id UUID,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_ms DOUBLE PRECISION,

    status TEXT NOT NULL DEFAULT 'ok',
    error TEXT,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS spans_trace_idx ON spans(trace_id, started_at);
CREATE INDEX IF NOT EXISTS spans_created_at_idx ON spans(started_at);
CREATE INDEX IF NOT EXISTS spans_workspace_idx ON spans(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS spans_name_idx ON spans(service, name, started_at DESC);

-- Metrics that are not derivable from a span's own duration: circuit-breaker
-- transitions, VRAM samples, reflection-criterion outcomes. Kept separate from
-- spans because they are not request-scoped -- a VRAM sample belongs to a
-- moment, not to a request.
CREATE TABLE IF NOT EXISTS metric_samples (
    id BIGSERIAL PRIMARY KEY,
    metric TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    labels JSONB NOT NULL DEFAULT '{}'::jsonb,
    trace_id UUID,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS metric_samples_metric_idx ON metric_samples(metric, recorded_at DESC);
CREATE INDEX IF NOT EXISTS metric_samples_recorded_idx ON metric_samples(recorded_at);
