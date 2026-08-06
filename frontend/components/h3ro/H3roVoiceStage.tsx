'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { streamWS, LimitExceededError } from '@/lib/streaming'
import Markdown from '@/components/ui/Markdown'
import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'
import Glyph3 from '@/components/brand/Glyph3'
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
  removeSelectedFile,
  handleFileToolRequest,
} from '@/lib/fileAccess'

type Exchange = {
  q: string
  a: string
  ts: Date
  model?: string
  limitExceeded?: boolean
  upgradeUrl?: string
  council?: { model: string; response: string }[]
}

type Thread = { id: string; title: string; created_at: string }

const STARTERS = [
  'What should I focus on this week?',
  'Review my strategy and find the gaps.',
  'What are the biggest risks right now?',
  'Help me prepare for an investor conversation.',
]

function H3roMark({ size = 14 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', letterSpacing: '0.04em' }}>
      H
      <Glyph3 size={`${size}px`} style={{ marginLeft: 1, marginRight: 1, transform: 'translateY(-0.02em)' }} />
      RO
    </span>
  )
}

export default function H3roVoiceStage() {
  const router = useRouter()
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [error, setError] = useState('')
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThread, setActiveThread] = useState<string | null>(null)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [interim, setInterim] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [conversationOn, setConversationOn] = useState(true)
  const [speechOk, setSpeechOk] = useState(true)
  const [folderConnected, setFolderConnected] = useState(false)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [grantedFiles, setGrantedFiles] = useState<string[]>([])
  const [filesOpen, setFilesOpen] = useState(false)
  const [quietInput, setQuietInput] = useState('')
  const [showQuiet, setShowQuiet] = useState(false)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const listenerRef = useRef<ReturnType<typeof createListener>>(null)
  const speakerRef = useRef<StreamingSpeaker | null>(null)
  const conversationOnRef = useRef(true)
  const streamingRef = useRef(false)
  const askRef = useRef<(q: string) => Promise<void>>(async () => {})

  useEffect(() => { conversationOnRef.current = conversationOn }, [conversationOn])
  useEffect(() => { streamingRef.current = streaming }, [streaming])

  useEffect(() => {
    warmVoices()
    setSpeechOk(isSpeechRecognitionSupported())
    loadThreads()
    refreshFileAccess()
    return () => {
      listenerRef.current?.abort()
      speakerRef.current?.cancel()
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    }
  }, [])

  useEffect(() => {
    if (scrollerRef.current && transcriptOpen) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [exchanges, streaming, transcriptOpen])

  async function refreshFileAccess() {
    if (isFileAccessSupported()) {
      const handle = await getConnectedFolder()
      setFolderConnected(!!handle)
      setFolderName(handle?.name ?? null)
    }
    if (isFilePickerSupported()) {
      const files = await getSelectedFiles()
      setGrantedFiles(files.map(f => f.name))
    }
  }

  async function loadThreads() {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(API_URL + '/api/copilot/threads', { headers: { Authorization: 'Bearer ' + token } })
      if (res.ok) setThreads(await res.json())
    } catch { /* ignore */ }
  }

  async function loadThread(threadId: string) {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(API_URL + '/api/copilot/history?thread_id=' + threadId + '&limit=50', {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (res.ok) {
        const msgs = await res.json()
        const rebuilt: Exchange[] = []
        for (let i = 0; i < msgs.length; i += 2) {
          if (msgs[i] && msgs[i + 1]) {
            rebuilt.push({
              q: msgs[i].content,
              a: msgs[i + 1].content,
              ts: new Date(msgs[i].created_at),
              model: msgs[i + 1].model_used,
            })
          }
        }
        setExchanges(rebuilt)
        setActiveThread(threadId)
        setTranscriptOpen(true)
      }
    } catch { /* ignore */ }
  }

  async function handleUpgrade() {
    const token = getToken()
    if (!token) { router.push('/settings'); return }
    try {
      const res = await fetch(API_URL + '/api/subscription/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ plan_id: 'pro', billing_cycle: 'monthly' }),
      })
      const data = await res.json()
      if (data.checkout_url) window.location.href = data.checkout_url
      else router.push('/settings')
    } catch { router.push('/settings') }
  }

  const startListening = useCallback(() => {
    if (streamingRef.current) return
    listenerRef.current?.abort()
    speakerRef.current?.cancel()
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()

    const listener = createListener({
      onInterim: (t) => setInterim(t),
      onFinal: (text) => {
        setInterim('')
        setVoiceState('processing')
        askRef.current(text)
      },
      onError: (err) => {
        setInterim('')
        setVoiceState('idle')
        if (err === 'not-allowed') setError('Microphone permission denied. Allow mic access for H3RO.')
        else if (err !== 'no-speech') setError('Voice error: ' + err)
      },
      onEnd: () => {
        setInterim('')
        if (!streamingRef.current) setVoiceState((s) => (s === 'listening' ? 'idle' : s))
      },
    })
    if (!listener) {
      setSpeechOk(false)
      setShowQuiet(true)
      return
    }
    listenerRef.current = listener
    setError('')
    setVoiceState('listening')
    listener.start()
  }, [])

  const stopListening = useCallback(() => {
    listenerRef.current?.stop()
    setVoiceState((s) => (s === 'listening' ? 'idle' : s))
  }, [])

  async function ask(q: string) {
    if (!q.trim() || streamingRef.current) return
    setError('')
    setStreaming(true)
    setStatus('')
    setVoiceState('processing')
    setExchanges(prev => [...prev, { q, a: '', ts: new Date() }])

    const speaker = new StreamingSpeaker({
      onSpeakingChange: (speaking) => {
        if (speaking) setVoiceState('speaking')
      },
      onIdle: () => {
        setVoiceState('idle')
        if (conversationOnRef.current) {
          // Brief beat, then listen again — Jarvis loop
          setTimeout(() => {
            if (!streamingRef.current && conversationOnRef.current) startListening()
          }, 400)
        }
      },
    })
    speakerRef.current = speaker

    try {
      for await (const chunk of streamWS('/api/copilot/message', {
        message: q,
        thread_id: activeThread,
        agent_mode: true,
      })) {
        if (chunk.type === 'thread_id' && chunk.thread_id) {
          setActiveThread(chunk.thread_id)
          loadThreads()
        } else if (chunk.type === 'status') {
          setStatus(chunk.text)
        } else if (chunk.type === 'tool_request') {
          if (chunk.tool === 'list_files' || chunk.tool === 'read_file') {
            handleFileToolRequest(chunk)
          }
        } else if (chunk.type === 'text_delta') {
          if (status) setStatus('')
          speaker.push(chunk.text)
          setExchanges(prev => {
            const c = [...prev]
            c[c.length - 1] = { ...c[c.length - 1], a: c[c.length - 1].a + chunk.text }
            return c
          })
        } else if (chunk.type === 'model_used') {
          setExchanges(prev => {
            const c = [...prev]
            c[c.length - 1] = { ...c[c.length - 1], model: chunk.model }
            return c
          })
        } else if (chunk.type === 'council') {
          setExchanges(prev => {
            const c = [...prev]
            c[c.length - 1] = { ...c[c.length - 1], council: chunk.perspectives }
            return c
          })
        } else if (chunk.type === 'agent_final' && chunk.answer) {
          speaker.push(chunk.answer)
          setExchanges(prev => {
            const c = [...prev]
            if (!c[c.length - 1].a) c[c.length - 1] = { ...c[c.length - 1], a: chunk.answer }
            return c
          })
        }
      }
      speaker.finish()
    } catch (e: unknown) {
      speaker.cancel()
      setVoiceState('idle')
      if (e instanceof LimitExceededError) {
        setExchanges(prev => {
          const c = [...prev]
          c[c.length - 1] = { ...c[c.length - 1], limitExceeded: true, upgradeUrl: e.upgradeUrl }
          return c
        })
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error')
      }
    } finally {
      setStreaming(false)
      setStatus('')
    }
  }

  askRef.current = ask

  async function grantFiles() {
    try {
      const files = await selectFiles()
      setGrantedFiles(files.map(f => f.name))
      setFilesOpen(true)
    } catch { /* cancelled */ }
  }

  async function grantFolder() {
    try {
      const handle = await connectFolder()
      setFolderConnected(true)
      setFolderName(handle.name)
      setFilesOpen(true)
    } catch { /* cancelled */ }
  }

  async function revokeAllFiles() {
    await clearSelectedFiles()
    await disconnectFolder()
    setGrantedFiles([])
    setFolderConnected(false)
    setFolderName(null)
  }

  const stateLabel =
    voiceState === 'listening' ? 'Listening…'
    : voiceState === 'processing' ? (status || 'Thinking…')
    : voiceState === 'speaking' ? 'Speaking…'
    : conversationOn ? 'Tap to talk' : 'Ready'

  const hasAccess = folderConnected || grantedFiles.length > 0

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      minHeight: 0,
      flexDirection: 'column',
      overflow: 'hidden',
      padding: '0 10px 10px',
      position: 'relative',
    }}>
      <div
        className="liquid-glass-strong"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 18,
          overflow: 'hidden',
          minHeight: 0,
          position: 'relative',
          background:
            'radial-gradient(ellipse 80% 60% at 50% 35%, rgba(159,222,250,0.14) 0%, transparent 55%), var(--glass-bg, rgba(255,255,255,0.06))',
        }}
      >
        {/* Top bar */}
        <div style={{
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-archivo)',
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-ink)',
            }}>
              <H3roMark size={15} />
            </div>
            <div style={{
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 9,
              color: 'var(--color-n400)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginTop: 2,
            }}>
              Collaborating cofound3r · pronounced hero
            </div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setConversationOn(v => !v)}
              title="Keep listening after H3RO finishes speaking"
              style={chipStyle(conversationOn)}
            >
              {conversationOn ? '● Live' : '○ Live'}
            </button>
            <button onClick={() => setFilesOpen(v => !v)} style={chipStyle(hasAccess || filesOpen)}>
              {hasAccess ? `● Files (${grantedFiles.length}${folderConnected ? '+folder' : ''})` : '○ Grant files'}
            </button>
            <button onClick={() => setTranscriptOpen(v => !v)} style={chipStyle(transcriptOpen)}>
              {transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            </button>
          </div>
        </div>

        {/* File access panel */}
        {filesOpen && (
          <div style={{
            padding: '12px 18px',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.03)',
            flexShrink: 0,
          }}>
            <div style={{
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 10,
              color: 'var(--color-n600)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 10,
            }}>
              H3RO file access — select what he can read; he pulls by context
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {isFilePickerSupported() && (
                <button onClick={grantFiles} className="btn btn-primary btn-sm">Select files</button>
              )}
              {isFileAccessSupported() && (
                <button onClick={grantFolder} className="btn btn-sm" style={secondaryBtn}>
                  {folderConnected ? `Folder: ${folderName}` : 'Grant folder'}
                </button>
              )}
              {hasAccess && (
                <button onClick={revokeAllFiles} className="btn btn-sm" style={secondaryBtn}>
                  Revoke all
                </button>
              )}
            </div>
            {folderConnected && (
              <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-ink)', marginBottom: 6 }}>
                Folder · {folderName} (all files inside)
              </div>
            )}
            {grantedFiles.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {grantedFiles.map(name => (
                  <span key={name} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    fontFamily: 'var(--font-ibm-plex-mono)',
                    fontSize: 11,
                    color: 'var(--color-ink)',
                  }}>
                    {name}
                    <button
                      onClick={async () => {
                        await removeSelectedFile(name)
                        setGrantedFiles(prev => prev.filter(n => n !== name))
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-n400)', padding: 0, lineHeight: 1 }}
                      aria-label={`Remove ${name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {!hasAccess && (
              <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-n600)' }}>
                No uploads needed — grant files or a folder and H3RO reads them when relevant.
              </div>
            )}
          </div>
        )}

        {/* Voice stage */}
        <div style={{
          flex: transcriptOpen ? '0 0 auto' : 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: transcriptOpen ? '28px 24px 16px' : '48px 24px',
          minHeight: transcriptOpen ? 220 : 0,
          transition: 'padding 0.2s ease',
        }}>
          <H3roJarvisOrb
            state={voiceState}
            size={transcriptOpen ? 140 : 220}
            disabled={streaming && voiceState === 'processing'}
            aria-label={voiceState === 'listening' ? 'Stop listening' : 'Talk to H3RO'}
            onClick={() => {
              if (voiceState === 'listening') stopListening()
              else if (voiceState === 'speaking') {
                speakerRef.current?.cancel()
                if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
                setVoiceState('idle')
              } else if (!streaming) {
                startListening()
              }
            }}
          />

          <div style={{
            marginTop: 20,
            fontFamily: 'var(--font-ibm-plex-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: voiceState === 'idle' ? 'var(--color-n400)' : 'var(--color-arc-cyan)',
            minHeight: 18,
          }}>
            {stateLabel}
          </div>

          {(interim || (exchanges.length === 0 && voiceState === 'idle')) && (
            <div style={{
              marginTop: 14,
              maxWidth: 420,
              textAlign: 'center',
              fontFamily: 'var(--font-archivo)',
              fontSize: 15,
              lineHeight: 1.5,
              color: interim ? 'var(--color-ink)' : 'var(--color-n600)',
              fontStyle: interim ? 'normal' : 'italic',
            }}>
              {interim || 'Talk with H3RO like a cofounder. Transcript stays out of the way until you need it.'}
            </div>
          )}

          {exchanges.length === 0 && voiceState === 'idle' && !interim && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              justifyContent: 'center',
              marginTop: 28,
              maxWidth: 560,
            }}>
              {STARTERS.map(s => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-archivo)',
                    fontSize: 12,
                    color: 'var(--color-ink)',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div style={{
              marginTop: 12,
              color: 'var(--color-signal)',
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 12,
              textAlign: 'center',
              maxWidth: 420,
            }}>
              {error}
            </div>
          )}

          {!speechOk && (
            <div style={{
              marginTop: 10,
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 11,
              color: 'var(--color-n600)',
            }}>
              Voice not supported in this browser — use quiet input below.
            </div>
          )}
        </div>

        {/* Collapsible transcript */}
        {transcriptOpen && (
          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            borderTop: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.02)',
          }}>
            <div style={{
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderBottom: '1px solid var(--border)',
            }}>
              <div style={{
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--color-n600)',
              }}>
                Transcript
              </div>
              <select
                value={activeThread || ''}
                onChange={e => {
                  if (e.target.value) loadThread(e.target.value)
                  else { setExchanges([]); setActiveThread(null) }
                }}
                style={{
                  marginLeft: 'auto',
                  maxWidth: 220,
                  fontFamily: 'var(--font-ibm-plex-mono)',
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--color-ink)',
                }}
              >
                <option value="">New conversation</option>
                {threads.map(t => (
                  <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>
                ))}
              </select>
              <button
                onClick={() => { setExchanges([]); setActiveThread(null) }}
                style={chipStyle(false)}
              >
                Clear
              </button>
            </div>
            <div ref={scrollerRef} style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
              {exchanges.length === 0 && (
                <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-n400)' }}>
                  Nothing yet — start talking.
                </div>
              )}
              {exchanges.map((ex, i) => (
                <div key={i} style={{ marginBottom: 22, maxWidth: 720 }}>
                  <div style={{
                    fontFamily: 'var(--font-ibm-plex-mono)',
                    fontSize: 10,
                    color: 'var(--color-n400)',
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                  }}>YOU</div>
                  <div style={{
                    fontFamily: 'var(--font-archivo)',
                    fontSize: 14,
                    color: 'var(--color-ink)',
                    marginBottom: 12,
                    lineHeight: 1.55,
                  }}>{ex.q}</div>
                  <div style={{
                    fontFamily: 'var(--font-ibm-plex-mono)',
                    fontSize: 10,
                    color: 'var(--color-arc-cyan)',
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                  }}>
                    <H3roMark size={10} />
                  </div>
                  {ex.limitExceeded ? (
                    <div>
                      <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, marginBottom: 8 }}>
                        Message limit reached this month.
                      </div>
                      <button onClick={handleUpgrade} className="btn btn-primary btn-sm">Upgrade</button>
                    </div>
                  ) : ex.a ? (
                    <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 14, lineHeight: 1.65, color: 'var(--color-ink)' }}>
                      <Markdown content={ex.a} streaming={streaming && i === exchanges.length - 1} />
                    </div>
                  ) : streaming && i === exchanges.length - 1 ? (
                    <span style={{ color: 'var(--color-n400)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12 }}>
                      {status || 'Thinking…'}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quiet / typed fallback */}
        <div style={{
          padding: '10px 18px 14px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <button
            onClick={() => setShowQuiet(v => !v)}
            style={{
              alignSelf: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 10,
              color: 'var(--color-n400)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {showQuiet ? 'Hide typed input' : 'Type instead'}
          </button>
          {showQuiet && (
            <div style={{
              display: 'flex',
              gap: 8,
              alignItems: 'flex-end',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '8px 10px',
            }}>
              <textarea
                value={quietInput}
                onChange={e => setQuietInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    const t = quietInput.trim()
                    if (t) { setQuietInput(''); ask(t) }
                  }
                }}
                disabled={streaming}
                placeholder="Type to H3RO…"
                rows={1}
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  resize: 'none',
                  fontFamily: 'var(--font-archivo)',
                  fontSize: 14,
                  color: 'var(--color-ink)',
                  outline: 'none',
                  minHeight: 28,
                }}
              />
              <button
                onClick={() => {
                  const t = quietInput.trim()
                  if (t) { setQuietInput(''); ask(t) }
                }}
                disabled={streaming || !quietInput.trim()}
                className="btn btn-primary btn-sm"
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: active ? 'var(--color-arc-soft)' : 'rgba(255,255,255,0.08)',
    cursor: 'pointer',
    fontFamily: 'var(--font-ibm-plex-mono)',
    fontSize: 10,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: active ? 'var(--color-arc-cyan)' : 'var(--color-n600)',
  }
}

const secondaryBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid var(--border)',
  color: 'var(--color-ink)',
}
