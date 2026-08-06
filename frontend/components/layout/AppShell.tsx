'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import dynamic from 'next/dynamic'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAuth } from '@/lib/auth'
import VerificationBanner from './VerificationBanner'
import { api } from '@/lib/api'

// Lazy-load heavy overlays — only loaded when opened
const ForgeCommand = dynamic(() => import('@/components/overlays/ForgeCommand'), { ssr: false })
const ForgeSignals = dynamic(() => import('@/components/overlays/ForgeSignals'), { ssr: false })
const ForgeCopilot = dynamic(() => import('@/components/overlays/ForgeCopilot'), { ssr: false })

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const isCommandCenter = pathname === '/dashboard'
  const isFullBleed = pathname === '/dashboard'

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  const [commandOpen, setCommandOpen] = useState(false)
  const [signalsOpen, setSignalsOpen] = useState(false)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const [watchNoticeCount, setWatchNoticeCount] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const refreshWatchNotices = useCallback(async () => {
    try {
      const notices = await api.watches.notices()
      setWatchNoticeCount(notices.length)
    } catch {
      /* offline / unauthenticated — leave last count */
    }
  }, [])

  useEffect(() => {
    if (!user) return
    refreshWatchNotices()
    const t = setInterval(refreshWatchNotices, 60_000)
    return () => clearInterval(t)
  }, [user, refreshWatchNotices])

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
        setCopilotOpen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  useEffect(() => { setSidebarOpen(false) }, [pathname])

  const openCopilot = useCallback(() => setCopilotOpen(true), [])
  const badgeCount = notifCount + watchNoticeCount

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
          onSignals={() => {
            setSignalsOpen(v => !v)
            refreshWatchNotices()
          }}
          onCopilot={openCopilot}
          notifCount={badgeCount}
          onMenuToggle={() => setSidebarOpen(v => !v)}
        />
        {user && !user.email_verified && (
          <VerificationBanner />
        )}
        <main
          style={{
            flex: 1,
            overflow: isFullBleed ? 'hidden' : 'auto',
            padding: isFullBleed ? (isCommandCenter ? '12px 16px 0' : '0') : '24px',
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
          onWatchNoticeChange={setWatchNoticeCount}
        />
      )}
      {copilotOpen && (
        <ForgeCopilot
          onClose={() => setCopilotOpen(false)}
          commandCenter={false}
        />
      )}
    </div>
  )
}
