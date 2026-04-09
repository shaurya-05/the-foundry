'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

const WALKTHROUGH_STEPS = [
  {
    title: 'Welcome to The FOUND3RY',
    subtitle: 'Your AI-powered builder OS',
    desc: 'The FOUND3RY is where ideas become real. Every tool you need to go from concept to launch — powered by AI that actually knows your work.',
    icon: '🔥',
    color: '#E8231F',
    features: [
      'AI-generated project plans with auto-created tasks',
      'Knowledge base with semantic search',
      'SWOT analysis for every idea',
      'Real-time team collaboration',
    ],
  },
  {
    title: 'Dashboard',
    subtitle: 'Your command center',
    desc: 'See everything at a glance — active projects, open tasks, velocity trends, and items that need your attention. The dashboard gets smarter as you use it.',
    icon: '📊',
    color: '#E8231F',
    nav: '/dashboard',
    features: [
      'Project health indicators (green/yellow/red)',
      'Weekly velocity tracking',
      'Needs attention alerts for overdue & blocked items',
      'Quick access to recent activity',
    ],
  },
  {
    title: 'Knowledge Base',
    subtitle: 'Your research hub',
    desc: 'Upload research, docs, notes, and links. The AI summarizes everything and creates semantic embeddings so you can find related content instantly.',
    icon: '📚',
    color: '#0A85FF',
    nav: '/knowledge',
    features: [
      'Add notes, links, documents, and research',
      'AI auto-generates summaries',
      'Semantic search — find by meaning, not just keywords',
      'Knowledge connects to projects and ideas automatically',
    ],
  },
  {
    title: 'Projects',
    subtitle: 'Build tracker',
    desc: 'Name a project and the AI generates a full plan with milestones, technical requirements, and 5-10 actionable tasks — automatically added to your task board.',
    icon: '🔨',
    color: '#E8231F',
    nav: '/projects',
    features: [
      'One-click AI project plan generation',
      'Auto-created tasks with priorities',
      'Per-project COFOUND3R chat',
      'Export as structured document',
    ],
  },
  {
    title: 'Tasks',
    subtitle: 'Kanban board',
    desc: 'Drag-and-drop task board with columns for backlog, todo, in progress, in review, and completed. Tasks auto-populate from project plans.',
    icon: '✅',
    color: '#16A34A',
    nav: '/tasks',
    features: [
      'Kanban board with drag-and-drop',
      'Filter by project, status, or priority',
      'Assign tasks to team members',
      'Priority levels: critical, high, medium, low',
    ],
  },
  {
    title: 'Ideas & SWOT',
    subtitle: 'Innovation lab',
    desc: 'Describe a problem space and the AI generates 3 distinct startup ideas. Then run a full SWOT analysis on any idea to evaluate it strategically.',
    icon: '💡',
    color: '#F06A00',
    nav: '/ideas',
    features: [
      'AI generates 3 ideas per domain',
      'One-click SWOT analysis (Strengths, Weaknesses, Opportunities, Threats)',
      'Score ideas 1-10 with next step recommendations',
      'Convert ideas to full projects',
    ],
  },
  {
    title: 'Agents',
    subtitle: 'Your AI crew',
    desc: 'Four specialized AI agents work for you: Field Analyst researches markets, Systems Architect designs solutions, Market Scout finds opportunities, and Launch Strategist plans go-to-market.',
    icon: '🤖',
    color: '#7C3AED',
    nav: '/agents',
    features: [
      'Field Analyst — market research & competitive analysis',
      'Systems Architect — technical design & architecture',
      'Market Scout — opportunity identification',
      'Launch Strategist — go-to-market planning',
    ],
  },
  {
    title: 'COFOUND3R',
    subtitle: 'Your AI co-founder — ⌘J',
    desc: 'COFOUND3R knows every project, task, knowledge item, and idea in your workspace. Ask it anything — "what should I work on?", "summarize my HERM3S progress", "draft a pitch for T3RRA".',
    icon: '🧠',
    color: '#7C3AED',
    nav: null,
    openCopilot: true,
    features: [
      'Full workspace context — knows everything by name',
      'Per-project mode with plan & task awareness',
      'Streaming responses with markdown formatting',
      'Press ⌘J anytime from any page',
    ],
  },
  {
    title: 'You\'re ready to build!',
    subtitle: 'Start forging',
    desc: 'Create your first project to see the AI in action. The plan generator, auto-tasks, and COFOUND3R will take it from there.',
    icon: '🚀',
    color: '#E8231F',
    nav: '/projects',
    features: [],
    isFinal: true,
  },
]

