# Last-synced timestamp indicator — DONE

## What was implemented

A `last_sync_at` timestamp label is now displayed next to each connected integration on the Settings > Connections page.

### Backend (`backend/app/routers/oauth.py`)
- `OAuthConnectionView` Pydantic model includes `last_sync_at: Optional[datetime]`
- `GET /api/oauth/connections` SQL query selects `last_sync_at` from `oauth_connections`
- Response maps `last_sync_at=r["last_sync_at"]` — no DB schema changes needed (column exists in migration 009)

### Frontend (`frontend/app/(app)/settings/connections/ConnectionsClient.tsx`)
- `Connection` type has `last_sync_at: string | null`
- `formatSyncTime(ts)` formats the timestamp per spec:
  - Under 60 minutes → `synced X min ago`
  - Under 24 hours → `synced at HH:MM`
  - Older → `synced MM/DD`
- Label is rendered inside the existing `text-xs font-mono text-n600` info row when the integration is connected and `last_sync_at` is non-null

## DB column
`oauth_connections.last_sync_at TIMESTAMPTZ` — defined in `backend/migrations/009_workspace_graph.sql` line 225. No migration needed.
