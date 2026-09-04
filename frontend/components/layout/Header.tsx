'use client'

import { usePathname } from 'next/navigation'
import { sectionLabels } from '@/styles/design-system'
import H3roMark from '@/components/brand/H3roMark'
import { useTheme } from '@/lib/theme'

interface HeaderProps {
  onCommand: () => void
  onSignals: () => void
  onCopilot: () => void
  notifCount?: number
  onMenuToggle?: () => void
}

/**
 * Redesigned per apple-design §16.6 (simplicity, not minimalism) — the
 * prior header carried a live clock, a double-labeled section readout, a
 * repeated brand stamp, and a text-labeled command button all competing
 * for attention at once. None of that is core to "talk to H3RO." Cut to:
 * one calm section title, and icon-first actions for the things you
 * actually do from here.
 */
export default function Header({ onCommand, onSignals, onCopilot, notifCount = 0, onMenuToggle }: HeaderProps) {
  const pathname = usePathname()
  const section = pathname.split('/')[1] || 'dashboard'
  const sectionName = sectionLabels[section] || 'The FOUND3RY'
  const { theme, toggle } = useTheme()

  return (
    <header
      className="foundry-header liquid-glass-chip"
      style={{
        height: 52,
        margin: '8px 12px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        zIndex: 30,
        borderRadius: 16,
        isolation: 'auto',
      }}
    >
      {onMenuToggle && (
        <button
          onClick={onMenuToggle}
          className="mobile-hamburger"
          style={{
            display: 'none', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--color-ink)', fontSize: 18,
          }}
          aria-label="Toggle menu"
        >
          &#9776;
        </button>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '-0.01em',
            color: 'var(--color-ink)',
            lineHeight: 1.1,
          }}
        >
          {sectionName}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="foundry-header-right">
        <IconButton onClick={onCommand} title="Command (⌘K)" aria-label="Command palette">
          <CommandIcon />
        </IconButton>

        <IconButton onClick={toggle} title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'} aria-label="Toggle appearance">
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </IconButton>

        <IconButton onClick={onSignals} title="Notifications" aria-label="Notifications">
          <BellIcon />
          {notifCount > 0 && (
            <span
              style={{
                position: 'absolute', top: 7, right: 7,
                width: 6, height: 6, background: 'var(--color-arc-cyan)',
                borderRadius: '50%', border: '1.5px solid var(--color-off-white)',
              }}
            />
          )}
        </IconButton>

        <IconButton onClick={onCopilot} title="H3RO (⌘J)" aria-label="Open H3RO">
          <H3roMark size={13} className="foundry-header-label" />
        </IconButton>
      </div>
    </header>
  )
}

function IconButton({
  children,
  onClick,
  title,
  ...rest
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      title={title}
      {...rest}
      style={{
        position: 'relative',
        width: 34,
        height: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        borderRadius: 10,
        cursor: 'pointer',
        color: 'var(--color-n600)',
        transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out), color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-n200)'
        e.currentTarget.style.color = 'var(--color-ink)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
        e.currentTarget.style.color = 'var(--color-n600)'
      }}
    >
      {children}
    </button>
  )
}

function CommandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="1.5" y="1.5" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 5.5H10.5M4.5 9.5H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1.2a4 4 0 0 1 4 4v2.8L13 10.5H2l1.5-2.5V5.2a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.8 12a1.7 1.7 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7.5 0.8v1.6M7.5 12.6v1.6M14.2 7.5h-1.6M2.4 7.5H0.8M12.3 2.7l-1.1 1.1M3.8 11.2l-1.1 1.1M12.3 12.3l-1.1-1.1M3.8 3.8L2.7 2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M13 9.3A6 6 0 1 1 5.7 2a5 5 0 0 0 7.3 7.3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
