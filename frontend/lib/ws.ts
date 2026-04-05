/**
 * Authenticated WebSocket helper.
 * Appends ?token=<jwt> to all WS connections for server-side auth.
 */

const WS_BASE = (process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/^http/, 'ws')

export function createAuthWebSocket(path: string): WebSocket | null {
  if (typeof window === 'undefined') return null
  const token = localStorage.getItem('foundry_token')
  if (!token) return null
  const separator = path.includes('?') ? '&' : '?'
  return new WebSocket(`${WS_BASE}${path}${separator}token=${token}`)
}
