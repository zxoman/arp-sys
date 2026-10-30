import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import {
  API_CLIENT_FIELD_TO_FORM,
  ApiError,
  clearToken,
  createClient,
  deleteClient,
  fetchClients,
  updateClient,
  type ApiClient,
  type ClientInput,
  type DeletionCounts,
  type PageMeta,
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
  TextInput,
  Textarea,
  useToast,
  type Column,
  type SortState,
} from '@/kit'
import { codeOf, FormGrid, REQUIRED, SectionTitle, useNewShortcut, useShake, type Errors } from './shared'

const SEARCH_DELAY_MS = 350

/** « — معها 2 حجز، 1 عقد، 1 إيصال …» for the delete toast (empty when nothing was linked). */
function clientDeletionSummary(deleted: DeletionCounts): string {
  const parts: string[] = []
  if (deleted.reservations) parts.push(`${deleted.reservations} حجز`)
  if (deleted.contracts) parts.push(`${deleted.contracts} عقد`)
  if (deleted.receipts) parts.push(`${deleted.receipts} إيصال`)
  return parts.length ? ` — حُذف معها ${parts.join('، ')}` : ''
}

/** DataTable column key → API `sort` parameter. */
const SORT_FIELDS: Record<string, string> = {
  id: 'id',
  name: 'name',
  phone: 'phone',
  phone2: 'phone_2',
  nationalId: 'national_id',
  createdAt: 'created_at',
}

type Draft = {
  name: string
  phone: string
  phone2: string
  nationalId: string
  notes: string
}
type Key = keyof Draft

const EMPTY: Draft = { name: '', phone: '', phone2: '', nationalId: '', notes: '' }

/**
 * A phone is optional, but when entered it must be an Egyptian mobile number. Arabic-Indic digits
 * and separators are accepted here because the API normalizes them to `+20…` on save.
 */
const PHONE_RE = /^(?:\+?20|0020|0)?1\d{9}$/
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const phoneError = (value: string): string | undefined => {
  if (!value.trim()) return undefined
  const digits = value
    .replace(/[\s\-()]/g, '')
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
  return PHONE_RE.test(digits) ? undefined : 'أدخل رقم هاتف صحيحًا'
}

const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)

