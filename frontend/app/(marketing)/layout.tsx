/**
 * Marketing route group layout.
 *
 * Per Phase 2 §3.6 (Path A): marketing routes get a minimal layout with
 * NO AuthProvider in the React tree. Auth context is only needed inside
 * the authenticated app (the (app) route group).
 *
 * This layout exists only so the marketing route group is a valid Next.js
 * folder; it's a pass-through render with no client hydration.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
