'use client'

import { useEffect, useState } from 'react'
import { api, GraphConnection } from '@/lib/api'
import { streamSSE } from '@/lib/streaming'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import Markdown from '@/components/ui/Markdown'

const ENTITY_COLORS: Record<string, string> = {
  KnowledgeItem: '#0A85FF',
  Project: '#E8231F',
  Idea: '#F06A00',
}

export default function InsightsClient() {
  const [tab, setTab] = useState<'analysis' | 'connections'>('analysis')
  const [insights, setInsights] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [connections, setConnections] = useState<GraphConnection[]>([])
  const [loadingConnections, setLoadingConnections] = useState(false)

  useEffect(() => {
    if (tab === 'connections' && connections.length === 0) loadConnections()
  }, [tab])

  async function streamInsights() {
    setInsights('')
    setStreaming(true)
    try {
      for await (const chunk of streamSSE('/api/context/insights/stream', {})) {
        if (chunk.type === 'text_delta') setInsights(i => i + chunk.text)
      }
    } finally { setStreaming(false) }
  }

  async function loadConnections() {
    setLoadingConnections(true)
    try {
      const data = await api.context.connections()
      setConnections(data.connections)
    } catch (e) { console.error(e) }
    finally { setLoadingConnections(false) }
  }

  return (
    <div className="page-enter" style={{ maxWidth: 960 }}>
      <SectionHeader title="Insights" sublabel="AI Analysis" accent="#7C3AED">
        <span className="badge" style={{ background: 'rgba(155,123,255,0.08)', color: '#7C3AED', border: '1px solid rgba(155,123,255,0.18)' }}>
          CROSS-ENTITY
        </span>
      </SectionHeader>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        {[
          { id: 'analysis', label: 'Analysis' },
          { id: 'connections', label: 'Connections' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as typeof tab)}
            style={{
              padding: '8px 18px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid #7C3AED' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 10.5,
              letterSpacing: '0.06em',
              color: tab === t.id ? '#7C3AED' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Analysis Tab */}
      {tab === 'analysis' && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={streamInsights}
              disabled={streaming}
              className="btn btn-primary"
              style={{ background: '#7C3AED', boxShadow: '0 0 20px rgba(155,123,255,0.25)' }}
            >
              {streaming ? 'ANALYSING...' : 'RUN ANALYSIS'}
            </button>
            <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, color: 'var(--text-subtle)', marginLeft: 12 }}>
              Scans all knowledge, projects, and ideas for patterns and connections
            </span>
          </div>

          {(insights || streaming) ? (
            <GlassCard style={{ padding: '20px 24px' }}>
              <Markdown content={insights} streaming={streaming} />
            </GlassCard>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { title: 'Cross-entity links', desc: 'Connections between knowledge items and active projects', color: '#0A85FF' },
                { title: 'Research patterns', desc: 'Recurring themes and topics across your knowledge base', color: '#F06A00' },
                { title: 'Momentum blockers', desc: 'Tasks and projects stalling without recent activity', color: '#E8231F' },
                { title: 'Idea-to-project gaps', desc: 'Ideas without corresponding projects or follow-up', color: '#16A34A' },
              ].map(card => (
                <GlassCard
                  key={card.title}
                  hover
                  style={{ padding: '14px 16px', cursor: 'pointer' }}
                  onClick={streamInsights}
                >
                  <div style={{ width: 3, height: 20, borderRadius: 1, background: card.color, marginBottom: 10, boxShadow: `0 0 8px ${card.color}60` }} />
                  <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 13.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-primary)', marginBottom: 4 }}>
                    {card.title}
                  </div>
                  <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {card.desc}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Connections Tab */}
      {tab === 'connections' && (
        <div>
          <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9.5, color: 'var(--text-subtle)', marginBottom: 14 }}>
            Semantic relationships detected between knowledge items, projects, and ideas
          </div>
          {loadingConnections ? (
            <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11 }}>Scanning knowledge graph...</div>
          ) : connections.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
              No connections detected yet. Add more knowledge and projects to surface relationships.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {connections.map((conn, i) => {
                const fromColor = ENTITY_COLORS[conn.from_type] || '#4A5A72'
                const toColor = ENTITY_COLORS[conn.to_type] || '#4A5A72'
                return (
                  <GlassCard key={i} style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span className="badge" style={{ background: `${fromColor}12`, color: fromColor, border: `1px solid ${fromColor}20`, flexShrink: 0 }}>
                          {conn.from_type}
                        </span>
                        <span style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conn.from_title || conn.from_id.slice(0, 8)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <div style={{ height: 1, width: 16, background: 'rgba(0,0,0,0.10)' }} />
                        <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          {conn.rel_type}
                        </span>
                        <div style={{ height: 1, width: 16, background: 'rgba(0,0,0,0.10)' }} />
                      </div>
                      <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8, minWidth: 0, justifyContent: 'flex-end' }}>
                        <span style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {conn.to_title || conn.to_id?.slice(0, 8)}
                        </span>
                        <span className="badge" style={{ background: `${toColor}12`, color: toColor, border: `1px solid ${toColor}20`, flexShrink: 0 }}>
                          {conn.to_type}
                        </span>
                      </div>
                      {conn.score && (
                        <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>
                          {Math.round(conn.score * 100)}%
                        </span>
                      )}
                    </div>
                  </GlassCard>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
