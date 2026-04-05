'use client'

import { Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

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
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 32, marginBottom: 16, color: '#E8231F' }}>&#10007;</div>
          <p style={{ color: '#C81E1C', fontWeight: 600 }}>Invalid invitation link</p>
          <button onClick={() => router.push('/login')} style={btnStyle}>Go to Sign In</button>
        </div>
      </div>
    )
  }

  // Not logged in — redirect to login with redirect back here
  if (!authLoading && !user) {
    router.push(`/login?redirect=${encodeURIComponent(`/join?token=${token}`)}`)
    return null
  }

  if (authLoading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ color: '#6B7280', fontFamily: 'var(--font-ibm-plex-mono)' }}>Loading...</p>
        </div>
      </div>
    )
  }

  async function handleJoin() {
    setJoining(true)
    setError('')
    try {
      await api.workspace.join(token!)
      setSuccess(true)
      setTimeout(() => {
        window.location.href = '/dashboard' // Full reload to pick up new workspace
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join workspace')
    } finally {
      setJoining(false)
    }
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {success ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 16, color: '#2DCC72' }}>&#10003;</div>
            <p style={{ color: '#374151', fontWeight: 600, fontSize: 16 }}>Welcome to the team!</p>
            <p style={{ color: '#9CA3AF', fontSize: 13, marginTop: 8, fontFamily: 'var(--font-ibm-plex-mono)' }}>
              Redirecting to dashboard...
            </p>
          </>
        ) : (
          <>
            <h2 style={{
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
              fontSize: 20, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: '#0A0C12', marginBottom: 8,
            }}>
              Workspace Invitation
            </h2>
            <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 24, fontFamily: 'var(--font-ibm-plex-mono)' }}>
              You&apos;ve been invited to join a workspace. Click below to accept.
            </p>

            <div style={{
              padding: '12px 16px', background: '#F9FAFB',
              borderRadius: 8, marginBottom: 20,
              fontSize: 13, fontFamily: 'var(--font-ibm-plex-mono)', color: '#374151',
            }}>
              Joining as <strong>{user?.display_name}</strong> ({user?.email})
            </div>

            {error && (
              <div style={{
                marginBottom: 16, padding: '10px 14px',
                background: 'rgba(232,35,31,0.06)', border: '1px solid rgba(232,35,31,0.2)',
                borderRadius: 8, color: '#C81E1C', fontSize: 13, fontFamily: 'var(--font-ibm-plex-mono)',
              }}>
                {error}
              </div>
            )}

            <button onClick={handleJoin} disabled={joining} style={{
              ...btnStyle,
              background: joining ? '#E5E7EB' : 'linear-gradient(135deg, #E8231F, #C81E1C)',
              color: joining ? '#9CA3AF' : '#FFF',
              cursor: joining ? 'not-allowed' : 'pointer',
            }}>
              {joining ? 'Joining...' : 'Accept Invitation'}
            </button>

            <button onClick={() => router.push('/dashboard')} style={{
              display: 'block', width: '100%', marginTop: 12, background: 'none',
              border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 12,
              fontFamily: 'var(--font-ibm-plex-mono)', textAlign: 'center',
            }}>
              Decline
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh', background: '#F4F5F7',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'var(--font-barlow)', padding: 24,
}

const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 420, background: '#FFF',
  borderRadius: 14, padding: 36, textAlign: 'center',
  border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
}

const btnStyle: React.CSSProperties = {
  width: '100%', padding: '11px 20px',
  background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
  color: '#FFF', border: 'none', borderRadius: 8, cursor: 'pointer',
  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
  fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
}
