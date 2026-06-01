# DONE

## Task: Add missing Secure attribute to clearTokens cookie deletion

**File:** `frontend/lib/auth.tsx`
**Function:** `clearTokens` (line 55)

### Change
Added the same `isSecure` conditional used in `storeTokens` and `tryRefresh` to the cookie deletion string in `clearTokens`.

**Before:**
```ts
document.cookie = 'foundry_token=; path=/; SameSite=Lax; max-age=0'
```

**After:**
```ts
const isSecure = typeof window !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
document.cookie = `foundry_token=; path=/; SameSite=Lax${isSecure}; max-age=0`
```

### Why
Cookie deletion must use the same attributes as creation. If the cookie was created with `; Secure` (on HTTPS), a delete without `; Secure` targets a different cookie slot and the logout fails silently — the cookie remains in the browser.

### Status
Complete. No other files changed.
