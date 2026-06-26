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
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<string | null>(null)
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

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteResult(null)
    try {
      const res = await api.workspace.invite(inviteEmail.trim())
      setInviteResult(`Invite sent: ${window.location.origin}${res.invite_url}`)
      setInviteEmail('')
    } catch { setInviteResult('Failed to send invite.') }
    finally { setInviting(false) }
  }

  const openTasks = tasks.filter(t => t.status !== 'completed')
  const recentThreads = threads.slice(0, 5)

  return (
    <div style={{ maxWidth: 1100, fontFamily: 'var(--font-archivo)' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10, color: 'var(--color-n600)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>Dashboard</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-ink)', letterSpacing: '-0.01em' }}>
          {user?.display_name ? `Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${user.display_name.split(' ')[0]}.` : 'Overview'}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Open tasks', value: openTasks.length, href: null },
          { label: 'Knowledge items', value: knowledge.length, href: '/knowledge' },
          { label: 'COFOUND3R chats', value: threads.length, href: '/agents' },
        ].map(s => (
          <div key={s.label} style={{ border: '1px solid var(--color-n200)', padding: '16px 18px', background: 'var(--color-vellum)' }}>
            <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n600)', letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-ink)', lineHeight: 1 }}>{loading ? '—' : s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 280px', gap: 14 }}>

        {/* Tasks widget */}
        <div style={{ border: '1px solid var(--color-n200)', background: 'var(--color-vellum)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n600)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Tasks</div>

          {/* Add task */}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTask()}
              placeholder="Add a task..."
              style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--color-n200)', background: 'var(--color-off-white)', fontFamily: 'var(--font-archivo)', fontSize: 13, color: 'var(--color-ink)', outline: 'none', borderRadius: 2 }}
            />
            <button onClick={addTask} disabled={addingTask || !newTask.trim()} style={{ padding: '7px 12px', background: 'var(--color-ink)', color: 'var(--color-off-white)', border: 'none', borderRadius: 2, fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 11, cursor: 'pointer', letterSpacing: '0.06em' }}>
              +
            </button>
          </div>

          {/* Task list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflow: 'auto' }}>
            {loading ? <div style={{ color: 'var(--color-n400)', fontSize: 12 }}>Loading...</div>
            : openTasks.length === 0 ? <div style={{ color: 'var(--color-n400)', fontFamily: 'var(--font-plex-mono)', fontSize: 11 }}>No open tasks.</div>
            : openTasks.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--color-n200)' }}>
                <button onClick={() => completeTask(t.id)} style={{ width: 16, height: 16, border: '1.5px solid var(--color-n300)', borderRadius: 2, background: 'transparent', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                </button>
                <div style={{ flex: 1, fontSize: 13, color: 'var(--color-ink)', lineHeight: 1.4 }}>{t.title}</div>
                <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n400)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t.priority}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent COFOUND3R threads */}
        <div style={{ border: '1px solid var(--color-n200)', background: 'var(--color-vellum)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n600)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Recent chats</div>
            <Link href="/agents" style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n600)', textDecoration: 'none' }}>New chat →</Link>
          </div>
          {recentThreads.length === 0 ? (
            <div style={{ color: 'var(--color-n400)', fontFamily: 'var(--font-plex-mono)', fontSize: 11 }}>
              No chats yet. <Link href="/agents" style={{ color: 'var(--color-ink)' }}>Start one →</Link>
            </div>
          ) : recentThreads.map(t => (
            <Link key={t.id} href="/agents" style={{ textDecoration: 'none', display: 'block', padding: '8px 0', borderBottom: '1px solid var(--color-n200)' }}>
              <div style={{ fontSize: 13, color: 'var(--color-ink)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || 'Untitled chat'}</div>
              <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n400)' }}>{timeAgo(t.created_at)}</div>
            </Link>
          ))}
        </div>

        {/* Activity + Team */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Activity */}
          <div style={{ border: '1px solid var(--color-n200)', background: 'var(--color-vellum)', padding: '16px 18px', flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n600)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>Activity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflow: 'auto' }}>
              {events.length === 0 ? <div style={{ color: 'var(--color-n400)', fontSize: 11 }}>No activity yet.</div>
              : events.slice(0, 8).map(ev => (
                <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ width: 3, minHeight: 16, background: 'var(--color-arc-cyan)', borderRadius: 2, flexShrink: 0, marginTop: 3 }} />
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-ink)', lineHeight: 1.4 }}>{ev.title}</div>
                    <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n400)', marginTop: 1 }}>{timeAgo(ev.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Team invite */}
          <div style={{ border: '1px solid var(--color-n200)', background: 'var(--color-vellum)', padding: '16px 18px' }}>
            <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n600)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
              Team · {members.length} {members.length === 1 ? 'member' : 'members'}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendInvite()}
                placeholder="email@domain.com"
                style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--color-n200)', background: 'var(--color-off-white)', fontFamily: 'var(--font-archivo)', fontSize: 12, color: 'var(--color-ink)', outline: 'none', borderRadius: 2 }}
              />
              <button onClick={sendInvite} disabled={inviting || !inviteEmail.trim()} style={{ padding: '7px 10px', background: 'var(--color-ink)', color: 'var(--color-off-white)', border: 'none', borderRadius: 2, fontFamily: 'var(--font-archivo)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
                {inviting ? '...' : 'Invite'}
              </button>
            </div>
            {inviteResult && <div style={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, color: 'var(--color-n600)', marginTop: 8, lineHeight: 1.5, wordBreak: 'break-all' }}>{inviteResult}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
