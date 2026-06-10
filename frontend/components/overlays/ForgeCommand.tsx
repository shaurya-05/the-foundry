'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import EyebrowLabel from '@/components/brand/EyebrowLabel'

interface CommandItem {
  id: string
  label: string
  description: string
  category: string
  action: () => void
}

interface ForgeCommandProps {
  onClose: () => void
}

const NAV_COMMANDS = [
  { id: 'nav-dashboard', label: 'Go to Dashboard', description: 'The forge floor',   path: '/dashboard' },
  { id: 'nav-knowledge', label: 'Go to Knowledge', description: 'The archive',       path: '/knowledge' },
  { id: 'nav-projects',  label: 'Go to Projects',  description: 'The workshop',      path: '/projects' },
  { id: 'nav-launchpad', label: 'Go to Launchpad', description: 'The launch bay',    path: '/launchpad' },
  { id: 'nav-workspace', label: 'Go to Workspace', description: 'The blueprint',     path: '/workspace' },
  { id: 'nav-tasks',     label: 'Go to Tasks',     description: 'The runsheet',      path: '/tasks' },
  { id: 'nav-context',   label: 'Go to Context',   description: 'The signal room',   path: '/context' },
  { id: 'nav-agents',    label: 'Go to Agents',    description: 'The crew',          path: '/agents' },
]

const PIPELINE_COMMANDS = [
  { id: 'pipe-deep-recon',  label: 'Run Deep Recon',       description: 'Field Analyst → Systems Architect',  path: '/agents?pipeline=deep_recon' },
  { id: 'pipe-launch',      label: 'Run Launch Readiness', description: 'Market Scout → Launch Strategist',   path: '/agents?pipeline=launch_readiness' },
  { id: 'pipe-full-forge',  label: 'Run Full Forge',       description: 'All 4 crew members in sequence',     path: '/agents?pipeline=full_forge' },
  { id: 'pipe-blueprint',   label: 'Run Blueprint Design', description: 'Systems Architect → Market Scout',   path: '/agents?pipeline=blueprint_design' },
]

export default function ForgeCommand({ onClose }: ForgeCommandProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [searchResults, setSearchResults] = useState<CommandItem[]>([])
  const [searching, setSearching] = useState(false)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { inputRef.current?.focus() }, [])

  // Live search across all content when query is 2+ chars
  useEffect(() => {
    if (query.length < 2) { setSearchResults([]); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const [projects, tasks, knowledge] = await Promise.all([
          api.projects.list().catch(() => []),
          api.tasks.list().catch(() => []),
          api.knowledge.list().catch(() => []),
        ])
        const q = query.toLowerCase()
        const results: CommandItem[] = []

        for (const p of (projects as any[])) {
          if (p.title?.toLowerCase().includes(q)) {
            results.push({
              id: `proj-${p.id}`, label: p.title, description: `Project · ${p.status || 'active'}`,
              category: 'project',
              action: () => { router.push(`/projects`); onClose() },
            })
          }
        }
        for (const t of (tasks as any[])) {
          if (t.title?.toLowerCase().includes(q)) {
            results.push({
              id: `task-${t.id}`, label: t.title, description: `Task · ${t.status || 'backlog'}`,
              category: 'task',
              action: () => { router.push('/tasks'); onClose() },
            })
          }
        }
        for (const k of (knowledge as any[])) {
          if (k.title?.toLowerCase().includes(q) || k.content?.toLowerCase().includes(q)) {
            results.push({
              id: `know-${k.id}`, label: k.title || 'Untitled', description: `Knowledge · ${k.type || 'note'}`,
              category: 'knowledge',
              action: () => { router.push('/knowledge'); onClose() },
            })
          }
        }
        setSearchResults(results.slice(0, 10))
      } catch { setSearchResults([]) }
      setSearching(false)
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, router, onClose])

  function buildCommands(): CommandItem[] {
    const cmds: CommandItem[] = [
      ...NAV_COMMANDS.map(c => ({
        id: c.id,
        label: c.label,
        description: c.description,
        category: 'navigate',
        action: () => { router.push(c.path); onClose() },
      })),
      ...PIPELINE_COMMANDS.map(c => ({
        id: c.id,
        label: c.label,
        description: c.description,
        category: 'pipeline',
        action: () => { router.push(c.path); onClose() },
      })),
    ]

    if (searchResults.length > 0) {
      return [...searchResults, ...cmds.filter(c => {
        const q = query.toLowerCase()
        return c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
      })]
    }

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
        background: 'rgba(20, 20, 19, 0.35)',
        padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          width: 560,
          maxWidth: '100%',
          maxHeight: '60vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-vellum)',
          border: '1px solid var(--color-ink)',
          borderRadius: 0,
          boxShadow: 'none',
        }}
      >
        {/* Search input — bottom-border-only H3ROS field */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            background: 'var(--color-off-white)',
            borderBottom: '1px solid var(--color-n200)',
          }}
        >
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={handleKey}
            placeholder="Type a command or search…"
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontSize: 15,
            }}
          />
          {searching && (
            <span
              className="h3ros-pulse"
              style={{
                width: 6, height: 6,
                background: 'var(--color-arc-cyan)',
              }}
            />
          )}
          <span style={{
            fontFamily: 'var(--font-plex-mono), monospace',
            fontWeight: 500,
            fontSize: 10,
            letterSpacing: '0.10em',
            color: 'var(--color-n400)',
            padding: '2px 6px',
            border: '1px solid var(--color-n200)',
          }}>
            ESC
          </span>
        </div>

        {/* Results */}
        <div style={{ overflow: 'auto', padding: 0, background: 'var(--color-off-white)' }}>
          {commands.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <EyebrowLabel keyword="NO COMMANDS FOUND" color="var(--color-n400)" />
            </div>
          ) : (
            commands.map((cmd, i) => (
              <div
                key={cmd.id}
                onClick={cmd.action}
                onMouseEnter={() => setSelected(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 18px',
                  cursor: 'pointer',
                  background: i === selected ? 'var(--color-vellum)' : 'var(--color-off-white)',
                  borderLeft: i === selected ? '2px solid var(--color-arc-cyan)' : '2px solid transparent',
                  borderBottom: '1px solid var(--color-n200)',
                  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
                }}
              >
                <span style={{
                  color: 'var(--color-arc-cyan-deep)',
                  fontFamily: 'var(--font-plex-mono), monospace',
                  fontSize: 12,
                  flexShrink: 0,
                }}>
                  →
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                    fontWeight: 700,
                    fontSize: 14,
                    letterSpacing: '0.02em',
                    color: 'var(--color-ink)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {cmd.label}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-plex-mono), monospace',
                    fontWeight: 500,
                    fontSize: 11,
                    color: 'var(--color-n600)',
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {cmd.description}
                  </div>
                </div>
                <EyebrowLabel
                  keyword={cmd.category}
                  color="var(--color-n400)"
                />
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div
          style={{
            padding: '8px 18px',
            background: 'var(--color-vellum)',
            borderTop: '1px solid var(--color-n200)',
            display: 'flex',
            gap: 16,
          }}
        >
          {['↑↓ navigate', '↵ execute', 'ESC close'].map(hint => (
            <span
              key={hint}
              style={{
                fontFamily: 'var(--font-plex-mono), monospace',
                fontWeight: 500,
                fontSize: 10,
                color: 'var(--color-n400)',
                letterSpacing: '0.08em',
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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--color-n600)', flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
