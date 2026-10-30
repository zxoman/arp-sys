import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import {
  BUILDING_ACTIVITIES,
  BUILDING_KINDS,
  type Building,
  type BuildingActivity,
  type BuildingKind,
} from '@/lib'
import {
  API_FIELD_TO_FORM,
  ApiError,
  buildingFromApi,
  clearToken,
  createBuilding,
  deleteBuilding,
  fetchBuildings,
  type DeletionCounts,
  updateBuilding,
  type PageMeta,
} from '@/lib/api'
import {
  Btn,
  DataTable,
  Drawer,
  Field,
  IconBtn,
  IconBuilding,
  IconEye,
  IconLayers,
  IconPencil,
  IconPlus,
  IconTrash,
  Modal,
  NumericInput,
  Select,
  TextInput,
  useToast,
  type Column,
  type SortState,
} from '@/kit'
import { codeOf, fmtNum, FormGrid, REQUIRED, SectionTitle, Segmented, ToggleChips, useNewShortcut, useShake, type Errors } from './shared'

const ACTIVITY_ITEMS = BUILDING_ACTIVITIES.map((a) => ({ value: a, label: a }))
const BASEMENT_ITEMS = ['لا', 'نعم'] as const
/** Debounce of the search box before it hits the API. */
const SEARCH_DELAY_MS = 350

/** « — معها 2 وحدة، 1 عقد، 1 إيصال» for the delete toast (empty when nothing was linked). */
function cascadeSummary(deleted: DeletionCounts): string {
  const parts: string[] = []
  if (deleted.units) parts.push(`${fmtNum(deleted.units)} وحدة`)
  if (deleted.reservations) parts.push(`${fmtNum(deleted.reservations)} حجز`)
  if (deleted.contracts) parts.push(`${fmtNum(deleted.contracts)} عقد`)
  if (deleted.receipts) parts.push(`${fmtNum(deleted.receipts)} إيصال`)
  return parts.length ? ` — حُذف معها ${parts.join('، ')}` : ''
}

/** DataTable column key → API `sort` parameter (columns without a server field aren't sortable). */
const SORT_FIELDS: Record<string, string> = {
  id: 'id',
  name: 'name',
  kind: 'type',
  location: 'city',
  totalFloors: 'floors_count',
  units: 'total_units',
  basement: 'has_basement',
}

type Draft = {
  name: string
  city: string
  district: string
  kind: BuildingKind
  activities: BuildingActivity[]
  totalFloors: number | null
  totalUnits: number | null
  hasBasement: boolean
}
type Key = keyof Draft

const EMPTY: Draft = {
  name: '',
  city: '',
  district: '',
  kind: 'عمارة',
  activities: [],
  totalFloors: null,
  totalUnits: null,
  hasBasement: false,
}

function validate(d: Draft): Errors<Key> {
  const e: Errors<Key> = {}
  if (!d.name.trim()) e.name = REQUIRED
  if (!d.city.trim()) e.city = REQUIRED
  if (!d.district.trim()) e.district = REQUIRED
  if (!d.kind) e.kind = REQUIRED
  if (!d.activities.length) e.activities = 'اختر نشاطًا واحدًا على الأقل'
  if (d.totalFloors == null || d.totalFloors < 0 || !Number.isInteger(d.totalFloors)) e.totalFloors = 'أدخل عدد أدوار صحيح'
  if (d.totalUnits == null || d.totalUnits < 0 || !Number.isInteger(d.totalUnits)) e.totalUnits = 'أدخل عدد وحدات صحيح'
  return e
}

/** 401/419 means the stored token is missing, revoked or expired. */
const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)

