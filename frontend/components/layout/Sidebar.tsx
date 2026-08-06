'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import H3rosWordmark from '@/components/brand/H3rosWordmark'
import Glyph3 from '@/components/brand/Glyph3'

interface NavItem {
  href: string
  label: string
  sublabel: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'H3RO',      sublabel: 'Talk with your cofound3r', icon: <AgentsIcon /> },
  { href: '/agents',    label: 'Text chat', sublabel: 'Typed backup',             icon: <DashIcon /> },
]

export default function Sidebar({ onCopilot }: { onCopilot: () => void }) {
  const pathname = usePathname()
  const { user } = useAuth()

  const initials = user
    ? (user.display_name || user.email)
        .split(/[\s@]/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join('')
    : '?'

  return (
    <aside
      className="liquid-glass-strong flex flex-col"
      style={{
        width: 200,
        minWidth: 200,
        height: 'calc(100vh - 16px)',
        margin: '8px 0 8px 8px',
        borderRadius: 18,
        zIndex: 40,
        flexShrink: 0,
        /* No parent filter — it kills backdrop-filter frost on this surface */
        overflow: 'hidden',
      }}
    >
      {/* Wordmark */}
      <div style={{
        padding: '18px 16px 16px',
        borderBottom: '1px solid var(--border)',
      }}>
        <Found3ryWordmark size="sm" />
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
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

      {/* Nav */}
      <nav style={{ padding: '12px 8px', flex: 1, overflow: 'auto' }}>
        {NAV_ITEMS.map(item => (
          <NavLink key={item.href} item={item} active={
            item.href === '/insights'
              ? (pathname === '/insights' || pathname === '/context')
              : pathname === item.href
          } />
        ))}
      </nav>

      {/* User avatar */}
      <div style={{ padding: '8px 8px 0', borderTop: '1px solid var(--border)' }}>
        <Link
          href="/settings"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px',
            borderRadius: 10,
            textDecoration: 'none',
            background: pathname === '/settings' ? 'var(--color-arc-soft)' : 'transparent',
            borderLeft: pathname === '/settings' ? '2px solid var(--color-arc-cyan)' : '2px solid transparent',
            transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
          }}
          onMouseEnter={(e) => {
            if (pathname !== '/settings') e.currentTarget.style.backgroundColor = 'var(--color-arc-soft)'
          }}
          onMouseLeave={(e) => {
            if (pathname !== '/settings') e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <div style={{
            width: 26, height: 26, borderRadius: 8, flexShrink: 0,
            background: 'var(--color-arc-cyan)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-archivo), system-ui, sans-serif',
            fontWeight: 700, fontSize: 11, color: '#F4F7FA',
            letterSpacing: '0.04em',
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontSize: 12, fontWeight: 700,
              color: 'var(--color-ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user?.display_name || 'Sign in'}
            </div>
            <div style={{
              fontFamily: 'var(--font-plex-mono), monospace',
              fontSize: 9,
              color: 'var(--color-n600)',
              letterSpacing: '0.04em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user ? user.workspace_name : 'Not signed in'}
            </div>
          </div>
          <SettingsIcon />
        </Link>
      </div>

      {/* H3RO quick talk */}
      <div style={{ padding: '8px 8px 16px' }}>
        <button
          onClick={onCopilot}
          className="btn btn-primary"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 8,
            padding: '10px 12px',
            fontSize: 12,
          }}
        >
          <CopilotIcon />
          <span style={{ display: 'inline-flex', alignItems: 'baseline' }}>
            H
            <Glyph3 size="0.72em" style={{ marginLeft: 1, marginRight: 1, transform: 'translateY(-0.01em)' }} />
            RO
          </span>
          <span style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-ibm-plex-mono), monospace',
            fontWeight: 500,
            fontSize: 9,
            letterSpacing: '0.05em',
            opacity: 0.75,
          }}>⌘J</span>
        </button>
      </div>
    </aside>
  )
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px 8px 12px',
        borderLeft: active ? '2px solid var(--color-arc-cyan)' : '2px solid transparent',
        background: active ? 'var(--color-arc-soft)' : 'transparent',
        textDecoration: 'none',
        marginBottom: 2,
        borderRadius: 10,
        transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'var(--color-arc-soft)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      <span style={{
        color: active ? 'var(--color-ink)' : 'var(--color-n600)',
        flexShrink: 0,
      }}>
        {item.icon}
      </span>
      <div>
        <div style={{
          fontFamily: 'var(--font-archivo), system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: active ? 'var(--color-ink)' : 'var(--color-n600)',
        }}>
          {item.label}
        </div>
        <div style={{
          fontFamily: 'var(--font-plex-mono), monospace',
          fontWeight: 500,
          fontSize: 9,
          letterSpacing: '0.05em',
          color: active ? 'var(--color-n600)' : 'var(--color-n400)',
        }}>
          {item.sublabel}
        </div>
      </div>
    </Link>
  )
}

// ─── Icons (unchanged from prior; outline stroke, currentColor) ─────────────
function DashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="7.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1" y="7.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
    </svg>
  )
}
function AgentsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="2.5" cy="10.5" r="1.8" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="11.5" cy="10.5" r="1.8" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.5 4L3 8.7M9.5 4L11 8.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
function CopilotIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 6.5h5M6.5 4v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--color-n400)' }}>
      <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.6 2.6l1.1 1.1M8.3 8.3l1.1 1.1M9.4 2.6L8.3 3.7M3.7 8.3L2.6 9.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
