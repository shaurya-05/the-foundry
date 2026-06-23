'use client'

/**
 * Connections settings — the surface where founders authorize the
 * connectors that feed the workspace graph.
 *
 * Per Phase 2 §4.1.2: GitHub first, Linear and Notion follow with the
 * same provider shape. Connecting kicks the user through a top-level
 * navigation to `/api/oauth/{provider}/start` (must be a full-page
 * redirect because the OAuth callback also sets a CSRF cookie scoped to
 * `/api/oauth`).
 *
 * Status from the callback comes back as a `?status=connected|error`
 * query param; we read it once and toast on mount.
 */

import { useEffect, useState , Suspense} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

type Connection = {
  provider: string
  provider_user_login: string | null
  scopes: string[] | null
  connected_at: string
  expires_at: string | null
  last_sync_at: string | null
}

function formatSyncTime(ts: string | null): string | null {
  if (!ts) return null
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 60) return `synced ${diffMin <= 1 ? '1 min' : `${diffMin} min`} ago`
  const diffHours = Math.floor(diffMs / 3_600_000)
  if (diffHours < 24) {
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    return `synced at ${hh}:${mm}`
  }
  const mo = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `synced ${mo}/${day}`
}

type SyncJob = {
  id: string
  provider: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  phase: string | null
  progress: Record<string, number | string>
  error: string | null
  started_at: string | null
  completed_at: string | null
}

const PROVIDER_META: Record<string, { label: string; tagline: string; status: 'live' | 'soon' }> = {
  github: {
    label: 'GitHub',
    tagline: 'Commits, PRs, issues, repo activity. Read-only.',
    status: 'live',
  },
  linear: {
    label: 'Linear',
    tagline: 'Issues, projects, cycles — every venture in one timeline.',
    status: 'soon',
  },
  notion: {
    label: 'Notion',
    tagline: 'Docs, databases, decision logs across portfolio workspaces.',
    status: 'live',
  },
  google: {
    label: 'Google Drive',
    tagline: 'Create Docs from COFOUND3R responses. Sync files into Knowledge.',
    status: 'live',
  },
}

