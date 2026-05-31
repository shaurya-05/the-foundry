# DONE

**Task:** Cleanup hardcoded API_BASE and raw localStorage token access in frontend/lib/

**Date:** 2026-05-31

## Findings

Both changes were already applied in a prior session before this task ran:

1. **`frontend/lib/api.ts`** — Line 1 already imports `API_URL` from `@/lib/config`. No hardcoded `API_BASE` constant exists anywhere in the file.

2. **`frontend/lib/streaming.ts`** — Line 2 already imports `getToken` from `@/lib/auth`. `getAuthHeader()` (lines 4–7) already calls `getToken()` instead of `localStorage.getItem('foundry_token')` directly.

Both upstream exports confirmed present:
- `API_URL`: exported at `frontend/lib/config.ts:51`
- `getToken`: exported at `frontend/lib/auth.ts:2`

## Action Taken

No code changes required. Both fixes were already in place.
