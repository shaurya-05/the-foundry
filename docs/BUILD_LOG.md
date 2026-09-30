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

### Stage 1 evidence — verified against a live database, not a test suite

A throwaway `ankane/pgvector` container, all 22 migrations applied cold under
`ON_ERROR_STOP=1`, then the guarantees exercised by direct SQL:

| # | Check | Result |
|---|---|---|
| V1 | Built-in roles / permissions / grants seeded | 3 / 10 / 21 |
| V2 | `engineer` holds `deploy.execute`, not `access.manage` | 1 / 0 |
| V3 | `observer` holds `trace.read`, not `memory.write` | 1 / 0 |
| V4 | `audit.read` held only by owners | owner accounts only |
| V5 | `UPDATE audit_log` | rejected by trigger |
| V6 | `DELETE FROM audit_log` | rejected by trigger |
| V7 | `DELETE` a built-in role | rejected by trigger |
| V8 | Add `robotics_engineer` with **no migration** | 3 permissions, INSERTs only |
| V9 | Audit row intact after both tamper attempts | 1 row, unmodified |

V8 is the one that matters most. It is the brief's own design test, run rather
than argued: a fourth scoped role was created and granted permissions with no
schema change, no deploy, and no code edit.

V4 also produced unplanned evidence — `builder@foundry.dev`, the account seeded by
the early migrations, came out holding `audit.read`. That is the backfill working:
an existing `workspace_members` owner was mapped into a default team with the
`owner` role, on a database that had never seen any of this before.

The append-only guarantee is a database trigger, not a convention in the service
layer, for the same reason the memory provenance rule is structural: a rule that
lives only in application code holds until someone writes a second application.

### Flagged, not patched — SQLite has no identity model

