-- Migration 002: Collaboration + Visibility system
-- Adds: visibility/clearance to core tables, blueprint canvas, workspace members, invitations

-- ─── Visibility columns on core tables ──────────────────────────────────────
-- visibility: 'private' | 'team' | 'public'
-- clearance_level: 0=stealth, 1=draft, 2=ready, 3=shipped

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS clearance_level INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ideas
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS clearance_level INTEGER NOT NULL DEFAULT 0;

ALTER TABLE knowledge_items
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'team';

-- ─── Workspace Members ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member | viewer
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_ws_idx ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id);

-- Seed default owner into workspace_members
INSERT INTO workspace_members (workspace_id, user_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

-- ─── Workspace Invitations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES users(id),
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
    accepted BOOLEAN DEFAULT false,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Blueprint Canvas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blueprint_canvas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
    nodes JSONB NOT NULL DEFAULT '[]',
    edges JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS blueprint_canvas_ws_idx ON blueprint_canvas(workspace_id);

-- Seed empty canvas for default workspace
INSERT INTO blueprint_canvas (workspace_id, nodes, edges)
VALUES ('00000000-0000-0000-0000-000000000001', '[]', '[]')
ON CONFLICT (workspace_id) DO NOTHING;

-- ─── Blueprint Op Log (for real-time collaboration) ──────────────────────────
CREATE TABLE IF NOT EXISTS blueprint_ops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    op_type TEXT NOT NULL,  -- add_node | move_node | delete_node | update_node
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS blueprint_ops_ws_idx ON blueprint_ops(workspace_id, created_at DESC);
