-- Migration 003: Auth fields for users + workspaces

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS display_name  TEXT,
  ADD COLUMN IF NOT EXISTS avatar_color  TEXT DEFAULT '#E8231F';

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS description TEXT;