`app/db/postgres.py` dispatches to a SQLite backend when `DATABASE_BACKEND=sqlite`,
which the desktop build uses. Migration 019 is Postgres-only — `BIGSERIAL`,
partial indexes, `plpgsql` triggers, `gen_random_uuid()`. None of it exists in
`backend/migrations/sqlite/schema.sql`, and that schema is not covered by CI at
all (the glob doesn't recurse).

So Stage 1 identity currently works on the live Postgres system and **does not
exist on the desktop build**. That is not a bug introduced here, but it is a real
boundary: the desktop build cannot enforce roles, and its `RequirePermission`
checks would fail closed against missing tables. Recording it rather than quietly
scoping it out — SQLite parity is required before the desktop build ships any of
Stage 1, and it interacts with Phase B, which is where that build is headed.

---

## 2026-09-21 — Host operations status (report-only, per brief)

### UPS: none

No `Win32_Battery` device and no UPS service (APC/CyberPower/Eaton) on the host.
A continuously-running box with live users and a local Postgres has no battery
backup, so a power flicker is an unclean database shutdown. Reported, not fixed —
the brief asks for status only.

### Off-machine backup: configured correctly, not actually running daily

`FOUND3RY_LocalPostgres_Backup` is scheduled daily at 03:00, writing `pg_dump`
output to `C:\Users\shaur\OneDrive - h3ros\backups\found3ry` — genuinely
off-machine via OneDrive sync, and the task settings are sensible
(`StartWhenAvailable=True`, `WakeToRun=True`, 30-minute limit).

The artifacts on disk tell a different story:

```
found3ry_local_prod_20260921T184711.sql   Sep 21 18:47
found3ry_local_prod_20260920T113206.sql   Sep 20 11:32
found3ry_local_prod_20260907T115133.sql   Sep  7 11:51
found3ry_local_prod_20260904T094723.sql   Sep  4 09:47
found3ry_local_prod_20260830T091233.sql   Aug 30 09:12
found3ry_prod_20260727T154315.sql         Jul 27 15:43
```

**Six backups in 57 days against a daily schedule**, and not one of them at 03:00 —
every timestamp is mid-morning or evening, which is the signature of manual runs,
not the scheduler. `LastTaskResult` is 0, so the task reports success and the
schedule reports a valid next run; the only thing that reveals the gap is looking
at what actually landed on disk.

`WakeToRun` cannot wake a machine that is fully powered off, only one asleep, which
is the most likely explanation and ties directly to the sleep/wake tasks below.

This is the same failure shape as the green-but-hollow CI: a mechanism reporting
success while producing nothing. Worth stating plainly — the current real recovery
point objective is about two weeks, not one day.

### Scheduled sleep/wake tasks: removal blocked on elevation

`FOUND3RY-Sleep` (`rundll32.exe powrprof.dll,SetSuspendState 0,1,0`) and
`FOUND3RY-Wake` both exist with one-shot triggers dated 2026-07-27 that have
already fired, so both are inert — `NextRun` is empty on each. They cannot sleep
the host again as configured, but they are still registered.

`Unregister-ScheduledTask` returned `Access is denied` (HRESULT 0x80070005) for
both: they were registered by an elevated process and need an elevated shell to
remove. Definitions are exported to `docs/ops/` first so removal is reversible.

Worth recording how that failure was caught: the loop printed "removed
FOUND3RY-Sleep" for both tasks, because the `Write-Output` ran regardless of
whether the removal succeeded. Only the re-query afterwards showed both still
present. A script's own printout is not evidence — that rule earned itself again
here, in the smallest possible way.

---

## 2026-09-21 — SQLite parity, explicit migration ordering, coverage gate

Treated as blocking for Stage 1 rather than a follow-up. A backend whose
permission checks fail closed against missing tables is not degraded, it is
broken: the desktop build would either authenticate nobody or enforce nothing,
and both are worse than the shared admin password Stage 1 replaces.

### Parity was achievable — no SQLite constraint forced a partial model

The concern worth checking first was whether SQLite could express 019's
guarantees at all, because a half-enforced identity model is worse than a
declared gap. It can:

| 019 depends on | SQLite | Result |
|---|---|---|
| `gen_random_uuid()` | registered by the adapter already | used unchanged |
| `NOW()` | registered by the adapter already | `datetime('now')` |
| partial unique indexes | supported since 3.8 | used unchanged |
| `RAISE EXCEPTION` in triggers | `RAISE(ABORT, ...)` | same guarantee |
| `BEFORE UPDATE OR DELETE` | one trigger per event | two triggers, same guarantee |
| `BIGSERIAL` / `JSONB` / `UUID` | `INTEGER AUTOINCREMENT` / `TEXT` / `TEXT` | mechanical |
| `ON CONFLICT DO NOTHING` | supported since 3.24 | used unchanged |
| `ON DELETE CASCADE/RESTRICT` | supported, `PRAGMA foreign_keys=ON` already set | used unchanged |

The append-only audit log and the undeletable built-in roles are therefore
**structural on both backends**, not downgraded to application-layer convention
on the desktop one. That was the thing most at risk of quietly becoming a
convention, and it didn't have to.

### Verified by driving the production code, not by checking tables exist

`scripts/verify_sqlite_identity.py` creates a database from nothing through the
real aiosqlite adapter — including its `$N` placeholder translation — then calls
`app.services.access.has_permission()` and `user_permissions()`, the same
functions `RequirePermission` calls in production.

```
[PASS] S1 cold build seeds roles/permissions/grants - 3/10/21
[PASS] S2 engineer has deploy.execute, not access.manage
[PASS] S3 observer has trace.read, not memory.write
[PASS] S4 audit.read is owner-only - owner=10 perms, observer=4 perms
[PASS] S5 UPDATE audit_log rejected - audit_log is append-only
[PASS] S6 DELETE audit_log rejected - audit_log is append-only
[PASS] S7 built-in role delete rejected
[PASS] S8 fourth role added with no migration - 3 permissions
[PASS] S9 audit row intact after tampering - 1 row
```

Nine checks, matching V1–V9 on Postgres one for one. The two backends now enforce
the same model, proven the same way.

### Ordering is now stated, not inferred

`migrations/order.txt` is the apply order, with comments recording the actual
dependency — `006_conversation_history.sql` creates `copilot_messages`, so the
two files that `ALTER` it must follow. Runners read the manifest; nothing globs.

This is the minimum that removes the accident. The deeper fix — a migration
runner with recorded versions applied once — is deliberately not built here; the
brief asked for intentional, documented ordering, not a restructured migration
system.

### The coverage gate, proven by making it fail

`scripts/check_migrations.py` fails CI if any `*.sql` under `migrations/`
(recursively) is neither in `order.txt` nor registered to another backend's
verifier. Stage 0's lesson applied to itself — the gate was not trusted for
passing, it was made to fail:

| Case | Result |
|---|---|
| tree as-is | OK — 22 in chain, 1 other backend, 0 uncovered |
| stray `999_stray_uncovered.sql` | **FAIL**, named the file |
| `nested/deep.sql` in a subdirectory | **FAIL**, named the file |
| tree restored | OK |

The nested case is the one that matters: it is precisely the blind spot that hid
`migrations/sqlite/schema.sql` from CI for months. Adding a migration without
declaring where it belongs is now impossible to do quietly.

Full chain re-verified in manifest order against a cold `ankane/pgvector`
container: all 22 applied, 6/6 identity tables present.

### What broke, and what it taught

Two failures, both in the verification rather than the thing being verified, and
both the same shape — **the tooling lied about where the error was**.

`--print-order` emitted CRLF on Windows, so the shell loop read
`000_local_extensions.sql\r` and reported `FAILED at 000_local_extensions.sql`.
The message pointed at a migration that was completely fine. Fixed by forcing LF
in the script rather than working around it in the caller, since CI on Linux
would never have caught it and the next person on Windows would have lost the
same twenty minutes.

Then Git Bash rewrote `/mig` in the `docker exec` arguments to
`C:/Program Files/Git/mig` — again surfacing as `FAILED at
000_local_extensions.sql`. Identical symptom, unrelated cause, and only visible
by running the failing command directly and reading the raw error.

Worth recording because it is the same discipline as the rest of this log from a
different angle: a failure message names where the process stopped, not why. The
first error line is a lead, not a diagnosis.

---

## 2026-09-21 — The SQLite assumption was wrong, and that is the finding

Recording this on its own rather than as a footnote to the parity work, because
the default assumption was the expensive part.

The assumption going in — stated plainly so it is on the record — was that
SQLite could not hold 019's guarantees, and that the desktop build would
therefore have to enforce identity in application code while Postgres enforced
it in the database. That would have been a genuinely bad outcome: two backends
with the same schema and *different* guarantees, where the weaker one is the one
heading into Phase B's native migration.

The assumption was not true. Checking it cost about twenty minutes:

- partial unique indexes — supported since SQLite 3.8
- `RAISE(ABORT, ...)` in triggers — the direct equivalent of `RAISE EXCEPTION`
- `ON CONFLICT DO NOTHING` — supported since 3.24
- `gen_random_uuid()` and `NOW()` — already registered by the adapter
- `PRAGMA foreign_keys = ON` — already set

The entire price of parity was that SQLite needs one trigger per event, so the
single Postgres `BEFORE UPDATE OR DELETE` trigger becomes two. One extra
statement, in exchange for the audit log staying append-only and built-in roles
staying undeletable **structurally on both backends**.

That is the whole reason to hold a stage rather than flag and continue. Had this
been deferred, the cost would not have been the work — it would have been doing
Stage 1 twice, the second time during Phase B, against a build that had already
shipped with a weaker model. The lesson worth carrying: "this backend probably
can't do X" is a claim to test, not a constraint to design around. Most of the
cost of a wrong constraint is paid long after you accept it.

---

## 2026-09-21 — Flagged: load_dotenv(override=True) beats the real environment

`backend/app/main.py:2` calls `load_dotenv(override=True)`. python-dotenv
resolves `.env` relative to the calling module, not the working directory, so
`backend/.env` wins over the process environment **no matter where the server is
started from** — including under Docker, Railway, systemd, or any deployment that
sets configuration through real environment variables.

Found by trying to point a local server at a throwaway verification database.
Every attempt connected to `localhost:5432/foundry_db` instead — the value in
`.env` — and failed. The first two diagnoses were wrong: the error looked like a
container networking problem, then like a shell-export problem. It was neither.

Two consequences worth stating:

1. **Operationally**, a `.env` file present on a deployment host silently
   overrides platform-provided configuration. That is the opposite of what
   `override=True` is usually reached for, and it is the kind of thing that
   surfaces as an outage pointing at the wrong subsystem.
2. **For verification**, it meant a script intended for a disposable database
   would have seeded users into the developer's own. The seed never ran — the
   server failed to start first — but the near-miss is the point: the safety
   came from an unrelated failure, not from anything in the design.

Not patched. `override=True` may well be deliberate for local development, and
changing it touches how every deployment resolves its configuration — that is a
decision, not a cleanup. Worked around for verification by re-asserting the
environment after importing `app.main`, which modifies nothing in the repo.

---

## 2026-09-21 — Paused: Stage 1 remainder committed but NOT yet verified live

Work stopped mid-verification at the operator's request. Recording the exact
state so the next session does not have to reconstruct it.

**Committed and CI-green:** migration 019, SQLite parity, `order.txt`, the
migration coverage gate, `RequirePermission`, the dual-door admin gate, the
break-glass script.

**Committed but NOT verified against a running system:**
`app/routers/access.py` (teams, roles, members, owner-gated audit read) and its
registration in `main.py`, plus `scripts/verify_stage1_live.py`. These compile
and CI passes, but CI does not exercise them — the live check is what was
running when work stopped.

**Treat them as unproven until `verify_stage1_live.py` has actually run.** The
whole point of this log is that passing tests and compiling code are not
evidence; that applies to the code written today as much as to anything
inherited.

**To resume:**

1. Start a throwaway Postgres and Redis, apply migrations in `order.txt` order.
2. Launch the backend with the environment re-asserted after `app.main` import
   (see the dotenv entry above — this is not optional, it will otherwise connect
   to the developer's own database).
3. Run `python scripts/verify_stage1_live.py --base-url http://localhost:8099`.
   It covers the Stage 1 done-when (engineer permitted/denied, observer
   read/denied, all four attempts in the audit log) and cutover step 4, the JWT
   door on `/api/admin/health`.
4. Only after L9 passes does cutover step 5 run — removing HTTP Basic.

**Cutover steps 4 and 5 have not been executed.** HTTP Basic is still live on
`/api/admin/*` and `ADMIN_PASSWORD` is still required. Both doors remain open,
which is the intended state between steps 3 and 5 — but it is not a resting
place. A second auth mechanism left open becomes the real one.

**No lockout window exists in the current state**, and this is worth being
explicit about since it is the thing that would hurt on a self-hosted box: steps
1–3 only ever *added* a door. The one moment where lockout becomes possible is
step 5, and the break-glass (`scripts/grant_owner.py`, direct DB write, run on
the box) is what makes that step reversible. Do not run step 5 without
confirming that script works first.

---

## 2026-09-29 — Stage 1 closed: verified live, admin cutover complete

Fifteen checks against a running server, real JWTs from the real
`/api/auth/login`, every assertion an HTTP status rather than a function's
return value. Run twice consecutively to prove repeatability.

| # | Check | Result |
|---|---|---|
| L0 | three roles obtain real JWTs via the login endpoint | pass |
| L1 | engineer's permitted action succeeds | 200 |
| L2 | engineer's role modification denied | 403 |
| L3 | observer's read succeeds | 200 |
| L4 | observer's mutation denied | 403 |
| L5 | engineer denied the audit log | 403 |
| L6 | owner reads the audit log | 200 |
| L7 | both denials present in the log | `access.manage`, `audit.read` |
| L8 | allowed attempts present too | 17 allowed / 11 denied |
| L9 | owner reaches `/api/admin/health` by JWT — **cutover step 4** | 200 |
| L10 | observer reaches admin health (`admin.read` is a read) | 200 |
| L11 | observer denied admin write | 403 |
| L12 | owner creates `ml_engineer` over HTTP, no migration | 201 |
| L13 | unauthenticated admin request refused | 401 |
| L14 | HTTP Basic no longer opens admin — **cutover step 5** | 401 |

### The verification found a real gap in the design

L8 failed on the first run: 0 allowed, 3 denied. `RequirePermission` audited
only refusals, on the reasoning that grants are recorded by the endpoint that
has before/after state. That reasoning was wrong, and the brief's done-when said
so plainly — "the audit log shows all four attempts", where two of the four are
permitted actions.

An audit log holding only refusals answers "who was stopped" and cannot answer
"who did it", which is the question the log exists for. Now every decision is
recorded, allowed and denied alike.

The volume that produces is a retention problem, and retention is Stage 2's job.
Recording less to keep a table small leaves a log that is cheap and useless.
Worth noting the blast radius is currently bounded: only the admin and access
surfaces use `RequirePermission`; the other twenty routers still use
`RequireRole`, so this is not a row per request across the whole system.

### The break-glass was broken, and it broke exactly where it would have mattered

`scripts/grant_owner.py` failed on its first real exercise:
`no default team found`. It resolved a user's workspace by joining
`workspace_members` — the *legacy* membership table — so any account existing in
the Stage 1 model but never written to the old table could not be found.

This is the worst possible shape for that bug. The script exists to restore
access after a cutover; it would have worked for accounts predating the
migration and failed for everything created after it, discovered at the exact
moment someone was locked out of a self-hosted box. Now resolves from
`users.workspace_id` first, falling back to the legacy table.

Verified by demoting a user to `observer`, running the script, and re-querying
the database independently — `owner`, with the break-glass grant recorded in the
audit log. Not by reading the script's own success message, which is the whole
reason this was checked before step 5 rather than after.

### Cutover steps 4 and 5

Step 4 was L9: a real authenticated request through the JWT door returning 200.
Only after observing that did step 5 run.

Step 5 deleted the legacy branch outright — `HTTPBasic`, `HTTPBasicCredentials`,
`secrets.compare_digest`, the `ADMIN_BASIC_ENABLED` flag, all of it. Not disabled
behind configuration. `grep -rn HTTPBasic backend/app` returns nothing.

L14 is the check that makes that claim mean something: it sends the old Basic
credentials, with `ADMIN_PASSWORD` still set in the server's environment. If the
path had merely been disabled rather than removed, that request would have found
it. 401.

The emergency path that remains is `grant_owner.py` — a direct database write,
run on the box, restoring access without reopening a network door. That is the
distinction the brief is drawing: a recovery mechanism requiring physical
presence is not a second front door.

### What broke, and what it taught

**The harness was not idempotent.** L12 passed on a fresh database and returned
409 on the second run, because `ml_engineer` already existed. The 409 was
correct behaviour — the *test* was wrong. A check that only passes against
virgin state is a check that stops testing anything the moment you re-run it,
which is the same family as the migration chain that was never rebuilt from
cold. `seed()` now clears its own artifacts.

**`/health` returned 503 and the wait loop reported the server as down.** Neo4j
was absent; the server was running fine. `curl -fsS` treats 503 as failure, so
the loop never succeeded and the startup looked broken. Started Neo4j to remove
the confound rather than lowering the bar to 2xx-or-503 — but the lesson is the
loop was asserting "healthy" while the question being asked was "listening".

### Flagged, not patched

1. **The desktop build vendors a copy of the backend, and two build paths ship
   it stale.** `desktop/resources/backend/` is an untracked build artifact,
   refreshed by `prepare-resources.mjs`, which runs before `pack`, `dist` and
   `dist:mac`. But `dist:noside` and `dist:mac:noside` skip it deliberately —
   and the copy currently sitting there is dated 2026-07-27 and **still contains
   the HTTP Basic admin gate this stage just removed**. A `:noside` build today
   would ship the dormant door the brief prohibits. Not patched: those scripts
   look like intentional shortcuts and changing them is a packaging decision.
2. **`watch_loop_tick_failed` fires every 30s on the running system** —
   `invalid input for query argument $1: '2026-09-29T20:31:01+00:00' (expected a
   datetime.date or datetime.datetime instance, got 'str')`. A timestamp is
   being passed to asyncpg as an ISO string where a `datetime` is required. The
   watch loop is silently doing nothing on every tick. Outside Stage 1's scope,
   found while watching real logs.
3. **`aiosqlite` is missing from `backend/.venv312`.** The SQLite gate runs
   under the system interpreter but not the repo's own virtualenv, so a
   contributor running the documented command inside the venv gets
   `ModuleNotFoundError` rather than a result. CI installs from
   `requirements.txt` and passes, so this is venv drift rather than a missing
   dependency.

---

## 2026-09-29 — Stage 2: tracing that survives the frontend round trip

### The hop, and why it needed nothing from the frontend

The async round-trip protocol crosses backend→frontend→backend. The second leg
arrives at `/api/copilot/tool-result` as a brand new HTTP request with empty
contextvars, so any trace relying on ambient context is already gone by the time
the handler runs. This was flagged up front as the place tracing would break if
it broke anywhere, and that was correct.

The obvious fix is to put `trace_id` in the `tool_request` payload and have the
frontend echo it back. That works, and it was rejected: it requires a frontend
change, it can be dropped by a client that does not implement it, and a
malicious or buggy client can send someone else's trace id.

The better key was already there. **`call_id` round-trips by necessity** — the
protocol cannot function without it — and the backend already holds a registry
mapping `call_id` to the waiting future. So the trace context is stashed against
the `call_id` server-side when the pending call is created, and recovered from it
when the result arrives. The frontend carries nothing, cannot lose it, and cannot
forge it.

Trace context is attached in `create_pending_call()` and detached in
`cancel_pending_call()` — the same paths that create and clean up the future it
shadows. A timed-out call therefore cannot leak a context entry, which is checked
directly (T11) rather than assumed.

This does inherit the pending-call registry's existing single-worker assumption:
both are module-level dicts. No new assumption is introduced, and the two fail
together rather than one degrading silently. A trace that vanishes while the
request still succeeds is a week-long bug; a request that fails outright is an
afternoon.

### Verified by reading spans out of the database, not out of memory

| # | Check | Result |
|---|---|---|
| T1 | log context carries trace_id, org_id, actor_id, service | pass |
| T2 | context genuinely cleared before the second leg | pass |
| T3 | trace recovered from call_id after the hop | ids match |
| T4 | all three spans persisted under one trace_id | 3 spans |
| T5 | post-hop span is in the SAME trace as pre-hop spans | pass |
| T6 | post-hop span hangs off the waiting span, not a second root | parent matches |
| T7 | span tree intact (`tool.request` under `agent.loop`) | pass |
| T8 | spans carry org and actor | pass |
| T9 | detached call context cannot be rejoined | pass |
| T10/T11 | timeout path attaches and then detaches — no leak | pass |
| T12 | retention sweep drops aged spans, keeps recent | 1 deleted, 2 kept |
| T13 | responses carry `X-Trace-Id` | pass |
| T14 | inbound `X-Trace-Id` continues the trace | pass |
| T15 | malformed `X-Trace-Id` starts a clean trace | pass |

T6 is the one that distinguishes a real trace from a coincidence. Two spans can
share a `trace_id` and still be two disconnected roots, which renders as two
unrelated requests in any viewer. Asserting the post-hop span's `parent_span_id`
is the span that was *waiting* proves the tree actually joins.

T15 exists because an inbound header is attacker-controlled. Only a well-formed
UUID is honoured; anything else starts a fresh trace rather than poisoning the
store with junk ids.

### Retention, defined up front rather than deferred

`TRACE_RETENTION_DAYS` (default 7), with `sweep_retention()` and a
`spans(started_at)` index existing specifically to make the sweep cheap. The
brief called this out as exactly what silently fills a disk, on a single machine
with a span per model call and tool execution.

The sweep is deliberately written portably — cutoff computed in Python and passed
as a parameter, counts taken before the delete — because `NOW() - interval` and
`WITH ... DELETE ... RETURNING` are both Postgres-only and the desktop build runs
this same code against SQLite. Migration 020 has a SQLite parity block for the
same reason Stage 1 did.

### What broke: binding contextvars in middleware looked like it worked

Structured JSON logging went in, `bind_contextvars` was called in the trace
middleware, and the request lines came out with **none of the four fields on
them**. No error, no warning — just absent fields in output that otherwise looked
correct.

The cause is that Starlette runs `call_next` in a child task. Contextvars set
inside a middleware do not propagate *outward* to middleware that wrapped it, and
the request-logging middleware was registered after the trace middleware, making
it the outer one. It was logging from outside the context it was meant to
describe.

Two changes: the trace middleware is now registered last so it is the outermost
layer, and the request-completion line moved into it. Identity is read from
`request.state`, which `require_auth` sets explicitly, because `require_auth`
runs in the child task and its `bind_contextvars` call genuinely cannot reach
back out.

Then the same bug appeared once more in a different disguise: `/api/admin/health`
still logged only `trace_id` and `service`. The admin gate decodes its own JWT
rather than going through `require_auth`, so nothing was setting identity on that
path — the one path where knowing *who* reached a privileged endpoint matters
most. Now bound there too.

Worth recording because of how it presented. Every individual piece was correct:
the renderer emitted JSON, the middleware bound the values, the processor chain
included `merge_contextvars`. The system was wrong at the seam between them, and
the only thing that caught it was reading actual log output instead of confirming
the code looked right.

Final check, four different authenticated endpoints:

```
/api/access/teams  status=200  all four: True
/api/admin/health  status=200  all four: True
/api/access/roles  status=200  all four: True
/api/audit         status=200  all four: True
```

### Also fixed in passing: CORS could never have carried a trace

`X-Trace-Id` was added to `allow_headers` so the frontend may send it — and to
`expose_headers`, without which the browser cannot *read* it off a response.
Allowing the request header alone is half a round trip: the frontend would have
been unable to learn the trace id it was meant to echo back.

---

## 2026-09-29 — Stage 2 closed: metrics, one dashboard, done-when met

### The done-when, done literally

> One real end-to-end request is traceable as a single trace across every hop,
> viewed in the dashboard, logged in as a Stage 1 role.

Fifteen checks, in that order, against the running system:

| # | Check | Result |
|---|---|---|
| D1 | logged in as `engineer` through the real login endpoint | pass |
| D2 | real `tool_request` received over the WebSocket | call_id issued |
| D3 | answered via `POST /api/copilot/tool-result` — the hop | round trip closed |
| D4/D5 | dashboard summary + trace list readable with that token | 200 |
| D6 | the request produced a trace | pass |
| D7 | one trace contains **both** legs | pass |
| D8 | the trace is a **single connected tree** | `root_count=1` |
| D9 | the reply is nested under the tool call it answered | pass |
| D10 | dashboard summary counts include it | pass |
| D11 | same session refused `audit.read` | 403 |
| D12 | same session may run the retention sweep (`admin.write`) | 200 |
| D13-D15 | metrics reach the dashboard, per tier and per criterion | pass |

D8 is the one that would have caught a broken hop, and D11 is the one that makes
D4 mean something: a dashboard that opens for a role proves the permission was
granted, not that the gate exists. The same token being refused `audit.read`
proves the gate is per-capability rather than blanket.

**The WebSocket leg had no trace at all**, found while wiring this up. Starlette's
HTTP middleware does not run for WebSocket connections, and the round-trip
protocol *starts* on a WebSocket — so the first leg of the hop was outside the
trace entirely, and the whole thing would have been a trace of the second half.
Trace binding now happens in `_authenticate_ws`, which every WS endpoint already
funnels through.

### A check that was wrong about the design, not a finding

D11 originally asserted that `engineer` is refused the retention sweep. It
failed, and the check was wrong: `engineer` holds `admin.write` deliberately —
the brief's role table gives it "full code, deploy, trace, dashboard, health
access" — and the sweep only deletes what the retention policy already declares
expired. The check now asserts the gate using `audit.read`, which `engineer`
genuinely does not hold, and a second check records that the sweep being allowed
is the intended behaviour rather than an oversight.

Worth writing down because the instinct on a red check is to change the code.
The check was the thing that was wrong.

### Metrics — measured at the funnel, not the call sites

Five instrumentation points, each chosen where every path already converges:

- **Per-tier model latency and throughput** in `log_model_usage()`. Every
  provider path already calls it, so instrumenting there cannot be bypassed by a
  provider added later. Instrumenting call sites would mean finding them all
  once, then finding them again forever.
- **Reflection outcomes per criterion** in `reflect_on_answer()`. An aggregate
  pass rate says the loop is struggling; `file_was_read` failing while
  `summary_grounded` passes says it is answering about files it never opened.
  Three different bugs hide behind one aggregate.
- **Tool success/failure** around both execution paths in the agent loop. The
  `async_frontend` span opens *before* `create_pending_call`, which is what
  gives the frontend's reply a parent to attach to.
- **VRAM** from what Ollama reports as actually resident, not the registry's
  idea of what models ought to cost. The system has come within 98MB of
  exhausting 12GB once; what makes that legible afterwards is a time series.
- **Circuit-breaker state** on every success and failure, not only on
  transitions — so a breaker quietly healthy for an hour is distinguishable from
  one nothing has called.

`record_metric_nowait()` exists because several of these are sync functions on a
hot path. It schedules the write and keeps a reference to the task: without that
reference CPython can collect a pending task mid-flight, and the write silently
never happens — which looks exactly like the metric never firing.

### One dashboard, same login

`/observability` in the frontend app, gated by `trace.read` on the backend. It
lives in the app rather than as server-rendered HTML for a concrete reason: the
session is the app's session. A browser cannot attach an `Authorization` header
to a plain navigation, so a server-rendered admin page either needs its own
cookie mechanism — a second authentication path, which the conformance rules
forbid — or it needs the page to live where the token already is.

Verified by loading it in a real browser as `engineer`: the role badge reads
`ENGINEER · 7 PERMISSIONS`, the trace list shows the real round trips, and
opening one renders `tool.list_files` with `tool.result.received` nested beneath
it. That nesting, on screen, is the hop.

Deliberately almost no charts. Counts, ranks and a tree are what this data is;
the single magnitude comparison that earns a visual is span duration within a
trace, drawn as single-hue bars against the trace's own longest span. Status is
never colour alone — an errored span carries the word "error" beside it. A trace
that arrives with more than one root is labelled **disconnected** rather than
drawn as though it were fine, because that is precisely what a lost hop looks
like.

### Retention

`TRACE_RETENTION_DAYS`, default 7, swept by `sweep_retention()` and surfaced on
the dashboard alongside the age of the oldest span — so the policy and its actual
effect are visible in the same place. Gated on `admin.write`, not `trace.read`:
deleting data is not a read, however routine.

### Flagged, not patched

1. **`/admin`'s server-rendered HTML page is no longer reachable from a
   browser.** Removing HTTP Basic in Stage 1 was correct and this is its
   consequence: browsers cannot send a Bearer token on a navigation. The page
   still serves to an API client with a token, and the `/observability`
   dashboard supersedes it for human use, but the old URL will appear broken to
   anyone who bookmarked it. Moving its panels into the frontend is the real
   fix and is a larger change than this stage should absorb.
2. **`aiosqlite` is still missing from `backend/.venv312`**, so the SQLite gate
   only runs under the system interpreter locally. CI is unaffected.

---

## 2026-09-29 — Stage 3: contracts extracted, boundaries measured

Interfaces only. Nothing moved. Six contract artifacts, a machine-readable
ownership map, a generated violations register, and two gates in CI.

### The register is generated, not written

`backend/scripts/check_service_boundaries.py` reads `docs/contracts/ownership.yaml`,
scans every module for SQL table references, and reports each place a module
touches a table its service does not own. A hand-written register is stale the
first time somebody adds a query; this one is a command.

Detection is deliberately lexical — this codebase writes raw SQL as string
literals, so it scans for `FROM|JOIN|INTO|UPDATE|DELETE FROM <name>` and keeps
hits matching a table the migrations actually create. It will miss a table name
built by concatenation and does not understand an ORM. A checker that is obvious
about what it looks at is easier to trust than one claiming completeness it
cannot have.

**37 violations.** Frozen in `boundary-baseline.json`; CI fails on anything new.
Proved before being trusted — one cross-boundary query added to `memory_tool.py`:

```
FAILED: 1 NEW boundary violation(s):
  app/services/memory_tool.py -> workspace_members
      memory_knowledge reads/writes a table owned by identity_access
```

Removing it returned the scan to clean. Same discipline as the Stage 0 migration
gate: a gate you cannot deliberately trip is a gate you have not tested.

Two of the first scan's findings were my own classifier's fault, not the code's —
`tracing.py` and `observability.py` looked unmapped because the shared
substrate's named paths were not being treated as a service, and `app/db/*`
looked like a violator when it is the layer everything goes *through*. Fixed the
classifier rather than baselining false positives. Baselining a false positive is
how a register stops meaning anything.

### The number that matters

**30 of 37 violations involve a domain the five-service model does not name.**

Only 7 are between two of the five actual services. The five-way split is in
better shape than the raw count suggests; what is missing is a sixth boundary
that was never drawn. `projects`, `tasks`, `ideas`, `ventures`,
`activity_events`, `notifications`, `blueprint_*`, `watches`, sync and billing —
thirteen tables, twenty-one modules, all in production, all owned by nobody.

This is not an oversight in the code. The five contexts describe **the substrate
the assistant runs on**; they do not describe **the application it runs inside**.
Both exist, one was named.

The consequence is mechanical rather than philosophical. `context_engine.py`
reads `projects`, `tasks`, `ideas` and `activity_events` because that *is* the
workspace content the assistant reasons about. It cannot stop, because there is
no contract to call instead. Four of its violations are unfixable until this is
decided — you cannot depend on an interface that does not exist.

Recorded as **V-01**, with three options and a recommendation (a sixth context),
and deliberately not decided here. Naming a bounded context is a ratification
call.

### What the register changed about Stage 4

The brief's order — Model Gateway, then Identity & Access, Memory & Knowledge,
Agent Runtime — survives contact with the measurement, and sharpens:

- **Model Gateway has zero violations in either direction.** Genuinely
  self-contained, and now confirmed by measurement rather than assumed. Right
  thing to move first.
- **Identity & Access is the most entangled of the five** (12 involving it), and
  V-03 should be resolved *before* the move rather than during it.
- **Memory & Knowledge cannot be cleanly moved until V-01 is decided.** Eight of
  its violations point at the unnamed domain. Moving it first would mean either
  dragging workspace tables along or inventing the sixth boundary under time
  pressure.
- **Agent Runtime last remains right** — one outward violation.

### V-03: deletion reaches into every service

`auth.py` alone accounts for 8 violations, reading or deleting `agent_runs`,
`copilot_messages`, `forge_outputs`, `command_history`, `knowledge_items`,
`projects`, `tasks`, `ideas`. The cause is legitimate — account deletion and data
export genuinely span every service. The mechanism is not: Identity & Access
enumerates four other services' tables, which means **adding any new table
anywhere silently creates an incomplete deletion**.

`purge_workspace` and `export_workspace` are now declared on the Agent Runtime
and Memory & Knowledge contracts as `declared_not_implemented`. Identity & Access
orchestrates; it stops knowing what tables exist elsewhere.

### V-08: the validator found a live bug on its first run

`check_contracts.py` cross-checks ownership against the migration chain both
ways. It immediately found that **no Postgres migration creates
`model_usage_log`** — `014_model_registry.sql` mentions it in a comment only —
while `ai_router.py` inserts into it inside a `try/except` that swallows the
failure and `admin.py` selects from it for the model-stats page.

On any database built from the migration chain, which is now every CI run and
every new developer, **every model usage write fails silently and the model-stats
page is empty.** It has been working only on databases where someone created the
table by hand at some point.

Same family as `000b`/`000c`, which Stage 0 existed to eliminate. It survived
because the swallowing `except` meant nothing ever complained. The missing table
is a one-line fix; the more valuable change is removing the `except: pass`,
because that pattern is what turned a missing table into long-running invisible
telemetry loss.

Also found: `knowledge` exists on SQLite and not on Postgres — a real divergence
between backends.

Neither fixed. Stage 3 moves nothing, and adding a migration is a move. Both are
recorded under `unmigrated` in `ownership.yaml`, reported as `[KNOWN]`, and the
gate fails on anything new.

### Contracts as artifacts, not as code

Four of the six have no HTTP surface. They are still written as explicit
request/response schemas rather than Python `Protocol` classes, because a
protocol is a type hint for the current implementation and moves when the
implementation moves. A schema is a statement about the message, which is what
has to survive Phase B. Nothing in any contract assumes an in-process call.

Two things were written ahead of their implementations on purpose:

- **Perception & Actuation** is entirely `declared_not_implemented`. Phase A's
  camera work and Phase C's robotics work now have a defined place to land, with
  PA-1 (capabilities enter as registered tools, never a parallel path around the
  loop) and PA-5 (actuation is separately permissioned from perception) fixed
  before the first line of code rather than discovered after it.
- **`compact_memory`** is declared on Memory & Knowledge specifically so Stage 5
  cannot implement compaction as a shortcut around the provenance rule. Its
  response field `provenance_preserved` is documented as verifiable only by
  direct query, never by the operation's own return value.

### Both gates proved by making them fail

| Gate | Probe | Result |
|---|---|---|
| boundaries | cross-boundary query in `memory_tool.py` | FAIL, named the module and the owner |
| contracts | migration creating an unowned table | FAIL, named the table |
| contracts | contract file removed | FAIL, named the service |
| both | tree restored | clean |

---

## 2026-09-29 — Sixth context ratified: Workspace Domain

GRW decision on V-01, option 1. `projects`, `tasks`, `ideas`, `ventures`,
`activity_events`, `notifications`, `blueprint_*`, `watches`, sync and billing
now have a named owner and a contract.

The violation count did not drop, and should not have: naming a boundary does
not move code. What changed is that all 30 of those violations became
*fixable*. `list_for_context` and `record_activity` are the two operations that
matter — before them, four of `context_engine.py`'s reads had no alternative to
point at.

---

## 2026-09-29 — Stage 4, service 1 of 4: Model Gateway moved

### What moved, and what deliberately did not

`app/services/model_gateway.py` is now the only door into the model layer.
Eighteen modules were rewritten to import it instead of `ai_router`,
`model_provider`, `claude` or `embeddings`.

A facade rather than relocating files: the contract is what other services
depend on, and moving `ai_router.py` into a package would churn every import for
no change in coupling. One named surface in front of the verified routing logic
changes the coupling without touching the logic — which is the difference
between a staged refactor and a rewrite.

Two things were deliberately left alone, both for the same reason:

- **`stream_direct` / `complete_direct`** go straight to Anthropic, bypassing
  tier routing. Eight modules call them. Routing them through `route()` would
  change which model answers — a behaviour change smuggled inside a move, which
  is the one thing a move must not contain. Exposed, marked deprecated, recorded
  as MG-GAP-2.
- **`get_provider()`** hands a provider object to `agent_loop`, `h3ro_style` and
  `watch_service`, which call it themselves and inherit none of the resilience
  wrapper `route()` would apply. MG-GAP-3, same reasoning.

Neither is fixed. Both are now countable, because there is exactly one door.

### Enforcement: imports, not just tables

`check_service_boundaries.py` catches one service reading another's TABLES.
Model Gateway owns almost no tables, and every way of violating its boundary is
an import — twenty modules were reaching into its internals and the table
checker saw none of it.

`check_service_imports.py` closes that. **Enforcement is progressive**: a
service is enforced only once it declares a `facade:` in `ownership.yaml`, i.e.
once Stage 4 has actually moved it. Model Gateway is enforced with zero
violations; the other five report 42 inbound imports and fail nothing. Turning
it on for all six at once would produce either a wall of failures or a baseline
so large it means nothing.

Proved by probe: a `from app.services.model_provider import MODEL_REGISTRY`
added to `context_engine.py` exits 1 and names the facade to use instead;
removing it exits 0.

### V-08 fixed, and it immediately exposed a second problem

Migration 021 creates `model_usage_log` — the table `ai_router` has been
inserting into since before any migration created it. Verified on a cold
database: a row landed through the real code path, which is the first time that
write has ever succeeded on a database built from the chain. `/admin/model-stats`
now returns data instead of an empty list.

The `except Exception: pass` around that write is gone. It never should have
swallowed silently: telemetry must not fail the request that produced it, but it
can say so. That silence is the entire reason a missing table went unnoticed.

**Then the boundary checker immediately flagged `admin.py -> model_usage_log`.**
That violation had always existed and had been *invisible*, because the checker
only knows tables the migrations create — and this one did not exist. Fixing the
bug made the violation appear. The query moved onto the contract as
`usage_stats()`, where it belonged: an operator surface should not own model
data.

A bug hiding a boundary violation is a good argument for checking both, and for
checking them against the same source of truth.

### V-09: Stage 3 put the circuit breaker in the wrong service

Stage 3 filed `circuit_breaker.py` under Model Gateway on the reasonable-sounding
basis that it wraps provider calls. Enforcing the boundary showed that was
wrong: `github_sync`, `google_drive` and `notion_sync` use the same breaker for
their own connectors, which have nothing to do with models. Leaving it would
have created three enforced violations for code doing nothing wrong.

Now a shared `resilience` substrate, same pattern as observability.
`breaker_status` delegates rather than owning.

Worth recording as a Stage 3 miss rather than quietly re-filed. **A boundary is
a hypothesis until something tests it**, and the thing that tested this one was
trying to enforce it. That is the argument for moving one service at a time.

### MG-GAP-1: re-examined, no change made

The brief lists "fix `model_used` telemetry — after a provider failover it
reports the original model". Re-read during the move: the streaming route path
already emits a `("model_used", <label>)` correction when
`call_with_resilience` falls back, and `copilot.py` handles both the bare string
and the tuple. Marked `verified_already_correct` rather than claiming a fix that
was not made. The residual exposure is MG-GAP-2 — `stream_direct` callers report
no model at all, because they never asked for a tier.

### What broke

**A facade that imports its own service eagerly will not boot.** The first
version imported `ai_router` and `embeddings` at module level. `ai_router`
imports `document_retrieval`, which now imports the facade for embeddings — a
cycle that exists *only because* the facade became the front door. The app
failed at startup with a partially-initialised module.

`python -m compileall` had passed on all eighteen migrated modules. Compiling is
not importing; it proves syntax, not that the graph resolves. The thing that
caught it was starting the server.

Every import inside the facade is now lazy. A facade that drags in its whole
service graph at import time re-creates the coupling it exists to remove.

### Verified against the real running system

After the move, on a cold database with all 24 migrations:

| Check | Result |
|---|---|
| backend boots (18 rewritten modules resolve) | health 200 |
| Stage 1 live — 15 checks | all pass |
| tracing — 15 checks | all pass |
| Stage 2 done-when — 15 checks | all pass |
| `/admin/model-stats` through the contract | 200, real rows |
| `model_usage_log` receives writes | 1 row, real path |
| boundary scan | 37, baseline clean |
| import scan | 0 enforced violations |

### CI now runs on stacked PRs

The workflow triggered only on PRs to `main`. Stage 4 moves one service per PR
and those PRs stack on the Foundation branch, so every one of them would have
arrived with no checks — the same hollow-green problem Stage 0 removed, reached
by a different route. `phase-a/**` and `stage-4/**` now trigger it too.

---

## 2026-09-29 — V-03 resolved: deletion that actually deletes

### What the rewrite found was worse than the register said

The old account-deletion path enumerated seven tables belonging to four other
services. Two things were wrong with it, and only one was in the register.

It covered **seven tables out of roughly thirty**. `projects`, `ideas`,
`knowledge_items`, `agent_memory`, `notifications`, `activity_events`,
`blueprint_*`, `watches`, `docs`, `persons`, `events`, `graph_tasks`, `edges`,
`pipeline_runs`, `ventures` — none of them were ever deleted.

And **every delete sat inside a swallowing try/except**, commented "for tables
that may not exist in all environments". So a delete that failed reported
success: a GDPR path that could delete nothing at all and still return
`{"deleted": true}`.

After V-08 that comment is not hypothetical — `model_usage_log` genuinely did
not exist on databases built from the migration chain.

### The shape of the fix

Each service declares which of its tables hold workspace data and how they are
scoped; `app/db/purge.py` does the deleting. The spec is the service's
knowledge, the mechanism is not — so Identity & Access orchestrates a deletion
without knowing a single table name belonging to anyone else.

Adding a table to any service no longer silently creates an incomplete deletion,
because the service that owns the table owns its purge spec.

Three facades were created early — `agent_runtime.py`, `memory_knowledge.py`,
`workspace_domain.py` — holding only purge and export for now. None declares a
`facade:` in `ownership.yaml` yet, so import enforcement stays off for services
that have not been asked to move. Declaring them early would fail CI for code
doing nothing wrong.

**Nothing swallows.** A purge that cannot complete fails loudly. A partial
deletion reported as complete is the worst of the three possible outcomes.

### Verified by direct query, not by the endpoint's word

18 seeded rows across three services. After the delete: every one gone,
confirmed by counting rows in the database rather than reading the response.

A colleague's row in a table the leaver also used survived. `user_purgeable`
is what makes that pass: rows with no user column belong to the workspace, not
to whoever left, and deleting them because one person departed would destroy a
colleague's work.

Identity soft-deleted, credentials cleared, membership removed.

---

## 2026-09-29 — Stage 4, service 2 of 4: Identity & Access moved

Twenty modules rewritten to import `app/services/identity.py`. This was the most
entangled of the six — 24 inbound imports — and almost all of them wanted the
same four FastAPI dependencies, so most of the move was one import line each.

The dependency callables are **re-exported by name, not wrapped**. FastAPI
inspects their signatures to build the request graph, so a wrapper that changes
a signature changes the behaviour of every endpoint using it. Same objects, one
door.

Unlike the Model Gateway facade these imports are eager, and safely so: this
service sits at the bottom of the dependency graph and imports nothing from
another service. That is what you would expect of the thing everything else
authenticates against, and it is why there was no cycle to avoid this time.

`audit_log` is deliberately absent from Identity's own purge spec. It is
append-only by database trigger (IA-3), so including it would either raise or
require weakening the guarantee to make a purge succeed. A record that access
was granted or refused is a record of what the system did, not personal content.
Changing that is a decision about the audit guarantee, not a line in a purge
spec.

Both moved services enforce at zero import violations. Pending imports across
the four unmoved services fell from 42 to 21.

### V-11: an invariant the brief calls absolute is enforced by nothing

Seeding a test row surfaced it. `agent_memory` has **no `source` column**. It
stores one JSONB array per `(workspace_id, user_id)` with `source` inside each
element, and `015_agent_memory.sql` says so in its own comment: *"enforced by
the loop once it exists, not by this table"*.

Proven rather than argued — the live database accepted this without complaint:

```sql
INSERT INTO agent_memory (workspace_id, user_id, content)
VALUES (..., '[{"text":"a memory with NO source at all"}]'::jsonb);
```

Provenance therefore holds exactly as long as every writer goes through
`memory_tool.py`. Today one does. That is a convention, not a guarantee — and it
is the only invariant described as absolute with nothing enforcing it. The audit
log gets a trigger. Built-in roles get a trigger. Memory provenance gets a
comment.

It matters most for Stage 5, which is explicitly told compaction must not become
a backdoor around provenance. With nothing structural, a compactor writing a
merged entry without `source` simply succeeds and nothing notices.

MK-1 now states what is true rather than what was intended. Not fixed here:
`agent_memory` belongs to Memory & Knowledge, which moves third, and the
enforcement interacts directly with Stage 5's compaction design.

### V-10: webhook_events cannot be purged per workspace

It records raw provider deliveries and carries no workspace or user column at
all. Deliberately absent from the Workspace Domain purge spec rather than
silently skipped. Payloads may contain personal data from the source system, so
it needs a workspace column, a retention window, or a documented decision that
it holds nothing personal.

### Verified after the move

| Check | Result |
|---|---|
| backend boots (20 rewritten modules) | health 200 |
| Stage 1 live | pass |
| tracing | pass |
| Stage 2 done-when | pass |
| V-03 purge | pass |
| boundary scan | 29, baseline clean |
| import scan | 0 enforced, 21 pending |

Boundary violations: **37 → 29**, all eight of them `auth.py`'s.

---

## 2026-09-30 — V-11 resolved: memory provenance is now enforced by the database

The Foundation brief calls this guarantee absolute. Until now it was a
convention held up by one well-behaved writer.

`agent_memory` has no `source` column. Provenance lives inside a JSONB array,
and `015_agent_memory.sql` said so in its own comment — *"enforced by the loop
once it exists, not by this table"*. The database accepted an entry with no
source at all. The audit log gets a trigger, built-in roles get a trigger; this
got a comment.

Migration 022 fixes that on both backends:

- **Postgres** — an `IMMUTABLE` function over `jsonb_array_elements`, called from
  a CHECK constraint. A CHECK cannot contain a subquery, but scanning a
  parameter is not a table subquery, so the test lives in the function.
- **SQLite** — a `BEFORE INSERT` / `BEFORE UPDATE` trigger pair using `json_each`
  and `RAISE(ABORT)`, because SQLite has the same restriction.

### Why `NOT VALID`, deliberately

`NOT VALID` **still enforces on every INSERT and UPDATE** — which is the actual
goal. What it skips is the retroactive scan of existing rows, so the migration
cannot fail on a live database holding provenance-free entries written during
the years when nothing stopped them.

A migration that refuses to apply to production is not a safety feature, it is
an outage. On a fresh database there are no rows, so the constraint is fully
valid from the first moment; `VALIDATE CONSTRAINT` closes it once legacy rows
are clean.

### Verified by trying to break it

Six cases, both backends, twelve checks:

| Case | Expected | Both backends |
|---|---|---|
| no source at all | refused | refused |
| unrecognised source | refused | refused |
| `user_stated` | accepted | accepted |
| **one valid entry + one with no source** | refused | refused |
| `agent_inferred` | accepted | accepted |
| `conversation_digest` | accepted | accepted |

The fourth is the one that matters. A check inspecting only the first element,
or only the array's shape, passes it — and that is exactly how a compactor
merging entries would slip a provenance-free row through. Stage 5 now cannot do
that by accident, which is precisely what the brief asked for when it said
compaction must not become a backdoor.

### What broke

The first run reported `agent_inferred` and `conversation_digest` as **refused**
on SQLite. Entirely plausible — new constraint, two sources rejected — and
wrong. `agent_memory` is `UNIQUE(workspace_id, user_id)`, so the earlier
accepted case had taken the row and every later insert failed on the unique
constraint rather than on provenance.

The harness was wrong, not the trigger. Believing the output would have meant
"fixing" a constraint that was already correct.

---

## 2026-09-30 — Stage 4, service 3 of 4: Memory & Knowledge moved

Nine modules rewritten to import `app/services/memory_knowledge.py`. Imports are
lazy, for the same reason the Model Gateway's are: `context_engine` and
`agent_retrieval` reach the Model Gateway, which reaches `document_retrieval` —
one of this service's own modules. Eager imports would close that loop at import
time.

`read_memory` is deliberately **not** on the facade. The only reader today is
the agent loop, which reaches memory through the `memory_read` ToolSpec rather
than a direct call, so a facade function would be a wrapper with no caller.
Adding it when Stage 5 needs it is additive; adding it now would be inventing an
interface to look complete.

The graph repository is exposed as named pass-throughs rather than a re-exported
module. Handing back `graph_repo` itself would satisfy the import checker while
narrowing nothing — naming each operation is what makes the surface countable.

### Two findings that need decisions, not moves

**V-12 — `agent_retrieval` JOINs across a service boundary.** It runs
`FROM graph_tasks gt LEFT JOIN ventures v` — `graph_tasks` is this service's,
`ventures` is Workspace Domain's. No contract call reproduces it, because the
whole point is that the database does the correlation. Three options (two calls
joined in Python, an enriched read on Workspace Domain, or denormalising the
venture onto `graph_tasks`), each with a real cost. Recorded so it gets chosen
rather than defaulted into.

**V-13 — this service stores Identity's OAuth credentials.** `graph_repo.py`
holds `get_oauth_connection`, `upsert_oauth_connection` and
`revoke_oauth_connection` — reading and **writing** `oauth_connections`, which
belongs to Identity & Access. Worse than a cross-service read: a credential
write outside Identity means the audit log never sees it, and revocation is not
something Identity can guarantee it can perform. These belong on the Identity
contract. Not moved here, because doing it inside a service move would mean two
behaviour changes at once.

### What "moved" currently means — stated plainly

Three of six services are enforced at the **import** boundary with zero
violations. The **table** boundary is a separate criterion, and only one service
satisfies it:

| Service | Imports | Outbound table access |
|---|---|---|
| Model Gateway | enforced, 0 | 0 — genuinely clean |
| Identity & Access | enforced, 0 | **4 remaining** |
| Memory & Knowledge | enforced, 0 | **9 remaining** (2 are V-12/V-13) |
| Agent Runtime | pending | 1 |
| Workspace Domain | pending | 15 |

The brief's per-service criterion is "no cross-service table access remains".
Only Model Gateway meets it. Identity and Memory & Knowledge have had their
import boundaries established and their table boundaries partly retired. Saying
so rather than letting "moved" imply more than it does.

The remaining violations cluster almost entirely around Workspace Domain — the
service that did not exist until it was ratified. Most resolve once it moves and
its read operations exist.

### Also fixed

`aiosqlite` was missing from `backend/.venv312`, flagged back in Stage 2. The
SQLite gates ran under the system interpreter but not the repo's own virtualenv,
so a contributor running the documented command got `ModuleNotFoundError`
instead of a result. Installed from `requirements.txt`.

### Verified after the move

| Check | Result |
|---|---|
| backend boots (9 rewritten modules) | health 200 |
| Stage 1 live | pass |
| tracing | pass |
| Stage 2 done-when | pass |
| V-03 purge | pass |
| V-11 provenance, both backends | pass |
| SQLite identity | pass |
| contracts / imports / boundaries | all clean |
