'use client'

import { useRouter } from 'next/navigation'

export default function AboutPage() {
  const router = useRouter()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #F4F5F7)', fontFamily: 'var(--font-barlow)' }}>

      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 32px', maxWidth: 1200, margin: '0 auto',
      }}>
        <button onClick={() => router.push('/')} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'none', border: 'none', cursor: 'pointer',
        }}>
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
        </button>
        <div style={{ display: 'flex', gap: 12 }}>
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
      <section style={{ padding: '80px 24px 40px', maxWidth: 720, margin: '0 auto', textAlign: 'center' }}>
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
          The Story
        </div>
        <h1 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700,
          fontSize: 'clamp(36px, 6vw, 56px)', letterSpacing: '0.02em',
          color: 'var(--text-primary, #0A0C12)',
          lineHeight: 1.05, marginBottom: 20,
        }}>
          We built the tool<br />we wished we had.
        </h1>
        <p style={{
          fontSize: 17, color: 'var(--text-muted, #6B7280)', maxWidth: 520,
          margin: '0 auto', lineHeight: 1.6,
        }}>
          Why The FOUND3RY exists, who it's for, and where it's going.
        </p>
      </section>

      {/* The problem */}
      <section style={{ padding: '40px 24px', maxWidth: 720, margin: '0 auto' }}>
        <h2 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 26,
          letterSpacing: '0.02em', color: 'var(--text-primary, #0A0C12)',
          marginBottom: 20, lineHeight: 1.2,
        }}>
          The gap between idea and execution.
        </h2>
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
          Every founder knows the feeling. The idea hits you suddenly — on a walk, in the shower, at 2am. You capture it somewhere. A voice memo. A note on your phone. A text to yourself.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
          Then real life happens. And when you come back to it a week later, the idea has fragmented across browser tabs, half-finished Notion docs, scattered research, and a group chat that nobody reads.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
          You try to piece it back together. You look for a tool to help. You find project management apps designed for teams that already know what they're building. You find AI chatbots that forget the conversation the moment you close the tab. You find notes apps that can store anything but organize nothing.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', fontWeight: 600 }}>
          None of them were built for how founders actually think.
        </p>
      </section>

      {/* Founder story */}
      <section style={{
        padding: '56px 24px',
        background: 'var(--bg-surface, #fff)',
        borderTop: '1px solid var(--border, rgba(0,0,0,0.06))',
        borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
        margin: '40px 0',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{
            fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: '#E8231F',
            letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14,
          }}>
            The Founder
          </div>
          <h2 style={{
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 28,
            letterSpacing: '0.02em', color: 'var(--text-primary, #0A0C12)',
            marginBottom: 20, lineHeight: 1.2,
          }}>
            Shaurya's story.
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
            Shaurya is a multi-disciplinary builder working across hardware, software, and design. He's run more than one venture at the same time, watched promising ideas lose momentum because the tools couldn't keep up, and spent too many hours rebuilding the same context from scratch.
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
            He noticed a pattern. Every time he started something new — a product, a research direction, a pitch deck — he'd end up doing the same work over and over. Summarizing research. Writing plans. Breaking work into tasks. Pulling together the story for investors. Work that AI was perfectly capable of doing, if only someone gave it the full picture.
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
            The problem wasn't AI. The problem was that AI didn't <em>know</em> anything about his actual work. Every conversation started from zero.
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', fontWeight: 600 }}>
            So he built something different.
          </p>
        </div>
      </section>

      {/* What makes it different */}
      <section style={{ padding: '40px 24px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: '#E8231F',
          letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14,
        }}>
          What makes it different
        </div>
        <h2 style={{
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 28,
          letterSpacing: '0.02em', color: 'var(--text-primary, #0A0C12)',
          marginBottom: 20, lineHeight: 1.2,
        }}>
          An AI that actually remembers.
        </h2>
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
          The FOUND3RY isn't another chatbot. It's an operating system for builders — one that connects your projects, tasks, research, and ideas into a single, continuous context.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
          When you ask COFOUND3R what to work on next, it doesn't give you a generic answer. It references your actual projects by name, your actual tasks by priority, your actual deadlines. When you run an agent for deep research, it already knows the context. When you generate a launch brief, it pulls from everything you've built so far.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
          Four specialized agents — Field Analyst, Systems Architect, Market Scout, and Launch Strategist — each trained for a different stage of building. Run them individually. Chain them into pipelines. Let them work while you sleep.
        </p>
      </section>

      {/* Where it's going */}
      <section style={{
        padding: '56px 24px',
        background: 'var(--bg-surface, #fff)',
        borderTop: '1px solid var(--border, rgba(0,0,0,0.06))',
        borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
        margin: '40px 0',
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{
            fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 11, color: '#E8231F',
            letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 14,
          }}>
            What's next
          </div>
          <h2 style={{
            fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 28,
            letterSpacing: '0.02em', color: 'var(--text-primary, #0A0C12)',
            marginBottom: 20, lineHeight: 1.2,
          }}>
            Early access. Free. Open to feedback.
          </h2>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
            Version 1 is live. No limits. No credit card. Every feature we ship is shaped by the builders using it.
          </p>
          <p style={{ fontSize: 16, lineHeight: 1.75, color: 'var(--text-secondary, #374151)', marginBottom: 16 }}>
            If you're building something, this was built for you. Try it, break it, tell us what's missing. We're listening.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: '48px 24px 80px', textAlign: 'center', maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push('/login')} style={{
          padding: '15px 40px', background: 'linear-gradient(135deg, #E8231F, #C81E1C)',
          border: 'none', borderRadius: 8, cursor: 'pointer', color: '#fff',
          fontFamily: 'var(--font-barlow-condensed)', fontWeight: 600, fontSize: 15,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          boxShadow: '0 4px 16px rgba(232,35,31,0.3)',
        }}>
          Start Building Free
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
