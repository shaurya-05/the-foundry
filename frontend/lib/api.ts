const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const token = localStorage.getItem('foundry_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Extract workspace_id from the stored JWT payload. Falls back to empty string. */
function getWorkspaceId(): string {
  if (typeof window === 'undefined') return ''
  const token = localStorage.getItem('foundry_token')
  if (!token) return ''
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.workspace_id || ''
  } catch {
    return ''
  }
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  let res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...getAuthHeader(), ...options?.headers },
    ...options,
  })

  // Auto-refresh token on 401 and retry once
  if (res.status === 401) {
    const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('foundry_refresh_token') : null
    if (refreshToken) {
      try {
        const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (refreshRes.ok) {
          const data = await refreshRes.json()
          localStorage.setItem('foundry_token', data.access_token)
          // Retry original request with new token
          res = await fetch(`${API_BASE}${path}`, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.access_token}`, ...options?.headers },
            ...options,
          })
        }
      } catch { /* refresh failed, will throw below */ }
    }
  }

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || `HTTP ${res.status}`)
  }
  return res.json()
}

// ─── Knowledge ───────────────────────────────────────────────────────────────
export const api = {
  knowledge: {
    list: () => req<KnowledgeItem[]>('/api/knowledge'),
    create: (data: KnowledgeCreate) => req<KnowledgeItem>('/api/knowledge', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => req('/api/knowledge/' + id, { method: 'DELETE' }),
    search: (q: string, type?: string) => req<KnowledgeItem[]>(`/api/knowledge/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`),
  },
  projects: {
    list: () => req<Project[]>('/api/projects'),
    create: (data: { title: string }) => req<Project>('/api/projects', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Project>) => req<Project>('/api/projects/' + id, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => req('/api/projects/' + id, { method: 'DELETE' }),
    related: (id: string) => req<RelatedItems>('/api/projects/' + id + '/related', { method: 'POST' }),
    export: (id: string) => req<{ title: string; status: string; plan: string; notes: string; tasks: { title: string; status: string; description: string; priority: string }[]; created_at: string }>('/api/projects/' + id + '/export'),
  },
  copilot: {
    history: (projectId?: string) => req<{ id: string; role: string; content: string; created_at: string }[]>('/api/copilot/history' + (projectId ? `?project_id=${projectId}` : '')),
  },
  ideas: {
    list: () => req<Idea[]>('/api/ideas'),
    create: (data: { domains: string; content: string }) => req<Idea>('/api/ideas', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) => req('/api/ideas/' + id, { method: 'DELETE' }),
    getSwot: (id: string) => req<{ swot: string; swot_generated_at: string }>('/api/ideas/' + id + '/swot'),
  },
  tasks: {
    list: (params?: { project_id?: string; status?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString()
      return req<Task[]>('/api/tasks' + (qs ? '?' + qs : ''))
    },
    create: (data: TaskCreate) => req<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Task>) => req<Task>('/api/tasks/' + id, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => req('/api/tasks/' + id, { method: 'DELETE' }),
    myTasks: () => req<Task[]>('/api/tasks/my'),
  },
  agents: {
    pipelines: () => Promise.resolve(PIPELINE_DEFS),
    getRunStatus: (runId: string) => req(`/api/agents/pipeline/${runId}`),
    suggest: (taskTitle: string, taskDescription?: string) =>
      req<{ suggested_agent: string; suggested_agent_name: string; confidence: string }>(`/api/agents/suggest?task_title=${encodeURIComponent(taskTitle)}&task_description=${encodeURIComponent(taskDescription || '')}`),
  },
  analytics: {
    velocity: () => req<{ completed_this_week: number; completed_last_week: number; created_this_week: number; created_last_week: number; velocity_ratio: number; trend: string }>('/api/analytics/velocity'),
    health: () => req<{ project_id: string; title: string; total_tasks: number; completed: number; blocked: number; overdue: number; health_score: number; health_label: string }[]>('/api/analytics/health'),
    attention: () => req<{ type: string; title: string; detail: string; entity_id: string; entity_type: string; severity: string }[]>('/api/analytics/attention'),
  },
  context: {
    insights: () => req<{ insights: string }>('/api/context/insights'),
    connections: () => req<{ connections: GraphConnection[] }>('/api/context/connections'),
    timeline: (limit = 50) => req<{ events: ActivityEvent[] }>(`/api/context/timeline?limit=${limit}`),
  },
  notifications: {
    list: () => req<AppNotification[]>('/api/notifications'),
    markRead: (id: string) => req('/api/notifications/' + id + '/read', { method: 'PATCH' }),
    markAllRead: () => req('/api/notifications/read-all', { method: 'PATCH' }),
    delete: (id: string) => req('/api/notifications/' + id, { method: 'DELETE' }),
  },
  command: {
    parse: (raw_input: string) => req<ParsedCommand>('/api/command/parse', { method: 'POST', body: JSON.stringify({ raw_input }) }),
    history: () => req('/api/command/history'),
  },
  blueprint: {
    get: (workspaceId?: string) => {
      const wsId = workspaceId || getWorkspaceId()
      return req<{ nodes: BlueprintNode[]; edges: unknown[]; updated_at: string | null }>(`/api/blueprint?workspace_id=${wsId}`)
    },
    save: (nodes: BlueprintNode[], edges: unknown[] = [], workspaceId?: string) => {
      const wsId = workspaceId || getWorkspaceId()
      return req<{ ok: boolean; updated_at: string }>(`/api/blueprint?workspace_id=${wsId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nodes, edges }),
      })
    },
    broadcastOp: (opType: string, payload: Record<string, unknown>, workspaceId?: string) => {
      const wsId = workspaceId || getWorkspaceId()
      return req<{ ok: boolean }>(`/api/blueprint/op?workspace_id=${wsId}`, {
        method: 'POST',
        body: JSON.stringify({ op_type: opType, payload }),
      })
    },
  },
  workspace: {
    members: (workspaceId?: string) => {
      const wsId = workspaceId || getWorkspaceId()
      return req<{ members: WorkspaceMember[] }>(`/api/workspace/members?workspace_id=${wsId}`)
    },
    invite: (email: string, role = 'member', workspaceId?: string) => {
      const wsId = workspaceId || getWorkspaceId()
      return req<{ id: string; token: string; invite_url: string; expires_at: string }>(
        `/api/workspace/invite?workspace_id=${wsId}`,
        { method: 'POST', body: JSON.stringify({ email, role }) },
      )
    },
    join: (token: string) =>
      req<{ user_id: string; workspace_id: string; role: string }>('/api/workspace/join', { method: 'POST', body: JSON.stringify({ token }) }),
    updateMemberRole: (userId: string, role: string) =>
      req<{ ok: boolean }>(`/api/workspace/members/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    removeMember: (userId: string) =>
      req<{ ok: boolean }>(`/api/workspace/members/${userId}`, { method: 'DELETE' }),
    setProjectVisibility: (id: string, visibility: string, clearanceLevel?: number) =>
      req<{ id: string; visibility: string; clearance_level: number }>(
        `/api/workspace/projects/${id}/visibility`,
        { method: 'PATCH', body: JSON.stringify({ visibility, clearance_level: clearanceLevel }) },
      ),
    setIdeaVisibility: (id: string, visibility: string, clearanceLevel?: number) =>
      req<{ id: string; visibility: string; clearance_level: number }>(
        `/api/workspace/ideas/${id}/visibility`,
        { method: 'PATCH', body: JSON.stringify({ visibility, clearance_level: clearanceLevel }) },
      ),
    setKnowledgeVisibility: (id: string, visibility: string) =>
      req<{ id: string; visibility: string }>(
        `/api/workspace/knowledge/${id}/visibility`,
        { method: 'PATCH', body: JSON.stringify({ visibility }) },
      ),
  },
}

// ─── Streaming URLs ──────────────────────────────────────────────────────────
export function streamUrl(path: string) {
  return `${API_BASE}${path}`
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface KnowledgeItem {
  id: string
  title: string
  content: string
  summary?: string
  type: string
  tags?: string[]
  source_url?: string
  visibility: 'private' | 'team' | 'public'
  created_at: string
}

export interface KnowledgeCreate {
  title: string
  content: string
  type: string
  tags?: string[]
  source_url?: string
}

export interface Project {
  id: string
  title: string
  plan?: string
  notes?: string
  status: string
  visibility: 'private' | 'team' | 'public'
  clearance_level: number
  created_at: string
}

export interface Idea {
  id: string
  domains: string
  content: string
  visibility: 'private' | 'team' | 'public'
  clearance_level: number
  created_at: string
}

export interface Task {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  project_id?: string
  due_date?: string
  source: string
  created_at: string
  updated_at: string
}

export interface TaskCreate {
  title: string
  description?: string
  status?: string
  priority?: string
  project_id?: string
  due_date?: string
  source?: string
}

export interface GraphConnection {
  from_type: string
  from_id: string
  from_title: string
  rel_type: string
  score: number
  to_type: string
  to_id: string
  to_title: string
}

export interface ActivityEvent {
  id: string
  type: string
  title: string
  detail?: string
  entity_type?: string
  entity_id?: string
  created_at: string
}

export interface AppNotification {
  id: string
  type: string
  title: string
  body?: string
  read: boolean
  created_at: string
}

export interface ParsedCommand {
  type: string
  path?: string
  param?: string
  raw: string
}

export interface RelatedItems {
  knowledge: { id: string; title: string; summary?: string; type: string }[]
  ideas: { id: string; domains: string }[]
  tasks: { id: string; title: string; status: string }[]
}

export interface BlueprintNode {
  id: string
  type: string
  title: string
  body?: string
  x: number
  y: number
  visibility: 'private' | 'team' | 'public'
}

export interface WorkspaceMember {
  id: string
  user_id: string
  email: string
  role: string
  joined_at: string
}

// ─── Pipeline definitions (client-side) ─────────────────────────────────────
export const PIPELINE_DEFS = [
  {
    id: 'deep_recon',
    name: 'Deep Recon',
    description: 'Research → Architecture. Deep technical analysis.',
    steps: ['Field Analyst', 'Systems Architect'],
    accent: '#3ABEFF',
  },
  {
    id: 'launch_readiness',
    name: 'Launch Readiness',
    description: 'Market sizing → Startup strategy. Full business validation.',
    steps: ['Market Scout', 'Launch Strategist'],
    accent: '#38D37A',
  },
  {
    id: 'full_forge',
    name: 'Full Forge Run',
    description: 'All 4 crew in sequence. Maximum intelligence depth.',
    steps: ['Field Analyst', 'Systems Architect', 'Market Scout', 'Launch Strategist'],
    accent: '#FF3B3B',
  },
  {
    id: 'blueprint_design',
    name: 'Blueprint Design',
    description: 'Architecture → Market fit. Design-first approach.',
    steps: ['Systems Architect', 'Market Scout'],
    accent: '#A78BFA',
  },
]
