'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { streamSSE, LimitExceededError } from '@/lib/streaming'
import Markdown from '@/components/ui/Markdown'
import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'

type Exchange = {
  q: string; a: string; ts: Date; model?: string; limitExceeded?: boolean; upgradeUrl?: string
}
type Thread = { id: string; title: string; created_at: string }

const MODELS = [
  { id: 'auto', label: 'Auto', desc: 'Best model for the task' },
  { id: 'claude-sonnet-4', label: 'Claude', desc: 'Strategic reasoning' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', desc: 'Fast factual answers' },
  { id: 'perplexity-sonar', label: 'Perplexity', desc: 'Live web search' },
]

const STARTERS = [
  'What should I focus on this week?',
  'Review my current strategy and find gaps.',
  'What are the biggest risks to my venture right now?',
  'Help me prepare for an investor conversation.',
]

export default function AgentsClient() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [error, setError] = useState('')
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThread, setActiveThread] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState('auto')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { loadThreads() }, [])
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
  }, [exchanges, streaming])

  async function loadThreads() {
    const token = getToken(); if (!token) return
    try {
      const res = await fetch(API_URL + '/api/copilot/threads', { headers: { Authorization: 'Bearer ' + token } })
      if (res.ok) setThreads(await res.json())
    } catch {}
  }

  async function loadThread(threadId: string) {
    const token = getToken(); if (!token) return
    try {
      const res = await fetch(API_URL + '/api/copilot/history?thread_id=' + threadId + '&limit=50', { headers: { Authorization: 'Bearer ' + token } })
      if (res.ok) {
        const msgs = await res.json()
        const rebuilt: Exchange[] = []
        for (let i = 0; i < msgs.length; i += 2) {
          if (msgs[i] && msgs[i + 1]) rebuilt.push({ q: msgs[i].content, a: msgs[i + 1].content, ts: new Date(msgs[i].created_at), model: msgs[i + 1].model_used })
        }
        setExchanges(rebuilt); setActiveThread(threadId)
      }
    } catch {}
  }

  async function handleUpgrade() {
    const token = getToken(); if (!token) { router.push('/settings'); return }
    try {
      const res = await fetch(API_URL + '/api/subscription/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ plan_id: 'pro', billing_cycle: 'monthly' }) })
      const data = await res.json()
      if (data.checkout_url) window.location.href = data.checkout_url; else router.push('/settings')
    } catch { router.push('/settings') }
  }

  async function ask(q: string) {
    if (!q.trim() || streaming) return
    setError(''); setStreaming(true)
    setExchanges(prev => [...prev, { q, a: '', ts: new Date() }])
    setQuery('')
    try {
      for await (const chunk of streamSSE('/api/copilot/message', { message: q, thread_id: activeThread, model_override: selectedModel === 'auto' ? undefined : selectedModel })) {
        if (chunk.type === 'thread_id' && chunk.thread_id) { setActiveThread(chunk.thread_id); loadThreads() }
        else if (chunk.type === 'text_delta') setExchanges(prev => { const c = [...prev]; c[c.length-1] = { ...c[c.length-1], a: c[c.length-1].a + chunk.text }; return c })
        else if (chunk.type === 'model_used') setExchanges(prev => { const c = [...prev]; c[c.length-1] = { ...c[c.length-1], model: chunk.model }; return c })
      }
    } catch (e: any) {
      if (e instanceof LimitExceededError) setExchanges(prev => { const c = [...prev]; c[c.length-1] = { ...c[c.length-1], limitExceeded: true, upgradeUrl: e.upgradeUrl }; return c })
      else setError(e instanceof Error ? e.message : 'Unknown error')
    } finally { setStreaming(false) }
  }

  const selectedModelLabel = MODELS.find(m => m.id === selectedModel)?.label ?? 'Auto'

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 0px)', maxHeight: '100vh', background: 'var(--color-off-white)', overflow: 'hidden' }}>
      {sidebarOpen && (
        <div style={{ width: 240, minWidth: 240, borderRight: '1px solid var(--color-n200)', background: 'var(--color-vellum)', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <div style={{ padding: '16px 14px 12px', borderBottom: '1px solid var(--color-n200)' }}>
            <button onClick={() => { setExchanges([]); setActiveThread(null); setQuery(''); inputRef.current?.focus() }} style={{ width: '100%', padding: '8px 12px', background: 'var(--color-ink)', color: 'var(--color-off-white)', border: 'none', borderRadius: 2, fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}>
              + New chat
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
            {threads.length === 0
              ? <div style={{ padding: '12px 6px', fontFamily: 'var(--font-plex-mono)', fontSize: 11, color: 'var(--color-n400)' }}>No chats yet</div>
              : threads.map(t => (
                <button key={t.id} onClick={() => loadThread(t.id)} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 2, background: activeThread === t.id ? 'var(--color-off-white)' : 'transparent', borderLeft: activeThread === t.id ? '2px solid var(--color-arc-cyan)' : '2px solid transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                  {t.title || 'Untitled chat'}
                  <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n400)', marginTop: 2 }}>{new Date(t.created_at).toLocaleDateString()}</div>
                </button>
              ))
            }
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--color-n200)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--color-vellum)' }}>
          <button onClick={() => setSidebarOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-n600)', padding: 4 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="1.5" rx="0.75" fill="currentColor" /><rect x="1" y="7.25" width="14" height="1.5" rx="0.75" fill="currentColor" /><rect x="1" y="11.5" width="14" height="1.5" rx="0.75" fill="currentColor" /></svg>
          </button>
          <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 14, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-ink)' }}>COFOUND3R</div>
          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            <button onClick={() => setShowModelPicker(o => !o)} style={{ padding: '5px 12px', border: '1px solid var(--color-n200)', borderRadius: 2, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-plex-mono)', fontSize: 11, color: 'var(--color-n600)', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
              {selectedModelLabel}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            </button>
            {showModelPicker && (
              <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 100, background: 'var(--color-vellum)', border: '1px solid var(--color-n200)', borderRadius: 2, minWidth: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
                {MODELS.map(m => (
                  <button key={m.id} onClick={() => { setSelectedModel(m.id); setShowModelPicker(false) }} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: selectedModel === m.id ? 'var(--color-off-white)' : 'transparent', border: 'none', borderBottom: '1px solid var(--color-n200)', cursor: 'pointer' }}>
                    <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 12, color: 'var(--color-ink)' }}>{m.label}</div>
                    <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10, color: 'var(--color-n600)', marginTop: 2 }}>{m.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div ref={scrollerRef} style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {exchanges.length === 0 && (
            <div>
              <div style={{ fontFamily: 'var(--font-plex-serif)', fontWeight: 500, fontStyle: 'italic', fontSize: 28, color: 'var(--color-ink)', marginBottom: 8 }}>What are you building?</div>
              <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 12, color: 'var(--color-n600)', marginBottom: 32 }}>Your AI co-founder. Ask anything about your startup.</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 560 }}>
                {STARTERS.map(s => (
                  <button key={s} onClick={() => ask(s)} style={{ textAlign: 'left', padding: '12px 14px', border: '1px solid var(--color-n200)', background: 'var(--color-vellum)', borderRadius: 2, cursor: 'pointer', fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-ink)', lineHeight: 1.5 }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ maxWidth: 720 }}>
            {exchanges.map((ex, i) => (
              <div key={i} style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <div style={{ maxWidth: '80%', padding: '10px 14px', background: 'var(--color-ink)', color: 'var(--color-off-white)', borderRadius: 2, fontFamily: 'var(--font-archivo)', fontSize: 14, lineHeight: 1.6 }}>{ex.q}</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 2, background: 'var(--color-arc-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 10, color: 'var(--color-ink)', letterSpacing: '0.04em' }}>C3R</div>
                  <div style={{ flex: 1 }}>
                    {ex.limitExceeded ? (
                      <div style={{ border: '1px solid var(--color-n200)', background: 'var(--color-vellum)', padding: 16, borderRadius: 2 }}>
                        <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 11, color: 'var(--color-n600)', marginBottom: 8, textTransform: 'uppercase' }}>Spark limit reached</div>
                        <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-ink)', marginBottom: 12 }}>You have used all your messages this month.</div>
                        <button onClick={handleUpgrade} style={{ padding: '8px 16px', background: 'var(--color-arc-cyan)', border: 'none', borderRadius: 2, fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 12, cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Upgrade</button>
                      </div>
                    ) : ex.a ? (
                      <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 14, lineHeight: 1.7, color: 'var(--color-ink)' }}>
                        <Markdown content={ex.a} streaming={streaming && i === exchanges.length - 1} />
                      </div>
                    ) : streaming && i === exchanges.length - 1 ? (
                      <span style={{ color: 'var(--color-n400)', fontFamily: 'var(--font-plex-mono)', fontSize: 13 }}>Thinking</span>
                    ) : null}
                    {ex.model && ex.model !== 'claude-sonnet-4' && (
                      <div style={{ marginTop: 6, fontFamily: 'var(--font-plex-mono)', fontSize: 10, color: 'var(--color-n400)' }}>via {ex.model}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {error && <div style={{ color: 'var(--color-signal)', fontFamily: 'var(--font-plex-mono)', fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-n200)', background: 'var(--color-vellum)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', maxWidth: 720 }}>
            <textarea ref={inputRef} value={query}
              onChange={e => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px' }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(query) } }}
              disabled={streaming}
              placeholder="Ask your co-founder anything"
              rows={1}
              style={{ flex: 1, padding: '10px 14px', border: '1px solid var(--color-n200)', background: 'var(--color-off-white)', borderRadius: 2, resize: 'none', fontFamily: 'var(--font-archivo)', fontSize: 14, color: 'var(--color-ink)', outline: 'none', lineHeight: 1.5, minHeight: 42, maxHeight: 160 }}
              onFocus={e => (e.target.style.borderColor = 'var(--color-arc-cyan-deep)')}
              onBlur={e => (e.target.style.borderColor = 'var(--color-n200)')}
            />
            <button onClick={() => ask(query)} disabled={streaming || !query.trim()} style={{ padding: '10px 20px', background: streaming || !query.trim() ? 'var(--color-n200)' : 'var(--color-ink)', color: streaming || !query.trim() ? 'var(--color-n600)' : 'var(--color-off-white)', border: 'none', borderRadius: 2, cursor: streaming || !query.trim() ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', height: 42 }}>
              {streaming ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
