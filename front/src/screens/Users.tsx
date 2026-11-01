import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import {
  ApiError,
  activateUser,
  clearToken,
  createUser,
  deleteUser,
  fetchRoles,
  fetchUsers,
  resetUserPassword,
  suspendUser,
  updateUser,
  type ApiAdminUser,
  type ApiRole,
  type UserInput,
} from '@/lib/api'
import { Text } from '@/components/ui'
import {
  Btn,
  DataTable,
  Drawer,
  IconBtn,
  IconEye,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUsers,
  Modal,
  Select,
  TextInput,
  useToast,
  type Column,
} from '@/kit'
import { codeOf, FormGrid, REQUIRED, SectionTitle, useNewShortcut, useShake, type Errors } from './movement/shared'

const SEARCH_DELAY_MS = 350

type Draft = {
  name: string
  username: string
  email: string
  phone: string
  password: string
  roleId: string
  status: 'active' | 'suspended'
}
type Key = keyof Draft

const EMPTY: Draft = { name: '', username: '', email: '', phone: '', password: '', roleId: '', status: 'active' }

/** API field name → form field, for mapping 422 errors back onto the drawer. */
const API_FIELD_TO_FORM: Record<string, Key> = {
  name: 'name',
  username: 'username',
  email: 'email',
  phone: 'phone',
  password: 'password',
  role_id: 'roleId',
  status: 'status',
}

const STATUS_LABEL: Record<'active' | 'suspended', string> = { active: 'نشط', suspended: 'موقوف' }
const STATUS_TONE: Record<'active' | 'suspended', string> = {
  active: 'bg-success-soft text-success',
  suspended: 'bg-warning-soft text-warning',
}

const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)

/** `2026-10-28T…` → `٢٠٢٦/١٠/٢٨ ٠٩:٣٠` */
const dateTimeOf = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const roleName = (user: ApiAdminUser) => user.role?.display_name || user.role?.name || '—'

