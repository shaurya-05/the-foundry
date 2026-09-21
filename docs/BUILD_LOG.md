# FOUND3RY Build Log

Append-only engineering record. One entry per meaningful change: what changed and
why that decision over the alternative, the real measurement that proved it worked,
and what broke along the way. Failures are recorded deliberately — a build story
with visible bugs and how they were caught is the part that reads as real.

Newest entries at the bottom.

---

## 2026-09-21 — Stage 0 closed: CI gate proven to actually fail

### What changed

`main` is now branch-protected with a CI workflow that provably rejects bad
changes. PR #3 (`stage-0/ci-protection`) merged as `1acc42a`. PR #4
(`stage-0/migration-gate-proof`), a throwaway draft holding one deliberately
broken migration statement, was reverted and closed.

The workflow now:

- stands up real Postgres (pgvector), Redis and Neo4j service containers
- applies every file in `backend/migrations/*.sql` in order against a **fresh**
  database, with `psql -v ON_ERROR_STOP=1`
- asserts the resulting schema, not just that the migrations exited zero —
  `copilot_messages.thread_id` must exist as `uuid` and `model_used` as `text`,
  or the job raises
- boots the backend with `uvicorn` and smoke-tests it live

### Why this over the alternative

The obvious cheaper option was to trust the existing green checkmarks. That was
exactly the trap. CI had been green for months while testing nothing that could
fail — a migration chain that could not rebuild a database from scratch still
produced a green tick. Green-but-hollow CI is worse than no CI: it converts an
unknown risk into a false assurance.

So the gate was not accepted as working on the strength of it passing. It was
accepted only after being made to fail on purpose.

### Evidence it works

Single-variable proof, three runs:

| Run | Branch | Delta | Backend job |
|---|---|---|---|
| 35525346988 | `stage-0/ci-protection` | control | **pass** |
| 35543695082 | `stage-0/migration-gate-proof` | control **+ one line** | **fail** |
| 35665450822 | `stage-0/migration-gate-proof` | that line reverted | **pass** |

The one line was `SELECT stage_0_deliberate_missing_function();` appended to
`migrations/006_copilot_thread_id.sql`. The red run failed at that file, line 5:
`ERROR: function stage_0_deliberate_missing_function() does not exist`, process
exit code 3. `frontend` passed in the same run and `docker` was skipped, so the
migration error was the sole cause of the red — not something incidental.

The diff between the green control branch and the red branch was exactly that
one statement and nothing else. That is what makes this a proof rather than an
observation.

Live smoke checks on the restored branch (run 35665450822):

- `GET /health` → HTTP 200
- `POST /api/auth/login` with junk credentials → HTTP 401

The 401 is the pass condition, not a failure being tolerated. A route that
answers 401 to bad credentials is a route that is actually wired to the auth
path; a 200 or a 500 there would both mean the gate is measuring nothing.

### What broke, and what it taught

**The migration chain could not rebuild itself.** `000b` and `000c` referenced
`copilot_messages` before `006_conversation_history.sql` created it. Fresh
databases were never exercised because every developer and every deploy ran
against a database that already had the table — the only environment that would
have caught it was the one nobody ran. The schema assertion in CI now forces
that environment on every PR.

This is the general lesson worth carrying into Phase A: a check that only runs
against state that has already accumulated is not a check. Verify against a cold
start, or you are verifying your own history.

**Verification requires a separate PR.** The workflow triggers on pull requests
to `main`, not on arbitrary branch pushes, so proving the gate fails meant
opening a draft PR whose entire purpose was to be red and then closed. Slightly
awkward, and worth knowing for next time: a gate you cannot deliberately trip is
a gate you have not tested.

### Follow-ups opened, not silently patched

- Vendored Piper binaries sit untracked under
  `desktop/scripts/voice_benchmark/bin/`. They need a `.gitignore` entry before
  anyone commits several hundred megabytes of espeak-ng dictionaries by accident.
- A stash (`WIP: voice pronunciation work`) contains a partial pronunciation
  lexicon wired into `frontend/lib/voice.ts` that imports a `./pronunciation`
  module which does not exist on any branch. Phase A §2.3 finishes this rather
  than starting over.
