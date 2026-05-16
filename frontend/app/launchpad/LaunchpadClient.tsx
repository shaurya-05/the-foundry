'use client'

import { useState } from 'react'
import { streamSSE } from '@/lib/streaming'
import { api } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import Markdown from '@/components/ui/Markdown'
import { useRouter } from 'next/navigation'

const STATS = [
  { label: 'Projects Shipped', value: '12K+', color: 'var(--color-n600)' },
  { label: 'Founders Supported', value: '3.2K+', color: 'var(--color-arc-cyan-deep)' },
  { label: 'Avg Time to MVP', value: '6 weeks', color: 'var(--color-n600)' },
]

export default function LaunchpadClient() {
  const [concept, setConcept] = useState('')
  const [brief, setBrief] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function forgeBrief() {
    if (!concept.trim() || streaming) return
    setBrief('')
    setStreaming(true)
    try {
      for await (const chunk of streamSSE('/api/launchpad/forge-brief', { concept })) {
        if (chunk.type === 'text_delta') setBrief(b => b + chunk.text)
      }
    } finally { setStreaming(false) }
  }

  async function saveAsProject() {
    if (!brief || !concept) return
    setSaving(true)
    try {
      const project = await api.projects.create({ title: concept })
      await api.projects.update(project.id, { plan: brief })
      router.push('/projects')
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <SectionHeader title="The Launch Bay" sublabel="Startup Launchpad" accent="var(--color-n600)">
        <span className="badge" style={{ background: 'rgba(56,211,122,0.1)', color: 'var(--color-n600)' }}>
          YC-LEVEL ADVISOR
        </span>
      </SectionHeader>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {STATS.map(s => (
          <GlassCard
            key={s.label}
            style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <div
              style={{
                fontFamily: 'var(--font-barlow-condensed)',
                fontWeight: 700,
                fontSize: 28,
                color: s.color,
                lineHeight: 1,
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-ibm-plex-mono)',
                fontSize: 9,
                color: 'var(--text-muted)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {s.label}
            </div>
          </GlassCard>
        ))}
      </div>

      {/* Brief generator */}
      <GlassCard accent="var(--color-n600)" accentTop style={{ padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--color-n600)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
          Launch Brief Generator
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="forge-input"
            placeholder="Describe your startup concept or product idea..."
            value={concept}
            onChange={e => setConcept(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && forgeBrief()}
            style={{ flex: 1 }}
          />
          <button
            onClick={forgeBrief}
            disabled={streaming || !concept.trim()}
            className="btn btn-primary"
            style={{ background: 'var(--color-n600)', flexShrink: 0 }}
          >
            {streaming ? 'FORGING...' : '▲ FORGE LAUNCH BRIEF'}
          </button>
        </div>
      </GlassCard>

      {(brief || streaming) && (
        <GlassCard style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-n600)' }}>
              LAUNCH BRIEF — {concept.slice(0, 50)}
            </div>
            {brief && !streaming && (
              <button
                onClick={saveAsProject}
                disabled={saving}
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--color-n600)', borderColor: 'rgba(56,211,122,0.2)' }}
              >
                {saving ? 'SAVING...' : 'SAVE AS PROJECT'}
              </button>
            )}
          </div>
          <Markdown content={brief} streaming={streaming} />
        </GlassCard>
      )}
    </div>
  )
}
