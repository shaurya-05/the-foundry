import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/dashboard') {
    const token = request.cookies.get('foundry_token')?.value
    if (!token) return NextResponse.next()

    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        // Short timeout so a backend outage doesn't block the page
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) {
        const user = await res.json()
        if (typeof user.onboarding_step === 'number' && user.onboarding_step === 0) {
          return NextResponse.redirect(new URL('/onboarding/venture', request.url))
        }
      }
    } catch {
      // Backend unreachable or token expired — let the page handle auth
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard'],
}
