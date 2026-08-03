'use client'

import { useState, useRef, useEffect } from 'react'
import { streamWS, submitToolResult } from '@/lib/streaming'
import { classifyIntent, intentLabel } from '@/lib/intent-router'
import Markdown from '@/components/ui/Markdown'
import { api } from '@/lib/api'
import { useRouter } from 'next/navigation'
import Glyph3 from '@/components/brand/Glyph3'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import {
  isFileAccessSupported, connectFolder, disconnectFolder, getConnectedFolder,
  handleFileToolRequest,
} from '@/lib/fileAccess'

interface Message {
  id: string
  role: 'user' | 'copilot' | 'typing' | 'intent' | 'trace' | 'confirm'
  content: string
  intent?: string
  // 'confirm' only -- a pending agent_confirm_write, resolved in place
  // once the user picks approve/decline (never re-asked on re-render).
  callId?: string
  source?: string
  resolved?: 'approved' | 'declined'
}

interface ForgeCopilotProps {
  onClose: () => void
}

const STARTER_PROMPTS = [
  'What should I focus on right now?',
  'Show me workspace status.',
  'What patterns do you see in my work?',
  'Create a task: review last sprint outcomes.',
]

export default function ForgeCopilot({ onClose }: ForgeCopilotProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [tab, setTab] = useState<'intel' | 'signals' | 'ops'>('intel')
  const [activeThread, setActiveThread] = useState<string | undefined>(undefined)
  const [folderConnected, setFolderConnected] = useState(false)
  const [fileAccessSupported, setFileAccessSupported] = useState(true)
  const [agentMode, setAgentMode] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    setFileAccessSupported(isFileAccessSupported())
    if (isFileAccessSupported()) {
      getConnectedFolder().then(handle => setFolderConnected(!!handle))
    }
  }, [])

  async function handleConnectFolder() {
    try {
      await connectFolder()
      setFolderConnected(true)
    } catch {
      // User cancelled the native picker, or permission was denied --
      // not an error worth surfacing, just leave the state as-is.
    }
  }

  async function handleDisconnectFolder() {
    await disconnectFolder()
    setFolderConnected(false)
  }

  async function send() {
    if (!input.trim() || streaming) return
    const msg = input.trim()
    setInput('')

    const { intent } = classifyIntent(msg)

    setMessages(prev => [
      ...prev,
      { id: Date.now() + 'u', role: 'user', content: msg },
      { id: Date.now() + 'i', role: 'intent', content: intentLabel(intent), intent },
      { id: Date.now() + 't', role: 'typing', content: '' },
    ])

    setStreaming(true)
    setStatus('')
    const responseId = Date.now() + 'r'
    const runningAsAgent = agentMode

    try {
      let full = ''
      for await (const chunk of streamWS('/api/copilot/message', {
        message: msg, thread_id: activeThread, agent_mode: runningAsAgent,
      })) {
        if (chunk.type === 'thread_id') {
          setActiveThread(chunk.thread_id)
        } else if (chunk.type === 'status') {
          setStatus(chunk.text)
        } else if (chunk.type === 'tool_request') {
          if (chunk.tool === 'list_files' || chunk.tool === 'read_file') {
            // Fire-and-continue: this POSTs the real result back to
            // /api/copilot/tool-result, which resolves the backend's
            // pending future. Nothing further arrives on THIS stream
            // until that round-trip completes server-side, so there's
            // no next chunk being raced here.
            handleFileToolRequest(chunk)
          }
        } else if (chunk.type === 'text_delta') {
          if (status) setStatus('')  // clear once real content starts
          full += chunk.text
          setMessages(prev => {
            const filtered = prev.filter(m => m.role !== 'typing')
            const existing = filtered.find(m => m.id === responseId)
            if (existing) {
              return filtered.map(m => m.id === responseId ? { ...m, content: full } : m)
            }
            return [...filtered, { id: responseId, role: 'copilot', content: full }]
          })
        } else if (chunk.type === 'agent_started') {
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'typing'),
            { id: Date.now() + 'as', role: 'trace', content: `Goal: ${chunk.goal}` },
            { id: Date.now() + 't2', role: 'typing', content: '' },
          ])
        } else if (chunk.type === 'agent_tool_call') {
          const argsStr = Object.keys(chunk.args || {}).length ? ` ${JSON.stringify(chunk.args)}` : ''
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'typing'),
            { id: `${Date.now()}-atc-${chunk.iteration}-${chunk.tool}`, role: 'trace', content: `→ ${chunk.tool}${argsStr}` },
            { id: Date.now() + 't3', role: 'typing', content: '' },
          ])
        } else if (chunk.type === 'agent_observation') {
          const summary = typeof chunk.result === 'string' ? chunk.result : JSON.stringify(chunk.result)
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'typing'),
            { id: `${Date.now()}-ao-${chunk.iteration}-${chunk.tool}`, role: 'trace', content: `← ${summary.slice(0, 300)}` },
            { id: Date.now() + 't4', role: 'typing', content: '' },
          ])
        } else if (chunk.type === 'agent_confirm_write') {
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'typing'),
            {
              id: `confirm-${chunk.call_id}`, role: 'confirm',
              content: chunk.text, source: chunk.source, callId: chunk.call_id,
            },
            { id: Date.now() + 't5', role: 'typing', content: '' },
          ])
        } else if (chunk.type === 'agent_final') {
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'typing'),
            { id: responseId, role: 'copilot', content: chunk.answer },
          ])
        } else if (chunk.type === 'agent_stopped') {
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'typing'),
            { id: responseId, role: 'copilot', content: chunk.partial_answer },
          ])
        }
      }
    } catch {
      setMessages(prev => prev.filter(m => m.role !== 'typing'))
    } finally {
      setStreaming(false)
      setStatus('')
    }
  }

  async function handleConfirmWrite(callId: string, approved: boolean) {
    setMessages(prev => prev.map(m =>
      m.callId === callId ? { ...m, resolved: approved ? 'approved' : 'declined' } : m,
    ))
    await submitToolResult(callId, { approved })
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
        background: 'var(--color-vellum)',
        borderLeft: '1px solid var(--color-n200)',
        boxShadow: 'none',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 18px 0',
          borderBottom: '1px solid var(--color-n200)',
          background: 'var(--color-vellum)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              className="h3ros-pulse"
              style={{
                width: 6, height: 6,
                background: 'var(--color-arc-cyan)',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--color-ink)',
                display: 'inline-flex',
                alignItems: 'baseline',
              }}
            >
              COFOUND
              <Glyph3 size="0.72em" style={{ marginLeft: 1, marginRight: 1, transform: 'translateY(-0.01em)' }} />
              R
            </span>
            <EyebrowLabel keyword="ONLINE" />
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-n600)',
              fontSize: 20,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* File access — read-only, so COFOUND3R can look at real files
            when asked. Hidden entirely if the browser has no File System
            Access API support (Safari); those users keep the existing
            upload flow instead of hitting a silently-broken button. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {fileAccessSupported && (
              <button
                onClick={folderConnected ? handleDisconnectFolder : handleConnectFolder}
                style={{
                  background: 'none',
                  border: '1px solid var(--color-n300, #d0d0d0)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: folderConnected ? 'var(--color-arc-cyan)' : 'var(--color-n600)',
                  fontFamily: 'var(--font-plex-mono), monospace',
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                }}
              >
                {folderConnected ? '● Folder connected' : '○ Connect folder'}
              </button>
            )}
            {/* Explicit opt-in for the Stage 4 agent loop -- a normal chat
                message never silently becomes a multi-step goal. */}
            <button
              onClick={() => setAgentMode(v => !v)}
              disabled={streaming}
              title="When on, your next message runs as a multi-step agent goal instead of a single-turn chat reply."
              style={{
                background: 'none',
                border: '1px solid var(--color-n300, #d0d0d0)',
                borderRadius: 6,
                cursor: streaming ? 'not-allowed' : 'pointer',
                color: agentMode ? 'var(--color-arc-cyan)' : 'var(--color-n600)',
                fontFamily: 'var(--font-plex-mono), monospace',
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                padding: '3px 8px',
              }}
            >
              {agentMode ? '● Agent mode' : '○ Agent mode'}
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
                borderBottom: tab === t ? '2px solid var(--color-arc-cyan)' : '2px solid transparent',
                cursor: 'pointer',
                fontFamily: 'var(--font-plex-mono), monospace',
                fontWeight: 500,
                fontSize: 11,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                color: tab === t ? 'var(--color-ink)' : 'var(--color-n600)',
                transition: 'color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
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
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 16px', background: 'var(--color-off-white)' }}>
            {messages.length === 0 ? (
              <StarterPrompts onSelect={p => { setInput(p); textareaRef.current?.focus() }} />
            ) : (
              messages.map(msg => <MessageBubble key={msg.id} msg={msg} onConfirmWrite={handleConfirmWrite} />)
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            style={{
              padding: '14px 16px',
              borderTop: '1px solid var(--color-n200)',
              background: 'var(--color-vellum)',
              flexShrink: 0,
            }}
          >
            {status && (
              <div
                style={{
                  marginBottom: 8,
                  fontSize: 11,
                  fontFamily: 'var(--font-plex-mono), monospace',
                  color: 'var(--color-n600)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--color-arc-cyan-deep)',
                    animation: 'pulse 1.2s ease-in-out infinite',
                  }}
                />
                {status}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-end',
                background: 'var(--color-off-white)',
                border: '1px solid var(--color-n200)',
                padding: '8px 10px',
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask COFOUND3R anything…"
                rows={1}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  color: 'var(--color-ink)',
                  fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                  fontSize: 14,
                  lineHeight: 1.5,
                  maxHeight: 120,
                  overflowY: 'auto',
                }}
              />
              <button
                onClick={send}
                disabled={streaming || !input.trim()}
                aria-label="Send"
                style={{
                  background: streaming || !input.trim() ? 'var(--color-n200)' : 'var(--color-arc-cyan)',
                  color: 'var(--color-ink)',
                  border: 'none',
                  borderRadius: 0,
                  width: 28,
                  height: 28,
                  cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
                }}
              >
                <SendIcon />
              </button>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-plex-mono), monospace',
                fontSize: 10,
                color: 'var(--color-n400)',
                marginTop: 6,
                textAlign: 'center',
                letterSpacing: '0.06em',
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

function MessageBubble({ msg, onConfirmWrite }: { msg: Message; onConfirmWrite: (callId: string, approved: boolean) => void }) {
  if (msg.role === 'intent') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
        <EyebrowLabel keyword={`INTENT — ${msg.content}`} color="var(--color-n400)" />
      </div>
    )
  }
  if (msg.role === 'trace') {
    return (
      <div
        style={{
          fontFamily: 'var(--font-plex-mono), monospace',
          fontSize: 11,
          color: 'var(--color-n600)',
          margin: '4px 0 4px 32px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {msg.content}
      </div>
    )
  }
  if (msg.role === 'confirm') {
    return (
      <div
        style={{
          margin: '10px 0 10px 32px',
          border: '1px solid var(--color-arc-cyan-deep)',
          padding: '10px 12px',
          background: 'var(--color-vellum)',
        }}
      >
        <div style={{ fontSize: 10, fontFamily: 'var(--font-plex-mono), monospace', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-n600)', marginBottom: 6 }}>
          Remember this? ({msg.source === 'user_stated' ? 'you said this' : 'agent inferred this'})
        </div>
        <div style={{ fontFamily: 'var(--font-archivo), system-ui, sans-serif', fontSize: 14, marginBottom: 8, color: 'var(--color-ink)' }}>
          {msg.content}
        </div>
        {msg.resolved ? (
          <div style={{ fontSize: 11, fontFamily: 'var(--font-plex-mono), monospace', color: 'var(--color-n600)' }}>
            {msg.resolved === 'approved' ? '✓ Saved' : '✗ Not saved'}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => onConfirmWrite(msg.callId as string, true)}
              style={{ background: 'var(--color-arc-cyan)', border: 'none', padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}
            >
              Save
            </button>
            <button
              onClick={() => onConfirmWrite(msg.callId as string, false)}
              style={{ background: 'none', border: '1px solid var(--color-n300, #d0d0d0)', padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-archivo), system-ui, sans-serif' }}
            >
              Don't save
            </button>
          </div>
        )}
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
            borderRadius: 0,
            background: 'var(--color-vellum)',
            border: '1px solid var(--color-n200)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Glyph3 size={11} color="var(--color-ink)" />
        </div>
        <div
          style={{
            background: 'var(--color-vellum)',
            border: '1px solid var(--color-n200)',
            padding: '10px 14px',
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
                borderRadius: 0,
                background: 'var(--color-arc-cyan)',
                animation: `h3ros-pulse-opacity 1.2s ease-in-out ${i * 0.2}s infinite`,
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
            borderRadius: 0,
            background: 'var(--color-vellum)',
            border: '1px solid var(--color-n200)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Glyph3 size={11} color="var(--color-ink)" />
        </div>
      )}
      <div
        style={{
          maxWidth: '82%',
          background: isUser ? 'var(--color-ink)' : 'var(--color-vellum)',
          color: isUser ? 'var(--color-off-white)' : 'var(--color-ink)',
          border: isUser ? '1px solid var(--color-ink)' : '1px solid var(--color-n200)',
          padding: '10px 14px',
        }}
      >
        {isUser ? (
          <p style={{
            fontFamily: 'var(--font-archivo), system-ui, sans-serif',
            fontSize: 14,
            lineHeight: 1.5,
            margin: 0,
            color: 'var(--color-off-white)',
          }}>{msg.content}</p>
        ) : (
          <div className="forge-md">
            <Markdown content={msg.content} />
          </div>
        )}
      </div>
    </div>
  )
}

function StarterPrompts({ onSelect }: { onSelect: (p: string) => void }) {
  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <EyebrowLabel keyword="COFOUND3R is online" color="var(--color-n400)" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--color-n200)', border: '1px solid var(--color-n200)' }}>
        {STARTER_PROMPTS.map(p => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            style={{
              padding: '12px 16px',
              textAlign: 'left',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 0,
              background: 'var(--color-vellum)',
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-plex-serif), serif',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-off-white)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-vellum)')}
          >
            <span style={{ color: 'var(--color-arc-cyan-deep)', fontSize: 12 }}>→</span>
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

function SignalsTab() {
  const [summary, setSummary] = useState({ knowledge: 0, projects: 0, tasks: 0 })
  useEffect(() => {
    Promise.all([
      api.knowledge.list(),
      api.projects.list(),
      api.tasks.list(),
    ]).then(([k, p, t]) => {
      setSummary({
        knowledge: k.length,
        projects: p.length,
        tasks: t.filter(x => x.status !== 'completed').length,
      })
    }).catch(() => {})
  }, [])

  const stats: { label: string; value: number }[] = [
    { label: 'Archive',       value: summary.knowledge },
    { label: 'Active builds', value: summary.projects },
    { label: 'Runsheet',      value: summary.tasks },
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, background: 'var(--color-off-white)' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 1,
        background: 'var(--color-n200)',
        border: '1px solid var(--color-n200)',
        marginBottom: 16,
      }}>
        {stats.map(s => (
          <div
            key={s.label}
            style={{ background: 'var(--color-vellum)', padding: '14px 16px' }}
          >
            <EyebrowLabel keyword={s.label} style={{ marginBottom: 6 }} />
            <div
              style={{
                fontFamily: 'var(--font-archivo-black), sans-serif',
                fontWeight: 400,
                fontSize: 28,
                lineHeight: 1,
                color: 'var(--color-ink)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', padding: 12 }}>
        <EyebrowLabel keyword="FOUND3RY STATE · LIVE" color="var(--color-n400)" />
      </div>
    </div>
  )
}

function OpsTab({ onNavigate }: { onNavigate: (path: string) => void }) {
  const quickActions = [
    { label: 'New build',     path: '/projects' },
    { label: 'Add knowledge', path: '/knowledge' },
    { label: 'View tasks',    path: '/tasks' },
    { label: 'Launch brief',  path: '/launchpad' },
  ]

  const crew = [
    { id: 'field_analyst',     label: 'Field Analyst' },
    { id: 'systems_architect', label: 'Systems Architect' },
    { id: 'market_scout',      label: 'Market Scout' },
    { id: 'launch_strategist', label: 'Launch Strategist' },
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, background: 'var(--color-off-white)' }}>
      <EyebrowLabel number="01" keyword="QUICK ACTIONS" style={{ marginBottom: 10 }} />
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        background: 'var(--color-n200)',
        border: '1px solid var(--color-n200)',
        marginBottom: 24,
      }}>
        {quickActions.map(a => (
          <button
            key={a.label}
            onClick={() => onNavigate(a.path)}
            style={{
              padding: '10px 14px',
              textAlign: 'left',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 0,
              background: 'var(--color-vellum)',
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-archivo), system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-off-white)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-vellum)')}
          >
            <span style={{ color: 'var(--color-arc-cyan-deep)', fontSize: 12 }}>→</span>
            {a.label}
          </button>
        ))}
      </div>

      <EyebrowLabel number="02" keyword="DEPLOY CREW" style={{ marginBottom: 10 }} />
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 1,
        background: 'var(--color-n200)',
        border: '1px solid var(--color-n200)',
      }}>
        {crew.map(c => (
          <button
            key={c.id}
            onClick={() => onNavigate(`/agents?agent=${c.id}`)}
            style={{
              padding: '10px',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 0,
              background: 'var(--color-vellum)',
              color: 'var(--color-ink)',
              fontFamily: 'var(--font-plex-mono), monospace',
              fontWeight: 500,
              fontSize: 10,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              textAlign: 'center',
              transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-off-white)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-vellum)')}
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
      <path d="M1 6h10M7 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
