'use client'

import { useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function VerificationBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  if (dismissed) return null

  async function resend() {
    setSending(true)
    try {
      const token = localStorage.getItem('foundry_token')
      await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      setSent(true)
    } catch { /* ignore */ }
    setSending(false)
  }

  return (
    <div
      role="status"
      style={{
        padding: '10px 24px',
        background: 'var(--color-vellum)',
        borderTop: '1px solid var(--color-n200)',
        borderBottom: '1px solid var(--color-n200)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16,
      }}
    >
      <span style={{
        fontFamily: 'var(--font-plex-serif), serif',
        fontStyle: 'italic',
        fontSize: 14,
        color: 'var(--color-ink)',
      }}>
        Please verify your email address.{' '}
        {sent ? (
          <span style={{ fontStyle: 'normal', color: 'var(--color-arc-cyan-deep)' }}>Verification email sent.</span>
        ) : (
          <button
            onClick={resend}
            disabled={sending}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: 'var(--color-ink)',
              cursor: sending ? 'wait' : 'pointer',
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontWeight: 700,
              fontStyle: 'normal',
              fontSize: 14,
              textDecoration: 'underline',
              textDecorationColor: 'var(--color-arc-cyan)',
              textUnderlineOffset: '0.2em',
              textDecorationThickness: '1px',
            }}
          >
            {sending ? 'Sending…' : 'Resend verification email →'}
          </button>
        )}
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          padding: 4,
          cursor: 'pointer',
          color: 'var(--color-n400)',
          fontFamily: 'var(--font-archivo), system-ui, sans-serif',
          fontSize: 18,
          lineHeight: 1,
          transition: 'color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-ink)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-n400)')}
      >
        ×
      </button>
    </div>
  )
}
