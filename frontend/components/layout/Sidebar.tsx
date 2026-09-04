'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import H3roMark from '@/components/brand/H3roMark'

/**
 * Redesigned per apple-design §16.6 — this app is fundamentally one
 * surface (talk to H3RO); everything else already lives behind ⌘K, not
 * a nav list. So the sidebar's job shrinks to: identity, the one real
 * destination, and account access. Dropped the uppercase-tracked mono
 * sublabels and the h3ros parent-brand lockup — quieter, not busier.
 */
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
        borderRadius: 20,
        zIndex: 40,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '20px 18px 18px' }}>
        <Found3ryWordmark size="sm" />
      </div>

      <nav style={{ padding: '4px 10px', flex: 1 }}>
        <Link
          href="/dashboard"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 12px',
            borderRadius: 12,
            background: pathname === '/dashboard' ? 'var(--color-arc-soft)' : 'transparent',
            textDecoration: 'none',
            transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
          }}
          onMouseEnter={(e) => {
            if (pathname !== '/dashboard') e.currentTarget.style.backgroundColor = 'var(--color-n200)'
          }}
          onMouseLeave={(e) => {
            if (pathname !== '/dashboard') e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <H3roMark size={14} />
          <span style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
            fontSize: 14,
            color: pathname === '/dashboard' ? 'var(--color-ink)' : 'var(--color-n600)',
          }}>
            Talk with H3RO
          </span>
        </Link>
      </nav>

      <div style={{ padding: '10px', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={onCopilot}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 12px',
            borderRadius: 12,
            background: 'transparent',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 13,
            color: 'var(--color-n600)',
          }}
        >
          <span>Quick talk</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>⌘J</span>
        </button>
      </div>

      <div style={{ padding: '10px 10px 12px' }}>
        <Link
          href="/settings"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px',
            borderRadius: 12,
            textDecoration: 'none',
            background: pathname === '/settings' ? 'var(--color-arc-soft)' : 'transparent',
            transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
          }}
          onMouseEnter={(e) => {
            if (pathname !== '/settings') e.currentTarget.style.backgroundColor = 'var(--color-n200)'
          }}
          onMouseLeave={(e) => {
            if (pathname !== '/settings') e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: 'var(--color-arc-cyan)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 600, fontSize: 11, color: '#fff',
          }}>
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: 13, fontWeight: 500,
              color: 'var(--color-ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user?.display_name || 'Sign in'}
            </div>
          </div>
        </Link>
      </div>
    </aside>
  )
}
