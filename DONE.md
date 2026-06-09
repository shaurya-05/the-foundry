# Bug Fixes — 2026-06-09

## Bug 1: agents.py `run_agent` dead SSE parse loop
**File:** `backend/app/routers/agents.py`
**Fix:** Replaced post-loop SSE reconstruction block with inline accumulation:
- `async for text in stream_claude(...)` now accumulates `output_text += text` directly
- Each chunk yields `f"data: {json.dumps({'type': 'text_delta', 'text': text})}\n\n"`
- Removed the dead `for chunk in full_output: if chunk.startswith("data: "):` block

## Bug 2: agents.py `run_steps` dead SSE branch
**File:** `backend/app/routers/agents.py`
**Fix:** Same pattern in the pipeline step loop:
- `async for text in stream_claude(...)` accumulates and yields SSE-wrapped step_delta
- Removed the `if chunk.startswith("data: "):` / `json.loads(chunk[6:])` dead branch

## Bug 3: Direct `StreamingResponse(stream_claude(...))` in 5 routers
**Files:**
- `backend/app/routers/context.py` — `stream_insights`: added `import json`, wrapped with `_sse()` generator
- `backend/app/routers/knowledge.py` — `query_knowledge`: wrapped with `_sse()` generator
- `backend/app/routers/ideas.py` — `forge_ideas` + `generate_swot`: inline accumulate + yield SSE, removed dead SSE parse loops, fixed `_json.dumps` → `json.dumps`
- `backend/app/routers/launchpad.py` — `forge_launch_brief`: added `import json`, inline accumulate + yield SSE
- `backend/app/routers/projects.py` — `save_plan_and_stream`: inline accumulate + yield SSE, removed redundant `import json` inside function

## Bug 4: HTML injection in digest.py
**File:** `backend/app/services/digest.py`
**Fix:** Added `import html as _html`; wrapped `workspace_name` → `_html.escape(workspace_name)` (stored as `safe_workspace_name`) and each bullet `text` → `_html.escape(text)` before injecting into HTML email template.
