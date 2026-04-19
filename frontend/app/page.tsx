'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

const PERSONAS = [
  {
    title: 'Solo Founders',
    desc: 'Turn 2am ideas into plans by morning. Stop losing your best thinking to scattered notes.',
  },
  {
    title: 'Multi-Venture Operators',
    desc: 'Running more than one thing? Keep every project moving without dropping the threads.',
  },
  {
    title: 'Product Builders',
    desc: 'From first sketch to launch brief. AI that understands how you actually build.',
  },
  {
    title: 'Early-Stage Teams',
    desc: 'Get aligned fast. Everyone sees the plan, the tasks, and the research — in one place.',
  },
]

const OUTCOMES = [
  {
    title: 'Complete project plans in minutes',
    desc: 'Not months. Type a name, get the plan, the tasks, the milestones, and the success metrics — all generated and ready to execute.',
  },
  {
    title: 'An AI that actually knows your work',
    desc: 'COFOUND3R has full context of every project, task, and idea you\'ve saved. Ask "what should I work on next?" and it answers by name, by priority, by deadline.',
  },
  {
    title: 'Investor-ready briefs on demand',
    desc: 'Enter a concept, get back the pitch, the market sizing, the MVP scope, the GTM strategy, and the funding path.',
  },
  {
    title: 'Four specialists, always on',
    desc: 'Field Analyst. Systems Architect. Market Scout. Launch Strategist. Chain them together. Let them work while you sleep.',
  },
]

