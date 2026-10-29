import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import {
  useData,
  egp,
  isOpenUnit,
  newId,
  offersRent,
  offersSale,
  type ContractType,
  type ISODate,
  type Reservation,
  type Unit,
} from '@/lib'
import {
  ApiError,
  RESERVATION_STATUS_TO_API,
  cancelReservation,
  cancelReservationPayment,
  clearToken,
  createReservation,
  createReservationPayment,
  fetchAllBuildings,
  fetchAllClients,
  fetchReservableUnits,
  fetchReservation,
  fetchReservationPayments,
  fetchReservations,
  type ApiBuilding,
  type ApiClient,
  type ApiReservation,
  type ApiReservationPayment,
  type ApiUnit,
  type PageMeta,
  type ReservationInput,
  unitTypeLabel,
} from '@/lib/api'
import { addDays } from '@/lib/domain'
import { TODAY_ISO } from '@/data'
import {
  Btn,
  Combobox,
  DataTable,
  DatePicker,
  Drawer,
  IconBtn,
  IconCalendar,
  IconEye,
  IconPlus,
  IconTrash,
  Modal,
  NumericInput,
  StatusChip,
  Textarea,
  useToast,
  type Column,
  type SortState,
} from '@/kit'
import { Text } from '@/components/ui'
import {
  ClientPicker,
  FilterChips,
  floorLabel,
  fmtMoney,
  FormGrid,
  InfoPair,
  ProjectBadge,
  REQUIRED,
  SectionTitle,
  Segmented,
  codeOf,
  useNewShortcut,
  useShake,
  type Errors,
} from './shared'

const PURPOSES: readonly ContractType[] = ['بيع', 'إيجار']

type Draft = {
  purpose: ContractType
  unitId: string | null
  clientId: string | null
  date: ISODate | null
  expiryDate: ISODate | null
  deposit: number | null
}
type Key = keyof Draft

const emptyDraft = (purpose: ContractType): Draft => ({
  purpose,
  unitId: null,
  clientId: null,
  date: TODAY_ISO,
  expiryDate: addDays(TODAY_ISO, 14),
  deposit: null,
})

const offers = (u: Unit, purpose: ContractType) => (purpose === 'إيجار' ? offersRent(u.purpose) : offersSale(u.purpose))

