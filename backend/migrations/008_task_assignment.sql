-- Migration 008: Task assignment
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assignee_id);
