'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error('Request failed')
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 6, fontSize: 11, fontWeight: 600,
    letterSpacing: '0.07em', textTransform: 'uppercase', color: '#374151',
    fontFamily: 'var(--font-barlow-condensed)',
  }
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', background: '#F9FAFB',
    border: '1px solid rgba(0,0,0,0.10)', borderRadius: 7, fontSize: 14,
    color: '#0A0C12', fontFamily: 'var(--font-barlow)', outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#F4F5F7',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-barlow)', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 400, background: '#FFF',
        borderRadius: 14, padding: 32,
        border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
          fontSize: 18, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: '#0A0C12', marginBottom: 8,
        }}>
          Reset Password
        </h2>
        <p style={{ color: '#6B7280', fontSize: 13, marginBottom: 24, fontFamily: 'var(--font-ibm-plex-mono)' }}>
          Enter your email and we&apos;ll send you a reset link.
        </p>

        {sent ? (
          <div style={{
            padding: '16px', background: 'rgba(45,204,114,0.08)',
            border: '1px solid rgba(45,204,114,0.3)', borderRadius: 8,
            color: '#1a8a4a', fontSize: 14, fontFamily: 'var(--font-ibm-plex-mono)',
          }}>
            If an account exists with that email, we&apos;ve sent a password reset link. Check your inbox.
            <button
              onClick={() => router.push('/login')}
              style={{
                display: 'block', marginTop: 16, background: 'none', border: 'none',
                color: '#E8231F', cursor: 'pointer', fontSize: 12,
                fontFamily: 'var(--font-ibm-plex-mono)', textDecoration: 'underline',
              }}
            >
              Back to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Email</label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" style={inputStyle}
              />
            </div>

            {error && (
              <div style={{
                marginBottom: 16, padding: '10px 14px',
                background: 'rgba(232,35,31,0.06)', border: '1px solid rgba(232,35,31,0.2)',
                borderRadius: 8, color: '#C81E1C', fontSize: 13,
                fontFamily: 'var(--font-ibm-plex-mono)',
              }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '11px 20px',
              background: loading ? '#E5E7EB' : 'linear-gradient(135deg, #E8231F, #C81E1C)',
              color: loading ? '#9CA3AF' : '#FFF', border: 'none', borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
              fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>

            <button type="button" onClick={() => router.push('/login')} style={{
              display: 'block', width: '100%', marginTop: 16, background: 'none',
              border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 12,
              fontFamily: 'var(--font-ibm-plex-mono)', textAlign: 'center',
            }}>
              Back to Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
