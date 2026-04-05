import type { KnowledgeItem, Project, Idea, Task } from './api'

export interface WorkspaceState {
  knowledge: KnowledgeItem[]
  projects: Project[]
  ideas: Idea[]
  tasks: Task[]
}

export function assembleContext(state: WorkspaceState): Record<string, unknown> {
  const taskCounts = state.tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1
    return acc
  }, {})
  return {
    knowledge_count: state.knowledge.length,
    knowledge_titles: state.knowledge.slice(0, 10).map(k => ({ title: k.title, summary: k.summary?.slice(0, 80) })),
    projects: state.projects.slice(0, 10).map(p => ({ title: p.title, status: p.status })),
    idea_domains: state.ideas.slice(0, 5).map(i => i.domains),
    tasks: taskCounts,
  }
}

/** Detect current Forge Cycle phase from workspace state */
export function detectForgeCycle(state: WorkspaceState): 'source' | 'forge' | 'cast' | 'ship' {
  const completedTasks = state.tasks.filter(t => t.status === 'completed').length
  if (completedTasks > 0 && state.projects.length > 0) return 'ship'
  if (state.projects.length > 0) return 'cast'
  if (state.ideas.length > 0) return 'forge'
  return 'source'
}
