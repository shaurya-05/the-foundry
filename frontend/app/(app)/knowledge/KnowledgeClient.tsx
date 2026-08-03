'use client'

import { useEffect, useState } from 'react'
import { api, KnowledgeItem } from '@/lib/api'
import { streamSSE } from '@/lib/streaming'
import GlassCard from '@/components/ui/GlassCard'
import EmptyState from '@/components/ui/EmptyState'
import Markdown from '@/components/ui/Markdown'
import VisibilityBadge from '@/components/ui/VisibilityBadge'

type Visibility = 'private' | 'team' | 'public'
const VIS_ORDER: Visibility[] = ['private', 'team', 'public']

const TYPE_COLORS: Record<string, string> = {
  text: 'var(--color-arc-cyan)',
  url: 'var(--color-n600)',
  pdf: 'var(--color-ink)',
  note: 'var(--color-n600)',
}

export default function KnowledgeClient() {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ title: '', content: '', type: 'text', tags: '', source_url: '' })
  const [saving, setSaving] = useState(false)
  const [uploadMode, setUploadMode] = useState<'text' | 'file' | 'url'>('text')
  const [urlInput, setUrlInput] = useState('')
  const [fetchingUrl, setFetchingUrl] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [queryItem, setQueryItem] = useState<KnowledgeItem | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const data = await api.knowledge.list()
      setItems(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function create() {
    if (!form.title || !form.content) return
    setSaving(true)
    try {
      const tags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : []
      const item = await api.knowledge.create({ ...form, tags, source_url: form.source_url || undefined })
      setItems(prev => [item, ...prev])
      setForm({ title: '', content: '', type: 'text', tags: '', source_url: '' })
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  async function fetchUrl() {
    if (!urlInput.trim()) return
    setFetchingUrl(true)
    try {
      const token = localStorage.getItem('foundry_token')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://api.found3ry.com'}/api/knowledge/fetch-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: urlInput.trim() }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed') }
      const item = await res.json()
      setItems(prev => [item, ...prev])
      setUrlInput('')
    } catch (e: any) { alert(e.message || 'Failed to fetch URL') }
    finally { setFetchingUrl(false) }
  }

  async function uploadFile(file: File) {
    setUploadingFile(true)
    try {
      const token = localStorage.getItem('foundry_token')
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://api.found3ry.com'}/api/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Upload failed') }
      const item = await res.json()
      setItems(prev => [item, ...prev])
    } catch (e: any) { alert(e.message || 'Upload failed') }
    finally { setUploadingFile(false) }
  }

  async function remove(id: string) {
    await api.knowledge.delete(id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  async function cycleVisibility(id: string, current: Visibility) {
    const next = VIS_ORDER[(VIS_ORDER.indexOf(current) + 1) % VIS_ORDER.length]
    await api.workspace.setKnowledgeVisibility(id, next)
    setItems(prev => prev.map(i => i.id === id ? { ...i, visibility: next } : i))
  }

  async function query() {
    if (!queryItem || !question.trim()) return
    setAnswer('')
    setStreaming(true)
    try {
      for await (const chunk of streamSSE(`/api/knowledge/${queryItem.id}/query`, { question })) {
        if (chunk.type === 'text_delta') setAnswer(a => a + chunk.text)
      }
    } finally { setStreaming(false) }
  }

  const displayed = search
    ? items.filter(i => i.title.toLowerCase().includes(search.toLowerCase()) || i.content.toLowerCase().includes(search.toLowerCase()))
    : items

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.35)',
    borderRadius: 10,
    fontFamily: 'var(--font-archivo)',
    fontSize: 13,
    color: 'var(--color-ink)',
    outline: 'none',
  }

  return (
    <div className="page-enter" style={{ maxWidth: 1100, fontFamily: 'var(--font-archivo)' }}>
      {/* Header — matches command-center type treatment */}
      <div style={{ marginBottom: 22, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-ibm-plex-mono)',
            fontSize: 10,
            color: 'var(--color-n400)',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Research & docs
          </div>
          <h1 style={{
            fontFamily: 'var(--font-archivo)',
            fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            textTransform: 'none',
            color: 'var(--color-ink)',
            lineHeight: 1.15,
            margin: 0,
          }}>
            Knowledge
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: 'var(--color-n600)', maxWidth: 420, lineHeight: 1.5 }}>
            Ingest research, notes, and URLs — query them when you need answers.
          </p>
        </div>
        <div className="bay-panel" style={{ padding: '8px 14px', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-arc-cyan)' }}>
          {items.length} entries
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) 1fr', gap: 14 }} className="knowledge-grid">
        {/* Ingest */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <GlassCard accent="var(--color-arc-cyan)" accentTop style={{ padding: '16px 18px' }} hover={false}>
            <div style={{
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 9,
              color: 'var(--color-n400)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 14,
            }}>
              Ingest
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(255,255,255,0.22)', borderRadius: 10, border: '1px solid var(--border)' }}>
                {(['text', 'file', 'url'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setUploadMode(m)}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      border: 'none',
                      borderRadius: 8,
                      background: uploadMode === m ? 'var(--color-arc-cyan)' : 'transparent',
                      color: uploadMode === m ? '#F4F7FA' : 'var(--color-n600)',
                      fontFamily: 'var(--font-ibm-plex-mono)',
                      fontSize: 9,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {m === 'text' ? 'Paste' : m === 'file' ? 'Upload' : 'URL'}
                  </button>
                ))}
              </div>

              {uploadMode === 'text' && (
                <>
                  <input style={inputStyle} placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
                  <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 100 }} placeholder="Paste content, notes, research…" rows={5} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
                  <input style={inputStyle} placeholder="Tags (comma separated)" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
                  <button onClick={create} disabled={saving || !form.title || !form.content} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', opacity: saving || !form.title || !form.content ? 0.45 : 1 }}>
                    {saving ? 'Processing…' : '+ Add to archive'}
                  </button>
                </>
              )}

              {uploadMode === 'file' && (
                <div
                  style={{
                    border: '1.5px dashed var(--border-strong)',
                    borderRadius: 12,
                    padding: '28px 16px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'var(--bg)',
                  }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--color-arc-cyan)' }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border-strong)'; const f = e.dataTransfer.files[0]; if (f) uploadFile(f) }}
                  onClick={() => document.getElementById('file-upload-input')?.click()}
                >
                  <div style={{ fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-ink)', marginBottom: 6 }}>
                    {uploadingFile ? 'Uploading…' : 'Drop file or click to browse'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--color-n400)' }}>PDF, TXT, MD — max 10MB</div>
                  <input id="file-upload-input" type="file" accept=".pdf,.txt,.md,.csv" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
                </div>
              )}

              {uploadMode === 'url' && (
                <>
                  <input style={inputStyle} placeholder="https://…" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') fetchUrl() }} />
                  <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--color-n400)' }}>
                    We&apos;ll fetch and extract the content automatically
                  </div>
                  <button onClick={fetchUrl} disabled={fetchingUrl || !urlInput.trim()} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', opacity: fetchingUrl || !urlInput.trim() ? 0.45 : 1 }}>
                    {fetchingUrl ? 'Fetching…' : 'Fetch URL'}
                  </button>
                </>
              )}
            </div>
          </GlassCard>

          {queryItem && (
            <GlassCard style={{ padding: '16px 18px' }} hover={false}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--color-n400)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Querying · {queryItem.title.slice(0, 28)}
                </div>
                <button
                  onClick={() => { setQueryItem(null); setAnswer('') }}
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    width: 28,
                    height: 28,
                    cursor: 'pointer',
                    color: 'var(--color-n600)',
                    fontSize: 16,
                  }}
                >×</button>
              </div>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
                placeholder="Ask a question about this knowledge…"
                rows={3}
                value={question}
                onChange={e => setQuestion(e.target.value)}
              />
              <button
                onClick={query}
                disabled={streaming || !question.trim()}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8, opacity: streaming || !question.trim() ? 0.45 : 1 }}
              >
                {streaming ? 'Analyzing…' : 'Query archive'}
              </button>
              {answer && (
                <div style={{ marginTop: 12, maxHeight: 300, overflow: 'auto' }}>
                  <Markdown content={answer} streaming={streaming} />
                </div>
              )}
            </GlassCard>
          )}
        </div>

        {/* Archive list */}
        <div>
          <input
            style={{ ...inputStyle, marginBottom: 12 }}
            placeholder="Search archive…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {loading ? (
            <div style={{ color: 'var(--color-n400)', fontSize: 13 }}>Loading archive…</div>
          ) : displayed.length === 0 ? (
            <EmptyState
              icon={<span style={{ fontSize: 24 }}>▣</span>}
              title="Archive is empty"
              subtitle="Ingest research papers, articles, notes, and URLs to build your knowledge base."
              accent="var(--color-arc-cyan)"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {displayed.map(item => (
                <GlassCard key={item.id} hover style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span
                          className="badge"
                          style={{
                            background: 'var(--color-arc-soft)',
                            color: TYPE_COLORS[item.type] || 'var(--color-n600)',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                          }}
                        >
                          {item.type}
                        </span>
                        <VisibilityBadge
                          visibility={(item.visibility ?? 'team') as Visibility}
                          onCycle={() => cycleVisibility(item.id, (item.visibility ?? 'team') as Visibility)}
                        />
                        {item.tags?.slice(0, 2).map(tag => (
                          <span
                            key={tag}
                            className="badge"
                            style={{ background: 'var(--bg)', color: 'var(--color-n600)', borderRadius: 6 }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-archivo)',
                        fontWeight: 700,
                        fontSize: 15,
                        letterSpacing: '-0.01em',
                        textTransform: 'none',
                        color: 'var(--color-ink)',
                        marginBottom: 4,
                      }}>
                        {item.title}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-archivo)',
                        fontSize: 13,
                        color: 'var(--color-n600)',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                        lineHeight: 1.45,
                      }}>
                        {item.summary || item.content.slice(0, 120)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => { setQueryItem(item); setAnswer('') }}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10, color: 'var(--color-arc-cyan)', borderColor: 'var(--border-accent)' }}
                      >
                        Query
                      </button>
                      <button
                        onClick={() => remove(item.id)}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10 }}
                      >
                        Del
                      </button>
                    </div>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-ibm-plex-mono)',
                    fontSize: 9,
                    color: 'var(--color-n400)',
                    marginTop: 10,
                  }}>
                    {new Date(item.created_at).toLocaleDateString()}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
