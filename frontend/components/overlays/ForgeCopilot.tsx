'use client'

import { useState, useRef, useEffect } from 'react'
import { streamSSE } from '@/lib/streaming'
import { classifyIntent, intentLabel } from '@/lib/intent-router'
import Markdown from '@/components/ui/Markdown'
import { api } from '@/lib/api'
import { useRouter } from 'next/navigation'

interface Message {
  id: string
  role: 'user' | 'copilot' | 'typing' | 'intent'
  content: string
  intent?: string
}

interface ForgeCopilotProps {
  onClose: () => void
}

const STARTER_PROMPTS = [
  'What should I focus on right now?',
  'Show me workspace status',
  'What patterns do you see in my work?',
  'Create a task: Review last sprint outcomes',
]

export default function ForgeCopilot({ onClose }: ForgeCopilotProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [tab, setTab] = useState<'intel' | 'signals' | 'ops'>('intel')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    if (!input.trim() || streaming) return
    const msg = input.trim()
    setInput('')

    // Classify intent
    const { intent } = classifyIntent(msg)

    setMessages(prev => [
      ...prev,
      { id: Date.now() + 'u', role: 'user', content: msg },
      { id: Date.now() + 'i', role: 'intent', content: intentLabel(intent), intent },
      { id: Date.now() + 't', role: 'typing', content: '' },
    ])

    setStreaming(true)
    const responseId = Date.now() + 'r'

    try {
      let full = ''
      for await (const chunk of streamSSE('/api/copilot/message', { message: msg })) {
        if (chunk.type === 'text_delta') {
          full += chunk.text
          setMessages(prev => {
            const filtered = prev.filter(m => m.role !== 'typing')
            const existing = filtered.find(m => m.id === responseId)
            if (existing) {
              return filtered.map(m => m.id === responseId ? { ...m, content: full } : m)
            }
            return [...filtered, { id: responseId, role: 'copilot', content: full }]
          })
        }
      }
    } catch {
      setMessages(prev => prev.filter(m => m.role !== 'typing'))
    } finally {
      setStreaming(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        zIndex: 600,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid rgba(255,255,255,0.09)',
        boxShadow: '-16px 0 48px rgba(0,0,0,0.5)',
      }}
      className="gl3"
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 18px 0',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              className="accent-dot"
              style={{ background: '#9B7BFF', width: 8, height: 8 }}
            />
            <span
              style={{
                fontFamily: 'var(--font-barlow-condensed)',
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-primary)',
              }}
            >
              COFOUND3R
            </span>
            <span
              className="badge"
              style={{ background: 'rgba(167,139,250,0.12)', color: '#9B7BFF' }}
            >
              ONLINE
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 18,
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
          {(['intel', 'signals', 'ops'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 14px',
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? '2px solid #9B7BFF' : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: tab === t ? '#9B7BFF' : 'var(--text-muted)',
                transition: 'all 0.15s ease',
              }}
            >
              {t === 'intel' ? 'Intel' : t === 'signals' ? 'Signals' : 'Ops'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Intel (Chat) */}
      {tab === 'intel' && (
        <>
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
            {messages.length === 0 ? (
              <StarterPrompts onSelect={p => { setInput(p); textareaRef.current?.focus() }} />
            ) : (
              messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid rgba(255,255,255,0.07)',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
                background: 'var(--gl1-bg)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '8px 12px',
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask COFOUND3R anything..."
                rows={1}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-barlow)',
                  fontSize: 13,
                  lineHeight: 1.5,
                  maxHeight: 120,
                  overflowY: 'auto',
                }}
              />
              <button
                onClick={send}
                disabled={streaming || !input.trim()}
                style={{
                  background: streaming ? 'rgba(167,139,250,0.1)' : '#9B7BFF',
                  border: 'none',
                  borderRadius: 6,
                  width: 28,
                  height: 28,
                  cursor: streaming ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.15s ease',
                }}
              >
                <SendIcon />
              </button>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 9,
                color: 'var(--text-subtle)',
                marginTop: 6,
                textAlign: 'center',
              }}
            >
              Enter to send · Shift+Enter for newline
            </div>
          </div>
        </>
      )}

      {/* Tab: Signals */}
      {tab === 'signals' && <SignalsTab />}

      {/* Tab: Ops */}
      {tab === 'ops' && <OpsTab onNavigate={(path) => { router.push(path); onClose() }} />}
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === 'intent') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
        <span
          className="badge"
          style={{ background: 'rgba(167,139,250,0.1)', color: '#9B7BFF', fontSize: 9 }}
        >
          INTENT: {msg.content}
        </span>
      </div>
    )
  }
  if (msg.role === 'typing') {
    return (
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'rgba(167,139,250,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            flexShrink: 0,
          }}
        >
          ◆
        </div>
        <div
          style={{
            background: 'var(--gl1-bg)',
            borderRadius: '4px 10px 10px 10px',
            padding: '8px 12px',
            display: 'flex',
            gap: 4,
            alignItems: 'center',
          }}
        >
          {[0, 1, 2].map(i => (
            <div
              key={i}
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: '#9B7BFF',
                animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    )
  }

  const isUser = msg.role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        marginBottom: 12,
        flexDirection: isUser ? 'row-reverse' : 'row',
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'rgba(167,139,250,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            flexShrink: 0,
            color: '#9B7BFF',
          }}
        >
          ◆
        </div>
      )}
      <div
        style={{
          maxWidth: '82%',
          background: isUser ? 'rgba(167,139,250,0.12)' : 'var(--gl1-bg)',
          border: `1px solid ${isUser ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: isUser ? '10px 4px 10px 10px' : '4px 10px 10px 10px',
          padding: '8px 12px',
        }}
      >
        {isUser ? (
          <p style={{ color: 'var(--text-primary)', fontSize: 13, margin: 0 }}>{msg.content}</p>
        ) : (
          <Markdown content={msg.content} />
        )}
      </div>
    </div>
  )
}

function StarterPrompts({ onSelect }: { onSelect: (p: string) => void }) {
  return (
    <div style={{ padding: '12px 0' }}>
      <div
        style={{
          fontFamily: 'var(--font-ibm-plex-mono)',
          fontSize: 9,
          color: 'var(--text-subtle)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 12,
          textAlign: 'center',
        }}
      >
        COFOUND3R is online
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {STARTER_PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className="gl0 lift"
            style={{
              padding: '9px 14px',
              textAlign: 'left',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-barlow)',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ color: '#9B7BFF', fontSize: 10 }}>▸</span>
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function SignalsTab() {
  const [summary, setSummary] = useState({ knowledge: 0, projects: 0, tasks: 0, ideas: 0 })
  useEffect(() => {
    Promise.all([
      api.knowledge.list(),
      api.projects.list(),
      api.tasks.list(),
      api.ideas.list(),
    ]).then(([k, p, t, i]) => {
      setSummary({
        knowledge: k.length,
        projects: p.length,
        tasks: t.filter(x => x.status !== 'completed').length,
        ideas: i.length,
      })
    }).catch(() => {})
  }, [])

  const stats = [
    { label: 'Archive', value: summary.knowledge, color: '#2AB8FF' },
    { label: 'Active Builds', value: summary.projects, color: '#FF2D2D' },
    { label: 'Runsheet', value: summary.tasks, color: '#22D3EE' },
    { label: 'Crucible', value: summary.ideas, color: '#FF8A2A' },
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {stats.map(s => (
          <div
            key={s.label}
            className="gl1"
            style={{ padding: '10px 14px' }}
          >
            <div
              style={{
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 9,
                color: s.color,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-barlow-condensed)',
                fontWeight: 700,
                fontSize: 24,
                color: 'var(--text-primary)',
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-ibm-plex-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
          textAlign: 'center',
          padding: 16,
        }}
      >
        FOUND3RY State · Live
      </div>
    </div>
  )
}

function OpsTab({ onNavigate }: { onNavigate: (path: string) => void }) {
  const quickActions = [
    { label: 'New Build', path: '/projects', color: '#FF2D2D' },
    { label: 'Forge Ideas', path: '/ideas', color: '#FF8A2A' },
    { label: 'Add Knowledge', path: '/knowledge', color: '#2AB8FF' },
    { label: 'View Tasks', path: '/tasks', color: '#22D3EE' },
    { label: 'Launch Brief', path: '/launchpad', color: '#2DCC72' },
  ]

  const crew = [
    { id: 'field_analyst', label: 'Field Analyst', color: '#2AB8FF' },
    { id: 'systems_architect', label: 'Systems Architect', color: '#9B7BFF' },
    { id: 'market_scout', label: 'Market Scout', color: '#FF8A2A' },
    { id: 'launch_strategist', label: 'Launch Strategist', color: '#2DCC72' },
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div
        style={{
          fontFamily: 'var(--font-ibm-plex-mono)',
          fontSize: 9,
          color: 'var(--text-subtle)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        Quick Actions
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
        {quickActions.map(a => (
          <button
            key={a.label}
            onClick={() => onNavigate(a.path)}
            className="gl0 lift"
            style={{
              padding: '8px 14px',
              textAlign: 'left',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 7,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-barlow-condensed)',
              fontSize: 13,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ color: a.color, fontSize: 8 }}>◆</span>
            {a.label}
          </button>
        ))}
      </div>

      <div
        style={{
          fontFamily: 'var(--font-ibm-plex-mono)',
          fontSize: 9,
          color: 'var(--text-subtle)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        Deploy Crew
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {crew.map(c => (
          <button
            key={c.id}
            onClick={() => onNavigate(`/agents?agent=${c.id}`)}
            className="gl0 lift"
            style={{
              padding: '8px 10px',
              cursor: 'pointer',
              border: `1px solid ${c.color}25`,
              borderRadius: 7,
              background: `${c.color}08`,
              color: c.color,
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 9,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}


function SendIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1 6h10M7 2l4 4-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