export function ReservationFormDrawer({
  open,
  onClose,
  initialPurpose = 'بيع',
  onSaved,
}: {
  open: boolean
  onClose: () => void
  initialPurpose?: ContractType
  onSaved?: (reservation: Reservation) => void
}) {
  const { reservations, units, buildings, clients, dispatch } = useData()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(initialPurpose))
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [formRef, shake] = useShake<HTMLFormElement>()
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(emptyDraft(initialPurpose))
      setErrors({})
    }
  }

  const bName = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings])
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])

  const unitOptions = useMemo(
    () =>
      units
        .filter((u) => isOpenUnit(u) && offers(u, draft.purpose))
        .map((u) => ({
          value: u.id,
          label: `${bName.get(u.buildingId) ?? ''} — ${u.type} ${u.number}`,
          description: `${floorLabel(u.floor)} · ${u.area} م² · ${draft.purpose === 'إيجار' ? `${egp(u.monthlyRent)} شهريًا` : egp(u.price)}${u.status === 'مرتجعة' ? ' · مرتجعة' : ''}`,
        })),
    [units, bName, draft.purpose],
  )
  const unit = draft.unitId ? unitById.get(draft.unitId) : undefined

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch)) delete next[k as Key]
      return next
    })
  }

  const changePurpose = (purpose: ContractType) => {
    const keepUnit = unit && offers(unit, purpose)
    update({ purpose, ...(keepUnit ? {} : { unitId: null }) })
  }

  const save = () => {
    const e: Errors<Key> = {}
    if (!draft.unitId || !unit) e.unitId = REQUIRED
    else if (!isOpenUnit(unit)) e.unitId = 'الوحدة لم تعد متاحة'
    else if (!offers(unit, draft.purpose)) e.unitId = `الوحدة غير معروضة لل${draft.purpose}`
    if (!draft.clientId) e.clientId = REQUIRED
    if (!draft.date) e.date = REQUIRED
    if (!draft.expiryDate) e.expiryDate = REQUIRED
    else if (draft.date && draft.expiryDate < draft.date) e.expiryDate = 'تاريخ الانتهاء قبل تاريخ الحجز'
    const deposit = draft.deposit ?? 0
    if (deposit < 0) e.deposit = 'قيمة غير صحيحة'
    else if (unit && draft.purpose === 'بيع' && deposit > unit.price) e.deposit = 'العربون أكبر من سعر الوحدة'
    setErrors(e)
    if (Object.values(e).some(Boolean)) return shake()
    const record: Reservation = {
      id: newId('reservations', reservations),
      clientId: draft.clientId!,
      unitId: unit!.id,
      purpose: draft.purpose,
      date: draft.date!,
      expiryDate: draft.expiryDate!,
      deposit,
      status: 'نشط',
    }
    dispatch({ type: 'ADD_RESERVATION', payload: record })
    toast.success('تم حفظ الحجز', `${clientById.get(record.clientId)?.fullName ?? ''} — الوحدة ${unit!.number} أصبحت «محجوزة»`)
    onClose()
    onSaved?.(record)
  }

  const clientType = draft.purpose === 'إيجار' ? 'مستأجر' : 'مشتري'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="md"
      icon={<IconCalendar size={20} />}
      title="حجز جديد"
      description="تظهر الوحدات المتاحة المعروضة لنوع الحجز المختار فقط؛ تصبح الوحدة «محجوزة» عند الحفظ."
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>إلغاء</Btn>
          <Btn type="submit" form="reservation-form">حفظ</Btn>
        </>
      }
    >
      <form id="reservation-form" ref={formRef} noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), save())}>
        <ProjectBadge className="justify-self-start sm:col-span-2" />
        <div className="grid gap-1.5 sm:col-span-2">
          <span className="t-label">نوع الحجز <span className="text-danger">*</span></span>
          <Segmented label="نوع الحجز" options={PURPOSES} value={draft.purpose} onChange={changePurpose} />
        </div>
        <Combobox
          containerClassName="sm:col-span-2"
          label="الوحدة"
          required
          placeholder="ابحث بالمبنى أو رقم الوحدة…"
          options={unitOptions}
          value={draft.unitId}
          error={errors.unitId}
          clearable
          emptyText={`لا توجد وحدات متاحة لل${draft.purpose}`}
          onChange={(v) => update({ unitId: v })}
        />
        {unit && (
          <div className="rise-in sm:col-span-2 flex flex-wrap gap-x-6 gap-y-2 rounded-ctl border border-hairline px-4 py-3">
            {draft.purpose === 'إيجار' ? (
              <InfoPair label="الإيجار الشهري" value={egp(unit.monthlyRent)} strong />
            ) : (
              <InfoPair label="السعر" value={egp(unit.price)} strong />
            )}
            <InfoPair label="المساحة" value={`${unit.area} م²`} />
            <InfoPair label="النوع" value={unit.type} />
            <InfoPair label="الدور" value={floorLabel(unit.floor)} />
          </div>
        )}
        <ClientPicker
          containerClassName="sm:col-span-2"
          required
          compact
          typeFilter
          value={draft.clientId}
          error={errors.clientId}
          preferType={clientType}
          newType={clientType}
          onChange={(v) => update({ clientId: v })}
        />
        <NumericInput label="العربون" suffix="ج.م" min={0} value={draft.deposit} error={errors.deposit} onChange={(v) => update({ deposit: v })} />
        <div className="hidden sm:block" aria-hidden="true" />
        <DatePicker label="تاريخ الحجز" required value={draft.date} error={errors.date} today={TODAY_ISO} onChange={(v) => update({ date: v })} />
        <DatePicker label="تاريخ الانتهاء" required value={draft.expiryDate} error={errors.expiryDate} today={TODAY_ISO} onChange={(v) => update({ expiryDate: v })} />
      </form>
    </Drawer>
  )
}

/* ==================================================================
   Reservations — server-driven page
   ================================================================== */

const SEARCH_DELAY_MS = 350

/** Status chips; the Arabic label maps to the API's `status` filter. */
type Filter = 'الكل' | 'نشط' | 'محوّل لعقد' | 'ملغي'
const FILTERS: readonly Filter[] = ['الكل', 'نشط', 'محوّل لعقد', 'ملغي']

/** DataTable column key → API `sort` parameter (reservations have no name/client sort). */
const SORT_FIELDS: Record<string, string> = {
  id: 'id',
  date: 'reservation_date',
  status: 'status',
}

