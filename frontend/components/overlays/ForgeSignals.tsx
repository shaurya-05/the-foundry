'use client'

import { useEffect, useState } from 'react'
import { api, AppNotification } from '@/lib/api'
import EyebrowLabel from '@/components/brand/EyebrowLabel'

interface ForgeSignalsProps {
  onClose: () => void
  onUnreadChange: (count: number) => void
}

// Event-type glyph symbols (no emoji, single-char ASCII/Unicode marks)
const EVENT_GLYPHS: Record<string, string> = {
  agent_complete:  '◆',
  task_created:    '+',
  task_completed:  '✓',
  pipeline_run:    '▸',
  insight:         '◆',
  connection:      '⟷',
  knowledge_added: '+',
  project_created: '+',
  idea_generated:  '◆',
  agent_run:       '▸',
}

export default function ForgeSignals({ onClose, onUnreadChange }: ForgeSignalsProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

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
        background: 'var(--color-vellum)',
        borderLeft: '1px solid var(--color-n200)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 18px 12px',
          background: 'var(--color-vellum)',
          borderBottom: '1px solid var(--color-n200)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-archivo), system-ui, sans-serif',
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: 'var(--color-ink)',
          }}
        >
          FORGE SIGNALS
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {notifications.some(n => !n.read) && (
            <button
              onClick={markAll}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'var(--color-ink)',
                fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                textDecoration: 'underline',
                textDecorationColor: 'var(--color-arc-cyan)',
                textUnderlineOffset: '0.2em',
              }}
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-n600)',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--color-off-white)' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <EyebrowLabel keyword="LOADING SIGNALS…" color="var(--color-n400)" />
          </div>
        ) : notifications.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <EyebrowLabel keyword="NO SIGNALS" color="var(--color-n400)" style={{ marginBottom: 8 }} />
            <p style={{
              fontFamily: 'var(--font-plex-serif), serif',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 14,
              color: 'var(--color-n600)',
              margin: 0,
            }}>
              The FOUND3RY is quiet.
            </p>
          </div>
        ) : (
          notifications.map(n => {
            const glyph = EVENT_GLYPHS[n.type] || '◆'
            return (
              <div
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 18px',
                  background: n.read ? 'var(--color-off-white)' : 'var(--color-vellum)',
                  borderLeft: n.read ? '2px solid transparent' : '2px solid var(--color-arc-cyan)',
                  borderBottom: '1px solid var(--color-n200)',
                  cursor: 'pointer',
                  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    background: n.read ? 'var(--color-vellum)' : 'var(--color-off-white)',
                    border: '1px solid var(--color-n200)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-plex-mono), monospace',
                    fontSize: 12,
                    color: 'var(--color-arc-cyan-deep)',
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                >
                  {glyph}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                    fontWeight: n.read ? 400 : 700,
                    fontSize: 13,
                    color: 'var(--color-ink)',
                    marginBottom: 2,
                  }}>
                    {n.title}
                  </div>
                  {n.body && (
                    <div style={{
                      fontFamily: 'var(--font-plex-serif), serif',
                      fontStyle: 'italic',
                      fontWeight: 500,
                      fontSize: 12,
                      color: 'var(--color-n600)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {n.body}
                    </div>
                  )}
                  <div style={{
                    fontFamily: 'var(--font-plex-mono), monospace',
                    fontWeight: 500,
                    fontSize: 10,
                    color: 'var(--color-n400)',
                    marginTop: 4,
                    letterSpacing: '0.06em',
                  }}>
                    {new Date(n.created_at).toLocaleTimeString()}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); dismiss(n.id) }}
                  aria-label="Dismiss"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-n400)',
                    fontSize: 16,
                    lineHeight: 1,
                    alignSelf: 'flex-start',
                    padding: 4,
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
