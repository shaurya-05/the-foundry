'use client'

import { useEffect, useState } from 'react'
import { api, Task, Project } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import EmptyState from '@/components/ui/EmptyState'

const COLUMNS = [
  { id: 'todo', label: 'TO DO', color: '#6B7280' },
  { id: 'in_progress', label: 'IN PROGRESS', color: '#F06A00' },
  { id: 'review', label: 'IN REVIEW', color: '#0A85FF' },
  { id: 'blocked', label: 'BLOCKED', color: '#E8231F' },
  { id: 'completed', label: 'COMPLETED', color: '#16A34A' },
]

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#E8231F',
  high: '#F06A00',
  medium: '#F5C518',
  low: '#0891B2',
}

export default function TasksClient() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState('medium')
  const [newProjectId, setNewProjectId] = useState('')
  const [creating, setCreating] = useState(false)
  const [modal, setModal] = useState<Task | null>(null)
  const [editFields, setEditFields] = useState<Partial<Task>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const [t, p] = await Promise.all([api.tasks.list(), api.projects.list()])
      setTasks(t)
      setProjects(p)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  async function create() {
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const t = await api.tasks.create({
        title: newTitle,
        priority: newPriority,
        project_id: newProjectId || undefined,
      })
      setTasks(prev => [t, ...prev])
      setNewTitle('')
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  async function updateStatus(id: string, status: string) {
    await api.tasks.update(id, { status })
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t))
  }

  async function saveModal() {
    if (!modal) return
    const updated = await api.tasks.update(modal.id, editFields)
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    setModal(null)
  }

  async function deleteTask(id: string) {
    await api.tasks.delete(id)
    setTasks(prev => prev.filter(t => t.id !== id))
    if (modal?.id === id) setModal(null)
  }

  function getTasksForColumn(status: string) {
    return tasks.filter(t => t.status === status)
  }

  function handleDragStart(id: string) { setDragging(id) }
  function handleDragEnd() { setDragging(null); setDragOver(null) }
  function handleDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault()
    setDragOver(colId)
  }
  async function handleDrop(colId: string) {
    if (dragging) {
      await updateStatus(dragging, colId)
    }
    setDragging(null)
    setDragOver(null)
  }

  const totalActive = tasks.filter(t => t.status !== 'completed').length

  return (
    <div className="page-enter" style={{ maxWidth: '100%' }}>
      <SectionHeader title="Tasks" sublabel="Task board" accent="#0891B2">
        <span className="badge" style={{ background: 'rgba(14,232,200,0.08)', color: '#0891B2', border: '1px solid rgba(14,232,200,0.18)' }}>
          {totalActive} ACTIVE
        </span>
      </SectionHeader>

      {/* Quick add */}
      <GlassCard accent="#0891B2" accentTop style={{ padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="forge-input"
            placeholder="New task..."
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
            style={{ flex: 1 }}
          />
          <select
            className="forge-input"
            value={newPriority}
            onChange={e => setNewPriority(e.target.value)}
            style={{ width: 110, cursor: 'pointer' }}
          >
            <option value="critical">CRITICAL</option>
            <option value="high">HIGH</option>
            <option value="medium">MEDIUM</option>
            <option value="low">LOW</option>
          </select>
          <select
            className="forge-input"
            value={newProjectId}
            onChange={e => setNewProjectId(e.target.value)}
            style={{ width: 140, cursor: 'pointer' }}
          >
            <option value="">No project</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.title.slice(0, 20)}</option>
            ))}
          </select>
          <button
            onClick={create}
            disabled={creating || !newTitle.trim()}
            className="btn btn-primary"
            style={{ background: '#0891B2', flexShrink: 0 }}
          >
            + ADD
          </button>
        </div>
      </GlassCard>

      {/* Kanban board */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
          minHeight: 400,
        }}
      >
        {COLUMNS.map(col => {
          const colTasks = getTasksForColumn(col.id)
          const isOver = dragOver === col.id
          return (
            <div
              key={col.id}
              onDragOver={e => handleDragOver(e, col.id)}
              onDrop={() => handleDrop(col.id)}
              style={{
                background: isOver ? `${col.color}08` : 'transparent',
                border: `1px solid ${isOver ? col.color + '30' : 'rgba(0,0,0,0.04)'}`,
                borderRadius: 10,
                padding: '12px 10px',
                transition: 'all 0.15s ease',
                minHeight: 200,
              }}
            >
              {/* Column header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: col.color,
                    flexShrink: 0,
                  }}
                  className={col.id === 'in_progress' ? 'accent-dot' : ''}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-ibm-plex-mono)',
                    fontSize: 9,
                    color: col.color,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  {col.label}
                </span>
                <span
                  className="badge"
                  style={{ background: `${col.color}15`, color: col.color, marginLeft: 'auto', fontSize: 8 }}
                >
                  {colTasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {colTasks.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-subtle)', fontSize: 11, padding: '20px 0', fontFamily: 'var(--font-ibm-plex-mono)' }}>
                    —
                  </div>
                ) : (
                  colTasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => handleDragStart(task.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => { setModal(task); setEditFields({}) }}
                      className="gl1 lift"
                      style={{
                        padding: '10px 12px',
                        cursor: 'grab',
                        opacity: dragging === task.id ? 0.5 : 1,
                        borderLeft: `2px solid ${PRIORITY_COLORS[task.priority] || '#637080'}`,
                      }}
                    >
                      <div
                        style={{
                          fontFamily: 'var(--font-barlow)',
                          fontSize: 12,
                          color: 'var(--text-primary)',
                          marginBottom: 6,
                          lineHeight: 1.4,
                        }}
                      >
                        {task.title}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <span
                          className="badge"
                          style={{
                            background: `${PRIORITY_COLORS[task.priority]}18`,
                            color: PRIORITY_COLORS[task.priority],
                            fontSize: 8,
                          }}
                        >
                          {task.priority}
                        </span>
                        {task.source !== 'manual' && (
                          <span
                            className="badge"
                            style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED', fontSize: 8 }}
                          >
                            {task.source}
                          </span>
                        )}
                        {task.due_date && (
                          <span
                            className="badge"
                            style={{ background: 'rgba(0,0,0,0.03)', color: 'var(--text-muted)', fontSize: 8 }}
                          >
                            {task.due_date}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Task Modal */}
      {modal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.25)',
            backdropFilter: 'blur(4px)',
          }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null) }}
        >
          <GlassCard
            tier={2}
            style={{ width: 480, padding: '24px', maxHeight: '80vh', overflow: 'auto' }}
            onClick={(e) => e?.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 16, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
                EDIT TASK
              </div>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20 }}>×</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Title</label>
                <input
                  className="forge-input"
                  defaultValue={modal.title}
                  onChange={e => setEditFields(f => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea
                  className="forge-input"
                  rows={3}
                  defaultValue={modal.description || ''}
                  onChange={e => setEditFields(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Status</label>
                  <select
                    className="forge-input"
                    defaultValue={modal.status}
                    onChange={e => setEditFields(f => ({ ...f, status: e.target.value }))}
                    style={{ cursor: 'pointer' }}
                  >
                    {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Priority</label>
                  <select
                    className="forge-input"
                    defaultValue={modal.priority}
                    onChange={e => setEditFields(f => ({ ...f, priority: e.target.value }))}
                    style={{ cursor: 'pointer' }}
                  >
                    {Object.keys(PRIORITY_COLORS).map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Project</label>
                <select
                  className="forge-input"
                  defaultValue={modal.project_id || ''}
                  onChange={e => setEditFields(f => ({ ...f, project_id: e.target.value || undefined }))}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">No project</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Due Date</label>
                <input
                  type="date"
                  className="forge-input"
                  defaultValue={modal.due_date || ''}
                  onChange={e => setEditFields(f => ({ ...f, due_date: e.target.value || undefined }))}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={saveModal} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', background: '#0891B2' }}>
                  SAVE CHANGES
                </button>
                <button
                  onClick={() => deleteTask(modal.id)}
                  className="btn btn-ghost"
                  style={{ color: '#E8231F', borderColor: 'rgba(255,59,59,0.2)' }}
                >
                  DELETE
                </button>
              </div>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
