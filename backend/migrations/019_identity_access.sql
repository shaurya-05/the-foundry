-- ─── Stage 1: Identity & Access ──────────────────────────────────────────────
-- Org → Team → Member, with roles and permissions stored as DATA, not as code
-- constants. Adding `ml_engineer` or `robotics_engineer` later is INSERTs only:
-- no migration, no deploy, no code change. That is the design constraint the
-- Foundation brief sets, and it is why there is no role-rank column anywhere in
-- this file — scoped roles are peers, not rungs on a ladder.
--
-- Org is the existing `workspaces` table. Workspaces already carry billing and
-- membership, so they already are the org; adding a parallel tenant layer would
-- mean two sources of truth for the same thing. Teams hang beneath.

-- ─── Teams ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS teams_workspace_idx ON teams(workspace_id);

-- Exactly one default team per workspace — the landing place for members who
-- have not been assigned anywhere else.
CREATE UNIQUE INDEX IF NOT EXISTS teams_one_default_per_workspace
    ON teams(workspace_id) WHERE is_default;

-- ─── Permissions ─────────────────────────────────────────────────────────────
-- A permission is a named capability. Endpoints name the capability they need,
-- which is what stops a second endpoint quietly reaching the same capability
-- without declaring it.
CREATE TABLE IF NOT EXISTS permissions (
    key TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO permissions (key, description) VALUES
    ('admin.read',     'View admin dashboard, health, and model statistics'),
    ('admin.write',    'Trigger admin operations: digests, registry refresh'),
    ('trace.read',     'Read execution traces and observability data'),
    ('deploy.execute', 'Deploy and restart services'),
    ('model.read',     'Read model registry, routing, and fitness data'),
    ('model.write',    'Modify model registry entries and routing configuration'),
    ('memory.read',    'Read agent memory and provenance'),
    ('memory.write',   'Write or compact agent memory'),
    ('access.manage',  'Create and modify teams, roles, and role assignments'),
    ('audit.read',     'Read the audit log')
ON CONFLICT (key) DO NOTHING;

-- ─── Roles ───────────────────────────────────────────────────────────────────
-- workspace_id NULL means a built-in role shared by every org. A non-NULL
-- workspace_id is an org-defined role. Built-ins cannot be deleted; that is
-- enforced by a trigger below rather than by convention.
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique indexes because NULL workspace_id would defeat a plain
-- UNIQUE(workspace_id, name).
CREATE UNIQUE INDEX IF NOT EXISTS roles_builtin_name_uniq
    ON roles(name) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS roles_org_name_uniq
    ON roles(workspace_id, name) WHERE workspace_id IS NOT NULL;

INSERT INTO roles (workspace_id, name, description, is_builtin) VALUES
    (NULL, 'owner',    'Full access including access control and audit log', TRUE),
    (NULL, 'engineer', 'Full code, deploy, trace, dashboard and health access', TRUE),
    (NULL, 'observer', 'Read-only across everything', TRUE)
ON CONFLICT DO NOTHING;

-- ─── Role → Permission grants ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_id, permission_key)
);

-- owner: everything, explicitly enumerated rather than implied by a wildcard.
-- A wildcard would mean new permissions silently grant themselves to owner,
-- which is the behaviour you want right up until it isn't.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r CROSS JOIN permissions p
WHERE r.workspace_id IS NULL AND r.name = 'owner'
ON CONFLICT DO NOTHING;

-- engineer: everything operational; nothing that changes who can do what.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r CROSS JOIN permissions p
WHERE r.workspace_id IS NULL AND r.name = 'engineer'
  AND p.key IN ('admin.read', 'admin.write', 'trace.read', 'deploy.execute',
                'model.read', 'model.write', 'memory.read')
ON CONFLICT DO NOTHING;

-- observer: reads only. Note memory.write and audit.read are both absent —
-- audit.read is owner-only by the brief's table.
INSERT INTO role_permissions (role_id, permission_key)
SELECT r.id, p.key
FROM roles r CROSS JOIN permissions p
WHERE r.workspace_id IS NULL AND r.name = 'observer'
  AND p.key IN ('admin.read', 'trace.read', 'model.read', 'memory.read')
ON CONFLICT DO NOTHING;

-- ─── Team membership, where roles actually attach ────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members(user_id);
CREATE INDEX IF NOT EXISTS team_members_team_idx ON team_members(team_id);

-- ─── Audit log ───────────────────────────────────────────────────────────────
-- Append-only, enforced structurally. `owner` reads it; nobody edits it,
-- including code paths that think they have a good reason.
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    before_state JSONB,
    after_state JSONB,
    outcome TEXT NOT NULL DEFAULT 'allowed',
    trace_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_workspace_idx ON audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log(action, created_at DESC);

CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

-- Built-in roles are not deletable. Same reasoning as the audit trigger:
-- a guarantee that lives only in application code is a guarantee until someone
-- writes a second application.
CREATE OR REPLACE FUNCTION roles_protect_builtin() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_builtin THEN
        RAISE EXCEPTION 'built-in role % cannot be deleted', OLD.name;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roles_no_delete_builtin ON roles;
CREATE TRIGGER roles_no_delete_builtin
    BEFORE DELETE ON roles
    FOR EACH ROW EXECUTE FUNCTION roles_protect_builtin();

-- ─── Backfill: every existing workspace gets a default team, every existing
--     member gets a mapped role. Nothing that works today stops working.
INSERT INTO teams (workspace_id, name, description, is_default)
SELECT w.id, 'Default', 'Default team created by the Stage 1 identity migration', TRUE
FROM workspaces w
WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.workspace_id = w.id AND t.is_default)
ON CONFLICT DO NOTHING;

-- owner/admin → owner, member → engineer, viewer → observer.
-- `admin` maps to `owner` because the legacy admin role could already modify
-- workspace roles, and silently demoting a live user mid-migration would be a
-- worse failure than granting one person more than the new model strictly needs.
INSERT INTO team_members (team_id, user_id, role_id)
SELECT t.id, wm.user_id, r.id
FROM workspace_members wm
JOIN teams t ON t.workspace_id = wm.workspace_id AND t.is_default
JOIN roles r ON r.workspace_id IS NULL AND r.name = CASE
        WHEN wm.role IN ('owner', 'admin') THEN 'owner'
        WHEN wm.role = 'viewer' THEN 'observer'
        ELSE 'engineer'
    END
WHERE wm.user_id IS NOT NULL
ON CONFLICT (team_id, user_id) DO NOTHING;
