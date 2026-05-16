'use client'

import { Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

export default function JoinPage() {
  return <Suspense><JoinContent /></Suspense>
}

function JoinContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const token = searchParams.get('token')

  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  if (!token) {
    return (
      <Shell eyebrow="ERROR" title="Invalid invitation link.">
        <button onClick={() => router.push('/login')} style={primaryBtnStyle}>
          <span>Go to sign in</span><span aria-hidden="true">→</span>
        </button>
      </Shell>
    )
  }

  // Not logged in — redirect to login with redirect back here
  if (!authLoading && !user) {
    router.push(`/login?redirect=${encodeURIComponent(`/join?token=${token}`)}`)
    return null
  }

  if (authLoading) {
    return (
      <Shell eyebrow="LOADING" title="Verifying invitation…">
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 6, height: 6, background: 'var(--color-arc-cyan)',
              animation: `h3ros-pulse-opacity 1.2s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
      </Shell>
    )
  }

  async function handleJoin() {
    setJoining(true)
    setError('')
    try {
      await api.workspace.join(token!)
      setSuccess(true)
      setTimeout(() => {
        window.location.href = '/dashboard'
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join workspace.')
    } finally {
      setJoining(false)
    }
  }

  if (success) {
    return (
      <Shell eyebrow="WELCOME" title="You're on the crew.">
        <p style={leadStyle}>Redirecting to your dashboard.</p>
      </Shell>
    )
  }

  return (
    <Shell eyebrow="INVITATION" title="Join this workspace.">
      <div style={{
        padding: '12px 16px',
        background: 'var(--color-off-white)',
        border: '1px solid var(--color-n200)',
        marginBottom: 20,
      }}>
        <div style={{
          fontFamily: 'var(--font-plex-mono), monospace',
          fontWeight: 500, fontSize: 10, letterSpacing: '0.10em',
          color: 'var(--color-n400)', textTransform: 'uppercase', marginBottom: 6,
        }}>
          Joining as
        </div>
        <div style={{
          fontFamily: 'var(--font-archivo), system-ui, sans-serif',
          fontWeight: 700, fontSize: 14, color: 'var(--color-ink)',
        }}>
          {user?.display_name}
        </div>
        <div style={{
          fontFamily: 'var(--font-plex-serif), serif',
          fontStyle: 'italic', fontWeight: 500, fontSize: 12,
          color: 'var(--color-n600)',
        }}>
          {user?.email}
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      <button onClick={handleJoin} disabled={joining} style={{
        ...primaryBtnStyle,
        background: joining ? 'var(--color-n200)' : 'var(--color-arc-cyan)',
        cursor: joining ? 'not-allowed' : 'pointer',
      }}>
        <span>{joining ? 'Joining…' : 'Accept invitation'}</span>
        {!joining && <span aria-hidden="true">→</span>}
      </button>

      <button onClick={() => router.push('/dashboard')} style={textLinkStyle}>
        Decline
      </button>
    </Shell>
  )
}

function Shell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
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
      <div style={{ marginBottom: 32 }}><Found3ryWordmark size="md" /></div>
      <div style={{
        width: '100%', maxWidth: 420,
        background: 'var(--color-vellum)',
        border: '1px solid var(--color-ink)',
        borderRadius: 0,
        padding: 28,
      }}>
        <EyebrowLabel number="04" keyword={eyebrow} style={{ marginBottom: 12 }} />
        <h2 style={titleStyle}>{title}</h2>
        <div style={{ margin: '12px 0 18px' }}><Crease /></div>
        {children}
      </div>
    </div>
  )
}

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-archivo-black), sans-serif',
  fontWeight: 400, fontSize: 26, lineHeight: 1.1, letterSpacing: '-0.02em',
  color: 'var(--color-ink)', margin: 0,
}
const leadStyle: React.CSSProperties = {
  fontFamily: 'var(--font-plex-serif), serif',
  fontStyle: 'italic', fontWeight: 500, fontSize: 14, lineHeight: 1.55,
  color: 'var(--color-n600)', margin: 0,
}
const primaryBtnStyle: React.CSSProperties = {
  width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '12px 20px',
  background: 'var(--color-arc-cyan)', color: 'var(--color-ink)',
  border: 'none', borderRadius: 2, cursor: 'pointer',
  fontFamily: 'var(--font-archivo), system-ui, sans-serif',
  fontWeight: 700, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase',
  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
}
const textLinkStyle: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 12,
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  fontFamily: 'var(--font-plex-serif), serif',
  fontWeight: 500, fontStyle: 'italic', fontSize: 13,
  color: 'var(--color-n600)', textAlign: 'center',
}
const errorStyle: React.CSSProperties = {
  marginBottom: 16, padding: '10px 14px',
  background: 'var(--color-off-white)',
  borderLeft: '2px solid var(--color-signal)',
  borderTop: '1px solid var(--color-n200)',
  borderRight: '1px solid var(--color-n200)',
  borderBottom: '1px solid var(--color-n200)',
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-plex-mono), monospace', fontSize: 12,
}
