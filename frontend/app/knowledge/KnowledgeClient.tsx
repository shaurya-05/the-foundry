'use client'

import { useEffect, useState } from 'react'
import { api, KnowledgeItem, streamUrl } from '@/lib/api'
import { streamSSE } from '@/lib/streaming'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import EmptyState from '@/components/ui/EmptyState'
import Markdown from '@/components/ui/Markdown'
import VisibilityBadge from '@/components/ui/VisibilityBadge'

type Visibility = 'private' | 'team' | 'public'
const VIS_ORDER: Visibility[] = ['private', 'team', 'public']

const TYPE_COLORS: Record<string, string> = {
  text: '#0A85FF',
  url: '#F06A00',
  pdf: '#E8231F',
  note: '#16A34A',
}

export default function KnowledgeClient() {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ title: '', content: '', type: 'text', tags: '', source_url: '' })
  const [saving, setSaving] = useState(false)
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

  return (
    <div className="page-enter" style={{ maxWidth: 1100 }}>
      <SectionHeader title="Knowledge" sublabel="Research & docs" accent="#0A85FF">
        <span className="badge" style={{ background: 'rgba(42,184,255,0.10)', color: '#0A85FF', border: '1px solid rgba(42,184,255,0.20)' }}>
          {items.length} ENTRIES
        </span>
      </SectionHeader>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16 }}>
        {/* Ingest Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <GlassCard accent="#0A85FF" accentTop style={{ padding: '18px 20px' }}>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: '#0A85FF', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
              Ingest Knowledge
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="forge-input"
                placeholder="Title"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
              <textarea
                className="forge-input"
                placeholder="Paste content, URLs, raw notes..."
                rows={5}
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              />
              <select
                className="forge-input"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                style={{ cursor: 'pointer' }}
              >
                <option value="text">TEXT</option>
                <option value="url">URL</option>
                <option value="pdf">PDF</option>
                <option value="note">NOTE</option>
              </select>
              <input
                className="forge-input"
                placeholder="Tags (comma separated)"
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              />
              <input
                className="forge-input"
                placeholder="Source URL (optional)"
                value={form.source_url}
                onChange={e => setForm(f => ({ ...f, source_url: e.target.value }))}
              />
              <button
                onClick={create}
                disabled={saving || !form.title || !form.content}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {saving ? 'PROCESSING...' : '+ ADD TO ARCHIVE'}
              </button>
            </div>
          </GlassCard>

          {/* Query Panel */}
          {queryItem && (
            <GlassCard accent="#7C3AED" accentTop style={{ padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: '#7C3AED', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Querying: {queryItem.title.slice(0, 30)}
                </div>
                <button onClick={() => { setQueryItem(null); setAnswer('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
              </div>
              <textarea
                className="forge-input"
                placeholder="Ask a question about this knowledge..."
                rows={3}
                value={question}
                onChange={e => setQuestion(e.target.value)}
              />
              <button
                onClick={query}
                disabled={streaming || !question.trim()}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8, background: '#7C3AED' }}
              >
                {streaming ? 'ANALYZING...' : 'QUERY ARCHIVE'}
              </button>
              {answer && (
                <div style={{ marginTop: 12, maxHeight: 300, overflow: 'auto' }}>
                  <Markdown content={answer} streaming={streaming} />
                </div>
              )}
            </GlassCard>
          )}
        </div>

        {/* Knowledge List */}
        <div>
          <div style={{ marginBottom: 12 }}>
            <input
              className="forge-input"
              placeholder="Search archive..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading archive...</div>
          ) : displayed.length === 0 ? (
            <EmptyState
              icon={<span style={{ fontSize: 24 }}>▣</span>}
              title="Archive is empty"
              subtitle="Ingest research papers, articles, notes, and URLs to build your knowledge base."
              accent="#0A85FF"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {displayed.map(item => (
                <GlassCard
                  key={item.id}
                  hover
                  style={{ padding: '14px 18px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span
                          className="badge"
                          style={{
                            background: `${TYPE_COLORS[item.type] || '#6B7280'}18`,
                            color: TYPE_COLORS[item.type] || '#6B7280',
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
                            style={{ background: 'rgba(0,0,0,0.03)', color: 'var(--text-muted)' }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-barlow-condensed)',
                          fontWeight: 600,
                          fontSize: 15,
                          letterSpacing: '0.03em',
                          textTransform: 'uppercase',
                          color: 'var(--text-primary)',
                          marginBottom: 4,
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-barlow)',
                          fontSize: 12,
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical' as const,
                        }}
                      >
                        {item.summary || item.content.slice(0, 120)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => { setQueryItem(item); setAnswer('') }}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10, color: '#0A85FF', borderColor: 'rgba(58,190,255,0.2)' }}
                      >
                        QUERY
                      </button>
                      <button
                        onClick={() => remove(item.id)}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10, color: '#E8231F', borderColor: 'rgba(255,59,59,0.2)' }}
                      >
                        DEL
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ibm-plex-mono)',
                      fontSize: 9,
                      color: 'var(--text-subtle)',
                      marginTop: 8,
                    }}
                  >
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
