import { useState, type FormEvent } from 'react'
import { useAuth } from '@/lib/auth'
import { Btn, GlassSurface, IconBtn, IconEye, TextInput } from '@/kit'
import { BrandLogo, BRAND_NAME } from '@/components/BrandLogo'
import { Text } from '@/components/ui'

type Errors = Partial<Record<'identifier' | 'password', string>>

/** Full-screen sign-in against the API (`POST /auth/login`); the only login form in the app. */
export default function Login() {
  const { login, notice } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found: Errors = {}
    if (!identifier.trim()) found.identifier = 'أدخل اسم المستخدم أو البريد الإلكتروني'
    if (!password) found.password = 'أدخل كلمة المرور'
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    const result = await login(identifier, password)
    setBusy(false)
    if (!result.ok) setErrors({ password: result.message })
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
            <Text variant="caption">سجّل الدخول بحسابك على الخادم لمتابعة إدارة العقارات</Text>
          </div>
        </div>

        {notice && (
          <div
            className="rounded-ctl border border-warning/40 bg-warning-soft px-3 py-2 text-center text-[13px] font-semibold text-warning"
            role="status"
          >
            {notice}
          </div>
        )}

        <form onSubmit={submit} noValidate className="grid gap-4">
          <TextInput
            label="اسم المستخدم أو البريد الإلكتروني"
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value)
              if (errors.identifier) setErrors({ ...errors, identifier: undefined })
            }}
            error={errors.identifier}
            autoComplete="username"
            autoFocus
            dir="ltr"
            className="text-start"
          />
          <TextInput
            label="كلمة المرور"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (errors.password) setErrors({ ...errors, password: undefined })
            }}
            error={errors.password}
            autoComplete="current-password"
            trailing={toggle}
            dir="ltr"
            className="text-start"
          />
          <Btn type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            تسجيل الدخول
          </Btn>
        </form>
        <Text variant="caption" className="text-center">
          الحساب والصلاحيات تأتي من الخادم، وتسجيل الدخول هنا يفتح جلسة الـAPI نفسها.
        </Text>
      </GlassSurface>
    </main>
  )
}
