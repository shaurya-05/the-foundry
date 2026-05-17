'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'
import Button from '@/components/ui/Button'

type Step = {
  number: string
  title: string
  subtitle: string
  desc: string
  features: string[]
  nav?: string | null
  openCopilot?: boolean
  isFinal?: boolean
}

const WALKTHROUGH_STEPS: Step[] = [
  {
    number: '01',
    title: 'Welcome to The FOUND3RY.',
    subtitle: 'Builder OS',
    desc: 'The FOUND3RY is where ideas become real. Every tool you need to go from concept to launch — with an agent that actually knows your work.',
    features: [
      'Project plans generated in minutes with auto-created tasks.',
      'Knowledge base with semantic search.',
      'SWOT analysis for every idea.',
      'Real-time team collaboration.',
    ],
  },
  {
    number: '02',
    title: 'The dashboard is your command center.',
    subtitle: 'Overview',
    desc: 'See everything at a glance — active projects, open tasks, velocity trends, and items that need your attention. The dashboard gets smarter as you use it.',
    features: [
      'Project health indicators.',
      'Weekly velocity tracking.',
      'Attention alerts for overdue and blocked items.',
      'Quick access to recent activity.',
    ],
    nav: '/dashboard',
  },
  {
    number: '03',
    title: 'Knowledge is your research hub.',
    subtitle: 'Research and docs',
    desc: 'Upload research, docs, notes, and links. The AI summarizes everything and creates semantic embeddings so you can find related content instantly.',
    features: [
      'Add notes, links, documents, and research.',
      'Auto-generated summaries.',
      'Semantic search — find by meaning, not just keywords.',
      'Knowledge connects to projects and ideas automatically.',
    ],
    nav: '/knowledge',
  },
  {
    number: '04',
    title: 'Projects turn raw ideas into plans.',
    subtitle: 'Build tracker',
    desc: 'Name a project and the AI generates a full plan with milestones, technical requirements, and actionable tasks — automatically added to your task board.',
    features: [
      'One-click project plan generation.',
      'Auto-created tasks with priorities.',
      'Per-project COFOUND3R chat.',
      'Export as a structured document.',
    ],
    nav: '/projects',
  },
  {
    number: '05',
    title: 'Tasks live on a drag-and-drop board.',
    subtitle: 'Kanban',
    desc: 'Five columns — backlog, todo, in progress, in review, completed. Tasks auto-populate from project plans.',
    features: [
      'Drag-and-drop kanban.',
      'Filter by project, status, or priority.',
      'Assign tasks to team members.',
      'Priority levels: critical, high, medium, low.',
    ],
    nav: '/tasks',
  },
  {
    number: '06',
    title: 'Ideas turn into evaluated strategy.',
    subtitle: 'Innovation lab',
    desc: 'Describe a problem space and the AI generates three distinct startup ideas. Then run a full SWOT on any idea to evaluate it strategically.',
    features: [
      'Three distinct ideas per domain.',
      'One-click SWOT — strengths, weaknesses, opportunities, threats.',
      'Score ideas 1–10 with next-step recommendations.',
      'Convert ideas to full projects.',
    ],
    nav: '/ideas',
  },
  {
    number: '07',
    title: 'Four specialists work for you.',
    subtitle: 'The crew',
    desc: 'Field Analyst researches markets. Systems Architect designs solutions. Market Scout finds opportunities. Launch Strategist plans go-to-market.',
    features: [
      'Field Analyst — market research and competitive analysis.',
      'Systems Architect — technical design and architecture.',
      'Market Scout — opportunity identification.',
      'Launch Strategist — go-to-market planning.',
    ],
    nav: '/agents',
  },
  {
    number: '08',
    title: 'COFOUND3R reads your entire workspace graph.',
    subtitle: 'Press ⌘J anywhere',
    desc: 'COFOUND3R knows every project, task, knowledge item, and idea in your workspace. Ask it anything — "what should I work on?", "summarize my progress", "draft a pitch".',
    features: [
      'Full workspace context — knows everything by name.',
      'Per-project mode with plan and task awareness.',
      'Streaming responses with markdown formatting.',
      'Press ⌘J anytime from any page.',
    ],
    openCopilot: true,
  },
  {
    number: '09',
    title: 'You\'re ready to build.',
    subtitle: 'Start forging',
    desc: 'Create your first project to see the AI in action. The plan generator, auto-tasks, and COFOUND3R will take it from there.',
    features: [],
    nav: '/projects',
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
    <div
      style={{
        background: 'var(--color-vellum)',
        border: '1px solid var(--color-n200)',
        borderRadius: 0,
        marginBottom: 24,
        overflow: 'hidden',
      }}
    >
      {/* Flat progress bar — Arc Cyan fill */}
      <div style={{ height: 2, background: 'var(--color-n200)' }}>
        <div
          style={{
            height: '100%',
            background: 'var(--color-arc-cyan)',
            width: `${progress}%`,
            transition: 'width var(--duration-base, 200ms) var(--ease-out, ease-out)',
          }}
        />
      </div>

      <div style={{ padding: '28px 32px' }}>
        {/* Header — eyebrow + step counter */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 16,
        }}>
          <EyebrowLabel number={current.number} keyword={current.subtitle} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontFamily: 'var(--font-plex-mono), monospace',
              fontWeight: 500,
              fontSize: 11,
              color: 'var(--color-n400)',
              letterSpacing: '0.10em',
            }}>
              {step + 1}/{WALKTHROUGH_STEPS.length}
            </span>
            <button
              onClick={dismiss}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--color-n600)',
                cursor: 'pointer',
                fontFamily: 'var(--font-archivo), system-ui, sans-serif',
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                textDecoration: 'underline',
                textDecorationColor: 'var(--color-n400)',
                textUnderlineOffset: '0.2em',
              }}
            >
              Skip
            </button>
          </div>
        </div>

        {/* Title — Archivo Black, sentence case with period */}
        <h3 style={{
          fontFamily: 'var(--font-archivo-black), sans-serif',
          fontWeight: 400,
          fontSize: 32,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          color: 'var(--color-ink)',
          marginBottom: 16,
        }}>
          {current.title}
        </h3>

        <Crease />

        {/* Description — editorial body */}
        <p style={{
          fontFamily: 'var(--font-plex-serif), serif',
          fontWeight: 500,
          fontSize: 16,
          lineHeight: 1.55,
          color: 'var(--color-n600)',
          marginTop: 16,
          marginBottom: 20,
          maxWidth: '60ch',
        }}>
          {current.desc}
        </p>

        {/* Feature list — flat vellum-on-vellum with hairlines */}
        {current.features.length > 0 && (
          <ul style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 24px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 0,
            borderTop: '1px solid var(--color-n200)',
            borderLeft: '1px solid var(--color-n200)',
          }}>
            {current.features.map((f, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 14px',
                  background: 'var(--color-off-white)',
                  borderRight: '1px solid var(--color-n200)',
                  borderBottom: '1px solid var(--color-n200)',
                }}
              >
                <span aria-hidden="true" style={{
                  color: 'var(--color-arc-cyan-deep)',
                  fontFamily: 'var(--font-plex-mono), monospace',
                  fontWeight: 500,
                  fontSize: 12,
                  lineHeight: 1.5,
                  flexShrink: 0,
                }}>
                  —
                </span>
                <span style={{
                  fontFamily: 'var(--font-plex-mono), monospace',
                  fontWeight: 500,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--color-ink)',
                }}>
                  {f}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Navigation row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {step > 0 && (
            <Button variant="ghost" size="sm" arrow={false} onClick={prev}>Back</Button>
          )}
          {(current.nav || current.openCopilot) && (
            <Button variant="ghost" size="sm" onClick={goToPage}>
              {current.openCopilot ? 'Open COFOUND3R (⌘J)' : `Go to ${current.subtitle}`}
            </Button>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <Button variant="primary" size="sm" onClick={next}>
              {isLast ? 'Start building' : 'Next'}
            </Button>
          </div>
        </div>

        {/* Step dots — flat color, opacity transition only */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 8,
          marginTop: 20,
        }}>
          {WALKTHROUGH_STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              aria-label={`Step ${i + 1}`}
              style={{
                width: i === step ? 24 : 6,
                height: 2,
                background: i === step ? 'var(--color-arc-cyan)' : 'var(--color-n400)',
                opacity: i === step ? 1 : 0.5,
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                transition: 'opacity var(--duration-fast, 120ms) var(--ease-out, ease-out)',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
