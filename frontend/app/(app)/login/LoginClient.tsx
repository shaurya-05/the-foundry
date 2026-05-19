'use client'

import { useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import H3rosWordmark from '@/components/brand/H3rosWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

type Tab = 'signin' | 'register'

export default function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login, register } = useAuth()

  const [tab, setTab]                         = useState<Tab>('signin')
  const [email, setEmail]                     = useState('')
  const [password, setPassword]               = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName]                       = useState('')
  const [termsAccepted, setTermsAccepted]     = useState(false)
  const [error, setError]                     = useState('')
  const [loading, setLoading]                 = useState(false)

  const redirect = searchParams.get('redirect')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (tab === 'register') {
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
      if (!termsAccepted) {
        setError('You must accept the Terms of Service.')
        return
      }
    }

    setLoading(true)
    try {
      if (tab === 'signin') {
        await login(email, password)
      } else {
        await register(email, password, name || undefined)
      }
      router.push(redirect || '/dashboard')
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
      {/* Wordmark */}
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <Found3ryWordmark size="md" />
        <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontFamily: 'var(--font-plex-mono), monospace',
            fontSize: 10,
            color: 'var(--color-n600)',
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
          }}>
            by
          </span>
          <H3rosWordmark size="xs" />
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'var(--color-vellum)',
        border: '1px solid var(--color-ink)',
        borderRadius: 0,
        overflow: 'hidden',
      }}>
        {/* Tabs */}
        <div style={{
          display: 'flex',
          background: 'var(--color-vellum)',
          borderBottom: '1px solid var(--color-n200)',
        }}>
          {(['signin', 'register'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setError('') }}
              style={{
                flex: 1,
                padding: '14px 16px',
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--color-arc-cyan)' : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color: tab === t ? 'var(--color-ink)' : 'var(--color-n600)',
                transition: 'color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
              }}
            >
              {t === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: 28, background: 'var(--color-off-white)' }}>
          <EyebrowLabel
            number={tab === 'signin' ? '01' : '01'}
            keyword={tab === 'signin' ? 'ACCESS' : 'NEW BUILDER'}
            style={{ marginBottom: 14 }}
          />
          <Crease />
          <div style={{ height: 20 }} />

          {tab === 'register' && (
            <Field label="Display Name">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-arc-cyan)')}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-n400)')}
              />
            </Field>
          )}

          <Field label="Email">
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-arc-cyan)')}
              onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-n400)')}
            />
          </Field>

          <Field label="Password">
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
            {tab === 'register' && (
              <div style={hintStyle}>Minimum 8 characters.</div>
            )}
          </Field>

          {tab === 'signin' && (
            <div style={{ marginBottom: 20, marginTop: -10, textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => router.push('/forgot-password')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  color: 'var(--color-ink)',
                  fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--color-arc-cyan)',
                  textUnderlineOffset: '0.2em',
                }}
              >
                Forgot password?
              </button>
            </div>
          )}

          {tab === 'register' && (
            <Field label="Confirm Password">
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-arc-cyan)')}
                onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-n400)')}
              />
            </Field>
          )}

          {tab === 'register' && (
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              marginBottom: 20,
              cursor: 'pointer',
              fontFamily: 'var(--font-plex-serif), serif',
              fontWeight: 500,
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--color-n600)',
              lineHeight: 1.5,
            }}>
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={e => setTermsAccepted(e.target.checked)}
                style={{ marginTop: 3, accentColor: 'var(--color-arc-cyan-deep)' }}
              />
              <span>
                I agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" style={termsLinkStyle}>Terms of Service</a>
                {' '}and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" style={termsLinkStyle}>Privacy Policy</a>.
              </span>
            </label>
          )}

          {error && (
            <div style={{
              marginBottom: 16,
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

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 20px',
              background: loading ? 'var(--color-n200)' : 'var(--color-arc-cyan)',
              color: 'var(--color-ink)',
              border: 'none',
              borderRadius: 2,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan-deep)' }}
            onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan)' }}
          >
            <span>
              {loading
                ? (tab === 'signin' ? 'Signing in…' : 'Creating account…')
                : (tab === 'signin' ? 'Sign in' : 'Create account')}
            </span>
            {!loading && <span aria-hidden="true">→</span>}
          </button>

          {tab === 'signin' && (
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setTab('register')}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-plex-serif), serif',
                  fontWeight: 500,
                  fontStyle: 'italic',
                  fontSize: 13,
                  color: 'var(--color-n600)',
                }}
              >
                No account?{' '}
                <span style={{
                  fontStyle: 'normal',
                  color: 'var(--color-ink)',
                  textDecoration: 'underline',
                  textDecorationColor: 'var(--color-arc-cyan)',
                  textUnderlineOffset: '0.2em',
                  fontWeight: 700,
                }}>
                  Create one →
                </span>
              </button>
            </div>
          )}
        </form>
      </div>

      <div style={{
        marginTop: 28,
        fontFamily: 'var(--font-plex-mono), monospace',
        fontWeight: 500,
        fontSize: 10,
        color: 'var(--color-n600)',
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        textAlign: 'center',
      }}>
        Builder OS · Source · Forge · Cast · Ship
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontFamily: 'var(--font-plex-mono), monospace',
        fontWeight: 500,
        fontSize: 11,
        color: 'var(--color-n600)',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--color-n400)',
  borderRadius: 0,
  padding: '8px 0',
  fontFamily: 'var(--font-archivo), system-ui, sans-serif',
  fontWeight: 400,
  fontSize: 15,
  lineHeight: 1.3,
  color: 'var(--color-ink)',
  outline: 'none',
  transition: 'border-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
  boxSizing: 'border-box',
}

const hintStyle: React.CSSProperties = {
  marginTop: 6,
  fontFamily: 'var(--font-plex-mono), monospace',
  fontWeight: 500,
  fontSize: 10,
  color: 'var(--color-n400)',
  letterSpacing: '0.06em',
}

const termsLinkStyle: React.CSSProperties = {
  fontStyle: 'normal',
  color: 'var(--color-ink)',
  textDecoration: 'underline',
  textDecorationColor: 'var(--color-arc-cyan)',
  textUnderlineOffset: '0.2em',
  fontWeight: 700,
}
