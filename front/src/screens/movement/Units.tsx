import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { offersRent, offersSale, type UnitPurpose } from '@/lib'
import {
  API_UNIT_FIELD_TO_FORM,
  ApiError,
  PURPOSE_TO_API,
  UNIT_TYPE_TO_API,
  activityFromApi,
  clearToken,
  createUnit,
  fetchAllBuildings,
  fetchBuildingFloors,
  fetchUnits,
  purposeLabel,
  updateUnit,
  type ApiBuilding,
  type ApiFloor,
  type ApiUnit,
  type PageMeta,
  type UnitInput,
} from '@/lib/api'
import { Text } from '@/components/ui'
import {
  Btn,
  DataTable,
  Drawer,
  Field,
  IconBtn,
  IconEye,
  IconLayers,
  IconPencil,
  IconPlus,
  NumericInput,
  Select,
  StatusChip,
  TextInput,
  useToast,
  type Column,
  type SortState,
} from '@/kit'
import { codeOf, fmtMoney, fmtNum, FormGrid, REQUIRED, SectionTitle, useNewShortcut, useShake, type Errors } from './shared'

const SEARCH_DELAY_MS = 350

/** The four unit types the API accepts; the prototype's extra ones aren't part of the model yet. */
const TYPE_ITEMS = Object.entries(UNIT_TYPE_TO_API).map(([label, value]) => ({ value, label }))
/** Purpose options keep the prototype's Arabic labels; `save` maps them to `sale | rent | both`. */
const PURPOSE_ITEMS = Object.keys(PURPOSE_TO_API).map((label) => ({ value: label, label }))
const SELLABLE_ITEMS = [
  { value: '1', label: 'متاحة' },
  { value: '0', label: 'غير قابلة للبيع' },
]
/** Status filter: the API's automatic statuses plus the manual «غير قابلة للبيع» flag. */
const STATE_ITEMS = [
  { value: 'available', label: 'متاحة' },
  { value: 'reserved', label: 'محجوزة' },
  { value: 'sold', label: 'مباعة' },
  { value: 'rented', label: 'مؤجرة' },
  { value: 'blocked', label: 'غير قابلة للبيع' },
]

/** DataTable column key → API `sort` parameter (columns without a server field aren't sortable). */
const SORT_FIELDS: Record<string, string> = {
  id: 'id',
  name: 'name',
  type: 'type',
  purpose: 'purpose',
  area: 'area',
  status: 'status',
}

type Draft = {
  buildingId: string
  floorId: string
  name: string
  type: string
  activity: string
  purpose: string
  area: number | null
  rooms: number | null
  bathrooms: number | null
  pricePerMeter: number | null
  price: number | null
  priceManual: boolean
  sellable: boolean
  nonSellableReason: string
}
type Key = keyof Draft

const emptyDraft = (buildingId = '', activity = ''): Draft => ({
  buildingId,
  floorId: '',
  name: '',
  type: '',
  activity,
  purpose: 'بيع وإيجار',
  area: null,
  rooms: null,
  bathrooms: null,
  pricePerMeter: null,
  price: null,
  priceManual: false,
  sellable: true,
  nonSellableReason: '',
})

/** Area × price per m², or null until both are known. */
const derivedPrice = (d: Pick<Draft, 'area' | 'pricePerMeter'>) => (d.area && d.pricePerMeter ? Math.round(d.area * d.pricePerMeter) : null)
const salePriceOf = (d: Draft) => (d.priceManual ? d.price : derivedPrice(d))

/** 401/419 means the stored token is missing, revoked or expired. */
const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)

/** «غير قابلة للبيع» units are off the market; otherwise show the API's automatic status. */
const statusLabelOf = (u: ApiUnit) => (!u.is_sellable ? 'غير قابلة للبيع' : (u.status_label ?? 'متاحة'))

