'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

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
      setMessage('No verification token provided')
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
          setMessage('Email verified successfully!')
          await refreshUser()
          setTimeout(() => router.push('/dashboard'), 2000)
        } else {
          const data = await res.json().catch(() => ({}))
          setStatus('error')
          setMessage(data.detail || 'Verification failed')
        }
      })
      .catch(() => {
        setStatus('error')
        setMessage('Network error')
      })
  }, [token, refreshUser, router])

  return (
    <div style={{
      minHeight: '100vh', background: '#F4F5F7',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-barlow)',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, background: '#FFF',
        borderRadius: 14, padding: 40, textAlign: 'center',
        border: '1px solid rgba(0,0,0,0.07)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        {status === 'verifying' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>...</div>
            <p style={{ color: '#6B7280', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 14 }}>
              Verifying your email...
            </p>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16, color: '#2DCC72' }}>&#10003;</div>
            <p style={{ color: '#374151', fontWeight: 600, fontSize: 16 }}>{message}</p>
            <p style={{ color: '#9CA3AF', fontSize: 13, marginTop: 8, fontFamily: 'var(--font-ibm-plex-mono)' }}>
              Redirecting to dashboard...
            </p>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16, color: '#E8231F' }}>&#10007;</div>
            <p style={{ color: '#C81E1C', fontWeight: 600, fontSize: 16 }}>{message}</p>
            <button
              onClick={() => router.push('/dashboard')}
              style={{
                marginTop: 20, padding: '10px 24px',
                background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
                color: '#FFF', border: 'none', borderRadius: 8, cursor: 'pointer',
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
                fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase',
              }}
            >
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  )
}
