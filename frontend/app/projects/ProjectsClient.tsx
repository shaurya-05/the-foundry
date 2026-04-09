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
  // Project creation modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createSections, setCreateSections] = useState<Record<string, boolean>>({
    overview: true,
    objectives: true,
    milestones: true,
    technical: true,
    success_criteria: true,
    tasks: true,
    pitch: false,
    problem: false,
    solution: false,
    target_market: false,
    mvp: false,
    go_to_market: false,
    key_metrics: false,
    funding: false,
  })
  // Brief-from-concept
  const [briefMode, setBriefMode] = useState(false)
  const [showConceptModal, setShowConceptModal] = useState(false)
  const [concept, setConcept] = useState('')
  const [conceptSections, setConceptSections] = useState<Record<string, boolean>>({
    overview: false,
    objectives: false,
    milestones: false,
    technical: false,
    success_criteria: false,
    tasks: true,
    pitch: true,
    problem: true,
    solution: true,
    target_market: true,
    mvp: true,
    go_to_market: true,
    key_metrics: true,
    funding: true,
  })
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

  function openCreateModal() {
    if (!newTitle.trim()) return
    setShowCreateModal(true)
  }

  function toggleSection(key: string) {
    setCreateSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function selectAllPlan() {
    setCreateSections(prev => ({ ...prev, overview: true, objectives: true, milestones: true, technical: true, success_criteria: true, tasks: true }))
  }

  function selectAllBrief() {
    setCreateSections(prev => ({ ...prev, pitch: true, problem: true, solution: true, target_market: true, mvp: true, go_to_market: true, key_metrics: true, funding: true }))
  }

  function selectAll() { selectAllPlan(); selectAllBrief() }

  async function create() {
    if (!newTitle.trim()) return
    setShowCreateModal(false)
    setCreating(true)
    const selected = Object.entries(createSections).filter(([, v]) => v).map(([k]) => k)
    try {
      const p = await api.projects.create({ title: newTitle })
      setProjects(prev => [p, ...prev])
      setNewTitle('')
      setExpanded(p.id)
      // Stream the forge with selected sections
      setPlanning(p.id)
      setStreamingPlan(true)
      setPlanText(prev => ({ ...prev, [p.id]: '' }))
      const sectionsParam = selected.join(',')
      for await (const chunk of streamSSE(`/api/projects/${p.id}/forge-plan?sections=${sectionsParam}`, {})) {
        if (chunk.type === 'text_delta') {
          setPlanText(prev => ({ ...prev, [p.id]: (prev[p.id] || '') + chunk.text }))
        }
      }
      await load()
    } catch (e) { console.error(e) }
    finally { setCreating(false); setPlanning(null); setStreamingPlan(false) }
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

  function openConceptModal() {
    setShowConceptModal(true)
  }

  function toggleConceptSection(key: string) {
    setConceptSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function forgeFromConcept() {
    if (!concept.trim()) return
    setShowConceptModal(false)
    setBriefMode(false)
    setCreating(true)
    const selected = Object.entries(conceptSections).filter(([, v]) => v).map(([k]) => k)
    const sectionsParam = selected.join(',')
    try {
      const p = await api.projects.create({ title: concept })
      setProjects(prev => [p, ...prev])
      setConcept('')
      setExpanded(p.id)
      // Stream forge with selected sections
      setPlanning(p.id)
      setStreamingPlan(true)
      setPlanText(prev => ({ ...prev, [p.id]: '' }))
      for await (const chunk of streamSSE(`/api/projects/${p.id}/forge-plan?sections=${sectionsParam}`, {})) {
        if (chunk.type === 'text_delta') {
          setPlanText(prev => ({ ...prev, [p.id]: (prev[p.id] || '') + chunk.text }))
        }
      }
      await load()
    } catch (e) { console.error(e) }
    finally { setCreating(false); setPlanning(null); setStreamingPlan(false) }
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

      {/* Create Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999, backdropFilter: 'blur(4px)',
        }} onClick={() => setShowCreateModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-surface, #fff)', borderRadius: 16,
            border: '1px solid var(--border)', width: '100%', maxWidth: 560,
            maxHeight: '80vh', overflow: 'auto',
            boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
          }}>
            <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 18,
                letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 4,
              }}>
                Configure Your Build
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
                &quot;{newTitle}&quot; — select what the AI should generate
              </p>
            </div>

            <div style={{ padding: '20px 28px' }}>
              {/* Project Plan sections */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 11,
                    letterSpacing: '0.08em', textTransform: 'uppercase', color: '#E8231F',
                  }}>Project Plan</span>
                  <button onClick={selectAllPlan} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)',
                    textDecoration: 'underline',
                  }}>Select all</button>
                </div>
                {[
                  { key: 'overview', label: 'Overview', desc: 'Project description and scope' },
                  { key: 'objectives', label: 'Core Objectives', desc: '3-5 specific goals' },
                  { key: 'milestones', label: 'Key Milestones', desc: 'Timeline with phases' },
                  { key: 'technical', label: 'Technical Requirements', desc: 'Stack, constraints, architecture' },
                  { key: 'success_criteria', label: 'Success Criteria', desc: 'Measurable outcomes' },
                  { key: 'tasks', label: 'Auto-Generate Tasks', desc: '5-10 actionable tasks added to your board' },
                ].map(item => (
                  <label key={item.key} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
                    borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                    background: createSections[item.key] ? 'rgba(232,35,31,0.04)' : 'transparent',
                    border: `1px solid ${createSections[item.key] ? 'rgba(232,35,31,0.15)' : 'transparent'}`,
                  }}>
                    <input type="checkbox" checked={createSections[item.key]} onChange={() => toggleSection(item.key)}
                      style={{ marginTop: 2, accentColor: '#E8231F' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Launch Brief sections */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 11,
                    letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0A85FF',
                  }}>Launch Brief</span>
                  <button onClick={selectAllBrief} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)',
                    textDecoration: 'underline',
                  }}>Select all</button>
                </div>
                {[
                  { key: 'pitch', label: 'The Pitch', desc: 'One-paragraph elevator pitch' },
                  { key: 'problem', label: 'The Problem', desc: 'Market pain points and data' },
                  { key: 'solution', label: 'The Solution', desc: 'How your product solves it' },
                  { key: 'target_market', label: 'Target Market', desc: 'TAM, segments, and sizing' },
                  { key: 'mvp', label: 'MVP Feature Set', desc: 'Minimum viable product scope' },
                  { key: 'go_to_market', label: 'Go-To-Market Strategy', desc: '90-day launch plan' },
                  { key: 'key_metrics', label: 'Key Metrics', desc: '30/60/90 day targets' },
                  { key: 'funding', label: 'Funding Path', desc: 'Raise strategy and investor profile' },
                ].map(item => (
                  <label key={item.key} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
                    borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                    background: createSections[item.key] ? 'rgba(10,133,255,0.04)' : 'transparent',
                    border: `1px solid ${createSections[item.key] ? 'rgba(10,133,255,0.15)' : 'transparent'}`,
                  }}>
                    <input type="checkbox" checked={createSections[item.key]} onChange={() => toggleSection(item.key)}
                      style={{ marginTop: 2, accentColor: '#0A85FF' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 28px', borderTop: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <button onClick={selectAll} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: '#E8231F', fontFamily: 'var(--font-barlow-condensed)',
                fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                SELECT ALL
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowCreateModal(false)} className="btn btn-ghost btn-sm">
                  CANCEL
                </button>
                <button onClick={create} className="btn btn-primary"
                  disabled={!Object.values(createSections).some(v => v)}>
                  FORGE PROJECT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Concept Modal */}
      {showConceptModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999, backdropFilter: 'blur(4px)',
        }} onClick={() => setShowConceptModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-surface, #fff)', borderRadius: 16,
            border: '1px solid var(--border)', width: '100%', maxWidth: 560,
            maxHeight: '80vh', overflow: 'auto',
            boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
          }}>
            <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 18,
                letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 8,
              }}>
                Generate From Concept
              </h3>
              <input
                className="forge-input"
                placeholder="Describe your concept, product idea, or problem to solve..."
                value={concept}
                onChange={e => setConcept(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && concept.trim() && forgeFromConcept()}
                style={{ width: '100%' }}
                autoFocus
              />
            </div>

            <div style={{ padding: '20px 28px' }}>
              {/* Launch Brief sections */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 11,
                    letterSpacing: '0.08em', textTransform: 'uppercase', color: '#0A85FF',
                  }}>Launch Brief</span>
                  <button onClick={() => setConceptSections(prev => ({ ...prev, pitch: true, problem: true, solution: true, target_market: true, mvp: true, go_to_market: true, key_metrics: true, funding: true }))} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)',
                    textDecoration: 'underline',
                  }}>Select all</button>
                </div>
                {[
                  { key: 'pitch', label: 'The Pitch', desc: 'One-paragraph elevator pitch' },
                  { key: 'problem', label: 'The Problem', desc: 'Market pain points and data' },
                  { key: 'solution', label: 'The Solution', desc: 'How your product solves it' },
                  { key: 'target_market', label: 'Target Market', desc: 'TAM, segments, and sizing' },
                  { key: 'mvp', label: 'MVP Feature Set', desc: 'Minimum viable product scope' },
                  { key: 'go_to_market', label: 'Go-To-Market Strategy', desc: '90-day launch plan' },
                  { key: 'key_metrics', label: 'Key Metrics', desc: '30/60/90 day targets' },
                  { key: 'funding', label: 'Funding Path', desc: 'Raise strategy and investor profile' },
                ].map(item => (
                  <label key={item.key} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
                    borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                    background: conceptSections[item.key] ? 'rgba(10,133,255,0.04)' : 'transparent',
                    border: `1px solid ${conceptSections[item.key] ? 'rgba(10,133,255,0.15)' : 'transparent'}`,
                  }}>
                    <input type="checkbox" checked={conceptSections[item.key]} onChange={() => toggleConceptSection(item.key)}
                      style={{ marginTop: 2, accentColor: '#0A85FF' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Project Plan sections */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{
                    fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 11,
                    letterSpacing: '0.08em', textTransform: 'uppercase', color: '#E8231F',
                  }}>Project Plan</span>
                  <button onClick={() => setConceptSections(prev => ({ ...prev, overview: true, objectives: true, milestones: true, technical: true, success_criteria: true, tasks: true }))} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)',
                    textDecoration: 'underline',
                  }}>Select all</button>
                </div>
                {[
                  { key: 'overview', label: 'Overview', desc: 'Project description and scope' },
                  { key: 'objectives', label: 'Core Objectives', desc: '3-5 specific goals' },
                  { key: 'milestones', label: 'Key Milestones', desc: 'Timeline with phases' },
                  { key: 'technical', label: 'Technical Requirements', desc: 'Stack, constraints, architecture' },
                  { key: 'success_criteria', label: 'Success Criteria', desc: 'Measurable outcomes' },
                  { key: 'tasks', label: 'Auto-Generate Tasks', desc: '5-10 actionable tasks added to your board' },
                ].map(item => (
                  <label key={item.key} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px',
                    borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                    background: conceptSections[item.key] ? 'rgba(232,35,31,0.04)' : 'transparent',
                    border: `1px solid ${conceptSections[item.key] ? 'rgba(232,35,31,0.15)' : 'transparent'}`,
                  }}>
                    <input type="checkbox" checked={conceptSections[item.key]} onChange={() => toggleConceptSection(item.key)}
                      style={{ marginTop: 2, accentColor: '#E8231F' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 28px', borderTop: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <button onClick={() => setConceptSections(Object.fromEntries(Object.keys(conceptSections).map(k => [k, true])))} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: '#E8231F', fontFamily: 'var(--font-barlow-condensed)',
                fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                SELECT ALL
              </button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowConceptModal(false)} className="btn btn-ghost btn-sm">
                  CANCEL
                </button>
                <button onClick={forgeFromConcept} className="btn btn-primary"
                  disabled={!concept.trim() || !Object.values(conceptSections).some(v => v)}>
                  FORGE FROM CONCEPT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Form */}
      <GlassCard accent="#E8231F" accentTop accentGlow style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="forge-input"
            placeholder="Name your next build..."
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && openCreateModal()}
            style={{ flex: 1 }}
          />
          <button onClick={openCreateModal} disabled={creating || !newTitle.trim()} className="btn btn-primary">
            {creating ? 'FORGING...' : '+ NEW PROJECT'}
          </button>
          <button
            onClick={openConceptModal}
            className="btn btn-ghost btn-sm"
            style={{ color: '#E8231F', borderColor: 'rgba(255,45,45,0.22)', whiteSpace: 'nowrap', fontSize: 10 }}
            title="Generate a full project brief from a concept"
          >
            GENERATE FROM CONCEPT
          </button>
        </div>
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
                  <ProjectExpandedView
                    project={project}
                    currentPlan={currentPlan}
                    isPlanning={isPlanning}
                    streamingPlan={streamingPlan}
                    tasks={ptasks}
                    onForgePlan={() => forgePlan(project.id)}
                    onUpdateProject={(data) => {
                      api.projects.update(project.id, data)
                      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, ...data } : p))
                    }}
                  />
                )}
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}