export default function LandingPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [user, loading, router])

  if (!loading && user) return null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F4F5F7)', fontFamily: 'var(--font-barlow)' }}>

      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 32px', maxWidth: 1200, margin: '0 auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: 'linear-gradient(135deg, #D12D1F, #D4A017)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 12px rgba(232,35,31,0.25)',
          }}>
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 1L14 4.5V10.5L7.5 14L1 10.5V4.5L7.5 1Z" stroke="white" strokeWidth="1.4" fill="none" />
              <path d="M7.5 1L7.5 14M1 4.5L14 10.5M14 4.5L1 10.5" stroke="white" strokeWidth="0.7" opacity="0.45" />
            </svg>
          </div>
          <span style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 16, letterSpacing: '0.08em' }}>
            <span style={{ color: '#5B93ED', fontWeight: 600 }}>The </span><span style={{ color: '#D12D1F' }}>FOUND</span><span style={{ color: '#D4A017' }}>3</span><span style={{ color: '#D12D1F' }}>RY</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => router.push('/about')} style={{
            padding: '8px 14px', background: 'none', border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font-barlow-condensed)',
            fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--text-secondary, #374151)',
          }}>
            About
          </button>
          <button onClick={() => router.push('/login')} style={{
            padding: '8px 16px', background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
            border: 'none', borderRadius: 7, cursor: 'pointer', color: '#fff',
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 11,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            Sign In
          </button>
        </div>
      </nav>

      {/* HERO — founder-led, story-first */}
      <section style={{ padding: '80px 24px 48px', maxWidth: 960, margin: '0 auto', textAlign: 'center' }}>
        <div style={{
          display: 'inline-block',
          padding: '6px 14px',
          background: 'rgba(232,35,31,0.08)',
          border: '1px solid rgba(232,35,31,0.2)',
          borderRadius: 20,
          fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11,
          color: '#C81E1C', letterSpacing: '0.12em', textTransform: 'uppercase',
          marginBottom: 24,
        }}>
          Built by a founder, for founders
        </div>

        <h1 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
          fontSize: 'clamp(40px, 7vw, 72px)', letterSpacing: '0.02em',
          color: 'var(--text-primary, #0A0C12)',
          lineHeight: 1.02, marginBottom: 24,
        }}>
          The AI co-founder<br />that never sleeps.
        </h1>

        <p style={{
          fontSize: 19, color: 'var(--text-secondary, #374151)', maxWidth: 640,
          margin: '0 auto 20px', lineHeight: 1.5, fontWeight: 500,
        }}>
          For founders juggling multiple ventures, half-finished docs, and 2am ideas that never make it past the notes app.
        </p>

        <p style={{
          fontSize: 15, color: 'var(--text-muted, #6B7280)', maxWidth: 560,
          margin: '0 auto 40px', lineHeight: 1.6,
        }}>
          The FOUND3RY turns raw ideas into complete project plans, investor-ready briefs, and prioritized task boards — with an AI that knows your entire workspace by name.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={() => router.push('/login')} style={{
            padding: '14px 32px', background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
            border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff',
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 14,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            boxShadow: '0 4px 16px rgba(232,35,31,0.3)',
          }}>
            Start Building Free
          </button>
          <button onClick={() => router.push('/about')} style={{
            padding: '14px 32px', background: 'none',
            border: '1px solid var(--border, rgba(0,0,0,0.12))', borderRadius: 8, cursor: 'pointer',
            color: 'var(--text-secondary, #374151)',
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 14,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            Read the Story
          </button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-subtle, #9CA3AF)', fontFamily: 'var(--font-ibm-plex-mono)', letterSpacing: '0.06em' }}>
          Free during early access · No credit card · No limits
        </p>
      </section>

      {/* THE WHY — founder story */}
      <section style={{
        padding: '64px 24px',
        background: 'var(--bg-surface, #fff)',
        borderTop: '1px solid var(--border, rgba(0,0,0,0.06))',
        borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{
            fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: '#E8231F',
            letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 16,
            textAlign: 'center',
          }}>
            The Why
          </div>
          <h2 style={{
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 32,
            letterSpacing: '0.02em', textAlign: 'center',
            color: 'var(--text-primary, #0A0C12)', marginBottom: 32, lineHeight: 1.15,
          }}>
            Every founder knows the feeling.
          </h2>
          <p style={{
            fontSize: 17, lineHeight: 1.7, color: 'var(--text-secondary, #374151)',
            marginBottom: 20,
          }}>
            The idea hits you suddenly. By the next day, it's scattered across notes apps, browser tabs, half-finished docs, and group chats that nobody reads. The gap between vision and execution is where most ideas go to die.
          </p>
          <p style={{
            fontSize: 17, lineHeight: 1.7, color: 'var(--text-secondary, #374151)',
            marginBottom: 20,
          }}>
            Our founder, <strong>Shaurya</strong>, built The FOUND3RY from experience — running multiple ventures across hardware, software, and design, he saw firsthand how many good ideas stall because the tools weren't built for how founders actually think and work.
          </p>
          <p style={{
            fontSize: 17, lineHeight: 1.7, color: 'var(--text-secondary, #374151)',
            marginBottom: 28,
          }}>
            So he built the tool he wished he had.
          </p>
          <div style={{ textAlign: 'center' }}>
            <button onClick={() => router.push('/about')} style={{
              padding: '10px 24px', background: 'none',
              border: '1px solid var(--border, rgba(0,0,0,0.15))', borderRadius: 7, cursor: 'pointer',
              color: 'var(--text-secondary, #374151)',
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 12,
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              Read the full story →
            </button>
          </div>
        </div>
      </section>

      {/* THE OUTCOMES — reframed from features to results */}
      <section style={{ padding: '72px 24px', maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: '#E8231F',
            letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12,
          }}>
            The Solution
          </div>
          <h2 style={{
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 32,
            letterSpacing: '0.02em',
            color: 'var(--text-primary, #0A0C12)', lineHeight: 1.15,
          }}>
            From chaos to clarity — in minutes.
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 20 }}>
          {OUTCOMES.map((o, i) => (
            <div key={o.title} style={{
              background: 'var(--bg-surface, #fff)',
              border: '1px solid var(--border, rgba(0,0,0,0.07))',
              borderRadius: 14, padding: '28px 26px',
              boxShadow: '0 2px 10px var(--shadow, rgba(0,0,0,0.04))',
            }}>
              <div style={{
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 13,
                color: '#E8231F', letterSpacing: '0.10em', textTransform: 'uppercase',
                marginBottom: 12,
              }}>
                0{i + 1}
              </div>
              <h3 style={{
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
                fontSize: 20, letterSpacing: '0.01em',
                color: 'var(--text-primary, #0A0C12)', marginBottom: 10, lineHeight: 1.25,
              }}>
                {o.title}
              </h3>
              <p style={{ fontSize: 14, color: 'var(--text-muted, #6B7280)', lineHeight: 1.6 }}>
                {o.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section style={{
        padding: '72px 24px',
        background: 'var(--bg-surface, #fff)',
        borderTop: '1px solid var(--border, rgba(0,0,0,0.06))',
        borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
      }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{
              fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: '#E8231F',
              letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12,
            }}>
              Who it's for
            </div>
            <h2 style={{
              fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 32,
              letterSpacing: '0.02em',
              color: 'var(--text-primary, #0A0C12)', lineHeight: 1.15,
            }}>
              Built for builders.
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {PERSONAS.map(p => (
              <div key={p.title} style={{
                padding: '20px 22px',
                background: 'var(--bg, #F9FAFB)',
                border: '1px solid var(--border, rgba(0,0,0,0.06))',
                borderRadius: 10,
              }}>
                <h3 style={{
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 15,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  color: 'var(--text-primary, #0A0C12)', marginBottom: 8,
                }}>
                  {p.title}
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted, #6B7280)', lineHeight: 1.55 }}>
                  {p.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* UNDER THE HOOD — the 4 agents + COFOUND3R */}
      <section style={{ padding: '72px 24px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: '#E8231F',
            letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 12,
          }}>
            Under the hood
          </div>
          <h2 style={{
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 32,
            letterSpacing: '0.02em',
            color: 'var(--text-primary, #0A0C12)', lineHeight: 1.15, marginBottom: 16,
          }}>
            Four specialists. One co-founder. All yours.
          </h2>
          <p style={{ fontSize: 15, color: 'var(--text-muted, #6B7280)', maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>
            Every agent is trained for a specific stage of building. Run them individually, or chain them into pipelines for multi-step analysis.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {[
            { name: 'Field Analyst', role: 'Deep research', color: '#0A85FF' },
            { name: 'Systems Architect', role: 'Technical design', color: '#E8231F' },
            { name: 'Market Scout', role: 'Opportunity sizing', color: '#7C3AED' },
            { name: 'Launch Strategist', role: 'Go-to-market', color: '#16A34A' },
          ].map(a => (
            <div key={a.name} style={{
              padding: '20px 18px',
              background: 'var(--bg-surface, #fff)',
              border: `1px solid ${a.color}30`,
              borderRadius: 10,
              borderLeft: `3px solid ${a.color}`,
            }}>
              <div style={{
                fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 10,
                color: a.color, letterSpacing: '0.10em', textTransform: 'uppercase',
                marginBottom: 6,
              }}>
                {a.role}
              </div>
              <div style={{
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
                fontSize: 16, letterSpacing: '0.03em',
                color: 'var(--text-primary, #0A0C12)',
              }}>
                {a.name}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '80px 24px', textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
          fontSize: 'clamp(28px, 5vw, 40px)', letterSpacing: '0.02em',
          color: 'var(--text-primary, #0A0C12)', marginBottom: 12, lineHeight: 1.15,
        }}>
          Your ideas deserve<br />more than a notes app.
        </h2>
        <p style={{ fontSize: 16, color: 'var(--text-muted, #6B7280)', marginBottom: 28, lineHeight: 1.5 }}>
          Free during early access. No limits. No credit card. Just build.
        </p>
        <button onClick={() => router.push('/login')} style={{
          padding: '15px 40px', background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
          border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff',
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 15,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          boxShadow: '0 4px 16px rgba(232,35,31,0.3)',
        }}>
          Start Building
        </button>
      </section>

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: '28px 24px', borderTop: '1px solid var(--border, rgba(0,0,0,0.07))',
        maxWidth: 1200, margin: '0 auto',
      }}>
        <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'var(--text-subtle, #9CA3AF)', letterSpacing: '0.06em' }}>
          <span style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700 }}><span style={{ color: '#5B93ED', fontWeight: 600 }}>The </span><span style={{ color: '#D12D1F' }}>FOUND</span><span style={{ color: '#D4A017' }}>3</span><span style={{ color: '#D12D1F' }}>RY</span></span> by <span style={{ fontWeight: 700 }}><span style={{ color: '#2563EB' }}>h</span><span style={{ color: '#F97316' }}>3</span><span style={{ color: '#2563EB' }}>ros</span></span> · AI co-founder for builders
        </span>
      </footer>
    </div>
  )
}
