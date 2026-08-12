'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'

type H3roStyle = {
  verbosity: 'concise' | 'moderate' | 'detailed'
  tone: 'casual' | 'neutral' | 'formal'
  technical_depth: 'plain' | 'moderate' | 'technical'
  humor: 'none' | 'occasional' | 'frequent'
  notes: string | null
  updated_at: string | null
}

const DEFAULT_STYLE: H3roStyle = {
  verbosity: 'moderate',
  tone: 'neutral',
  technical_depth: 'moderate',
  humor: 'occasional',
  notes: null,
  updated_at: null,
}

const VERBOSITY_OPTS = [
  { value: 'concise', label: 'Concise' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'detailed', label: 'Detailed' },
] as const

const TONE_OPTS = [
  { value: 'casual', label: 'Casual' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'formal', label: 'Formal' },
] as const

const DEPTH_OPTS = [
  { value: 'plain', label: 'Plain language' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'technical', label: 'Technical' },
] as const

const HUMOR_OPTS = [
  { value: 'none', label: 'None — fully straight' },
  { value: 'occasional', label: 'Occasional dry remark' },
  { value: 'frequent', label: 'Frequent dry humor' },
] as const

function parseStyle(raw: unknown): H3roStyle {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STYLE }
  const o = raw as Record<string, unknown>
  return {
    verbosity: VERBOSITY_OPTS.some(x => x.value === o.verbosity)
      ? (o.verbosity as H3roStyle['verbosity'])
      : DEFAULT_STYLE.verbosity,
    tone: TONE_OPTS.some(x => x.value === o.tone)
      ? (o.tone as H3roStyle['tone'])
      : DEFAULT_STYLE.tone,
    technical_depth: DEPTH_OPTS.some(x => x.value === o.technical_depth)
      ? (o.technical_depth as H3roStyle['technical_depth'])
      : DEFAULT_STYLE.technical_depth,
    humor: HUMOR_OPTS.some(x => x.value === o.humor)
      ? (o.humor as H3roStyle['humor'])
      : DEFAULT_STYLE.humor,
    notes: typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim() : null,
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : null,
  }
}

function plainSummary(s: H3roStyle): string {
  const depth =
    s.technical_depth === 'plain'
      ? 'plain language'
      : s.technical_depth === 'technical'
        ? 'technical depth'
        : 'moderate technical depth'
  const humor =
    s.humor === 'none' ? 'no humor' : s.humor === 'frequent' ? 'frequent dry humor' : 'occasional dry humor'
  return `${s.verbosity} answers, ${s.tone} tone, ${depth}, ${humor}`
}

export default function H3roStyleSettings() {
  const { user, updateProfile } = useAuth()
  const [style, setStyle] = useState<H3roStyle>(DEFAULT_STYLE)
  const [notesDraft, setNotesDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    const next = parseStyle(user?.preferences?.h3ro_style)
    setStyle(next)
    setNotesDraft(next.notes || '')
  }, [user?.preferences])

  async function persist(next: H3roStyle) {
    if (!user) return
    setSaving(true)
    setStatus('')
    try {
      const withStamp: H3roStyle = {
        ...next,
        updated_at: new Date().toISOString(),
      }
      await updateProfile({
        preferences: {
          ...(user.preferences || {}),
          h3ro_style: withStamp,
        },
      })
      setStyle(withStamp)
      setStatus('Saved')
      setTimeout(() => setStatus(''), 2000)
    } catch {
      setStatus('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function onDimChange<K extends 'verbosity' | 'tone' | 'technical_depth' | 'humor'>(
    key: K,
    value: H3roStyle[K],
  ) {
    const next = { ...style, [key]: value }
    setStyle(next)
    await persist(next)
  }

  async function onNotesBlur() {
    const notes = notesDraft.trim() || null
    if (notes === style.notes) return
    await persist({ ...style, notes })
  }

  async function onReset() {
    setNotesDraft('')
    await persist({ ...DEFAULT_STYLE })
  }

  const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: 'var(--bg-elevated, var(--bg))',
    border: '1px solid var(--border)',
    borderRadius: 7,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-barlow)',
    fontSize: 13,
  }

  return (
    <div style={{ padding: '0 20px 16px' }}>
      <p style={{
        fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'var(--font-barlow)',
        lineHeight: 1.55, marginBottom: 14,
      }}>
        H3RO adapts how it talks based on your feedback (e.g. &ldquo;keep answers shorter&rdquo;).
        Changes apply to every conversation. You can also set it here.
      </p>

      <div style={{
        padding: '10px 12px', marginBottom: 16,
        background: 'var(--bg-muted, transparent)',
        border: '1px solid var(--border)', borderRadius: 8,
      }}>
        <div style={{
          fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-muted)', marginBottom: 4,
        }}>
          Current style
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-primary)', fontFamily: 'var(--font-barlow)' }}>
          {plainSummary(style)}
        </div>
        {style.notes && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'var(--font-barlow)' }}>
            Note: {style.notes}
          </div>
        )}
      </div>

      <label style={labelStyle}>Verbosity</label>
      <select
        value={style.verbosity}
        disabled={saving}
        onChange={e => onDimChange('verbosity', e.target.value as H3roStyle['verbosity'])}
        style={{ ...selectStyle, marginBottom: 12 }}
      >
        {VERBOSITY_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label style={labelStyle}>Tone</label>
      <select
        value={style.tone}
        disabled={saving}
        onChange={e => onDimChange('tone', e.target.value as H3roStyle['tone'])}
        style={{ ...selectStyle, marginBottom: 12 }}
      >
        {TONE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label style={labelStyle}>Technical depth</label>
      <select
        value={style.technical_depth}
        disabled={saving}
        onChange={e => onDimChange('technical_depth', e.target.value as H3roStyle['technical_depth'])}
        style={{ ...selectStyle, marginBottom: 12 }}
      >
        {DEPTH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label style={labelStyle}>Humor</label>
      <select
        value={style.humor}
        disabled={saving}
        onChange={e => onDimChange('humor', e.target.value as H3roStyle['humor'])}
        style={{ ...selectStyle, marginBottom: 12 }}
      >
        {HUMOR_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label style={labelStyle}>Notes (optional)</label>
      <input
        value={notesDraft}
        disabled={saving}
        onChange={e => setNotesDraft(e.target.value)}
        onBlur={onNotesBlur}
        placeholder="e.g. skip pleasantries, lead with the answer"
        maxLength={240}
        style={{ ...selectStyle, marginBottom: 14 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          disabled={saving}
          onClick={onReset}
          style={{
            padding: '8px 16px', background: 'none',
            border: '1px solid var(--border)', borderRadius: 7,
            color: 'var(--text-secondary)', cursor: saving ? 'wait' : 'pointer',
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
            fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}
        >
          Reset to default
        </button>
        {status && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
            {status}
          </span>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-ibm-plex-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
}
