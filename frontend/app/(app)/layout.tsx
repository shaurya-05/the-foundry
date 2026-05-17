/**
 * Authenticated app route group layout.
 *
 * Per Phase 2 §3.6 (Path A): AuthProvider lives here, not in the root
 * layout. This means marketing routes ((marketing) group) don't pay the
 * cost of the auth hydration cycle, and the CSP `connect-src` for the
 * landing page can be evaluated without a /api/auth/me request firing.
 *
 * All authenticated pages (dashboard, projects, tasks, etc.) AND the
 * auth-flow pages (login, register, forgot, reset, verify, join) live
 * inside this group because they all use the useAuth() hook in some
 * capacity.
 */
import { AuthProvider } from '@/lib/auth'

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}
