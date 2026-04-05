'use client'

import { useState } from 'react'
import { streamSSE } from '@/lib/streaming'
import { PIPELINE_DEFS } from '@/lib/api'
import GlassCard from '@/components/ui/GlassCard'
import SectionHeader from '@/components/ui/SectionHeader'
import Markdown from '@/components/ui/Markdown'

const AGENTS = [
  {
    id: 'field_analyst',
    name: 'Field Analyst',
    role: 'Research, papers, insights, technology recommendations',
    color: '#0A85FF',
    icon: '◈',
  },
  {
    id: 'systems_architect',
    name: 'Systems Architect',
    role: 'System architectures, tech stacks, technical feasibility',
    color: '#7C3AED',
    icon: '⬡',
  },
  {
    id: 'market_scout',
    name: 'Market Scout',
    role: 'Market sizing, competitors, positioning, customer segments',
    color: '#F06A00',
    icon: '◉',
  },
  {
    id: 'launch_strategist',
    name: 'Launch Strategist',
    role: 'MVP roadmaps, elevator pitches, go-to-market, funding paths',
    color: '#16A34A',
    icon: '▲',
  },
]

interface StepState {
  agent: string
  agentName: string
  status: 'pending' | 'running' | 'complete'
  output: string
}

export default function AgentsClient() {
  const [tab, setTab] = useState<'agent' | 'pipeline'>('agent')
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0].id)
  const [agentContext, setAgentContext] = useState('')
  const [agentOutput, setAgentOutput] = useState('')
  const [agentStreaming, setAgentStreaming] = useState(false)
  const [agentError, setAgentError] = useState('')

  const [selectedPipeline, setSelectedPipeline] = useState(PIPELINE_DEFS[0].id)
  const [pipelineContext, setPipelineContext] = useState('')
  const [pipelineSteps, setPipelineSteps] = useState<StepState[]>([])
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [pipelineComplete, setPipelineComplete] = useState(false)
  const [history, setHistory] = useState<{ agent: string; output: string; ts: Date }[]>([])

  async function runAgent() {
    if (!agentContext.trim() || agentStreaming) return
    setAgentOutput('')
    setAgentError('')
    setAgentStreaming(true)
    let full = ''
    try {
      for await (const chunk of streamSSE('/api/agents/run', { agent_id: selectedAgent, context: agentContext })) {
        if (chunk.type === 'text_delta') {
          full += chunk.text
          setAgentOutput(o => o + chunk.text)
        } else if (chunk.type === 'error') {
          setAgentError(chunk.message)
        }
      }
      if (full) {
        const agent = AGENTS.find(a => a.id === selectedAgent)!
        setHistory(prev => [{ agent: agent.name, output: full, ts: new Date() }, ...prev.slice(0, 9)])
      }
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : 'Unknown error')
    } finally { setAgentStreaming(false) }
  }

  async function runPipeline() {
    if (!pipelineContext.trim() || pipelineRunning) return
    const pipeline = PIPELINE_DEFS.find(p => p.id === selectedPipeline)!
    const initialSteps: StepState[] = pipeline.steps.map((name, i) => ({
      agent: name.toLowerCase().replace(' ', '_'),
      agentName: name,
      status: i === 0 ? 'pending' : 'pending',
      output: '',
    }))
    setPipelineSteps(initialSteps)
    setPipelineRunning(true)
    setPipelineComplete(false)

    try {
      for await (const chunk of streamSSE('/api/agents/pipeline/run', { pipeline_id: selectedPipeline, context: pipelineContext })) {
        if (chunk.type === 'step_start') {
          const idx = chunk.step
          setPipelineSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'running' } : s))
        }
        if (chunk.type === 'step_delta') {
          const idx = chunk.step
          setPipelineSteps(prev => prev.map((s, i) => i === idx ? { ...s, output: s.output + chunk.text } : s))
        }
        if (chunk.type === 'step_complete') {
          const idx = chunk.step
          setPipelineSteps(prev => prev.map((s, i) => i === idx ? { ...s, status: 'complete' } : s))
        }
        if (chunk.type === 'pipeline_complete') {
          setPipelineComplete(true)
        }
      }
    } finally { setPipelineRunning(false) }
  }

  const activeAgent = AGENTS.find(a => a.id === selectedAgent)!
  const activePipeline = PIPELINE_DEFS.find(p => p.id === selectedPipeline)!

  return (
    <div style={{ maxWidth: 1100 }}>
      <SectionHeader title="Agents" sublabel="AI analysis" accent="#7C3AED">
        <span className="badge" style={{ background: 'rgba(155,123,255,0.08)', color: '#7C3AED', border: '1px solid rgba(155,123,255,0.18)' }}>
          4 AGENTS
        </span>
      </SectionHeader>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
        {(['agent', 'pipeline'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #7C3AED' : '2px solid transparent',
              cursor: 'pointer',
              fontFamily: 'var(--font-ibm-plex-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: tab === t ? '#7C3AED' : 'var(--text-muted)',
              marginBottom: -1,
            }}
          >
            {t === 'agent' ? 'Single Agent' : 'Pipelines'}
          </button>
        ))}
      </div>

      {/* Single Agent Tab */}
      {tab === 'agent' && (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
          {/* Crew selection */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              Select Crew Member
            </div>
            {AGENTS.map(agent => (
              <GlassCard
                key={agent.id}
                hover
                style={{
                  padding: '12px 14px',
                  cursor: 'pointer',
                  border: selectedAgent === agent.id ? `1px solid ${agent.color}50` : '1px solid rgba(0,0,0,0.06)',
                  background: selectedAgent === agent.id ? `${agent.color}0A` : undefined,
                }}
                onClick={() => setSelectedAgent(agent.id)}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: `${agent.color}18`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      color: agent.color,
                      flexShrink: 0,
                    }}
                  >
                    {agent.icon}
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: agent.color }}>
                      {agent.name}
                    </div>
                    <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      {agent.role}
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Agent runner */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <GlassCard
              accent={activeAgent.color}
              accentTop
              style={{ padding: '18px 20px' }}
            >
              <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: activeAgent.color, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                {activeAgent.name} — Context Input
              </div>
              <textarea
                className="forge-input"
                placeholder={`Provide context for ${activeAgent.name}...`}
                rows={4}
                value={agentContext}
                onChange={e => setAgentContext(e.target.value)}
              />
              <button
                onClick={runAgent}
                disabled={agentStreaming || !agentContext.trim()}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 10, background: activeAgent.color }}
              >
                {agentStreaming ? `${activeAgent.name.toUpperCase()} ANALYZING...` : `⚡ DEPLOY ${activeAgent.name.toUpperCase()}`}
              </button>
            </GlassCard>

            {agentError && (
              <GlassCard style={{ padding: '14px 18px', border: '1px solid rgba(255,45,45,0.25)' }}>
                <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: '#E8231F', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                  Connection Error
                </div>
                <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 12, color: 'var(--text-muted)' }}>
                  {agentError}. Check that the backend is running at {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}.
                </div>
              </GlassCard>
            )}
            {(agentOutput || agentStreaming) && (
              <GlassCard style={{ padding: '18px 20px', maxHeight: 500, overflow: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: activeAgent.color, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {activeAgent.name} output
                  </div>
                  {agentOutput && !agentStreaming && (
                    <button
                      onClick={() => navigator.clipboard.writeText(agentOutput)}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 9 }}
                    >
                      COPY
                    </button>
                  )}
                </div>
                <Markdown content={agentOutput} streaming={agentStreaming} />
              </GlassCard>
            )}
          </div>
        </div>
      )}

      {/* Pipelines Tab */}
      {tab === 'pipeline' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
          {/* Pipeline cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: 'var(--text-subtle)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              Select Pipeline
            </div>
            {PIPELINE_DEFS.map(p => (
              <GlassCard
                key={p.id}
                hover
                style={{
                  padding: '14px 16px',
                  cursor: 'pointer',
                  border: selectedPipeline === p.id ? `1px solid ${p.accent}50` : '1px solid rgba(0,0,0,0.06)',
                  background: selectedPipeline === p.id ? `${p.accent}0A` : undefined,
                }}
                onClick={() => setSelectedPipeline(p.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 14, letterSpacing: '0.06em', textTransform: 'uppercase', color: p.accent }}>
                    {p.name}
                  </div>
                  <span className="badge" style={{ background: `${p.accent}15`, color: p.accent, fontSize: 8 }}>
                    {p.steps.length} STEPS
                  </span>
                </div>
                <div style={{ fontFamily: 'var(--font-barlow)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {p.description}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {p.steps.map((step, i) => (
                    <span key={i} className="badge" style={{ background: 'rgba(0,0,0,0.03)', color: 'var(--text-muted)', fontSize: 8 }}>
                      {step}
                    </span>
                  ))}
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Pipeline runner */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <GlassCard
              accent={activePipeline.accent}
              accentTop
              style={{ padding: '18px 20px' }}
            >
              <div style={{ fontFamily: 'var(--font-ibm-plex-mono)', fontSize: 9, color: activePipeline.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
                {activePipeline.name} — Context Input
              </div>
              <textarea
                className="forge-input"
                placeholder="Provide context for the pipeline..."
                rows={3}
                value={pipelineContext}
                onChange={e => setPipelineContext(e.target.value)}
              />
              <button
                onClick={runPipeline}
                disabled={pipelineRunning || !pipelineContext.trim()}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 10, background: activePipeline.accent }}
              >
                {pipelineRunning ? 'PIPELINE RUNNING...' : `▶ RUN ${activePipeline.name.toUpperCase()}`}
              </button>
            </GlassCard>

            {/* Step progress */}
            {pipelineSteps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pipelineSteps.map((step, i) => {
                  const agent = AGENTS.find(a => a.name === step.agentName) || AGENTS[i % AGENTS.length]
                  const statusColor = step.status === 'complete' ? '#16A34A' : step.status === 'running' ? agent.color : 'var(--text-subtle)'
                  return (
                    <GlassCard
                      key={i}
                      style={{ padding: '14px 18px', borderLeft: `2px solid ${statusColor}` }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: step.output ? 12 : 0 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0 }}
                          className={step.status === 'running' ? 'accent-dot' : ''} />
                        <div style={{ fontFamily: 'var(--font-barlow-condensed)', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', color: statusColor }}>
                          Step {i + 1}: {step.agentName}
                        </div>
                        <span className="badge" style={{ background: `${statusColor}18`, color: statusColor, fontSize: 8, marginLeft: 'auto' }}>
                          {step.status}
                        </span>
                      </div>
                      {step.output && (
                        <div style={{ maxHeight: 300, overflow: 'auto' }}>
                          <Markdown content={step.output} streaming={step.status === 'running'} />
                        </div>
                      )}
                    </GlassCard>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