export default function Buildings() {
  const { logout } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState<'new' | 'edit' | 'view' | null>(null)
  const [current, setCurrent] = useState<Building | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [toDelete, setToDelete] = useState<Building | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [formRef, shake] = useShake<HTMLFormElement>()

  // Server-side table state: search (debounced), sort and 0-based page.
  const [rows, setRows] = useState<Building[]>([])
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, last_page: 1, per_page: 15, total: 0, from: null, to: null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  // Debounce typing so the API isn't hit on every keystroke.
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
    fetchBuildings({
      search,
      page: page + 1,
      sort: sort ? SORT_FIELDS[sort.key] : undefined,
      dir: sort?.dir,
    })
      .then((result) => {
        if (!alive) return
        setRows(result.items.map(buildingFromApi))
        setMeta(result.meta)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        if (isAuthError(err)) {
          clearToken()
          return
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل المباني من الخادم')
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

  const openRecord = (b: Building, m: 'edit' | 'view') => {
    setCurrent(b)
    setDraft({
      name: b.name,
      city: b.city,
      district: b.district,
      kind: b.kind ?? 'عمارة',
      activities: b.activities ?? [],
      totalFloors: b.totalFloors,
      totalUnits: b.totalUnits,
      hasBasement: b.hasBasement ?? false,
    })
    setErrors({})
    setMode(m)
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const toggleActivity = (a: BuildingActivity) =>
    set('activities', BUILDING_ACTIVITIES.filter((x) => (x === a ? !draft.activities.includes(a) : draft.activities.includes(x))))

  const changeSort = (next: SortState) => {
    setSort(next)
    setPage(0)
  }

  /** Maps the API's 422 `errors` (city, floors_count, …) back onto the form fields. */
  const applyApiErrors = (err: ApiError) => {
    const mapped: Errors<Key> = {}
    for (const [field, messages] of Object.entries(err.errors)) {
      const key = API_FIELD_TO_FORM[field.split('.')[0]] as Key | undefined
      if (key && messages[0]) mapped[key] = messages[0]
    }
    if (Object.keys(mapped).length) {
      setErrors(mapped)
      shake()
    } else {
      toast.error('تعذّر حفظ المبنى', err.message)
    }
  }

  const save = async () => {
    const e = validate(draft)
    setErrors(e)
    if (Object.values(e).some(Boolean)) return shake()

    const input = {
      name: draft.name.trim(),
      city: draft.city.trim(),
      district: draft.district.trim(),
      kind: draft.kind,
      activities: draft.activities,
      totalFloors: draft.totalFloors!,
      totalUnits: draft.totalUnits!,
      hasBasement: draft.hasBasement,
    }

    setSaving(true)
    try {
      if (current?.apiId) {
        await updateBuilding(current.apiId, input)
        toast.success('تم تحديث المبنى', `«${input.name}»`)
      } else {
        const created = await createBuilding(input)
        toast.success('تمت إضافة المبنى', `«${created.name}» — ${codeOf(`b-${created.id}`)}`)
        // Newest first (the API's default order): clear any search/sort so the new row is visible.
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
      else toast.error('تعذّر حفظ المبنى', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    const target = toDelete
    setDeleting(true)
    try {
      const deleted = target.apiId ? await deleteBuilding(target.apiId) : {}
      toast.success('تم حذف المبنى نهائيًا', `«${target.name}»${cascadeSummary(deleted)}`)
      setToDelete(null)
      // Deleting the only row on a later page leaves an empty page; step back one.
      if (rows.length === 1 && page > 0) setPage((p) => p - 1)
      else reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession()
      const message =
        err instanceof ApiError
          ? (err.errors.buildings?.[0] ?? (err.errors.activities?.[0] || err.message))
          : err instanceof Error
            ? err.message
            : undefined
      toast.error('تعذّر حذف المبنى', message)
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<Building>[] = [
    { key: 'id', header: 'الكود', value: (b) => codeOf(b.id), width: '6rem', cell: (b) => <span className="tabular-nums text-fg-2">{codeOf(b.id)}</span> },
    { key: 'name', header: 'اسم المبنى', cell: (b) => <span className="font-semibold text-fg">{b.name}</span> },
    { key: 'kind', header: 'نوع المبنى', value: (b) => b.kind ?? '' },
    { key: 'activities', header: 'النشاط', sortable: false, value: (b) => (b.activities ?? []).join('، ') },
    { key: 'location', header: 'المدينة / الحي', value: (b) => `${b.city} — ${b.district}` },
    { key: 'totalFloors', header: 'الأدوار', align: 'center', cell: (b) => fmtNum(b.totalFloors) },
    {
      key: 'units',
      header: 'الوحدات',
      align: 'center',
      value: (b) => b.totalUnits,
      cell: (b) => (
        <span className="tabular-nums">
          {fmtNum(b.unitsCount ?? 0)} <span className="text-fg-3">/ {fmtNum(b.totalUnits)}</span>
        </span>
      ),
    },
    {
      key: 'basement',
      header: 'البدروم',
      align: 'center',
      value: (b) => ((b.hasBasement ?? false) ? 'نعم' : 'لا'),
      cell: (b) => <span className={b.hasBasement ? 'text-fg' : 'text-fg-3'}>{b.hasBasement ? 'نعم' : 'لا'}</span>,
    },
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
        rowKey={(b) => b.id}
        caption="المباني"
        loading={loading}
        title={
          <div className="flex items-center gap-2">
            <Btn iconStart={<IconPlus size={16} />} onClick={openNew}>
              مبنى جديد
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
        serverSort={{ value: sort, onChange: changeSort }}
        serverPagination={{
          page,
          pageCount: meta.last_page,
          total: meta.total,
          from: meta.from ?? 0,
          to: meta.to ?? 0,
          onChange: setPage,
        }}
        searchPlaceholder="ابحث بالاسم أو النوع أو النشاط أو المدينة…"
        exportName="المباني"
        actionsWidth="11rem"
        onRowClick={(b) => openRecord(b, 'view')}
        actions={(b) => (
          <div className="flex items-center gap-0.5">
            <IconBtn size="sm" icon={<IconEye size={16} />} label="عرض" onClick={() => openRecord(b, 'view')} />
            <IconBtn size="sm" icon={<IconPencil size={16} />} label="تعديل" onClick={() => openRecord(b, 'edit')} />
            <IconBtn
              size="sm"
              icon={<IconLayers size={16} />}
              label="وحدات"
              onClick={() => {
                sessionStorage.setItem('units:building', b.id)
                location.hash = '#/units'
              }}
            />
            <IconBtn size="sm" icon={<IconTrash size={16} />} label="حذف" className="text-danger" onClick={() => setToDelete(b)} />
          </div>
        )}
        emptyText={notLoaded ? 'لا توجد بيانات من الخادم.' : 'لا توجد عقارات مسجّلة. أضف أول عقار.'}
      />

      <Drawer
        open={mode !== null}
        onClose={() => !saving && setMode(null)}
        size="lg"
        icon={<IconBuilding size={20} />}
        title={mode === 'new' ? 'مبنى جديد' : view ? (current?.name ?? '') : 'تعديل المبنى'}
        description={current ? `الكود ${codeOf(current.id)}` : 'الحقول المعلَّمة بـ * مطلوبة'}
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
              <Btn type="submit" form="building-form" loading={saving}>
                حفظ
              </Btn>
            </>
          )
        }
      >
        <form
          id="building-form"
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <FormGrid>
            <SectionTitle>بيانات المبنى</SectionTitle>
            <TextInput containerClassName="col-span-full" label="اسم المبنى" required value={draft.name} error={errors.name} onChange={(e) => set('name', e.target.value)} {...ro} />
            <TextInput label="المدينة" required value={draft.city} error={errors.city} onChange={(e) => set('city', e.target.value)} {...ro} />
            <TextInput label="الحي" required value={draft.district} error={errors.district} onChange={(e) => set('district', e.target.value)} {...ro} />
            <Select
              label="نوع المبنى"
              required
              options={BUILDING_KINDS}
              value={draft.kind}
              error={errors.kind}
              onChange={(e) => set('kind', e.target.value as BuildingKind)}
              disabled={view}
            />
            <NumericInput label="عدد الأدوار" required min={0} max={200} hint="بدون البدروم" value={draft.totalFloors} error={errors.totalFloors} onChange={(v) => set('totalFloors', v)} {...ro} />
            <NumericInput label="إجمالي الوحدات" required min={0} max={5000} hint="العدد المخطط للمبنى" value={draft.totalUnits} error={errors.totalUnits} onChange={(v) => set('totalUnits', v)} {...ro} />
            <Field className="col-span-full" label="نشاط المبنى" required error={errors.activities} hint={view ? undefined : 'يمكن اختيار أكثر من نشاط'}>
              <ToggleChips items={ACTIVITY_ITEMS} selected={draft.activities} onToggle={toggleActivity} disabled={view} />
            </Field>
            <Field label="وجود بدروم" required hint="يُولَّد بدروم تلقائيًا في الطوابق">
              <Segmented options={BASEMENT_ITEMS} value={draft.hasBasement ? 'نعم' : 'لا'} onChange={(v) => set('hasBasement', v === 'نعم')} label="وجود بدروم" disabled={view} />
            </Field>
          </FormGrid>
        </form>
      </Drawer>

      <Modal
        open={toDelete !== null}
        onClose={() => !deleting && setToDelete(null)}
        size="sm"
        tone="danger"
        icon={<IconTrash size={20} />}
        title="حذف المبنى نهائيًا؟"
        description={
          toDelete &&
          `سيُحذف «${toDelete.name}» وكل ما يرتبط به نهائيًا من الخادم: الوحدات (${fmtNum(toDelete.unitsCount ?? 0)}) والحجوزات والعقود والإيصالات والمدفوعات. لا يمكن التراجع.`
        }
        footer={
          <>
            <Btn variant="ghost" onClick={() => setToDelete(null)} disabled={deleting}>
              إلغاء
            </Btn>
            <Btn variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
              حذف نهائي
            </Btn>
          </>
        }
      />
    </div>
  )
}
