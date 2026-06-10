'use client'

import { Suspense, useState, FormEvent } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function ResetPasswordPageInner() {
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
    if (password !== confirm) { setError('Passwords do not match.'); return }
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
        throw new Error(data.detail || 'Reset failed.')
      }
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

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
        <EyebrowLabel number="02" keyword="SET NEW PASSWORD" style={{ marginBottom: 12 }} />
        <h2 style={titleStyle}>Set a new password.</h2>
        <div style={{ margin: '12px 0 18px' }}><Crease /></div>

        {success ? (
          <div style={successStyle}>
            <p style={{ margin: 0 }}>Password reset successfully.</p>
            <button onClick={() => router.push('/login')} style={primaryBtnStyle}>
              <span>Sign in</span><span aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <Field label="New Password">
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-arc-cyan)')}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-n400)')}
              />
              <div style={hintStyle}>Minimum 8 characters.</div>
            </Field>
            <Field label="Confirm Password">
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-arc-cyan)')}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-n400)')}
              />
            </Field>

            {error && <div style={errorStyle}>{error}</div>}

            <button type="submit" disabled={loading} style={{
              ...primaryBtnStyle,
              background: loading ? 'var(--color-n200)' : 'var(--color-arc-cyan)',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
              <span>{loading ? 'Resetting…' : 'Reset password'}</span>
              {!loading && <span aria-hidden="true">→</span>}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={fieldLabelStyle}>{label}</div>
      {children}
    </div>
  )
}

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-archivo-black), sans-serif',
  fontWeight: 400, fontSize: 26, lineHeight: 1.1, letterSpacing: '-0.02em',
  color: 'var(--color-ink)', margin: 0,
}
const fieldLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-plex-mono), monospace',
  fontWeight: 500, fontSize: 11, letterSpacing: '0.18em',
  textTransform: 'uppercase', color: 'var(--color-n600)', marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 'none',
  borderBottom: '1px solid var(--color-n400)', borderRadius: 0,
  padding: '8px 0', fontFamily: 'var(--font-archivo), system-ui, sans-serif',
  fontWeight: 400, fontSize: 15, color: 'var(--color-ink)',
  outline: 'none', transition: 'border-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
  boxSizing: 'border-box',
}
const hintStyle: React.CSSProperties = {
  marginTop: 6, fontFamily: 'var(--font-plex-mono), monospace',
  fontWeight: 500, fontSize: 10, color: 'var(--color-n400)', letterSpacing: '0.06em',
}
const primaryBtnStyle: React.CSSProperties = {
  width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '12px 20px',
  background: 'var(--color-arc-cyan)', color: 'var(--color-ink)',
  border: 'none', borderRadius: 2, cursor: 'pointer',
  fontFamily: 'var(--font-archivo), system-ui, sans-serif',
  fontWeight: 700, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase',
  marginTop: 16,
  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
}
const errorStyle: React.CSSProperties = {
  marginBottom: 16, padding: '10px 14px',
  background: 'var(--color-vellum)',
  borderLeft: '2px solid var(--color-signal)',
  borderTop: '1px solid var(--color-n200)',
  borderRight: '1px solid var(--color-n200)',
  borderBottom: '1px solid var(--color-n200)',
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-plex-mono), monospace', fontSize: 12,
}
const successStyle: React.CSSProperties = {
  marginTop: 4, padding: '16px',
  background: 'var(--color-off-white)',
  borderLeft: '2px solid var(--color-arc-cyan)',
  borderTop: '1px solid var(--color-n200)',
  borderRight: '1px solid var(--color-n200)',
  borderBottom: '1px solid var(--color-n200)',
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-plex-serif), serif',
  fontStyle: 'italic', fontWeight: 500, fontSize: 14, lineHeight: 1.55,
}

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordPageInner /></Suspense>
}
