# CRITIC REVIEW — Migration 012 + onFirstAnswer Guard
**Date:** 2026-06-02
**Scope:** Two fixes — `backend/migrations/012_onboarding_completed_at.sql` and `wasLimitExceeded` guard in `AgentsClient.tsx`

---

## Change 1: `backend/migrations/012_onboarding_completed_at.sql`

```sql
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
```

**Numbering:** Sequential after `011_workspace_plan.sql`. ✓

**Schema:** `TIMESTAMPTZ` matches the spec in LEARNINGS (`[2026-06-02]` entry). ✓

**Idempotency:** `IF NOT EXISTS` guard — safe to re-run on any environment. ✓

**Default:** No `DEFAULT` clause. Correct — `NULL` is the semantic default (not yet completed). Existing workspaces get `NULL`, which is the right signal. ✓

**Backend wiring verified:**
- `ventures.py:86` — `UPDATE workspaces SET onboarding_step=$1, onboarding_completed_at=NOW()` fires when `step >= 3`. The migration backs this write. ✓
- `auth.py:425` — `SELECT ... onboarding_completed_at FROM workspaces` reads the new column. ✓
- `auth.py:448` — `.isoformat() if ws and ws["onboarding_completed_at"] else None` serializes it safely as an ISO string or `null`. ✓

**No issues.**

---

## Change 2: `frontend/app/(app)/agents/AgentsClient.tsx` — `wasLimitExceeded` guard

**Diff summary:**
- Added `let wasLimitExceeded = false` at line 105, before the `try` block.
- Set `wasLimitExceeded = true` at line 135, inside the `catch (e instanceof LimitExceededError)` branch only.
- Changed `finally` at line 146 from `if (isFirst && onFirstAnswer)` to `if (isFirst && !wasLimitExceeded && onFirstAnswer)`.

**Pattern correctness:**
The fix matches the LEARNINGS pattern exactly (`[2026-06-02]`): *"use a synchronous local variable set inside that catch branch, then read the variable in finally — never try to read back the error flag from state."* `setExchanges` is async; `wasLimitExceeded` is synchronous. ✓

**Scope of the flag:** Only `LimitExceededError` sets the flag. The generic `else` branch (network errors, unknown errors) does not. This is correct for the stated scope. See note below.

**`isFirst` capture:** Line 100 — `const isFirst = exchanges.length === 0` — still captured before `setExchanges` on line 102. Pre-mutation capture is unchanged and correct. ✓

**`finally` order:** `setStreaming(false)` runs first, then the `onFirstAnswer` guard. No ordering issue. ✓

**Note — non-blocking, out of scope:** If a generic (non-limit) error occurs on the very first ask, `onFirstAnswer` still fires. This would advance onboarding state on a failed response. This is pre-existing behavior, outside the stated scope of this fix, and the realistic onboarding path makes this edge case unlikely (limit errors are the only expected failure mode in onboarding). Not a regression introduced by this change.

**No issues within scope.**

---

## Verdict

**APPROVED.** Both changes are correct, minimal, and match spec. Migration is idempotent and properly backed by existing backend code. The `wasLimitExceeded` guard applies the LEARNINGS pattern exactly and prevents the onboarding callback from firing on a limit-exceeded exchange.
