-- ════════════════════════════════════════════════════════════════════════════
-- Migration 010 — Onboarding Step Tracking
-- ════════════════════════════════════════════════════════════════════════════
-- Adds onboarding_step to workspaces so the frontend can gate new users
-- through the onboarding flow before landing on the main dashboard.
--
-- Step semantics:
--   0 = not started (new workspace)
--   1 = venture created (step 1 complete)
--   2+ = reserved for future onboarding steps
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0 NOT NULL;
