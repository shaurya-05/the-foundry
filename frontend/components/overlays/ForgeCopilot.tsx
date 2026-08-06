'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { streamWS, submitToolResult } from '@/lib/streaming'
import Markdown from '@/components/ui/Markdown'
import { api } from '@/lib/api'
import { useRouter } from 'next/navigation'
import Glyph3 from '@/components/brand/Glyph3'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import H3roJarvisOrb from '@/components/h3ro/H3roJarvisOrb'
import {
  warmVoices,
  createListener,
  StreamingSpeaker,
  isSpeechRecognitionSupported,
  type VoiceState,
} from '@/lib/voice'
import {
  isFileAccessSupported,
  isFilePickerSupported,
  connectFolder,
  disconnectFolder,
  getConnectedFolder,
  selectFiles,
  getSelectedFiles,
  clearSelectedFiles,
  handleFileToolRequest,
} from '@/lib/fileAccess'

interface Message {
  id: string
  role: 'user' | 'copilot' | 'typing' | 'trace' | 'confirm'
  content: string
  callId?: string
  source?: string
  resolved?: 'approved' | 'declined'
}

interface ForgeCopilotProps {
  onClose: () => void
  commandCenter?: boolean
}

const STARTER_PROMPTS = [
  'What should I focus on right now?',
  'Show me workspace status.',
  'What patterns do you see in my work?',
]

function H3roMark({ size = 13 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', letterSpacing: '0.04em' }}>
      H
      <Glyph3 size={`${size}px`} style={{ marginLeft: 1, marginRight: 1, transform: 'translateY(-0.02em)' }} />
      RO
    </span>
  )
}

