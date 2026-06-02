'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, getToken } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import AgentsClient from '@/app/(app)/agents/AgentsClient'

function buildStarterQueries(ventureName: string): string[] {
  const n = ventureName || 'your venture'
  return [
    `What's been shipped on ${n} recently?`,
    `What issues are blocking ${n} right now?`,
    `Summarize ${n}'s open pull requests.`,
    `What are the most active areas of ${n}?`,
  ]
}

export default function OnboardingAskPage() {
  const router = useRouter()
  const { user, loading } = useAuth()
  const [ventureName, setVentureName] = useState('')
  const [fetchedVenture, setFetchedVenture] = useState(false)
  const [showDashboardLink, setShowDashboardLink] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!user) { router.push('/login'); return }
  }, [user, loading, router])

  useEffect(() => {
    if (!user || fetchedVenture) return
    setFetchedVenture(true)
    const t = getToken()
    if (!t) return
    fetch(`${API_URL}/api/ventures`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const name = d?.ventures?.[0]?.name
        if (name) setVentureName(name)
      })
      .catch(() => {})
  }, [user, fetchedVenture])

  function handleFirstAnswer() {
    // getToken() reads localStorage directly — safe here even if useAuth().token hasn't hydrated yet
    const t = getToken()
    if (!t) { setShowDashboardLink(true); return }
    fetch(`${API_URL}/api/workspaces/onboarding-step`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ step: 3 }),
    })
      .then((res) => {
        if (!res.ok) return
        const isSecure = typeof window !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
        document.cookie = `foundry_onboarding_done=1; path=/; SameSite=Lax${isSecure}; max-age=31536000`
        router.push('/dashboard')
      })
      .catch(() => {})
  }

  if (loading || !user) return null

  const starterQueries = buildStarterQueries(ventureName)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Minimal top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 24px',
        borderBottom: '1px solid var(--color-n200)',
        background: 'var(--color-vellum)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Found3ryWordmark size="sm" />
          <EyebrowLabel number="03" keyword="ASK" />
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                width: i === 2 ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background: i === 2 ? 'var(--color-arc-cyan)' : 'var(--color-n300)',
                transition: 'all var(--duration-fast, 120ms)',
              }}
            />
          ))}
        </div>
      </div>

      {/* Agent surface */}
      <div style={{ flex: 1 }}>
        <AgentsClient
          starterQueries={starterQueries}
          onFirstAnswer={handleFirstAnswer}
        />
      </div>

      {/* Dashboard link — appears after first answer */}
      {showDashboardLink && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            fontFamily: 'var(--font-plex-mono), monospace',
            fontSize: 11,
            color: 'var(--color-n600)',
            letterSpacing: '0.06em',
          }}>
            You&apos;re all set.
          </div>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 18px',
              background: 'var(--color-arc-cyan)',
              color: 'var(--color-ink)',
              border: 'none',
              borderRadius: 2,
              cursor: 'pointer',
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan-deep)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-arc-cyan)')}
          >
            Go to dashboard →
          </button>
        </div>
      )}
    </div>
  )
}
