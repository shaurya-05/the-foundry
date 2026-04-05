'use client'

import { usePathname } from 'next/navigation'
import { sectionLabels, sectionAccents } from '@/styles/design-system'
import { useEffect, useState } from 'react'

interface HeaderProps {
  onCommand: () => void
  onSignals: () => void
  onCopilot: () => void
  notifCount?: number
}

export default function Header({ onCommand, onSignals, onCopilot, notifCount = 0 }: HeaderProps) {
  const pathname = usePathname()
  const section = pathname.split('/')[1] || 'dashboard'
  const accent = sectionAccents[section] || '#FF2D2D'
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
      className="gl3"
      style={{
        height: 50,
        borderBottom: '1px solid var(--border)',
        borderRadius: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        gap: 12,
        flexShrink: 0,
        zIndex: 30,
      }}
    >
      {/* Section indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {/* Accent bar */}
        <div style={{
          width: 3,
          height: 26,
          borderRadius: 2,
          background: accent,
          flexShrink: 0,
          boxShadow: 'none',
        }} />
        <div>
          <div
            style={{
              fontFamily: 'var(--font-barlow-condensed)',
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            {section.toUpperCase()}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 9,
              color: `${accent}BB`,
              letterSpacing: '0.08em',
              marginTop: 1,
            }}
          >
            {sectionName}
          </div>
        </div>

      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Live clock — mission control style */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'var(--bg-mid)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{
            width: 5, height: 5, borderRadius: '50%',
            background: '#2DCC72',
            boxShadow: '0 0 5px rgba(45,204,114,0.9)',
            animation: 'pulse-dot 2.4s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <span style={{
            fontFamily: 'var(--font-ibm-plex-mono)',
            fontSize: 10.5,
            color: 'var(--text-muted)',
            letterSpacing: '0.08em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {time}
          </span>
          <span style={{
            fontFamily: 'var(--font-ibm-plex-mono)',
            fontSize: 9,
            color: 'var(--text-subtle)',
            letterSpacing: '0.06em',
          }}>
            {date}
          </span>
        </div>

        {/* Command palette */}
        <button
          onClick={onCommand}
          className="btn btn-ghost btn-sm"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            letterSpacing: '0.07em',
            padding: '5px 10px',
          }}
          title="Command palette (⌘K)"
        >
          <CommandIcon />
          <span style={{ fontFamily: 'var(--font-barlow-condensed)', fontSize: 11, fontWeight: 700 }}>COMMAND</span>
          <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, opacity: 0.5 }}>⌘K</span>
        </button>

        {/* Signals bell */}
        <button
          onClick={onSignals}
          style={{
            position: 'relative',
            width: 32,
            height: 32,
            borderRadius: 7,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-mid)',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          title="Forge Signals"
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
                borderRadius: '50%',
                background: '#FF2D2D',
                border: '1.5px solid var(--bg)',
                boxShadow: '0 0 6px rgba(255,45,45,0.8)',
              }}
            />
          )}
        </button>

        {/* Copilot */}
        <button
          onClick={onCopilot}
          className="btn btn-sm"
          style={{
            background: 'rgba(124,58,237,0.08)',
            color: '#7C3AED',
            border: '1px solid rgba(124,58,237,0.18)',
            fontSize: 11,
            gap: 5,
            letterSpacing: '0.07em',
          }}
          title="Forge Copilot (⌘J)"
        >
          <CopilotIcon />
          <span style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 11 }}>COPILOT</span>
        </button>
      </div>
    </header>
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
      <path d="M6.5 1a3.5 3.5 0 0 1 3.5 3.5v2.5L11 9H2L3 7V4.5A3.5 3.5 0 0 1 6.5 1Z" stroke="var(--text-muted)" strokeWidth="1.1" />
      <path d="M5 10.5a1.5 1.5 0 0 0 3 0" stroke="var(--text-muted)" strokeWidth="1.1" />
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
