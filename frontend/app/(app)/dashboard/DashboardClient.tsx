'use client'

import { useEffect, useState } from 'react'
import { api, KnowledgeItem, Task, ActivityEvent, WorkspaceMember } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'
import Link from 'next/link'

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function DashboardClient() {
  const { user } = useAuth()
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [threads, setThreads] = useState<{id:string;title:string;created_at:string}[]>([])
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [addingTask, setAddingTask] = useState(false)

  useEffect(() => {
    Promise.all([
      api.knowledge.list(),
      api.tasks.list(),
      api.context.timeline(20),
      api.workspace.members(),
    ]).then(([k, t, ev, m]) => {
      setKnowledge(k)
      setTasks(t)
      setEvents(ev.events)
      setMembers(m.members)
    }).catch(console.error).finally(() => setLoading(false))

    const token = getToken()
    if (token) {
      fetch(`${API_URL}/api/copilot/threads`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : [])
        .then(setThreads)
        .catch(() => {})
    }
  }, [])

  async function addTask() {
    if (!newTask.trim()) return
    setAddingTask(true)
    try {
      const t = await api.tasks.create({ title: newTask.trim(), priority: 'medium', status: 'todo' })
      setTasks(prev => [t, ...prev])
      setNewTask('')
    } catch {} finally { setAddingTask(false) }
  }

  async function completeTask(id: string) {
    try {
      await api.tasks.update(id, { status: 'completed' })
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'completed' } : t))
    } catch {}
  }

  const openTasks = tasks.filter(t => t.status !== 'completed')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.display_name?.split(' ')[0]

  return (
    <div
      className="command-center-rail"
      style={{
        fontFamily: 'var(--font-archivo)',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        paddingBottom: 24,
      }}
    >
      {/* Greeting — quiet, one job */}
      <div style={{ marginBottom: 4 }}>
        <div style={{
          fontFamily: 'var(--font-ibm-plex-mono), monospace',
          fontSize: 10,
          color: 'var(--color-n400)',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Command center
        </div>
        <h1 style={{
          fontFamily: 'var(--font-archivo), system-ui, sans-serif',
          fontSize: 'clamp(1.6rem, 2.4vw, 2rem)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          textTransform: 'none',
          color: 'var(--color-ink)',
          lineHeight: 1.15,
          margin: 0,
        }}>
          {firstName ? `${greeting}, ${firstName}.` : 'Overview'}
        </h1>
        <p style={{
          marginTop: 8,
          fontSize: 14,
          color: 'var(--color-n600)',
          maxWidth: 420,
          lineHeight: 1.5,
        }}>
          Your co-founder is online. Context sits here — conversation lives in the glass.
        </p>
      </div>

      {/* Stats — opaque bay panels under glass chrome */}
      <div className="command-center-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: 'Open tasks', value: openTasks.length },
          { label: 'Knowledge', value: knowledge.length },
          { label: 'Chats', value: threads.length },
        ].map(s => (
          <div key={s.label} className="bay-panel" style={{ padding: '14px 16px' }}>
            <div style={{
              fontFamily: 'var(--font-ibm-plex-mono), monospace',
              fontSize: 9,
              color: 'var(--color-n400)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}>{s.label}</div>
            <div style={{
              fontSize: 28,
              fontWeight: 700,
              color: 'var(--color-ink)',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
            }}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      {/* Tasks + Activity — content panels (not glass) */}
      <div className="command-center-grid">
        <div className="bay-panel" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            fontFamily: 'var(--font-ibm-plex-mono), monospace',
            fontSize: 9,
            color: 'var(--color-n400)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}>Focus</div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTask()}
              placeholder="Add a task…"
              style={{
                flex: 1,
                padding: '9px 12px',
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.35)',
                fontFamily: 'var(--font-archivo)',
                fontSize: 13,
                color: 'var(--color-ink)',
                outline: 'none',
                borderRadius: 10,
              }}
            />
            <button
              onClick={addTask}
              disabled={addingTask || !newTask.trim()}
              className="btn btn-primary btn-sm"
              style={{ opacity: addingTask || !newTask.trim() ? 0.45 : 1 }}
            >
              Add
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflow: 'auto' }}>
            {loading ? (
              <div style={{ color: 'var(--color-n400)', fontSize: 12 }}>Loading…</div>
            ) : openTasks.length === 0 ? (
              <div style={{ color: 'var(--color-n400)', fontFamily: 'var(--font-ibm-plex-mono), monospace', fontSize: 11 }}>
                No open tasks — ask COFOUND3R what to prioritize.
              </div>
            ) : openTasks.slice(0, 8).map(t => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 4px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <button
                  onClick={() => completeTask(t.id)}
                  aria-label="Complete"
                  style={{
                    width: 16,
                    height: 16,
                    border: '1.5px solid var(--color-n300)',
                    borderRadius: 4,
                    background: 'transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, fontSize: 13, color: 'var(--color-ink)', lineHeight: 1.4 }}>{t.title}</div>
                <div style={{
                  fontFamily: 'var(--font-ibm-plex-mono), monospace',
                  fontSize: 9,
                  color: 'var(--color-n400)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>{t.priority}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="bay-panel" style={{ padding: '16px 18px', flex: 1 }}>
            <div style={{
              fontFamily: 'var(--font-ibm-plex-mono), monospace',
              fontSize: 9,
              color: 'var(--color-n400)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 12,
            }}>Activity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 220, overflow: 'auto' }}>
              {events.length === 0 ? (
                <div style={{ color: 'var(--color-n400)', fontSize: 11 }}>No activity yet.</div>
              ) : events.slice(0, 6).map(ev => (
                <div key={ev.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 3,
                    minHeight: 14,
                    background: 'var(--color-arc-cyan)',
                    borderRadius: 2,
                    flexShrink: 0,
                    marginTop: 3,
                    opacity: 0.85,
                  }} />
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--color-ink)', lineHeight: 1.4 }}>{ev.title}</div>
                    <div style={{
                      fontFamily: 'var(--font-ibm-plex-mono), monospace',
                      fontSize: 9,
                      color: 'var(--color-n400)',
                      marginTop: 2,
                    }}>{timeAgo(ev.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bay-panel" style={{ padding: '14px 16px' }}>
            <div style={{
              fontFamily: 'var(--font-ibm-plex-mono), monospace',
              fontSize: 9,
              color: 'var(--color-n400)',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              Crew · {members.length}
            </div>
            <Link
              href="/settings"
              style={{
                fontSize: 12,
                color: 'var(--color-arc-cyan)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Manage workspace →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
