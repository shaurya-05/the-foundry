'use client'

/**
 * Stage 2 dashboard — one place to watch the system run.
 *
 * Role-gated by the backend on `trace.read` (Stage 1), using the same session
 * as the rest of the app. There is no second login and no separate tool per
 * concern: traces, per-tier model latency, tool outcomes, reflection criteria,
 * VRAM, circuit breakers and the retention policy all read from one summary.
 *
 * Deliberately not charted. Every panel here is a count, a rank or a tree —
 * jobs that a stat tile or a table does better than a plot. The one magnitude
 * comparison that earns a visual is span duration within a trace, drawn as
 * single-hue bars against the trace's own longest span. Status is never colour
 * alone: an errored span carries the word "error" next to it.
 */

import { useEffect, useState } from 'react'
import { api, AccessMe, ObsSpan, ObsSummary, ObsTrace, ObsTraceDetail, ObsMetricRow } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'

const HOURS = 24

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function fmtBytes(n: number | null | undefined): string {
  if (!n) return '—'
  const gb = n / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

/** A single headline number. Not a chart — there is nothing to compare it to. */
function Stat({ label, value, note, alert }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div style={{ flex: '1 1 160px', minWidth: 140 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-n400)' }}>
        {label}
      </div>
      <div style={{
        fontSize: 28, fontWeight: 600, lineHeight: 1.2, marginTop: 4,
        color: alert ? 'var(--color-signal)' : 'var(--color-ink)',
      }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 12, color: 'var(--color-n400)', marginTop: 2 }}>{note}</div>}
    </div>
  )
}

/** Span tree. Indentation carries hierarchy; bar length carries duration. */
function SpanRow({ span, depth, maxMs }: { span: ObsSpan; depth: number; maxMs: number }) {
  const isError = span.status === 'error'
  const pct = maxMs > 0 && span.duration_ms ? Math.max(1.5, (span.duration_ms / maxMs) * 100) : 1.5
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', fontSize: 13 }}>
        <div style={{ width: 300, paddingLeft: depth * 16, flexShrink: 0, color: 'var(--color-ink)' }}>
          <span style={{ color: 'var(--color-n400)', fontSize: 11, marginRight: 6 }}>{span.service}</span>
          {span.name}
          {isError && (
            <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-signal)' }}>
              error
            </span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 80, background: 'var(--color-n200)', borderRadius: 4, height: 8 }}>
          <div
            title={`${span.name} — ${fmtMs(span.duration_ms)}`}
            style={{
              width: `${pct}%`, height: '100%', borderRadius: 4,
              background: isError ? 'var(--color-signal)' : 'var(--color-arc-cyan-deep)',
            }}
          />
        </div>
        <div style={{ width: 80, textAlign: 'right', color: 'var(--color-n400)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMs(span.duration_ms)}
        </div>
      </div>
      {span.error && (
        <div style={{ paddingLeft: depth * 16 + 12, fontSize: 12, color: 'var(--color-signal)', paddingBottom: 4 }}>
          {span.error}
        </div>
      )}
      {span.children.map(c => <SpanRow key={c.span_id} span={c} depth={depth + 1} maxMs={maxMs} />)}
    </>
  )
}

function maxDuration(spans: ObsSpan[]): number {
  let max = 0
  const walk = (s: ObsSpan) => {
    if (s.duration_ms && s.duration_ms > max) max = s.duration_ms
    s.children.forEach(walk)
  }
  spans.forEach(walk)
  return max
}

