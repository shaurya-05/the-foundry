'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth, getToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

export default function OnboardingConnectPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, token, loading } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) { router.push('/login'); return }
    if (user.onboarding_step === 0) { router.push('/onboarding/venture'); return }
  }, [user, loading, router])

  // Handle OAuth callback redirect — ?status=connected or ?status=error
  useEffect(() => {
    const status = searchParams.get('status')
    if (status !== 'connected') {
      if (status === 'error') {
        const reason = searchParams.get('reason')
        setError(`Connection failed${reason ? `: ${reason}` : ''}`)
      }
      return
    }

    // GitHub returned successfully — advance the onboarding step
    const t = getToken()
    if (!t) return

    fetch(`${API_URL}/api/workspaces/onboarding-step`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ step: 2 }),
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => { throw new Error(d.detail || 'Step update failed') })
      })
      .then(() => router.push('/onboarding/ask'))
      .catch((e) => setError(e.message || 'Failed to advance onboarding'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startConnect() {
    if (!token || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/oauth/github/authorize-url`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || `HTTP ${res.status}`)
      }
      const { authorize_url } = await res.json()
      window.location.href = authorize_url
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start the OAuth flow')
      setBusy(false)
    }
  }

  function skip() {
    const isSecure = typeof window !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `foundry_onboarding_done=1; path=/; SameSite=Lax${isSecure}; max-age=31536000`
    router.push('/dashboard')
  }

  if (loading || !user) return null

  return (
    <div
      className="h3ros-dot-grid-light"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Wordmark */}
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <Found3ryWordmark size="md" />
        <div style={{
          marginTop: 8,
          fontFamily: 'var(--font-plex-mono), monospace',
          fontSize: 10,
          color: 'var(--color-n600)',
          letterSpacing: '0.10em',
          textTransform: 'uppercase',
        }}>
          Builder OS
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: 'var(--color-vellum)',
        border: '1px solid var(--color-ink)',
        borderRadius: 0,
        overflow: 'hidden',
      }}>
        {/* Header bar */}
        <div style={{
          padding: '16px 28px',
          borderBottom: '1px solid var(--color-n200)',
          background: 'var(--color-vellum)',
        }}>
          <EyebrowLabel number="02" keyword="CONNECT" />
        </div>

        {/* Content */}
        <div style={{ padding: 28, background: 'var(--color-off-white)' }}>
          <Crease />
          <div style={{ height: 20 }} />

          <div style={{
            marginBottom: 8,
            fontFamily: 'var(--font-plex-serif), serif',
            fontWeight: 500,
            fontStyle: 'italic',
            fontSize: 22,
            color: 'var(--color-ink)',
            lineHeight: 1.3,
          }}>
            Connect your first tool
          </div>

          <div style={{
            marginBottom: 28,
            fontFamily: 'var(--font-plex-mono), monospace',
            fontSize: 12,
            color: 'var(--color-n600)',
            letterSpacing: '0.04em',
          }}>
            We read commits, PRs, and issues. We never write to your repos.
          </div>

          {error && (
            <div style={{
              marginBottom: 20,
              padding: '10px 14px',
              background: 'var(--color-vellum)',
              borderLeft: '2px solid var(--color-signal)',
              borderTop: '1px solid var(--color-n200)',
              borderRight: '1px solid var(--color-n200)',
              borderBottom: '1px solid var(--color-n200)',
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-plex-mono), monospace',
              fontSize: 12,
              letterSpacing: '0.04em',
            }}>
              {error}
            </div>
          )}

          {/* GitHub connect button */}
          <button
            onClick={startConnect}
            disabled={busy}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '12px 20px',
              background: busy ? 'var(--color-n200)' : 'var(--color-arc-cyan)',
              color: 'var(--color-ink)',
              border: 'none',
              borderRadius: 2,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
            }}
            onMouseEnter={(e) => { if (!busy) e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan-deep)' }}
            onMouseLeave={(e) => { if (!busy) e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan)' }}
          >
            {/* GitHub mark */}
            {!busy && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
            )}
            <span>{busy ? 'Opening GitHub…' : 'Connect GitHub →'}</span>
          </button>

          {/* Coming soon */}
          <div style={{
            marginTop: 16,
            fontFamily: 'var(--font-plex-mono), monospace',
            fontSize: 11,
            color: 'var(--color-n600)',
            letterSpacing: '0.06em',
            textAlign: 'center',
          }}>
            Notion and Linear coming soon
          </div>
        </div>
      </div>

      {/* Skip link */}
      <button
        onClick={skip}
        style={{
          marginTop: 20,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--font-plex-mono), monospace',
          fontSize: 11,
          color: 'var(--color-n600)',
          letterSpacing: '0.06em',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
          padding: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-ink)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-n600)')}
      >
        Skip for now — connect later
      </button>

      {/* Step indicator */}
      <div style={{
        marginTop: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: i === 1 ? 20 : 6,
              height: 6,
              borderRadius: 3,
              background: i === 1 ? 'var(--color-arc-cyan)' : 'var(--color-n300)',
              transition: 'all var(--duration-fast, 120ms)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
