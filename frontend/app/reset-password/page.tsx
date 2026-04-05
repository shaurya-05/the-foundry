'use client'

import { Suspense, useState, FormEvent } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordContent /></Suspense>
}

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  if (!token) {
    router.push('/forgot-password')
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Reset failed')
      }
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
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
          color: '#0A0C12', marginBottom: 24,
        }}>
          Set New Password
        </h2>

        {success ? (
          <div style={{
            padding: '16px', background: 'rgba(45,204,114,0.08)',
            border: '1px solid rgba(45,204,114,0.3)', borderRadius: 8,
            color: '#1a8a4a', fontSize: 14, fontFamily: 'var(--font-ibm-plex-mono)',
          }}>
            Password reset successfully!
            <button onClick={() => router.push('/login')} style={{
              display: 'block', marginTop: 16, padding: '10px 24px',
              background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
              color: '#FFF', border: 'none', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
              fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>New Password</label>
              <input type="password" required minLength={8} value={password}
                onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
              <div style={{ marginTop: 5, fontSize: 11, color: '#9CA3AF', fontFamily: 'var(--font-ibm-plex-mono)' }}>
                Minimum 8 characters
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Confirm Password</label>
              <input type="password" required minLength={8} value={confirm}
                onChange={e => setConfirm(e.target.value)} placeholder="••••••••" style={inputStyle} />
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

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '11px 20px',
              background: loading ? '#E5E7EB' : 'linear-gradient(135deg, #E8231F, #C81E1C)',
              color: loading ? '#9CA3AF' : '#FFF', border: 'none', borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
              fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
