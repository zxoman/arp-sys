import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ApiError, clearToken, fetchMe, getToken, login as apiLogin, logout as apiLogout, type ApiUser } from './api'

/**
 * The app session **is** the Laravel API session. There are no browser-local accounts: the login
 * page posts to `POST /auth/login`, the Sanctum token lives in localStorage (`aqar.api.token`) and
 * `GET /auth/me` restores the user on a reload.
 *
 * A token that disappears — «خروج», the token being revoked elsewhere (login is single-session) or
 * a 401/419 in any screen calling `clearToken()` — ends the session here, and the gate in `App.tsx`
 * shows the login page again. Screens never render their own login form.
 */
export interface AuthContextValue {
  user: ApiUser | null
  /** False until the stored token has been checked with `/auth/me` (keeps the login page from flashing). */
  ready: boolean
  /** Why the last session ended, shown once on the login page. */
  notice: string | null
  login: (identifier: string, password: string) => Promise<AuthResult>
  logout: () => Promise<void>
}

export type AuthResult = { ok: true } | { ok: false; message: string }

/** Told to the next visitor when a session was dropped by the server rather than by «خروج». */
export const EXPIRED_NOTICE = 'انتهت الجلسة، سجّل الدخول من جديد.'
const NOTICE_KEY = 'aqar.auth.notice'

const readNotice = (): string | null => {
  try {
    return sessionStorage.getItem(NOTICE_KEY)
  } catch {
    return null
  }
}

const writeNotice = (notice: string | null) => {
  try {
    if (notice) sessionStorage.setItem(NOTICE_KEY, notice)
    else sessionStorage.removeItem(NOTICE_KEY)
  } catch {
    // Storage unavailable: the notice just doesn't survive a reload.
  }
}

const AuthCtx = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children?: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [ready, setReady] = useState(() => !getToken())
  const [notice, setNotice] = useState<string | null>(readNotice)
  /** Set by `logout()` so an intentional sign-out doesn't say «انتهت الجلسة». */
  const signingOut = useRef(false)

  // Restore the session from the stored token.
  useEffect(() => {
    if (!getToken()) return
    let alive = true
    fetchMe()
      .then((me) => {
        if (alive) setUser(me)
      })
      .catch((err: unknown) => {
        if (!alive) return
        // An expired/revoked token (or an unreachable API): drop it and explain on the login page.
        if (!signingOut.current) {
          const message = err instanceof ApiError && err.status === 0
            ? 'تعذّر الاتصال بالخادم. تأكد أن الـAPI يعمل ثم سجّل الدخول من جديد.'
            : EXPIRED_NOTICE
          setNotice(message)
          writeNotice(message)
        }
        clearToken()
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // Any token loss (a 401 in a screen, «خروج» in another tab) ends the session.
  useEffect(() => {
    const onTokenChange = () => {
      if (getToken()) return
      setUser(null)
      if (!signingOut.current) {
        setNotice(EXPIRED_NOTICE)
        writeNotice(EXPIRED_NOTICE)
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'aqar.api.token' && !event.newValue) onTokenChange()
    }
    window.addEventListener('aqar:token-changed', onTokenChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('aqar:token-changed', onTokenChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const login = useCallback<AuthContextValue['login']>(async (identifier, password) => {
    if (!identifier.trim() || !password) return { ok: false, message: 'أدخل اسم المستخدم أو البريد وكلمة المرور.' }
    try {
      const me = await apiLogin(identifier.trim(), password)
      setUser(me)
      setNotice(null)
      writeNotice(null)
      return { ok: true }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) return { ok: false, message: 'اسم المستخدم أو كلمة المرور غير صحيحة.' }
        if (err.status === 429) return { ok: false, message: 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.' }
        const first = Object.values(err.errors)[0]?.[0]
        return { ok: false, message: first ?? err.message }
      }
      return { ok: false, message: 'تعذّر الاتصال بالخادم. تأكد أن الـ API يعمل.' }
    }
  }, [])

  const logout = useCallback(async () => {
    signingOut.current = true
    setNotice(null)
    writeNotice(null)
    try {
      await apiLogout()
    } catch {
      // The token may already be revoked; clearing it below is enough.
      clearToken()
    } finally {
      setUser(null)
      signingOut.current = false
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, notice, login, logout }),
    [user, ready, notice, login, logout],
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
