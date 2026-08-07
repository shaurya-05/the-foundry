-- 018_cloud_sync_pull.sql
-- Phase 7c: separate pull watermark (must not share last_synced_at with push).
-- Idempotent — safe to re-run.

ALTER TABLE cloud_sync_link
    ADD COLUMN IF NOT EXISTS last_pulled_at TIMESTAMPTZ;
