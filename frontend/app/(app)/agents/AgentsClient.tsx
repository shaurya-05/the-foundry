'use client'

/**
 * COFOUND3R — the single operator-grade agent surface.
 *
 * Phase 2 §3 DELETE list: four-agent specialist UI is gone. One input
 * box, one streaming answer, one context-preamble pill showing what
 * the agent has access to (ventures, events, doc hits, open tasks).
 *
 * Backed by POST /api/agent/ask which reads the workspace graph built
 * by the connector ingestion pipeline.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { streamSSE } from '@/lib/streaming'
import Markdown from '@/components/ui/Markdown'
import EyebrowLabel from '@/components/brand/EyebrowLabel'
import Crease from '@/components/brand/Crease'
import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'

type Exchange = {
  q: string
  a: string
  ts: Date
  context?: { ventures: number; events: number; doc_hits: number; open_tasks: number }
  context_md?: string
}

const STARTER_QUERIES = [
  'What did I ship across all my ventures this week?',
  'Which open issues are blocking shipping?',
  'Summarize the most active venture right now.',
  'Across my portfolio, what looks risky or stalled?',
]

export default function AgentsClient() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [error, setError] = useState('')
  const [contextPreview, setContextPreview] = useState<{ ventures: number; doc_hits: number; events: number; open_tasks: number } | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [expandedPanels, setExpandedPanels] = useState<Record<number, boolean>>({})

  // Surface the "graph empty?" hint: peek at the context preview.
  useEffect(() => {
    const token = getToken()
    if (!token) return
    fetch(`${API_URL}/api/agent/context?q=portfolio`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setContextPreview(d.counts))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight
    }
  }, [exchanges, streaming])

  async function ask(q: string) {
    if (!q.trim() || streaming) return
    setError('')
    setStreaming(true)
    const pending: Exchange = { q, a: '', ts: new Date() }
    setExchanges((prev) => [...prev, pending])
    setQuery('')

    try {
      for await (const chunk of streamSSE('/api/agent/ask', { query: q })) {
        if (chunk.type === 'context') {
          setExchanges((prev) => {
            const copy = [...prev]
            copy[copy.length - 1] = {
              ...copy[copy.length - 1],
              context: {
                ventures: chunk.ventures,
                events: chunk.events,
                doc_hits: chunk.doc_hits,
                open_tasks: chunk.open_tasks,
              },
              context_md: chunk.context_md as string | undefined,
            }
            return copy
          })
        } else if (chunk.type === 'text_delta') {
          setExchanges((prev) => {
            const copy = [...prev]
            copy[copy.length - 1] = { ...copy[copy.length - 1], a: copy[copy.length - 1].a + chunk.text }
            return copy
          })
        } else if (chunk.type === 'error') {
          setError(chunk.message)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setStreaming(false)
    }
  }

  const noGraph = contextPreview && contextPreview.ventures === 0

  return (
    <div className="min-h-screen bg-off-white px-6 py-12 font-archivo">
      <div className="mx-auto max-w-3xl">
        <EyebrowLabel number="01" keyword="The agent" />
        <h1 className="font-archivo-black text-4xl text-ink leading-none mt-2 mb-2">
          COFOUND3R.
        </h1>
        <p className="text-n600 text-base max-w-xl">
          One agent, your entire portfolio. Asks across every venture you've connected — by name.
        </p>
        <div className="mt-4"><Crease /></div>

        {noGraph && (
          <div className="mt-6 border border-n200 bg-vellum p-4">
            <div className="text-sm text-ink mb-2">
              Your workspace graph is empty. Connect a tool to give COFOUND3R something to read.
            </div>
            <button
              onClick={() => router.push('/settings/connections')}
              className="bg-arc-cyan text-ink px-3 py-1.5 text-xs font-mono uppercase tracking-wider hover:bg-arc-cyan-deep transition-colors"
            >
              Open connections →
            </button>
          </div>
        )}

        {exchanges.length === 0 && !noGraph && (
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STARTER_QUERIES.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="text-left border border-n200 bg-vellum p-3 text-sm text-ink hover:border-arc-cyan-deep transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={scrollerRef} className="mt-8 space-y-6 max-h-[60vh] overflow-y-auto pr-2">
          {exchanges.map((ex, i) => (
            <div key={i}>
              <div className="text-xs font-mono uppercase tracking-wider text-n600 mb-1">You</div>
              <div className="text-base text-ink mb-3">{ex.q}</div>
              <div className="text-xs font-mono uppercase tracking-wider text-arc-cyan-deep mb-1">COFOUND3R</div>
              <div className="text-base text-ink">
                {ex.a ? <Markdown content={ex.a} streaming={streaming && i === exchanges.length - 1} /> : streaming && i === exchanges.length - 1 ? <span className="text-n600">…</span> : null}
              </div>
              {ex.context && !(streaming && i === exchanges.length - 1) && (
                <div className="mt-3 border border-n200 bg-vellum">
                  <button
                    onClick={() => setExpandedPanels(prev => ({ ...prev, [i]: !prev[i] }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono uppercase tracking-wider text-n600 hover:text-ink transition-colors"
                  >
                    <span>
                      What I read — {ex.context.ventures} ventures · {ex.context.doc_hits} docs · {ex.context.events} events · {ex.context.open_tasks} open tasks
                    </span>
                    <svg
                      className={`w-3 h-3 flex-shrink-0 transition-transform duration-150 ${expandedPanels[i] ? 'rotate-180' : ''}`}
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 4l4 4 4-4" />
                    </svg>
                  </button>
                  {expandedPanels[i] && (
                    <div className="border-t border-n200 px-3 py-2 text-[11px] font-mono text-n600 whitespace-pre-wrap leading-relaxed">
                      {ex.context_md ?? `${ex.context.ventures} ventures · ${ex.context.doc_hits} docs · ${ex.context.events} events · ${ex.context.open_tasks} open tasks`}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {error && <div className="mt-4 text-sm text-signal">{error}</div>}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(query)
          }}
          className="mt-6 flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={streaming}
            placeholder="Ask anything across your portfolio…"
            className="flex-1 bg-vellum border border-n200 px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-arc-cyan-deep"
          />
          <button
            type="submit"
            disabled={streaming || !query.trim()}
            className="bg-arc-cyan text-ink px-5 py-2.5 text-xs font-mono uppercase tracking-wider hover:bg-arc-cyan-deep transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {streaming ? 'Thinking…' : 'Ask →'}
          </button>
        </form>
      </div>
    </div>
  )
}