function MetricTable({ title, rows, unit }: { title: string; rows: ObsMetricRow[]; unit?: string }) {
  if (!rows?.length) return null
  const fmt = (v: number | null) => {
    if (v === null) return '—'
    if (unit === 'ms') return fmtMs(v)
    if (unit === 'bytes') return fmtBytes(v)
    return v.toFixed(v < 10 ? 2 : 0)
  }
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-n600)', marginBottom: 6 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ color: 'var(--color-n400)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <th style={{ textAlign: 'left', padding: '4px 0' }}>Labels</th>
            <th style={{ textAlign: 'right' }}>Samples</th>
            <th style={{ textAlign: 'right' }}>Avg</th>
            <th style={{ textAlign: 'right' }}>Max</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--color-n200)' }}>
              <td style={{ padding: '5px 0', color: 'var(--color-ink)' }}>
                {Object.entries(r.labels).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--color-n400)', fontVariantNumeric: 'tabular-nums' }}>{r.samples}</td>
              <td style={{ textAlign: 'right', color: 'var(--color-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.avg)}</td>
              <td style={{ textAlign: 'right', color: 'var(--color-n400)', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ObservabilityClient() {
  const [me, setMe] = useState<AccessMe | null>(null)
  const [summary, setSummary] = useState<ObsSummary | null>(null)
  const [traces, setTraces] = useState<ObsTrace[]>([])
  const [metrics, setMetrics] = useState<Record<string, ObsMetricRow[]>>({})
  const [detail, setDetail] = useState<ObsTraceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [meRes, sum, tr, met] = await Promise.all([
        api.access.me(),
        api.observability.summary(HOURS),
        api.observability.traces(50),
        api.observability.metrics(HOURS),
      ])
      setMe(meRes)
      setSummary(sum)
      setTraces(tr.traces)
      setMetrics(met.metrics)
    } catch (e) {
      // A 403 here is the role gate working, not a broken page — say which.
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg.includes('trace.read')
        ? 'Your role does not include the trace.read permission.'
        : msg)
    } finally { setLoading(false) }
  }

  async function openTrace(id: string) {
    try { setDetail(await api.observability.trace(id)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--color-n400)' }}>Loading…</div>

  if (error) {
    return (
      <div className="page-enter" style={{ maxWidth: 960 }}>
        <SectionHeader title="Observability" sublabel="Stage 2" accent="var(--color-signal)" />
        <GlassCard>
          <div style={{ color: 'var(--color-signal)', fontWeight: 600, marginBottom: 6 }}>Cannot load</div>
          <div style={{ fontSize: 13, color: 'var(--color-n400)' }}>{error}</div>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="page-enter" style={{ maxWidth: 1040 }}>
      <SectionHeader title="Observability" sublabel={`Last ${HOURS}h`} accent="var(--color-arc-cyan-deep)">
        {me && (
          <span className="badge" style={{
            background: 'var(--color-arc-soft)', color: 'var(--color-arc-cyan-deep)',
            border: '1px solid var(--color-arc-soft)',
          }}>
            {me.teams[0]?.role_name ?? 'no role'} · {me.permissions.length} permissions
          </span>
        )}
      </SectionHeader>

      <GlassCard>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          <Stat label="Traces" value={String(summary?.traces ?? 0)} />
          <Stat label="Spans" value={String(summary?.spans ?? 0)} />
          <Stat label="Errored spans" value={String(summary?.errors ?? 0)} alert={(summary?.errors ?? 0) > 0} />
          <Stat
            label="Retention"
            value={`${summary?.retention.policy_days ?? '—'} d`}
            note={summary?.retention.oldest_span ? `oldest ${fmtTime(summary.retention.oldest_span)}` : 'no spans yet'}
          />
        </div>
      </GlassCard>

      <div style={{ height: 16 }} />

      <GlassCard>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-n600)', marginBottom: 10 }}>
          Recent traces
        </div>
        {traces.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-n400)' }}>
            No traces in this workspace yet.
          </div>
        )}
        {traces.map(t => (
          <div
            key={t.trace_id}
            onClick={() => openTrace(t.trace_id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', fontSize: 13,
              borderTop: '1px solid var(--color-n200)', cursor: 'pointer',
            }}
          >
            <div style={{ flex: 1, color: 'var(--color-ink)' }}>
              <span style={{ color: 'var(--color-n400)', fontSize: 11, marginRight: 6 }}>{t.root_service ?? '—'}</span>
              {t.root_name ?? t.trace_id.slice(0, 8)}
              {t.error_count > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--color-signal)' }}>
                  {t.error_count} error{t.error_count === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div style={{ color: 'var(--color-n400)', fontSize: 12 }}>{t.span_count} spans</div>
            <div style={{ width: 150, textAlign: 'right', color: 'var(--color-n400)', fontSize: 12 }}>
              {fmtTime(t.started_at)}
            </div>
          </div>
        ))}
      </GlassCard>

      {detail && (
        <>
          <div style={{ height: 16 }} />
          <GlassCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-n600)' }}>
                Trace {detail.trace_id.slice(0, 8)} · {detail.span_count} spans
              </div>
              <button
                onClick={() => setDetail(null)}
                style={{ background: 'none', border: 'none', color: 'var(--color-n400)', cursor: 'pointer', fontSize: 12 }}
              >
                close
              </button>
            </div>
            {detail.disconnected && (
              <div style={{
                fontSize: 12, color: 'var(--color-signal)', marginBottom: 10, fontWeight: 600,
              }}>
                Disconnected: {detail.root_count} roots. A trace with more than one root has lost
                context at a hop — the pieces are not joined.
              </div>
            )}
            {detail.roots.map(r => (
              <SpanRow key={r.span_id} span={r} depth={0} maxMs={maxDuration(detail.roots)} />
            ))}
          </GlassCard>
        </>
      )}

      <div style={{ height: 16 }} />

      <GlassCard>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-n600)', marginBottom: 10 }}>
          Slowest operations
        </div>
        {summary?.slowest.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-n400)' }}>Nothing recorded yet.</div>
        )}
        {summary?.slowest.map((s, i) => (
          <div key={i} style={{
            display: 'flex', gap: 12, padding: '5px 0', fontSize: 13,
            borderTop: '1px solid var(--color-n200)',
          }}>
            <div style={{ flex: 1, color: 'var(--color-ink)' }}>
              <span style={{ color: 'var(--color-n400)', fontSize: 11, marginRight: 6 }}>{s.service}</span>
              {s.name}
            </div>
            <div style={{ width: 70, textAlign: 'right', color: 'var(--color-n400)', fontSize: 12 }}>{s.calls} calls</div>
            <div style={{ width: 80, textAlign: 'right', color: 'var(--color-ink)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtMs(s.avg_ms)}
            </div>
          </div>
        ))}
      </GlassCard>

      <div style={{ height: 16 }} />

      <GlassCard>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-n600)', marginBottom: 12 }}>
          Metrics
        </div>
        <MetricTable title="Model latency by tier" rows={metrics['model.latency_ms'] ?? []} unit="ms" />
        <MetricTable title="Model throughput (tokens/sec)" rows={metrics['model.tokens_per_second'] ?? []} />
        <MetricTable title="Tool executions" rows={metrics['tool.execution'] ?? []} />
        <MetricTable title="Reflection criteria" rows={metrics['reflection.criterion'] ?? []} />
        <MetricTable title="VRAM by tier" rows={metrics['vram.model_bytes'] ?? []} unit="bytes" />
        <MetricTable title="VRAM total" rows={metrics['vram.total_bytes'] ?? []} unit="bytes" />
        {Object.keys(metrics).length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--color-n400)' }}>
            No samples in this window.
          </div>
        )}
      </GlassCard>

      <div style={{ height: 16 }} />

      <GlassCard>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-n600)', marginBottom: 10 }}>
          Circuit breakers
        </div>
        {(!summary?.circuit_breakers || summary.circuit_breakers.length === 0) && (
          <div style={{ fontSize: 13, color: 'var(--color-n400)' }}>No connectors reporting.</div>
        )}
        {summary?.circuit_breakers.map((c, i) => {
          const open = c.state === 'open'
          return (
            <div key={i} style={{
              display: 'flex', gap: 12, padding: '5px 0', fontSize: 13,
              borderTop: '1px solid var(--color-n200)',
            }}>
              <div style={{ flex: 1, color: 'var(--color-ink)' }}>{c.connector}</div>
              <div style={{
                width: 120, textAlign: 'right', fontWeight: 600,
                color: open ? 'var(--color-signal)' : 'var(--color-n400)',
              }}>
                {open ? 'open (tripped)' : c.state}
              </div>
            </div>
          )
        })}
      </GlassCard>
    </div>
  )
}
