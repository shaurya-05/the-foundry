-- Migration 011: Add direct plan tracking to workspaces
-- Enables the billing webhook to stamp plan='growth' without touching subscriptions.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ DEFAULT NULL;
