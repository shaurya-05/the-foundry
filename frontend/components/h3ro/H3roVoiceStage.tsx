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
  sources?: SourceCard[]
}

type SourceCard = {
  id: string
  kind: 'search' | 'document' | 'listing' | 'trace'
  title: string
  body: string
  links?: { title: string; url: string; snippet?: string }[]
}

type Thread = { id: string; title: string; created_at: string }

const STARTERS = [
  'What should I focus on this week?',
  'Search the web for the latest AI funding news.',
  'What files do I have available?',
  'Help me prepare for an investor conversation.',
]

function H3roMark({ size = 14 }: { size?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.02em',
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '0.06em',
        fontFamily: 'var(--font-archivo), system-ui, sans-serif',
        fontWeight: 700,
      }}
    >
      <span>H</span>
      <Glyph3 size="1em" color="currentColor" />
      <span>RO</span>
    </span>
  )
}

function formatObservation(tool: string, result: unknown): SourceCard | null {
  const id = `${tool}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  if (tool === 'web_search') {
    const data = result as { query?: string; results?: { title: string; url: string; content?: string }[]; note?: string; error?: string }
    if (data?.error) {
      return { id, kind: 'search', title: 'Web search', body: String(data.error) }
    }
    const links = (data?.results || []).map(r => ({
      title: r.title || r.url,
      url: r.url,
      snippet: r.content,
    }))
    return {
      id,
      kind: 'search',
      title: data?.query ? `Search · ${data.query}` : 'Web search',
      body: links.length ? `${links.length} result${links.length === 1 ? '' : 's'}` : (data?.note || 'No results'),
      links,
    }
  }
  if (tool === 'read_file') {
    const data = result as { content?: string; error?: string }
    if (data?.error) return { id, kind: 'document', title: 'Document', body: String(data.error) }
    const content = data?.content || ''
    return {
      id,
      kind: 'document',
      title: 'Document',
      body: content.slice(0, 12000) + (content.length > 12000 ? '\n\n…(truncated)' : ''),
    }
  }
  if (tool === 'list_files') {
    const data = result as { entries?: { name: string; kind: string; size?: number }[]; note?: string; error?: string }
    if (data?.error) return { id, kind: 'listing', title: 'Files', body: String(data.error) }
    const lines = (data?.entries || []).map(e =>
      e.kind === 'directory' ? `📁 ${e.name}/` : `📄 ${e.name}${e.size != null ? ` (${e.size} B)` : ''}`,
    )
    return {
      id,
      kind: 'listing',
      title: 'File listing',
      body: lines.length ? lines.join('\n') : (data?.note || 'Empty'),
    }
  }
  if (tool === 'memory_read' || tool === 'memory_write') return null
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
  return { id, kind: 'trace', title: tool, body: text.slice(0, 2000) }
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
  const [conversationOn, setConversationOn] = useState(true)
  const [speechOk, setSpeechOk] = useState(true)
  const [folderConnected, setFolderConnected] = useState(false)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [grantedFiles, setGrantedFiles] = useState<string[]>([])
  const [filesOpen, setFilesOpen] = useState(false)
  const [accessReady, setAccessReady] = useState(false)
  const [accessSkipped, setAccessSkipped] = useState(false)
  const [quietInput, setQuietInput] = useState('')
  const [pendingTool, setPendingTool] = useState<string | null>(null)

  const resultsRef = useRef<HTMLDivElement>(null)
  const listenerRef = useRef<ReturnType<typeof createListener>>(null)
  const speakerRef = useRef<StreamingSpeaker | null>(null)
  const conversationOnRef = useRef(true)
  const streamingRef = useRef(false)
  const askRef = useRef<(q: string) => Promise<void>>(async () => {})
  const lastToolRef = useRef<{ tool: string; args: Record<string, unknown> } | null>(null)

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
    if (resultsRef.current) {
      resultsRef.current.scrollTop = resultsRef.current.scrollHeight
    }
  }, [exchanges, streaming, status])

  async function refreshFileAccess() {
    let has = false
    if (isFileAccessSupported()) {
      const handle = await getConnectedFolder()
      setFolderConnected(!!handle)
      setFolderName(handle?.name ?? null)
      if (handle) has = true
    }
    if (isFilePickerSupported()) {
      const files = await getSelectedFiles()
      setGrantedFiles(files.map(f => f.name))
      if (files.length) has = true
    }
    setAccessReady(true)
    if (!has) {
      const skipped = typeof window !== 'undefined' && sessionStorage.getItem('h3ro_files_skipped') === '1'
      setAccessSkipped(skipped)
      if (!skipped) setFilesOpen(true)
    }
    return has
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
      const res = await fetch(API_URL + '/api/copilot/history?thread_id=' + threadId + '&limit=100', {
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
    setPendingTool(null)
    setVoiceState('processing')
    setExchanges(prev => [...prev, { q, a: '', ts: new Date(), sources: [] }])

    const speaker = new StreamingSpeaker({
      onSpeakingChange: (speaking) => {
        if (speaking) setVoiceState('speaking')
      },
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
        } else if (chunk.type === 'agent_tool_call') {
          lastToolRef.current = { tool: chunk.tool, args: chunk.args || {} }
          setPendingTool(chunk.tool)
          if (chunk.tool === 'web_search') {
            setStatus(`Searching · ${String(chunk.args?.query || '…')}`)
          } else if (chunk.tool === 'read_file') {
            setStatus(`Reading · ${String(chunk.args?.path || 'file')}`)
          } else if (chunk.tool === 'list_files') {
            setStatus('Listing files…')
          } else {
            setStatus(`Working · ${chunk.tool}`)
          }
        } else if (chunk.type === 'tool_request') {
          if (chunk.tool === 'list_files' || chunk.tool === 'read_file') {
            handleFileToolRequest(chunk)
          }
        } else if (chunk.type === 'agent_observation') {
          setPendingTool(null)
          const card = formatObservation(chunk.tool, chunk.result)
          if (card) {
            if (chunk.tool === 'read_file' && lastToolRef.current?.tool === 'read_file') {
              const path = String(lastToolRef.current.args.path || 'Document')
              card.title = `Document · ${path}`
            }
            setExchanges(prev => {
              const c = [...prev]
              const last = c[c.length - 1]
              c[c.length - 1] = { ...last, sources: [...(last.sources || []), card] }
              return c
            })
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
        } else if (chunk.type === 'agent_final' && chunk.answer) {
          speaker.push(chunk.answer)
          setExchanges(prev => {
            const c = [...prev]
            if (!c[c.length - 1].a) c[c.length - 1] = { ...c[c.length - 1], a: chunk.answer }
            return c
          })
        } else if (chunk.type === 'agent_stopped') {
          const partial = chunk.partial_answer || ''
          if (partial) {
            speaker.push(partial)
            setExchanges(prev => {
              const c = [...prev]
              c[c.length - 1] = { ...c[c.length - 1], a: c[c.length - 1].a || partial }
              return c
            })
          }
        }
      }
      speaker.finish()
    } catch (e: unknown) {
      speaker.cancel()
      setVoiceState('idle')
      if (e instanceof LimitExceededError) {
        setExchanges(prev => {
          const c = [...prev]
          c[c.length - 1] = { ...c[c.length - 1], limitExceeded: true }
          return c
        })
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error')
      }
    } finally {
      setStreaming(false)
      setStatus('')
      setPendingTool(null)
    }
  }

  askRef.current = ask

  async function grantFiles() {
    try {
      const files = await selectFiles()
      setGrantedFiles(files.map(f => f.name))
      setAccessSkipped(false)
      sessionStorage.removeItem('h3ro_files_skipped')
      setFilesOpen(true)
    } catch { /* cancelled */ }
  }

  async function grantFolder() {
    try {
      const handle = await connectFolder()
      setFolderConnected(true)
      setFolderName(handle.name)
      setAccessSkipped(false)
      sessionStorage.removeItem('h3ro_files_skipped')
      setFilesOpen(true)
      return true
    } catch {
      return false
    }
  }

  function skipFileAccess() {
    setAccessSkipped(true)
    sessionStorage.setItem('h3ro_files_skipped', '1')
    setFilesOpen(false)
  }

  async function revokeAllFiles() {
    await clearSelectedFiles()
    await disconnectFolder()
    setGrantedFiles([])
    setFolderConnected(false)
    setFolderName(null)
  }

  async function handleOrbActivate() {
    if (voiceState === 'listening') {
      stopListening()
      return
    }
    if (voiceState === 'speaking') {
      speakerRef.current?.cancel()
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
      setVoiceState('idle')
      return
    }
    if (streaming) return

    const has = folderConnected || grantedFiles.length > 0
    if (!has && !accessSkipped && (isFileAccessSupported() || isFilePickerSupported())) {
      setFilesOpen(true)
      if (isFileAccessSupported()) await grantFolder()
      else if (isFilePickerSupported()) await grantFiles()
    }
    startListening()
  }

  function clearSession() {
    setExchanges([])
    setActiveThread(null)
  }

  const stateLabel =
    voiceState === 'listening' ? 'Listening…'
    : voiceState === 'processing' ? (status || 'Thinking…')
    : voiceState === 'speaking' ? 'Speaking…'
    : conversationOn ? 'Tap to talk' : 'Ready'

  const hasAccess = folderConnected || grantedFiles.length > 0
  const needsAccessPrompt = accessReady && !hasAccess && !accessSkipped && (isFileAccessSupported() || isFilePickerSupported())
  const hasResults = exchanges.length > 0

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      minHeight: 0,
      flexDirection: 'column',
      overflow: 'hidden',
      padding: '0 0 8px',
      gap: 10,
    }}>
      {/* Shared top chrome */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 4px 4px',
        flexShrink: 0,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 15,
            letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-ink)',
          }}>
            <H3roMark size={15} />
          </div>
          <div style={{
            fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--color-n400)',
            letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2,
          }}>
            Collaborating cofound3r · pronounced hero
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setConversationOn(v => !v)} style={chipStyle(conversationOn)} title="Keep listening after speaking">
            {conversationOn ? '● Live' : '○ Live'}
          </button>
          <button onClick={() => setFilesOpen(v => !v)} style={chipStyle(hasAccess || filesOpen || needsAccessPrompt)}>
            {hasAccess ? `● Files` : '○ Grant files'}
          </button>
          <select
            value={activeThread || ''}
            onChange={e => {
              if (e.target.value) loadThread(e.target.value)
              else clearSession()
            }}
            style={{
              fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, padding: '5px 8px',
              borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--color-ink)',
            }}
          >
            <option value="">New conversation</option>
            {threads.map(t => (
              <option key={t.id} value={t.id}>{t.title || 'Untitled'}</option>
            ))}
          </select>
          <button onClick={clearSession} style={chipStyle(false)}>Clear</button>
        </div>
      </div>

      {(filesOpen || needsAccessPrompt) && (
        <div className="liquid-glass-strong" style={{
          padding: '12px 16px', borderRadius: 14, flexShrink: 0,
          background: needsAccessPrompt ? 'rgba(159,222,250,0.12)' : undefined,
        }}>
          <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            {needsAccessPrompt ? 'H3RO needs browser access to your files' : 'H3RO file access'}
          </div>
          <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-n600)', marginBottom: 10, maxWidth: 640 }}>
            Grant a folder or files so he can pull context — search results and documents appear on the right.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {isFileAccessSupported() && (
              <button onClick={grantFolder} className="btn btn-primary btn-sm">
                {folderConnected ? `Folder: ${folderName}` : 'Allow folder access'}
              </button>
            )}
            {isFilePickerSupported() && (
              <button onClick={grantFiles} className="btn btn-sm" style={secondaryBtn}>Select files</button>
            )}
            {needsAccessPrompt && (
              <button onClick={skipFileAccess} className="btn btn-sm" style={secondaryBtn}>Continue without files</button>
            )}
            {hasAccess && (
              <button onClick={revokeAllFiles} className="btn btn-sm" style={secondaryBtn}>Revoke all</button>
            )}
          </div>
          {grantedFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {grantedFiles.map(name => (
                <span key={name} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                  borderRadius: 8, border: '1px solid var(--border)',
                  fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11,
                }}>
                  {name}
                  <button
                    onClick={async () => {
                      await removeSelectedFile(name)
                      setGrantedFiles(prev => prev.filter(n => n !== name))
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-n400)', padding: 0 }}
                  >×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Split screen */}
      <div className="h3ro-split" style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 1fr) minmax(320px, 1fr)',
        gap: 10,
      }}>
        {/* LEFT — visual + voice */}
        <div
          className="liquid-glass-strong"
          style={{
            borderRadius: 18,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background:
              'radial-gradient(ellipse 80% 55% at 50% 40%, rgba(159,222,250,0.16) 0%, transparent 58%), var(--glass-bg, rgba(255,255,255,0.06))',
          }}
        >
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '28px 20px 16px',
            minHeight: 0,
          }}>
            <H3roJarvisOrb
              state={voiceState}
              size={200}
              disabled={streaming && voiceState === 'processing'}
              aria-label={voiceState === 'listening' ? 'Stop listening' : 'Talk to H3RO'}
              onClick={handleOrbActivate}
            />
            <div style={{
              marginTop: 18,
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 12,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: voiceState === 'idle' ? 'var(--color-n400)' : 'var(--color-arc-cyan)',
            }}>
              {stateLabel}
            </div>
            {(interim || (!hasResults && voiceState === 'idle')) && (
              <div style={{
                marginTop: 12, maxWidth: 320, textAlign: 'center',
                fontFamily: 'var(--font-archivo)', fontSize: 14, lineHeight: 1.5,
                color: interim ? 'var(--color-ink)' : 'var(--color-n600)',
                fontStyle: interim ? 'normal' : 'italic',
              }}>
                {interim || 'Talk on the left. Answers, searches, and documents land on the right.'}
              </div>
            )}
            {!hasResults && voiceState === 'idle' && !interim && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 20, width: '100%', maxWidth: 300 }}>
                {STARTERS.map(s => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    style={{
                      padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.08)', cursor: 'pointer', textAlign: 'left',
                      fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-ink)',
                    }}
                  >
                    <span style={{ color: 'var(--color-arc-cyan)', marginRight: 6 }}>→</span>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {error && (
              <div style={{ marginTop: 12, color: 'var(--color-signal)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, textAlign: 'center' }}>
                {error}
              </div>
            )}
            {!speechOk && (
              <div style={{ marginTop: 8, fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n600)' }}>
                Voice unavailable — type below
              </div>
            )}
          </div>

          <div style={{
            padding: '10px 14px 14px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-end',
              background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '8px 10px',
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
                placeholder="Or type quietly…"
                rows={1}
                style={{
                  flex: 1, border: 'none', background: 'transparent', resize: 'none',
                  fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-ink)',
                  outline: 'none', minHeight: 28,
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
          </div>
        </div>

        {/* RIGHT — text / search / document output */}
        <div
          className="liquid-glass-strong"
          style={{
            borderRadius: 18,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexShrink: 0,
          }}>
            <div style={{
              fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--color-n600)',
            }}>
              Results
            </div>
            {(status || pendingTool) && (
              <div style={{
                marginLeft: 'auto',
                fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10,
                color: 'var(--color-arc-cyan)', letterSpacing: '0.06em',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'var(--color-arc-cyan)',
                  animation: 'h3ros-pulse-opacity 1.2s ease-in-out infinite',
                }} />
                {status || pendingTool}
              </div>
            )}
          </div>

          <div ref={resultsRef} style={{ flex: 1, overflow: 'auto', padding: '16px 18px' }}>
            {!hasResults && (
              <div style={{
                height: '100%', minHeight: 200, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                color: 'var(--color-n400)', fontFamily: 'var(--font-archivo)', fontSize: 14, lineHeight: 1.55, padding: 24,
              }}>
                <div style={{ marginBottom: 8, opacity: 0.7 }}><H3roMark size={18} /></div>
                Answers, web searches, and documents he finds will appear here.
              </div>
            )}

            {exchanges.map((ex, i) => {
              const isLast = i === exchanges.length - 1
              const turnSources = ex.sources || []
              return (
                <div key={i} style={{ marginBottom: 28 }}>
                  <div style={{
                    fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n400)',
                    letterSpacing: '0.08em', marginBottom: 6,
                  }}>YOU</div>
                  <div style={{
                    fontFamily: 'var(--font-archivo)', fontSize: 14, color: 'var(--color-ink)',
                    marginBottom: 14, lineHeight: 1.55,
                  }}>{ex.q}</div>

                  {turnSources.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                      {turnSources.map(card => (
                        <SourcePanel key={card.id} card={card} />
                      ))}
                    </div>
                  )}

                  <div style={{
                    fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-arc-cyan)',
                    letterSpacing: '0.08em', marginBottom: 6,
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
                    <div style={{
                      fontFamily: 'var(--font-archivo)', fontSize: 14, lineHeight: 1.7, color: 'var(--color-ink)',
                    }}>
                      <Markdown content={ex.a} streaming={streaming && isLast} />
                    </div>
                  ) : streaming && isLast ? (
                    <span style={{ color: 'var(--color-n400)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12 }}>
                      {status || 'Thinking…'}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .h3ro-split {
            grid-template-columns: 1fr !important;
            grid-template-rows: minmax(280px, 42vh) minmax(240px, 1fr);
          }
        }
      `}</style>
    </div>
  )
}

