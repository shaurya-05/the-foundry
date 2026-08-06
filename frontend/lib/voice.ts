/**
 * H3RO voice layer — browser SpeechRecognition (STT) + SpeechSynthesis (TTS).
 * Prefers a British male en-GB voice (Jarvis-adjacent).
 */

export type VoiceState = 'idle' | 'hot' | 'listening' | 'processing' | 'speaking'

/** localStorage key for opt-in always-listening (wake-word) mode. Default off. */
export const ALWAYS_LISTENING_KEY = 'h3ro_always_listening'

/**
 * Wake phrases: "h3ro", "hero", optional "hey/hi/ok/okay" prefix.
 * Returns the command with the wake phrase stripped, or null if no wake word.
 * Empty string means wake-only (acknowledge but don't send).
 */
export function extractWakeCommand(transcript: string): string | null {
  const text = transcript.trim()
  if (!text) return null
  // Allow spaced digits in STT: "h 3 r o" / "h3ro" / "hero"
  const wakeRe =
    /\b(?:(?:hey|hi|ok|okay)\s+)?(?:h\s*3\s*r\s*o|h3ro|hero)\b[,!.?]*/i
  if (!wakeRe.test(text)) return null
  const command = text
    .replace(wakeRe, ' ')
    .replace(/^[\s,.\-–—:]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return command
}

export function readAlwaysListeningPreference(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(ALWAYS_LISTENING_KEY) === '1'
  } catch {
    return false
  }
}

export function writeAlwaysListeningPreference(on: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ALWAYS_LISTENING_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string }
  }>
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
}

const BRITISH_MALE_PREFS = [
  'google uk english male',
  'microsoft ryan',
  'microsoft george',
  'microsoft thomas',
  'daniel',
  'arthur',
  'oliver',
  'ruxandra', // skip — filtered by gender heuristics below
]

function scoreBritishMale(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase()
  const lang = voice.lang.toLowerCase()
  if (!lang.startsWith('en-gb') && !lang.startsWith('en_gb')) {
    if (lang.startsWith('en')) return 1
    return 0
  }
  // Prefer explicitly male UK voices
  for (let i = 0; i < BRITISH_MALE_PREFS.length; i++) {
    if (name.includes(BRITISH_MALE_PREFS[i])) return 100 - i
  }
  if (name.includes('male')) return 80
  if (name.includes('female') || name.includes('woman') || name.includes('zira') || name.includes('susan') || name.includes('hazel')) {
    return 10
  }
  return 50 // unknown en-GB — still better than US default
}

let cachedVoice: SpeechSynthesisVoice | null = null

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function pickH3roVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  if (cachedVoice) return cachedVoice
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const ranked = [...voices].sort((a, b) => scoreBritishMale(b) - scoreBritishMale(a))
  cachedVoice = ranked[0] ?? null
  return cachedVoice
}

/** Warm the voice list — Chrome loads voices async. */
export function warmVoices(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  const load = () => { cachedVoice = null; pickH3roVoice() }
  load()
  window.speechSynthesis.onvoiceschanged = load
}

/** Strip markdown / UI noise so TTS sounds natural. */
export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>#]+/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export type ListenHandlers = {
  onInterim?: (text: string) => void
  onFinal: (text: string) => void
  onError?: (error: string) => void
  onEnd?: () => void
}

export type CreateListenerOptions = {
  /** Default false — push-to-talk. Set true for always-listening. */
  continuous?: boolean
  /**
   * When true, restart recognition after the browser ends the session
   * (common even with continuous:true). Cleared by stop()/abort().
   */
  autoRestart?: boolean
}

export function createListener(
  handlers: ListenHandlers,
  opts?: CreateListenerOptions,
): { start: () => void; stop: () => void; abort: () => void } | null {
  if (!isSpeechRecognitionSupported()) return null
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Ctor) return null

  const continuous = opts?.continuous ?? false
  const autoRestart = opts?.autoRestart ?? false

  const rec = new Ctor()
  rec.continuous = continuous
  rec.interimResults = true
  rec.lang = 'en-GB'

  let finalBuf = ''
  let intentionalStop = false
  let restartTimer: ReturnType<typeof setTimeout> | null = null

  const clearRestart = () => {
    if (restartTimer != null) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  rec.onresult = (ev) => {
    let interim = ''
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const piece = ev.results[i][0].transcript
      if (ev.results[i].isFinal) finalBuf += piece
      else interim += piece
    }
    if (interim) handlers.onInterim?.(interim)
    if (finalBuf && !interim) {
      const text = finalBuf.trim()
      finalBuf = ''
      if (text) handlers.onFinal(text)
    }
  }

  rec.onerror = (ev) => {
    if (ev.error === 'aborted' || ev.error === 'no-speech') {
      // no-speech is routine in continuous mode — still allow auto-restart via onend
      handlers.onEnd?.()
      return
    }
    handlers.onError?.(ev.error)
  }

  rec.onend = () => {
    if (finalBuf.trim()) {
      const text = finalBuf.trim()
      finalBuf = ''
      handlers.onFinal(text)
    }
    handlers.onEnd?.()
    if (autoRestart && !intentionalStop) {
      clearRestart()
      restartTimer = setTimeout(() => {
        restartTimer = null
        if (intentionalStop) return
        try {
          rec.start()
        } catch {
          /* already started / not allowed */
        }
      }, 180)
    }
  }

  return {
    start: () => {
      intentionalStop = false
      try { rec.start() } catch { /* already started */ }
    },
    stop: () => {
      intentionalStop = true
      clearRestart()
      try { rec.stop() } catch { /* ignore */ }
    },
    abort: () => {
      intentionalStop = true
      clearRestart()
      try { rec.abort() } catch { /* ignore */ }
    },
  }
}

