/**
 * Single source for the backend API base URL and WebSocket URL.
 *
 * Per Phase 2 brief §3.1: the production target is api.found3ry.com.
 * The raw Railway hostname (`*.up.railway.app`) must NEVER appear in the
 * rendered CSP `connect-src` header — institutional diligence flags it.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_API_URL env var (set in Vercel)
 *   2. https://api.found3ry.com (production default)
 *   3. http://localhost:8000 (local dev fallback)
 *
 * Defensive guard: if a Railway hostname slips into the env var, log a
 * warning at module-load time (visible in browser console) so we catch
 * misconfigured deployments before they ship.
 */

const RAILWAY_REGEX = /\.up\.railway\.app/i

function resolveApiUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL
  if (fromEnv) {
    if (RAILWAY_REGEX.test(fromEnv) && typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[FOUND3RY config] NEXT_PUBLIC_API_URL points at a Railway hostname. ' +
        'This will leak the underlying host in CSP. Set it to https://api.found3ry.com.',
      )
    }
    return fromEnv
  }
  return 'https://api.found3ry.com'
}

function resolveWsUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_WS_URL
  if (fromEnv) {
    if (RAILWAY_REGEX.test(fromEnv) && typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn(
        '[FOUND3RY config] NEXT_PUBLIC_WS_URL points at a Railway hostname. ' +
        'This will leak the underlying host in CSP. Set it to wss://api.found3ry.com.',
      )
    }
    return fromEnv
  }
  return 'wss://api.found3ry.com'
}

/** Backend API base URL (no trailing slash). */
export const API_URL = resolveApiUrl().replace(/\/$/, '')

/** WebSocket base URL (no trailing slash). */
export const WS_URL = resolveWsUrl().replace(/\/$/, '')

/** Convenience: build a full API path. */
export function apiPath(path: string): string {
  return `${API_URL}${path.startsWith('/') ? path : '/' + path}`
}

/** Convenience: build a full WS path. */
export function wsPath(path: string): string {
  return `${WS_URL}${path.startsWith('/') ? path : '/' + path}`
}
