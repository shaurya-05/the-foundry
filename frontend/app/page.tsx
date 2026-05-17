'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import H3rosWordmark from '@/components/brand/H3rosWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

// Three outcomes (collapsed from four — Four-specialists card deleted per §3.2)
const OUTCOMES = [
  {
    title: 'Connect the tools you already use.',
    desc: 'GitHub, Linear, Notion. FOUND3RY ingests your operating reality — commits, issues, docs, decisions — into one graph. No more retyping context into chat windows.',
  },
  {
    title: 'One agent that knows everything by name.',
    desc: "COFOUND3R reads from your workspace graph. Ask 'what's stuck across my ventures?' and it cites specific PRs, specific issues, specific docs — without you telling it where to look.",
  },
  {
    title: 'Living investor surfaces.',
    desc: 'A shareable URL per venture that shows current state — commits, open tasks, capital position — pulled live from your graph. Investors see what is actually happening, not last quarter\'s deck.',
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
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-off-white)',
      fontFamily: 'var(--font-barlow), system-ui, sans-serif',
    }}>

      {/* Nav — Found3ryWordmark + h3ros parent lockup */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 32px', maxWidth: 1200, margin: '0 auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Found3ryWordmark size="sm" />
          <span style={{
            fontFamily: 'var(--font-ibm-plex-mono), monospace',
            fontWeight: 500, fontSize: 10,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            color: 'var(--color-n600)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            · an
            <a href="https://h3ros.com" target="_blank" rel="noopener noreferrer"
               style={{ textDecoration: 'none', display: 'inline-flex' }}>
              <H3rosWordmark size="xs" />
            </a>
            venture
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => router.push('/about')} style={ghostNavBtn}>
            About
          </button>
          <button onClick={() => router.push('/login')} style={solidNavBtn}>
            Sign In
          </button>
        </div>
      </nav>

      {/* HERO — Option B (operator-led, per §5.1) */}
      <section style={{ padding: '72px 24px 48px', maxWidth: 960, margin: '0 auto', textAlign: 'center' }}>
        <div style={pillStyle}>
          Built by a founder, for founders
        </div>

        <h1 style={{
          fontFamily: 'var(--font-barlow-condensed), sans-serif',
          fontWeight: 700,
          fontSize: 'clamp(40px, 7vw, 72px)',
          letterSpacing: '0.02em',
          color: 'var(--color-ink)',
          lineHeight: 1.02,
          marginTop: 24,
          marginBottom: 24,
        }}>
          The venture stack for operators<br />running more than one thing.
        </h1>

        <p style={{
          fontFamily: 'var(--font-barlow), system-ui, sans-serif',
          fontSize: 19, fontWeight: 500, color: 'var(--color-n600)',
          maxWidth: 640, margin: '0 auto 14px', lineHeight: 1.5,
        }}>
          Built by Shaurya, who runs five.
        </p>

        <p style={{
          fontFamily: 'var(--font-barlow), system-ui, sans-serif',
          fontSize: 16, color: 'var(--color-n600)',
          maxWidth: 600, margin: '0 auto 40px', lineHeight: 1.6,
        }}>
          Connect your tools, get one agent that knows your entire portfolio by name. No more retyping context into chat windows.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <button onClick={() => router.push('/login')} style={primaryCtaStyle}>
            <span>Start Building Free</span><span aria-hidden="true">→</span>
          </button>
          <button onClick={() => router.push('/about')} style={ghostCtaStyle}>
            <span>Read the Story</span><span aria-hidden="true">→</span>
          </button>
        </div>
        <p style={{
          fontFamily: 'var(--font-ibm-plex-mono), monospace',
          fontSize: 11, color: 'var(--color-n400)',
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          Free during early access · No credit card · No limits
        </p>
      </section>

      {/* ENEMY-NAMING (§5.4) — replaces the deleted segment cards */}
      <section style={{
        padding: '64px 24px',
        background: 'var(--color-vellum)',
        borderTop: '1px solid var(--color-n200)',
        borderBottom: '1px solid var(--color-n200)',
      }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <EyebrowLabel number="01" keyword="THE PROBLEM" style={{ marginBottom: 16, textAlign: 'center' }} />
          <h2 style={{
            fontFamily: 'var(--font-barlow-condensed), sans-serif',
            fontWeight: 700, fontSize: 'clamp(28px, 4.5vw, 36px)',
            letterSpacing: '0.02em', textAlign: 'center', lineHeight: 1.18,
            color: 'var(--color-ink)', marginBottom: 24,
          }}>
            The problem isn&apos;t your ideas.<br />It&apos;s that your ideas live in eleven tools that don&apos;t talk to each other.
          </h2>
          <div style={{ maxWidth: 560, margin: '24px auto 0' }}>
            <Crease />
          </div>
          <p style={{
            fontFamily: 'var(--font-barlow), system-ui, sans-serif',
            fontSize: 16, lineHeight: 1.65, color: 'var(--color-n600)',
            marginTop: 24, marginBottom: 16, textAlign: 'left', maxWidth: 640,
            margin: '24px auto 16px',
          }}>
            Notes app, browser tabs, half-finished docs, group chats that nobody reads, Notion pages you never reopen, Linear tickets in three workspaces, a Slack channel for every venture. Every multi-venture operator we know runs on the same fragmented stack. The cost isn&apos;t lost ideas — it&apos;s the cognitive tax of stitching context back together every time you sit down to work.
          </p>
          <p style={{
            fontFamily: 'var(--font-barlow-condensed), sans-serif',
            fontWeight: 700, fontSize: 18,
            letterSpacing: '0.02em', color: 'var(--color-ink)',
            textAlign: 'center', marginTop: 24,
          }}>
            FOUND3RY builds the connective tissue.
          </p>
        </div>
      </section>

      {/* THE WHY — founder story (preserved per KEEP list, tightened to lean in) */}
      <section style={{
        padding: '64px 24px',
        background: 'var(--color-off-white)',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <EyebrowLabel number="02" keyword="THE WHY" style={{ marginBottom: 16, textAlign: 'center' }} />
          <h2 style={{
            fontFamily: 'var(--font-barlow-condensed), sans-serif',
            fontWeight: 700, fontSize: 32,
            letterSpacing: '0.02em', textAlign: 'center',
            color: 'var(--color-ink)', marginBottom: 32, lineHeight: 1.15,
          }}>
            Every multi-venture operator knows the feeling.
          </h2>
          <p style={whyPara}>
            The idea hits you suddenly. By the next day, it&apos;s scattered across notes apps, browser tabs, half-finished docs, and group chats that nobody reads. The gap between vision and execution is where most ideas go to die.
          </p>
          <p style={whyPara}>
            Our founder, <em>Shaurya</em>, runs five ventures across hardware, software, and design — and built FOUND3RY because no tool was actually built for how multi-venture operators think and work.
          </p>
          <p style={whyPara}>
            So he built the tool he wished he had.
          </p>
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <button onClick={() => router.push('/about')} style={ghostCtaStyle}>
              <span>Read the full story</span><span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </section>

      {/* THE SOLUTION — 3 outcomes (Four-specialists card deleted per §3.2) */}
      <section style={{
        padding: '72px 24px',
        background: 'var(--color-vellum)',
        borderTop: '1px solid var(--color-n200)',
        borderBottom: '1px solid var(--color-n200)',
      }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <EyebrowLabel number="03" keyword="THE SOLUTION" style={{ marginBottom: 12 }} />
            <h2 style={{
              fontFamily: 'var(--font-barlow-condensed), sans-serif',
              fontWeight: 700, fontSize: 32,
              letterSpacing: '0.02em', color: 'var(--color-ink)', lineHeight: 1.15,
            }}>
              From chaos to clarity — in minutes.
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 1,
            background: 'var(--color-n200)',
            border: '1px solid var(--color-n200)',
          }}>
            {OUTCOMES.map((o, i) => (
              <div key={o.title} style={{
                background: 'var(--color-off-white)',
                padding: '28px 26px',
              }}>
                <EyebrowLabel keyword={`0${i + 1}`} color="var(--color-arc-cyan-deep)" style={{ marginBottom: 12 }} />
                <h3 style={{
                  fontFamily: 'var(--font-barlow-condensed), sans-serif',
                  fontWeight: 700,
                  fontSize: 20, letterSpacing: '0.01em',
                  color: 'var(--color-ink)', marginBottom: 10, lineHeight: 1.25,
                }}>
                  {o.title}
                </h3>
                <p style={{
                  fontFamily: 'var(--font-barlow), system-ui, sans-serif',
                  fontSize: 14, color: 'var(--color-n600)', lineHeight: 1.6,
                }}>
                  {o.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR — single segment (per §3.3) */}
      <section style={{
        padding: '64px 24px',
        background: 'var(--color-off-white)',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <EyebrowLabel number="04" keyword="WHO IT'S FOR" style={{ marginBottom: 12 }} />
            <h2 style={{
              fontFamily: 'var(--font-barlow-condensed), sans-serif',
              fontWeight: 700, fontSize: 32,
              letterSpacing: '0.02em', color: 'var(--color-ink)', lineHeight: 1.15,
            }}>
              Multi-venture operators.
            </h2>
          </div>
          <p style={{
            fontFamily: 'var(--font-barlow), system-ui, sans-serif',
            fontSize: 17, lineHeight: 1.65, color: 'var(--color-n600)',
            textAlign: 'center', maxWidth: 600, margin: '0 auto',
          }}>
            You aren&apos;t running one company — you&apos;re running a portfolio. Two, three, five ventures with different stacks, different stages, different people. You don&apos;t need another todo app. You need a graph of your operating reality and one agent that can answer across all of it.
          </p>
        </div>
      </section>

      {/* ABOUT h3ros (§5.2) */}
      <section style={{
        padding: '32px 24px',
        background: 'var(--color-vellum)',
        borderTop: '1px solid var(--color-n200)',
        borderBottom: '1px solid var(--color-n200)',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <EyebrowLabel keyword="THE PARENT" style={{ marginBottom: 12 }} />
          <p style={{
            fontFamily: 'var(--font-barlow), system-ui, sans-serif',
            fontSize: 16, lineHeight: 1.55, color: 'var(--color-n600)',
            display: 'inline-flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', justifyContent: 'center',
          }}>
            <a href="https://h3ros.com" target="_blank" rel="noopener noreferrer"
               style={{ textDecoration: 'none', display: 'inline-flex' }}>
              <H3rosWordmark size="sm" />
            </a>
            builds operating infrastructure for the builder economy. FOUND3RY is one of its active ventures.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '80px 24px', textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: 'var(--font-barlow-condensed), sans-serif',
          fontWeight: 700,
          fontSize: 'clamp(28px, 5vw, 40px)', letterSpacing: '0.02em',
          color: 'var(--color-ink)', marginBottom: 12, lineHeight: 1.15,
        }}>
          Your ideas deserve<br />more than a notes app.
        </h2>
        <p style={{
          fontFamily: 'var(--font-barlow), system-ui, sans-serif',
          fontSize: 16, color: 'var(--color-n600)', marginBottom: 28, lineHeight: 1.5,
        }}>
          Free during early access. No limits. No credit card. Just build.
        </p>
        <button onClick={() => router.push('/login')} style={{
          ...primaryCtaStyle,
          padding: '15px 40px',
          fontSize: 15,
        }}>
          <span>Start Building</span><span aria-hidden="true">→</span>
        </button>
      </section>

      {/* Footer — tagline scrubbed per §3.4 (workspace graph positioning) */}
      <footer style={{
        padding: '28px 24px',
        borderTop: '1px solid var(--color-n200)',
        maxWidth: 1200, margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <span style={{
          fontFamily: 'var(--font-ibm-plex-mono), monospace',
          fontWeight: 500, fontSize: 11,
          color: 'var(--color-n600)', letterSpacing: '0.06em',
          display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <Found3ryWordmark size="sm" />
          <span>· an h3ros venture · workspace graph for builders</span>
        </span>
        <span style={{
          fontFamily: 'var(--font-ibm-plex-mono), monospace',
          fontWeight: 500, fontSize: 10,
          color: 'var(--color-n400)', letterSpacing: '0.10em', textTransform: 'uppercase',
        }}>
          © {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  )
}

// ─── Shared inline styles (will move to Tailwind/CSS modules in §3.5 commit) ──
const pillStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 14px',
  background: 'var(--color-vellum)',
  border: '1px solid var(--color-n200)',
  borderRadius: 20,
  fontFamily: 'var(--font-ibm-plex-mono), monospace',
  fontWeight: 500, fontSize: 11,
  color: 'var(--color-ink)',
  letterSpacing: '0.12em', textTransform: 'uppercase',
}

const ghostNavBtn: React.CSSProperties = {
  padding: '8px 14px', background: 'none', border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-barlow-condensed), sans-serif',
  fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--color-n600)',
}

const solidNavBtn: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--color-ink)',
  border: 'none', borderRadius: 2, cursor: 'pointer',
  color: 'var(--color-off-white)',
  fontFamily: 'var(--font-barlow-condensed), sans-serif',
  fontWeight: 600, fontSize: 11,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
}

const primaryCtaStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '14px 32px',
  background: 'var(--color-arc-cyan)',
  color: 'var(--color-ink)',
  border: 'none', borderRadius: 2, cursor: 'pointer',
  fontFamily: 'var(--font-barlow-condensed), sans-serif',
  fontWeight: 600, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase',
  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
}

const ghostCtaStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '14px 28px',
  background: 'transparent',
  border: '1px solid var(--color-ink)',
  borderRadius: 2, cursor: 'pointer',
  color: 'var(--color-ink)',
  fontFamily: 'var(--font-barlow-condensed), sans-serif',
  fontWeight: 600, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase',
  transition: 'background-color var(--duration-fast, 120ms) var(--ease-out, ease-out), color var(--duration-fast, 120ms) var(--ease-out, ease-out)',
}

const whyPara: React.CSSProperties = {
  fontFamily: 'var(--font-barlow), system-ui, sans-serif',
  fontSize: 17, lineHeight: 1.7,
  color: 'var(--color-n600)',
  marginBottom: 20,
}
