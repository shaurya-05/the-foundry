'use client'

import { usePathname } from 'next/navigation'
import { sectionLabels } from '@/styles/design-system'
import { useEffect, useState } from 'react'
import H3rosStamp from '@/components/brand/H3rosStamp'
import Glyph3 from '@/components/brand/Glyph3'

interface HeaderProps {
  onCommand: () => void
  onSignals: () => void
  onCopilot: () => void
  notifCount?: number
  onMenuToggle?: () => void
}

export default function Header({ onCommand, onSignals, onCopilot, notifCount = 0, onMenuToggle }: HeaderProps) {
  const pathname = usePathname()
  const section = pathname.split('/')[1] || 'dashboard'
  const sectionName = sectionLabels[section] || 'The FOUND3RY'

  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
      setDate(now.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase())
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <header
      style={{
        height: 50,
        background: 'var(--color-vellum)',
        borderBottom: '1px solid var(--color-n200)',
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        gap: 12,
        flexShrink: 0,
        zIndex: 30,
      }}
    >
      {/* Mobile hamburger */}
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

      {/* Section indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        {/* Flat 2px Arc Cyan section bar (no gradient, no shadow) */}
        <div style={{
          width: 2,
          height: 26,
          background: 'var(--color-arc-cyan)',
          flexShrink: 0,
        }} />
        <div>
          <div
            style={{
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--color-ink)',
              lineHeight: 1.1,
            }}
          >
            {section}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-plex-mono), monospace',
              fontWeight: 500,
              fontSize: 9,
              color: 'var(--color-n600)',
              letterSpacing: '0.08em',
              marginTop: 2,
              textTransform: 'uppercase',
            }}
          >
            {sectionName}
          </div>
        </div>
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Live clock */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            background: 'var(--color-off-white)',
            border: '1px solid var(--color-n200)',
            borderRadius: 0,
          }}
        >
          <div
            className="h3ros-pulse"
            style={{
              width: 5, height: 5,
              background: 'var(--color-arc-cyan)',
              flexShrink: 0,
            }}
          />
          <span style={{
            fontFamily: 'var(--font-plex-mono), monospace',
            fontWeight: 500,
            fontSize: 10.5,
            color: 'var(--color-ink)',
            letterSpacing: '0.08em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {time}
          </span>
          <span style={{
            fontFamily: 'var(--font-plex-mono), monospace',
            fontWeight: 500,
            fontSize: 9,
            color: 'var(--color-n400)',
            letterSpacing: '0.06em',
          }}>
            {date}
          </span>
        </div>

        {/* Command palette */}
        <GhostButton onClick={onCommand} title="Command palette (⌘K)">
          <CommandIcon />
          <span style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif', fontWeight: 700 }}>COMMAND</span>
          <span style={{ fontFamily: 'var(--font-plex-mono), monospace', fontWeight: 500, fontSize: 9, opacity: 0.6, marginLeft: 4 }}>⌘K</span>
        </GhostButton>

        {/* Signals bell */}
        <button
          onClick={onSignals}
          style={{
            position: 'relative',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-off-white)',
            border: '1px solid var(--color-n200)',
            borderRadius: 0,
            cursor: 'pointer',
            color: 'var(--color-ink)',
            transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-vellum)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-off-white)')}
          title="Signals"
          aria-label="Signals"
        >
          <BellIcon />
          {notifCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 5,
                right: 5,
                width: 7,
                height: 7,
                background: 'var(--color-signal)',
                border: '1.5px solid var(--color-vellum)',
              }}
            />
          )}
        </button>

        {/* COFOUND3R */}
        <GhostButton onClick={onCopilot} title="COFOUND3R (⌘J)">
          <CopilotIcon />
          <span style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif', fontWeight: 700, display: 'inline-flex', alignItems: 'baseline' }}>
            COFOUND
            <Glyph3 size="0.72em" style={{ marginLeft: 1, marginRight: 1, transform: 'translateY(-0.01em)' }} />
            R
          </span>
        </GhostButton>

        {/* H3ROS parent stamp (Equity Layer 3) */}
        <div style={{ marginLeft: 4 }}>
          <H3rosStamp
            size={14}
            onClick={() => window.open('https://h3ros.com', '_blank', 'noopener,noreferrer')}
          />
        </div>
      </div>
    </header>
  )
}

function GhostButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        background: 'transparent',
        border: '1px solid var(--color-ink)',
        borderRadius: 2,
        cursor: 'pointer',
        color: 'var(--color-ink)',
        fontSize: 11,
        letterSpacing: '0.07em',
        transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out), color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-ink)'
        e.currentTarget.style.color = 'var(--color-off-white)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent'
        e.currentTarget.style.color = 'var(--color-ink)'
      }}
    >
      {children}
    </button>
  )
}

function CommandIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M2 4H9M2 7H6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="1" y="1" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 1a3.5 3.5 0 0 1 3.5 3.5v2.5L11 9H2L3 7V4.5A3.5 3.5 0 0 1 6.5 1Z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

function CopilotIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3 5.5h5M5.5 3v5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
