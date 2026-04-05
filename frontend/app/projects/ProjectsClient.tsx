'use client'

import { useEffect, useState } from 'react'
import { api, Project, Task } from '@/lib/api'
import { streamSSE } from '@/lib/streaming'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import EmptyState from '@/components/ui/EmptyState'
import Markdown from '@/components/ui/Markdown'
import VisibilityBadge from '@/components/ui/VisibilityBadge'

type Visibility = 'private' | 'team' | 'public'
const VIS_ORDER: Visibility[] = ['private', 'team', 'public']

interface BriefSection {
  title: string
  content: string
}

function parseBrief(markdown: string): BriefSection[] {
  const parts = markdown.split(/^##\s+/m)
  return parts
    .map(part => {
      const lines = part.trim().split('\n')
      const title = lines[0]?.trim() || ''
      const content = lines.slice(1).join('\n').trim()
      return { title, content }
    })
    .filter(s => s.title && s.content)
}

const BRIEF_COLORS: Record<string, string> = {
  'The Pitch': '#E8231F',
  'The Problem': '#F06A00',
  'The Solution': '#16A34A',
  'Target Market': '#0A85FF',
  'MVP Feature Set': '#7C3AED',
  'Go-To-Market Strategy': '#F06A00',
  'Key Metrics': '#0891B2',
  'Funding Path': '#E8231F',
}

const STATUS_COLORS: Record<string, string> = {
  active: '#16A34A',
  paused: '#F06A00',
  completed: '#0A85FF',
}

export default function ProjectsClient() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [planning, setPlanning] = useState<string | null>(null)
  const [planText, setPlanText] = useState<Record<string, string>>({})
  const [streamingPlan, setStreamingPlan] = useState(false)
  // Brief-from-concept (folded in from Launchpad)
  const [briefMode, setBriefMode] = useState(false)
  const [concept, setConcept] = useState('')
  const [brief, setBrief] = useState('')
  const [briefStreaming, setBriefStreaming] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const [p, t] = await Promise.all([api.projects.list(), api.tasks.list()])
      setProjects(p)
      setTasks(t)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function create() {
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const p = await api.projects.create({ title: newTitle })
      setProjects(prev => [p, ...prev])
      setNewTitle('')
      // Auto-forge plan
      await forgePlan(p.id)
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  async function forgePlan(id: string) {
    setPlanning(id)
    setStreamingPlan(true)
    setPlanText(prev => ({ ...prev, [id]: '' }))
    try {
      for await (const chunk of streamSSE(`/api/projects/${id}/forge-plan`, {})) {
        if (chunk.type === 'text_delta') {
          setPlanText(prev => ({ ...prev, [id]: (prev[id] || '') + chunk.text }))
        }
      }
      await load()
    } finally {
      setPlanning(null)
      setStreamingPlan(false)
    }
  }

  async function updateStatus(id: string, status: string) {
    await api.projects.update(id, { status })
    setProjects(prev => prev.map(p => p.id === id ? { ...p, status } : p))
  }

  async function cycleVisibility(id: string, current: Visibility) {
    const next = VIS_ORDER[(VIS_ORDER.indexOf(current) + 1) % VIS_ORDER.length]
    await api.workspace.setProjectVisibility(id, next)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, visibility: next } : p))
  }

  async function cycleClearance(id: string, current: number, currentVis: Visibility) {
    const next = (current + 1) % 4
    await api.workspace.setProjectVisibility(id, currentVis, next)
    setProjects(prev => prev.map(p => p.id === id ? { ...p, clearance_level: next } : p))
  }

  async function forgeBrief() {
    if (!concept.trim() || briefStreaming) return
    setBrief('')
    setBriefStreaming(true)
    try {
      for await (const chunk of streamSSE('/api/launchpad/forge-brief', { concept })) {
        if (chunk.type === 'text_delta') setBrief(b => b + chunk.text)
      }
    } finally { setBriefStreaming(false) }
  }

  async function createFromBrief() {
    if (!concept.trim() || !brief) return
    setCreating(true)
    try {
      const p = await api.projects.create({ title: concept })
      await api.projects.update(p.id, { plan: brief })
      setProjects(prev => [{ ...p, plan: brief }, ...prev])
      setBriefMode(false)
      setConcept('')
      setBrief('')
      setExpanded(p.id)
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  function getProjectTasks(projectId: string) {
    return tasks.filter(t => t.project_id === projectId)
  }

  return (
    <div className="page-enter" style={{ maxWidth: 1100 }}>
      <SectionHeader title="Projects" sublabel="Build tracker" accent="#E8231F">
        <span className="badge" style={{ background: 'rgba(255,45,45,0.10)', color: '#E8231F', border: '1px solid rgba(255,45,45,0.20)' }}>
          {projects.filter(p => p.status === 'active').length} ACTIVE
        </span>
      </SectionHeader>

      {/* Create Form */}
      <GlassCard accent="#E8231F" accentTop accentGlow style={{ padding: '16px 20px', marginBottom: 20 }}>
        {!briefMode ? (
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              className="forge-input"
              placeholder="Name your next build..."
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()}
              style={{ flex: 1 }}
            />
            <button onClick={create} disabled={creating || !newTitle.trim()} className="btn btn-primary">
              {creating ? 'CREATING...' : '+ NEW PROJECT'}
            </button>
            <button
              onClick={() => setBriefMode(true)}
              className="btn btn-ghost btn-sm"
              style={{ color: '#E8231F', borderColor: 'rgba(255,45,45,0.22)', whiteSpace: 'nowrap', fontSize: 10 }}
              title="Generate a full project brief from a concept"
            >
              GENERATE FROM CONCEPT
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'rgba(232,35,31,0.8)', letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                Project Brief Generator
              </span>
              <button onClick={() => { setBriefMode(false); setConcept(''); setBrief('') }} className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}>
                CANCEL
              </button>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                className="forge-input"
                placeholder="Describe your concept, product idea, or problem to solve..."
                value={concept}
                onChange={e => setConcept(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && forgeBrief()}
                style={{ flex: 1 }}
                autoFocus
              />
              <button onClick={forgeBrief} disabled={briefStreaming || !concept.trim()} className="btn btn-primary">
                {briefStreaming ? 'GENERATING...' : 'GENERATE BRIEF'}
              </button>
            </div>

            {/* Streaming raw output while generating */}
            {briefStreaming && (
              <div style={{ background: 'var(--bg-mid)', border: '1px solid rgba(255,45,45,0.15)', borderRadius: 8, padding: '14px 16px' }}>
                <Markdown content={brief} streaming={briefStreaming} />
              </div>
            )}

            {/* Structured brief output once complete */}
            {!briefStreaming && brief && (() => {
              const sections = parseBrief(brief)
              const pitch = sections.find(s => s.title === 'The Pitch')
              const rest = sections.filter(s => s.title !== 'The Pitch')
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Pitch card — hero treatment */}
                  {pitch && (
                    <div style={{
                      background: 'rgba(255,45,45,0.06)',
                      border: '1px solid rgba(255,45,45,0.25)',
                      borderRadius: 10,
                      padding: '18px 20px',
                    }}>
                      <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: '#FF2D2D', letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 8 }}>
                        THE PITCH
                      </div>
                      <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 17, color: 'var(--text-primary)', lineHeight: 1.4, letterSpacing: '0.02em' }}>
                        {pitch.content}
                      </div>
                    </div>
                  )}

                  {/* Remaining sections — 2 column grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {rest.map(section => {
                      const color = BRIEF_COLORS[section.title] || '#6B7280'
                      return (
                        <div key={section.title} style={{
                          background: `${color}05`,
                          border: `1px solid ${color}20`,
                          borderLeft: `2px solid ${color}`,
                          borderRadius: 8,
                          padding: '12px 14px',
                        }}>
                          <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8, color, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                            {section.title}
                          </div>
                          <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            {section.content}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <button onClick={createFromBrief} disabled={creating} className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                    {creating ? 'SAVING...' : '+ CREATE PROJECT FROM BRIEF'}
                  </button>
                </div>
              )
            })()}
          </div>
        )}
      </GlassCard>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading workshop...</div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<span style={{ fontSize: 24 }}>⬡</span>}
          title="Workshop is empty"
          subtitle="Create your first build. Claude will forge a complete project plan and auto-generate tasks."
          accent="#FF3B3B"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {projects.map(project => {
            const ptasks = getProjectTasks(project.id)
            const done = ptasks.filter(t => t.status === 'completed').length
            const progress = ptasks.length > 0 ? done / ptasks.length : 0
            const isExpanded = expanded === project.id
            const currentPlan = planText[project.id] || project.plan || ''
            const isPlanning = planning === project.id

            return (
              <GlassCard
                key={project.id}
                hover={!isExpanded}
                style={{ padding: '16px 20px', cursor: 'pointer' }}
                onClick={() => !isExpanded && setExpanded(project.id)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span
                        className="badge"
                        style={{
                          background: `${STATUS_COLORS[project.status] || '#6B7280'}18`,
                          color: STATUS_COLORS[project.status] || '#6B7280',
                        }}
                      >
                        {project.status}
                      </span>
                      <VisibilityBadge
                        visibility={(project.visibility ?? 'private') as Visibility}
                        clearanceLevel={project.clearance_level ?? 0}
                        onCycle={() => cycleVisibility(project.id, (project.visibility ?? 'private') as Visibility)}
                        onCycleClearance={() => cycleClearance(project.id, project.clearance_level ?? 0, (project.visibility ?? 'private') as Visibility)}
                      />
                      {ptasks.length > 0 && (
                        <span
                          className="badge"
                          style={{ background: 'rgba(0,0,0,0.03)', color: 'var(--text-muted)' }}
                        >
                          {done}/{ptasks.length} tasks
                        </span>
                      )}
                    </div>
                    <h3
                      style={{
                        fontFamily: 'var(--font-barlow-condensed)',
                        fontWeight: 700,
                        fontSize: 18,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: 'var(--text-primary)',
                        marginBottom: ptasks.length > 0 ? 10 : 0,
                      }}
                    >
                      {project.title}
                    </h3>
                    {ptasks.length > 0 && (
                      <div
                        style={{
                          height: 3,
                          background: 'rgba(0,0,0,0.06)',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${progress * 100}%`,
                            background: '#16A34A',
                            borderRadius: 2,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    {(['active', 'paused', 'completed'] as const).map(s => (
                      <button
                        key={s}
                        onClick={e => { e.stopPropagation(); updateStatus(project.id, s) }}
                        className="badge"
                        style={{
                          background: project.status === s ? `${STATUS_COLORS[s]}20` : 'rgba(0,0,0,0.03)',
                          color: project.status === s ? STATUS_COLORS[s] : 'var(--text-subtle)',
                          cursor: 'pointer',
                          border: `1px solid ${project.status === s ? STATUS_COLORS[s] + '40' : 'transparent'}`,
                          fontSize: 8,
                        }}
                      >
                        {s}
                      </button>
                    ))}
                    <button
                      onClick={e => { e.stopPropagation(); setExpanded(isExpanded ? null : project.id) }}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 10 }}
                    >
                      {isExpanded ? 'COLLAPSE' : 'EXPAND'}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div
                    onClick={e => e.stopPropagation()}
                    style={{ marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 16 }}
                  >
                    {currentPlan ? (
                      <div style={{ maxHeight: 400, overflow: 'auto' }}>
                        <Markdown content={currentPlan} streaming={isPlanning && streamingPlan} />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No plan yet.</span>
                        <button
                          onClick={() => forgePlan(project.id)}
                          disabled={isPlanning}
                          className="btn btn-ghost btn-sm"
                          style={{ color: '#E8231F', borderColor: 'rgba(255,45,45,0.22)' }}
                        >
                          {isPlanning ? 'FORGING PLAN...' : 'FORGE PLAN'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
