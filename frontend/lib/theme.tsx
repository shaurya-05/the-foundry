'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextType {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  resolved: 'light',
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  // Load saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem('foundry_theme') as Theme | null
    if (saved && ['light', 'dark', 'system'].includes(saved)) {
      setThemeState(saved)
      applyTheme(resolveTheme(saved))
    } else {
      applyTheme(resolveTheme('system'))
    }
  }, [])

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onChange() {
      if (theme === 'system') {
        applyTheme(getSystemTheme())
      }
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  function applyTheme(r: 'light' | 'dark') {
    setResolved(r)
    document.documentElement.classList.toggle('dark', r === 'dark')
  }

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem('foundry_theme', t)
    applyTheme(resolveTheme(t))
  }

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