export default function Users() {
  const { user: me, logout } = useAuth()
  const toast = useToast()

  const [rows, setRows] = useState<ApiAdminUser[]>([])
  const [roles, setRoles] = useState<ApiRole[]>([])
  const [meta, setMeta] = useState({ current_page: 1, last_page: 1, per_page: 15, total: 0, from: 0 as number | null, to: 0 as number | null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'suspended'>('')
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  const [mode, setMode] = useState<'new' | 'edit' | 'view' | null>(null)
  const [current, setCurrent] = useState<ApiAdminUser | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toDelete, setToDelete] = useState<ApiAdminUser | null>(null)
  const [toSuspend, setToSuspend] = useState<ApiAdminUser | null>(null)
  const [toReset, setToReset] = useState<ApiAdminUser | null>(null)
  const [resetPassword, setResetPassword] = useState({ password: '', confirm: '' })
  const [resetError, setResetError] = useState<string | undefined>()
  const [formRef, shake] = useShake<HTMLFormElement>()

  // Debounced search.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchUsers({ search, status: statusFilter || undefined, page: page + 1 })
      .then((result) => {
        if (!alive) return
        setRows(result.items)
        setMeta({
          current_page: result.meta.current_page,
          last_page: result.meta.last_page,
          per_page: result.meta.per_page,
          total: result.meta.total,
          from: result.meta.from,
          to: result.meta.to,
        })
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        if (isAuthError(err)) {
          clearToken()
          return
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل المستخدمين من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [search, statusFilter, page, reloadKey])

  // Roles only feed the drawer's picker; load once.
  useEffect(() => {
    if (roles.length) return
    fetchRoles()
      .then(setRoles)
      .catch(() => {
        // The picker simply stays empty; saving reports the real error.
      })
  }, [roles.length])

  const reload = () => setReloadKey((k) => k + 1)

  const lostSession = () => {
    clearToken()
    setMode(null)
    setToDelete(null)
    setToSuspend(null)
    setToReset(null)
  }

  const openNew = () => {
    setCurrent(null)
    setDraft({ ...EMPTY, roleId: roles[0] ? String(roles[0].id) : '' })
    setErrors({})
    setMode('new')
  }
  useNewShortcut(openNew)

  const openRecord = (u: ApiAdminUser, m: 'edit' | 'view') => {
    setCurrent(u)
    setDraft({
      name: u.name,
      username: u.username,
      email: u.email ?? '',
      phone: u.phone ?? '',
      password: '',
      roleId: u.role ? String(u.role.id) : '',
      status: u.status === 'suspended' ? 'suspended' : 'active',
    })
    setErrors({})
    setMode(m)
  }

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch) as Key[]) delete next[k]
      return next
    })
  }

  const validate = (d: Draft, isNew: boolean): Errors<Key> => {
    const e: Errors<Key> = {}
    if (!d.name.trim()) e.name = REQUIRED
    if (!d.username.trim()) e.username = REQUIRED
    else if (!/^[A-Za-z0-9._-]{3,}$/.test(d.username.trim())) e.username = '٣ أحرف لاتينية على الأقل (حروف وأرقام و . _ -)'
    if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) e.email = 'أدخل بريدًا إلكترونيًا صحيحًا'
    if (isNew && d.password.length < 8) e.password = 'كلمة المرور ٨ أحرف على الأقل'
    if (!d.roleId) e.roleId = REQUIRED
    return e
  }

  const applyApiErrors = (err: ApiError) => {
    const mapped: Errors<Key> = {}
    for (const [field, messages] of Object.entries(err.errors)) {
      const key = API_FIELD_TO_FORM[field.split('.')[0]]
      if (key && messages[0]) mapped[key] = messages[0]
    }
    if (Object.keys(mapped).length) {
      setErrors(mapped)
      shake()
    } else if (err.errors.lock_version?.[0]) {
      toast.error('تغيّر المستخدم على الخادم', 'أُعيد تحميل البيانات — راجعها ثم احفظ مرة أخرى.')
      setMode(null)
      reload()
    } else {
      toast.error('تعذّر حفظ المستخدم', err.message)
    }
  }

  const save = async () => {
    const isNew = mode === 'new'
    const e = validate(draft, isNew)
    setErrors(e)
    if (Object.values(e).some(Boolean)) return shake()

    const input: UserInput = {
      name: draft.name.trim(),
      username: draft.username.trim(),
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      role_id: Number(draft.roleId),
      status: draft.status,
    }

    setSaving(true)
    try {
      if (current) {
        const saved = await updateUser(current.id, { ...input, lock_version: current.lock_version })
        toast.success('تم تحديث المستخدم', `«${saved.name}»`)
      } else {
        const saved = await createUser({ ...input, password: draft.password })
        toast.success('تمت إضافة المستخدم', `«${saved.name}» — ${codeOf(`u-${saved.id}`)}`)
        setSearchInput('')
        setSearch('')
        setStatusFilter('')
        setPage(0)
      }
      setMode(null)
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession()
      if (err instanceof ApiError) applyApiErrors(err)
      else toast.error('تعذّر حفظ المستخدم', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const confirmSuspend = async () => {
    if (!toSuspend) return
    const target = toSuspend
    const suspend = target.status !== 'suspended'
    setBusy(true)
    try {
      if (suspend) await suspendUser(target.id)
      else await activateUser(target.id)
      toast.success(suspend ? 'تم إيقاف المستخدم' : 'تم تنشيط المستخدم', `«${target.name}»`)
      setToSuspend(null)
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession()
      toast.error(suspend ? 'تعذّر إيقاف المستخدم' : 'تعذّر تنشيط المستخدم', err instanceof ApiError ? err.message : undefined)
      setToSuspend(null)
    } finally {
      setBusy(false)
    }
  }

  const confirmReset = async () => {
    if (!toReset) return
    if (resetPassword.password.length < 8) return setResetError('كلمة المرور ٨ أحرف على الأقل')
    if (resetPassword.password !== resetPassword.confirm) return setResetError('كلمتا المرور غير متطابقتين')

    setBusy(true)
    try {
      await resetUserPassword(toReset.id, resetPassword.password)
      toast.success('تم تغيير كلمة المرور', `«${toReset.name}» — عليه تسجيل الدخول من جديد.`)
      setToReset(null)
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession()
      setResetError(err instanceof ApiError ? err.message : 'تعذّر تغيير كلمة المرور')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    const target = toDelete
    setBusy(true)
    try {
      await deleteUser(target.id)
      toast.success('تم حذف المستخدم', `«${target.name}»`)
      setToDelete(null)
      if (rows.length === 1 && page > 0) setPage((p) => p - 1)
      else reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession()
      toast.error('تعذّر حذف المستخدم', err instanceof ApiError ? err.message : undefined)
      setToDelete(null)
    } finally {
      setBusy(false)
    }
  }

  const isMe = (u: ApiAdminUser) => me?.id === u.id

  const columns: Column<ApiAdminUser>[] = [
    {
      key: 'id',
      header: 'الكود',
      width: '5rem',
      value: (u) => codeOf(`u-${u.id}`),
      cell: (u) => <span className="tabular-nums text-fg-2">{codeOf(`u-${u.id}`)}</span>,
    },
    {
      key: 'name',
      header: 'الاسم',
      cell: (u) => (
        <div className="leading-tight">
          <span className="font-semibold text-fg">{u.name}</span>
          {isMe(u) && <span className="t-caption ms-2 text-primary">(أنت)</span>}
        </div>
      ),
    },
    {
      key: 'username',
      header: 'اسم المستخدم',
      value: (u) => u.username,
      cell: (u) => (
        <span dir="ltr" className="tabular-nums">
          {u.username}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'البريد',
      value: (u) => u.email ?? '',
      cell: (u) => (u.email ? <span dir="ltr" className="text-fg-2">{u.email}</span> : <span className="text-fg-3">—</span>),
    },
    {
      key: 'phone',
      header: 'الهاتف',
      value: (u) => u.phone ?? '',
      cell: (u) => (u.phone ? <span dir="ltr" className="tabular-nums">{u.phone}</span> : <span className="text-fg-3">—</span>),
    },
    { key: 'role', header: 'الدور', value: (u) => roleName(u), cell: (u) => <span className="text-fg-2">{roleName(u)}</span> },
    {
      key: 'status',
      header: 'الحالة',
      value: (u) => STATUS_LABEL[u.status === 'suspended' ? 'suspended' : 'active'],
      cell: (u) => {
        const key = u.status === 'suspended' ? 'suspended' : 'active'
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-bold ${STATUS_TONE[key]}`}>
            {STATUS_LABEL[key]}
          </span>
        )
      },
    },
    {
      key: 'lastLogin',
      header: 'آخر دخول',
      align: 'end',
      value: (u) => u.last_login_at ?? '',
      cell: (u) => <span className="tabular-nums text-fg-2">{dateTimeOf(u.last_login_at)}</span>,
    },
  ]

  const view = mode === 'view'
  const ro = { readOnly: view, disabled: view }
  const notLoaded = loadError !== null && rows.length === 0
  const roleOptions = roles.map((r) => ({ value: String(r.id), label: r.display_name || r.name }))

  return (
    <div className="grid gap-4">
      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warning/40 bg-warning-soft px-4 py-2.5 t-caption text-fg-2">
          <span>{loadError}</span>
          <Btn size="sm" variant="glass" onClick={reload}>
            إعادة المحاولة
          </Btn>
        </div>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(u) => String(u.id)}
        caption="المستخدمون"
        loading={loading}
        title={
          <div className="flex items-center gap-2">
            <Btn iconStart={<IconPlus size={16} />} onClick={openNew}>
              مستخدم جديد
            </Btn>
            <Btn variant="ghost" size="sm" onClick={() => void logout()}>
              خروج
            </Btn>
          </div>
        }
        toolbar={
          <div className="flex items-center gap-2">
            <Select
              aria-label="تصفية بالحالة"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as '' | 'active' | 'suspended')
                setPage(0)
              }}
              options={[
                { value: '', label: 'كل الحالات' },
                { value: 'active', label: 'نشط' },
                { value: 'suspended', label: 'موقوف' },
              ]}
            />
          </div>
        }
        serverSearch={{ value: searchInput, onChange: setSearchInput }}
        serverPagination={{
          page,
          pageCount: meta.last_page,
          total: meta.total,
          from: meta.from ?? 0,
          to: meta.to ?? 0,
          onChange: setPage,
        }}
        searchPlaceholder="ابحث بالاسم أو اسم المستخدم أو البريد…"
        exportName="المستخدمون"
        actionsWidth="9.5rem"
        onRowClick={(u) => openRecord(u, 'view')}
        actions={(u) => (
          <div className="flex items-center gap-0.5">
            <IconBtn size="sm" icon={<IconEye size={16} />} label="عرض" onClick={() => openRecord(u, 'view')} />
            <IconBtn size="sm" icon={<IconPencil size={16} />} label="تعديل" onClick={() => openRecord(u, 'edit')} />
            {isMe(u) ? (
              <IconBtn
                size="sm"
                icon={<IconTrash size={16} />}
                label="لا يمكن حذف حسابك"
                variant="danger"
                disabled
                onClick={() => undefined}
              />
            ) : (
              <IconBtn size="sm" icon={<IconTrash size={16} />} label="حذف" variant="danger" onClick={() => setToDelete(u)} />
            )}
          </div>
        )}
        emptyText={notLoaded ? 'لا توجد بيانات من الخادم.' : 'لا يوجد مستخدمون مطابقون.'}
      />

      <Drawer
        open={mode !== null}
        onClose={() => !saving && setMode(null)}
        size="lg"
        icon={<IconUsers size={20} />}
        title={mode === 'new' ? 'مستخدم جديد' : view ? (current?.name ?? '') : 'تعديل المستخدم'}
        description={
          current
            ? `${codeOf(`u-${current.id}`)} — أُضيف في ${dateTimeOf(current.created_at)}`
            : 'الصلاحيات غير قابلة للتعديل في هذه المرحلة؛ يُختار الدور من الأدوار الموجودة.'
        }
        footer={
          view ? (
            <>
              <Btn variant="ghost" onClick={() => setMode(null)}>
                إغلاق
              </Btn>
              <Btn iconStart={<IconPencil size={16} />} onClick={() => setMode('edit')}>
                تعديل
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="ghost" onClick={() => setMode(null)} disabled={saving}>
                إلغاء
              </Btn>
              <Btn type="submit" form="user-form" loading={saving}>
                حفظ
              </Btn>
            </>
          )
        }
      >
        <form
          id="user-form"
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <FormGrid>
            <SectionTitle>بيانات الحساب</SectionTitle>
            <TextInput
              containerClassName="col-span-full"
              label="الاسم الكامل"
              required
              value={draft.name}
              error={errors.name}
              onChange={(e) => update({ name: e.target.value })}
              {...ro}
            />
            <TextInput
              label="اسم المستخدم"
              required
              dir="ltr"
              value={draft.username}
              error={errors.username}
              hint={view ? undefined : 'حروف لاتينية وأرقام فقط'}
              onChange={(e) => update({ username: e.target.value })}
              {...ro}
            />
            <TextInput
              label="البريد الإلكتروني"
              dir="ltr"
              type="email"
              value={draft.email}
              error={errors.email}
              onChange={(e) => update({ email: e.target.value })}
              {...ro}
            />
            <TextInput
              label="الهاتف"
              dir="ltr"
              inputMode="tel"
              value={draft.phone}
              error={errors.phone}
              onChange={(e) => update({ phone: e.target.value })}
              {...ro}
            />
            <Select
              label="الدور"
              required
              value={draft.roleId}
              error={errors.roleId}
              options={roleOptions.length ? roleOptions : [{ value: '', label: 'جارٍ التحميل…' }]}
              onChange={(e) => update({ roleId: e.target.value })}
              disabled={view || !roleOptions.length}
            />
            <Select
              label="الحالة"
              value={draft.status}
              options={[
                { value: 'active', label: 'نشط' },
                { value: 'suspended', label: 'موقوف' },
              ]}
              onChange={(e) => update({ status: e.target.value as 'active' | 'suspended' })}
              disabled={view}
            />
            {mode === 'new' && (
              <TextInput
                label="كلمة المرور"
                required
                dir="ltr"
                type="password"
                autoComplete="new-password"
                value={draft.password}
                error={errors.password}
                hint="٨ أحرف على الأقل"
                onChange={(e) => update({ password: e.target.value })}
              />
            )}
            {current && !view && (
              <div className="col-span-full flex flex-wrap items-center gap-2 rounded-ctl border border-hairline px-3 py-2.5">
                <Text variant="caption" className="text-fg-2">
                  كلمة المرور لا تُعرض هنا.
                </Text>
                <Btn size="sm" variant="glass" onClick={() => { setResetPassword({ password: '', confirm: '' }); setResetError(undefined); setToReset(current) }}>
                  إعادة تعيين كلمة المرور
                </Btn>
                <Btn
                  size="sm"
                  variant={current.status === 'suspended' ? 'glass' : 'ghost'}
                  onClick={() => setToSuspend(current)}
                  disabled={isMe(current)}
                >
                  {current.status === 'suspended' ? 'تنشيط الحساب' : 'إيقاف الحساب'}
                </Btn>
              </div>
            )}
            {!view && (
              <Text variant="caption" className="col-span-full text-fg-3">
                لا توجد شاشة للصلاحيات بعد؛ كل مستخدم يأخذ صلاحيات الدور المختار.
              </Text>
            )}
          </FormGrid>
        </form>
      </Drawer>

      {/* إيقاف / تنشيط */}
      <Modal
        open={toSuspend !== null}
        onClose={() => !busy && setToSuspend(null)}
        size="sm"
        tone={toSuspend?.status === 'suspended' ? undefined : 'danger'}
        icon={<IconUsers size={20} />}
        title={toSuspend?.status === 'suspended' ? 'تنشيط الحساب؟' : 'إيقاف الحساب؟'}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setToSuspend(null)} disabled={busy}>
              إلغاء
            </Btn>
            <Btn variant={toSuspend?.status === 'suspended' ? undefined : 'danger'} onClick={() => void confirmSuspend()} loading={busy}>
              {toSuspend?.status === 'suspended' ? 'تنشيط' : 'إيقاف'}
            </Btn>
          </>
        }
      >
        <Text variant="body">
          {toSuspend?.status === 'suspended'
            ? `سيتمكن «${toSuspend?.name}» من تسجيل الدخول مرة أخرى.`
            : `لن يتمكن «${toSuspend?.name}» من تسجيل الدخول حتى يُعاد تنشيطه، وتنتهي جلساته الحالية.`}
        </Text>
      </Modal>

      {/* إعادة تعيين كلمة المرور */}
      <Modal
        open={toReset !== null}
        onClose={() => !busy && setToReset(null)}
        size="sm"
        icon={<IconUsers size={20} />}
        title="إعادة تعيين كلمة المرور"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setToReset(null)} disabled={busy}>
              إلغاء
            </Btn>
            <Btn onClick={() => void confirmReset()} loading={busy}>
              حفظ
            </Btn>
          </>
        }
      >
        <div className="grid gap-3">
          <Text variant="body">سيُطلب من «{toReset?.name}» استخدام الكلمة الجديدة في الدخول التالي.</Text>
          <TextInput
            label="كلمة المرور الجديدة"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={resetPassword.password}
            error={resetError}
            onChange={(e) => {
              setResetPassword((p) => ({ ...p, password: e.target.value }))
              setResetError(undefined)
            }}
          />
          <TextInput
            label="تأكيد كلمة المرور"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={resetPassword.confirm}
            onChange={(e) => {
              setResetPassword((p) => ({ ...p, confirm: e.target.value }))
              setResetError(undefined)
            }}
          />
        </div>
      </Modal>

      {/* حذف */}
      <Modal
        open={toDelete !== null}
        onClose={() => !busy && setToDelete(null)}
        size="sm"
        tone="danger"
        icon={<IconTrash size={20} />}
        title="حذف المستخدم؟"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setToDelete(null)} disabled={busy}>
              إلغاء
            </Btn>
            <Btn variant="danger" onClick={() => void confirmDelete()} loading={busy}>
              حذف
            </Btn>
          </>
        }
      >
        <Text variant="body">
          سيُحذف حساب «{toDelete?.name}» نهائيًا ولن يستطيع الدخول بعد ذلك. سجل عملياته في «سجل العمليات» يبقى
          محفوظًا. لا يمكن التراجع.
        </Text>
      </Modal>
    </div>
  )
}
