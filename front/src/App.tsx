// Must stay first: the kit's stylesheet also declares `@layer components`, and whichever CSS file
// loads first fixes the layer order. Loading index.css first keeps Tailwind's
// theme → base → components → utilities order, so Preflight can't override component styles.
import './index.css'
import { ToastProvider } from '@/kit'
import { AppProvider, DataProvider } from '@/lib'
import { Shell } from '@/Shell'
import { AuthProvider, useAuth } from '@/lib/auth'
import Login from '@/screens/Login'
import { RecordHostProvider } from '@/screens/GlobalSearch'

/** While the stored API token is being checked, don't flash the login page. */
function SessionBoot() {
  return (
    <div className="grid min-h-dvh place-items-center px-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3 rounded-card border border-[var(--hairline)] bg-[var(--glass-solid)] px-5 py-4 shadow-soft">
        <span className="spinner size-5 rounded-full border-2 border-primary/30 border-t-primary" aria-hidden />
        <span className="t-label text-fg-2">جارٍ التحقق من الجلسة…</span>
      </div>
    </div>
  )
}

/** Signed-out visitors see the login page; the data and shell only mount once signed in. */
function Gate() {
  const { user, ready } = useAuth()
  if (!ready) return <SessionBoot />
  if (!user) return <Login />
  return (
    <DataProvider>
      <RecordHostProvider>
        <Shell />
      </RecordHostProvider>
    </DataProvider>
  )
}

/** AppCtx (theme) → DataCtx (records) → toasts → the shell. */
export default function App() {
  return (
    <AppProvider>
      <AuthProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </AuthProvider>
    </AppProvider>
  )
}
