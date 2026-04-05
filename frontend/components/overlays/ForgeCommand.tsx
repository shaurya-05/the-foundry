'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

interface CommandItem {
  id: string
  label: string
  description: string
  category: string
  action: () => void
  accent?: string
}

interface ForgeCommandProps {
  onClose: () => void
}

const NAV_COMMANDS = [
  { id: 'nav-dashboard', label: 'Go to Dashboard', description: 'The Forge Floor', path: '/dashboard', accent: '#FF3B3B' },
  { id: 'nav-knowledge', label: 'Go to Knowledge', description: 'The Archive', path: '/knowledge', accent: '#3ABEFF' },
  { id: 'nav-projects', label: 'Go to Projects', description: 'The Workshop', path: '/projects', accent: '#FF3B3B' },
  { id: 'nav-ideas', label: 'Go to Ideas', description: 'The Crucible', path: '/ideas', accent: '#FF8A2A' },
  { id: 'nav-launchpad', label: 'Go to Launchpad', description: 'The Launch Bay', path: '/launchpad', accent: '#38D37A' },
  { id: 'nav-workspace', label: 'Go to Workspace', description: 'The Blueprint', path: '/workspace', accent: '#A78BFA' },
  { id: 'nav-tasks', label: 'Go to Tasks', description: 'The Runsheet', path: '/tasks', accent: '#22D3EE' },
  { id: 'nav-context', label: 'Go to Context', description: 'The Signal Room', path: '/context', accent: '#A78BFA' },
  { id: 'nav-agents', label: 'Go to Agents', description: 'The Crew', path: '/agents', accent: '#A78BFA' },
]

const PIPELINE_COMMANDS = [
  { id: 'pipe-deep-recon', label: 'Run Deep Recon', description: 'Field Analyst → Systems Architect', path: '/agents?pipeline=deep_recon', accent: '#3ABEFF' },
  { id: 'pipe-launch', label: 'Run Launch Readiness', description: 'Market Scout → Launch Strategist', path: '/agents?pipeline=launch_readiness', accent: '#38D37A' },
  { id: 'pipe-full-forge', label: 'Run Full Forge', description: 'All 4 crew members in sequence', path: '/agents?pipeline=full_forge', accent: '#FF3B3B' },
  { id: 'pipe-blueprint', label: 'Run Blueprint Design', description: 'Systems Architect → Market Scout', path: '/agents?pipeline=blueprint_design', accent: '#A78BFA' },
]

export default function ForgeCommand({ onClose }: ForgeCommandProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function buildCommands(): CommandItem[] {
    const cmds: CommandItem[] = [
      ...NAV_COMMANDS.map(c => ({
        id: c.id,
        label: c.label,
        description: c.description,
        category: 'navigate',
        accent: c.accent,
        action: () => { router.push(c.path); onClose() },
      })),
      ...PIPELINE_COMMANDS.map(c => ({
        id: c.id,
        label: c.label,
        description: c.description,
        category: 'pipeline',
        accent: c.accent,
        action: () => { router.push(c.path); onClose() },
      })),
    ]
    if (!query) return cmds.slice(0, 8)
    const q = query.toLowerCase()
    return cmds.filter(c => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
  }

  const commands = buildCommands()

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(v => Math.min(v + 1, commands.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(v => Math.max(v - 1, 0)) }
    if (e.key === 'Enter') { commands[selected]?.action() }
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.25)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="gl2"
        style={{
          width: 560,
          maxHeight: '60vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: '#FFFFFF',
          border: '1px solid rgba(0,0,0,0.10)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.14)',
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
          }}
        >
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={handleKey}
            placeholder="Type a command or search..."
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-barlow)',
              fontSize: 15,
            }}
          />
          <span
            className="badge"
            style={{
              background: 'rgba(0,0,0,0.06)',
              color: 'var(--text-muted)',
              fontSize: 9,
            }}
          >
            ESC
          </span>
        </div>

        {/* Results */}
        <div style={{ overflow: 'auto', padding: '6px 0' }}>
          {commands.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-barlow)',
                fontSize: 13,
              }}
            >
              No commands found
            </div>
          ) : (
            commands.map((cmd, i) => (
              <div
                key={cmd.id}
                onClick={cmd.action}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 18px',
                  cursor: 'pointer',
                  background: i === selected ? 'rgba(255,255,255,0.06)' : 'transparent',
                  transition: 'background 0.1s ease',
                }}
                onMouseEnter={() => setSelected(i)}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: cmd.accent || 'var(--text-muted)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-barlow-condensed)',
                      fontWeight: 600,
                      fontSize: 14,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {cmd.label}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ibm-plex-mono)',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {cmd.description}
                  </div>
                </div>
                <span
                  className="badge"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-subtle)',
                    fontSize: 8,
                  }}
                >
                  {cmd.category}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '8px 18px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            gap: 16,
          }}
        >
          {['↑↓ navigate', '↵ execute', 'ESC close'].map(hint => (
            <span
              key={hint}
              style={{
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 9,
                color: 'var(--text-subtle)',
                letterSpacing: '0.04em',
              }}
            >
              {hint}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
