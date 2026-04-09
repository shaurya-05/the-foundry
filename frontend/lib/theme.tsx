'use client'

// Light theme only — no dark mode or system detection needed.
// This file is kept as a stub so existing imports don't break.

export function useTheme() {
  return {
    theme: 'light' as const,
    resolved: 'light' as const,
    setTheme: () => {},
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
