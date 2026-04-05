/** Client-side zero-latency intent classifier for Copilot. */
export type Intent =
  | 'query'
  | 'analyze_project'
  | 'run_agent'
  | 'run_pipeline'
  | 'create_task'
  | 'find_connections'
  | 'workspace_status'
  | 'navigate'
  | 'create_project'

interface IntentResult {
  intent: Intent
  param?: string
}

const patterns: [RegExp, Intent][] = [
  [/\b(run|use|deploy|launch)\s+(field analyst|systems architect|market scout|launch strategist)\b/i, 'run_agent'],
  [/\b(run|start|execute)\s+(pipeline|deep recon|launch readiness|full forge|blueprint design)\b/i, 'run_pipeline'],
  [/\b(create|add|make)\s+(a\s+)?(task|todo)\b/i, 'create_task'],
  [/\b(create|start|new)\s+(a\s+)?(project|build)\b/i, 'create_project'],
  [/\b(go to|open|navigate|show me)\s+(knowledge|archive|projects|workshop|ideas|crucible|tasks|runsheet|agents|crew|workspace|blueprint|launchpad|context|signal)\b/i, 'navigate'],
  [/\b(status|overview|what.?s in|how many|workspace state)\b/i, 'workspace_status'],
  [/\b(find|connect|link|related|relationship|connections?)\b/i, 'find_connections'],
  [/\b(analyze|deep dive|review|evaluate|breakdown)\s+(project|build)\b/i, 'analyze_project'],
]

export function classifyIntent(message: string): IntentResult {
  const lower = message.toLowerCase()
  for (const [pattern, intent] of patterns) {
    const m = lower.match(pattern)
    if (m) {
      return { intent, param: m[2] || m[1] }
    }
  }
  return { intent: 'query' }
}

export function intentLabel(intent: Intent): string {
  const labels: Record<Intent, string> = {
    query: 'QUERY',
    analyze_project: 'ANALYZE',
    run_agent: 'RUN AGENT',
    run_pipeline: 'PIPELINE',
    create_task: 'CREATE TASK',
    find_connections: 'CONNECTIONS',
    workspace_status: 'STATUS',
    navigate: 'NAVIGATE',
    create_project: 'CREATE BUILD',
  }
  return labels[intent]
}
