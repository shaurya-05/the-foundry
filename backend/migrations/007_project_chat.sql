-- Migration 007: Per-project copilot chat + project notes

ALTER TABLE copilot_messages ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS copilot_messages_project_idx ON copilot_messages(project_id, created_at DESC);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
