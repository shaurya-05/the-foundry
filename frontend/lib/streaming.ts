import { API_URL, wsPath } from '@/lib/config'
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
  | { type: 'tool_request'; call_id: string; tool: string; args: Record<string, unknown> }
  | { type: 'tool_result'; status: 'ok' | 'timeout'; tool: string; call_id: string; result?: unknown }
  | { type: 'heartbeat' }
  // Phase 3 Stage 4 -- agent loop trace events (backend/app/services/agent_loop.py)
  | { type: 'agent_started'; goal: string }
  | { type: 'agent_tool_call'; iteration: number; tool: string; args: Record<string, unknown> }
  | { type: 'agent_observation'; iteration: number; tool: string; result: unknown }
  | { type: 'agent_confirm_write'; call_id: string; text: string; source: string }
  | { type: 'agent_confirm_system_action'; call_id: string; action: string; target?: string | null; description: string }
  | { type: 'agent_final'; answer: string; iterations_used: number }
  | { type: 'agent_stopped'; reason: string; partial_answer: string }

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

/**
 * WebSocket-based replacement for streamSSE(), same AsyncGenerator<StreamChunk>
 * shape so callers just swap the function name. Built after confirming, via
 * a real production Cloudflare Tunnel test, that SSE responses through the
 * tunnel get buffered by Cloudflare's edge until the connection closes --
 * independent of compression, headers, or three different Cloudflare
 * dashboard settings -- a longstanding, apparently unresolved cloudflared
 * limitation (cloudflare/cloudflared#199, open since 2020). Cloudflare
 * proxies WebSocket connections as raw bidirectional streams, a genuinely
 * different code path not subject to that HTTP-response buffering.
 *
 * Protocol: connect, then send ONE message combining the auth token with
 * the request body ({token, ...body}) -- browsers' native WebSocket API
 * has no way to set a custom Authorization header on the handshake, so
 * auth has to travel as the first payload instead. Server streams back
 * the same JSON shapes the old SSE endpoint sent as `data: ...` lines,
 * now as WebSocket text frames, then closes the connection after `done`
 * -- one connection per message, matching the per-request shape callers
 * already used via streamSSE(), not a persistent multi-turn session.
 */
export async function* streamWS(
  path: string,
  body: unknown,
): AsyncGenerator<StreamChunk> {
  const token = getToken()
  const url = wsPath(path)

  let ws: WebSocket
  try {
    ws = new WebSocket(url)
  } catch (e) {
    yield { type: 'error', message: e instanceof Error ? e.message : 'Could not open WebSocket' }
    return
  }

  const queue: StreamChunk[] = []
  let resolveNext: (() => void) | null = null
  let closed = false
  let errorMsg: string | null = null

  function wake() {
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r()
    }
  }

  // Handlers wired up BEFORE onopen fires, so no message dispatched in
  // the gap between the browser opening the socket and this code running
  // can be missed.
  ws.onmessage = (event: MessageEvent) => {
    try {
      queue.push(JSON.parse(event.data) as StreamChunk)
      wake()
    } catch {
      // ignore parse errors
    }
  }
  ws.onclose = () => {
    closed = true
    wake()
  }
  ws.onerror = () => {
    errorMsg = errorMsg ?? 'WebSocket connection error'
    closed = true
    wake()
  }
  ws.onopen = () => {
    ws.send(JSON.stringify({ token, ...(body as Record<string, unknown>) }))
  }

  try {
    while (true) {
      if (queue.length > 0) {
        const chunk = queue.shift() as StreamChunk
        yield chunk
        if (chunk.type === 'done' || chunk.type === 'pipeline_complete') {
          ws.close()
          return
        }
        continue
      }
      if (closed) {
        if (errorMsg) yield { type: 'error', message: errorMsg }
        return
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve
      })
    }
  } finally {
    // Reached on early return (caller broke out of a `for await` loop)
    // as well as normal completion -- make sure the socket doesn't leak.
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
  }
}

/**
 * POST the frontend's side of an async_frontend round-trip back to the
 * backend (see backend/app/services/agent_tools.py's module docstring).
 * Used both for real file-access results (fileAccess.ts has its own
 * inline POST for that) and for the agent loop's memory-write confirm
 * gate, where the "result" is just {approved: boolean} -- there's no
 * real tool execution on the frontend side, just a user's yes/no.
 */
export async function submitToolResult(callId: string, payload: Record<string, unknown>): Promise<void> {
  await fetch(`${API_URL}/api/copilot/tool-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    body: JSON.stringify({ call_id: callId, ...payload }),
  })
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
