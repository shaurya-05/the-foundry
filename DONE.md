# DONE — Onboarding ask page: onFirstAnswer callback verification [2026-06-02]

## Task
Verify and fix the `onFirstAnswer` callback in `frontend/app/(app)/onboarding/ask/page.tsx` and the `isFirst` capture in `AgentsClient.tsx`.

## What was already correct
- `isFirst = exchanges.length === 0` captured on AgentsClient.tsx:99, BEFORE `setExchanges` on line 101 — correct. The `finally` block at line 143 reads the pre-mutation value.
- Cookie pattern: `foundry_onboarding_done=1; path=/; SameSite=Lax` + conditional `; Secure` based on `location.protocol === 'https:'` — matched spec exactly.

## What was fixed

### 1. `getToken()` instead of `useAuth().token` — `ask/page.tsx`
`handleFirstAnswer` was reading `token` from `useAuth()` destructuring. Per LEARNINGS, `useAuth().token` can be null if hydration hasn't completed. Changed to call `getToken()` (direct localStorage read) inside the function. Removed `token` from the `useAuth()` destructure.

### 2. `router.push('/dashboard')` instead of `setShowDashboardLink(true)` — `ask/page.tsx`
Success path was calling `setShowDashboardLink(true)` which shows a "Go to dashboard" button. Spec requires `router.push('/dashboard')` — auto-redirect on success. Changed. The `showDashboardLink` state and button remain as a fallback for the no-token edge case only.

## Files changed
- `frontend/app/(app)/onboarding/ask/page.tsx` — use `getToken()`, auto-redirect on success
- `frontend/app/(app)/agents/AgentsClient.tsx` — added comment confirming `isFirst` pre-mutation capture