type NewDraft = {
  clientId: string | null
  unitId: string | null
  buildingId: string | null
  date: ISODate
  firstPayment: number | null
}
type NewDraftKey = keyof NewDraft | 'link'

/** `YYYY-MM-DD` in the machine's timezone (the API stores a date, not a timestamp). */
const isoToday = (): ISODate => new Date().toLocaleDateString('en-CA') as ISODate

const EMPTY_DRAFT: NewDraft = { clientId: null, unitId: null, buildingId: null, date: isoToday(), firstPayment: null }

/** API field name → form/draft field, for mapping 422 errors back onto the drawer. */
const API_RESERVATION_FIELD_TO_FORM: Record<string, string> = {
  client_id: 'clientId',
  unit_id: 'unitId',
  building_id: 'buildingId',
  reservation_date: 'date',
  'first_payment.amount': 'firstPayment',
  first_payment: 'firstPayment',
}

/** 401/419 means the stored token is missing, revoked or expired. */
const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)

/** `2026-10-28T00:00:00…` / `2026-10-28` → `٢٨‏/١٠‏/٢٠٢٦` (the API sends ISO dates). */
const dateOf = (value: string | null | undefined) => {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'
  return new Date(year, month - 1, day).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export default function Reservations() {
  const { logout } = useAuth()
  const toast = useToast()

  // ── Server state ─────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ApiReservation[]>([])
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, last_page: 1, per_page: 15, total: 0, from: null, to: null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('الكل')
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  // ── Pickers (clients / reservable units / buildings) ─────────────────────
  // Filled on demand: see the effect below, which only runs once the drawer is open.
  const [clients, setClients] = useState<ApiClient[]>([])
  const [units, setUnits] = useState<ApiUnit[]>([])
  const [buildings, setBuildings] = useState<ApiBuilding[]>([])
  const [optionsKey, setOptionsKey] = useState(0)
  const [optionsReadyKey, setOptionsReadyKey] = useState<number | null>(null)

  // ── Drawer state ────────────────────────────────────────────────────────
  const [mode, setMode] = useState<'new' | 'view' | null>(null)
  const [current, setCurrent] = useState<ApiReservation | null>(null)
  const [payments, setPayments] = useState<ApiReservationPayment[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [draft, setDraft] = useState<NewDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<Errors<NewDraftKey>>({})
  const [saving, setSaving] = useState(false)
  const [formRef, shake] = useShake<HTMLFormElement>()
  const [payAmount, setPayAmount] = useState<number | null>(null)
  const [paying, setPaying] = useState(false)

  // ── Cancel modals ───────────────────────────────────────────────────────
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [paymentToCancel, setPaymentToCancel] = useState<ApiReservationPayment | null>(null)
  const [paymentReason, setPaymentReason] = useState('')
  const [cancellingPayment, setCancellingPayment] = useState(false)

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
    fetchReservations({
      search,
      status: filter === 'الكل' ? undefined : RESERVATION_STATUS_TO_API[filter],
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
          lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
          return
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل الحجوزات من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, page, sort, reloadKey])

  // Options for the new-reservation pickers. Loaded when the drawer opens, not on page load:
  // they cost three list requests and the table itself doesn't need them.
  useEffect(() => {
    if (mode === null || optionsReadyKey === optionsKey) return
    let alive = true
    Promise.all([fetchAllClients(), fetchReservableUnits(), fetchAllBuildings()])
      .then(([c, u, b]) => {
        if (!alive) return
        setClients(c)
        setUnits(u)
        setBuildings(b)
        setOptionsReadyKey(optionsKey)
      })
      .catch(() => {
        // The table banner already reports connection problems.
      })
    return () => {
      alive = false
    }
  }, [mode, optionsKey, optionsReadyKey])

  const reload = () => setReloadKey((k) => k + 1)

  function lostSession(notice: string) {
    clearToken()
    setMode(null)
    setCurrent(null)
    setCancelOpen(false)
    setPaymentToCancel(null)
  }

  const openNew = () => {
    setDraft(EMPTY_DRAFT)
    setErrors({})
    setMode('new')
  }
  useNewShortcut(openNew)

  const openRecord = (r: ApiReservation) => {
    setCurrent(r)
    setPayments(r.payments ?? [])
    setPayAmount(null)
    setMode('view')
    void refreshDetail(r.id)
  }

  const refreshDetail = async (id: number) => {
    setPaymentsLoading(true)
    try {
      const [detail, pays] = await Promise.all([fetchReservation(id), fetchReservationPayments(id)])
      setCurrent(detail)
      setPayments(pays.items)
    } catch (err) {
      if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      toast.error('تعذّر تحديث الحجز', err instanceof Error ? err.message : undefined)
    } finally {
      setPaymentsLoading(false)
    }
  }

  const update = (patch: Partial<NewDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch) as NewDraftKey[]) delete next[k]
      if (patch.unitId || patch.buildingId) delete next.link
      return next
    })
  }

  const validate = (d: NewDraft): Errors<NewDraftKey> => {
    const e: Errors<NewDraftKey> = {}
    if (!d.clientId) e.clientId = REQUIRED
    if (!d.unitId && !d.buildingId) e.link = 'اختر وحدة أو مبنى للحجز'
    if (!d.date) e.date = REQUIRED
    if (d.firstPayment != null && d.firstPayment <= 0) e.firstPayment = 'أدخل مبلغًا أكبر من صفر'
    return e
  }

  const applyApiErrors = (err: ApiError) => {
    const mapped: Errors<NewDraftKey> = {}
    for (const [field, messages] of Object.entries(err.errors)) {
      const key = (API_RESERVATION_FIELD_TO_FORM[field] ?? API_RESERVATION_FIELD_TO_FORM[field.split('.')[0]]) as NewDraftKey | undefined
      if (key && messages[0]) mapped[key] = messages[0]
    }
    if (Object.keys(mapped).length) {
      setErrors(mapped)
      shake()
    } else {
      toast.error('تعذّر حفظ الحجز', err.message)
    }
  }

  const save = async () => {
    const e = validate(draft)
    setErrors(e)
    if (Object.values(e).some(Boolean)) return shake()

    const input: ReservationInput = {
      clientId: Number(draft.clientId),
      unitId: draft.unitId ? Number(draft.unitId) : null,
      buildingId: draft.buildingId ? Number(draft.buildingId) : null,
      date: draft.date,
      firstPayment: draft.firstPayment,
    }
    setSaving(true)
    try {
      const reservation = await createReservation(input)
      toast.success(
        'تم إنشاء الحجز',
        `${reservation.client_name ?? ''} — ${codeOf(`r-${reservation.id}`)}` +
          (reservation.unit_name ? ` · الوحدة ${reservation.unit_name} أصبحت «محجوزة»` : ''),
      )
      setMode(null)
      setPage(0)
      reload()
      setOptionsKey((k) => k + 1)
    } catch (err) {
      if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      if (err instanceof ApiError) applyApiErrors(err)
      else toast.error('تعذّر حفظ الحجز', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const doCancel = async () => {
    if (!current) return
    if (!cancelReason.trim()) return
    setCancelling(true)
    try {
      await cancelReservation(current.id, cancelReason.trim())
      toast.success('تم إلغاء الحجز', `${codeOf(`r-${current.id}`)} — الوحدة عادت «متاحة»`)
      setCancelOpen(false)
      setCancelReason('')
      setMode(null)
      setCurrent(null)
      reload()
      setOptionsKey((k) => k + 1)
    } catch (err) {
      if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      toast.error('تعذّر إلغاء الحجز', err instanceof Error ? err.message : undefined)
    } finally {
      setCancelling(false)
    }
  }

  const addPayment = async () => {
    if (!current || payAmount == null || payAmount <= 0) return
    setPaying(true)
    try {
      await createReservationPayment(current.id, { amount: payAmount })
      toast.success('تم تسجيل الدفعة', `${fmtMoney(payAmount)} — ${codeOf(`r-${current.id}`)}`)
      setPayAmount(null)
      await refreshDetail(current.id)
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      toast.error('تعذّر تسجيل الدفعة', err instanceof Error ? err.message : undefined)
    } finally {
      setPaying(false)
    }
  }

  const doCancelPayment = async () => {
    if (!current || !paymentToCancel) return
    if (!paymentReason.trim()) return
    setCancellingPayment(true)
    try {
      await cancelReservationPayment(current.id, paymentToCancel.id, paymentReason.trim())
      toast.success('تم إلغاء الدفعة', fmtMoney(Number(paymentToCancel.amount)))
      setPaymentToCancel(null)
      setPaymentReason('')
      await refreshDetail(current.id)
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      toast.error('تعذّر إلغاء الدفعة', err instanceof Error ? err.message : undefined)
    } finally {
      setCancellingPayment(false)
    }
  }

  // ── Picker options ──────────────────────────────────────────────────────
  const clientOptions = useMemo(
    () =>
      clients.map((c) => ({
        value: String(c.id),
        label: c.name,
        description: c.phone ?? c.phone_2 ?? '',
      })),
    [clients],
  )

  const unitOptions = useMemo(
    () =>
      units.map((u) => ({
        value: String(u.id),
        label: `${u.building_name ?? ''} — ${u.name}`,
        description: [u.type_label, u.area ? `${Number(u.area).toLocaleString('ar-EG')} م²` : null, u.total_price ? fmtMoney(Number(u.total_price)) : null]
          .filter(Boolean)
          .join(' · '),
      })),
    [units],
  )

  const buildingOptions = useMemo(
    () =>
      buildings.map((b) => ({
        value: String(b.id),
        label: b.name,
        description: [b.city, b.district].filter(Boolean).join(' · '),
      })),
    [buildings],
  )

  const columns = useMemo<Column<ApiReservation>[]>(
    () => [
      {
        key: 'id',
        header: 'الحجز',
        width: '6rem',
        value: (r) => codeOf(`r-${r.id}`),
        cell: (r) => <span className="tabular-nums text-fg-2">{codeOf(`r-${r.id}`)}</span>,
      },
      {
        key: 'client',
        header: 'العميل',
        sortable: false,
        cell: (r) => <span className="font-semibold text-fg">{r.client_name ?? '—'}</span>,
      },
      {
        key: 'unit',
        header: 'الوحدة',
        sortable: false,
        cell: (r) =>
          r.unit_id ? (
            <div className="leading-tight">
              <span className="text-fg">{r.unit_name ?? `#${r.unit_id}`}</span>
              {r.building_name && <div className="t-caption mt-0.5 text-fg-3">{r.building_name}</div>}
            </div>
          ) : (
            <span className="text-fg-3">{r.building_name ? `على المبنى — ${r.building_name}` : '—'}</span>
          ),
      },
      {
        key: 'date',
        header: 'تاريخ الحجز',
        value: (r) => r.reservation_date,
        cell: (r) => <span className="tabular-nums">{dateOf(r.reservation_date)}</span>,
      },
      {
        key: 'deposit',
        header: 'المقدم المدفوع',
        align: 'end',
        sortable: false,
        csv: (r) => Number(r.deposit_paid),
        cell: (r) => <span className="tabular-nums">{fmtMoney(Number(r.deposit_paid))}</span>,
      },
      {
        key: 'status',
        header: 'الحالة',
        value: (r) => r.status_label ?? r.status,
        cell: (r) => <StatusChip status={r.status_label ?? 'نشط'} size="sm" />,
      },
    ],
    [],
  )

  const view = mode === 'view'
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

      <FilterChips
        label="تصفية حسب الحالة"
        options={FILTERS}
        value={filter}
        onChange={(next) => {
          setFilter(next)
          setPage(0)
        }}
      />

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => String(r.id)}
        caption="الحجوزات"
        loading={loading}
        title={
          <div className="flex items-center gap-2">
            <Btn iconStart={<IconPlus size={16} />} onClick={openNew}>
              حجز جديد
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
        searchPlaceholder="ابحث باسم العميل أو الوحدة أو المبنى…"
        exportName="الحجوزات"
        actionsWidth="8rem"
        onRowClick={openRecord}
        actions={(r) => (
          <div className="flex items-center gap-0.5">
            <IconBtn size="sm" icon={<IconEye size={16} />} label="عرض" onClick={() => openRecord(r)} />
            {r.status === 'active' && (
              <IconBtn
                size="sm"
                icon={<IconTrash size={16} />}
                label="إلغاء الحجز"
                variant="danger"
                onClick={() => {
                  setCurrent(r)
                  setCancelReason('')
                  setCancelOpen(true)
                }}
              />
            )}
          </div>
        )}
        emptyText={notLoaded ? 'لا توجد بيانات من الخادم.' : 'لا توجد حجوزات. ابدأ بحجز جديد.'}
      />

      {/* ── New reservation ─────────────────────────────────────────────── */}
      <Drawer
        open={mode === 'new'}
        onClose={() => !saving && setMode(null)}
        size="lg"
        icon={<IconCalendar size={20} />}
        title="حجز جديد"
        description="الحجز يربط عميلًا بوحدة (أو بمبنى)؛ لا سعر في الحجز والسعر يُتفق عليه في العقد."
        footer={
          <>
            <Btn variant="ghost" onClick={() => setMode(null)} disabled={saving}>
              إلغاء
            </Btn>
            <Btn type="submit" form="reservation-form" loading={saving}>
              حفظ
            </Btn>
          </>
        }
      >
        <form
          id="reservation-form"
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <FormGrid>
            <SectionTitle>بيانات الحجز</SectionTitle>
            <Combobox
              containerClassName="col-span-full"
              label="العميل"
              required
              placeholder="ابحث بالاسم أو الهاتف…"
              emptyText="لا يوجد عملاء — أضف عميلًا من صفحة العملاء أولًا"
              options={clientOptions}
              value={draft.clientId}
              error={errors.clientId}
              onChange={(v) => update({ clientId: v })}
            />
            <Combobox
              label="الوحدة"
              placeholder="ابحث بالمبنى أو اسم الوحدة…"
              emptyText="لا توجد وحدات متاحة وقابلة للبيع"
              hint={errors.unitId ? undefined : 'تُعرض الوحدات المتاحة والقابلة للبيع فقط.'}
              options={unitOptions}
              value={draft.unitId}
              error={errors.unitId}
              onChange={(v) => update({ unitId: v, ...(v ? { buildingId: null } : {}) })}
            />
            <Combobox
              label="المبنى"
              placeholder="ابحث باسم المبنى…"
              emptyText="لا توجد مبانٍ"
              hint={draft.unitId ? 'يُملأ تلقائيًا من الوحدة.' : 'للحجز على مستوى المبنى بدون وحدة.'}
              options={buildingOptions}
              value={draft.buildingId}
              error={errors.buildingId}
              disabled={Boolean(draft.unitId)}
              onChange={(v) => update({ buildingId: v, ...(v ? { unitId: null } : {}) })}
            />
            {errors.link && (
              <Text variant="caption" className="col-span-full text-danger" role="alert">
                {errors.link}
              </Text>
            )}
            <DatePicker
              label="تاريخ الحجز"
              required
              value={draft.date}
              error={errors.date}
              today={isoToday()}
              onChange={(v) => update({ date: v ?? isoToday() })}
            />
            <NumericInput
              label="دفعة أولى (اختياري)"
              suffix="ج.م"
              min={0}
              decimals={2}
              value={draft.firstPayment}
              error={errors.firstPayment}
              onChange={(v) => update({ firstPayment: v })}
            />
            <Text variant="caption" className="col-span-full text-fg-3">
              لا يوجد سعر للحجز: المقدم يُسجَّل كدفعة يمكن إلغاؤها، وباقي الدفعات تُضاف من التفاصيل.
            </Text>
          </FormGrid>
        </form>
      </Drawer>

      {/* ── Reservation details ─────────────────────────────────────────── */}
      <Drawer
        open={view && current !== null}
        onClose={() => setMode(null)}
        size="lg"
        icon={<IconCalendar size={20} />}
        title={current ? `${codeOf(`r-${current.id}`)} — ${current.client_name ?? ''}` : ''}
        description={current ? `حجز بتاريخ ${dateOf(current.reservation_date)}` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setMode(null)}>
              إغلاق
            </Btn>
            {current?.status === 'active' && (
              <Btn
                variant="danger"
                iconStart={<IconTrash size={16} />}
                onClick={() => {
                  setCancelReason('')
                  setCancelOpen(true)
                }}
              >
                إلغاء الحجز
              </Btn>
            )}
          </>
        }
      >
        {current && (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4 rounded-ctl border border-hairline px-4 py-3 sm:grid-cols-3">
              <InfoPair label="الوحدة" value={current.unit_name ?? '—'} strong />
              <InfoPair label="المبنى" value={current.building_name ?? '—'} />
              <InfoPair label="نوع الوحدة" value={unitTypeLabel(current.unit_type)} />
              <InfoPair label="تاريخ الحجز" value={dateOf(current.reservation_date)} />
              <InfoPair label="الحالة" value={<StatusChip status={current.status_label ?? 'نشط'} size="sm" />} />
              <InfoPair label="المقدم المدفوع" value={fmtMoney(Number(current.deposit_paid))} strong />
            </div>

            {current.status === 'cancelled' && current.cancellation_reason && (
              <div className="rounded-ctl border border-danger/40 bg-danger-soft px-4 py-2.5 t-caption text-fg-2">
                سبب الإلغاء: {current.cancellation_reason}
              </div>
            )}

            <SectionTitle>الدفعات</SectionTitle>
            {paymentsLoading ? (
              <Text variant="caption" className="text-fg-3">
                جارٍ تحميل الدفعات…
              </Text>
            ) : payments.length === 0 ? (
              <Text variant="caption" className="text-fg-3">
                لا توجد دفعات مسجّلة على هذا الحجز.
              </Text>
            ) : (
              <ul className="grid gap-2">
                {payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-hairline px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="tabular-nums font-semibold text-fg">{fmtMoney(Number(p.amount))}</span>
                      <span className="t-caption tabular-nums text-fg-3">{dateOf(p.paid_at)}</span>
                      <StatusChip status={p.status === 'valid' ? 'مدفوع' : 'ملغي'} size="sm" />
                      {p.cancel_reason && <span className="t-caption text-fg-3">— {p.cancel_reason}</span>}
                    </div>
                    {p.status === 'valid' && current.status === 'active' && (
                      <IconBtn
                        size="sm"
                        icon={<IconTrash size={16} />}
                        label="إلغاء الدفعة"
                        variant="danger"
                        onClick={() => {
                          setPaymentToCancel(p)
                          setPaymentReason('')
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {current.status === 'active' && (
              <form
                className="flex flex-wrap items-end gap-2"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault()
                  void addPayment()
                }}
              >
                <NumericInput
                  containerClassName="w-48"
                  label="دفعة جديدة"
                  suffix="ج.م"
                  min={0}
                  decimals={2}
                  value={payAmount}
                  onChange={setPayAmount}
                />
                <Btn type="submit" loading={paying} disabled={payAmount == null || payAmount <= 0}>
                  إضافة دفعة
                </Btn>
              </form>
            )}

            <Text variant="caption" className="text-fg-3">
              لا يوجد سعر على الحجز، فالمقدم هو مجموع الدفعات الصحيحة. تحويل الحجز إلى عقد يتم من شاشة العقود بعد
              ربطها بالخادم.
            </Text>
          </div>
        )}
      </Drawer>

      {/* ── Cancel reservation ──────────────────────────────────────────── */}
      <Modal
        open={cancelOpen}
        onClose={() => !cancelling && setCancelOpen(false)}
        size="sm"
        tone="danger"
        icon={<IconTrash size={20} />}
        title="إلغاء الحجز؟"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              تراجع
            </Btn>
            <Btn
              variant="danger"
              onClick={() => void doCancel()}
              loading={cancelling}
              disabled={!cancelReason.trim()}
            >
              إلغاء الحجز
            </Btn>
          </>
        }
      >
        <div className="grid gap-3">
          <Text variant="body">
            سيصبح الحجز «ملغيًا» وتعود الوحدة «متاحة». الدفعات المسجّلة تبقى كما هي.
          </Text>
          <Textarea
            label="سبب الإلغاء"
            required
            rows={2}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </div>
      </Modal>

      {/* ── Cancel payment ──────────────────────────────────────────────── */}
      <Modal
        open={paymentToCancel !== null}
        onClose={() => !cancellingPayment && setPaymentToCancel(null)}
        size="sm"
        tone="danger"
        icon={<IconTrash size={20} />}
        title="إلغاء الدفعة؟"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setPaymentToCancel(null)} disabled={cancellingPayment}>
              تراجع
            </Btn>
            <Btn
              variant="danger"
              onClick={() => void doCancelPayment()}
              loading={cancellingPayment}
              disabled={!paymentReason.trim()}
            >
              إلغاء الدفعة
            </Btn>
          </>
        }
      >
        <div className="grid gap-3">
          <Text variant="body">
            ستُلغى دفعة {paymentToCancel ? fmtMoney(Number(paymentToCancel.amount)) : ''} — السجل يبقى محفوظًا بسبب
            الإلغاء.
          </Text>
          <Textarea
            label="سبب الإلغاء"
            required
            rows={2}
            value={paymentReason}
            onChange={(e) => setPaymentReason(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  )
}
