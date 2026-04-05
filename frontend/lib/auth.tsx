'use client'

import {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, ReactNode,
} from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export interface WorkspaceMember {
  user_id: string
  email: string
  display_name: string
  avatar_color: string
  role: string
  joined_at: string
}

export interface AuthUser {
  id: string
  email: string
  display_name: string
  avatar_color: string
  workspace_id: string
  workspace_name: string
  role: string
  email_verified: boolean
  members_count: number
  members: WorkspaceMember[]
}

interface AuthContextType {
  user: AuthUser | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName?: string) => Promise<void>
  logout: () => void
  updateProfile: (data: { display_name?: string; avatar_color?: string; workspace_name?: string }) => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

// ─── Token helpers ──────────────────────────────────────────────────────────
function storeTokens(access: string, refresh: string) {
  localStorage.setItem('foundry_token', access)
  localStorage.setItem('foundry_refresh_token', refresh)
}

function clearTokens() {
  localStorage.removeItem('foundry_token')
  localStorage.removeItem('foundry_refresh_token')
}

async function tryRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('foundry_refresh_token')
  if (!refreshToken) return null
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })
    if (!res.ok) return null
    const data = await res.json()
    localStorage.setItem('foundry_token', data.access_token)
    return data.access_token
  } catch {
    return null
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null)
  const [token, setToken]     = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const refreshTimer          = useRef<ReturnType<typeof setInterval>>()

  const fetchUser = useCallback(async (tok: string): Promise<AuthUser> => {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${tok}` },
    })
    if (!res.ok) throw new Error('Session expired')
    return res.json()
  }, [])

  // Schedule silent refresh 5 minutes before expiry (55 min interval for 60 min tokens)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearInterval(refreshTimer.current)
    refreshTimer.current = setInterval(async () => {
      const newToken = await tryRefresh()
      if (newToken) {
        setToken(newToken)
      } else {
        clearTokens()
        setToken(null)
        setUser(null)
      }
    }, 55 * 60 * 1000) // 55 minutes
  }, [])

  // Rehydrate from localStorage on mount
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('foundry_token') : null
    if (stored) {
      setToken(stored)
      fetchUser(stored)
        .then((u) => { setUser(u); scheduleRefresh() })
        .catch(async () => {
          // Access token expired — try refresh
          const newToken = await tryRefresh()
          if (newToken) {
            setToken(newToken)
            try {
              const u = await fetchUser(newToken)
              setUser(u)
              scheduleRefresh()
            } catch {
              clearTokens()
              setToken(null)
            }
          } else {
            clearTokens()
            setToken(null)
          }
        })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [fetchUser, scheduleRefresh])

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    storeTokens(data.access_token, data.refresh_token)
    setToken(data.access_token)
    const me = await fetchUser(data.access_token)
    setUser(me)
    scheduleRefresh()
  }

  const register = async (email: string, password: string, displayName?: string) => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, display_name: displayName }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Registration failed')
    }
    const data = await res.json()
    storeTokens(data.access_token, data.refresh_token)
    setToken(data.access_token)
    const me = await fetchUser(data.access_token)
    setUser(me)
    scheduleRefresh()
  }

  const logout = () => {
    clearTokens()
    setToken(null)
    setUser(null)
    if (refreshTimer.current) clearInterval(refreshTimer.current)
  }

  const updateProfile = async (data: {
    display_name?: string
    avatar_color?: string
    workspace_name?: string
  }) => {
    if (!token) return
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Update failed')
    const me = await fetchUser(token)
    setUser(me)
  }

  const refreshUser = async () => {
    if (!token) return
    const me = await fetchUser(token)
    setUser(me)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateProfile, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
