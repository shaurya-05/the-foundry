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
