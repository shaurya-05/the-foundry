'use client'

import { useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'

type Tab = 'signin' | 'register'

export default function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login, register } = useAuth()

  const [tab, setTab]                     = useState<Tab>('signin')
  const [email, setEmail]                 = useState('')
  const [password, setPassword]           = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName]                   = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [error, setError]                 = useState('')
  const [loading, setLoading]             = useState(false)

  const redirect = searchParams.get('redirect')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (tab === 'register') {
      if (password !== confirmPassword) {
        setError('Passwords do not match')
        return
      }
      if (!termsAccepted) {
        setError('You must accept the Terms of Service')
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
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F4F5F7',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      fontFamily: 'var(--font-barlow)',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
        <div style={{
          width: 34, height: 34,
          background: 'linear-gradient(135deg, #D12D1F 0%, #D4A017 100%)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 16px rgba(232,35,31,0.25)',
        }}>
          <svg width="17" height="17" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1L14 4.5V10.5L7.5 14L1 10.5V4.5L7.5 1Z" stroke="white" strokeWidth="1.4" fill="none" />
            <path d="M7.5 1L7.5 14M1 4.5L14 10.5M14 4.5L1 10.5" stroke="white" strokeWidth="0.7" opacity="0.45" />
          </svg>
        </div>
        <div>
          <div style={{
            fontFamily: 'var(--font-barlow-condensed)',
            fontWeight: 700, fontSize: 18, letterSpacing: '0.10em',
            textTransform: 'uppercase', lineHeight: 1.1,
          }}><span style={{ color: '#2563EB' }}>THE </span><span style={{ color: '#D12D1F' }}>FOUND</span><span style={{ color: '#D4A017' }}>3</span><span style={{ color: '#D12D1F' }}>RY</span></div>
          <div style={{
            fontFamily: 'var(--font-barlow-condensed)',
            fontSize: 10, letterSpacing: '0.10em', fontWeight: 600,
          }}><span style={{ color: 'var(--text-muted, #6B7280)' }}>by </span><span style={{ color: '#2563EB', fontWeight: 700 }}>h</span><span style={{ color: '#F97316', fontWeight: 700 }}>3</span><span style={{ color: '#2563EB', fontWeight: 700 }}>ros</span></div>
        </div>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 400,
        background: '#FFFFFF',
        borderRadius: 14,
        border: '1px solid rgba(0,0,0,0.07)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        overflow: 'hidden',
      }}>
        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(0,0,0,0.07)',
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
                cursor: 'pointer',
                fontFamily: 'var(--font-barlow-condensed)',
                fontWeight: 600,
                fontSize: 12,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: tab === t ? '#E8231F' : '#6B7280',
                borderBottom: tab === t ? '2px solid #E8231F' : '2px solid transparent',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {t === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: 28 }}>
          {tab === 'register' && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Display Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                style={inputStyle}
              />
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: tab === 'register' ? 16 : 8 }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
            />
            {tab === 'register' && (
              <div style={{ marginTop: 5, fontSize: 11, color: '#9CA3AF', fontFamily: 'var(--font-ibm-plex-mono)' }}>
                Minimum 8 characters
              </div>
            )}
          </div>

          {/* Forgot password link (sign in only) */}
          {tab === 'signin' && (
            <div style={{ marginBottom: 20, textAlign: 'right' }}>
              <button
                type="button"
                onClick={() => router.push('/forgot-password')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: '#E8231F', fontFamily: 'var(--font-ibm-plex-mono)',
                  textDecoration: 'underline',
                }}
              >
                Forgot password?
              </button>
            </div>
          )}

          {/* Confirm password (register only) */}
          {tab === 'register' && (
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Confirm Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
              />
            </div>
          )}

          {/* Terms checkbox (register only) */}
          {tab === 'register' && (
            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              marginBottom: 20, cursor: 'pointer',
              fontSize: 12, color: '#6B7280', fontFamily: 'var(--font-ibm-plex-mono)',
            }}>
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={e => setTermsAccepted(e.target.checked)}
                style={{ marginTop: 2, accentColor: '#E8231F' }}
              />
              <span>
                I agree to the{' '}
                <span style={{ color: '#E8231F', textDecoration: 'underline' }}>Terms of Service</span>
                {' '}and{' '}
                <span style={{ color: '#E8231F', textDecoration: 'underline' }}>Privacy Policy</span>
              </span>
            </label>
          )}

          {error && (
            <div style={{
              marginBottom: 16,
              padding: '10px 14px',
              background: 'rgba(232,35,31,0.06)',
              border: '1px solid rgba(232,35,31,0.2)',
              borderRadius: 8,
              color: '#C81E1C',
              fontSize: 13,
              fontFamily: 'var(--font-ibm-plex-mono)',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '11px 20px',
              background: loading ? '#E5E7EB' : 'linear-gradient(135deg, #E8231F 0%, #C81E1C 100%)',
              color: loading ? '#9CA3AF' : '#FFFFFF',
              border: 'none',
              borderRadius: 8,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-barlow-condensed)',
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              transition: 'opacity 0.15s',
            }}
          >
            {loading
              ? (tab === 'signin' ? 'Signing in…' : 'Creating account…')
              : (tab === 'signin' ? 'Sign In' : 'Create Account')}
          </button>

          {tab === 'signin' && (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setTab('register')}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: '#6B7280', fontFamily: 'var(--font-ibm-plex-mono)',
                }}
              >
                No account?{' '}
                <span style={{ color: '#E8231F', textDecoration: 'underline' }}>Create one →</span>
              </button>
            </div>
          )}
        </form>
      </div>

      <div style={{
        marginTop: 24, fontSize: 11,
        color: '#9CA3AF', fontFamily: 'var(--font-ibm-plex-mono)',
        letterSpacing: '0.06em',
      }}>
        AI-powered builder OS · Your ideas, forged.
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: '#374151',
  fontFamily: 'var(--font-barlow-condensed)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: '#F9FAFB',
  border: '1px solid rgba(0,0,0,0.10)',
  borderRadius: 7,
  fontSize: 14,
  color: '#0A0C12',
  fontFamily: 'var(--font-barlow)',
  outline: 'none',
  boxSizing: 'border-box',
}
