import { useState, type FormEvent } from 'react'
import { ALLOW_GUEST_LOGIN, useAuth } from '@/lib/auth'
import { Btn, GlassSurface, IconBtn, IconEye, IconBuilding, LiquidTabs, TextInput } from '@/kit'
import { BrandLogo, BRAND_NAME } from '@/components/BrandLogo'
import { Text } from '@/components/ui'

type Mode = 'login' | 'register' | 'forgot'
type Errors = Partial<Record<'identifier' | 'username' | 'email' | 'password' | 'confirm', string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Full-screen sign-in / account creation, shown until a user is signed in. */
export default function Login() {
  const { login, register, resetPassword, loginAsGuest, firstRun } = useAuth()
  const [mode, setMode] = useState<Mode>(firstRun ? 'register' : 'login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const isLogin = mode === 'login'
  const isForgot = mode === 'forgot'

  const switchMode = (next: Mode) => {
    setMode(next)
    setErrors({})
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found: Errors = {}
    if (isForgot) {
      if (!username.trim()) found.username = 'أدخل اسم المستخدم'
      if (!EMAIL_RE.test(email.trim())) found.email = 'أدخل بريدًا إلكترونيًا صحيحًا'
      if (password.length < 6) found.password = 'كلمة المرور الجديدة 6 أحرف على الأقل'
      if (confirm !== password) found.confirm = 'كلمتا المرور غير متطابقتين'
    } else if (isLogin) {
      if (!identifier.trim()) found.identifier = 'أدخل اسم المستخدم أو البريد'
      if (!password) found.password = 'أدخل كلمة المرور'
    } else {
      if (username.trim().length < 3) found.username = 'اسم المستخدم 3 أحرف على الأقل'
      if (!EMAIL_RE.test(email.trim())) found.email = 'أدخل بريدًا إلكترونيًا صحيحًا'
      if (password.length < 6) found.password = 'كلمة المرور 6 أحرف على الأقل'
      if (confirm !== password) found.confirm = 'كلمتا المرور غير متطابقتين'
    }
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    const result = isForgot
      ? await resetPassword({ username, email, password })
      : isLogin ? await login(identifier, password) : await register({ username, email, password })
    setBusy(false)
    if (!result.ok) setErrors({ [result.field ?? 'password']: result.message })
  }

  const toggle = (
    <IconBtn
      type="button"
      size="sm"
      icon={<IconEye size={16} />}
      label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
      aria-pressed={show}
      onClick={() => setShow((v) => !v)}
    />
  )

  return (
    <main className="grid min-h-dvh place-items-center bg-linear-135 from-primary-soft via-bg to-bg px-4 py-10">
      <GlassSurface variant="strong" padding="lg" className="rise-in grid w-full max-w-[440px] gap-6">
        <div className="grid justify-items-center gap-3 text-center">
          <BrandLogo className="size-20" />
          <div>
            <h1 dir="ltr" className="text-[26px] font-black uppercase tracking-[0.14em] text-fg">{BRAND_NAME}</h1>
            <Text variant="caption">
              {isForgot ? 'تحقق من حسابك ثم عيّن كلمة مرور جديدة' : isLogin ? 'سجّل الدخول لمتابعة إدارة العقارات' : firstRun ? 'أنشئ حساب المدير الأول للبدء' : 'إنشاء حساب جديد'}
            </Text>
          </div>
        </div>

        {!isForgot && (
          <LiquidTabs
            label="نوع الدخول"
            items={[
              { value: 'login', label: 'تسجيل الدخول' },
              { value: 'register', label: 'حساب جديد' },
            ]}
            value={mode as 'login' | 'register'}
            onChange={switchMode}
          />
        )}

        <form onSubmit={submit} noValidate className="grid gap-4">
          {isLogin ? (
            <TextInput
              label="اسم المستخدم أو البريد الإلكتروني"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              error={errors.identifier}
              autoComplete="username"
              autoFocus
              dir="ltr"
              className="text-start"
            />
          ) : (
            <>
              <TextInput
                label="اسم المستخدم"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={errors.username}
                autoComplete="username"
                autoFocus
              />
              <TextInput
                label="البريد الإلكتروني"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
                autoComplete="email"
                dir="ltr"
                className="text-start"
              />
            </>
          )}
          <TextInput
            label={isForgot ? 'كلمة المرور الجديدة' : 'كلمة المرور'}
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            trailing={toggle}
            dir="ltr"
            className="text-start"
          />
          {!isLogin && (
            <TextInput
              label="تأكيد كلمة المرور"
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={errors.confirm}
              autoComplete="new-password"
              dir="ltr"
              className="text-start"
            />
          )}
          <Btn type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            {isForgot ? 'تعيين كلمة المرور' : isLogin ? 'تسجيل الدخول' : 'إنشاء الحساب'}
          </Btn>
          {isLogin && (
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className="justify-self-center text-[13px] font-semibold text-primary hover:underline dark:text-indigo-300"
            >
              نسيت كلمة المرور؟
            </button>
          )}
          {isForgot && (
            <Btn type="button" variant="ghost" onClick={() => switchMode('login')} className="w-full">
              العودة لتسجيل الدخول
            </Btn>
          )}
        </form>
        {ALLOW_GUEST_LOGIN && !isForgot && (
          <Btn type="button" variant="glass" size="lg" onClick={loginAsGuest} className="w-full">
            الدخول بدون بيانات
          </Btn>
        )}
        <Text variant="caption" className="text-center">
          الحساب محفوظ على هذا الجهاز فقط، وبنفس بيانات الدخول تُفتح جلسة الخادم إن كان الحساب موجودًا عليه.
        </Text>
      </GlassSurface>
    </main>
  )
}
