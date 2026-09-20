# Stage 0 - Make CI Real

Status: Stage 0 implementation verified; Checkpoint 0 awaits Shaurya Karra review.
PR: https://github.com/shaurya-05/the-foundry/pull/3 (left open and unmerged).

## Scope and changes

- Add Neo4j using the application docker-compose.yml image, neo4j:5, with authenticated Cypher readiness and matching CI connection settings.
- Apply every PostgreSQL migration with ON_ERROR_STOP and strict Bash error handling; query and assert the final copilot_messages thread_id UUID and model_used TEXT columns.
- Rename the two premature ALTER TABLE migrations to run after 006_conversation_history.sql; update Docker Compose mounts. Their SQL remains unchanged and never skips a missing table.
- Wait for backend readiness with bounded retries and clean up the server on exit. Assert the invalid-login response is exactly HTTP 401 without curl -f.
- Configure the installed Next.js 15.5.14 / ESLint 8.57.1 stack with next/core-web-vitals and align eslint-config-next to 15.5.14.

## Verified findings

The main-branch CI run https://github.com/shaurya-05/the-foundry/actions/runs/33894753044 shows the ESLint setup prompt and exit 1, missing Neo4j connection and HTTP 503, and these fresh-database migration errors:

```text
psql:migrations/000b_local_copilot_thread_id.sql:3: ERROR: relation "copilot_messages" does not exist
psql:migrations/000c_local_copilot_model_used.sql:4: ERROR: relation "copilot_messages" does not exist
```

Code inspection establishes that those ALTER TABLE files precede migration 006, which creates the table. The old psql invocation did not stop on SQL errors. The auth probe also combined curl -f with an expected 401; that failure mode was identified by inspection, not reached in the old CI run.

The claim that the two migrations were authored against populated production is background supplied by the framework manager. It has not been independently verified.

Local npm ci and npm run lint completed. The unmodified recommended baseline produced 28 react/no-unescaped-entities errors: eight in privacy/page.tsx and twenty in terms/page.tsx. A file-scoped override makes that rule warn on those two pages only. No rules are disabled. Four existing react-hooks/exhaustive-deps warnings remain in ContextClient, InsightsClient, WorkspaceClient and ForgeSignals. Final lint has zero errors and 32 warnings.

## Real GitHub Actions evidence

Run: https://github.com/shaurya-05/the-foundry/actions/runs/35477658556
Implementation commit: ef30c367e2e1343304b3080a9c233a0cdd59e425.
Observed 2026-09-20 UTC (2026-09-19 America/New_York). Documentation commit 9370ab3b66a63f4684f6f2c14ef05ae679ab101b also passed both required checks in run https://github.com/shaurya-05/the-foundry/actions/runs/35477875533 (backend 1m8s, frontend 1m5s). The PR checks track the latest documentation revision.

Actual gh run watch output:

```text
✓ backend in 1m9s (ID 105989581832)
  ✓ Initialize containers
  ✓ Run migrations and verify fresh schema
  ✓ Check backend starts and health
✓ frontend in 1m7s (ID 105989581914)
  ✓ Run npm ci
  ✓ Run npm run lint
  ✓ Run npm run build
- docker in 0s (ID 105989731527)
```

The backend job initializes a new PostgreSQL service database. All 21 SQL files completed with ON_ERROR_STOP=1, from 000_local_extensions.sql through 018_cloud_sync_pull.sql. Actual ordered log excerpt:

```text
Applying migrations/006_conversation_history.sql
Applying migrations/006_copilot_model_used.sql
Applying migrations/006_copilot_thread_id.sql
```

Actual database query output at 00:02:27 UTC, after the full chain:

```text
 column_name | data_type
-------------+-----------
 model_used  | text
 thread_id   | uuid
(2 rows)
DO
```

The query is against information_schema.columns in public.copilot_messages, not a migration script's success message. A subsequent DO block raises an exception if either required column/type is absent. No missing-table guard was added.

Actual running CI backend output at 00:02:31 UTC:

```text
INFO:     127.0.0.1:54992 - "GET /health HTTP/1.1" 200 OK
{"status":"ok","checks":{"api":"ok","postgres":"ok","redis":"ok","neo4j":"ok"}}
INFO:     127.0.0.1:55000 - "POST /api/auth/login HTTP/1.1" 401 Unauthorized
{"detail":"Invalid email or password"}
```

Actual frontend build output:

```text
✓ Compiled successfully in 12.1s
✓ Generating static pages (27/27)
```

These are real services running in GitHub Actions, not production-host verification. Local validation was npm ci, npm run lint, and git diff --check; no local database pass is claimed.

Reproduce the evidence retrieval:

```sh
gh run view 35477658556 --log
gh run view 35477658556 --json conclusion,headSha,jobs,url
```

## Branch protection - verified after both CI jobs passed

Before this change, GitHub returned HTTP 404 / Branch not protected and an empty rulesets list. After the successful run, main protection was enabled. A separate GET (not just the PUT response) returned:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["frontend", "backend"],
    "checks": [
      {"context": "frontend", "app_id": 15368},
      {"context": "backend", "app_id": 15368}
    ]
  },
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false,
    "required_approving_review_count": 0
  },
  "enforce_admins": {"enabled": true},
  "allow_force_pushes": {"enabled": false},
  "allow_deletions": {"enabled": false}
}
```

The independent branch query returned:

```json
{"name":"main","protected":true}
```

Both checks are bound to the verified github-actions app (15368). PRs are required, including for administrators; force pushes and deletion are disabled. Strict checks require the branch to be up to date. Required reviewer count is deliberately zero: the specification requires PRs and checks, not a second GitHub identity's approval, and this PR is authored under the sole operator's account. Shaurya's explicit review/merge authorization remains the session checkpoint. No bypass allowances were added. No attempted direct push to main was used as a test; verification is the queried active configuration, as required by Task 0C.

Reproduce protection verification:

```sh
gh api repos/shaurya-05/the-foundry/branches/main/protection
gh api repos/shaurya-05/the-foundry/branches/main --jq '{name: .name, protected: .protected}'
```

## Deferred work and limits

- No application mass-fixes. The punctuation warnings and four hook warnings remain visible.
- npm ci reports 11 dependency vulnerabilities (1 low, 1 moderate, 8 high, 1 critical); security remediation is outside this CI repair.
- The runtime model_used failover telemetry bug is untouched; adding its database column does not fix it.
- No production database, model inference, or live production request has been changed or verified in this stage.
- GitHub emits action-runtime deprecation and upcoming ubuntu-latest image-change notices; updating action versions or runner policy is deferred.
- Docker image build remains the existing main-only job; the PR requires frontend and backend.
- Both prior checkouts were preserved. Work is isolated in the-foundry-stage-0 on stage-0/ci-protection from freshly fetched origin/main c95d0fb.

## Notes for later work

- Migration filenames changed; any external manual instructions referring to 000b/000c must use the new 006_copilot_* names. The checked-in Docker Compose references are updated. Existing columns are preserved by unchanged ADD COLUMN IF NOT EXISTS statements. No production migrations were run.
- CI continues using the configured Neo4j major tag, neo4j:5, rather than inventing a patch version.
- Team access design must make onboarding and role-appropriate access straightforward through the unified identity; no Stage 1 code or scaffolding is included here.

## Next gate

Leave this PR unmerged for Shaurya Karra. Stage 1 cannot start before Stage 0 lands and the deployment topology, real access needs/roles, and host sleep/availability questions are resolved.
