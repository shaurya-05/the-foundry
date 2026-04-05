'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { sectionAccents } from '@/styles/design-system'
import { useAuth } from '@/lib/auth'

interface NavItem {
  href: string
  label: string
  sublabel: string
  icon: React.ReactNode
  accent: string
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',  label: 'DASHBOARD',  sublabel: 'Overview',        accent: sectionAccents.dashboard,  icon: <DashIcon /> },
  { href: '/knowledge',  label: 'KNOWLEDGE',  sublabel: 'Research & docs',  accent: sectionAccents.knowledge,  icon: <ArchiveIcon /> },
  { href: '/projects',   label: 'PROJECTS',   sublabel: 'Build tracker',    accent: sectionAccents.projects,   icon: <WorkshopIcon /> },
  { href: '/tasks',      label: 'TASKS',      sublabel: 'Task board',       accent: sectionAccents.tasks,      icon: <TaskIcon /> },
  { href: '/agents',     label: 'AGENTS',     sublabel: 'AI analysis',      accent: sectionAccents.agents,     icon: <AgentsIcon /> },
  { href: '/insights',   label: 'INSIGHTS',   sublabel: 'Cross-entity scan', accent: sectionAccents.context,   icon: <InsightsIcon /> },
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
      className="gl3 flex flex-col"
      style={{
        width: 210,
        minWidth: 210,
        height: '100vh',
        borderRight: '1px solid var(--border)',
        borderRadius: 0,
        zIndex: 40,
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: -20, left: -20,
          width: 80, height: 80,
          background: 'radial-gradient(circle, rgba(232,35,31,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <div style={{
            width: 30, height: 30,
            background: 'linear-gradient(135deg, #D12D1F 0%, #D4A017 100%)',
            borderRadius: 7,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 0 14px rgba(255,45,45,0.30), 0 2px 8px rgba(0,0,0,0.5)',
          }}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 1L14 4.5V10.5L7.5 14L1 10.5V4.5L7.5 1Z" stroke="white" strokeWidth="1.4" fill="none" />
              <path d="M7.5 1L7.5 14M1 4.5L14 10.5M14 4.5L1 10.5" stroke="white" strokeWidth="0.7" opacity="0.45" />
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 14, letterSpacing: '0.10em', textTransform: 'uppercase', lineHeight: 1.1 }}>
              <span style={{ color: '#2563EB' }}>THE </span><span style={{ color: '#D12D1F' }}>FOUND</span><span style={{ color: '#D4A017' }}>3</span><span style={{ color: '#D12D1F' }}>RY</span>
            </div>
            <div style={{ fontSize: 9, letterSpacing: '0.12em', marginTop: 2 }}>
              <span style={{ color: 'var(--text-muted)' }}>by </span><span style={{ color: '#2563EB', fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700 }}>h</span><span style={{ color: '#F97316', fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700 }}>3</span><span style={{ color: '#2563EB', fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700 }}>ros</span>
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: '10px 7px', flex: 1, overflow: 'auto' }}>
        {NAV_ITEMS.map(item => (
          <NavLink key={item.href} item={item} active={
            item.href === '/insights'
              ? (pathname === '/insights' || pathname === '/context')
              : pathname === item.href
          } />
        ))}
      </nav>

      {/* User avatar */}
      <div style={{ padding: '8px 7px 0', borderTop: '1px solid var(--border)' }}>
        <Link
          href="/settings"
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '7px 10px',
            borderRadius: 7,
            textDecoration: 'none',
            background: pathname === '/settings' ? 'rgba(0,0,0,0.04)' : 'transparent',
            transition: 'background 0.15s',
          }}
        >
          <div style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            background: user?.avatar_color || '#E8231F',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-barlow-condensed)',
            fontWeight: 700, fontSize: 11, color: '#fff', letterSpacing: '0.04em',
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 600,
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-barlow-condensed)',
              letterSpacing: '0.04em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user?.display_name || 'Sign in'}
            </div>
            <div style={{
              fontSize: 9, color: 'var(--text-subtle)',
              fontFamily: 'var(--font-ibm-plex-mono)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user ? user.workspace_name : 'Not signed in'}
            </div>
          </div>
          <SettingsIcon />
        </Link>
      </div>

      {/* Copilot button */}
      <div style={{ padding: '6px 7px 14px' }}>
        <button
          onClick={onCopilot}
          className="btn btn-ghost"
          style={{
            width: '100%',
            justifyContent: 'flex-start',
            gap: 8,
            color: '#7C3AED',
            borderColor: 'rgba(124,58,237,0.18)',
            fontSize: 11,
            letterSpacing: '0.07em',
            background: 'rgba(124,58,237,0.06)',
          }}
        >
          <CopilotIcon />
          FORGE COPILOT
          <span className="badge" style={{ marginLeft: 'auto', background: 'rgba(155,123,255,0.12)', color: 'rgba(155,123,255,0.8)', fontSize: 8 }}>
            ⌘J
          </span>
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
        padding: '6px 10px 6px 13px',
        borderRadius: 7,
        position: 'relative',
        textDecoration: 'none',
        background: active ? `linear-gradient(135deg, ${item.accent}14 0%, ${item.accent}08 100%)` : 'transparent',
        marginBottom: 2,
        transition: 'background 0.15s ease',
        borderLeft: active ? `2px solid ${item.accent}` : '2px solid transparent',
      }}
    >
      {active && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
          background: item.accent,
          borderRadius: '0 1px 1px 0',
          boxShadow: `0 0 10px ${item.accent}80`,
        }} />
      )}
      <span style={{
        color: active ? item.accent : 'var(--text-muted)',
        flexShrink: 0,
        transition: 'color 0.15s ease',
        filter: active ? `drop-shadow(0 0 4px ${item.accent}60)` : 'none',
      }}>
        {item.icon}
      </span>
      <div>
        <div style={{
          fontFamily: 'var(--font-barlow-condensed)',
          fontWeight: 600,
          fontSize: 11.5,
          letterSpacing: '0.08em',
          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
          textTransform: 'uppercase',
          transition: 'color 0.15s ease',
        }}>
          {item.label}
        </div>
        <div style={{
          fontFamily: 'var(--font-ibm-plex-mono)',
          fontSize: 8.5,
          color: active ? `${item.accent}CC` : 'var(--text-subtle)',
          letterSpacing: '0.05em',
          transition: 'color 0.15s ease',
        }}>
          {item.sublabel}
        </div>
      </div>
    </Link>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────
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
function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="3" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1 6h12" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
function WorkshopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
function CrucibleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1v4M7 5l2.5-2.5M7 5L4.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="9.5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
function TaskIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M2 4h10M2 7.5h7M2 11h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12" cy="10.5" r="2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}
function CanvasIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3" y="3" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <rect x="8" y="3" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <rect x="3" y="8" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <path d="M9.5 8.5L11.5 10.5M11.5 8.5L9.5 10.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
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
function InsightsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 1v2M7 11v2M1 7h2M11 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2.9 2.9l1.4 1.4M9.7 9.7l1.4 1.4M9.7 4.3L11.1 2.9M2.9 11.1L4.3 9.7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
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
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text-subtle)' }}>
      <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M6 1v1.5M6 9.5V11M1 6h1.5M9.5 6H11M2.6 2.6l1.1 1.1M8.3 8.3l1.1 1.1M9.4 2.6L8.3 3.7M3.7 8.3L2.6 9.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