export default function ForgeCopilot({ onClose, commandCenter = false }: ForgeCopilotProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState('')
  const [tab, setTab] = useState<'talk' | 'signals' | 'ops'>('talk')
  const [activeThread, setActiveThread] = useState<string | undefined>(undefined)
  const [folderConnected, setFolderConnected] = useState(false)
  const [grantedFiles, setGrantedFiles] = useState<string[]>([])
  const [agentMode, setAgentMode] = useState(true)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [interim, setInterim] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [conversationOn, setConversationOn] = useState(true)
  const [quietInput, setQuietInput] = useState('')
  const [error, setError] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)
  const listenerRef = useRef<ReturnType<typeof createListener>>(null)
  const speakerRef = useRef<StreamingSpeaker | null>(null)
  const conversationOnRef = useRef(true)
  const streamingRef = useRef(false)
  const sendRef = useRef<(msg: string) => Promise<void>>(async () => {})
  const router = useRouter()

  useEffect(() => { conversationOnRef.current = conversationOn }, [conversationOn])
  useEffect(() => { streamingRef.current = streaming }, [streaming])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, transcriptOpen])

  useEffect(() => {
    warmVoices()
    if (isFileAccessSupported()) {
      getConnectedFolder().then(h => setFolderConnected(!!h))
    }
    if (isFilePickerSupported()) {
      getSelectedFiles().then(f => setGrantedFiles(f.map(x => x.name)))
    }
    return () => {
      listenerRef.current?.abort()
      speakerRef.current?.cancel()
      window.speechSynthesis?.cancel()
    }
  }, [])

  const startListening = useCallback(() => {
    if (streamingRef.current) return
    listenerRef.current?.abort()
    speakerRef.current?.cancel()
    window.speechSynthesis?.cancel()

    const listener = createListener({
      onInterim: (t) => setInterim(t),
      onFinal: (text) => {
        setInterim('')
        setVoiceState('processing')
        sendRef.current(text)
      },
      onError: (err) => {
        setInterim('')
        setVoiceState('idle')
        if (err === 'not-allowed') setError('Microphone denied — allow mic for H3RO.')
      },
      onEnd: () => {
        setInterim('')
        if (!streamingRef.current) setVoiceState(s => (s === 'listening' ? 'idle' : s))
      },
    })
    if (!listener) {
      setError('Voice not supported — type below.')
      return
    }
    listenerRef.current = listener
    setError('')
    setVoiceState('listening')
    listener.start()
  }, [])

  async function send(msg: string) {
    if (!msg.trim() || streamingRef.current) return

    setMessages(prev => [
      ...prev,
      { id: Date.now() + 'u', role: 'user', content: msg },
      { id: Date.now() + 't', role: 'typing', content: '' },
    ])

    setStreaming(true)
    setStatus('')
    setVoiceState('processing')
    const responseId = Date.now() + 'r'
    const runningAsAgent = agentMode

    const speaker = new StreamingSpeaker({
      onSpeakingChange: (speaking) => { if (speaking) setVoiceState('speaking') },
      onIdle: () => {
        setVoiceState('idle')
        if (conversationOnRef.current) {
          setTimeout(() => {
            if (!streamingRef.current && conversationOnRef.current) startListening()
          }, 400)
        }
      },
    })
    speakerRef.current = speaker

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
            handleFileToolRequest(chunk)
          }
        } else if (chunk.type === 'text_delta') {
          if (status) setStatus('')
          full += chunk.text
          speaker.push(chunk.text)
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
          const answer = chunk.answer || full
          if (answer && !full) speaker.push(answer)
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'typing'),
            { id: responseId, role: 'copilot', content: answer },
          ])
        } else if (chunk.type === 'agent_stopped') {
          setMessages(prev => [
            ...prev.filter(m => m.role !== 'typing'),
            { id: responseId, role: 'copilot', content: chunk.partial_answer },
          ])
        }
      }
      speaker.finish()
    } catch {
      speaker.cancel()
      setVoiceState('idle')
      setMessages(prev => prev.filter(m => m.role !== 'typing'))
    } finally {
      setStreaming(false)
      setStatus('')
    }
  }

  sendRef.current = send

  async function handleConfirmWrite(callId: string, approved: boolean) {
    setMessages(prev => prev.map(m =>
      m.callId === callId ? { ...m, resolved: approved ? 'approved' : 'declined' } : m,
    ))
    await submitToolResult(callId, { approved })
  }

  async function grantFiles() {
    try {
      const files = await selectFiles()
      setGrantedFiles(files.map(f => f.name))
    } catch { /* cancelled */ }
  }

  async function grantFolder() {
    try {
      await connectFolder()
      setFolderConnected(true)
    } catch { /* cancelled */ }
  }

  async function revokeAccess() {
    await clearSelectedFiles()
    await disconnectFolder()
    setGrantedFiles([])
    setFolderConnected(false)
  }

  const hasAccess = folderConnected || grantedFiles.length > 0
  const stateLabel =
    voiceState === 'listening' ? 'Listening…'
    : voiceState === 'processing' ? (status || 'Thinking…')
    : voiceState === 'speaking' ? 'Speaking…'
    : 'Tap to talk'

  return (
    <div
      className="liquid-glass-strong forge-glass-panel"
      style={{
        position: 'fixed',
        top: commandCenter ? 62 : 12,
        right: 12,
        bottom: 12,
        width: commandCenter ? 'min(460px, calc(100vw - 24px))' : 400,
        zIndex: 600,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
        borderRadius: 22,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', borderRadius: 22 }}>
        <div style={{ padding: '16px 18px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="h3ros-pulse" style={{ width: 6, height: 6, background: 'var(--color-arc-cyan)', borderRadius: 2 }} />
              <span style={{
                fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                fontWeight: 700, fontSize: 13, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: 'var(--color-ink)',
              }}>
                <H3roMark />
              </span>
              <EyebrowLabel keyword="ONLINE" />
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'var(--glass-bg)', border: '1px solid var(--border)', borderRadius: 8,
                cursor: 'pointer', color: 'var(--color-n600)', fontSize: 18, lineHeight: 1,
                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {isFilePickerSupported() && (
              <button onClick={grantFiles} style={chip(hasAccess)}>
                {grantedFiles.length ? `● ${grantedFiles.length} files` : '○ Select files'}
              </button>
            )}
            {isFileAccessSupported() && (
              <button
                onClick={folderConnected ? revokeAccess : grantFolder}
                style={chip(folderConnected)}
              >
                {folderConnected ? '● Folder' : '○ Folder'}
              </button>
            )}
            <button onClick={() => setAgentMode(v => !v)} disabled={streaming} style={chip(agentMode)}>
              {agentMode ? '● Agent' : '○ Agent'}
            </button>
            <button onClick={() => setConversationOn(v => !v)} style={chip(conversationOn)}>
              {conversationOn ? '● Live' : '○ Live'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 0, marginBottom: -1 }}>
            {(['talk', 'signals', 'ops'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '8px 14px', background: 'none', border: 'none',
                  borderBottom: tab === t ? '2px solid var(--color-arc-cyan)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-ibm-plex-mono), monospace',
                  fontWeight: 500, fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase',
                  color: tab === t ? 'var(--color-ink)' : 'var(--color-n600)',
                }}
              >
                {t === 'talk' ? 'Talk' : t === 'signals' ? 'Signals' : 'Ops'}
              </button>
            ))}
          </div>
        </div>

        {tab === 'talk' && (
          <>
            <div style={{
              flex: transcriptOpen ? '0 0 auto' : 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px 16px 12px',
              minHeight: transcriptOpen ? 160 : 0,
              background:
                'radial-gradient(ellipse 70% 50% at 50% 40%, rgba(159,222,250,0.12) 0%, transparent 60%)',
            }}>
              <H3roJarvisOrb
                state={voiceState}
                size={transcriptOpen ? 120 : 150}
                disabled={streaming && voiceState === 'processing'}
                aria-label="Talk to H3RO"
                onClick={() => {
                  if (voiceState === 'listening') {
                    listenerRef.current?.stop()
                    setVoiceState('idle')
                  } else if (voiceState === 'speaking') {
                    speakerRef.current?.cancel()
                    window.speechSynthesis?.cancel()
                    setVoiceState('idle')
                  } else if (!streaming) {
                    startListening()
                  }
                }}
              />

              <div style={{
                marginTop: 14,
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 11,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: voiceState === 'idle' ? 'var(--color-n400)' : 'var(--color-arc-cyan)',
              }}>
                {stateLabel}
              </div>

              {(interim || (messages.length === 0 && voiceState === 'idle')) && (
                <div style={{
                  marginTop: 10, maxWidth: 280, textAlign: 'center',
                  fontFamily: 'var(--font-archivo)', fontSize: 13, lineHeight: 1.45,
                  color: interim ? 'var(--color-ink)' : 'var(--color-n600)',
                  fontStyle: interim ? 'normal' : 'italic',
                }}>
                  {interim || 'Your collaborating cofound3r. Just talk.'}
                </div>
              )}

              {messages.length === 0 && voiceState === 'idle' && !interim && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16, width: '100%' }}>
                  {STARTER_PROMPTS.map(p => (
                    <button
                      key={p}
                      onClick={() => send(p)}
                      style={{
                        padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        background: 'rgba(255,255,255,0.12)', border: '1px solid var(--border)',
                        borderRadius: 10, color: 'var(--color-ink)',
                        fontFamily: 'var(--font-archivo)', fontSize: 12,
                      }}
                    >
                      <span style={{ color: 'var(--color-arc-cyan)', marginRight: 8 }}>→</span>
                      {p}
                    </button>
                  ))}
                </div>
              )}

              {error && (
                <div style={{ marginTop: 8, color: 'var(--color-signal)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, textAlign: 'center' }}>
                  {error}
                </div>
              )}

              {!isSpeechRecognitionSupported() && (
                <div style={{ marginTop: 8, fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n600)' }}>
                  Voice unavailable — type below
                </div>
              )}
            </div>

            <div style={{ padding: '0 16px 8px', flexShrink: 0 }}>
              <button
                onClick={() => setTranscriptOpen(v => !v)}
                style={{
                  width: '100%', padding: '8px 10px',
                  background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)',
                  borderRadius: 10, cursor: 'pointer',
                  fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--color-n600)',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <span>{transcriptOpen ? 'Hide transcript' : 'Show transcript'}</span>
                <span style={{ transform: transcriptOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
              </button>
            </div>

            {transcriptOpen && (
              <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px 12px', minHeight: 0 }}>
                {messages.length === 0 ? (
                  <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-n400)', textAlign: 'center', padding: 12 }}>
                    Transcript appears here when you talk.
                  </div>
                ) : (
                  messages.map(msg => (
                    <MessageBubble key={msg.id} msg={msg} onConfirmWrite={handleConfirmWrite} />
                  ))
                )}
                <div ref={bottomRef} />
              </div>
            )}

            <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
              <div style={{
                display: 'flex', gap: 8, alignItems: 'flex-end',
                background: 'var(--glass-bg)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '8px 10px',
              }}>
                <input
                  value={quietInput}
                  onChange={e => setQuietInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const t = quietInput.trim()
                      if (t) { setQuietInput(''); send(t) }
                    }
                  }}
                  disabled={streaming}
                  placeholder="Or type quietly…"
                  style={{
                    flex: 1, background: 'none', border: 'none', outline: 'none',
                    color: 'var(--color-ink)', fontFamily: 'var(--font-archivo)', fontSize: 13,
                  }}
                />
                <button
                  onClick={() => {
                    const t = quietInput.trim()
                    if (t) { setQuietInput(''); send(t) }
                  }}
                  disabled={streaming || !quietInput.trim()}
                  style={{
                    background: streaming || !quietInput.trim() ? 'var(--color-n200)' : 'var(--color-arc-cyan)',
                    color: streaming || !quietInput.trim() ? 'var(--color-n400)' : '#F4F7FA',
                    border: 'none', borderRadius: 8, width: 28, height: 28,
                    cursor: streaming || !quietInput.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <SendIcon />
                </button>
              </div>
              <div style={{
                fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--color-n400)',
                marginTop: 8, textAlign: 'center', letterSpacing: '0.06em',
              }}>
                H3RO · British voice · ⌘J to toggle
              </div>
            </div>
          </>
        )}

        {tab === 'signals' && <SignalsTab />}
        {tab === 'ops' && <OpsTab onNavigate={(path) => { router.push(path); onClose() }} />}
      </div>
    </div>
  )
}

