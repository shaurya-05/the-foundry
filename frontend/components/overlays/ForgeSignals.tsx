'use client'

import { useEffect, useState } from 'react'
import { api, AppNotification } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'

interface ForgeSignalsProps {
  onClose: () => void
  onUnreadChange: (count: number) => void
}

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  agent_complete: { icon: '⚡', color: '#9B7BFF' },
  task_created: { icon: '✓', color: '#22D3EE' },
  task_completed: { icon: '✓', color: '#2DCC72' },
  pipeline_run: { icon: '▶', color: '#FF2D2D' },
  insight: { icon: '◆', color: '#FF8A2A' },
  connection: { icon: '⟷', color: '#2AB8FF' },
  knowledge_added: { icon: '▣', color: '#2AB8FF' },
  project_created: { icon: '⬡', color: '#FF2D2D' },
  idea_generated: { icon: '✦', color: '#FF8A2A' },
  agent_run: { icon: '⚡', color: '#9B7BFF' },
}

export default function ForgeSignals({ onClose, onUnreadChange }: ForgeSignalsProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      const data = await api.notifications.list()
      setNotifications(data)
      onUnreadChange(data.filter(n => !n.read).length)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function markRead(id: string) {
    await api.notifications.markRead(id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    onUnreadChange(notifications.filter(n => !n.read && n.id !== id).length)
  }

  async function markAll() {
    await api.notifications.markAllRead()
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    onUnreadChange(0)
  }

  async function dismiss(id: string) {
    await api.notifications.delete(id)
    const updated = notifications.filter(n => n.id !== id)
    setNotifications(updated)
    onUnreadChange(updated.filter(n => !n.read).length)
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 52,
        right: 0,
        bottom: 0,
        width: 360,
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
      }}
      className="gl3"
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 18px 12px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-barlow-condensed)',
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-primary)',
          }}
        >
          FORGE SIGNALS
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {notifications.some(n => !n.read) && (
            <button
              onClick={markAll}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 10 }}
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading signals...
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No signals. The FOUND3RY is quiet.
          </div>
        ) : (
          notifications.map(n => {
            const ev = EVENT_ICONS[n.type] || { icon: '◉', color: '#637080' }
            return (
              <div
                key={n.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '10px 18px',
                  background: n.read ? 'transparent' : 'rgba(255,255,255,0.024)',
                  borderLeft: n.read ? '2px solid transparent' : `2px solid ${ev.color}`,
                  cursor: 'pointer',
                }}
                onClick={() => !n.read && markRead(n.id)}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: `${ev.color}18`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    flexShrink: 0,
                  }}
                >
                  {ev.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-barlow)',
                      fontWeight: n.read ? 400 : 600,
                      fontSize: 13,
                      color: n.read ? 'var(--text-secondary)' : 'var(--text-primary)',
                      marginBottom: 2,
                    }}
                  >
                    {n.title}
                  </div>
                  {n.body && (
                    <div
                      style={{
                        fontFamily: 'var(--font-barlow)',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {n.body}
                    </div>
                  )}
                  <div
                    style={{
                      fontFamily: 'var(--font-ibm-plex-mono)',
                      fontSize: 9,
                      color: 'var(--text-subtle)',
                      marginTop: 3,
                    }}
                  >
                    {new Date(n.created_at).toLocaleTimeString()}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); dismiss(n.id) }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-subtle)',
                    fontSize: 14,
                    alignSelf: 'flex-start',
                    padding: '0 2px',
                  }}
                >
                  ×
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
