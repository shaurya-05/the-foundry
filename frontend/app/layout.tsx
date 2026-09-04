import type { Metadata } from 'next'
import '../styles/globals.css'
import { ThemeProvider } from '@/lib/theme'
// Phase 2 §3.6 — AuthProvider lives in (app)/layout.tsx, NOT root.
// Marketing routes ((marketing)/) skip the auth hydration cycle entirely.

// apple-design comparison branch: no next/font Google Fonts loading.
// §15 — "default to the platform's system font before a custom face;
// override only with a reason." No reason surfaced, so every one of the
// --font-* variable names components already reference is defined as a
// system-font stack directly in styles/globals.css's :root instead of
// being injected by next/font — same variable names, so no component
// needs to change its inline styles for this branch to take effect.

export const metadata: Metadata = {
  title: 'The FOUND3RY — by h3ros',
  description: 'Workspace graph for multi-venture operators. Built by h3ros.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