function SourcePanel({ card }: { card: SourceCard }) {
  const kindLabel =
    card.kind === 'search' ? 'WEB SEARCH'
    : card.kind === 'document' ? 'DOCUMENT'
    : card.kind === 'listing' ? 'FILES'
    : 'SOURCE'

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.06)',
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, letterSpacing: '0.1em',
          color: 'var(--color-arc-cyan)', textTransform: 'uppercase',
        }}>{kindLabel}</span>
        <span style={{
          fontFamily: 'var(--font-archivo)', fontSize: 12, fontWeight: 700,
          color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{card.title}</span>
      </div>
      <div style={{ padding: '12px 14px' }}>
        {card.links && card.links.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {card.links.map((l, i) => (
              <div key={i}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: 'var(--font-archivo)', fontSize: 13, fontWeight: 700,
                    color: 'var(--color-arc-cyan)', textDecoration: 'none',
                  }}
                >
                  {l.title}
                </a>
                {l.snippet && (
                  <div style={{
                    marginTop: 4, fontFamily: 'var(--font-archivo)', fontSize: 12,
                    color: 'var(--color-n600)', lineHeight: 1.5,
                  }}>
                    {l.snippet.slice(0, 280)}{l.snippet.length > 280 ? '…' : ''}
                  </div>
                )}
                <div style={{
                  marginTop: 2, fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9,
                  color: 'var(--color-n400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {l.url}
                </div>
              </div>
            ))}
          </div>
        ) : card.kind === 'document' || card.kind === 'listing' ? (
          <pre style={{
            margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontFamily: card.kind === 'listing' ? 'var(--font-ibm-plex-mono)' : 'var(--font-archivo)',
            fontSize: card.kind === 'listing' ? 11 : 13,
            lineHeight: 1.55, color: 'var(--color-ink)',
          }}>
            {card.body}
          </pre>
        ) : (
          <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-n600)' }}>
            {card.body}
          </div>
        )}
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