function ConnectionsClientInner() {
  const router = useRouter()
  const search = useSearchParams()
  const { user, loading } = useAuth()
  const [connections, setConnections] = useState<Connection[]>([])
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  // Surface the callback result
  useEffect(() => {
    const status = search.get('status')
    const provider = search.get('provider') || ''
    const reason = search.get('reason') || ''
    if (status === 'connected') {
      setBanner({ tone: 'ok', text: `${provider || 'Provider'} connected.` })
    } else if (status === 'error') {
      setBanner({ tone: 'err', text: `Connection failed${reason ? `: ${reason}` : ''}` })
    }
  }, [search])

  async function loadConnections() {
    const token = localStorage.getItem('foundry_token')
    if (!token) return
    const res = await fetch(`${API_URL}/api/oauth/connections`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setConnections(await res.json())
  }

  async function loadSyncJobs() {
    const token = localStorage.getItem('foundry_token')
    if (!token) return
    const res = await fetch(`${API_URL}/api/oauth/sync/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setSyncJobs(await res.json())
  }

  useEffect(() => {
    if (!user) return
    loadConnections()
    loadSyncJobs()
  }, [user])

  // Poll sync status while any job is still running
  useEffect(() => {
    if (!user) return
    const hasRunning = syncJobs.some((j) => j.status === 'pending' || j.status === 'running')
    if (!hasRunning) return
    const t = setInterval(loadSyncJobs, 4000)
    return () => clearInterval(t)
  }, [user, syncJobs])

  async function rerunSync(provider: string) {
    const token = localStorage.getItem('foundry_token')
    if (!token) return
    setBusy(`sync:${provider}`)
    try {
      const res = await fetch(`${API_URL}/api/oauth/connections/${provider}/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setBanner({ tone: 'ok', text: `Sync re-enqueued for ${provider}.` })
        loadSyncJobs()
      } else {
        const d = await res.json().catch(() => ({}))
        setBanner({ tone: 'err', text: d.detail || 'Re-sync failed to enqueue' })
      }
    } finally {
      setBusy(null)
    }
  }

  async function startConnect(provider: string) {
    const token = localStorage.getItem('foundry_token')
    if (!token) return
    setBusy(provider)
    try {
      const res = await fetch(`${API_URL}/api/oauth/${provider}/authorize-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include', // lets the Set-Cookie for CSRF nonce stick
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || `HTTP ${res.status}`)
      }
      const { authorize_url } = await res.json()
      window.location.href = authorize_url
    } catch (e: any) {
      setBanner({ tone: 'err', text: e?.message || 'Could not start the OAuth flow' })
      setBusy(null)
    }
  }

  async function revoke(provider: string) {
    const token = localStorage.getItem('foundry_token')
    if (!token) return
    if (!window.confirm(`Disconnect ${PROVIDER_META[provider]?.label || provider}?`)) return
    setBusy(provider)
    try {
      const res = await fetch(`${API_URL}/api/oauth/connections/${provider}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setBanner({ tone: 'ok', text: `${PROVIDER_META[provider]?.label || provider} disconnected.` })
        await loadConnections()
      } else {
        const d = await res.json().catch(() => ({}))
        setBanner({ tone: 'err', text: d.detail || 'Revoke failed' })
      }
    } finally {
      setBusy(null)
    }
  }

  if (loading || !user) return null

  const connectionByProvider = new Map(connections.map((c) => [c.provider, c]))

  return (
    <div className="min-h-screen bg-off-white px-6 py-16 font-archivo">
      <div className="mx-auto max-w-3xl">
        <div className="mb-2">
          <EyebrowLabel number="01" keyword="Connectors" />
        </div>
        <h1 className="font-archivo-black text-4xl text-ink leading-none mb-2">Connections.</h1>
        <p className="text-n600 text-base mb-6 max-w-xl">
          Authorize the tools you already use. Passive ingestion only — your data stays where it is;
          we just index it into your workspace graph so the agent can reason across everything you ship.
        </p>
        <Crease />

        {banner && (
          <div
            className={`mt-6 border px-4 py-3 text-sm ${
              banner.tone === 'ok'
                ? 'border-arc-cyan-deep text-ink bg-vellum'
                : 'border-signal text-signal bg-vellum'
            }`}
          >
            {banner.text}
          </div>
        )}

        <div className="mt-8 border border-n200">
          {Object.entries(PROVIDER_META).map(([provider, meta], i) => {
            const conn = connectionByProvider.get(provider)
            const isConnected = !!conn
            return (
              <div
                key={provider}
                className={`flex items-start justify-between gap-6 p-5 ${
                  i > 0 ? 'border-t border-n200' : ''
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-archivo-black text-lg text-ink">{meta.label}</span>
                    {meta.status === 'soon' && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-n600 border border-n200 px-2 py-0.5">
                        Soon
                      </span>
                    )}
                    {isConnected && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-ink bg-arc-cyan px-2 py-0.5">
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-n600">{meta.tagline}</p>
                  {isConnected && (
                    <div className="mt-2 text-xs font-mono text-n600">
                      {conn.provider_user_login ? `@${conn.provider_user_login}` : 'authenticated'}
                      {conn.scopes?.length ? ` · ${conn.scopes.join(' ')}` : ''}
                      {formatSyncTime(conn.last_sync_at) && (
                        <span className="ml-3">{formatSyncTime(conn.last_sync_at)}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  {meta.status === 'soon' ? (
                    <button
                      disabled
                      className="border border-n200 text-n600 px-4 py-2 text-xs font-mono uppercase tracking-wider cursor-not-allowed"
                    >
                      Coming soon
                    </button>
                  ) : isConnected ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => rerunSync(provider)}
                        disabled={busy === `sync:${provider}`}
                        className="border border-arc-cyan-deep text-arc-cyan-deep px-3 py-2 text-xs font-mono uppercase tracking-wider hover:bg-arc-cyan transition-colors"
                      >
                        {busy === `sync:${provider}` ? 'Queuing…' : 'Re-sync'}
                      </button>
                      <button
                        onClick={() => revoke(provider)}
                        disabled={busy === provider}
                        className="border border-ink text-ink px-4 py-2 text-xs font-mono uppercase tracking-wider hover:bg-ink hover:text-off-white transition-colors"
                      >
                        {busy === provider ? 'Working…' : 'Disconnect'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startConnect(provider)}
                      disabled={busy === provider}
                      className="bg-arc-cyan text-ink px-4 py-2 text-xs font-mono uppercase tracking-wider hover:bg-arc-cyan-deep transition-colors"
                    >
                      {busy === provider ? 'Opening…' : `Connect ${meta.label} →`}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {syncJobs.length > 0 && (
          <div className="mt-12">
            <EyebrowLabel number="02" keyword="Sync history" />
            <div className="mt-3 border border-n200">
              {syncJobs.map((j, i) => (
                <div
                  key={j.id}
                  className={`flex items-start justify-between gap-4 p-4 ${
                    i > 0 ? 'border-t border-n200' : ''
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-archivo-black text-sm text-ink uppercase">{j.provider}</span>
                      <span
                        className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 ${
                          j.status === 'completed'
                            ? 'bg-arc-cyan text-ink'
                            : j.status === 'failed'
                            ? 'bg-signal text-off-white'
                            : 'bg-n200 text-ink'
                        }`}
                      >
                        {j.status}
                      </span>
                      {j.phase && (
                        <span className="text-xs font-mono text-n600">{j.phase}</span>
                      )}
                    </div>
                    {Object.keys(j.progress).length > 0 && (
                      <div className="mt-1 text-xs font-mono text-n600 break-words">
                        {Object.entries(j.progress)
                          .filter(([k]) => !['current', 'total'].includes(k))
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')}
                      </div>
                    )}
                    {j.error && (
                      <div className="mt-1 text-xs text-signal">{j.error}</div>
                    )}
                  </div>
                  <div className="text-xs font-mono text-n600 shrink-0 text-right">
                    {j.started_at && new Date(j.started_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12">
          <button
            onClick={() => router.push('/settings')}
            className="text-xs font-mono uppercase tracking-wider text-n600 hover:text-ink"
          >
            ← Back to settings
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ConnectionsClient() {
  return <Suspense><ConnectionsClientInner /></Suspense>
}
