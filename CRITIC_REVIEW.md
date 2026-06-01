# Critic Review — getToken() stale-closure fix

**Reviewed:** 2026-06-01  
**Scope:** `getToken()` inside venture-fetch `useEffect` in `ask/page.tsx`, and the OAuth callback `useEffect` in `connect/page.tsx`  
**Verdict:** LGTM — one observation, no blockers

---

## What changed

Two files were touched:

| File | Changed site | Old | New |
|---|---|---|---|
| `ask/page.tsx` | venture-fetch `useEffect` (deps: `[user, fetchedVenture]`) | `if (!token) return` / `Bearer ${token}` | `const t = getToken()` / `Bearer ${t}` |
| `connect/page.tsx` | OAuth callback `useEffect` (deps: `[]`) | `if (!token) return` / `Bearer ${token}` | `const t = getToken()` / `Bearer ${t}` |

---

## Analysis

### connect/page.tsx — REQUIRED, CORRECT

The OAuth callback effect runs with `deps: []` (line 50: `// eslint-disable-next-line react-hooks/exhaustive-deps`). A mount-only effect fires before `useAuth()` has hydrated `token` from localStorage — `token` is `null` at that point. The old code would hit `if (!token) return` and silently bail, never advancing the onboarding step from 1→2 after a successful GitHub OAuth redirect.

Switching to `getToken()` — a direct synchronous `localStorage.getItem` call — reads the real token at call time, bypassing the stale closure. This is both necessary and exactly the pattern documented in LEARNINGS.md (2026-06-01 entry on `useEffect` with `deps: []`).

The error path (`throw new Error(...)` → `.catch(e => setError(...))`) and the success path (`router.push('/onboarding/ask')`) are unchanged and correct.

### ask/page.tsx — DEFENSIVE, NOT STRICTLY NECESSARY

The venture-fetch `useEffect` has `deps: [user, fetchedVenture]` (line 47). The effect body is gated at line 34:

```tsx
if (!user || fetchedVenture) return
```

Because `user` must be truthy for any code past line 34 to execute, and `useAuth()` hydrates `user` and `token` from the same source in the same render, `token` from the closure is already populated by the time `getToken()` would be called. The stale-closure scenario the fix targets cannot materialize here.

That said, the change is not wrong. It eliminates an implicit closure dependency on `token` that ESLint's exhaustive-deps rule would flag (since `token` is used inside the effect but absent from the dep array), and it makes the pattern consistent with `connect/page.tsx`. No regression is introduced.

### Unchanged code — correctly left alone

Both files continue to use `token` (from `useAuth()`) in event handlers:
- `ask/page.tsx` `handleFirstAnswer()` — line 50–53: fires only after the UI renders; auth is hydrated by that point. Correct.
- `connect/page.tsx` `startConnect()` — line 53: same reasoning. Correct.

These sites should NOT be converted to `getToken()` — they are fine.

---

## Issues

None that block merge.

**Observation (non-blocking):** The `ask/page.tsx` hunk is cosmetic in effect. The commit message should note that the real fix is in `connect/page.tsx` (the `deps: []` effect) and the `ask/page.tsx` change is a consistency cleanup, not a bug fix. Otherwise a future engineer reading git blame may misread the ask-page change as evidence that `deps: [user, ...]` effects also had a stale-token problem.

---

**Verdict: LGTM** — `connect/page.tsx` fix is correct and necessary; `ask/page.tsx` is harmless defensive cleanup. No regressions, no new issues introduced.
