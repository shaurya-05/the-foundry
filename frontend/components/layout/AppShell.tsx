'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAuth } from '@/lib/auth'
import VerificationBanner from './VerificationBanner'

// Lazy-load heavy overlays — only loaded when opened
const ForgeCommand = dynamic(() => import('@/components/overlays/ForgeCommand'), { ssr: false })
const ForgeSignals = dynamic(() => import('@/components/overlays/ForgeSignals'), { ssr: false })
const ForgeCopilot = dynamic(() => import('@/components/overlays/ForgeCopilot'), { ssr: false })

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])
  const [commandOpen, setCommandOpen] = useState(false)
  const [signalsOpen, setSignalsOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [notifCount, setNotifCount] = useState(0)

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'k') { e.preventDefault(); setCommandOpen(v => !v) }
        if (e.key === 'j') { e.preventDefault(); setCopilotOpen(v => !v) }
      }
      if (e.key === 'Escape') {
        setCommandOpen(false)
        setSignalsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const openCopilot = useCallback(() => setCopilotOpen(true), [])

  // Show nothing while checking auth (prevents flash)
  if (loading || !user) return null

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg)',
      }}
      className="tech-grid"
    >
      <Sidebar onCopilot={openCopilot} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <Header
          onCommand={() => setCommandOpen(true)}
          onSignals={() => setSignalsOpen(v => !v)}
          onCopilot={openCopilot}
          notifCount={notifCount}
        />
        {/* Email verification banner */}
        {user && !user.email_verified && (
          <VerificationBanner />
        )}
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px',
          }}
          className="page-enter"
        >
          {children}
        </main>
      </div>

      {/* Overlays */}
      {commandOpen && (
        <ForgeCommand onClose={() => setCommandOpen(false)} />
      )}
      {signalsOpen && (
        <ForgeSignals
          onClose={() => setSignalsOpen(false)}
          onUnreadChange={setNotifCount}
        />
      )}
      {copilotOpen && (
        <ForgeCopilot onClose={() => setCopilotOpen(false)} />
      )}
    </div>
  )
}
