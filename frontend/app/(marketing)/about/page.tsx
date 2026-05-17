'use client'

import { useRouter } from 'next/navigation'
import Found3ryWordmark from '@/components/brand/Found3ryWordmark'
import H3rosWordmark from '@/components/brand/H3rosWordmark'
import EyebrowLabel from '@/components/brand/EyebrowLabel'

// Phase 2 §3.6 (Path A) — fully static prerender for Lighthouse perf.
export const dynamic = 'force-static'

export default function AboutPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-off-white font-body">

      {/* Nav */}
      <nav className="flex items-center justify-between py-[18px] px-8 max-w-[1200px] mx-auto">
        <button onClick={() => router.push('/')} className="flex items-center gap-2.5 bg-transparent border-0 cursor-pointer">
          <Found3ryWordmark size="sm" />
          <span className="font-mono font-medium text-[10px] tracking-[0.10em] uppercase text-n-600 inline-flex items-center gap-1.5">
            · an
            <a href="https://h3ros.com" target="_blank" rel="noopener noreferrer" className="no-underline inline-flex">
              <H3rosWordmark size="xs" />
            </a>
            venture
          </span>
        </button>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/login')}
            className="py-2 px-4 bg-ink border-0 rounded-sm cursor-pointer text-off-white font-display font-semibold text-[11px] tracking-[0.06em] uppercase transition-colors duration-100 hover:bg-n-600"
          >
            Sign In
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-20 pb-10 max-w-[720px] mx-auto text-center">
        <div className="inline-block py-1.5 px-3.5 bg-vellum border border-n-200 rounded-[20px] font-mono font-medium text-[11px] text-ink tracking-[0.12em] uppercase mb-6">
          The Story
        </div>
        <h1 className="font-display font-bold text-[clamp(36px,6vw,56px)] tracking-[0.02em] text-ink leading-[1.05] mb-5">
          We built the tool<br />we wished we had.
        </h1>
        <p className="font-body text-[17px] text-n-600 max-w-[520px] mx-auto leading-[1.6]">
          Why The FOUND3RY exists, who it&apos;s for, and where it&apos;s going.
        </p>
      </section>

      {/* The problem */}
      <section className="px-6 py-10 max-w-[720px] mx-auto">
        <EyebrowLabel number="01" keyword="THE GAP" className="mb-4" />
        <h2 className="font-display font-bold text-[26px] tracking-[0.02em] text-ink mb-5 leading-[1.2]">
          The gap between idea and execution.
        </h2>
        <p className={paraStyle}>
          Every founder knows the feeling. The idea hits you suddenly — on a walk, in the shower, at 2am. You capture it somewhere. A voice memo. A note on your phone. A text to yourself.
        </p>
        <p className={paraStyle}>
          Then real life happens. And when you come back to it a week later, the idea has fragmented across browser tabs, half-finished Notion docs, scattered research, and a group chat that nobody reads.
        </p>
        <p className={paraStyle}>
          You try to piece it back together. You look for a tool to help. You find project management apps designed for teams that already know what they&apos;re building. You find AI chatbots that forget the conversation the moment you close the tab. You find notes apps that can store anything but organize nothing.
        </p>
        <p className="font-body text-[16px] leading-[1.75] text-ink font-semibold">
          None of them were built for how multi-venture operators actually think.
        </p>
      </section>

      {/* Founder story */}
      <section className="px-6 py-14 bg-vellum border-t border-b border-n-200 my-10">
        <div className="max-w-[720px] mx-auto">
          <EyebrowLabel number="02" keyword="THE FOUNDER" className="mb-3.5" />
          <h2 className="font-display font-bold text-[28px] tracking-[0.02em] text-ink mb-5 leading-[1.2]">
            Shaurya&apos;s story.
          </h2>
          <p className={paraStyle}>
            Shaurya is a multi-disciplinary builder running five ventures across hardware, software, and design. He&apos;s watched promising ideas lose momentum because the tools couldn&apos;t keep up, and spent too many hours rebuilding the same context from scratch.
          </p>
          <p className={paraStyle}>
            He noticed a pattern. Every time he started something new — a product, a research direction, a pitch deck — he&apos;d end up doing the same work over and over. Summarizing research. Writing plans. Breaking work into tasks. Pulling together the story for investors. Work that AI was perfectly capable of doing, if only someone gave it the full picture.
          </p>
          <p className={paraStyle}>
            The problem wasn&apos;t AI. The problem was that AI didn&apos;t <em>know</em> anything about his actual work. Every conversation started from zero.
          </p>
          <p className="font-body text-[16px] leading-[1.75] text-ink font-semibold">
            So he built something different.
          </p>
        </div>
      </section>

      {/* What makes it different */}
      <section className="px-6 py-10 max-w-[720px] mx-auto">
        <EyebrowLabel number="03" keyword="WHAT MAKES IT DIFFERENT" className="mb-3.5" />
        <h2 className="font-display font-bold text-[28px] tracking-[0.02em] text-ink mb-5 leading-[1.2]">
          A workspace graph, not a chatbot.
        </h2>
        <p className={paraStyle}>
          The FOUND3RY isn&apos;t another chatbot. It&apos;s a workspace graph for builders — one that ingests your operating reality from the tools you already use (GitHub, Linear, Notion) and gives one agent full context over all of it.
        </p>
        <p className={paraStyle}>
          When you ask COFOUND3R what to work on next, it doesn&apos;t give you a generic answer. It cites your actual PRs, your actual tickets, your actual docs — without you typing any of that into the chat. It knows which venture you&apos;re asking about because it knows what venture each artifact belongs to.
        </p>
        <p className={paraStyle}>
          The moat is the graph. Not the model.
        </p>
      </section>

      {/* Where it's going */}
      <section className="px-6 py-14 bg-vellum border-t border-b border-n-200 my-10">
        <div className="max-w-[720px] mx-auto">
          <EyebrowLabel number="04" keyword="WHAT'S NEXT" className="mb-3.5" />
          <h2 className="font-display font-bold text-[28px] tracking-[0.02em] text-ink mb-5 leading-[1.2]">
            Early access. Free. Open to feedback.
          </h2>
          <p className={paraStyle}>
            Version 1 is live. No limits. No credit card. Every feature we ship is shaped by the builders using it.
          </p>
          <p className={paraStyle}>
            If you&apos;re running more than one thing, this was built for you. Try it, break it, tell us what&apos;s missing. We&apos;re listening.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pt-12 pb-20 text-center max-w-[640px] mx-auto">
        <button
          onClick={() => router.push('/login')}
          className="inline-flex items-center justify-center gap-2 py-[15px] px-10 bg-arc-cyan text-ink border-0 rounded-sm cursor-pointer font-display font-semibold text-[15px] tracking-[0.06em] uppercase transition-colors duration-100 hover:bg-arc-cyan-deep"
        >
          <span>Start Building Free</span>
          <span aria-hidden="true">→</span>
        </button>
      </section>

      {/* Footer */}
      <footer className="py-7 px-6 border-t border-n-200 max-w-[1200px] mx-auto flex items-center justify-between flex-wrap gap-3">
        <span className="font-mono font-medium text-[11px] text-n-600 tracking-[0.06em] inline-flex items-center gap-2 flex-wrap">
          <Found3ryWordmark size="sm" />
          <span>· an h3ros venture · workspace graph for builders</span>
        </span>
        <span className="font-mono font-medium text-[10px] text-n-400 tracking-[0.10em] uppercase">
          © {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  )
}

const paraStyle = 'font-body text-[16px] leading-[1.75] text-n-600 mb-4'