// ─── Expanded Project View with Tabs ───────────────────────────────────────

type ProjectTab = 'plan' | 'notes' | 'tasks' | 'chat'

function ProjectExpandedView({
  project, currentPlan, isPlanning, streamingPlan, tasks,
  onForgePlan, onUpdateProject,
}: {
  project: Project
  currentPlan: string
  isPlanning: boolean
  streamingPlan: boolean
  tasks: Task[]
  onForgePlan: () => void
  onUpdateProject: (data: Partial<Project>) => void
}) {
  const [tab, setTab] = useState<ProjectTab>('plan')
  const [editingPlan, setEditingPlan] = useState(false)
  const [planDraft, setPlanDraft] = useState(currentPlan)
  const [notesDraft, setNotesDraft] = useState(project.notes || '')
  const [chatMessages, setChatMessages] = useState<{ id: string; role: string; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatStreaming, setChatStreaming] = useState(false)
  const [chatLoaded, setChatLoaded] = useState(false)

  // Load chat history when chat tab opened
  useEffect(() => {
    if (tab === 'chat' && !chatLoaded) {
      api.copilot.history(project.id).then(msgs => {
        setChatMessages(msgs)
        setChatLoaded(true)
      }).catch(() => {})
    }
  }, [tab, chatLoaded, project.id])

  async function sendChat() {
    if (!chatInput.trim() || chatStreaming) return
    const msg = chatInput
    setChatInput('')
    setChatMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: msg }])
    setChatStreaming(true)
    let assistantText = ''
    try {
      for await (const chunk of streamSSE('/api/copilot/message', { message: msg, project_id: project.id })) {
        if (chunk.type === 'text_delta') {
          assistantText += chunk.text
          setChatMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'assistant' && last.id === 'streaming') {
              return [...prev.slice(0, -1), { ...last, content: assistantText }]
            }
            return [...prev, { id: 'streaming', role: 'assistant', content: assistantText }]
          })
        }
      }
      // Finalize streaming message
      setChatMessages(prev => prev.map(m => m.id === 'streaming' ? { ...m, id: Date.now().toString() } : m))
    } catch { /* ignore */ }
    setChatStreaming(false)
  }

  function exportProject() {
    const lines = [`# ${project.title}\n`, `**Status:** ${project.status}\n`]
    if (currentPlan) lines.push(`## Plan\n\n${currentPlan}\n`)
    if (project.notes) lines.push(`## Notes\n\n${project.notes}\n`)
    if (tasks.length > 0) {
      lines.push(`## Tasks\n`)
      tasks.forEach(t => lines.push(`- [${t.status === 'completed' ? 'x' : ' '}] ${t.title}${t.description ? ': ' + t.description : ''}`))
      lines.push('')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${project.title.replace(/[^a-zA-Z0-9]/g, '_')}.md`; a.click()
    URL.revokeObjectURL(url)
  }

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', border: 'none', cursor: 'pointer',
    background: active ? 'rgba(232,35,31,0.08)' : 'transparent',
    color: active ? '#E8231F' : 'var(--text-muted)',
    fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
    fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
    borderBottom: active ? '2px solid #E8231F' : '2px solid transparent',
  })

  return (
    <div onClick={e => e.stopPropagation()} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 14, borderBottom: '1px solid var(--border)' }}>
        {(['plan', 'notes', 'tasks', 'chat'] as ProjectTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={TAB_STYLE(tab === t)}>
            {t === 'plan' ? 'Plan' : t === 'notes' ? 'Notes' : t === 'tasks' ? `Tasks (${tasks.length})` : 'Chat'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={exportProject} style={{ ...TAB_STYLE(false), color: 'var(--text-subtle)', fontSize: 9 }}>
          Export .md
        </button>
      </div>

      {/* Plan tab */}
      {tab === 'plan' && (
        <div>
          {editingPlan ? (
            <div>
              <textarea
                value={planDraft}
                onChange={e => setPlanDraft(e.target.value)}
                onBlur={() => { onUpdateProject({ plan: planDraft }); setEditingPlan(false) }}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); onUpdateProject({ plan: planDraft }); setEditingPlan(false) }}}
                autoFocus
                style={{
                  width: '100%', minHeight: 300, padding: 12, borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--bg)',
                  fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 12,
                  color: 'var(--text-primary)', resize: 'vertical', outline: 'none',
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 4, fontFamily: 'var(--font-ibm-plex-mono)' }}>
                Cmd+S to save, or click outside
              </div>
            </div>
          ) : currentPlan ? (
            <div>
              <div style={{ maxHeight: 400, overflow: 'auto' }}>
                <Markdown content={currentPlan} streaming={isPlanning && streamingPlan} />
              </div>
              <button onClick={() => { setPlanDraft(currentPlan); setEditingPlan(true) }} className="btn btn-ghost btn-sm" style={{ marginTop: 8, fontSize: 9, color: 'var(--text-muted)' }}>
                EDIT PLAN
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No plan yet.</span>
              <button onClick={onForgePlan} disabled={isPlanning} className="btn btn-ghost btn-sm" style={{ color: '#E8231F', borderColor: 'rgba(255,45,45,0.22)' }}>
                {isPlanning ? 'FORGING PLAN...' : 'FORGE PLAN'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Notes tab */}
      {tab === 'notes' && (
        <textarea
          value={notesDraft}
          onChange={e => setNotesDraft(e.target.value)}
          onBlur={() => onUpdateProject({ notes: notesDraft })}
          placeholder="Add project notes, ideas, research... Auto-saves when you click away."
          style={{
            width: '100%', minHeight: 200, padding: 12, borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--bg)',
            fontFamily: 'var(--font-barlow)', fontSize: 13,
            color: 'var(--text-primary)', resize: 'vertical', outline: 'none',
          }}
        />
      )}

      {/* Tasks tab */}
      {tab === 'tasks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tasks.length === 0 ? (
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No tasks yet. Forge a plan to auto-generate tasks.</span>
          ) : tasks.map(t => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              background: 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)',
            }}>
              <span className="badge" style={{
                background: t.status === 'completed' ? 'rgba(22,163,74,0.1)' : 'rgba(0,0,0,0.04)',
                color: t.status === 'completed' ? '#16A34A' : 'var(--text-muted)', fontSize: 8,
              }}>
                {t.status}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)', flex: 1 }}>
                {t.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Chat tab */}
      {tab === 'chat' && (
        <div style={{ display: 'flex', flexDirection: 'column', height: 350 }}>
          <div style={{ flex: 1, overflow: 'auto', marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chatMessages.length === 0 && !chatStreaming && (
              <span style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'var(--font-ibm-plex-mono)', padding: 12 }}>
                Ask COFOUND3R about this project — it has full context of the plan, tasks, and notes.
              </span>
            )}
            {chatMessages.map(m => (
              <div key={m.id} style={{
                padding: '8px 12px', borderRadius: 8, maxWidth: '85%',
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                background: m.role === 'user' ? 'rgba(232,35,31,0.08)' : 'var(--bg)',
                border: `1px solid ${m.role === 'user' ? 'rgba(232,35,31,0.15)' : 'var(--border)'}`,
              }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="forge-input"
              placeholder="Ask about this project..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              style={{ flex: 1 }}
            />
            <button onClick={sendChat} disabled={chatStreaming || !chatInput.trim()} className="btn btn-primary" style={{ fontSize: 10 }}>
              {chatStreaming ? '...' : 'SEND'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
