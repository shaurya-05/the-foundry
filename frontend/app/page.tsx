'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'

const FEATURES = [
  { icon: '📚', title: 'Knowledge Base', desc: 'Upload research, docs, and data. AI summarizes and connects everything.' },
  { icon: '🔨', title: 'Project Forge', desc: 'Create a project and Claude generates a full plan with auto-created tasks.' },
  { icon: '✅', title: 'Task Board', desc: 'Kanban-style task management with AI-generated subtasks from your plans.' },
  { icon: '🤖', title: 'AI Copilot', desc: 'Context-aware AI assistant that knows your entire workspace.' },
  { icon: '🧠', title: 'Agent Crew', desc: '4 specialized AI agents: Field Analyst, Systems Architect, Market Scout, Launch Strategist.' },
  { icon: '🚀', title: 'Launchpad', desc: 'Generate investor-ready launch briefs from a single concept.' },
]

const STEPS = [
  { label: 'SOURCE', desc: 'Add knowledge, research, and ideas', color: '#0A85FF' },
  { label: 'FORGE', desc: 'AI generates plans, tasks, and insights', color: '#E8231F' },
  { label: 'CAST', desc: 'Refine with copilot and agent crew', color: '#7C3AED' },
  { label: 'SHIP', desc: 'Launch with confidence', color: '#16A34A' },
]

export default function LandingPage() {
  const router = useRouter()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard')
  }, [user, loading, router])

  // Show landing page immediately — redirect happens in background if logged in
  if (!loading && user) return null

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F4F5F7)', fontFamily: 'var(--font-barlow)' }}>

      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 32px', maxWidth: 1200, margin: '0 auto',
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
          <span style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 16, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            <span style={{ color: '#2563EB' }}>THE </span><span style={{ color: '#D12D1F' }}>FOUND</span><span style={{ color: '#D4A017' }}>3</span><span style={{ color: '#D12D1F' }}>RY</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => router.push('/pricing')} style={{
            padding: '8px 16px', background: 'none', border: '1px solid var(--border, rgba(0,0,0,0.1))',
            borderRadius: 7, cursor: 'pointer', fontFamily: 'var(--font-barlow-condensed)',
            fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--text-secondary, #374151)',
          }}>
            Pricing
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

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '80px 24px 60px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: '#E8231F',
          letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16,
        }}>
          AI-Powered Builder OS
        </div>
        <h1 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
          fontSize: 'clamp(36px, 7vw, 64px)', letterSpacing: '0.04em',
          textTransform: 'uppercase', color: 'var(--text-primary, #0A0C12)',
          lineHeight: 1.05, marginBottom: 20,
        }}>
          Your ideas,<br />forged.
        </h1>
        <p style={{
          fontSize: 17, color: 'var(--text-secondary, #374151)', maxWidth: 520,
          margin: '0 auto 36px', lineHeight: 1.6,
        }}>
          From raw concept to launch-ready product. THE FOUND3RY is your AI-powered workspace that plans, builds, and ships — with you.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => router.push('/login')} style={{
            padding: '13px 32px', background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
            border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff',
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 14,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            boxShadow: '0 4px 16px rgba(232,35,31,0.3)',
          }}>
            Get Started Free
          </button>
          <button onClick={() => router.push('/pricing')} style={{
            padding: '13px 32px', background: 'none',
            border: '1px solid var(--border, rgba(0,0,0,0.12))', borderRadius: 8, cursor: 'pointer',
            color: 'var(--text-secondary, #374151)',
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 14,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            See Pricing
          </button>
        </div>
      </section>

      {/* Features */}
      <section style={{ padding: '40px 24px 60px', maxWidth: 1100, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 24,
          letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center',
          color: 'var(--text-primary, #0A0C12)', marginBottom: 32,
        }}>
          Everything you need to build
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{
              background: 'var(--bg-surface, #fff)', border: '1px solid var(--border, rgba(0,0,0,0.07))',
              borderRadius: 12, padding: '24px 20px',
              boxShadow: '0 2px 8px var(--shadow, rgba(0,0,0,0.04))',
            }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
              <h3 style={{
                fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 14,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--text-primary, #0A0C12)', marginBottom: 6,
              }}>
                {f.title}
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted, #6B7280)', lineHeight: 1.5 }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: '40px 24px 60px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 24,
          letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'center',
          color: 'var(--text-primary, #0A0C12)', marginBottom: 32,
        }}>
          The Forge Pipeline
        </h2>
        <div style={{ display: 'flex', gap: 0, justifyContent: 'center', flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ textAlign: 'center', padding: '0 20px' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, margin: '0 auto 10px',
                  background: `${s.color}15`, border: `2px solid ${s.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
                  fontSize: 16, color: s.color,
                }}>
                  {i + 1}
                </div>
                <div style={{
                  fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
                  fontSize: 12, letterSpacing: '0.10em', textTransform: 'uppercase',
                  color: s.color, marginBottom: 4,
                }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #6B7280)', maxWidth: 140 }}>
                  {s.desc}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ color: 'var(--text-subtle, #9CA3AF)', fontSize: 18, padding: '0 4px' }}>→</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{
        textAlign: 'center', padding: '60px 24px 40px', maxWidth: 600, margin: '0 auto',
      }}>
        <h2 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 28,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--text-primary, #0A0C12)', marginBottom: 16,
        }}>
          Start building today
        </h2>
        <p style={{ fontSize: 15, color: 'var(--text-muted, #6B7280)', marginBottom: 24 }}>
          Free to start. No credit card required.
        </p>
        <button onClick={() => router.push('/login')} style={{
          padding: '14px 40px', background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
          border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff',
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 15,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          boxShadow: '0 4px 16px rgba(232,35,31,0.3)',
        }}>
          Get Started Free
        </button>
      </section>

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: '24px', borderTop: '1px solid var(--border, rgba(0,0,0,0.07))',
        maxWidth: 1200, margin: '0 auto',
      }}>
        <span style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: 'var(--text-subtle, #9CA3AF)', letterSpacing: '0.06em' }}>
          <span style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700 }}><span style={{ color: '#2563EB' }}>THE </span><span style={{ color: '#D12D1F' }}>FOUND</span><span style={{ color: '#D4A017' }}>3</span><span style={{ color: '#D12D1F' }}>RY</span></span> by <span style={{ fontWeight: 700 }}><span style={{ color: '#2563EB' }}>h</span><span style={{ color: '#F97316' }}>3</span><span style={{ color: '#2563EB' }}>ros</span></span> · AI-powered builder OS
        </span>
      </footer>
    </div>
  )
}
