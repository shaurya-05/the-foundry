-- Migration 005: Pricing tiers, subscriptions, usage tracking

-- ─── Plans (reference table) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_monthly INTEGER NOT NULL DEFAULT 0,
    price_yearly INTEGER NOT NULL DEFAULT 0,
    limits JSONB NOT NULL DEFAULT '{}'
);

INSERT INTO plans (id, name, price_monthly, price_yearly, limits) VALUES
('spark', 'Spark', 0, 0, '{
    "copilot_messages": 25,
    "agent_runs": 10,
    "forge_operations": 3,
    "pipeline_runs": 0,
    "projects": 3,
    "knowledge_items": 50,
    "team_members": 1,
    "workspaces": 1
}'),
('pro', 'Pro', 1600, 14400, '{
    "copilot_messages": 500,
    "agent_runs": 100,
    "forge_operations": 50,
    "pipeline_runs": 20,
    "projects": -1,
    "knowledge_items": 500,
    "team_members": 1,
    "workspaces": 1
}'),
('forge_team', 'Forge Team', 2800, 26400, '{
    "copilot_messages": 1000,
    "agent_runs": 200,
    "forge_operations": 100,
    "pipeline_runs": 50,
    "projects": -1,
    "knowledge_items": -1,
    "team_members": 25,
    "workspaces": -1
}')
ON CONFLICT (id) DO NOTHING;

-- ─── Subscriptions (1:1 with workspaces) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES plans(id) DEFAULT 'spark',
    status TEXT NOT NULL DEFAULT 'active',
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id)
);

-- ─── Usage Tracking (per workspace per billing period) ──────────────────────
CREATE TABLE IF NOT EXISTS usage_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    copilot_messages INTEGER NOT NULL DEFAULT 0,
    agent_runs INTEGER NOT NULL DEFAULT 0,
    forge_operations INTEGER NOT NULL DEFAULT 0,
    pipeline_runs INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, period_start)
);

CREATE INDEX IF NOT EXISTS usage_tracking_ws_period_idx
    ON usage_tracking(workspace_id, period_start DESC);

-- ─── Default all existing workspaces to Spark ───────────────────────────────
INSERT INTO subscriptions (workspace_id, plan_id, status)
SELECT id, 'spark', 'active' FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;
