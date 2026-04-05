const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const token = localStorage.getItem('foundry_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export type StreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'done' }
  | { type: 'step_start'; step: number; agent: string; agent_name: string }
  | { type: 'step_delta'; step: number; text: string }
  | { type: 'step_complete'; step: number; agent: string }
  | { type: 'pipeline_complete'; run_id: string }
  | { type: 'error'; message: string }

export async function* streamSSE(
  path: string,
  body: unknown,
): AsyncGenerator<StreamChunk> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body),
    })
  } catch (e) {
    yield { type: 'error', message: e instanceof Error ? e.message : 'Network error — is the backend running?' }
    return
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
