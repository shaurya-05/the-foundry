# CRITIC REVIEW — SSE Regression Fixes
**Date:** 2026-06-09
**Scope:** agents.py run_agent + run_pipeline, context/ideas/knowledge/launchpad/projects routers, digest.py html.escape
**Reviewer:** Critic Agent

---

## Core SSE Fixes (in scope)

### `stream_claude` vs `stream_sse` — the root fix

`stream_claude` (claude.py:9) yields raw text strings. `stream_sse` yielded pre-formatted SSE strings. Every caller in scope was using `stream_sse`'s output directly as the SSE payload, then trying to reconstruct plain text by re-parsing those strings — a double-encoding that produced either broken output or dead code.

The fix pattern applied uniformly across all six routers is correct:

```python
output_text = ""
async for text in stream_claude(system, prompt, max_tokens=N):
    output_text += text
    yield f"data: {json.dumps({'type': 'text_delta', 'text': text})}\n\n"
```

This matches LEARNINGS [2026-06-09]: *"stream_claude yields raw text strings — callers MUST inline-wrap each chunk as SSE. Accumulate plain text in a local variable during the loop, not after."* ✓

---

### `agents.py` — `run_agent` (lines 182–207)

**Old broken pattern:** Collected all SSE chunks into `full_output`, then parsed them back to reconstruct `output_text` — classic dead branch since `chunk.startswith("data: ")` was always true but the logic was reconstructing what was already encoded.

**New:** Direct accumulation + inline SSE wrapping. ✓

**Finding — LOW: Missing `done` event.** After the last `text_delta`, the generator exhausts without emitting `data: {"type": "done"}`. The frontend's `streamSSE()` (streaming.ts:144+) returns early on `type === 'done'`; without it, the loop runs until the HTTP connection closes. In practice this is fine — the connection closes naturally — but it's inconsistent with the copilot endpoint (`agent.py:315`) which explicitly yields `done`. If any caller relies on `done` as a signal, those callers will be left waiting until the TCP connection closes. **Not a crash, not a regression from the old code (stream_sse didn't emit done either), but worth noting.**

---

### `agents.py` — `run_pipeline` (lines 241–246)

**Old:** Parsed each SSE chunk inside a try/except, extracted `text_delta`, re-emitted as `step_delta`. Silent failures on parse errors meant chunks were dropped.

**New:** Direct text → `step_delta` emit. Clean. ✓

`pipeline_complete` is still emitted at line 281 — this is the terminal event that causes `streamSSE()` to return. ✓

---

### `context.py` — `stream_insights` (lines 29–36)

Old code passed `stream_sse(...)` directly to `StreamingResponse`, which would send raw pre-formatted SSE blobs as the stream body — wrong format. New code wraps in `_sse()` generator. ✓

No `done` event — same note as run_agent. Low risk (same pre-existing behavior).

---

### `ideas.py` — `forge_ideas` (lines 71–82)

**Old broken pattern:**
```python
output_text = "".join(full_output)
lines = output_text.split("\n")
content = "".join(l[6:] for l in lines if l.startswith("data: ") and l != "data: [DONE]")
```
This was trying to strip SSE framing from a string that was *already* the SSE-framed output — resulting in a mangled content blob saved to DB. The `"data: [DONE]"` filter references an old SSE sentinel that no longer exists.

**New:** `content = output_text` after direct accumulation. Correct and clean. ✓

---

### `ideas.py` — `generate_swot` (lines 128–143)

Same broken reconstruction pattern removed. `_json` local alias dropped; `json.dumps` at line 142 now uses the module-level import. ✓

---

### `knowledge.py` — `query_knowledge` (lines 108–116)

Simple wrapper — passes `stream_sse` output directly to `StreamingResponse`. Same fix as context.py. ✓

---

### `launchpad.py` — `forge_launch_brief` (lines 46–57)

Old code had the same SSE-to-string-to-strip-SSE reconstruction for `content`. New pattern is clean. ✓

---

### `projects.py` — `forge_project_plan` (lines 182–186)

Old code had `import json` buried inside the function body (line 555 in diff) and the same SSE reconstruction loop. New code uses module-level `import json` (line 1) and direct accumulation. ✓

The `plan_text` variable is now correctly populated for both the DB write and the task extraction regex loop below it. ✓

---

### `digest.py` — `html.escape` alias (lines 11, 108, 120)

`import html as _html` correctly avoids collision with the local `html` variable at line 267 (`html = _render_html(...)`). Matches LEARNINGS [2026-06-09] and [2026-06-03] patterns exactly. ✓

Both uses of `_html.escape` in `_render_html` are on user-controlled data: `workspace_name` (line 108) and `text` from Claude output (line 120). Both are escaped into HTML text nodes — correct. ✓

---

## Out-of-Scope Changes (not the stated task — flagged only for awareness)

The commit includes significant additions beyond SSE fixes:
- `admin.py` — New admin dashboard with HTTP Basic Auth
- `agent.py` — Citations added to `/api/agent/ask`
- `digest.py` — Full weekly digest service (new file)
- `email.py` — `from_email` param added to `_send()`
- `migrations/013_weekly_digest.sql` — New column + index
- `digest_worker.py` + `pipeline_worker.py` — Celery beat schedule
- `frontend/AgentsClient.tsx` — Citation chips UI
- `frontend/lib/streaming.ts` — `citations` chunk type added

These are untested scope additions. The Critic does not block on them but notes: the Engineer bundled new features with regression fixes in a single commit. Future review scoping is cleaner if these are separate commits.

**One observation on out-of-scope `digest.py:send_digest_for_workspace`:** The `last_digest_sent_at` stamp fires AFTER `_send_email()` succeeds and NOT in the skip (total==0) path before the return. Wait — actually, re-reading lines 250 and 277: the skip path DOES stamp (line 250). The success path stamps at line 277 after the email send. If `_send_email` throws, the stamp doesn't happen and the workspace is retried next run. This is the correct behavior per LEARNINGS [2026-06-09]. ✓

---

## Verdict

**APPROVED** — all six in-scope SSE regression fixes are correct. The old SSE-parse-and-reconstruct dead branches are eliminated. Text accumulation is now direct. `digest.py` correctly aliases `html` as `_html`.

**One low-severity finding (non-blocking):** `run_agent`, `stream_insights`, `query_knowledge`, `forge_ideas`, `generate_swot`, `forge_launch_brief`, and `forge_project_plan` do not emit a `done` event. Consistent with old behavior (not a new regression), but inconsistent with the `agent.py` copilot pattern. If `streamSSE()` callers rely on `done` to trigger cleanup, they will not receive it from these endpoints.