/** `2026-10-28T…` → `٢٠٢٦/١٠/٢٨` (the API sends ISO timestamps). */
const dateOf = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function Clients() {
  const { logout } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState<'new' | 'edit' | 'view' | null>(null)
  const [current, setCurrent] = useState<ApiClient | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [toDelete, setToDelete] = useState<ApiClient | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [formRef, shake] = useShake<HTMLFormElement>()

  // Auth + server-side table state (search is debounced; the page is 0-based).
  const [rows, setRows] = useState<ApiClient[]>([])
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, last_page: 1, per_page: 15, total: 0, from: null, to: null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  // Debounce the search box so the API isn't hit on every keystroke.
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
    fetchClients({
      search,
      page: page + 1,
      sort: sort ? SORT_FIELDS[sort.key] : undefined,
      dir: sort?.dir,
    })
      .then((result) => {
        if (!alive) return
        setRows(result.items)
        setMeta(result.meta)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        if (isAuthError(err)) {
          clearToken()
          return
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل العملاء من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [search, page, sort, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  /** Called when a request comes back 401/419: drops the token, which signs the app out. */
  const lostSession = () => {
    clearToken()
    setMode(null)
    setToDelete(null)
  }

  const openNew = () => {
    setCurrent(null)
    setDraft(EMPTY)
    setErrors({})
    setMode('new')
  }
  useNewShortcut(openNew)

  const openRecord = (c: ApiClient, m: 'edit' | 'view') => {
    setCurrent(c)
    setDraft({
      name: c.name,
      phone: c.phone ?? '',
      phone2: c.phone_2 ?? '',
      nationalId: c.national_id ?? '',
      notes: c.notes ?? '',
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

  const validate = (d: Draft): Errors<Key> => {
    const e: Errors<Key> = {}
    if (!d.name.trim()) e.name = REQUIRED
    const phone = phoneError(d.phone)
    if (phone) e.phone = phone
    const phone2 = phoneError(d.phone2)
    if (phone2) e.phone2 = phone2
    return e
  }

  const applyApiErrors = (err: ApiError) => {
    const mapped: Errors<Key> = {}
    for (const [field, messages] of Object.entries(err.errors)) {
      const key = API_CLIENT_FIELD_TO_FORM[field.split('.')[0]] as Key | undefined
      if (key && messages[0]) mapped[key] = messages[0]
    }
    if (Object.keys(mapped).length) {
      setErrors(mapped)
      shake()
    } else {
      toast.error('تعذّر حفظ العميل', err.message)
    }
  }

  /** Duplicate numbers never block the write — the API flags them in `meta` (BRIEF 2.4). */
  const warnDuplicate = (client: ApiClient, duplicateId: number | null) => {
    if (duplicateId == null) return
    toast.warning(
      'رقم هاتف مسجَّل مسبقًا',
      `«${client.name}» مسجَّل بنفس الرقم لدى العميل ${codeOf(`c-${duplicateId}`)} — الحفظ تم، راجع التكرار.`,
    )
  }

  const save = async () => {
    const e = validate(draft)
    setErrors(e)
    if (Object.values(e).some(Boolean)) return shake()

    const input: ClientInput = { ...draft }
    setSaving(true)
    try {
      if (current) {
        const { client, duplicateId } = await updateClient(current.id, input)
        toast.success('تم تحديث العميل', `«${client.name}»`)
        warnDuplicate(client, duplicateId)
      } else {
        const { client, duplicateId } = await createClient(input)
        toast.success('تمت إضافة العميل', `«${client.name}» — ${codeOf(`c-${client.id}`)}`)
        warnDuplicate(client, duplicateId)
        setSearchInput('')
        setSearch('')
        setSort(null)
        setPage(0)
      }
      setMode(null)
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession()
      if (err instanceof ApiError) applyApiErrors(err)
      else toast.error('تعذّر حفظ العميل', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    const target = toDelete
    setDeleting(true)
    try {
      const deleted = await deleteClient(target.id)
      toast.success('تم حذف العميل نهائيًا', `«${target.name}»${clientDeletionSummary(deleted)}`)
      setToDelete(null)
      // Deleting the only row on a later page leaves an empty page; step back one.
      if (rows.length === 1 && page > 0) setPage((p) => p - 1)
      else reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession()
      toast.error('تعذّر حذف العميل', err instanceof ApiError ? err.message : undefined)
      setToDelete(null)
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<ApiClient>[] = [
    { key: 'id', header: 'الكود', value: (c) => codeOf(`c-${c.id}`), width: '6rem', cell: (c) => <span className="tabular-nums text-fg-2">{codeOf(`c-${c.id}`)}</span> },
    {
      key: 'name',
      header: 'الاسم',
      cell: (c) => (
        <div className="leading-tight">
          <span className="font-semibold text-fg">{c.name}</span>
          {c.notes && <div className="t-caption mt-0.5 line-clamp-1 max-w-[20rem] text-fg-3">{c.notes}</div>}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'الهاتف',
      value: (c) => c.phone ?? '',
      cell: (c) => (c.phone ? <span dir="ltr" className="tabular-nums">{c.phone}</span> : <span className="text-fg-3">—</span>),
    },
    {
      key: 'phone2',
      header: 'هاتف إضافي',
      value: (c) => c.phone_2 ?? '',
      cell: (c) => (c.phone_2 ? <span dir="ltr" className="tabular-nums">{c.phone_2}</span> : <span className="text-fg-3">—</span>),
    },
    {
      key: 'nationalId',
      header: 'رقم الهوية',
      value: (c) => c.national_id ?? '',
      cell: (c) => (c.national_id ? <span dir="ltr" className="tabular-nums">{c.national_id}</span> : <span className="text-fg-3">—</span>),
    },
    { key: 'createdAt', header: 'تاريخ الإضافة', align: 'end', value: (c) => c.created_at ?? '', cell: (c) => <span className="tabular-nums text-fg-2">{dateOf(c.created_at)}</span> },
  ]

  const view = mode === 'view'
  const ro = { readOnly: view, disabled: view }
  const notLoaded = loadError !== null && rows.length === 0

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
        rowKey={(c) => String(c.id)}
        caption="العملاء"
        loading={loading}
        title={
          <div className="flex items-center gap-2">
            <Btn iconStart={<IconPlus size={16} />} onClick={openNew}>
              عميل جديد
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => void logout()}
            >
              خروج
            </Btn>
          </div>
        }
        serverSearch={{ value: searchInput, onChange: setSearchInput }}
        serverSort={{
          value: sort,
          onChange: (next) => {
            setSort(next)
            setPage(0)
          },
        }}
        serverPagination={{
          page,
          pageCount: meta.last_page,
          total: meta.total,
          from: meta.from ?? 0,
          to: meta.to ?? 0,
          onChange: setPage,
        }}
        searchPlaceholder="ابحث بالاسم أو رقم الهاتف…"
        exportName="العملاء"
        actionsWidth="8rem"
        onRowClick={(c) => openRecord(c, 'view')}
        actions={(c) => (
          <div className="flex items-center gap-0.5">
            <IconBtn size="sm" icon={<IconEye size={16} />} label="عرض" onClick={() => openRecord(c, 'view')} />
            <IconBtn size="sm" icon={<IconPencil size={16} />} label="تعديل" onClick={() => openRecord(c, 'edit')} />
            <IconBtn size="sm" icon={<IconTrash size={16} />} label="حذف" variant="danger" onClick={() => setToDelete(c)} />
          </div>
        )}
        emptyText={notLoaded ? 'لا توجد بيانات من الخادم.' : 'لا يوجد عملاء مسجّلون. أضف أول عميل.'}
      />

      <Drawer
        open={mode !== null}
        onClose={() => !saving && setMode(null)}
        size="lg"
        icon={<IconUsers size={20} />}
        title={mode === 'new' ? 'عميل جديد' : view ? (current?.name ?? '') : 'تعديل العميل'}
        description={
          current
            ? `${codeOf(`c-${current.id}`)} — أُضيف في ${dateOf(current.created_at)}`
            : 'الاسم مطلوب؛ الهاتف ورقم الهوية اختياريان.'
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
              <Btn type="submit" form="client-form" loading={saving}>
                حفظ
              </Btn>
            </>
          )
        }
      >
        <form
          id="client-form"
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <FormGrid>
            <SectionTitle>بيانات العميل</SectionTitle>
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
              label="الهاتف"
              dir="ltr"
              inputMode="tel"
              placeholder="01xxxxxxxxx"
              hint={view ? undefined : 'يُقبل 01xxxxxxxxx أو +201xxxxxxxxx'}
              value={draft.phone}
              error={errors.phone}
              onChange={(e) => update({ phone: e.target.value })}
              {...ro}
            />
            <TextInput
              label="هاتف إضافي"
              dir="ltr"
              inputMode="tel"
              placeholder="01xxxxxxxxx"
              hint={view ? undefined : 'اختياري — يُقبل أيضًا بالرقم الثاني'}
              value={draft.phone2}
              error={errors.phone2}
              onChange={(e) => update({ phone2: e.target.value })}
              {...ro}
            />
            <TextInput
              label="رقم الهوية"
              dir="ltr"
              inputMode="numeric"
              maxLength={14}
              value={draft.nationalId}
              error={errors.nationalId}
              onChange={(e) => update({ nationalId: e.target.value })}
              {...ro}
            />
            <Textarea
              containerClassName="col-span-full"
              label="ملاحظات"
              rows={2}
              value={draft.notes}
              onChange={(e) => update({ notes: e.target.value })}
              {...ro}
            />
            {!view && (
              <Text variant="caption" className="col-span-full text-fg-3">
                لا يوجد نوع للعميل (مشترٍ / مستأجر / مالك) ولا بريد إلكتروني في النظام؛ النوع يُستنتج من العقود.
              </Text>
            )}
          </FormGrid>
        </form>
      </Drawer>

      <Modal
        open={toDelete !== null}
        onClose={() => !deleting && setToDelete(null)}
        size="sm"
        tone="danger"
        icon={<IconTrash size={20} />}
        title="حذف العميل نهائيًا؟"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setToDelete(null)} disabled={deleting}>
              إلغاء
            </Btn>
            <Btn variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
              حذف
            </Btn>
          </>
        }
      >
        <Text variant="body">
          سيُحذف «{toDelete?.name}» نهائيًا من الخادم مع كل حجوزاته وعقوده وإيصالاته ومدفوعاته، وترجع وحداته إلى
          «متاحة». لا يمكن التراجع.
        </Text>
      </Modal>
    </div>
  )
}
