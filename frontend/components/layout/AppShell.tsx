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
  const pathname = usePathname()
  const isCommandCenter = pathname === '/dashboard'

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  const [commandOpen, setCommandOpen] = useState(false)
  const [signalsOpen, setSignalsOpen] = useState(false)
  // Command center: Forge is the primary surface — open by default on dashboard
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (isCommandCenter) setCopilotOpen(true)
  }, [isCommandCenter])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'k') { e.preventDefault(); setCommandOpen(v => !v) }
        if (e.key === 'j') { e.preventDefault(); setCopilotOpen(v => !v) }
      }
      if (e.key === 'Escape') {
        setCommandOpen(false)
        setSignalsOpen(false)
        setSidebarOpen(false)
        if (!isCommandCenter) setCopilotOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isCommandCenter])

  useEffect(() => { setSidebarOpen(false) }, [pathname])

  const openCopilot = useCallback(() => setCopilotOpen(true), [])

  if (loading || !user) return null

  return (
    <div
      className="machine-bay"
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <div className="sidebar-desktop">
        <Sidebar onCopilot={openCopilot} />
      </div>

      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <div className={`sidebar-mobile-overlay ${sidebarOpen ? 'open' : ''}`}>
        <Sidebar onCopilot={openCopilot} />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <Header
          onCommand={() => setCommandOpen(true)}
          onSignals={() => setSignalsOpen(v => !v)}
          onCopilot={openCopilot}
          notifCount={notifCount}
          onMenuToggle={() => setSidebarOpen(v => !v)}
        />
        {user && !user.email_verified && (
          <VerificationBanner />
        )}
        <main
          style={{
            flex: 1,
            overflow: pathname === '/agents' ? 'hidden' : 'auto',
            padding: pathname === '/agents' ? '0' : isCommandCenter ? '20px 24px' : '24px',
            paddingRight: isCommandCenter && copilotOpen ? 24 : undefined,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          {children}
        </main>
      </div>

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
        <ForgeCopilot
          onClose={() => setCopilotOpen(false)}
          commandCenter={isCommandCenter}
        />
      )}
    </div>
  )
}
