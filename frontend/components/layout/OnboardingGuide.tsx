'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

const STEPS = [
  {
    title: 'Create your first project',
    desc: 'Head to Projects and name your build. Claude will generate a full plan with auto-created tasks.',
    action: '/projects',
    actionLabel: 'Go to Projects',
    color: '#E8231F',
  },
  {
    title: 'Add knowledge',
    desc: 'Upload research, docs, or notes to the Knowledge base. AI will summarize and connect them.',
    action: '/knowledge',
    actionLabel: 'Go to Knowledge',
    color: '#0A85FF',
  },
  {
    title: 'Talk to the Copilot',
    desc: 'Press ⌘J to open the AI copilot. It knows your entire workspace and can help with anything.',
    action: null,
    actionLabel: 'Press ⌘J',
    color: '#7C3AED',
  },
]

export default function OnboardingGuide() {
  const router = useRouter()
  const { updateProfile } = useAuth()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  function dismiss() {
    setDismissed(true)
    updateProfile({ preferences: { onboarding_dismissed: true } })
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '24px 28px', marginBottom: 20,
      borderLeft: '3px solid #E8231F',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h3 style={{
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 16,
            letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-primary)',
            marginBottom: 4,
          }}>
            Welcome to The FOUND3RY
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-ibm-plex-mono)' }}>
            Get started in 3 steps
          </p>
        </div>
        <button onClick={dismiss} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-subtle)', fontSize: 14, padding: '4px 8px',
        }}>
          Dismiss
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {STEPS.map((step, i) => (
          <div key={i} style={{
            padding: '16px', borderRadius: 10,
            background: `${step.color}08`, border: `1px solid ${step.color}20`,
          }}>
            <div style={{
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.08em', textTransform: 'uppercase', color: step.color,
              marginBottom: 6,
            }}>
              Step {i + 1}
            </div>
            <div style={{
              fontFamily: 'var(--font-barlow)', fontWeight: 600, fontSize: 14,
              color: 'var(--text-primary)', marginBottom: 6,
            }}>
              {step.title}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 10 }}>
              {step.desc}
            </p>
            <button
              onClick={() => step.action ? router.push(step.action) : document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }))}
              style={{
                padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                background: 'none', border: `1px solid ${step.color}40`, color: step.color,
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
                fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}
            >
              {step.actionLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
