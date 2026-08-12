'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { streamWS, LimitExceededError, submitToolResult } from '@/lib/streaming'
import Markdown from '@/components/ui/Markdown'
import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'
import H3roMark from '@/components/brand/H3roMark'
import H3roJarvisOrb from '@/components/h3ro/H3roJarvisOrb'
import {
  warmVoices,
  createListener,
  StreamingSpeaker,
  isSpeechRecognitionSupported,
  extractWakeCommand,
  readAlwaysListeningPreference,
  writeAlwaysListeningPreference,
  type VoiceState,
} from '@/lib/voice'
import {
  isFileAccessSupported,
  isFilePickerSupported,
  grantFullAccess,
  disconnectFolder,
  getConnectedFolder,
  selectFiles,
  getSelectedFiles,
  clearSelectedFiles,
  removeSelectedFile,
  handleFileToolRequest,
} from '@/lib/fileAccess'
import { runSystemAction } from '@/lib/systemActions'

type SourceCard = {
  id: string
  kind: 'search' | 'document' | 'listing' | 'trace'
  title: string
  body: string
  links?: { title: string; url: string; snippet?: string }[]
}

type Exchange = {
  q: string
  a: string
  ts: Date
  model?: string
  limitExceeded?: boolean
  sources?: SourceCard[]
}

type Thread = { id: string; title: string; created_at: string }

type ComposerAttachment = {
  id: string
  name: string
  size: number
  kind: 'text' | 'image' | 'other'
  text?: string
}

const TEXT_EXT = /\.(txt|md|csv|json|ts|tsx|js|jsx|py|html|css|xml|yml|yaml|toml|log|rs|go|java|c|cpp|h|sql)$/i
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic)$/i

async function readAttachment(file: File): Promise<ComposerAttachment> {
  const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 6)}`
  if (IMAGE_EXT.test(file.name) || file.type.startsWith('image/')) {
    return { id, name: file.name, size: file.size, kind: 'image' }
  }
  if (TEXT_EXT.test(file.name) || file.type.startsWith('text/') || file.type === 'application/json') {
    const text = await file.text()
    return {
      id,
      name: file.name,
      size: file.size,
      kind: 'text',
      text: text.slice(0, 80_000) + (text.length > 80_000 ? '\n\n…(truncated)' : ''),
    }
  }
  // Best-effort text for unknown types
  try {
    const text = await file.text()
    if (text && !text.includes('\u0000')) {
      return {
        id, name: file.name, size: file.size, kind: 'text',
        text: text.slice(0, 40_000) + (text.length > 40_000 ? '\n\n…(truncated)' : ''),
      }
    }
  } catch { /* binary */ }
  return { id, name: file.name, size: file.size, kind: 'other' }
}

function buildMessageWithAttachments(q: string, attachments: ComposerAttachment[]): string {
  if (!attachments.length) return q
  const blocks = attachments.map(a => {
    if (a.kind === 'text' && a.text) {
      return `[Attached file: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``
    }
    if (a.kind === 'image') {
      return `[Attached image: ${a.name} — screenshot/image attached in chat. Describe what you need; or grant Select files / Full access so I can read related files on disk.]`
    }
    return `[Attached file: ${a.name} (${a.size} bytes) — binary; grant file access if you need me to inspect it on disk.]`
  })
  return `${q.trim()}\n\n${blocks.join('\n\n')}`
}

const CHAT_REFS_KEY = 'h3ro_chat_refs'

function rememberChatRefs(attachments: ComposerAttachment[]) {
  if (typeof window === 'undefined' || !attachments.length) return
  try {
    const prev: { name: string; kind: string; at: string }[] = JSON.parse(localStorage.getItem(CHAT_REFS_KEY) || '[]')
    const next = [
      ...attachments.map(a => ({ name: a.name, kind: a.kind, at: new Date().toISOString() })),
      ...prev,
    ].slice(0, 40)
    // de-dupe by name keeping newest
    const seen = new Set<string>()
    const deduped: typeof next = []
    for (const r of next) {
      if (seen.has(r.name)) continue
      seen.add(r.name)
      deduped.push(r)
    }
    localStorage.setItem(CHAT_REFS_KEY, JSON.stringify(deduped.slice(0, 30)))
  } catch { /* ignore */ }
}

