import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { clearToken, login as apiLogin } from './api'

/**
 * App sign-in. Accounts are local to this browser (salted hash in localStorage); the session is the
 * id of the signed-in user. Signing in also opens the Laravel API session when the same username and
 * password exist on the server, so the four server-driven pages don't ask for a second login.
 */
export interface AuthUser {
  id: string
  username: string
  email: string
}

interface StoredUser extends AuthUser {
  salt: string
  hash: string
  createdAt: string
}

/** Bypass for demos: lets anyone in without credentials. Off — every visitor signs in. */
export const ALLOW_GUEST_LOGIN = false
const GUEST: AuthUser = { id: 'guest', username: 'مدير النظام', email: '' }

const USERS_KEY = 'codex.auth.users'
const SESSION_KEY = 'codex.auth.session'

const readUsers = (): StoredUser[] => {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(USERS_KEY) ?? '[]')
    return Array.isArray(list) ? (list as StoredUser[]) : []
  } catch {
    return []
  }
}
const writeUsers = (users: StoredUser[]) => {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users))
  } catch {
    // Storage unavailable; the account lasts until reload.
  }
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const text = `${salt}:${password}`
  if (!globalThis.crypto?.subtle) return btoa(unescape(encodeURIComponent(text)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const randomSalt = () =>
  [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')

const publicUser = ({ id, username, email }: StoredUser): AuthUser => ({ id, username, email })
const norm = (s: string) => s.trim().toLowerCase()

export type AuthResult = { ok: true } | { ok: false; field?: 'username' | 'email' | 'password' | 'identifier'; message: string }

interface AuthContextValue {
  user: AuthUser | null
  /** True until the first account exists on this device. */
  firstRun: boolean
  login: (identifier: string, password: string) => Promise<AuthResult>
  register: (input: { username: string; email: string; password: string }) => Promise<AuthResult>
  /** Local-only recovery: the username and email must belong to the same account. */
  resetPassword: (input: { username: string; email: string; password: string }) => Promise<AuthResult>
  /** Enter without credentials (see ALLOW_GUEST_LOGIN). */
  loginAsGuest: () => void
  logout: () => void
}

const AuthCtx = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children?: ReactNode }) {
  const [users, setUsers] = useState<StoredUser[]>(readUsers)
  const [userId, setUserId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SESSION_KEY)
    } catch {
      return null
    }
  })

  const startSession = useCallback((id: string | null) => {
    setUserId(id)
    try {
      if (id) localStorage.setItem(SESSION_KEY, id)
      else localStorage.removeItem(SESSION_KEY)
    } catch {
      // Not persisted.
    }
  }, [])

  /**
   * Opens the API session with the same credentials, so «المباني/الوحدات/العملاء/الحجوزات» load
   * straight away. A local account that doesn't exist on the server (or an API that is down) is not
   * an error here: those pages fall back to their own token login card.
   */
  const openApiSession = async (identifier: string, password: string) => {
    try {
      await apiLogin(identifier, password)
    } catch {
      clearToken()
    }
  }

  const login = useCallback<AuthContextValue['login']>(
    async (identifier, password) => {
      const key = norm(identifier)
      const found = users.find((u) => norm(u.username) === key || norm(u.email) === key)
      if (!found) return { ok: false, field: 'identifier', message: 'لا يوجد حساب بهذا الاسم أو البريد' }
      if ((await hashPassword(password, found.salt)) !== found.hash)
        return { ok: false, field: 'password', message: 'كلمة المرور غير صحيحة' }
      await openApiSession(found.username, password)
      startSession(found.id)
      return { ok: true }
    },
    [users, startSession],
  )

  const register = useCallback<AuthContextValue['register']>(
    async ({ username, email, password }) => {
      if (users.some((u) => norm(u.username) === norm(username)))
        return { ok: false, field: 'username', message: 'اسم المستخدم مستخدم بالفعل' }
      if (users.some((u) => norm(u.email) === norm(email)))
        return { ok: false, field: 'email', message: 'البريد الإلكتروني مسجل بالفعل' }
      const salt = randomSalt()
      const created: StoredUser = {
        id: `usr-${Date.now().toString(36)}`,
        username: username.trim(),
        email: email.trim(),
        salt,
        hash: await hashPassword(password, salt),
        createdAt: new Date().toISOString(),
      }
      const next = [...users, created]
      setUsers(next)
      writeUsers(next)
      await openApiSession(created.username, password)
      startSession(created.id)
      return { ok: true }
    },
    [users, startSession],
  )

  const resetPassword = useCallback<AuthContextValue['resetPassword']>(
    async ({ username, email, password }) => {
      const found = users.find((u) => norm(u.username) === norm(username) && norm(u.email) === norm(email))
      if (!found) return { ok: false, field: 'email', message: 'اسم المستخدم والبريد لا يطابقان أي حساب' }
      const salt = randomSalt()
      const next = users.map((u) => (u.id === found.id ? { ...u, salt, hash: '' } : u))
      const hash = await hashPassword(password, salt)
      const saved = next.map((u) => (u.id === found.id ? { ...u, hash } : u))
      setUsers(saved)
      writeUsers(saved)
      await openApiSession(found.username, password)
      startSession(found.id)
      return { ok: true }
    },
    [users, startSession],
  )

  const value = useMemo<AuthContextValue>(() => {
    const current = users.find((u) => u.id === userId)
    const guest = ALLOW_GUEST_LOGIN && userId === GUEST.id
    return {
      user: current ? publicUser(current) : guest ? GUEST : null,
      firstRun: users.length === 0,
      login,
      register,
      resetPassword,
      loginAsGuest: () => ALLOW_GUEST_LOGIN && startSession(GUEST.id),
      logout: () => {
        // Ending the app session also ends the API one: the next user must not inherit its token.
        clearToken()
        startSession(null)
      },
    }
  }, [users, userId, login, register, resetPassword, startSession])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
