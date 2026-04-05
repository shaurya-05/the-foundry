/**
 * Error reporting utility.
 * Currently logs to console. To enable Sentry:
 * 1. npm install @sentry/nextjs
 * 2. Set NEXT_PUBLIC_SENTRY_DSN env var
 * 3. Uncomment the Sentry integration below
 */

export function reportError(error: Error, context?: Record<string, string>) {
  console.error('[Error]', error.message, context)
}
