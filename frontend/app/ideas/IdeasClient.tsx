'use client'

import { useEffect, useState } from 'react'
import { api, Idea } from '@/lib/api'
import { streamSSE } from '@/lib/streaming'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import EmptyState from '@/components/ui/EmptyState'
import Markdown from '@/components/ui/Markdown'
import VisibilityBadge from '@/components/ui/VisibilityBadge'
import { useRouter } from 'next/navigation'

type Visibility = 'private' | 'team' | 'public'
const VIS_ORDER: Visibility[] = ['private', 'team', 'public']

export default function IdeasClient() {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [domains, setDomains] = useState('')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => { load() }, [])

  async function load() {
    try { setIdeas(await api.ideas.list()) } catch (e) { console.error(e) }
  }

  async function forge() {
    if (!domains.trim() || streaming) return
    setOutput('')
    setStreaming(true)
    try {
      for await (const chunk of streamSSE('/api/ideas/forge', { domains })) {
        if (chunk.type === 'text_delta') setOutput(o => o + chunk.text)
      }
    } finally { setStreaming(false) }
  }

  async function saveIdeas() {
    if (!output || !domains) return
    setSaving(true)
    try {
      const idea = await api.ideas.create({ domains, content: output })
      setIdeas(prev => [idea, ...prev])
      setOutput('')
      setDomains('')
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  async function connectToProject(idea: Idea) {
    router.push('/projects?seed=' + encodeURIComponent(idea.domains))
  }

  async function cycleVisibility(id: string, current: Visibility) {
    const next = VIS_ORDER[(VIS_ORDER.indexOf(current) + 1) % VIS_ORDER.length]
    await api.workspace.setIdeaVisibility(id, next)
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, visibility: next } : i))
  }

  return (
    <div className="page-enter" style={{ maxWidth: 1100 }}>
      <SectionHeader title="Ideas" sublabel="Brainstorm" accent="#FF7A1A">
        <span className="badge" style={{ background: 'rgba(255,122,26,0.10)', color: '#FF7A1A', border: '1px solid rgba(255,122,26,0.20)' }}>
          {ideas.length} IDEAS
        </span>
      </SectionHeader>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        {/* Generator */}
        <div>
          <GlassCard accent="#FF7A1A" accentTop style={{ padding: '18px 20px', marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: '#FF7A1A', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
              Forge Ideas
            </div>
            <textarea
              className="forge-input"
              placeholder="Describe a problem space, domain, or intersection of interests..."
              rows={3}
              value={domains}
              onChange={e => setDomains(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={forge}
                disabled={streaming || !domains.trim()}
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: 'center', background: '#FF7A1A' }}
              >
                {streaming ? 'FORGING...' : '✦ FORGE IDEAS'}
              </button>
              {output && !streaming && (
                <button
                  onClick={saveIdeas}
                  disabled={saving}
                  className="btn btn-ghost"
                >
                  {saving ? 'SAVING...' : 'SAVE'}
                </button>
              )}
            </div>
          </GlassCard>

          {(output || streaming) && (
            <GlassCard style={{ padding: '18px 20px' }}>
              <Markdown content={output} streaming={streaming} />
            </GlassCard>
          )}
        </div>

        {/* Ideas list */}
        <div>
          <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
            Crucible
          </div>
          {ideas.length === 0 ? (
            <EmptyState
              icon={<span style={{ fontSize: 24 }}>✦</span>}
              title="Crucible Empty"
              subtitle="Describe a domain or problem space and forge 3 concrete ideas."
              accent="#FF7A1A"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ideas.map(idea => (
                <GlassCard
                  key={idea.id}
                  hover
                  style={{ padding: '14px 18px' }}
                  onClick={() => setExpanded(expanded === idea.id ? null : idea.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#FF7A1A', flex: 1 }}>
                      {idea.domains.slice(0, 50)}{idea.domains.length > 50 ? '...' : ''}
                    </div>
                    <VisibilityBadge
                      visibility={(idea.visibility ?? 'private') as Visibility}
                      onCycle={() => cycleVisibility(idea.id, (idea.visibility ?? 'private') as Visibility)}
                    />
                  </div>
                  <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: '-webkit-box', overflow: 'hidden', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                    {idea.content.slice(0, 120)}...
                  </div>

                  {expanded === idea.id && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, maxHeight: 300, overflow: 'auto' }}
                    >
                      <Markdown content={idea.content} />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={e => { e.stopPropagation(); connectToProject(idea) }}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 9, color: '#FF2D2D', borderColor: 'rgba(255,45,45,0.22)' }}
                    >
                      → PROJECT
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); api.ideas.delete(idea.id).then(load) }}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 9, color: 'var(--text-muted)' }}
                    >
                      DEL
                    </button>
                  </div>

                  <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-subtle)', marginTop: 6 }}>
                    {new Date(idea.created_at).toLocaleDateString()}
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
