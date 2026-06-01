'use client'

import { useState, FormEvent, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

export default function OnboardingVenturePage() {
  const router = useRouter()
  const { user, token, loading } = useAuth()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
    // Skip onboarding if already past step 0
    if (!loading && user && user.onboarding_step > 0) {
      router.push('/dashboard')
    }
  }, [user, loading, router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || submitting) return

    setError('')
    setSubmitting(true)

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }

      // Create the venture
      const ventureRes = await fetch(`${API_URL}/api/ventures`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!ventureRes.ok) {
        const err = await ventureRes.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to create venture')
      }

      // Advance onboarding step
      const stepRes = await fetch(`${API_URL}/api/workspaces/onboarding-step`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ step: 1 }),
      })
      if (!stepRes.ok) {
        const err = await stepRes.json().catch(() => ({}))
        throw new Error(err.detail || 'Failed to update onboarding step')
      }

      router.push('/onboarding/connect')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
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
          <EyebrowLabel number="01" keyword="VENTURE" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: 28, background: 'var(--color-off-white)' }}>
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
            What are you working on?
          </div>

          <div style={{
            marginBottom: 28,
            fontFamily: 'var(--font-plex-mono), monospace',
            fontSize: 12,
            color: 'var(--color-n600)',
            letterSpacing: '0.04em',
          }}>
            Give your first venture a name. You can rename it at any time.
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontFamily: 'var(--font-plex-mono), monospace',
              fontWeight: 500,
              fontSize: 11,
              color: 'var(--color-n600)',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              Venture name
            </div>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Corp, Side Project, The New Thing"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--color-n400)',
                borderRadius: 0,
                padding: '8px 0',
                fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                fontWeight: 400,
                fontSize: 16,
                lineHeight: 1.3,
                color: 'var(--color-ink)',
                outline: 'none',
                transition: 'border-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-arc-cyan)')}
              onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--color-n400)')}
            />
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

          <button
            type="submit"
            disabled={submitting || !name.trim()}
            style={{
              width: '100%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 20px',
              background: (submitting || !name.trim()) ? 'var(--color-n200)' : 'var(--color-arc-cyan)',
              color: 'var(--color-ink)',
              border: 'none',
              borderRadius: 2,
              cursor: (submitting || !name.trim()) ? 'not-allowed' : 'pointer',
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
            }}
            onMouseEnter={(e) => {
              if (!submitting && name.trim()) e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan-deep)'
            }}
            onMouseLeave={(e) => {
              if (!submitting && name.trim()) e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan)'
            }}
          >
            <span>{submitting ? 'Creating venture…' : 'Continue'}</span>
            {!submitting && <span aria-hidden="true">→</span>}
          </button>
        </form>
      </div>

      {/* Step indicator */}
      <div style={{
        marginTop: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              width: i === 0 ? 20 : 6,
              height: 6,
              borderRadius: 3,
              background: i === 0 ? 'var(--color-arc-cyan)' : 'var(--color-n300)',
              transition: 'all var(--duration-fast, 120ms)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
