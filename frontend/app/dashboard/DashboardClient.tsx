'use client'

import { useEffect, useState } from 'react'
import { api, KnowledgeItem, Project, Task, Idea, ActivityEvent, WorkspaceMember } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import OnboardingGuide from '@/components/layout/OnboardingGuide'
import { useAuth } from '@/lib/auth'
import Link from 'next/link'

const STATUS_COLORS: Record<string, string> = {
  active: '#16A34A',
  paused: '#F06A00',
  completed: '#0A85FF',
}

const EVENT_COLORS: Record<string, string> = {
  knowledge_added: '#0A85FF',
  project_created: '#E8231F',
  idea_generated: '#F06A00',
  task_created: '#0891B2',
  task_completed: '#16A34A',
  agent_run: '#7C3AED',
  pipeline_run: '#E8231F',
  insight_discovered: '#F06A00',
}

const ROLE_COLORS: Record<string, string> = {
  owner: '#E8231F',
  admin: '#F06A00',
  member: '#7C3AED',
  viewer: '#4A5A72',
}

export default function DashboardClient() {
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.knowledge.list(),
      api.projects.list(),
      api.tasks.list(),
      api.ideas.list(),
      api.context.timeline(20),
      api.workspace.members(),
    ]).then(([k, p, t, i, ev, m]) => {
      setKnowledge(k)
      setProjects(p)
      setTasks(t)
      setIdeas(i)
      setEvents(ev.events)
      setMembers(m.members)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    setInviting(true)
    setInviteResult(null)
    try {
      const res = await api.workspace.invite(inviteEmail.trim())
      setInviteResult(`Invite link: ${window.location.origin}${res.invite_url}`)
      setInviteEmail('')
    } catch {
      setInviteResult('Failed to send invite.')
    } finally {
      setInviting(false)
    }
  }

  const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'blocked')
  const blockedTasks = tasks.filter(t => t.status === 'blocked')
  const completedTasks = tasks.filter(t => t.status === 'completed')
  const activeProjects = projects.filter(p => p.status === 'active')
  const recentProjects = [...projects].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 4)
  const urgentTasks = [...activeTasks].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    return (order[a.priority] ?? 2) - (order[b.priority] ?? 2)
  }).slice(0, 6)

  const PRIORITY_COLORS: Record<string, string> = {
    critical: '#E8231F',
    high: '#F06A00',
    medium: '#FFD600',
    low: '#4A5A72',
  }

  return (
    <div className="page-enter" style={{ maxWidth: 1200 }}>
      <SectionHeader title="Overview" sublabel="Dashboard" accent="#E8231F">
        <span className="badge" style={{ background: 'rgba(255,45,45,0.10)', color: '#E8231F', border: '1px solid rgba(255,45,45,0.20)' }}>
          <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#E8231F', boxShadow: '0 0 5px rgba(255,45,45,0.9)', animation: 'pulse-dot 2.4s ease-in-out infinite', marginRight: 5 }} />
          LIVE
        </span>
      </SectionHeader>

      {/* Onboarding for new users */}
      <DashboardOnboarding projects={projects} knowledge={knowledge} />

      {/* Top stats row */}
      <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Active Projects', value: activeProjects.length, color: '#E8231F', href: '/projects' },
          { label: 'Open Tasks', value: activeTasks.length, color: '#0891B2', href: '/tasks' },
          { label: 'Blocked', value: blockedTasks.length, color: '#F06A00', href: '/tasks' },
          { label: 'Knowledge', value: knowledge.length, color: '#0A85FF', href: '/knowledge' },
          { label: 'Ideas', value: ideas.length, color: '#F06A00', href: '/ideas' },
        ].map(stat => (
          <Link key={stat.label} href={stat.href} style={{ textDecoration: 'none' }}>
            <GlassCard hover style={{ padding: '14px 16px' }}>
              <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: `${stat.color}BB`, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 6 }}>
                {stat.label}
              </div>
              <div className="stat-number" style={{ fontSize: 36, color: stat.value > 0 ? 'var(--text-primary)' : 'var(--text-subtle)' }}>
                {loading ? '—' : stat.value}
              </div>
            </GlassCard>
          </Link>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 300px', gap: 14 }}>
        {/* Recent Projects */}
        <GlassCard style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: 'var(--text-subtle)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Active Projects
            </div>
            <Link href="/projects" style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', textDecoration: 'none', letterSpacing: '0.06em' }}>
              VIEW ALL →
            </Link>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {loading ? (
              <div style={{ color: 'var(--text-subtle)', fontSize: 12 }}>Loading...</div>
            ) : recentProjects.length === 0 ? (
              <div style={{ color: 'var(--text-subtle)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, textAlign: 'center', padding: '20px 0' }}>
                No projects yet. <Link href="/projects" style={{ color: '#E8231F' }}>Create one →</Link>
              </div>
            ) : recentProjects.map(p => {
              const ptasks = tasks.filter(t => t.project_id === p.id)
              const done = ptasks.filter(t => t.status === 'completed').length
              const progress = ptasks.length > 0 ? done / ptasks.length : 0
              const color = STATUS_COLORS[p.status] || '#4A5A72'
              return (
                <Link key={p.id} href="/projects" style={{ textDecoration: 'none', display: 'block' }}>
                  <div
                    className="lift"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'var(--bg-mid)',
                      border: '1px solid rgba(0,0,0,0.04)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ptasks.length > 0 ? 8 : 0 }}>
                      <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 13, letterSpacing: '0.04em', color: 'var(--text-primary)', textTransform: 'uppercase' }}>
                        {p.title}
                      </div>
                      <span className="badge" style={{ background: `${color}15`, color, border: `1px solid ${color}25`, fontSize: 7.5 }}>
                        {p.status}
                      </span>
                    </div>
                    {ptasks.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 2, background: 'rgba(0,0,0,0.06)', borderRadius: 1, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${progress * 100}%`, background: color, borderRadius: 1, transition: 'width 0.4s ease' }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8, color: 'var(--text-muted)', flexShrink: 0 }}>
                          {done}/{ptasks.length}
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </GlassCard>

        {/* Open Tasks */}
        <GlassCard style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: 'var(--text-subtle)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Open Tasks
            </div>
            <Link href="/tasks" style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)', textDecoration: 'none', letterSpacing: '0.06em' }}>
              VIEW ALL →
            </Link>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {loading ? (
              <div style={{ color: 'var(--text-subtle)', fontSize: 12 }}>Loading...</div>
            ) : urgentTasks.length === 0 ? (
              <div style={{ color: 'var(--text-subtle)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, textAlign: 'center', padding: '20px 0' }}>
                No open tasks. <Link href="/tasks" style={{ color: '#0891B2' }}>Add one →</Link>
              </div>
            ) : urgentTasks.map(t => {
              const pc = PRIORITY_COLORS[t.priority] || '#4A5A72'
              const proj = projects.find(p => p.id === t.project_id)
              return (
                <Link key={t.id} href="/tasks" style={{ textDecoration: 'none', display: 'block' }}>
                  <div
                    className="lift"
                    style={{
                      padding: '9px 12px',
                      borderRadius: 8,
                      background: 'var(--bg-mid)',
                      border: '1px solid rgba(0,0,0,0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: pc, flexShrink: 0, boxShadow: t.priority === 'critical' ? `0 0 6px ${pc}` : 'none' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                      </div>
                      {proj && (
                        <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: 'var(--text-subtle)', marginTop: 1 }}>
                          {proj.title}
                        </div>
                      )}
                    </div>
                    <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 7.5, color: pc, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                      {t.priority}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </GlassCard>

        {/* Activity Feed */}
        <GlassCard style={{ padding: '16px 18px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: 'var(--text-subtle)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Activity
            </div>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A', boxShadow: '0 0 5px rgba(45,204,114,0.8)', animation: 'pulse-dot 2.4s ease-in-out infinite' }} />
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {events.length === 0 ? (
              <div style={{ color: 'var(--text-subtle)', fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, padding: '16px 0' }}>
                No activity yet.
              </div>
            ) : (
              events.map(ev => {
                const color = EVENT_COLORS[ev.type] || '#4A5A72'
                return (
                  <div
                    key={ev.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      paddingBottom: 10,
                      marginBottom: 10,
                      borderBottom: '1px solid rgba(0,0,0,0.03)',
                    }}
                  >
                    <div style={{ width: 3, borderRadius: 2, background: color, flexShrink: 0, alignSelf: 'stretch', minHeight: 20 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 11.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.title}
                      </div>
                      <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: 'var(--text-subtle)', marginTop: 2 }}>
                        {timeAgo(ev.created_at)}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </GlassCard>
      </div>

      {/* Team Panel */}
      <GlassCard style={{ padding: '16px 18px', marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: 'var(--text-subtle)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Team
            </div>
            <span className="stat-number" style={{ fontSize: 20, color: 'var(--text-primary)' }}>
              {members.length}
            </span>
            <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-muted)' }}>
              {members.length === 1 ? 'member' : 'members'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            {[
              { label: 'Private', value: projects.filter(p => p.visibility === 'private').length, color: '#4A5A72' },
              { label: 'Team', value: projects.filter(p => p.visibility === 'team').length, color: '#7C3AED' },
              { label: 'Public', value: projects.filter(p => p.visibility === 'public').length, color: '#16A34A' },
            ].map(s => (
              <div key={s.label} style={{ textAlign: 'center' }}>
                <div className="stat-number" style={{ fontSize: 18, color: s.color }}>{loading ? '—' : s.value}</div>
                <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 7.5, color: 'var(--text-subtle)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {members.length === 0 ? (
              <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10, color: 'var(--text-subtle)' }}>No team members yet.</div>
            ) : members.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7,
                  background: `${ROLE_COLORS[m.role] || '#4A5A72'}18`,
                  border: `1px solid ${ROLE_COLORS[m.role] || '#4A5A72'}25`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 12,
                  color: ROLE_COLORS[m.role] || '#4A5A72',
                }}>
                  {m.email.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.email}
                  </div>
                  <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8, color: ROLE_COLORS[m.role] || '#4A5A72', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {m.role}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 8.5, color: 'var(--text-subtle)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Invite
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="forge-input"
                placeholder="email@domain.com"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendInvite()}
                style={{ flex: 1, fontSize: 12 }}
              />
              <button
                onClick={sendInvite}
                disabled={inviting || !inviteEmail.trim()}
                className="btn btn-ghost btn-sm"
                style={{ color: '#7C3AED', borderColor: 'rgba(155,123,255,0.25)', whiteSpace: 'nowrap' }}
              >
                {inviting ? '...' : 'INVITE'}
              </button>
            </div>
            {inviteResult && (
              <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: inviteResult.startsWith('Invite') ? '#16A34A' : '#E8231F', marginTop: 8, wordBreak: 'break-all', lineHeight: 1.5 }}>
                {inviteResult}
              </div>
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function DashboardOnboarding({ projects, knowledge }: { projects: Project[]; knowledge: KnowledgeItem[] }) {
  const { user } = useAuth()
  const isNew = projects.length === 0 && knowledge.length === 0
  const dismissed = user?.preferences?.onboarding_dismissed === true
  if (!isNew || dismissed) return null
  return <OnboardingGuide />
}