function chip(active: boolean): React.CSSProperties {
  return {
    background: 'var(--glass-bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    cursor: 'pointer',
    color: active ? 'var(--color-arc-cyan)' : 'var(--color-n600)',
    fontFamily: 'var(--font-ibm-plex-mono), monospace',
    fontSize: 10,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '4px 9px',
  }
}

function MessageBubble({ msg, onConfirmWrite }: { msg: Message; onConfirmWrite: (callId: string, approved: boolean) => void }) {
  if (msg.role === 'trace') {
    return (
      <div style={{
        fontFamily: 'var(--font-plex-mono), monospace', fontSize: 11,
        color: 'var(--color-n600)', margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    )
  }
  if (msg.role === 'confirm') {
    return (
      <div style={{
        margin: '10px 0', border: '1px solid var(--color-arc-cyan-deep)',
        padding: '10px 12px', background: 'var(--color-vellum)', borderRadius: 10,
      }}>
        <div style={{ fontSize: 10, fontFamily: 'var(--font-plex-mono), monospace', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-n600)', marginBottom: 6 }}>
          Remember this?
        </div>
        <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, marginBottom: 8 }}>{msg.content}</div>
        {msg.resolved ? (
          <div style={{ fontSize: 11, fontFamily: 'var(--font-plex-mono)', color: 'var(--color-n600)' }}>
            {msg.resolved === 'approved' ? '✓ Saved' : '✗ Not saved'}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onConfirmWrite(msg.callId as string, true)} className="btn btn-primary btn-sm">Save</button>
            <button onClick={() => onConfirmWrite(msg.callId as string, false)} className="btn btn-sm">Don&apos;t save</button>
          </div>
        )}
      </div>
    )
  }
  if (msg.role === 'typing') {
    return (
      <div style={{ display: 'flex', gap: 4, padding: '8px 0', alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, background: 'var(--color-arc-cyan)',
            animation: `h3ros-pulse-opacity 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    )
  }

  const isUser = msg.role === 'user'
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, letterSpacing: '0.1em',
        color: isUser ? 'var(--color-n400)' : 'var(--color-arc-cyan)', marginBottom: 4,
      }}>
        {isUser ? 'YOU' : <H3roMark size={9} />}
      </div>
      {isUser ? (
        <p style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, lineHeight: 1.5, margin: 0 }}>{msg.content}</p>
      ) : (
        <div className="forge-md"><Markdown content={msg.content} /></div>
      )}
    </div>
  )
}

function SignalsTab() {
  const [summary, setSummary] = useState({ knowledge: 0, projects: 0, tasks: 0 })
  useEffect(() => {
    Promise.all([api.knowledge.list(), api.projects.list(), api.tasks.list()])
      .then(([k, p, t]) => {
        setSummary({ knowledge: k.length, projects: p.length, tasks: t.filter(x => x.status !== 'completed').length })
      })
      .catch(() => {})
  }, [])

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Archive', value: summary.knowledge },
          { label: 'Active builds', value: summary.projects },
          { label: 'Runsheet', value: summary.tasks },
        ].map(s => (
          <div key={s.label} style={{
            padding: '14px 16px', background: 'rgba(255,255,255,0.12)',
            border: '1px solid var(--border)', borderRadius: 12,
          }}>
            <EyebrowLabel keyword={s.label} style={{ marginBottom: 6 }} />
            <div style={{
              fontFamily: 'var(--font-archivo-black), sans-serif', fontSize: 28,
              lineHeight: 1, color: 'var(--color-ink)', fontVariantNumeric: 'tabular-nums',
            }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function OpsTab({ onNavigate }: { onNavigate: (path: string) => void }) {
  const quickActions = [
    { label: 'Talk with H3RO', path: '/agents' },
    { label: 'New build', path: '/projects' },
    { label: 'View tasks', path: '/tasks' },
    { label: 'Settings', path: '/settings' },
  ]

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <EyebrowLabel number="01" keyword="QUICK ACTIONS" style={{ marginBottom: 10 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {quickActions.map(a => (
          <button
            key={a.label}
            onClick={() => onNavigate(a.path)}
            className="liquid-glass-interactive"
            style={{
              padding: '10px 14px', textAlign: 'left', cursor: 'pointer',
              background: 'rgba(255,255,255,0.12)', border: '1px solid var(--border)',
              borderRadius: 12, color: 'var(--color-ink)',
              fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 12,
              letterSpacing: '0.06em', textTransform: 'uppercase', width: '100%',
            }}
          >
            <span style={{ color: 'var(--color-arc-cyan)', marginRight: 8 }}>→</span>
            {a.label}
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
