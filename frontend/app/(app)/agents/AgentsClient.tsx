'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { streamWS, LimitExceededError } from '@/lib/streaming'
import Markdown from '@/components/ui/Markdown'
import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'

type Exchange = {
  q: string; a: string; ts: Date; model?: string; limitExceeded?: boolean; upgradeUrl?: string
  council?: { model: string; response: string }[]
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



function SaveToDrive({ q, a }: { q: string; a: string }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    try {
      const token = localStorage.getItem('foundry_token')
      const res = await fetch('https://api.found3ry.com/api/copilot/save-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: q.slice(0, 60), content: `${q}\n\n${a}` }),
      })
      if (res.ok) {
        const data = await res.json()
        setSaved(data.url)
      } else {
        const d = await res.json()
        alert(d.detail || 'Failed to save')
      }
    } catch { alert('Failed to save to Drive') }
    finally { setSaving(false) }
  }

  if (saved) return (
    <a href={saved} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n600)', textDecoration: 'none', letterSpacing: '0.06em' }}>
      ↗ Open in Drive
    </a>
  )

  return (
    <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n600)', letterSpacing: '0.06em' }}>
      {saving ? 'Saving...' : 'Save to Drive'}
    </button>
  )
}

function CouncilPopout({ perspectives }: { perspectives: { model: string; response: string }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n600)', letterSpacing: '0.06em' }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2"/><path d="M3 5h4M5 3v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
        {open ? 'Hide' : 'Other perspectives'}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
      </button>
      {open && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {perspectives.map((p, i) => (
            <div key={i} className="bay-panel" style={{ overflow: 'visible' }}>
              <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n600)', letterSpacing: '0.06em' }}>
                {p.model}
              </div>
              <div style={{ padding: '10px 12px', fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-ink)', lineHeight: 1.6 }}>
                {p.response}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AgentsClient() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState<string>('')
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
    setError(''); setStreaming(true); setStatus('')
    setExchanges(prev => [...prev, { q, a: '', ts: new Date() }])
    setQuery('')
    try {
      for await (const chunk of streamWS('/api/copilot/message', { message: q, thread_id: activeThread, model_override: selectedModel === 'auto' ? undefined : selectedModel })) {
        if (chunk.type === 'thread_id' && chunk.thread_id) { setActiveThread(chunk.thread_id); loadThreads() }
        else if (chunk.type === 'status') setStatus(chunk.text)
        else if (chunk.type === 'text_delta') { if (status) setStatus(''); setExchanges(prev => { const c = [...prev]; c[c.length-1] = { ...c[c.length-1], a: c[c.length-1].a + chunk.text }; return c }) }
        else if (chunk.type === 'model_used') setExchanges(prev => { const c = [...prev]; c[c.length-1] = { ...c[c.length-1], model: chunk.model }; return c })
        else if (chunk.type === 'council') setExchanges(prev => { const c = [...prev]; c[c.length-1] = { ...c[c.length-1], council: chunk.perspectives }; return c })
      }
    } catch (e: any) {
      if (e instanceof LimitExceededError) setExchanges(prev => { const c = [...prev]; c[c.length-1] = { ...c[c.length-1], limitExceeded: true, upgradeUrl: e.upgradeUrl }; return c })
      else setError(e instanceof Error ? e.message : 'Unknown error')
    } finally { setStreaming(false); setStatus('') }
  }

  const selectedModelLabel = MODELS.find(m => m.id === selectedModel)?.label ?? 'Auto'

  return (
    <div style={{ display: 'flex', flex: '1', minHeight: 0, background: 'transparent', overflow: 'hidden', gap: 10, padding: '0 10px 10px' }}>
      {sidebarOpen && (
        <div
          className="liquid-glass-strong"
          style={{
            width: 220,
            minWidth: 220,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
            borderRadius: 18,
          }}
        >
          <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => { setExchanges([]); setActiveThread(null); setQuery(''); inputRef.current?.focus() }}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
            >
              + New chat
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
            {threads.length === 0
              ? <div style={{ padding: '12px 6px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'var(--color-n400)' }}>No chats yet</div>
              : threads.map(t => (
                <button
                  key={t.id}
                  onClick={() => loadThread(t.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 10px',
                    marginBottom: 4,
                    background: activeThread === t.id ? 'var(--color-arc-soft)' : 'transparent',
                    borderLeft: activeThread === t.id ? '2px solid var(--color-arc-cyan)' : '2px solid transparent',
                    border: 'none',
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-archivo)',
                    fontSize: 12,
                    color: 'var(--color-ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                  }}
                >
                  {t.title || 'Untitled chat'}
                  <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--color-n400)', marginTop: 2 }}>
                    {new Date(t.created_at).toLocaleDateString()}
                  </div>
                </button>
              ))
            }
          </div>
        </div>
      )}

      <div
        className="liquid-glass-strong"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 18, minWidth: 0 }}
      >
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              cursor: 'pointer',
              color: 'var(--color-n600)',
              padding: 6,
              display: 'flex',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="1.5" rx="0.75" fill="currentColor" /><rect x="1" y="7.25" width="14" height="1.5" rx="0.75" fill="currentColor" /><rect x="1" y="11.5" width="14" height="1.5" rx="0.75" fill="currentColor" /></svg>
          </button>
          <div>
            <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ink)' }}>
              H3RO
            </div>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--color-n400)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>
              Text chat backup
            </div>
          </div>
          <div style={{ marginLeft: 'auto', position: 'relative' }}>
            <button
              onClick={() => setShowModelPicker(o => !o)}
              style={{
                padding: '6px 12px',
                border: '1px solid var(--border)',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.12)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 11,
                color: 'var(--color-n600)',
                letterSpacing: '0.06em',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {selectedModelLabel}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            </button>
            {showModelPicker && (
              <div
                className="liquid-glass-strong"
                style={{ position: 'absolute', right: 0, top: '110%', zIndex: 100, borderRadius: 14, minWidth: 200, overflow: 'hidden' }}
              >
                {MODELS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedModel(m.id); setShowModelPicker(false) }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 14px',
                      background: selectedModel === m.id ? 'var(--color-arc-soft)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 12, color: 'var(--color-ink)' }}>{m.label}</div>
                    <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n600)', marginTop: 2 }}>{m.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div ref={scrollerRef} style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {exchanges.length === 0 && (
            <div style={{ maxWidth: 560 }}>
              <div style={{
                fontFamily: 'var(--font-archivo)',
                fontWeight: 700,
                fontSize: 'clamp(1.5rem, 2.2vw, 1.9rem)',
                letterSpacing: '-0.02em',
                color: 'var(--color-ink)',
                marginBottom: 8,
                lineHeight: 1.15,
              }}>
                What are you building?
              </div>
              <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 14, color: 'var(--color-n600)', marginBottom: 28, lineHeight: 1.5 }}>
                Your collaborating cofound3r — text mode. Prefer voice? Talk on the dashboard.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {STARTERS.map(s => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="bay-panel liquid-glass-interactive"
                    style={{
                      textAlign: 'left',
                      padding: '14px 16px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-archivo)',
                      fontSize: 13,
                      color: 'var(--color-ink)',
                      lineHeight: 1.5,
                      width: '100%',
                      /* Don't override frost; keep lift shadows */
                      overflow: 'visible',
                    }}
                  >
                    <span style={{ color: 'var(--color-arc-cyan)', marginRight: 8 }}>→</span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ maxWidth: 720 }}>
            {exchanges.map((ex, i) => (
              <div key={i} style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <div style={{
                    maxWidth: '80%',
                    padding: '11px 15px',
                    background: 'var(--color-arc-cyan)',
                    color: '#F4F7FA',
                    borderRadius: 14,
                    fontFamily: 'var(--font-archivo)',
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}>{ex.q}</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: 'var(--color-arc-soft)',
                    border: '1px solid var(--border-accent)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontFamily: 'var(--font-archivo)',
                    fontWeight: 700,
                    fontSize: 10,
                    color: 'var(--color-arc-cyan)',
                    letterSpacing: '0.04em',
                  }}>H3R</div>
                  <div style={{ flex: 1 }}>
                    {ex.limitExceeded ? (
                      <div className="bay-panel" style={{ padding: 16 }}>
                        <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'var(--color-n600)', marginBottom: 8, textTransform: 'uppercase' }}>Spark limit reached</div>
                        <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-ink)', marginBottom: 12 }}>You have used all your messages this month.</div>
                        <button onClick={handleUpgrade} className="btn btn-primary btn-sm">Upgrade</button>
                      </div>
                    ) : ex.a ? (
                      <div className="bay-panel" style={{ padding: '14px 16px', fontFamily: 'var(--font-archivo)', fontSize: 14, lineHeight: 1.7, color: 'var(--color-ink)' }}>
                        <Markdown content={ex.a} streaming={streaming && i === exchanges.length - 1} />
                      </div>
                    ) : streaming && i === exchanges.length - 1 ? (
                      <span style={{ color: 'var(--color-n400)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 13 }}>Thinking…</span>
                    ) : null}
                    {ex.model && (
                      <div style={{ marginTop: 6, fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--color-n400)' }}>via {ex.model}</div>
                    )}
                    {ex.council && ex.council.length > 0 && (
                      <CouncilPopout perspectives={ex.council} />
                    )}
                    {ex.a && !ex.limitExceeded && (
                      <SaveToDrive q={ex.q} a={ex.a} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {error && <div style={{ color: 'var(--color-signal)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>

        <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
          {status && (
            <div style={{ marginBottom: 8, fontSize: 11, fontFamily: 'var(--font-ibm-plex-mono)', color: 'var(--color-n600)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, maxWidth: 720 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-arc-cyan)' }} />
              {status}
            </div>
          )}
          <div style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
            maxWidth: 720,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: '8px 10px',
            boxShadow: 'var(--glass-inset)',
          }}>
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px' }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(query) } }}
              disabled={streaming}
              placeholder="Type to H3RO…"
              rows={1}
              style={{
                flex: 1,
                padding: '6px 8px',
                border: 'none',
                background: 'transparent',
                resize: 'none',
                fontFamily: 'var(--font-archivo)',
                fontSize: 14,
                color: 'var(--color-ink)',
                outline: 'none',
                lineHeight: 1.5,
                minHeight: 28,
                maxHeight: 160,
              }}
            />
            <button
              onClick={() => ask(query)}
              disabled={streaming || !query.trim()}
              className="btn btn-primary btn-sm"
              style={{
                opacity: streaming || !query.trim() ? 0.45 : 1,
                height: 34,
                padding: '0 16px',
              }}
            >
              {streaming ? '…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