export default function OnboardingGuide() {
  const router = useRouter()
  const { updateProfile } = useAuth()
  const [step, setStep] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  const current = WALKTHROUGH_STEPS[step]
  const isLast = step === WALKTHROUGH_STEPS.length - 1
  const progress = ((step + 1) / WALKTHROUGH_STEPS.length) * 100

  const dismiss = useCallback(() => {
    setDismissed(true)
    updateProfile({ preferences: { onboarding_dismissed: true } })
  }, [updateProfile])

  const next = useCallback(() => {
    if (isLast) {
      dismiss()
      router.push('/projects')
    } else {
      setStep(s => s + 1)
    }
  }, [isLast, dismiss, router])

  const prev = useCallback(() => setStep(s => Math.max(0, s - 1)), [])

  const goToPage = useCallback(() => {
    if (current.openCopilot) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }))
    } else if (current.nav) {
      router.push(current.nav)
    }
  }, [current, router])

  if (dismissed) return null

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 20,
      boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    }}>
      {/* Progress bar */}
      <div style={{ height: 3, background: 'var(--border)' }}>
        <div style={{
          height: '100%', background: `linear-gradient(90deg, ${current.color}, ${current.color}CC)`,
          width: `${progress}%`, transition: 'width 0.3s ease',
        }} />
      </div>

      <div style={{ padding: '24px 28px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>{current.icon}</span>
            <div>
              <h3 style={{
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 18,
                letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 2,
              }}>
                {current.title}
              </h3>
              <p style={{
                fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11,
                color: current.color, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                {current.subtitle}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10,
              color: 'var(--text-muted)',
            }}>
              {step + 1}/{WALKTHROUGH_STEPS.length}
            </span>
            <button onClick={dismiss} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-subtle)', fontSize: 11, padding: '4px 8px',
              fontFamily: 'var(--font-barlow-condensed)', letterSpacing: '0.06em',
            }}>
              SKIP
            </button>
          </div>
        </div>

        {/* Description */}
        <p style={{
          fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6,
          marginBottom: 16, fontFamily: 'var(--font-barlow)', maxWidth: 600,
        }}>
          {current.desc}
        </p>

        {/* Feature list */}
        {current.features && current.features.length > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 8, marginBottom: 20,
          }}>
            {current.features.map((f, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 12px', borderRadius: 8,
                background: `${current.color}06`, border: `1px solid ${current.color}15`,
              }}>
                <span style={{ color: current.color, fontSize: 12, marginTop: 1 }}>&#10003;</span>
                <span style={{
                  fontSize: 12, color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-ibm-plex-mono)', lineHeight: 1.4,
                }}>
                  {f}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Navigation buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {step > 0 && (
            <button onClick={prev} style={{
              padding: '8px 16px', borderRadius: 7, cursor: 'pointer',
              background: 'none', border: '1px solid var(--border)',
              color: 'var(--text-muted)', fontFamily: 'var(--font-barlow-condensed)',
              fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              Back
            </button>
          )}

          {current.nav || current.openCopilot ? (
            <button onClick={goToPage} style={{
              padding: '8px 16px', borderRadius: 7, cursor: 'pointer',
              background: 'none', border: `1px solid ${current.color}40`, color: current.color,
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
              fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              {current.openCopilot ? 'Open COFOUND3R (⌘J)' : `Go to ${current.title}`}
            </button>
          ) : null}

          <button onClick={next} style={{
            padding: '8px 20px', borderRadius: 7, cursor: 'pointer', marginLeft: 'auto',
            background: `linear-gradient(135deg, ${current.color}, ${current.color}CC)`,
            color: '#fff', border: 'none',
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600,
            fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {isLast ? 'Start Building' : 'Next'}
          </button>
        </div>

        {/* Step dots */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16,
        }}>
          {WALKTHROUGH_STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              style={{
                width: i === step ? 16 : 6, height: 6, borderRadius: 3,
                background: i === step ? current.color : 'var(--border)',
                border: 'none', cursor: 'pointer', padding: 0,
                transition: 'width 0.2s ease, background 0.2s ease',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
