# Stage 0 ? Make CI Real

Status: implementation ready; real GitHub Actions and protection verification pending.
This document will be updated with actual results before Checkpoint 0.

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

## Deferred work and limits

- No application mass-fixes. The punctuation warnings and four hook warnings remain visible.
- npm ci reports 11 dependency vulnerabilities (1 low, 1 moderate, 8 high, 1 critical); security remediation is outside this CI repair.
- The runtime model_used failover telemetry bug is untouched; adding its database column does not fix it.
- No production database, model inference, or live production request has been changed or verified in this stage.
- Docker image build remains the existing main-only job; the PR requires frontend and backend.
- Both prior checkouts were preserved. Work is isolated in the-foundry-stage-0 on stage-0/ci-protection from freshly fetched origin/main c95d0fb.

## Next gate

Leave this PR unmerged for Shaurya Karra. Stage 1 cannot start before Stage 0 lands and the deployment topology, real access needs/roles, and host sleep/availability questions are resolved.
