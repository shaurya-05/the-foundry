'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function VerifyEmailPage() {
  return <Suspense><VerifyEmailContent /></Suspense>
}

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { refreshUser } = useAuth()
  const token = searchParams.get('token')

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('No verification token provided.')
      return
    }
    fetch(`${API_BASE}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async res => {
        if (res.ok) {
          setStatus('success')
          setMessage('Email verified.')
          await refreshUser()
          setTimeout(() => router.push('/dashboard'), 2000)
        } else {
          const data = await res.json().catch(() => ({}))
          setStatus('error')
          setMessage(data.detail || 'Verification failed.')
        }
      })
      .catch(() => {
        setStatus('error')
        setMessage('Network error.')
      })
  }, [token, refreshUser, router])

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
        padding: 32,
        textAlign: 'left',
      }}>
        <EyebrowLabel
          number="03"
          keyword={status === 'verifying' ? 'VERIFYING' : status === 'success' ? 'VERIFIED' : 'ERROR'}
          style={{ marginBottom: 12 }}
        />

        {status === 'verifying' && (
          <>
            <h2 style={titleStyle}>Verifying your email…</h2>
            <div style={{ margin: '12px 0 18px' }}><Crease /></div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  style={{
                    width: 6, height: 6,
                    background: 'var(--color-arc-cyan)',
                    animation: `h3ros-pulse-opacity 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <h2 style={titleStyle}>{message}</h2>
            <div style={{ margin: '12px 0 18px' }}><Crease /></div>
            <p style={leadStyle}>Redirecting to your dashboard.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 style={titleStyle}>{message}</h2>
            <div style={{ margin: '12px 0 18px' }}><Crease /></div>
            <button onClick={() => router.push('/dashboard')} style={primaryBtnStyle}>
              <span>Go to dashboard</span><span aria-hidden="true">→</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-archivo-black), sans-serif',
  fontWeight: 400, fontSize: 24, lineHeight: 1.15, letterSpacing: '-0.02em',
  color: 'var(--color-ink)', margin: 0,
}
const leadStyle: React.CSSProperties = {
  fontFamily: 'var(--font-plex-serif), serif',
  fontStyle: 'italic', fontWeight: 500, fontSize: 14, lineHeight: 1.55,
  color: 'var(--color-n600)', margin: 0,
}
const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '12px 20px',
  background: 'var(--color-arc-cyan)', color: 'var(--color-ink)',
  border: 'none', borderRadius: 2, cursor: 'pointer',
  fontFamily: 'var(--font-archivo), system-ui, sans-serif',
  fontWeight: 700, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase',
  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
}
