'use client'

/**
 * Optional found3ry.com cloud account linking (Phase 7a).
 * Desktop Electron only — tokens stay in safeStorage; backend stores pairing only.
 * No project/task/idea content sync in this phase.
 */
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { getToken } from '@/lib/auth'
import {
  isCloudLinkAvailable,
  type CloudLinkLocalStatus,
  type CloudSyncApiStatus,
} from '@/lib/cloudLink'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated, var(--bg-primary))',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-archivo)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
}

const btnPrimary: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  cursor: 'pointer',
  background: 'var(--color-ink)',
  color: '#fff',
  fontFamily: 'var(--font-barlow-condensed)',
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

const btnGhost: CSSProperties = {
  ...btnPrimary,
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
}

export default function CloudAccountSettings() {
  const available = isCloudLinkAvailable()
  const [apiStatus, setApiStatus] = useState<CloudSyncApiStatus | null>(null)
  const [localStatus, setLocalStatus] = useState<CloudLinkLocalStatus | null>(null)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [pushSummary, setPushSummary] = useState('')

  const refresh = useCallback(async () => {
    const token = getToken()
    if (token) {
      try {
        const res = await fetch(`${API_BASE}/api/cloud-sync/status`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          setApiStatus(await res.json())
        }
      } catch {
        /* ignore — desktop may still report local blob */
      }
    }
    if (isCloudLinkAvailable()) {
      try {
        setLocalStatus(await window.foundryCloudLink!.status())
      } catch {
        setLocalStatus(null)
      }
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!available) {
    return (
      <div style={{ padding: '4px 0 8px', fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-archivo)', lineHeight: 1.45 }}>
        Cloud account linking is available in the FOUND3RY desktop app. This browser session cannot store encrypted cloud tokens.
      </div>
    )
  }

  const linked = !!(apiStatus?.linked || localStatus?.hasStoredLink)
  const syncEnabled = apiStatus?.enabled !== false

  async function onLink(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setOkMsg('')
    try {
      const token = getToken()
      if (!token) {
        setError('Sign in to your local desktop account first.')
        return
      }
      const result = await window.foundryCloudLink!.link({
        email: email.trim(),
        password,
        mode,
        displayName: displayName.trim() || undefined,
        localAccessToken: token,
      })
      if (!result.ok) {
        setError(result.error || 'Link failed')
        return
      }
      setPassword('')
      setOkMsg(
        result.encrypted
          ? 'Cloud account linked. Tokens stored encrypted on this device.'
          : 'Cloud account linked (dev: plaintext fallback — enable OS encryption for production).',
      )
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link failed')
    } finally {
      setBusy(false)
    }
  }

  async function onUnlink() {
    if (!confirm('Unlink this cloud account? Tokens will be removed from this device. No cloud data will be deleted.')) {
      return
    }
    setBusy(true)
    setError('')
    setOkMsg('')
    setPushSummary('')
    try {
      const token = getToken()
      const result = await window.foundryCloudLink!.unlink({
        localAccessToken: token || '',
      })
      if (!result.ok) {
        setError(result.error || 'Unlink failed')
      } else {
        setOkMsg('Cloud account unlinked. Encrypted tokens cleared.')
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlink failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSyncNow() {
    setSyncing(true)
    setError('')
    setOkMsg('')
    setPushSummary('')
    try {
      const token = getToken()
      if (!token) {
        setError('Sign in to your local desktop account first.')
        return
      }
      const res = await fetch(`${API_BASE}/api/cloud-sync/push-now`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = typeof data.detail === 'string' ? data.detail : `Push failed (${res.status})`
        setError(detail)
        return
      }
      const parts: string[] = []
      for (const table of ['projects', 'ideas'] as const) {
        const t = data.tables?.[table]
        const counts = t?.response?.counts
        if (counts) {
          parts.push(
            `${table}: sent ${t.sent}, inserted ${counts.inserted}, updated ${counts.updated}, skipped ${counts['skipped-older']}, errors ${counts.error}`,
          )
        } else {
          parts.push(`${table}: sent ${t?.sent ?? 0}`)
        }
      }
      setOkMsg('Push completed.')
      setPushSummary(parts.join('\n'))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-archivo)', lineHeight: 1.45, maxWidth: 560 }}>
        Optionally link this install to a found3ry.com account (create one or sign in).
        Your local desktop account stays separate. Tokens are encrypted on this device.
        After linking, restart the app once so the cloud token loads into the backend, then use Sync now
        to push local projects and ideas (one-way, local → cloud).
      </div>

      {!syncEnabled && (
        <div style={{
          padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--border)', fontSize: 12, color: 'var(--color-n600)',
          fontFamily: 'var(--font-ibm-plex-mono)', lineHeight: 1.4,
        }}>
          Cloud sync is off (<code>CLOUD_SYNC_ENABLED=0</code>). Set it to 1 in{' '}
          <code>.env.desktop</code> and restart the app to enable linking.
        </div>
      )}

      <div style={{
        padding: '12px 14px', borderRadius: 8,
        border: '1px solid var(--border)',
        fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12,
        color: 'var(--text-primary)',
      }}>
        <div style={{ letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          Status
        </div>
        {linked ? (
          <>
            <div>Linked to cloud workspace</div>
            <div style={{ color: 'var(--text-muted)', marginTop: 4, wordBreak: 'break-all' }}>
              {apiStatus?.cloud_email || localStatus?.cloud_email || '—'}
              {' · '}
              {apiStatus?.cloud_workspace_id || localStatus?.cloud_workspace_id || '—'}
            </div>
            {(apiStatus?.linked_at || localStatus?.linked_at) && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                Linked at {apiStatus?.linked_at || localStatus?.linked_at}
              </div>
            )}
            {localStatus?.encryption?.usingEncryptedFile && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>Tokens: encrypted (safeStorage)</div>
            )}
            {apiStatus?.last_synced_at && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                Last push: {apiStatus.last_synced_at}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>Not linked</div>
        )}
      </div>

      {linked ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            onClick={onSyncNow}
            disabled={busy || syncing || !syncEnabled}
            style={{ ...btnPrimary, opacity: busy || syncing || !syncEnabled ? 0.6 : 1 }}
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button type="button" onClick={onUnlink} disabled={busy || syncing} style={btnGhost}>
            {busy ? 'Working…' : 'Unlink cloud account'}
          </button>
        </div>
      ) : (
        <form onSubmit={onLink} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 400 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setMode('login')}
              style={{
                ...btnGhost,
                opacity: mode === 'login' ? 1 : 0.55,
                borderColor: mode === 'login' ? 'var(--color-ink)' : 'var(--border)',
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              style={{
                ...btnGhost,
                opacity: mode === 'register' ? 1 : 0.55,
                borderColor: mode === 'register' ? 'var(--color-ink)' : 'var(--border)',
              }}
            >
              Create account
            </button>
          </div>
          {mode === 'register' && (
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              style={inputStyle}
              autoComplete="nickname"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Cloud account email"
            required
            style={inputStyle}
            autoComplete="username"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Cloud account password"
            required
            style={inputStyle}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
          <button type="submit" disabled={busy || !syncEnabled} style={{ ...btnPrimary, opacity: busy || !syncEnabled ? 0.6 : 1 }}>
            {busy ? 'Linking…' : mode === 'register' ? 'Create & link' : 'Sign in & link'}
          </button>
        </form>
      )}

      {error && (
        <div style={{ fontSize: 12, color: 'var(--color-ink)', fontFamily: 'var(--font-ibm-plex-mono)' }}>{error}</div>
      )}
      {okMsg && (
        <div style={{ fontSize: 12, color: 'var(--color-n600)', fontFamily: 'var(--font-ibm-plex-mono)' }}>{okMsg}</div>
      )}
      {pushSummary && (
        <pre style={{
          margin: 0, padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--border)', fontSize: 11,
          fontFamily: 'var(--font-ibm-plex-mono)', color: 'var(--text-muted)',
          whiteSpace: 'pre-wrap',
        }}>
          {pushSummary}
        </pre>
      )}
    </div>
  )
}
