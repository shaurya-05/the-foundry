'use client'

import { useEffect, useState } from 'react'
import { api, ActivityEvent, GraphConnection } from '@/lib/api'
import { streamSSE } from '@/lib/streaming'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import Markdown from '@/components/ui/Markdown'

const EVENT_COLORS: Record<string, string> = {
  knowledge_added: '#3ABEFF',
  project_created: '#FF3B3B',
  idea_generated: '#FF8A2A',
  task_created: '#22D3EE',
  task_completed: '#38D37A',
  agent_run: '#A78BFA',
  pipeline_run: '#FF3B3B',
}

const ENTITY_COLORS: Record<string, string> = {
  KnowledgeItem: '#3ABEFF',
  Project: '#FF3B3B',
  Idea: '#FF8A2A',
}

function groupByDay(events: ActivityEvent[]) {
  const groups: Record<string, ActivityEvent[]> = {}
  for (const ev of events) {
    const day = new Date(ev.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    if (!groups[day]) groups[day] = []
    groups[day].push(ev)
  }
  return groups
}

export default function ContextClient() {
  const [tab, setTab] = useState<'insights' | 'timeline' | 'connections'>('insights')
  const [insights, setInsights] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [connections, setConnections] = useState<GraphConnection[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingConnections, setLoadingConnections] = useState(false)

  useEffect(() => {
    if (tab === 'timeline' && events.length === 0) loadTimeline()
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

  async function loadTimeline() {
    setLoadingEvents(true)
    try {
      const data = await api.context.timeline(60)
      setEvents(data.events)
    } catch (e) { console.error(e) }
    finally { setLoadingEvents(false) }
  }

  async function loadConnections() {
    setLoadingConnections(true)
    try {
      const data = await api.context.connections()
      setConnections(data.connections)
    } catch (e) { console.error(e) }
    finally { setLoadingConnections(false) }
  }

  const grouped = groupByDay(events)

  return (
    <div style={{ maxWidth: 1000 }}>
      <SectionHeader title="The Signal Room" sublabel="Context Engine" accent="#A78BFA">
        <span className="badge" style={{ background: 'rgba(167,139,250,0.1)', color: '#A78BFA' }}>
          AUTO-ANALYSIS
        </span>
      </SectionHeader>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {(['insights', 'timeline', 'connections'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #A78BFA' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: tab === t ? '#A78BFA' : 'var(--text-muted)',
              transition: 'all 0.15s ease',
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Insights Tab */}
      {tab === 'insights' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button
              onClick={streamInsights}
              disabled={streaming}
              className="btn btn-primary"
              style={{ background: '#A78BFA' }}
            >
              {streaming ? 'SCANNING...' : '◆ FULL FORGE SCAN'}
            </button>
          </div>

          {(insights || streaming) ? (
            <GlassCard style={{ padding: '20px 24px' }}>
              <Markdown content={insights} streaming={streaming} />
            </GlassCard>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { title: 'Cross-Entity Links', desc: 'Detect connections between knowledge and projects', icon: '⟷', color: '#3ABEFF' },
                { title: 'Research Patterns', desc: 'Identify recurring themes in your archive', icon: '◈', color: '#FF8A2A' },
                { title: 'Startup Readiness', desc: 'Assess launch potential across your builds', icon: '▲', color: '#38D37A' },
                { title: 'Blocked Tasks', desc: 'Surface what is stalling your momentum', icon: '⊗', color: '#FF3B3B' },
              ].map(card => (
                <GlassCard
                  key={card.title}
                  hover
                  style={{ padding: '16px 18px', cursor: 'pointer' }}
                  onClick={streamInsights}
                >
                  <div style={{ fontSize: 20, color: card.color, marginBottom: 8 }}>{card.icon}</div>
                  <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 14, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-primary)', marginBottom: 4 }}>
                    {card.title}
                  </div>
                  <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-muted)' }}>
                    {card.desc}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeline Tab */}
      {tab === 'timeline' && (
        <div>
          {loadingEvents ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading timeline...</div>
          ) : events.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No activity recorded yet.</div>
          ) : (
            Object.entries(grouped).map(([day, dayEvents]) => (
              <div key={day} style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--text-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
                  {day}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {dayEvents.map(ev => {
                    const color = EVENT_COLORS[ev.type] || '#637080'
                    return (
                      <div key={ev.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ width: 1, background: color + '30', alignSelf: 'stretch', flexShrink: 0, marginLeft: 11 }} />
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 4, marginLeft: -4 }} />
                        <div className="gl0" style={{ flex: 1, padding: '8px 12px' }}>
                          <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 13, color: 'var(--text-secondary)' }}>{ev.title}</div>
                          {ev.detail && <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{ev.detail}</div>}
                          <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-subtle)', marginTop: 4 }}>
                            {new Date(ev.created_at).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Connections Tab */}
      {tab === 'connections' && (
        <div>
          {loadingConnections ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Scanning knowledge graph...</div>
          ) : connections.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '24px 0' }}>
              No connections detected yet. Add more knowledge and projects to discover relationships.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {connections.map((conn, i) => {
                const fromColor = ENTITY_COLORS[conn.from_type] || '#637080'
                const toColor = ENTITY_COLORS[conn.to_type] || '#637080'
                return (
                  <GlassCard key={i} style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className="badge" style={{ background: `${fromColor}18`, color: fromColor }}>
                        {conn.from_type}
                      </span>
                      <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'var(--text-primary)', flex: 1, textAlign: 'center' }}>
                        {conn.from_title || conn.from_id.slice(0, 8)}
                      </span>
                      <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                        —{conn.rel_type}→
                      </span>
                      <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'var(--text-primary)', flex: 1, textAlign: 'center' }}>
                        {conn.to_title || conn.to_id?.slice(0, 8)}
                      </span>
                      <span className="badge" style={{ background: `${toColor}18`, color: toColor }}>
                        {conn.to_type}
                      </span>
                      {conn.score && (
                        <span className="badge" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
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
