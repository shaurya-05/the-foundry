# Context Transparency Panel — [2026-05-31] (session 2 polish)

Prior checkpoint had the panel ~95% complete. This session:
- Removed redundant inline `text-[10px]` context count above COFOUND3R label (panel is now sole display)
- Fixed collapsed button font: `text-[10px]` → `text-xs` to match spec

Final state: collapsible `border border-n200 bg-vellum` panel below each answer; `text-xs font-mono text-n600` collapsed line with counts; expanded shows `context_md`; chevron rotates; per-exchange state via `expandedPanels[i]`; no new API calls; `ask()` untouched.

---

# Usage Tracking — Agent & Copilot Endpoints

## What was done

Wired `check_limit` / `increment_usage` from `app.services.usage` into both streaming endpoints.

### backend/app/routers/agent.py
- Added `from app.services.usage import check_limit, increment_usage`
- In `ask()`: `await check_limit(auth.workspace_id, 'agent_runs')` before streaming; raises `HTTPException(429)` if over limit
- In `event_stream()` generator: `await increment_usage(auth.workspace_id, 'agent_runs')` as first line (executes once streaming actually begins)

### backend/app/routers/copilot.py
- Added `from app.services.usage import check_limit, increment_usage` as top-level import (removed the deferred inline import)
- Replaced `RequireUsage("copilot_messages")` dependency with `require_auth` + explicit `await check_limit(...)` in handler body; raises `HTTPException(429, detail='Copilot message limit reached')` if over limit
- Moved `await increment_usage(auth.workspace_id, 'copilot_messages')` into `stream_and_save()` generator (was previously called before streaming began)
- Added `HTTPException` to the fastapi import line

## Tests
No test files existed for these routers — none written.

## Behavior
- Requests over plan limit are rejected with HTTP 429 before any context building or model calls
- Usage is only incremented once streaming actually begins, preventing phantom counts from requests that fail mid-flight after the check
- Early-access workspaces with `limit == -1` are unlimited and pass `check_limit` without touching usage counters

---

# Fix frontend API_BASE and token retrieval — 2026-05-31

### Change 1: frontend/lib/streaming.ts
- Removed hardcoded `const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'`
- Added `import { API_URL } from '@/lib/config'`
- Replaced all three `API_BASE` references with `API_URL` (initial fetch, refresh fetch, retry fetch)

### Change 2: frontend/lib/auth.ts (new file)
- Created `getToken(): string | null` helper guarding SSR and reading from `localStorage`
- No exported `getToken` or equivalent existed in any lib file

### Change 3: frontend/app/(app)/agents/AgentsClient.tsx
- Added `import { getToken } from '@/lib/auth'`
- Replaced inline `localStorage.getItem('foundry_token')` with `getToken()`

### Notes
- `frontend/lib/api.ts` also hardcodes `API_BASE` — not touched (out of scope)
- `streaming.ts` private `getAuthHeader()` still calls `localStorage` directly — out of scope per task instructions

---

# api.ts + streaming.ts final cleanup [2026-05-31]

**frontend/lib/api.ts**
- Removed hardcoded `const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'`
- Added `import { API_URL } from '@/lib/config'`
- Replaced all `API_BASE` occurrences with `API_URL`

**frontend/lib/streaming.ts**
- Added `import { getToken } from '@/lib/auth'`
- Replaced `getAuthHeader()` body: removed inline `localStorage.getItem('foundry_token')` and redundant SSR guard; now delegates to `getToken()` which already handles SSR

---

# Backend fixes — model bump, stream_sse removal, embed caching [2026-05-31]

## 1. claude.py — model bump + stream_sse removal
- `MODEL` updated `claude-sonnet-4-5` → `claude-sonnet-4-6`
- `stream_sse` function deleted entirely (was a thin SSE wrapper over `stream_claude`)

## 2. copilot.py — stream_sse → stream_claude, inline SSE formatting
- Import changed: `stream_sse` → `stream_claude`; `import json` hoisted to module level
- `stream_and_save` rewritten: iterates raw text chunks from `stream_claude`, formats
  `data: {"type":"text_delta","text":"..."}\n\n` inline, accumulates raw text directly
  into `full_text` list — no post-hoc SSE parsing needed
- `RequireUsage` was already absent (removed in prior run); no action taken for that part

## 3. agent_retrieval.py — Redis caching for embed_text
- Imports added: `hashlib`, `cache_get`, `cache_set` from `app.db.cache`
- Cache key: `embed:{sha256(question[:200])}`; TTL 300 s
- On cache hit: skips Voyage API call entirely
- All other logic (graceful degradation, semantic search) unchanged