function recentChatRefsBlock(): string {
  if (typeof window === 'undefined') return ''
  try {
    const refs: { name: string; kind: string }[] = JSON.parse(localStorage.getItem(CHAT_REFS_KEY) || '[]')
    if (!refs.length) return ''
    const list = refs.slice(0, 12).map(r => `${r.name} (${r.kind})`).join(', ')
    return `\n\n[Prior uploads/references from earlier H3RO chats on this device: ${list}. Reuse by name when relevant; ask to re-attach only if content is missing.]`
  } catch {
    return ''
  }
}

const STARTERS = [
  'What should I focus on this week?',
  'Search the web for the latest AI funding news.',
  'What files do I have available?',
  'Help me prepare for an investor conversation.',
]

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
  const [alwaysListening, setAlwaysListening] = useState(false)
  const [speechOk, setSpeechOk] = useState(true)
  const [folderConnected, setFolderConnected] = useState(false)
  const [folderName, setFolderName] = useState<string | null>(null)
  const [grantedFiles, setGrantedFiles] = useState<string[]>([])
  const [filesOpen, setFilesOpen] = useState(false)
  const [accessReady, setAccessReady] = useState(false)
  const [accessSkipped, setAccessSkipped] = useState(false)
  const [quietInput, setQuietInput] = useState('')
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [pendingTool, setPendingTool] = useState<string | null>(null)
  const [memoryConfirm, setMemoryConfirm] = useState<{ callId: string; text: string; source: string } | null>(null)
  const [systemActionConfirm, setSystemActionConfirm] = useState<{
    callId: string
    action: string
    target?: string | null
    description: string
  } | null>(null)

  const resultsRef = useRef<HTMLDivElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const listenerRef = useRef<ReturnType<typeof createListener>>(null)
  const speakerRef = useRef<StreamingSpeaker | null>(null)
  const conversationOnRef = useRef(true)
  const alwaysListeningRef = useRef(false)
  const hotPausedRef = useRef(false)
  const streamingRef = useRef(false)
  const voiceStateRef = useRef<VoiceState>('idle')
  const askRef = useRef<(q: string) => Promise<void>>(async () => {})
  const lastToolRef = useRef<{ tool: string; args: Record<string, unknown> } | null>(null)
  const startHotMicRef = useRef<() => void>(() => {})
  // Monotonic session id for ask(). Bumping it (or starting a new ask)
  // invalidates any in-flight loop so barge-in can stop the old stream
  // without racing a shared boolean that the next ask() would clear.
  const askSessionRef = useRef(0)

  useEffect(() => { conversationOnRef.current = conversationOn }, [conversationOn])
  useEffect(() => { alwaysListeningRef.current = alwaysListening }, [alwaysListening])
  useEffect(() => { streamingRef.current = streaming }, [streaming])
  useEffect(() => { voiceStateRef.current = voiceState }, [voiceState])

  useEffect(() => {
    warmVoices()
    setSpeechOk(isSpeechRecognitionSupported())
    setAlwaysListening(readAlwaysListeningPreference())
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

  /** Pause STT intentionally (no auto-restart) — used while TTS speaks / processing. */
  const pauseRecognition = useCallback(() => {
    listenerRef.current?.abort()
    listenerRef.current = null
  }, [])

  const startHotMic = useCallback(() => {
    if (!alwaysListeningRef.current) return
    if (hotPausedRef.current) return
    // Deliberately NOT gated on streamingRef/processing/speaking — this is
    // what lets a "hey h3ro" / "h3ro" barge-in interrupt a response already
    // in flight, rather than only ever arming once H3RO falls fully idle.

    pauseRecognition()
    setInterim('')

    // Prevent the same utterance from firing once on interim and again on final.
    let wakeLockUntil = 0

    const handleWake = (text: string, source: 'interim' | 'final') => {
      if (Date.now() < wakeLockUntil) return
      const command = extractWakeCommand(text)
      // eslint-disable-next-line no-console
      console.log('[H3RO-DEBUG] on' + (source === 'interim' ? 'InterimWake' : 'Final'), {
        text,
        command,
        voiceState: voiceStateRef.current,
      })
      if (command === null) {
        if (source === 'final') setInterim('')
        return
      }
      setInterim('')
      const midResponse = voiceStateRef.current === 'processing' || voiceStateRef.current === 'speaking'
      // Interim barge-in only mid-response: while TTS/processing, finals often
      // stay deferred, so waiting for onFinal is too late to stop speech.
      if (source === 'interim' && !midResponse) return
      // eslint-disable-next-line no-console
      console.log('[H3RO-DEBUG] wake command matched', { command, midResponse, source })
      wakeLockUntil = Date.now() + 1500
      if (midResponse) {
        askSessionRef.current += 1
        streamingRef.current = false
        speakerRef.current?.cancel()
        if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
        setStreaming(false)
      } else if (streamingRef.current) {
        return
      }
      if (!command) {
        setVoiceState('hot')
        return
      }
      // Keep this same listener alive in always-listening mode (that's
      // what makes barge-in possible on the response this triggers) --
      // pausing here was killing the mic before ask() even started.
      if (!alwaysListeningRef.current) pauseRecognition()
      setVoiceState('processing')
      askRef.current(command)
    }

    const listener = createListener(
      {
        onInterim: (t) => {
          // eslint-disable-next-line no-console
          console.log('[H3RO-DEBUG] onInterim', { text: t, voiceState: voiceStateRef.current })
          // Only surface interim once a wake fragment appears — avoid ambient chatter in UI.
          if (/\b(?:hey|hi|ok|okay|h3ro|hero|h\s*3)/i.test(t)) setInterim(t)
          else setInterim('')
          handleWake(t, 'interim')
        },
        onFinal: (text) => {
          handleWake(text, 'final')
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.log('[H3RO-DEBUG] onError', { err, voiceState: voiceStateRef.current, streaming: streamingRef.current })
          setInterim('')
          if (err === 'not-allowed') {
            setError('Microphone permission denied. Allow mic access for H3RO.')
            setAlwaysListening(false)
            writeAlwaysListeningPreference(false)
            setVoiceState('idle')
            return
          }
          if (err === 'unavailable') {
            // Repeated real failures (e.g. this build's speech engine can't
            // reach a recognition backend) — stop retrying instead of
            // spinning the mic indicator forever with no result.
            setError('Always listening isn’t available in this build — push-to-talk and typing still work.')
            setAlwaysListening(false)
            writeAlwaysListeningPreference(false)
            setVoiceState('idle')
            return
          }
          // Stay hot on routine errors; autoRestart will recover.
          if (alwaysListeningRef.current && !hotPausedRef.current && !streamingRef.current) {
            setVoiceState('hot')
          }
        },
        onEnd: () => {
          // eslint-disable-next-line no-console
          console.log('[H3RO-DEBUG] onEnd', { voiceState: voiceStateRef.current, streaming: streamingRef.current })
          setInterim('')
          // autoRestart keeps the session; only drop visual if mode was turned off.
          if (!alwaysListeningRef.current && !streamingRef.current) {
            setVoiceState((s) => (s === 'hot' ? 'idle' : s))
          }
        },
      },
      { continuous: true, autoRestart: true },
    )
    if (!listener) {
      setSpeechOk(false)
      return
    }
    listenerRef.current = listener
    setError('')
    setVoiceState('hot')
    listener.start()
  }, [pauseRecognition])

  useEffect(() => {
    startHotMicRef.current = startHotMic
  }, [startHotMic])

  const startListening = useCallback(() => {
    if (streamingRef.current) return
    // Push-to-talk must not run while always-listening owns the mic loop.
    if (alwaysListeningRef.current) {
      hotPausedRef.current = false
      startHotMicRef.current()
      return
    }
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
    listenerRef.current = null
    setVoiceState((s) => (s === 'listening' || s === 'hot' ? 'idle' : s))
  }, [])

  function setAlwaysListeningOn(on: boolean) {
    if (on && !isSpeechRecognitionSupported()) {
      setSpeechOk(false)
      return
    }
    setAlwaysListening(on)
    writeAlwaysListeningPreference(on)
    if (!on) {
      hotPausedRef.current = false
      pauseRecognition()
      setInterim('')
      setVoiceState((s) => (s === 'hot' ? 'idle' : s))
    } else {
      hotPausedRef.current = false
      alwaysListeningRef.current = true
      if (!streamingRef.current && voiceStateRef.current !== 'speaking' && voiceStateRef.current !== 'processing') {
        setTimeout(() => startHotMicRef.current(), 0)
      }
    }
  }

  // Keep hot mic running when preference is on and we return to idle (not user-paused).
  useEffect(() => {
    if (!alwaysListening || !speechOk) return
    if (hotPausedRef.current) return
    if (streaming || voiceState === 'speaking' || voiceState === 'processing' || voiceState === 'listening') return
    if (voiceState === 'hot') return
    if (voiceState === 'idle') {
      const t = setTimeout(() => {
        if (
          alwaysListeningRef.current
          && !hotPausedRef.current
          && !streamingRef.current
          && voiceStateRef.current === 'idle'
        ) {
          startHotMicRef.current()
        }
      }, 300)
      return () => clearTimeout(t)
    }
  }, [alwaysListening, speechOk, streaming, voiceState])

  async function ask(q: string, attachOverride?: ComposerAttachment[]) {
    const attach = attachOverride ?? attachments
    let payload = buildMessageWithAttachments(q, attach)
    if (!activeThread) {
      payload = `${payload}${recentChatRefsBlock()}`
    }
    if (!payload.trim() || streamingRef.current) return
    if (attach.length) rememberChatRefs(attach)
    const session = ++askSessionRef.current
    setError('')
    setStreaming(true)
    setStatus('')
    setPendingTool(null)
    setMemoryConfirm(null)
    setSystemActionConfirm(null)
    // Don't hear ourselves during push-to-talk/regular listening — but in
    // always-listening mode, keep the hot mic live through processing and
    // speaking so a "hey h3ro" / "h3ro" barge-in can interrupt mid-response.
    if (!alwaysListeningRef.current) pauseRecognition()
    setVoiceState('processing')
    setAttachments([])
    setExchanges(prev => [...prev, {
      q: attach.length ? `${q}${attach.length ? ` · ${attach.length} attachment${attach.length === 1 ? '' : 's'}` : ''}` : q,
      a: '',
      ts: new Date(),
      sources: [],
    }])

    const speaker = new StreamingSpeaker({
      onSpeakingChange: (speaking) => {
        if (askSessionRef.current !== session) return
        if (speaking) {
          if (!alwaysListeningRef.current) pauseRecognition()
          setVoiceState('speaking')
        }
      },
      onIdle: () => {
        if (askSessionRef.current !== session) return
        setVoiceState('idle')
        if (alwaysListeningRef.current) {
          setTimeout(() => {
            if (!streamingRef.current && alwaysListeningRef.current) startHotMicRef.current()
          }, 450)
        } else if (conversationOnRef.current) {
          setTimeout(() => {
            if (!streamingRef.current && conversationOnRef.current && !alwaysListeningRef.current) startListening()
          }, 400)
        }
      },
    })
    speakerRef.current = speaker

    try {
      for await (const chunk of streamWS('/api/copilot/message', {
        message: payload,
        thread_id: activeThread,
        agent_mode: true,
      })) {
        if (askSessionRef.current !== session) break
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
          } else if (chunk.tool === 'memory_write') {
            setStatus('Saving to memory…')
          } else if (chunk.tool === 'system_action') {
            setStatus('Waiting for approval…')
          } else {
            setStatus(`Working · ${chunk.tool}`)
          }
        } else if (chunk.type === 'agent_confirm_write') {
          setMemoryConfirm({
            callId: chunk.call_id,
            text: chunk.text || '',
            source: chunk.source || 'agent_inferred',
          })
          setStatus('Confirm memory save…')
        } else if (chunk.type === 'agent_confirm_system_action') {
          setSystemActionConfirm({
            callId: chunk.call_id,
            action: chunk.action,
            target: chunk.target,
            description: chunk.description || chunk.action,
          })
          setStatus('Confirm system action…')
        } else if (chunk.type === 'tool_request') {
          if (chunk.tool === 'list_files' || chunk.tool === 'read_file') {
            handleFileToolRequest(chunk)
          }
        } else if (chunk.type === 'agent_observation') {
          setPendingTool(null)
          if (chunk.tool === 'memory_write') setMemoryConfirm(null)
          if (chunk.tool === 'system_action') setSystemActionConfirm(null)
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
      if (askSessionRef.current === session) speaker.finish()
      else speaker.cancel()
    } catch (e: unknown) {
      speaker.cancel()
      if (askSessionRef.current === session) {
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
      }
    } finally {
      // Only the active session clears streaming — a superseded ask must not
      // clobber a barge-in replacement that already set streaming true.
      if (askSessionRef.current === session) {
        setStreaming(false)
        setStatus('')
        setPendingTool(null)
        setMemoryConfirm(null)
        setSystemActionConfirm(null)
      }
    }
  }

  askRef.current = ask

  async function confirmMemoryWrite(approved: boolean) {
    if (!memoryConfirm) return
    const callId = memoryConfirm.callId
    setMemoryConfirm(null)
    setStatus(approved ? 'Saving…' : 'Skipped memory save')
    await submitToolResult(callId, { approved })
  }

  async function confirmSystemAction(approved: boolean) {
    if (!systemActionConfirm) return
    const { callId, action, target } = systemActionConfirm
    setSystemActionConfirm(null)
    if (!approved) {
      setStatus('Action declined')
      await submitToolResult(callId, { approved: false, success: false, detail: 'user declined' })
      return
    }
    setStatus('Running action…')
    const result = await runSystemAction(action, target)
    await submitToolResult(callId, {
      approved: true,
      success: result.success,
      detail: result.detail,
    })
    setStatus(result.success ? result.detail : `Failed · ${result.detail}`)
  }

  async function grantFiles() {
    try {
      const files = await selectFiles()
      setGrantedFiles(files.map(f => f.name))
      setAccessSkipped(false)
      sessionStorage.removeItem('h3ro_files_skipped')
      setFilesOpen(false)
    } catch { /* cancelled */ }
  }

  async function grantFull() {
    try {
      const handle = await grantFullAccess()
      setFolderConnected(true)
      setFolderName(handle.name)
      setAccessSkipped(false)
      sessionStorage.removeItem('h3ro_files_skipped')
      setFilesOpen(false)
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

  async function onComposerAttach(files: FileList | null) {
    if (!files?.length) return
    const next: ComposerAttachment[] = []
    for (const file of Array.from(files)) {
      next.push(await readAttachment(file))
    }
    setAttachments(prev => [...prev, ...next])
    if (attachInputRef.current) attachInputRef.current.value = ''
  }

  async function handleOrbActivate() {
    if (alwaysListening) {
      if (voiceState === 'hot') {
        // Pause hot mic until user taps again (does not turn the preference off).
        hotPausedRef.current = true
        pauseRecognition()
        setVoiceState('idle')
        return
      }
      if (voiceState === 'speaking' || voiceState === 'processing') {
        askSessionRef.current += 1
        streamingRef.current = false
        speakerRef.current?.cancel()
        if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
        setStreaming(false)
        setVoiceState('idle')
        return
      }
      if (streaming) return
      const has = folderConnected || grantedFiles.length > 0
      if (!has && !accessSkipped && (isFileAccessSupported() || isFilePickerSupported())) {
        setFilesOpen(true)
        return
      }
      hotPausedRef.current = false
      startHotMic()
      return
    }

    if (voiceState === 'listening') {
      stopListening()
      return
    }
    if (voiceState === 'speaking' || voiceState === 'processing') {
      askSessionRef.current += 1
      streamingRef.current = false
      speakerRef.current?.cancel()
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
      setStreaming(false)
      setVoiceState('idle')
      return
    }
    if (streaming) return

    const has = folderConnected || grantedFiles.length > 0
    if (!has && !accessSkipped && (isFileAccessSupported() || isFilePickerSupported())) {
      setFilesOpen(true)
      return
    }
    startListening()
  }

  function clearSession() {
    setExchanges([])
    setActiveThread(null)
  }

  const stateLabel =
    voiceState === 'hot' ? 'Mic on · say “Hey H3RO”'
    : voiceState === 'listening' ? 'Listening…'
    : voiceState === 'processing' ? (status || 'Thinking…')
    : voiceState === 'speaking' ? 'Speaking…'
    : alwaysListening ? 'Always listening paused · tap to arm'
    : conversationOn ? 'Tap to talk' : 'Ready'

  const labelColor =
    voiceState === 'hot' ? '#C47A1A'
    : voiceState === 'idle' ? 'var(--color-n400)'
    : 'var(--color-arc-cyan)'

  const orbAria =
    voiceState === 'hot' ? 'Pause always listening'
    : voiceState === 'listening' ? 'Stop listening'
    : alwaysListening ? 'Resume always listening'
    : 'Talk to H3RO'

  const hasAccess = folderConnected || grantedFiles.length > 0
  const needsAccessPrompt = accessReady && !hasAccess && !accessSkipped
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
            Collaborating cofound3r · remembers prior chats · pronounced hero
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {speechOk && (
            <button
              onClick={() => setAlwaysListeningOn(!alwaysListening)}
              style={chipStyle(alwaysListening, alwaysListening ? '#C47A1A' : undefined)}
              title="Keep the mic open and respond only after “Hey H3RO” / “Hey hero”. Off by default."
            >
              {alwaysListening ? '● Always' : '○ Always'}
            </button>
          )}
          <button onClick={() => setConversationOn(v => !v)} style={chipStyle(conversationOn)} title="Keep listening after speaking (push-to-talk follow-up)">
            {conversationOn ? '● Live' : '○ Live'}
          </button>
          <button onClick={() => setFilesOpen(v => !v)} style={chipStyle(hasAccess || filesOpen || needsAccessPrompt)}>
            {folderConnected ? '● Full access' : grantedFiles.length ? `● ${grantedFiles.length} files` : '○ File access'}
          </button>
          <button
            onClick={() => router.push('/settings')}
            style={chipStyle(false)}
            title="Adjust file access in Settings"
          >
            Settings
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
          padding: '16px 18px', borderRadius: 14, flexShrink: 0,
          background: needsAccessPrompt ? 'rgba(159,222,250,0.12)' : undefined,
        }}>
          <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            How should H3RO access your files?
          </div>
          <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-n600)', marginBottom: 14, maxWidth: 720, lineHeight: 1.45 }}>
            Browsers require you to grant access. Choose one — change anytime here or in Settings → H3RO file access.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <AccessCard
              title="Continue without files"
              desc="Attach docs or screenshots in the type box when you need them — like Cursor or Claude."
              primary
              onClick={() => {
                skipFileAccess()
                // nudge focus to composer
                setTimeout(() => attachInputRef.current?.focus(), 0)
              }}
            />
            {(isFilePickerSupported() || typeof window !== 'undefined') && (
              <AccessCard
                title="Select files"
                desc="Pick specific files or screenshots from Finder / File Explorer."
                onClick={async () => {
                  if (isFilePickerSupported()) await grantFiles()
                  else {
                    // Fallback: open hidden input for browsers without showOpenFilePicker
                    attachInputRef.current?.click()
                    skipFileAccess()
                  }
                }}
              />
            )}
            {isFileAccessSupported() && (
              <AccessCard
                title="Full access"
                desc="Grant a top-level folder (your user folder, Desktop, or Documents) so H3RO can browse Downloads, Desktop, Screenshots, and everything inside."
                onClick={() => grantFull()}
              />
            )}
          </div>
          {hasAccess && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {folderConnected && (
                <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'var(--color-arc-cyan)' }}>
                  ● Full access · {folderName}
                </span>
              )}
              {grantedFiles.length > 0 && (
                <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'var(--color-arc-cyan)' }}>
                  ● {grantedFiles.length} selected file{grantedFiles.length === 1 ? '' : 's'}
                </span>
              )}
              <button onClick={revokeAllFiles} className="btn btn-sm" style={secondaryBtn}>Revoke</button>
            </div>
          )}
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

      {memoryConfirm && (
        <div className="liquid-glass-strong" style={{
          padding: '14px 16px', borderRadius: 14, flexShrink: 0,
          border: '1px solid var(--color-arc-cyan)',
        }}>
          <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            Save to durable memory?
          </div>
          <div style={{
            fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-n600)',
            marginBottom: 10, lineHeight: 1.45,
          }}>
            {memoryConfirm.text}
            <span style={{ display: 'block', marginTop: 4, fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, opacity: 0.7 }}>
              source · {memoryConfirm.source}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => confirmMemoryWrite(true)} style={{
              background: 'var(--color-arc-cyan)', color: 'var(--color-ink)', border: 'none',
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12,
            }}>
              Save
            </button>
            <button type="button" onClick={() => confirmMemoryWrite(false)} style={{
              background: 'transparent', border: '1px solid var(--border)',
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            }}>
              Skip
            </button>
          </div>
        </div>
      )}

      {systemActionConfirm && (
        <div className="liquid-glass-strong" style={{
          padding: '14px 16px', borderRadius: 14, flexShrink: 0,
          border: '1px solid #C47A1A',
        }}>
          <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            H3RO wants to run a system action
          </div>
          <div style={{
            fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-n600)',
            marginBottom: 10, lineHeight: 1.45,
          }}>
            {systemActionConfirm.description}
            <span style={{ display: 'block', marginTop: 4, fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, opacity: 0.7 }}>
              {systemActionConfirm.action}
              {systemActionConfirm.target ? ` · ${systemActionConfirm.target}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => confirmSystemAction(true)} style={{
              background: '#C47A1A', color: '#fff', border: 'none',
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 12,
            }}>
              Allow
            </button>
            <button type="button" onClick={() => confirmSystemAction(false)} style={{
              background: 'transparent', border: '1px solid var(--border)',
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            }}>
              Deny
            </button>
          </div>
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
              // Must stay clickable during 'processing'/'speaking' so the
              // founder can interrupt — handleOrbActivate branches on
              // voiceState itself and no-ops for any other stray state.
              aria-label={orbAria}
              onClick={handleOrbActivate}
            />
            <div style={{
              marginTop: 18,
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 12,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: labelColor,
            }}>
              {stateLabel}
            </div>
            {(interim || (!hasResults && (voiceState === 'idle' || voiceState === 'hot'))) && (
              <div style={{
                marginTop: 12, maxWidth: 320, textAlign: 'center',
                fontFamily: 'var(--font-archivo)', fontSize: 14, lineHeight: 1.5,
                color: interim ? 'var(--color-ink)' : 'var(--color-n600)',
                fontStyle: interim ? 'normal' : 'italic',
              }}>
                {interim
                  || (voiceState === 'hot'
                    ? 'Listening for “Hey H3RO…” — nothing is sent without the wake word.'
                    : 'Talk on the left. Answers, searches, and documents land on the right.')}
              </div>
            )}
            {!hasResults && voiceState === 'idle' && !interim && !alwaysListening && (
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
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {attachments.map(a => (
                  <span key={a.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                    borderRadius: 8, border: '1px solid var(--border)',
                    fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-ink)',
                    background: 'rgba(255,255,255,0.08)',
                  }}>
                    {a.kind === 'image' ? '🖼' : '📄'} {a.name}
                    <button
                      onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-n400)', padding: 0, lineHeight: 1 }}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-end',
              background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '8px 10px',
            }}>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                accept="image/*,.txt,.md,.csv,.json,.pdf,.ts,.tsx,.js,.jsx,.py,.html,.css"
                style={{ display: 'none' }}
                onChange={e => onComposerAttach(e.target.files)}
              />
              <button
                type="button"
                onClick={() => attachInputRef.current?.click()}
                title="Attach files or screenshots"
                style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  width: 32, height: 32, cursor: 'pointer', color: 'var(--color-n600)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M8.5 4.5l-3.2 3.2a1.8 1.8 0 002.5 2.5l3.5-3.5a3 3 0 10-4.2-4.2L3.5 6.1a4 4 0 105.7 5.7l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
              <textarea
                value={quietInput}
                onChange={e => setQuietInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    const t = quietInput.trim()
                    if (t || attachments.length) {
                      setQuietInput('')
                      ask(t || 'Please review the attached files.')
                    }
                  }
                }}
                disabled={streaming}
                placeholder="Type or attach files…"
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
                  if (t || attachments.length) {
                    setQuietInput('')
                    ask(t || 'Please review the attached files.')
                  }
                }}
                disabled={streaming || (!quietInput.trim() && !attachments.length)}
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

function AccessCard({
  title,
  desc,
  onClick,
  primary,
}: {
  title: string
  desc: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '14px 14px',
        borderRadius: 12,
        border: primary ? '1px solid var(--color-arc-cyan)' : '1px solid var(--border)',
        background: primary ? 'var(--color-arc-soft)' : 'rgba(255,255,255,0.08)',
        cursor: 'pointer',
        color: 'var(--color-ink)',
      }}
    >
      <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-n600)', lineHeight: 1.45 }}>
        {desc}
      </div>
    </button>
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

function chipStyle(active: boolean, accent?: string): CSSProperties {
  return {
    padding: '5px 10px',
    border: active && accent ? `1px solid ${accent}` : '1px solid var(--border)',
    borderRadius: 8,
    background: active
      ? (accent ? 'rgba(232,165,75,0.16)' : 'var(--color-arc-soft)')
      : 'rgba(255,255,255,0.08)',
    cursor: 'pointer',
    fontFamily: 'var(--font-ibm-plex-mono)',
    fontSize: 10,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: active ? (accent || 'var(--color-arc-cyan)') : 'var(--color-n600)',
  }
}

const secondaryBtn: CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid var(--border)',
  color: 'var(--color-ink)',
}
