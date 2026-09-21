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

---

## 2026-09-21 — Stage 0 item 5: fresh-database rebuild confirmed

All 21 migrations in `backend/migrations/*.sql` apply in order to a cold Postgres
container under `ON_ERROR_STOP=1`, followed by the schema assertion — verified in
CI run 35665450822, `000_local_extensions` through `018_cloud_sync_pull`, no gaps.
A new team member can now stand up a working dev database from an empty one.

The `000b`/`000c` ordering bug was fixed by renaming those files to
`006_copilot_model_used.sql` and `006_copilot_thread_id.sql`, so they sort after
`006_conversation_history.sql`, which is what actually creates `copilot_messages`.

**Flagged, not patched** — two things that look closed but aren't:

1. **The 006 ordering is alphabetical luck, not design.** Three files share the
   `006_` prefix and correct order depends on `conversation` < `copilot` because
   `n` < `p`. Any future `006_copilot_*.sql` intended to run before the table
   exists, or any file named `006_a*`, silently reorders the chain. The glob is
   `sort`-ordered, not dependency-ordered. A real fix is a migration runner with
   recorded versions and declared dependencies, not filenames doing double duty
   as a dependency graph. Cheap to live with now; it will bite once more than one
   person writes migrations.
2. **`backend/migrations/sqlite/schema.sql` is not gated at all.** CI globs
   `migrations/*.sql`, which does not recurse, so the SQLite schema the desktop
   build uses has exactly the same "never rebuilt from cold" exposure that
   `000b`/`000c` had on the Postgres side. It has not been proven to build a
   fresh database. This is the same class of bug, one directory down.

---

## 2026-09-21 — Stage 1 design + admin cutover sequence (written before executing)

### The existing ground

`workspaces` / `users` / `workspace_members` already exist, with
`workspace_members.role` as free text (`owner | admin | member | viewer`) and a
linear `ROLE_HIERARCHY` dict in `backend/app/dependencies.py`. Twenty-odd routers
depend on `RequireRole(min_role)`. Admin endpoints bypass all of it and use HTTP
Basic against an `ADMIN_PASSWORD` env var — the second login the brief calls out.

### Decision: roles become data, and the hierarchy goes

The brief's own test is "if adding a fourth role needs a migration, the design is
wrong." The current design fails that test twice over. `ROLE_HIERARCHY` is a code
constant, so `ml_engineer` means a code change. Worse, a *linear* hierarchy can't
express the target model at all: `ml_engineer` and `robotics_engineer` are scoped
siblings of `engineer`, not rungs above or below it. Ranking them is meaningless,
and any integer you assign is a lie you later have to work around.

So: `roles`, `permissions`, and `role_permissions` become tables. Adding
`robotics_engineer` is `INSERT`s — no migration, no deploy, no code change.
Checks become `RequirePermission("audit.read")` rather than
`RequireRole("admin")`, which is also what makes the permission genuinely
unbypassable: the check names the capability, so a second endpoint reaching the
same capability has to name it too.

Rejected alternative: keep the hierarchy and add roles as higher integers. Cheaper
today, and it collapses the moment two roles need to be peers rather than ranked —
which is precisely the extension the brief asks the design to survive.

**Org = the existing `workspaces` table.** Not a rename, not a new tenant layer.
Workspaces already carry billing and membership, so they are already the org. A
new `teams` table hangs beneath it and roles attach at team level per the brief.
This keeps all twenty routers working untouched — the change is additive.

**New single-worker assumption introduced: none.** The permission check reads
Postgres per request, same as `RequireRole` does today. Documented here because
the brief asks for any new single-node assumption to be recorded, and the honest
answer is that this stage adds one only if permissions get cached in process
memory — which is why they are not being cached in this stage.

### Admin cutover — the lockout-safe sequence

This box is self-hosted and single-node. A lockout means physical access to
recover, so the sequence is explicitly designed so that no single step can close
the last open door.

1. Ship the identity schema and the `RequirePermission` dependency. Admin
   endpoints keep HTTP Basic, unchanged. Nothing to lock out of yet.
2. Grant the operator's existing user account `owner` in the default org. Verify
   **by direct SQL query against the live database**, not by the grant script's
   own success message.
3. Make admin endpoints accept **either** HTTP Basic **or** a JWT carrying the
   required permission. Both doors open simultaneously. This is the step that
   would normally be skipped to save time, and is the whole reason the operator
   can't get locked out.
4. Exercise the JWT door against the live running system — a real authenticated
   request to `/api/admin/health` returning 200. Only after that observed result
   does step 5 run.
5. Remove HTTP Basic and `ADMIN_PASSWORD`. No dormant parallel door, per the
   brief.

**Break-glass, documented deliberately:** `backend/scripts/grant_owner.py`, run on
the box itself, re-grants `owner` to an email by direct database write. This adds
no attack surface — anyone with shell on the box already has the database — but it
converts step 5 from irreversible to reversible. A cutover you cannot undo on a
machine you have to physically reach is not a cutover, it's a gamble.
