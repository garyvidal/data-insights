import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getMe, loginApi, logoutApi, setAuthenticated } from '../services/api'

interface AuthContextValue {
  user: string | null
  loading: boolean
  sessionExpired: boolean
  dismissSessionExpired: () => void
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  useEffect(() => {
    getMe()
      .then(u => { setAuthenticated(true); setUser(u) })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handler = () => {
      setUser(null)
      setSessionExpired(true)
    }
    window.addEventListener('session-expired', handler)
    return () => window.removeEventListener('session-expired', handler)
  }, [])

  function dismissSessionExpired() {
    setSessionExpired(false)
  }

  async function login(username: string, password: string) {
    const u = await loginApi(username, password)
    setAuthenticated(true)
    setUser(u)
  }

  async function logout() {
    await logoutApi()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, sessionExpired, dismissSessionExpired, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
