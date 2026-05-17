// ─── Phase 2 §3.1: backend URL hardening ────────────────────────────────────
// CSP connect-src MUST NOT contain *.up.railway.app. Institutional diligence
// flags it. The production target is api.found3ry.com.
//
// Resolution order matches frontend/lib/config.ts:
//   1. NEXT_PUBLIC_API_URL env (set in Vercel)
//   2. https://api.found3ry.com (production default)
//   3. http://localhost:8000 (local dev only)

const RAILWAY_REGEX = /\.up\.railway\.app/i

function resolveApiUrl() {
  const v = process.env.NEXT_PUBLIC_API_URL
  if (v) return v
  return process.env.NODE_ENV === 'production'
    ? 'https://api.found3ry.com'
    : 'http://localhost:8000'
}

function resolveWsUrl() {
  const v = process.env.NEXT_PUBLIC_WS_URL
  if (v) return v
  return process.env.NODE_ENV === 'production'
    ? 'wss://api.found3ry.com'
    : 'ws://localhost:8000'
}

const API_URL = resolveApiUrl()
const WS_URL = resolveWsUrl()

// Build-time guard: refuse to build a production bundle that would leak the
// Railway hostname in CSP. Local dev is exempt so engineers can still run
// against a raw Railway dev environment if needed.
if (process.env.NODE_ENV === 'production') {
  if (RAILWAY_REGEX.test(API_URL)) {
    throw new Error(
      `[next.config] Refusing to build: NEXT_PUBLIC_API_URL (${API_URL}) ` +
      'contains a Railway hostname. Set it to https://api.found3ry.com (Phase 2 §3.1).',
    )
  }
  if (RAILWAY_REGEX.test(WS_URL)) {
    throw new Error(
      `[next.config] Refusing to build: NEXT_PUBLIC_WS_URL (${WS_URL}) ` +
      'contains a Railway hostname. Set it to wss://api.found3ry.com (Phase 2 §3.1).',
    )
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [],
  compress: true,
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              `connect-src 'self' ${API_URL} ${WS_URL}`,
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

export default nextConfig
