# Critic Review — FAILED status and retry logic in run-overnight.sh

**Reviewed:** 2026-06-01  
**File:** `~/agents/run-overnight.sh`  
**Scope:** DONE/FAILED marking, retry pass, QUEUE.md mutation  
**Verdict:** CONDITIONAL LGTM — one real bug (latent), one code smell

---

## What changed

`run-overnight.sh` was written from scratch. The relevant new machinery:

| Piece | Lines | Purpose |
|---|---|---|
| `mark_first_pending()` | 58–66 | Replaces first `status: PENDING` with DONE or FAILED |
| `mark_failed_task_done()` | 71–91 | Promotes a specific FAILED block to DONE after a successful retry |
| `extract_tasks()` | 95–121 | Reads QUEUE.md and returns `{project, task}` dicts for a given status |
| Main pass loop | 133–165 | Runs each PENDING task, marks DONE or FAILED |
| Retry pass | 170–224 | Re-reads FAILED tasks, retries each once |
| Summary | 226–237 | Writes final counts to MORNING_REPORT.md |

---

## What is correct

**`set +e` / `set -e` around `claude` calls (lines 148–151, 197–200).**  
`set -uo pipefail` (not `-e`) is the initial shell state. The `set +e` / `EXIT_CODE=$?` / `set -e` pattern correctly captures the claude exit code without aborting the loop on failure. Matches the LEARNINGS.md guidance from 2026-06-01.

**`mark_first_pending` — sequential pointer is correct (lines 58–66).**  
LEARNINGS.md (2026-06-01) explicitly documents that `str.replace(old, new, 1)` is correct for sequential processing: the "first PENDING" always refers to the currently-executing task because tasks are run one at a time. LGTM.

**`run_engineer` subshell (lines 36–53).**  
The `cd "$PROJECT"` is inside `(...)`, so the parent script's working directory is unaffected. The subshell exit code propagates correctly. 2700-second timeout is captured as exit 124 by `timeout`, which falls into the FAILED branch. Correct.

**Retry identification by task text (lines 84–85).**  
Using `task[:80] in part` to identify the right FAILED block is the correct approach for this use case — task text is unique per block in a personal queue, and the 80-char prefix is practically unambiguous. DONE.md confirms this was the intended design.

**DONE/FAILED accounting (lines 157–163, 206–210).**  
- Main pass: `DONE_COUNT++` on success, `FAILED_COUNT++` on failure.  
- Retry pass: on success, `DONE_COUNT++` and `FAILED_COUNT--` (line 209). On failure, FAILED_COUNT is left unchanged — so the summary table shows the count of tasks that need manual review. Correct.

**`mktemp` + `rm -f` cleanup (lines 203–222).**  
Temp file is created, written, used (or not used on retry failure), and always cleaned up. No leak.

**ACTION REQUIRED block in MORNING_REPORT.md (lines 214–218).**  
A double-failed task leaves its QUEUE.md status as FAILED and writes a visible manual-review prompt to the report. Correct behavior.

---

## Issues

### Bug 1 — `split('---')` vs. `re.split(r'(?m)^---$', ...)` inconsistency (line 82 vs. line 105)

**Severity: Real bug, latent**

`mark_failed_task_done` splits QUEUE.md with:
```python
parts = content.split('---')          # line 82 — splits on substring ---
```

`extract_tasks` splits it with:
```python
re.split(r'(?m)^---$', content)       # line 105 — splits on standalone --- lines only
```

These are not equivalent. `content.split('---')` matches `---` anywhere — inside a task description, inside a URL path, anywhere. `re.split(r'(?m)^---$', ...)` matches only lines that are exactly `---`.

**Consequence:** If a task description contains `---` (e.g., `"Refactor foo --- deprecated API"`), `mark_failed_task_done` would split that block at the wrong point. The subsequent `task[:80] in part` check would fail to match (the text is now fragmented), leaving the retry-succeeded task's status stuck at FAILED in QUEUE.md. Summary counts would also be wrong. The `'---'.join(parts)` reassembly would reconstruct a structurally broken file.

**Current QUEUE.md is safe** — neither task description contains `---` — so this is not an active bug. But it is one user-typed task away from corrupting the queue file.

**Fix:** Change line 82 in `mark_failed_task_done` from:
```python
parts = content.split('---')
```
to:
```python
import re
parts = re.split(r'(?m)^---$', content)
```
(The `import re` needs to be added at the top of the heredoc or moved inside the loop.)

---

### Code smell — shell interpolation into Python string in `mark_first_pending` (lines 61–65)

**Severity: Low, not a current bug**

```bash
python3 -c "
with open('$QUEUE') as f:
    c = f.read()
with open('$QUEUE', 'w') as f:
    f.write(c.replace('status: PENDING', 'status: $NEW_STATUS', 1))
"
```

`$QUEUE` is embedded directly into the Python code string. The other two helpers (`mark_failed_task_done`, `extract_tasks`) correctly pass file paths as `sys.argv[]` arguments, keeping Python code and shell variables separate.

In practice `$QUEUE` is a `pwd`-derived absolute path that won't contain single quotes, so this doesn't break today. But the inconsistency is a maintenance hazard: if the script is ever moved to a path containing a quote or backslash, this silently breaks while the other helpers don't.

---

### Minor inefficiency — `mktemp` created before branch (lines 203–204)

```bash
TASK_TMP=$(mktemp)
printf '%s' "$TASK" > "$TASK_TMP"

if [ "$EXIT_CODE" -eq 0 ]; then
    mark_failed_task_done "$TASK_TMP"
    ...
else
    # TASK_TMP created and immediately discarded
```

`TASK_TMP` is allocated unconditionally. On a retry failure it's created, written, and then immediately `rm -f`'d without being read by Python. Moving `mktemp` inside the `if [ "$EXIT_CODE" -eq 0 ]` branch would be cleaner — but this is cosmetic, not a correctness issue.

---

## What's outside scope

Not reviewed: the `notify-*.sh` files, DONE.md format, MORNING_REPORT.md markdown layout, or the claude prompt text inside `run_engineer`. Not flagging issues in those areas.

---

**Verdict: CONDITIONAL LGTM** — FAILED marking is correct, retry logic is correct, accounting is correct. Fix the `split('---')` in `mark_failed_task_done` (Bug 1) before any task containing `---` enters the queue. The code smell in `mark_first_pending` is non-blocking but should be cleaned up for consistency.
