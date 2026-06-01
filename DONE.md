# Done

## Fix: stale closure in venture-fetch useEffect (ask/page.tsx)

**File:** `frontend/app/(app)/onboarding/ask/page.tsx`

**Problem:** The venture-fetch `useEffect` (deps: `[user, fetchedVenture]`) read `token` from the `useAuth()` closure. Because `useAuth()` hydrates `token` from localStorage asynchronously, `token` is `null` at mount when the effect runs — the fetch never fires.

**Fix:**
- Added `getToken` to the import from `@/lib/auth`
- Replaced `if (!token) return` + `Bearer ${token}` with `const t = getToken(); if (!t) return` + `Bearer ${t}` inside the venture-fetch `useEffect` only
- `token` from `useAuth()` left intact in `handleFirstAnswer` (user-triggered, not affected by the hydration race)

Pattern matches `connect/page.tsx` OAuth callback handler.
