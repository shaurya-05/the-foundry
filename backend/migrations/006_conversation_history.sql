-- Migration 006: Conversation history, auto-save forge results

-- ─── Copilot conversation history ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,  -- 'user' | 'assistant'
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS copilot_messages_ws_idx
    ON copilot_messages(workspace_id, created_at DESC);

-- ─── Saved forge outputs (ideas forge, launch briefs) ───────────────────────
CREATE TABLE IF NOT EXISTS forge_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,  -- 'idea_forge' | 'launch_brief'
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS forge_outputs_ws_idx
    ON forge_outputs(workspace_id, created_at DESC);