export function speak(
  text: string,
  opts?: { onStart?: () => void; onEnd?: () => void; onError?: () => void },
): () => void {
  if (!isSpeechSynthesisSupported()) {
    opts?.onEnd?.()
    return () => {}
  }

  window.speechSynthesis.cancel()
  const clean = stripForSpeech(text)
  if (!clean) {
    opts?.onEnd?.()
    return () => {}
  }

  const utter = new SpeechSynthesisUtterance(clean)
  const voice = pickH3roVoice()
  if (voice) {
    utter.voice = voice
    utter.lang = voice.lang || 'en-GB'
  } else {
    utter.lang = 'en-GB'
  }
  // Slightly lower + measured — closer to a composed British aide
  utter.rate = 1.02
  utter.pitch = 0.92
  utter.volume = 1

  utter.onstart = () => opts?.onStart?.()
  utter.onend = () => opts?.onEnd?.()
  utter.onerror = () => opts?.onError?.()

  window.speechSynthesis.speak(utter)
  return () => {
    window.speechSynthesis.cancel()
  }
}

/** Speak text in sentence chunks as they become available (streaming TTS). */
export class StreamingSpeaker {
  private buffer = ''
  private queue: string[] = []
  private speaking = false
  private cancelled = false
  private onSpeakingChange?: (speaking: boolean) => void
  private onIdle?: () => void

  constructor(opts?: { onSpeakingChange?: (speaking: boolean) => void; onIdle?: () => void }) {
    this.onSpeakingChange = opts?.onSpeakingChange
    this.onIdle = opts?.onIdle
  }

  push(delta: string) {
    if (this.cancelled) return
    this.buffer += delta
    this.flushReady()
  }

  /** Call when the stream finishes — speaks any remaining buffer. */
  finish() {
    if (this.cancelled) return
    const rest = this.buffer.trim()
    this.buffer = ''
    if (rest) this.queue.push(rest)
    this.pump()
    if (!this.speaking && this.queue.length === 0) this.onIdle?.()
  }

  cancel() {
    this.cancelled = true
    this.buffer = ''
    this.queue = []
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    this.speaking = false
    this.onSpeakingChange?.(false)
  }

  private flushReady() {
    // Speak complete sentences; keep trailing fragment in buffer
    const match = this.buffer.match(/^([\s\S]*?[.!?])(\s+|$)/)
    if (!match) {
      // Also flush on long paragraphs / newlines
      if (this.buffer.length > 220 || this.buffer.includes('\n\n')) {
        const cut = this.buffer.lastIndexOf('\n')
        const idx = cut > 40 ? cut : this.buffer.length
        const chunk = this.buffer.slice(0, idx).trim()
        this.buffer = this.buffer.slice(idx)
        if (chunk) {
          this.queue.push(chunk)
          this.pump()
        }
      }
      return
    }
    const sentence = match[1].trim()
    this.buffer = this.buffer.slice(match[0].length)
    if (sentence) {
      this.queue.push(sentence)
      this.pump()
    }
  }

  private pump() {
    if (this.speaking || this.cancelled || this.queue.length === 0) return
    const next = this.queue.shift()!
    this.speaking = true
    this.onSpeakingChange?.(true)
    speak(next, {
      onEnd: () => {
        this.speaking = false
        this.onSpeakingChange?.(false)
        if (this.queue.length) this.pump()
        else if (!this.buffer.trim()) this.onIdle?.()
      },
      onError: () => {
        this.speaking = false
        this.onSpeakingChange?.(false)
        if (this.queue.length) this.pump()
        else this.onIdle?.()
      },
    })
  }
}
