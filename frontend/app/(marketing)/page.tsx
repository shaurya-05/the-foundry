'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import H3rosWordmark from '@/components/brand/H3rosWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'

// Phase 2 §3.6 (Path A) — mark this route as fully static for Lighthouse.
// The 'use client' wrapper still ships, but the HTML response is prerendered
// at build time with no per-request render cost.
export const dynamic = 'force-static'

// Three outcomes (collapsed from four per §3.2 — Four-specialists card deleted)
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

  // Phase 2 §3.6 — no AuthProvider in scope; check token directly.
  // If the visitor is already signed in, send them to the app surface.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = localStorage.getItem('foundry_token')
    if (token) router.replace('/dashboard')
  }, [router])

  return (
    <div className="min-h-screen bg-off-white font-body">

      {/* Nav — Found3ryWordmark + h3ros parent lockup */}
      <nav className="flex items-center justify-between py-[18px] px-4 sm:px-8 max-w-[1200px] mx-auto gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Found3ryWordmark size="sm" />
          <span className="hidden sm:inline-flex font-mono font-medium text-[10px] tracking-[0.10em] uppercase text-n-600 items-center gap-1.5">
            · an
            <a href="https://h3ros.com" target="_blank" rel="noopener noreferrer" className="no-underline inline-flex">
              <H3rosWordmark size="xs" />
            </a>
            venture
          </span>
        </div>
        <div className="flex gap-2 sm:gap-3 items-center shrink-0">
          <button onClick={() => router.push('/about')} className="py-2 px-2.5 sm:px-3.5 bg-transparent border-0 cursor-pointer font-display font-semibold text-[11px] tracking-[0.06em] uppercase text-n-600 hover:text-ink transition-colors duration-100">
            About
          </button>
          <SolidNavButton onClick={() => router.push('/login')}>Sign In</SolidNavButton>
        </div>
      </nav>

      {/* HERO — Option B (operator-led, per §5.1) */}
      <section className="px-6 pt-[72px] pb-12 max-w-[960px] mx-auto text-center">
        <Pill>Built by a founder, for founders</Pill>

        <h1 className="font-display font-bold text-[clamp(32px,7vw,72px)] tracking-[0.02em] text-ink leading-[1.05] mt-6 mb-6">
          The venture stack for operators<br className="hidden sm:inline" /> running more than one thing.
        </h1>

        <p className="font-body text-[19px] font-medium text-n-600 max-w-[640px] mx-auto mb-3.5 leading-[1.5]">
          Built by Shaurya, who runs five.
        </p>

        <p className="font-body text-[16px] text-n-600 max-w-[600px] mx-auto mb-10 leading-[1.6]">
          Connect your tools, get one agent that knows your entire portfolio by name. No more retyping context into chat windows.
        </p>

        <div className="flex gap-3 justify-center flex-wrap mb-4">
          <PrimaryCta onClick={() => router.push('/login')}>Start Building Free</PrimaryCta>
          <GhostCta onClick={() => router.push('/about')}>Read the Story</GhostCta>
        </div>
        <p className="font-mono text-[11px] text-n-400 tracking-[0.08em] uppercase">
          Free during early access · No credit card · No limits
        </p>
      </section>

      {/* ENEMY-NAMING (§5.4) */}
      <section className="px-6 py-16 bg-vellum border-t border-b border-n-200">
        <div className="max-w-[760px] mx-auto">
          <EyebrowLabel number="01" keyword="THE PROBLEM" className="mb-4 text-center" />
          <h2 className="font-display font-bold text-[clamp(24px,4.5vw,36px)] tracking-[0.02em] text-center leading-[1.2] text-ink mb-6">
            The problem isn&apos;t your ideas.<br className="hidden sm:inline" /> It&apos;s that your ideas live in eleven tools that don&apos;t talk to each other.
          </h2>
          <div className="max-w-[560px] mx-auto mt-6">
            <Crease />
          </div>
          <p className="font-body text-[16px] leading-[1.65] text-n-600 mt-6 mb-4 max-w-[640px] mx-auto">
            Notes app, browser tabs, half-finished docs, group chats that nobody reads, Notion pages you never reopen, Linear tickets in three workspaces, a Slack channel for every venture. Every multi-venture operator we know runs on the same fragmented stack. The cost isn&apos;t lost ideas — it&apos;s the cognitive tax of stitching context back together every time you sit down to work.
          </p>
          <p className="font-display font-bold text-[18px] tracking-[0.02em] text-ink text-center mt-6">
            FOUND3RY builds the connective tissue.
          </p>
        </div>
      </section>

      {/* THE WHY — founder story */}
      <section className="px-6 py-16 bg-off-white">
        <div className="max-w-[720px] mx-auto">
          <EyebrowLabel number="02" keyword="THE WHY" className="mb-4 text-center" />
          <h2 className="font-display font-bold text-[clamp(24px,4.5vw,32px)] tracking-[0.02em] text-center text-ink mb-8 leading-[1.2]">
            Every multi-venture operator knows the feeling.
          </h2>
          <p className={whyPara}>
            The idea hits you suddenly. By the next day, it&apos;s scattered across notes apps, browser tabs, half-finished docs, and group chats that nobody reads. The gap between vision and execution is where most ideas go to die.
          </p>
          <p className={whyPara}>
            Our founder, <em>Shaurya</em>, runs five ventures across hardware, software, and design — and built FOUND3RY because no tool was actually built for how multi-venture operators think and work.
          </p>
          <p className={whyPara}>
            So he built the tool he wished he had.
          </p>
          <div className="text-center mt-7">
            <GhostCta onClick={() => router.push('/about')}>Read the full story</GhostCta>
          </div>
        </div>
      </section>

      {/* THE SOLUTION — 3 outcomes in chassis grid */}
      <section className="px-6 py-[72px] bg-vellum border-t border-b border-n-200">
        <div className="max-w-[1040px] mx-auto">
          <div className="text-center mb-12">
            <EyebrowLabel number="03" keyword="THE SOLUTION" className="mb-3" />
            <h2 className="font-display font-bold text-[clamp(24px,4.5vw,32px)] tracking-[0.02em] text-ink leading-[1.2]">
              From chaos to clarity — in minutes.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-n-200 border border-n-200">
            {OUTCOMES.map((o, i) => (
              <div key={o.title} className="bg-off-white px-5 py-6 sm:px-[26px] sm:py-7">
                <EyebrowLabel keyword={`0${i + 1}`} color="var(--color-arc-cyan-deep)" className="mb-3" />
                <h3 className="font-display font-bold text-[20px] tracking-[0.01em] text-ink mb-2.5 leading-[1.25]">
                  {o.title}
                </h3>
                <p className="font-body text-[14px] text-n-600 leading-[1.6]">
                  {o.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR — single segment per §3.3 */}
      <section className="px-6 py-16 bg-off-white">
        <div className="max-w-[720px] mx-auto">
          <div className="text-center mb-8">
            <EyebrowLabel number="04" keyword="WHO IT'S FOR" className="mb-3" />
            <h2 className="font-display font-bold text-[clamp(24px,4.5vw,32px)] tracking-[0.02em] text-ink leading-[1.2]">
              Multi-venture operators.
            </h2>
          </div>
          <p className="font-body text-[17px] leading-[1.65] text-n-600 text-center max-w-[600px] mx-auto">
            You aren&apos;t running one company — you&apos;re running a portfolio. Two, three, five ventures with different stacks, different stages, different people. You don&apos;t need another todo app. You need a graph of your operating reality and one agent that can answer across all of it.
          </p>
        </div>
      </section>

      {/* ABOUT h3ros (§5.2) */}
      <section className="px-6 py-8 bg-vellum border-t border-b border-n-200 text-center">
        <div className="max-w-[720px] mx-auto">
          <EyebrowLabel keyword="THE PARENT" className="mb-3" />
          <p className="font-body text-[15px] sm:text-[16px] leading-[1.55] text-n-600">
            <a href="https://h3ros.com" target="_blank" rel="noopener noreferrer" className="no-underline inline-flex align-baseline mr-1.5">
              <H3rosWordmark size="sm" />
            </a>
            builds operating infrastructure for the builder economy. FOUND3RY is one of its active ventures.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-20 text-center max-w-[640px] mx-auto">
        <h2 className="font-display font-bold text-[clamp(26px,5vw,40px)] tracking-[0.02em] text-ink mb-3 leading-[1.18]">
          Your ideas deserve<br className="hidden sm:inline" /> more than a notes app.
        </h2>
        <p className="font-body text-[16px] text-n-600 mb-7 leading-[1.5]">
          Free during early access. No limits. No credit card. Just build.
        </p>
        <PrimaryCta onClick={() => router.push('/login')} size="lg">Start Building</PrimaryCta>
      </section>

      {/* Footer */}
      <footer className="py-7 px-6 border-t border-n-200 max-w-[1200px] mx-auto flex items-center justify-between flex-wrap gap-3">
        <span className="font-mono font-medium text-[11px] text-n-600 tracking-[0.06em] inline-flex items-center gap-2 flex-wrap">
          <Found3ryWordmark size="sm" />
          <span className="hidden sm:inline">· an h3ros venture · workspace graph for builders</span>
          <span className="sm:hidden">· an h3ros venture</span>
        </span>
        <span className="font-mono font-medium text-[10px] text-n-400 tracking-[0.10em] uppercase">
          © {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  )
}

// ─── Local helper components ────────────────────────────────────────────────
// Per Phase 2 §3.5: zero `style={...}` attributes on this page.
// All visual primitives below use Tailwind utility classes only.

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-block py-1.5 px-3.5 bg-vellum border border-n-200 rounded-[20px] font-mono font-medium text-[11px] text-ink tracking-[0.12em] uppercase">
      {children}
    </div>
  )
}

function SolidNavButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="py-2 px-4 bg-ink border-0 rounded-sm cursor-pointer text-off-white font-display font-semibold text-[11px] tracking-[0.06em] uppercase transition-colors duration-100 hover:bg-n-600"
    >
      {children}
    </button>
  )
}

function PrimaryCta({
  onClick,
  children,
  size = 'md',
}: {
  onClick: () => void
  children: React.ReactNode
  size?: 'md' | 'lg'
}) {
  const padding = size === 'lg' ? 'py-[15px] px-10' : 'py-3.5 px-8'
  const text = size === 'lg' ? 'text-[15px]' : 'text-[14px]'
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 ${padding} bg-arc-cyan text-ink border-0 rounded-sm cursor-pointer font-display font-semibold ${text} tracking-[0.06em] uppercase transition-colors duration-100 hover:bg-arc-cyan-deep`}
    >
      <span>{children}</span>
      <span aria-hidden="true">→</span>
    </button>
  )
}

function GhostCta({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 py-3.5 px-7 bg-transparent border border-ink rounded-sm cursor-pointer text-ink font-display font-semibold text-[14px] tracking-[0.06em] uppercase transition-colors duration-100 hover:bg-ink hover:text-off-white"
    >
      <span>{children}</span>
      <span aria-hidden="true">→</span>
    </button>
  )
}

const whyPara = 'font-body text-[17px] leading-[1.7] text-n-600 mb-5'