export default function Units() {
  const { logout } = useAuth()
  const toast = useToast()
  const [mode, setMode] = useState<'new' | 'edit' | 'view' | null>(null)
  const [current, setCurrent] = useState<ApiUnit | null>(null)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft())
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [saving, setSaving] = useState(false)
  const [formRef, shake] = useShake<HTMLFormElement>()

  // Auth + server-side table state (search is debounced; the page is 0-based).
  const [rows, setRows] = useState<ApiUnit[]>([])
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, last_page: 1, per_page: 15, total: 0, from: null, to: null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortState>(null)
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  // Filters (all applied server-side).
  const [fBuilding, setFBuilding] = useState('')
  const [fFloor, setFFloor] = useState('')
  const [fType, setFType] = useState('')
  const [fPurpose, setFPurpose] = useState('')
  const [fState, setFState] = useState('')

  // Reference data: every building (for the pickers) and the floors of the buildings in use.
  const [buildings, setBuildings] = useState<ApiBuilding[]>([])
  const [floors, setFloors] = useState<Record<number, ApiFloor[]>>({})
  const floorsRef = useRef<Record<number, ApiFloor[]>>({})
  const floorsPending = useRef<Set<number>>(new Set())

  const loadFloors = useCallback(async (buildingId: number) => {
    if (!buildingId || floorsRef.current[buildingId] || floorsPending.current.has(buildingId)) return
    floorsPending.current.add(buildingId)
    try {
      const list = await fetchBuildingFloors(buildingId)
      floorsRef.current[buildingId] = list
      setFloors((prev) => ({ ...prev, [buildingId]: list }))
    } catch {
      // The table request surfaces auth/transport errors; the floor picker just stays empty.
    } finally {
      floorsPending.current.delete(buildingId)
    }
  }, [])

  useEffect(() => {
    let alive = true
    fetchAllBuildings()
      .then((list) => {
        if (alive) setBuildings(list)
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (isAuthError(err)) {
          clearToken()
        }
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (fBuilding) void loadFloors(Number(fBuilding))
  }, [fBuilding, loadFloors])

  useEffect(() => {
    if (draft.buildingId) void loadFloors(Number(draft.buildingId))
  }, [draft.buildingId, loadFloors])

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
    fetchUnits({
      search,
      page: page + 1,
      sort: sort ? SORT_FIELDS[sort.key] : undefined,
      dir: sort?.dir,
      buildingId: fBuilding ? Number(fBuilding) : null,
      floorId: fFloor ? Number(fFloor) : null,
      type: fType || null,
      purpose: fPurpose ? PURPOSE_TO_API[fPurpose] : null,
      status: fState && fState !== 'blocked' ? fState : null,
      sellable: fState === 'blocked' ? false : null,
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
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل الوحدات من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [search, page, sort, fBuilding, fFloor, fType, fPurpose, fState, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  /** Called when a request comes back 401/419: drops the token, which signs the app out. */
  const lostSession = () => {
    clearToken()
    setMode(null)
  }

  const buildingOf = (id: string) => buildings.find((b) => String(b.id) === id) ?? null
  const floorOptions = fBuilding ? (floors[Number(fBuilding)] ?? []) : []
  const buildingOptions = buildings.map((b) => ({ value: String(b.id), label: b.name }))
  const currentBuilding = buildingOf(draft.buildingId)
  const activityOptions = (currentBuilding?.activities ?? []).flatMap((a) => {
    const label = activityFromApi(a)
    return label ? [{ value: a, label }] : []
  })

  const openNew = () => {
    const only = buildings.length === 1 ? String(buildings[0].id) : ''
    const buildingId = fBuilding || only
    const activity = buildings.find((b) => String(b.id) === buildingId)?.activities?.[0] ?? ''
    setCurrent(null)
    setDraft(emptyDraft(buildingId, activity))
    setErrors({})
    setMode('new')
  }
  useNewShortcut(openNew)

  const openRecord = (u: ApiUnit, m: 'edit' | 'view') => {
    setCurrent(u)
    setDraft({
      buildingId: String(u.building_id),
      floorId: String(u.floor_id),
      name: u.name,
      type: u.type,
      activity: u.activity ?? '',
      purpose: purposeLabel(u.purpose),
      area: u.area ? Number(u.area) : null,
      rooms: u.rooms,
      bathrooms: u.bathrooms,
      pricePerMeter: u.price_per_meter ? Number(u.price_per_meter) : null,
      price: u.sale_price ? Number(u.sale_price) : null,
      priceManual: u.sale_price != null,
      sellable: u.is_sellable,
      nonSellableReason: u.non_sellable_reason ?? '',
    })
    setErrors({})
    setMode(m)
  }

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch) as Key[]) delete next[k]
      // The price error is about the derived value too.
      if ('area' in patch || 'pricePerMeter' in patch) delete next.price
      return next
    })
  }

  // A single-activity building decides the unit's activity on its own.
  useEffect(() => {
    const b = buildingOf(draft.buildingId)
    if (b && b.activities?.length === 1 && draft.activity !== b.activities[0]) {
      setDraft((d) => ({ ...d, activity: b.activities![0] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, draft.buildingId])

  const locked = current != null && (current.status === 'sold' || current.status === 'rented')
  const sale = offersSale(draft.purpose as UnitPurpose)
  const rent = offersRent(draft.purpose as UnitPurpose)
  const price = salePriceOf(draft)
  const autoPrice = derivedPrice(draft)

  const validate = (d: Draft): Errors<Key> => {
    const e: Errors<Key> = {}
    if (!d.buildingId) e.buildingId = REQUIRED
    if (!d.floorId) e.floorId = REQUIRED
    if (!d.name.trim()) e.name = REQUIRED
    if (!d.type) e.type = REQUIRED
    if ((buildingOf(d.buildingId)?.activities?.length ?? 0) > 1 && !d.activity) e.activity = REQUIRED
    if (!d.area || d.area <= 0) e.area = 'أدخل مساحة صحيحة'
    if (!d.purpose) e.purpose = REQUIRED
    if (sale) {
      if (!d.priceManual && (!d.pricePerMeter || d.pricePerMeter <= 0)) e.pricePerMeter = 'أدخل سعر متر صحيحًا'
      const p = salePriceOf(d)
      if (!p || p <= 0) e.price = 'أدخل سعرًا صحيحًا'
    }
    if (!d.sellable && !d.nonSellableReason.trim()) e.nonSellableReason = 'اذكر سبب عدم الإتاحة'
    return e
  }

  const applyApiErrors = (err: ApiError) => {
    const mapped: Errors<Key> = {}
    for (const [field, messages] of Object.entries(err.errors)) {
      const key = API_UNIT_FIELD_TO_FORM[field.split('.')[0]] as Key | undefined
      if (key && messages[0]) mapped[key] = messages[0]
    }
    if (Object.keys(mapped).length) {
      setErrors(mapped)
      shake()
    } else {
      toast.error('تعذّر حفظ الوحدة', err.message)
    }
  }

  const save = async () => {
    const e = validate(draft)
    setErrors(e)
    if (Object.values(e).some(Boolean)) return shake()

    const input: UnitInput = {
      buildingId: Number(draft.buildingId),
      floorId: Number(draft.floorId),
      name: draft.name.trim(),
      type: draft.type,
      activity: draft.activity,
      purpose: PURPOSE_TO_API[draft.purpose],
      area: draft.area!,
      rooms: draft.rooms,
      bathrooms: draft.bathrooms,
      // Rent-only units carry no sale price on the API.
      pricePerMeter: sale ? draft.pricePerMeter : null,
      salePrice: sale && draft.priceManual ? draft.price : null,
      isSellable: draft.sellable,
      nonSellableReason: draft.nonSellableReason,
    }

    setSaving(true)
    try {
      if (current) {
        await updateUnit(current.id, input)
        toast.success('تم تحديث الوحدة', `«${input.name}»`)
      } else {
        const created = await createUnit(input)
        toast.success('تمت إضافة الوحدة', `«${created.name}» — ${codeOf(`u-${created.id}`)}`)
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
      else toast.error('تعذّر حفظ الوحدة', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const columns: Column<ApiUnit>[] = [
    { key: 'id', header: 'الكود', value: (u) => codeOf(`u-${u.id}`), width: '6rem', cell: (u) => <span className="tabular-nums text-fg-2">{codeOf(`u-${u.id}`)}</span> },
    { key: 'building', header: 'المبنى', sortable: false, value: (u) => u.building_name ?? '', cell: (u) => u.building_name ?? '—' },
    {
      key: 'name',
      header: 'الوحدة',
      cell: (u) => (
        <div className="leading-tight">
          <span className="font-semibold text-fg">{u.name}</span>
          {!u.is_sellable && u.non_sellable_reason && <div className="t-caption mt-0.5 text-danger">{u.non_sellable_reason}</div>}
        </div>
      ),
    },
    { key: 'floor', header: 'الدور', sortable: false, align: 'center', value: (u) => u.floor_number ?? 0, cell: (u) => u.floor_display_name ?? '—' },
    { key: 'type', header: 'النوع', value: (u) => u.type_label ?? '' },
    { key: 'purpose', header: 'الغرض', value: (u) => u.purpose_label ?? '' },
    { key: 'area', header: 'المساحة', align: 'end', value: (u) => Number(u.area), cell: (u) => `${fmtNum(Number(u.area))} م²` },
    {
      key: 'price',
      header: 'سعر البيع',
      sortable: false,
      align: 'end',
      value: (u) => (u.total_price ? Number(u.total_price) : null),
      cell: (u) => (u.total_price ? <span className="tabular-nums">{fmtMoney(Number(u.total_price))}</span> : <span className="text-fg-3">—</span>),
    },
    { key: 'status', header: 'الحالة', cell: (u) => <StatusChip status={statusLabelOf(u)} size="sm" /> },
  ]

  const view = mode === 'view'
  const ro = { readOnly: view, disabled: view }
  const filtering = Boolean(fBuilding || fFloor || fType || fPurpose || fState)
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

      <div className="glass flex flex-wrap items-end gap-3 rounded-card p-4">
        <Select
          containerClassName="min-w-44 flex-1"
          label="المبنى"
          placeholder="كل المباني"
          options={buildingOptions}
          value={fBuilding}
          onChange={(e) => {
            setFBuilding(e.target.value)
            setFFloor('')
            setPage(0)
          }}
        />
        <Select
          containerClassName="min-w-28 flex-1"
          label="الدور"
          placeholder="كل الأدوار"
          options={floorOptions.map((f) => ({ value: String(f.id), label: f.display_name }))}
          value={fFloor}
          onChange={(e) => {
            setFFloor(e.target.value)
            setPage(0)
          }}
          disabled={!fBuilding}
          hint={!fBuilding ? 'اختر المبنى أولاً' : undefined}
        />
        <Select
          containerClassName="min-w-32 flex-1"
          label="النوع"
          placeholder="كل الأنواع"
          options={TYPE_ITEMS}
          value={fType}
          onChange={(e) => {
            setFType(e.target.value)
            setPage(0)
          }}
        />
        <Select
          containerClassName="min-w-36 flex-1"
          label="الغرض"
          placeholder="كل الأغراض"
          options={PURPOSE_ITEMS}
          value={fPurpose}
          onChange={(e) => {
            setFPurpose(e.target.value)
            setPage(0)
          }}
        />
        <Select
          containerClassName="min-w-36 flex-1"
          label="الحالة"
          placeholder="كل الحالات"
          options={STATE_ITEMS}
          value={fState}
          onChange={(e) => {
            setFState(e.target.value)
            setPage(0)
          }}
        />
        {filtering && (
          <Btn
            variant="ghost"
            onClick={() => {
              setFBuilding('')
              setFFloor('')
              setFType('')
              setFPurpose('')
              setFState('')
              setPage(0)
            }}
          >
            مسح الفلاتر
          </Btn>
        )}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(u) => String(u.id)}
        caption="الوحدات"
        loading={loading}
        title={
          <div className="flex items-center gap-2">
            <Btn iconStart={<IconPlus size={16} />} onClick={openNew}>
              وحدة جديدة
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
        searchPlaceholder="ابحث برقم أو اسم الوحدة…"
        exportName="الوحدات"
        actionsWidth="6rem"
        onRowClick={(u) => openRecord(u, 'view')}
        actions={(u) => (
          <div className="flex items-center gap-0.5">
            <IconBtn size="sm" icon={<IconEye size={16} />} label="عرض" onClick={() => openRecord(u, 'view')} />
            <IconBtn size="sm" icon={<IconPencil size={16} />} label="تعديل" onClick={() => openRecord(u, 'edit')} />
          </div>
        )}
        emptyText={notLoaded ? 'لا توجد بيانات من الخادم.' : filtering ? 'لا توجد وحدات مطابقة للفلاتر.' : 'لا توجد وحدات مسجّلة. أضف أول وحدة.'}
      />

      <Drawer
        open={mode !== null}
        onClose={() => !saving && setMode(null)}
        size="lg"
        icon={<IconLayers size={20} />}
        title={mode === 'new' ? 'وحدة جديدة' : view ? `الوحدة ${current?.name ?? ''}` : 'تعديل الوحدة'}
        description={
          current
            ? `${current.building_name ?? '—'} — ${codeOf(`u-${current.id}`)} — ${statusLabelOf(current)}`
            : 'الحقول المعلَّمة بـ * مطلوبة'
        }
        footer={
          view ? (
            <>
              <Btn variant="ghost" onClick={() => setMode(null)}>
                إغلاق
              </Btn>
              <Btn iconStart={<IconPencil size={16} />} onClick={() => !locked && setMode('edit')} disabled={locked}>
                تعديل
              </Btn>
            </>
          ) : (
            <>
              <Btn variant="ghost" onClick={() => setMode(null)} disabled={saving}>
                إلغاء
              </Btn>
              <Btn type="submit" form="unit-form" loading={saving}>
                حفظ
              </Btn>
            </>
          )
        }
      >
        <form
          id="unit-form"
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <FormGrid>
            <SectionTitle>بيانات الوحدة</SectionTitle>
            <Select
              containerClassName="col-span-full"
              label="المبنى"
              required
              placeholder="اختر المبنى"
              options={buildingOptions}
              value={draft.buildingId}
              error={errors.buildingId}
              hint={current && !view ? 'لا يمكن نقل الوحدة إلى مبنى آخر' : undefined}
              onChange={(e) => update({ buildingId: e.target.value, floorId: '' })}
              disabled={view || current != null}
            />
            <Select
              label="الدور"
              required
              placeholder={draft.buildingId ? 'اختر الدور' : 'اختر المبنى أولاً'}
              options={(floors[Number(draft.buildingId)] ?? []).map((f) => ({ value: String(f.id), label: f.display_name }))}
              value={draft.floorId}
              error={errors.floorId}
              hint="تُولَّد الأدوار تلقائيًا من إعدادات المبنى"
              onChange={(e) => update({ floorId: e.target.value })}
              disabled={view || locked || !draft.buildingId}
            />
            <TextInput
              label="رقم / اسم الوحدة"
              required
              dir="ltr"
              placeholder="301"
              value={draft.name}
              error={errors.name}
              onChange={(e) => update({ name: e.target.value })}
              {...ro}
            />
            <Select
              label="نوع الوحدة"
              required
              placeholder="اختر النوع"
              options={TYPE_ITEMS}
              value={draft.type}
              error={errors.type}
              onChange={(e) => update({ type: e.target.value })}
              disabled={view || locked}
            />
            {activityOptions.length > 1 && (
              <Select
                label="نشاط الوحدة"
                required
                placeholder="اختر النشاط"
                options={activityOptions}
                value={draft.activity}
                error={errors.activity}
                hint="من أنشطة المبنى"
                onChange={(e) => update({ activity: e.target.value })}
                disabled={view || locked}
              />
            )}
            <NumericInput label="المساحة" required suffix="م²" min={1} decimals={1} value={draft.area} error={errors.area} onChange={(v) => update({ area: v })} {...(current?.status === 'sold' ? { readOnly: true, disabled: true } : ro)} />
            <NumericInput label="الغرف" min={0} max={20} stepper value={draft.rooms} onChange={(v) => update({ rooms: v })} {...ro} />
            <NumericInput label="الحمامات" min={0} max={10} stepper value={draft.bathrooms} onChange={(v) => update({ bathrooms: v })} {...ro} />

            <SectionTitle>الغرض والسعر</SectionTitle>
            <Select
              containerClassName="col-span-full"
              label="الغرض"
              required
              options={PURPOSE_ITEMS}
              value={draft.purpose}
              error={errors.purpose}
              hint={locked && !view ? 'لا يمكن تغيير الغرض بعد بيع الوحدة أو تأجيرها' : undefined}
              onChange={(e) => update({ purpose: e.target.value })}
              disabled={view || locked}
            />
            {sale && (
              <>
                <NumericInput
                  label="سعر المتر"
                  required={!draft.priceManual}
                  suffix="ج.م/م²"
                  min={0}
                  value={draft.pricePerMeter}
                  error={errors.pricePerMeter}
                  onChange={(v) => update({ pricePerMeter: v })}
                  {...(locked ? { readOnly: true, disabled: true } : ro)}
                />
                <NumericInput
                  label="سعر البيع"
                  required
                  suffix="ج.م"
                  min={0}
                  value={price}
                  error={errors.price}
                  hint={
                    view ? undefined : draft.priceManual ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => update({ priceManual: false, price: null })}>
                        أُدخل يدويًا — {autoPrice ? `إعادة الحساب (${fmtMoney(autoPrice)})` : 'إعادة الحساب من المساحة × سعر المتر'}
                      </button>
                    ) : (
                      'المساحة × سعر المتر — يمكن تعديله يدويًا'
                    )
                  }
                  onChange={(v) => update({ price: v, priceManual: true })}
                  {...(locked ? { readOnly: true, disabled: true } : ro)}
                />
              </>
            )}
            {rent && !sale && (
              <Text variant="caption" className="col-span-full text-fg-3">
                وحدة للإيجار فقط: لا سعر بيع لها، ويُدخل مبلغ الإيجار عند إنشاء العقد.
              </Text>
            )}

            <SectionTitle>الحالة</SectionTitle>
            {locked && current ? (
              <Field className="col-span-full" label="الحالة" hint="تتغير تلقائيًا من الحجوزات والعقود">
                <div className="flex items-center gap-2">
                  <StatusChip status={statusLabelOf(current)} />
                  {!current.is_sellable && current.non_sellable_reason && <span className="t-caption text-danger">{current.non_sellable_reason}</span>}
                </div>
              </Field>
            ) : (
              <Select
                label="الإتاحة"
                required
                options={SELLABLE_ITEMS}
                value={draft.sellable ? '1' : '0'}
                hint="«غير قابلة للبيع» تمنع البيع والإيجار معًا"
                onChange={(e) => update({ sellable: e.target.value === '1' })}
                disabled={view}
              />
            )}
            {!locked && !draft.sellable && (
              <TextInput
                containerClassName="col-span-full rise-in"
                label="سبب عدم الإتاحة"
                required
                value={draft.nonSellableReason}
                error={errors.nonSellableReason}
                onChange={(e) => update({ nonSellableReason: e.target.value })}
                {...ro}
              />
            )}
          </FormGrid>
        </form>
      </Drawer>
    </div>
  )
}
