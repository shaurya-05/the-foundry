'use client'

import { useEffect, useState } from 'react'
import { api, Task, ActivityEvent, WorkspaceMember } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'
import Link from 'next/link'
import H3roVoiceStage from '@/components/h3ro/H3roVoiceStage'
import Glyph3 from '@/components/brand/Glyph3'

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

type DashTab = 'h3ro' | 'overview'

export default function DashboardClient() {
  const { user } = useAuth()
  const [tab, setTab] = useState<DashTab>('h3ro')
  const [tasks, setTasks] = useState<Task[]>([])
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [threads, setThreads] = useState<{ id: string; title: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [newTask, setNewTask] = useState('')
  const [addingTask, setAddingTask] = useState(false)

  useEffect(() => {
    Promise.all([
      api.tasks.list(),
      api.context.timeline(20),
      api.workspace.members(),
    ]).then(([t, ev, m]) => {
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
    } catch { /* ignore */ } finally { setAddingTask(false) }
  }

  async function completeTask(id: string) {
    try {
      await api.tasks.update(id, { status: 'completed' })
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'completed' } : t))
    } catch { /* ignore */ }
  }

  const openTasks = tasks.filter(t => t.status !== 'completed')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.display_name?.split(' ')[0]

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      minHeight: 0,
      fontFamily: 'var(--font-archivo)',
    }}>
      {/* Tabs */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 2px 12px',
        flexShrink: 0,
      }}>
        <TabButton active={tab === 'h3ro'} onClick={() => setTab('h3ro')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.02em', lineHeight: 1 }}>
            <span>H</span>
            <Glyph3 size="1em" color="currentColor" />
            <span>RO</span>
          </span>
        </TabButton>
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          Overview
        </TabButton>
        <Link
          href="/agents"
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-ibm-plex-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-n400)',
            textDecoration: 'none',
            padding: '6px 10px',
          }}
        >
          Text chat →
        </Link>
      </div>

      {tab === 'h3ro' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <H3roVoiceStage />
        </div>
      ) : (
        <div
          className="command-center-rail"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            paddingBottom: 24,
            overflow: 'auto',
            flex: 1,
            minHeight: 0,
          }}
        >
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
              Tasks, activity, and crew — talk with H3RO anytime from the H3RO tab.
            </p>
          </div>

          <div className="command-center-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {[
              { label: 'Open tasks', value: openTasks.length },
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
                    No open tasks — ask H3RO what to prioritize.
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
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
        background: active ? 'var(--color-arc-soft)' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'var(--border-accent, var(--border))' : 'var(--border)',
        borderRadius: 10,
        cursor: 'pointer',
        fontFamily: 'var(--font-archivo)',
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: active ? 'var(--color-ink)' : 'var(--color-n600)',
      }}
    >
      {children}
    </button>
  )
}
