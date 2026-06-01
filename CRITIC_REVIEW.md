# Code Review

**Reviewer:** Critic agent  
**Date:** 2026-05-31  
**Stated scope:** one fix — conditional `Secure` attribute on `clearTokens` cookie deletion  
**Actual diff covers:** `frontend/lib/auth.tsx` (3 sites) + `backend/app/routers/ventures.py`

---

## frontend/lib/auth.tsx

### `clearTokens` (lines 58–59) — PRIMARY FIX

The original deletion string was:
```
foundry_token=; path=/; Secure; max-age=0
```

Two bugs were present:
1. **Missing `SameSite=Lax`** — Chrome 80+ treats a cookie with `SameSite=Lax` and a deletion without `SameSite=Lax` as different cookies. The deletion would silently fail, leaving a stale `foundry_token` cookie in the browser.
2. **Hardcoded `Secure`** — deletion over HTTP (localhost) would silently fail because the browser ignores `Secure` cookie operations on non-HTTPS origins.

The fix adds both `SameSite=Lax` and the conditional `Secure`, matching the creation string exactly. **This is correct.**

### `storeTokens` (lines 51–52) and `tryRefresh` (lines 74–75)

These two sites also had hardcoded `Secure` (no `SameSite` issue here — they already had it). The fix applies the same conditional pattern. **Both are correct.**

### Minor: redundant `typeof window !== 'undefined'` guard

At all three sites:
```js
const isSecure = typeof window !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
```

The `typeof window !== 'undefined'` branch is dead code. All three functions already directly call `document.cookie` or `localStorage`, which throw on the server before this expression is ever evaluated. The guard is harmless but misleading — it implies these functions are safe to call server-side when they are not.

This is a pattern sourced from LEARNINGS.md, so the agent followed documented guidance. Not a bug, but worth noting that the defensive check does nothing here.

### Minor: tripled expression

The same 79-character `isSecure` expression is copy-pasted identically at three call sites. A module-level helper (`function secureFlag()`) would eliminate the repetition, but that's a refactor outside the fix's scope.

---

## backend/app/routers/ventures.py

### Out of scope, but present

The stated commit scope is "conditional Secure attribute on clearTokens cookie deletion." This file is unrelated to cookies or auth.tsx. Bundling it silently into the same commit makes the scope description misleading.

### The actual change (lines 78–83)

```python
current = await conn.fetchval(
    "SELECT onboarding_step FROM workspaces WHERE id=$1",
    auth.workspace_id,
)
if current is not None and req.step <= current:
    raise HTTPException(status_code=400, detail="step must advance")
```

Logic is correct and matches LEARNINGS.md guidance ("Forward-only state transitions should be enforced server-side"). The `current is not None` guard handles a missing workspace row safely.

### Minor: TOCTOU window

The SELECT and UPDATE run sequentially without a transaction or `FOR UPDATE` lock. Concurrent PATCH requests from the same user could both read the same `current` value and both advance past it. For an onboarding flow this race is nearly impossible in practice, but it is a real gap. A single atomic statement (`UPDATE ... WHERE onboarding_step < $1 RETURNING onboarding_step`) would close it and eliminate the round-trip.

### Minor: silent no-op if workspace missing

If `current is None` (workspace row absent), the code falls through to the UPDATE which affects 0 rows and returns `{"ok": True, "step": req.step}` — a successful lie. This was a pre-existing bug; the change does not make it worse, but the added SELECT creates an opportunity to detect it. Not required by this fix.

---

## Summary

| Location | Finding | Severity |
|----------|---------|----------|
| `auth.tsx:59` — clearTokens deletion | Missing `SameSite=Lax` + hardcoded `Secure` both fixed | **Bug fixed correctly** |
| `auth.tsx:52, 75` — storeTokens, tryRefresh | Conditional `Secure` fix consistent | **Correct** |
| `auth.tsx:51,58,74` — `typeof window` guard | Redundant dead code, follows LEARNINGS pattern | Minor / cosmetic |
| `auth.tsx` — isSecure tripled | Copy-paste repetition | Minor / out of scope |
| `ventures.py` — forward-only guard | Correct logic, but undocumented in commit scope | Bundling concern |
| `ventures.py:78–83` — TOCTOU | SELECT + UPDATE not atomic | Minor / pre-existing gap |

---

## Verdict

**PASS** — The cookie fix is correct and complete. Both bugs in the original `clearTokens` (missing `SameSite=Lax` and hardcoded `Secure`) are resolved. The `storeTokens` and `tryRefresh` changes are consistent improvements. The `ventures.py` forward-only guard is logically correct. No regressions introduced. Minor issues noted are cosmetic or pre-existing.
