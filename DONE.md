# Fix: Deploy-blocking bugs — onboarding_completed_at migration + onFirstAnswer guard

## Changes

### 1. backend/migrations/012_onboarding_completed_at.sql (new file)
- `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;`
- Idempotent — safe to run on a DB that already has the column.

### 2. frontend/app/(app)/agents/AgentsClient.tsx
- Added `let wasLimitExceeded = false` local variable before the try block in `ask()`.
- Set `wasLimitExceeded = true` in the `catch` branch that handles `LimitExceededError`.
- Changed the `finally` guard from `if (isFirst && onFirstAnswer)` to `if (isFirst && !wasLimitExceeded && onFirstAnswer)`.
- This ensures a user who hits their Spark limit (429) during onboarding is NOT incorrectly marked as having completed onboarding.

## Root cause
The `finally` block in `ask()` unconditionally called `onFirstAnswer()` regardless of the catch branch taken. Since `setExchanges` is async (state update), the `limitExceeded` flag on the exchange object cannot be read back synchronously in `finally` — a synchronous local variable is the correct pattern.
