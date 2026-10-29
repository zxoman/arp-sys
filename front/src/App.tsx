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

/** Signed-out visitors see the login page; the data and shell only mount once signed in. */
function Gate() {
  const { user } = useAuth()
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
