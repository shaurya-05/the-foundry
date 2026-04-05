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
    <div style={{
      padding: '10px 24px',
      background: 'linear-gradient(90deg, rgba(232,35,31,0.08), rgba(255,122,26,0.08))',
      borderBottom: '1px solid rgba(232,35,31,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 13, fontFamily: 'var(--font-ibm-plex-mono)', color: '#374151',
    }}>
      <span>
        Please verify your email address.{' '}
        {sent ? (
          <span style={{ color: '#2DCC72' }}>Verification email sent!</span>
        ) : (
          <button onClick={resend} disabled={sending} style={{
            background: 'none', border: 'none', color: '#E8231F',
            cursor: 'pointer', textDecoration: 'underline', fontSize: 13,
            fontFamily: 'var(--font-ibm-plex-mono)',
          }}>
            {sending ? 'Sending...' : 'Resend verification email'}
          </button>
        )}
      </span>
      <button onClick={() => setDismissed(true)} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: '#9CA3AF', fontSize: 16, lineHeight: 1,
      }}>
        ×
      </button>
    </div>
  )
}
