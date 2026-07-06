import { API_URL } from '@/lib/config'
import { getToken } from '@/lib/auth'

export class LimitExceededError extends Error {
  upgradeUrl: string
  constructor(upgradeUrl: string) {
    super('limit_exceeded')
    this.name = 'LimitExceededError'
    this.upgradeUrl = upgradeUrl
  }
}

function getAuthHeader(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export type StreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'done' }
  | { type: 'step_start'; step: number; agent: string; agent_name: string }
  | { type: 'step_delta'; step: number; text: string }
  | { type: 'step_complete'; step: number; agent: string }
  | { type: 'pipeline_complete'; run_id: string }
  | { type: 'context'; ventures: number; events: number; doc_hits: number; open_tasks: number; context_md?: string }
  | { type: 'citations'; citations: Array<{ title: string; source_type: string; excerpt: string; source_url?: string }> }
  | { type: 'status'; text: string }
  | { type: 'council'; perspectives: Array<{ model: string; response: string }> }
  | { type: 'thread_id'; thread_id: string }
  | { type: 'model_used'; model: string }
  | { type: 'error'; message: string }

export async function* streamSSE(
  path: string,
  body: unknown,
): AsyncGenerator<StreamChunk> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    })
  } catch (e) {
    yield { type: 'error', message: e instanceof Error ? e.message : 'Network error — is the backend running?' }
    return
  }

  // Auto-refresh token on 401 and retry
  if (res.status === 401) {
    const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('foundry_refresh_token') : null
    if (refreshToken) {
      try {
        const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (refreshRes.ok) {
          const data = await refreshRes.json()
          localStorage.setItem('foundry_token', data.access_token)
          res = await fetch(`${API_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.access_token}` },
            body: JSON.stringify(body),
          })
        }
      } catch { /* refresh failed */ }
    }
  }

  if (res.status === 429) {
    let upgradeUrl = '/settings'
    try {
      const data = await res.json()
      // FastAPI wraps detail: { error, upgrade_url } inside { "detail": {...} }
      if (data?.detail?.upgrade_url) upgradeUrl = data.detail.upgrade_url
    } catch { /* ignore parse errors */ }
    throw new LimitExceededError(upgradeUrl)
  }

  if (!res.ok) {
    yield { type: 'error', message: `HTTP ${res.status}` }
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6)) as StreamChunk
          yield data
          if (data.type === 'done' || data.type === 'pipeline_complete') return
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}

/** Collect full text from a stream. Calls onChunk for each text_delta. */
export async function collectStream(
  path: string,
  body: unknown,
  onChunk: (text: string) => void,
): Promise<string> {
  let full = ''
  for await (const chunk of streamSSE(path, body)) {
    if (chunk.type === 'text_delta') {
      full += chunk.text
      onChunk(chunk.text)
    }
  }
  return full
}
