import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import {
  useData,
  egp,
  fmtDate,
  type Client,
  type Contract,
  type ContractStatus,
  type ContractType,
  type ISODate,
  type ScheduleItem,
} from '@/lib'
import { addMonths, leaseEndDate, rentForYear, roundTo } from '@/lib/domain'
import { TODAY_ISO } from '@/lib/domain'
import {
  API_CONTRACT_FIELD_TO_FORM,
  ApiError,
  cancelContract,
  clearToken,
  CONTRACT_STATUS_FROM_API,
  createContract,
  fetchAllClients,
  fetchContract,
  fetchContracts,
  fetchReservableUnits,
  fetchReservations,
  fetchUnit,
  postContract,
  type ApiClient,
  type ApiContract,
  type ApiReservation,
  type ApiUnit,
  type ContractInput,
  type ContractScheduleInput,
  type PageMeta,
} from '@/lib/api'
import {
  Btn,
  Combobox,
  DataTable,
  DatePicker,
  FormFooter,
  GlassSurface,
  IconAlert,
  IconBtn,
  IconBuilding,
  IconCalendar,
  IconCheck,
  IconCheckCircle,
  IconChevronNext,
  IconDownload,
  IconEye,
  IconFile,
  IconLayers,
  IconPlus,
  IconTrash,
  IconWallet,
  Modal,
  NumericInput,
  SectionCard,
  StatusChip,
  TextInput,
  Textarea,
  exportCsv,
  useConfirm,
  useToast,
  useUnsaved,
  type Column,
  type SortState,
} from '@/kit'
import { Text } from '@/components/ui'
import { printDocument } from '@/kit/print'
import { shortcutLabel, useShortcutAction } from '@/kit/shortcuts'
import { ContractDoc } from './ContractDoc'
import {
  CONTRACT_TYPE_TONE,
  contractTypeLabel,
  FilterChips,
  InfoPair,
  ProjectBadge,
  REQUIRED,
  Segmented,
  useNewShortcut,
  useShake,
  type Errors,
} from './shared'
import { cn } from '@/lib/cn'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL } from '@/lib/codes'

/* ==================================================================
   Types & helpers
   ================================================================== */

/** DataTable column key → API `sort` parameter (columns without a server field aren't sortable). */
const SORT_FIELDS: Record<string, string> = {
  number: 'number',
  type: 'type',
  value: 'total_price',
  status: 'status',
  date: 'contract_date',
}

/** Debounce of the search box before it hits the API. */
const SEARCH_DELAY_MS = 350

/** 401/419 means the stored token is missing, revoked or expired. */
const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)

/** API money is a decimal string; `null`/missing is zero. */
const money = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** `2026-01-02T00:00:00…` → `2026-01-02` (what the form and the API's date fields expect). */
const day = (value: string | null | undefined): ISODate => (value ? value.slice(0, 10) : '')

const apiStatus = (value: ApiContract['status']): ContractStatus =>
  (CONTRACT_STATUS_FROM_API[value] ?? 'نشط') as ContractStatus

/** API contract → the printed document's shape (the demo model `ContractDoc` renders). */
function contractFromApi(c: ApiContract): Contract {
  const base = {
    id: String(c.id),
    number: c.number,
    reservationId: c.reservation_id ? String(c.reservation_id) : '',
    unitId: String(c.unit_id),
    clientId: String(c.client_id),
    date: day(c.contract_date),
    status: apiStatus(c.status),
    notes: c.notes ?? '',
  }
  if (c.type === 'rent') {
    return {
      ...base,
      type: 'إيجار',
      monthlyRent: money(c.monthly_rent),
      durationMonths: c.duration_months ?? 0,
      startDate: day(c.start_date) || base.date,
      endDate: day(c.end_date) || base.date,
      securityDeposit: money(c.security_deposit),
      advanceMonths: c.advance_months ?? 0,
      annualIncreasePct: money(c.annual_increase_pct),
      increaseFromYear: c.increase_from_year ?? 2,
    }
  }
  return {
    ...base,
    type: 'بيع',
    unitPrice: c.contract_value,
    downPayment: money(c.agreed_down_payment),
    ...(money(c.discount) > 0 && { discount: money(c.discount), discountReason: c.discount_reason ?? '' }),
  }
}

/** The printed document only needs the name and the address; the rest has no API field. */
function clientFromApi(c: ApiContract): Client {
  return {
    id: String(c.client_id),
    fullName: c.client_name ?? '—',
    type: c.type === 'rent' ? 'مستأجر' : 'مشتري',
    phone: c.client_phone ?? '',
    phone2: '',
    nationalId: '',
    address: '',
    notes: '',
  }
}

/** A contract's schedule: the installments once posted, the stored draft rows before that. */
function scheduleOf(c: ApiContract): ScheduleItem[] {
  if (c.status === 'draft') {
    return (c.draft_schedule ?? []).map((r) => ({
      dueDate: day(r.due_date),
      amount: money(r.amount),
      ...(r.is_down_payment && { isDownPayment: true }),
    }))
  }
  return [...(c.installments ?? [])]
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map((i) => ({ dueDate: day(i.due_date), amount: money(i.amount) }))
}

const unitLabelFor = (unit: ApiUnit | null, reservation: ApiReservation | null): string => {
  const type = unit?.type_label ?? null
  const name = unit?.name ?? reservation?.unit_name ?? null
  return [type, name].filter(Boolean).join(' ') || '—'
}

/* ---------- form model ---------- */

type ScheduleRow = { key: number; dueDate: ISODate | null; amount: number | null; paid?: number | null; isDownPayment?: boolean }

type Draft = {
  type: ContractType
  /** Sale: the active reservation the contract is created from. Lease: optional (a lease may start directly). */
  reservationId: string | null
  /** Lease only: picked directly when there is no reservation. */
  clientId: string | null
  unitId: string | null
  date: ISODate | null
  notes: string
  // sale
  unitPrice: number | null
  discount: number | null
  discountReason: string
  downPayment: number | null
  // lease
  monthlyRent: number | null
  durationMonths: number | null
  startDate: ISODate | null
  securityDeposit: number | null
  advanceMonths: number | null
  annualIncreasePct: number | null
  increaseFromYear: number | null
  // distribution
  distCount: number | null
  distInterval: number | null
  distFirst: ISODate | null
  schedule: ScheduleRow[]
}
type Key = keyof Draft

type Filter = 'الكل' | ContractType
const FILTERS: readonly Filter[] = ['الكل', 'بيع', 'إيجار']
const TYPES: readonly ContractType[] = ['بيع', 'إيجار']
const DURATION_CHIPS = [6, 12, 24] as const
const INTERVAL_CHIPS = [1, 2, 3, 6, 9, 12, 16, 19, 24] as const

let rowKey = 0
const newRow = (dueDate: ISODate | null = null, amount: number | null = null): ScheduleRow => ({ key: ++rowKey, dueDate, amount })

const emptyDraft = (type: ContractType = 'بيع'): Draft => ({
  type,
  reservationId: null,
  clientId: null,
  unitId: null,
  date: TODAY_ISO,
  notes: '',
  unitPrice: null,
  discount: null,
  discountReason: '',
  downPayment: null,
  monthlyRent: null,
  durationMonths: 12,
  startDate: TODAY_ISO,
  securityDeposit: null,
  advanceMonths: 0,
  annualIncreasePct: 10,
  increaseFromYear: 2,
  distCount: null,
  distInterval: 1,
  distFirst: null,
  schedule: [],
})

/** Rent due over the contract months `[from, to)`, applying the yearly increase month by month. */
function rentOverMonths(
  terms: { monthlyRent: number; annualIncreasePct: number; increaseFromYear: number },
  from: number,
  to: number,
) {
  let sum = 0
  for (let m = from; m < to; m++) sum += rentForYear(terms, Math.floor(m / 12) + 1)
  return sum
}

/** Sales: equal amounts, the last one absorbs the rounding. */
function equalSplit(total: number, count: number, interval: number, first: ISODate): ScheduleRow[] {
  const base = Math.floor(total / count)
  return Array.from({ length: count }, (_, i) =>
    newRow(addMonths(first, i * interval), i === count - 1 ? total - base * (count - 1) : base),
  )
}

/** Rentals: an advance row on the signing date, then rent × interval per installment with the increase applied. */
function rentDistribution(
  terms: { monthlyRent: number; durationMonths: number; advanceMonths: number; annualIncreasePct: number; increaseFromYear: number },
  signDate: ISODate,
  count: number,
  interval: number,
  first: ISODate,
): ScheduleRow[] {
  const rows: ScheduleRow[] = []
  const adv = Math.min(terms.advanceMonths, terms.durationMonths)
  if (adv > 0) rows.push(newRow(signDate, rentOverMonths(terms, 0, adv)))
  for (let j = 0; j < count; j++) {
    const from = adv + j * interval
    if (from >= terms.durationMonths) break
    const to = Math.min(terms.durationMonths, from + interval)
    rows.push(newRow(addMonths(first, j * interval), rentOverMonths(terms, from, to)))
  }
  return rows
}

/* ==================================================================
   Screen
   ================================================================== */

export default function Contracts() {
  const { logout } = useAuth()
  const { settings } = useData()
  const toast = useToast()

  // ── Server state ─────────────────────────────────────────────────────────
  const [rows, setRows] = useState<ApiContract[]>([])
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, last_page: 1, per_page: 15, total: 0, from: null, to: null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('الكل')
  const [sort, setSort] = useState<SortState>({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [postingId, setPostingId] = useState<number | null>(null)

  // ── View state ──────────────────────────────────────────────────────────
  const [view, setView] = useState<'list' | 'form' | 'details'>('list')
  const [formKey, setFormKey] = useState(0)
  const [detailsId, setDetailsId] = useState<number | null>(null)

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
    fetchContracts({
      search,
      type: filter === 'الكل' ? undefined : filter === 'بيع' ? 'sale' : 'rent',
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
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل العقود من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filter, page, sort, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  const lostSession = useCallback((notice: string) => {
    clearToken()
    setView('list')
    setDetailsId(null)
    setRows([])
  }, [])

  const openNew = () => {
    setFormKey((k) => k + 1)
    setView('form')
  }
  useNewShortcut(() => view === 'list' && openNew())

  const printContract = (c: ApiContract) => {
    void printDocument(
      <ContractDoc
        settings={settings}
        contract={contractFromApi(c)}
        client={clientFromApi(c)}
        buildingName={c.building_name ?? '—'}
        unitLabel={[c.unit_type_label, c.unit_name].filter(Boolean).join(' ') || '—'}
        schedule={scheduleOf(c)}
      />,
      `${contractTypeLabel(c.type === 'rent' ? 'إيجار' : 'بيع')}-${c.number}`,
    )
  }

  const post = async (c: ApiContract) => {
    setPostingId(c.id)
    try {
      const updated = await postContract(c.id, c.draft_schedule ?? undefined)
      toast.success(
        'تم ترحيل العقد',
        `${updated.number} — ${updated.installments_count} قسط وتحويل الوحدة إلى «${c.type === 'rent' ? 'مؤجرة' : 'مباعة'}»`,
      )
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      toast.error('تعذّر ترحيل العقد', err instanceof Error ? err.message : undefined)
    } finally {
      setPostingId(null)
    }
  }

  const columns = useMemo<Column<ApiContract>[]>(
    () => [
      {
        key: 'number',
        header: CODE_LABEL.contract,
        cell: (c) => <span className="font-semibold tabular-nums text-fg">{c.number}</span>,
      },
      serialColumn('contract', (c) => c.number),
      {
        key: 'type',
        header: 'النوع',
        value: (c) => (c.type === 'rent' ? 'إيجار' : 'بيع'),
        cell: (c) => (
          <StatusChip
            status={c.type === 'rent' ? 'إيجار' : 'بيع'}
            tone={CONTRACT_TYPE_TONE[c.type === 'rent' ? 'إيجار' : 'بيع']}
            size="sm"
          />
        ),
      },
      { key: 'client', header: 'العميل', sortable: false, value: (c) => c.client_name ?? '', cell: (c) => <span className="font-semibold text-fg">{c.client_name ?? '—'}</span> },
      {
        key: 'unit',
        header: 'الوحدة',
        sortable: false,
        value: (c) => `${c.building_name ?? ''} — ${c.unit_name ?? ''}`,
        cell: (c) => `${c.building_name ?? '—'} — ${c.unit_name ?? '—'}`,
      },
      {
        key: 'value',
        header: 'القيمة',
        align: 'end',
        cell: (c) => (
          <span className="tabular-nums">
            {egp(c.type === 'rent' ? money(c.monthly_rent) : c.contract_value)}
            {c.type === 'rent' && <span className="text-fg-3"> /شهر</span>}
          </span>
        ),
      },
      {
        key: 'paid',
        header: 'المسدد',
        align: 'end',
        sortable: false,
        value: (c) => c.paid_total,
        cell: (c) => <span className="tabular-nums text-success">{egp(c.paid_total)}</span>,
      },
      {
        key: 'remaining',
        header: 'المتبقي',
        align: 'end',
        sortable: false,
        value: (c) => c.remaining_total,
        // A cancelled contract is no longer collectable, so it has no "remaining".
        cell: (c) => <span className="tabular-nums">{c.status === 'cancelled' ? '—' : egp(c.remaining_total)}</span>,
      },
      {
        key: 'status',
        header: 'الحالة',
        value: (c) => CONTRACT_STATUS_FROM_API[c.status] ?? c.status,
        cell: (c) => <StatusChip status={CONTRACT_STATUS_FROM_API[c.status] ?? c.status} size="sm" />,
      },
      {
        key: 'date',
        header: 'التاريخ',
        value: (c) => day(c.contract_date),
        cell: (c) => <span className="tabular-nums">{fmtDate(day(c.contract_date))}</span>,
      },
    ],
    [],
  )

  // The type chips count from `meta.counts`, which the API computes before applying the type filter.
  const counts = useMemo<Record<Filter, number>>(
    () => ({
      الكل: meta.counts?.all ?? meta.total,
      بيع: meta.counts?.sale ?? 0,
      إيجار: meta.counts?.rent ?? 0,
    }),
    [meta],
  )

  const onFormDone = (created?: boolean) => {
    setView('list')
    if (created) {
      setSearchInput('')
      setSearch('')
      setFilter('الكل')
      setSort({ key: 'date', dir: 'desc' })
      setPage(0)
      reload()
    }
  }

  if (view === 'form') return <ContractForm key={formKey} onDone={onFormDone} onExpired={lostSession} />

  if (view === 'details' && detailsId != null)
    return (
      <ContractDetails
        contractId={detailsId}
        onBack={() => setView('list')}
        onChanged={reload}
        onExpired={lostSession}
      />
    )

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
        label="تصفية حسب نوع العقد"
        options={FILTERS}
        value={filter}
        onChange={(v) => {
          setFilter(v)
          setPage(0)
        }}
        counts={counts}
      />

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(c) => String(c.id)}
        caption="العقود"
        loading={loading}
        title={
          <div className="flex items-center gap-2">
            <Btn iconStart={<IconPlus size={16} />} onClick={openNew}>
              عقد جديد
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
        serverSort={{ value: sort, onChange: (s) => { setSort(s); setPage(0) } }}
        serverPagination={{
          page,
          pageCount: meta.last_page,
          total: meta.total,
          from: meta.from ?? 0,
          to: meta.to ?? 0,
          onChange: setPage,
        }}
        searchPlaceholder="ابحث برقم العقد أو العميل أو الوحدة…"
        exportName="العقود"
        actionsWidth="9rem"
        onRowClick={(c) => {
          setDetailsId(c.id)
          setView('details')
        }}
        actions={(c) => (
          <div className="flex items-center justify-end gap-1">
            {c.status === 'draft' && (
              <Btn size="sm" iconStart={<IconCheck size={14} />} loading={postingId === c.id} onClick={() => void post(c)}>
                ترحيل
              </Btn>
            )}
            <IconBtn size="sm" icon={<IconEye size={16} />} label={`تفاصيل ${c.number}`} onClick={() => { setDetailsId(c.id); setView('details') }} />
            <IconBtn size="sm" icon={<IconFile size={16} />} label={`طباعة ${c.number}`} onClick={() => printContract(c)} />
          </div>
        )}
        emptyText={filter === 'الكل' ? 'لا توجد عقود بعد.' : `لا توجد عقود ${filter}.`}
      />
    </div>
  )
}

/* ==================================================================
   Entry form
   ================================================================== */

function QuickChips({ options, value, onPick, label }: { options: readonly number[]; value: number | null; onPick: (n: number) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          onClick={() => onPick(n)}
          className={cn(
            'min-w-9 rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold tabular-nums transition',
            value === n ? 'border-primary bg-primary-soft text-primary' : 'border-hairline text-fg-2 hover:text-fg',
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

function ContractForm({ onDone, onExpired }: { onDone: (created?: boolean) => void; onExpired: (notice: string) => void }) {
  const { settings } = useData()
  const toast = useToast()
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [draft, setDraft] = useState<Draft>(() => emptyDraft())
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [scheduleErrors, setScheduleErrors] = useState<Record<number, { dueDate?: string; amount?: string }>>({})
  const [formRef, shake] = useShake<HTMLDivElement>()
  const { guard, prompt } = useUnsaved(dirty)

  // ── API: active reservations, clients and rentable units ─────────────────
  const [reservations, setReservations] = useState<ApiReservation[]>([])
  const [loadingReservations, setLoadingReservations] = useState(true)
  const [reservationsError, setReservationsError] = useState<string | null>(null)
  const [clients, setClients] = useState<ApiClient[]>([])
  const [rentUnits, setRentUnits] = useState<ApiUnit[]>([])
  const [loadingPickers, setLoadingPickers] = useState(false)
  const [pickersLoaded, setPickersLoaded] = useState(false)
  const [pickersError, setPickersError] = useState<string | null>(null)
  const [unit, setUnit] = useState<ApiUnit | null>(null)
  const [unitLoading, setUnitLoading] = useState(false)
  const [saving, setSaving] = useState<'draft' | 'post' | null>(null)

  useEffect(() => {
    let alive = true
    setLoadingReservations(true)
    setReservationsError(null)
    // Only active reservations that still hold a unit can become a contract.
    fetchReservations({ status: 'active', perPage: 100, sort: 'reservation_date', dir: 'desc' })
      .then((result) => {
        if (alive) setReservations(result.items.filter((r) => r.unit_id != null))
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (isAuthError(err)) return onExpired('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        setReservationsError(err instanceof Error ? err.message : 'تعذّر تحميل الحجوزات النشطة')
      })
      .finally(() => {
        if (alive) setLoadingReservations(false)
      })
    return () => {
      alive = false
    }
  }, [onExpired])

  const type = draft.type
  const lease = type === 'إيجار'

  const reservation = useMemo(
    () => reservations.find((r) => String(r.id) === draft.reservationId) ?? null,
    [reservations, draft.reservationId],
  )

  /**
   * The unit the contract is for: the lease picker's choice, or the reservation's unit.
   * Picking a reservation on a lease fills the client/unit pickers (and locks them).
   */
  const pickedUnitId = lease ? (reservation ? String(reservation.unit_id ?? '') : draft.unitId) : (reservation?.unit_id ? String(reservation.unit_id) : null)
  const pickedClientId = lease ? (reservation ? String(reservation.client_id) : draft.clientId) : (reservation ? String(reservation.client_id) : null)

  // Lease pickers load on demand: clients and the units that can be rented.
  useEffect(() => {
    if (!lease || pickersLoaded) return
    let alive = true
    setLoadingPickers(true)
    setPickersError(null)
    Promise.all([fetchAllClients(), fetchReservableUnits()])
      .then(([allClients, availableUnits]) => {
        if (!alive) return
        setClients(allClients)
        // A rent contract needs a unit that offers rent (purpose rent|both).
        setRentUnits(availableUnits.filter((u) => u.purpose !== 'sale'))
        setPickersLoaded(true)
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (isAuthError(err)) return onExpired('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        setPickersError(err instanceof Error ? err.message : 'تعذّر تحميل العملاء والوحدات')
      })
      .finally(() => {
        if (alive) setLoadingPickers(false)
      })
    return () => {
      alive = false
    }
  }, [lease, pickersLoaded, onExpired])

  // The picked unit is re-read from the API (type, purpose, area, sale price).
  const unitApiId = pickedUnitId ? Number(pickedUnitId) : null

  useEffect(() => {
    if (!unitApiId) {
      setUnit(null)
      return
    }
    let alive = true
    setUnitLoading(true)
    fetchUnit(unitApiId)
      .then((u) => {
        if (!alive) return
        setUnit(u)
        // A sale pre-fills the unit's list price unless the user already set one.
        if (u.total_price) {
          setDraft((d) => (d.type === 'بيع' && d.unitPrice == null ? { ...d, unitPrice: Number(u.total_price) } : d))
        }
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (isAuthError(err)) return onExpired('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        toast.error('تعذّر تحميل بيانات الوحدة', err instanceof Error ? err.message : undefined)
      })
      .finally(() => {
        if (alive) setUnitLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitApiId])

  const clientOptions = useMemo(
    () =>
      clients.map((c) => ({
        value: String(c.id),
        label: c.name,
        description: c.phone ?? '',
        keywords: [c.phone, c.phone_2, c.national_id].filter(Boolean).join(' '),
      })),
    [clients],
  )

  const rentUnitOptions = useMemo(() => {
    const options = rentUnits.map((u) => ({
      value: String(u.id),
      label: `${u.building_name ?? '—'} — ${u.name}`,
      description: [u.type_label, u.purpose_label, u.area ? `${money(u.area)} م²` : null].filter(Boolean).join(' · '),
      keywords: u.building_name ?? '',
    }))
    // A unit taken from a reservation is no longer «متاحة», so the list above may not contain it.
    const picked = pickedUnitId
    if (picked && !options.some((o) => o.value === picked)) {
      const known = unit && String(unit.id) === picked ? unit : null
      const label = known
        ? `${known.building_name ?? '—'} — ${known.name}`
        : `${reservation?.building_name ?? '—'} — ${reservation?.unit_name ?? picked}`
      options.unshift({ value: picked, label, description: 'الوحدة الحالية', keywords: '' })
    }
    return options
  }, [rentUnits, pickedUnitId, unit, reservation])

  const clientRecord = useMemo(
    () => (lease && draft.clientId ? (clients.find((c) => String(c.id) === draft.clientId) ?? null) : null),
    [clients, draft.clientId, lease],
  )
  const clientName = reservation?.client_name ?? clientRecord?.name ?? '—'

  const reservationOptions = useMemo(
    () =>
      reservations.map((r) => ({
        value: String(r.id),
        label: `${r.client_name ?? '—'} — ${r.building_name ?? ''} ${r.unit_name ?? ''}`.trim(),
        description: `حجز ${day(r.reservation_date)} · عربون ${egp(money(r.deposit_paid))}`,
        keywords: String(r.id),
      })),
    [reservations],
  )

  const buildingName = unit?.building_name ?? reservation?.building_name ?? '—'
  const unitLabel = unitLabelFor(unit, reservation)
  const depositPaid = money(reservation?.deposit_paid)

  // ── Sale ────────────────────────────────────────────────────────────────
  const listPrice = draft.unitPrice ?? 0
  const discount = draft.discount ?? 0
  /** Price after the company's discount: what the buyer owes and what every schedule is based on. */
  const price = Math.max(0, listPrice - discount)
  const down = draft.downPayment ?? 0
  const installmentsTotal = Math.max(0, price - down)

  // ── Lease ───────────────────────────────────────────────────────────────
  const leaseTerms = {
    monthlyRent: draft.monthlyRent ?? 0,
    durationMonths: Math.max(0, Math.floor(draft.durationMonths ?? 0)),
    startDate: draft.startDate ?? draft.date ?? TODAY_ISO,
    advanceMonths: Math.min(draft.advanceMonths ?? 0, draft.durationMonths ?? 0),
    annualIncreasePct: draft.annualIncreasePct ?? 0,
    increaseFromYear: draft.increaseFromYear ?? 2,
  }
  const rentTotal = rentOverMonths(leaseTerms, 0, leaseTerms.durationMonths)
  const endDate = leaseTerms.durationMonths > 0 && draft.startDate ? leaseEndDate(draft.startDate, leaseTerms.durationMonths) : null

  const required = lease ? rentTotal : installmentsTotal
  const downRows = draft.schedule.filter((r) => r.isDownPayment)
  const regularRows = draft.schedule.filter((r) => !r.isDownPayment)
  const orderedRows = [...downRows, ...regularRows]
  const scheduled = regularRows.reduce((s, r) => s + (r.amount ?? 0), 0)
  const remainingAfter = new Map<number, number>()
  {
    let run = 0
    for (const r of regularRows) {
      run += r.amount ?? 0
      remainingAfter.set(r.key, required - run)
    }
  }
  const diff = required - scheduled

  const interval = draft.distInterval && draft.distInterval > 0 ? draft.distInterval : 1
  const suggestedCount = lease
    ? Math.max(1, Math.ceil((leaseTerms.durationMonths - leaseTerms.advanceMonths) / interval))
    : Math.max(1, Math.min(12, installmentsTotal > 0 ? 12 : 1))
  const distCount = draft.distCount ?? suggestedCount
  const distFirst = draft.distFirst ?? (lease ? addMonths(leaseTerms.startDate, leaseTerms.advanceMonths) : addMonths(draft.date ?? TODAY_ISO, 1))

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setDirty(true)
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch) as Key[]) delete next[k]
      return next
    })
  }

  const changeType = (t: ContractType) => {
    if (t === type) return
    setDraft((d) => ({
      ...emptyDraft(t),
      date: d.date,
      notes: d.notes,
      reservationId: d.reservationId,
      // A lease keeps the reservation's client/unit in its own pickers; a sale always reads them from the reservation.
      clientId: t === 'إيجار' && reservation ? String(reservation.client_id) : null,
      unitId: t === 'إيجار' && reservation?.unit_id ? String(reservation.unit_id) : null,
      // A sale pre-fills the unit's list price; a lease's rent is always entered by hand.
      unitPrice: t === 'بيع' && unit?.total_price ? Number(unit.total_price) : null,
    }))
    setErrors({})
    setScheduleErrors({})
    setDirty(true)
  }

  const pickReservation = (id: string | null) => {
    const r = id ? reservations.find((x) => String(x.id) === id) : null
    setUnit(null)
    update({
      reservationId: id,
      // A lease can be started from a reservation too: the pickers follow it.
      ...(lease && { clientId: r ? String(r.client_id) : null, unitId: r?.unit_id ? String(r.unit_id) : null }),
      unitPrice: null,
      monthlyRent: null,
      securityDeposit: null,
      downPayment: null,
      schedule: [],
      distCount: null,
      distFirst: null,
    })
    setScheduleErrors({})
  }

  /** A lease without a reservation: pick the client and the unit directly. */
  const pickClient = (id: string | null) => update({ clientId: id })
  const pickUnit = (id: string | null) => update({ unitId: id })

  const setRow = (key: number, patch: Partial<ScheduleRow>) => {
    update({ schedule: draft.schedule.map((r) => (r.key === key ? { ...r, ...patch } : r)) })
    setScheduleErrors((e) => ({ ...e, [key]: {} }))
  }
  const addRow = () => {
    const last = draft.schedule.at(-1)?.dueDate
    update({ schedule: [...draft.schedule, newRow(last ? addMonths(last, interval) : null, diff > 0 ? diff : null)] })
  }
  const addDownPayment = () => update({ schedule: [...downRows, { ...newRow(draft.date ?? TODAY_ISO, null), isDownPayment: true }, ...regularRows] })
  const removeRow = async (key: number) => {
    const row = draft.schedule.find((r) => r.key === key)
    const ok = await confirm({
      title: row?.isDownPayment ? 'حذف المقدم؟' : 'حذف القسط؟',
      description: 'سيُحذف هذا السطر من جدول السداد.',
      details: [
        ['التاريخ', row?.dueDate ? fmtDate(row.dueDate) : '—'],
        ['المبلغ', row?.amount != null ? egp(row.amount) : '—'],
      ],
      confirmLabel: 'حذف',
    })
    if (ok) update({ schedule: draft.schedule.filter((r) => r.key !== key) })
  }

  const distribute = () => {
    const e: Errors<Key> = {}
    if (!draft.distInterval || draft.distInterval < 1) e.distInterval = 'أدخل عددًا صحيحًا'
    if (!distCount || distCount < 1 || distCount > 240) e.distCount = 'من 1 إلى 240'
    if (lease && (leaseTerms.monthlyRent <= 0 || leaseTerms.durationMonths < 1)) e.monthlyRent = 'أدخل الإيجار والمدة أولًا'
    if (!lease && installmentsTotal <= 0) e.downPayment = 'لا يوجد مبلغ للتقسيط'
    if (Object.keys(e).length) {
      setErrors((prev) => ({ ...prev, ...e }))
      return shake()
    }
    const rows = lease
      ? rentDistribution(leaseTerms, draft.date ?? TODAY_ISO, distCount, interval, distFirst)
      : equalSplit(installmentsTotal, distCount, interval, distFirst)
    update({ schedule: [...draft.schedule.filter((r) => r.isDownPayment), ...rows], distCount, distFirst })
    setScheduleErrors({})
  }

  /* ---------- validation ---------- */

  const validate = (forPost: boolean) => {
    const e: Errors<Key> = {}
    const se: Record<number, { dueDate?: string; amount?: string }> = {}
    if (!draft.date) e.date = REQUIRED

    // A sale always starts from a reservation; a lease can pick the client and unit directly.
    const hasSubject = lease ? Boolean(draft.clientId && draft.unitId) : Boolean(reservation)
    if (!hasSubject) {
      if (lease) {
        if (!draft.clientId) e.clientId = REQUIRED
        if (!draft.unitId) e.unitId = REQUIRED
      } else {
        e.reservationId = REQUIRED
      }
    }

    if (unit?.is_sellable === false) {
      if (lease) e.unitId = 'الوحدة غير قابلة للبيع أو الإيجار'
      else e.reservationId = 'الوحدة غير قابلة للبيع أو الإيجار'
    } else if (lease && unit?.purpose === 'sale') {
      e.unitId = 'الوحدة مخصّصة للبيع فقط — غيّر نوع العقد'
    } else if (!lease && unit?.purpose === 'rent') {
      e.reservationId = 'الوحدة مخصّصة للإيجار فقط — غيّر نوع العقد'
    }

    if (lease) {
      if (!draft.monthlyRent || draft.monthlyRent <= 0) e.monthlyRent = 'أدخل إيجارًا صحيحًا'
      if (!draft.durationMonths || draft.durationMonths < 1 || draft.durationMonths > 120) e.durationMonths = 'من 1 إلى 120 شهرًا'
      if (!draft.startDate) e.startDate = REQUIRED
      if (draft.securityDeposit != null && draft.securityDeposit < 0) e.securityDeposit = 'قيمة غير صحيحة'
      if (draft.advanceMonths != null && (draft.advanceMonths < 0 || draft.advanceMonths > (draft.durationMonths ?? 0))) e.advanceMonths = 'أكبر من مدة العقد'
      if (draft.annualIncreasePct != null && (draft.annualIncreasePct < 0 || draft.annualIncreasePct > 100)) e.annualIncreasePct = 'من 0 إلى 100٪'
      if (draft.increaseFromYear != null && draft.increaseFromYear < 1) e.increaseFromYear = 'قيمة غير صحيحة'
    } else {
      if (!draft.unitPrice || draft.unitPrice <= 0) e.unitPrice = 'أدخل سعرًا صحيحًا'
      if (draft.downPayment == null) e.downPayment = REQUIRED
      else if (draft.downPayment > price) e.downPayment = discount > 0 ? 'المقدم أكبر من السعر بعد الخصم' : 'المقدم أكبر من سعر الوحدة'
      else if (draft.downPayment < depositPaid) e.downPayment = `المقدم أقل من دفعات الحجز (${egp(depositPaid)})`
      if (draft.discount != null && draft.discount < 0) e.discount = 'قيمة غير صحيحة'
      else if (discount > listPrice) e.discount = 'الخصم أكبر من سعر الوحدة'
    }
    if (forPost) {
      if (required > 0 && draft.schedule.length === 0) e.schedule = 'وزّع الأقساط بزر «توزيع» أو أضف قسطًا واحدًا على الأقل'
      for (const r of draft.schedule) {
        const re: { dueDate?: string; amount?: string } = {}
        if (!r.dueDate) re.dueDate = REQUIRED
        if (!r.amount || r.amount <= 0) re.amount = 'مبلغ غير صحيح'
        if (re.dueDate || re.amount) se[r.key] = re
      }
    }
    setErrors(e)
    setScheduleErrors(se)
    const ok = !Object.values(e).some(Boolean) && Object.keys(se).length === 0
    if (!ok) {
      shake()
      toast.error('راجع الحقول المطلوبة', 'بعض البيانات ناقصة أو غير صحيحة.')
    }
    return ok
  }

  const items = (): ContractScheduleInput[] =>
    draft.schedule
      .filter((r) => r.dueDate && r.amount)
      .map((r) => ({
        due_date: r.dueDate!,
        amount: r.amount!,
        ...(r.isDownPayment && { is_down_payment: true }),
        ...(r.paid ? { paid_amount: Math.min(r.paid, r.amount!) } : {}),
      }))

  const buildInput = (status: 'draft' | 'active'): ContractInput => ({
    type: lease ? 'rent' : 'sale',
    status,
    reservationId: reservation?.id ?? null,
    clientId: Number(lease ? draft.clientId : reservation!.client_id),
    unitId: Number(lease ? draft.unitId : reservation!.unit_id),
    date: draft.date!,
    totalPrice: lease ? rentTotal : price,
    discount: !lease && discount > 0 ? discount : null,
    discountReason: !lease ? draft.discountReason.trim() : '',
    agreedDownPayment: lease ? null : down,
    monthlyRent: lease ? draft.monthlyRent : null,
    durationMonths: lease ? draft.durationMonths : null,
    startDate: lease ? draft.startDate : null,
    endDate: lease ? endDate : null,
    securityDeposit: lease ? (draft.securityDeposit ?? 0) : null,
    advanceMonths: lease ? (draft.advanceMonths ?? 0) : null,
    annualIncreasePct: lease ? draft.annualIncreasePct : null,
    increaseFromYear: lease ? draft.increaseFromYear : null,
    schedule: items(),
    notes: draft.notes.trim(),
  })

  const applyApiErrors = (err: ApiError) => {
    const mapped: Errors<Key> = {}
    for (const [field, messages] of Object.entries(err.errors)) {
      const key = (API_CONTRACT_FIELD_TO_FORM[field] ?? API_CONTRACT_FIELD_TO_FORM[field.split('.')[0]]) as Key | undefined
      if (key && messages[0]) mapped[key] = messages[0]
    }
    if (Object.keys(mapped).length) {
      setErrors(mapped)
      shake()
    } else {
      toast.error('تعذّر حفظ العقد', err.message)
    }
  }

  const submit = async (status: 'draft' | 'active') => {
    if (!draft.date || !pickedClientId || !unitApiId) return
    setSaving(status === 'draft' ? 'draft' : 'post')
    try {
      const created = await createContract(buildInput(status))
      setDirty(false)
      toast.success(
        status === 'draft' ? 'تم حفظ العقد كمسودة' : 'تم ترحيل العقد',
        status === 'draft'
          ? `${created.number} — ${reservation ? 'يبقى الحجز على الوحدة حتى الترحيل' : 'الوحدة لم تُشغل بعد' }`
          : `${created.number} — ${created.installments_count} قسط وتحويل الوحدة إلى «${lease ? 'مؤجرة' : 'مباعة'}»`,
      )
      if (status === 'active' && diff !== 0) toast.warning('تنبيه: إجمالي الأقساط لا يطابق المطلوب', `الفرق ${egp(Math.abs(diff))}`)
      // Let useUnsaved see the clean state before leaving.
      setTimeout(() => onDone(true), 0)
    } catch (err) {
      if (isAuthError(err)) return onExpired('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      if (err instanceof ApiError) applyApiErrors(err)
      else toast.error('تعذّر حفظ العقد', err instanceof Error ? err.message : undefined)
    } finally {
      setSaving(null)
    }
  }

  const saveDraft = () => {
    if (!validate(false)) return
    void submit('draft')
  }
  const post = () => {
    if (!validate(true)) return
    void submit('active')
  }

  /* ---------- preview & export ---------- */

  /** What the contract will look like, for the print preview (the number is assigned by the API). */
  const previewContract = (status: ContractStatus): Contract => {
    const base = {
      id: 'preview',
      number: 'جديد',
      reservationId: reservation ? String(reservation.id) : '',
      unitId: pickedUnitId ?? '',
      clientId: pickedClientId ?? '',
      date: draft.date ?? TODAY_ISO,
      status,
      notes: draft.notes.trim(),
    }
    if (lease)
      return {
        ...base,
        type: 'إيجار',
        ...leaseTerms,
        endDate: leaseEndDate(leaseTerms.startDate, leaseTerms.durationMonths),
        securityDeposit: draft.securityDeposit ?? 0,
      }
    return {
      ...base,
      type: 'بيع',
      unitPrice: price,
      downPayment: down,
      ...(discount > 0 && { discount, discountReason: draft.discountReason.trim() }),
    }
  }

  const previewClient: Client | null = pickedClientId
    ? {
        id: pickedClientId,
        fullName: clientName,
        type: lease ? 'مستأجر' : 'مشتري',
        phone: reservation ? '' : (clientRecord?.phone ?? ''),
        phone2: '',
        nationalId: '',
        address: '',
        notes: '',
      }
    : null

  const print = () => {
    if (!previewClient || !unitApiId) return toast.info('اختر العميل والوحدة أولًا', 'تُطبع بيانات العميل والوحدة من الاختيار.')
    void printDocument(
      <ContractDoc
        settings={settings}
        contract={previewContract('مسودة')}
        client={previewClient}
        buildingName={buildingName}
        unitLabel={unitLabel}
        schedule={draft.schedule.map((r) => ({ dueDate: r.dueDate ?? '', amount: r.amount ?? 0, ...(r.isDownPayment && { isDownPayment: true }) }))}
      />,
      `${contractTypeLabel(type)}-${pickedUnitId ?? ''}`,
    )
  }

  const exportSchedule = () =>
    exportCsv(
      `جدول-أقساط-${pickedUnitId ?? 'عقد'}`,
      ['#', 'تاريخ الاستحقاق', 'المبلغ'],
      draft.schedule.map((r) => [r.isDownPayment ? 'م' : regularRows.indexOf(r) + 1, r.dueDate ?? '', r.amount ?? 0]),
    )

  // Ctrl+S keeps a safe draft; posting stays an explicit click. Ctrl+P prints the contract.
  useShortcutAction('save', saveDraft)
  useShortcutAction('print', print)

  /* ---------- render ---------- */

  return (
    <div className="grid gap-4 pb-24" ref={formRef}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Btn variant="ghost" size="sm" iconStart={<IconChevronNext size={16} />} onClick={() => guard(() => onDone(false))}>
          رجوع
        </Btn>
        <ProjectBadge />
      </div>

      {reservationsError && (
        <div className="rounded-card border border-warning/40 bg-warning-soft px-4 py-2.5 t-caption text-fg-2">{reservationsError}</div>
      )}

      {/* 1. Type + reservation (sale) / client + unit (lease) */}
      <SectionCard
        title="نوع العقد والعميل"
        description={
          lease
            ? 'عقد الإيجار: اختر العميل والوحدة مباشرة، أو ابدأ من حجز نشط فيُعبَّأان منه'
            : 'يُنشأ عقد البيع من حجز نشط؛ العميل والوحدة يؤخذان منه، والسعر يُتفق عليه هنا'
        }
        icon={<IconCalendar size={20} />}
        columns={2}
      >
        <div className="grid gap-1.5 md:col-span-2">
          <span className="t-label">
            نوع العقد <span className="text-danger">*</span>
          </span>
          <Segmented label="نوع العقد" options={TYPES} value={type} onChange={changeType} />
        </div>

        <div className="md:col-span-2 flex items-start gap-2">
          {lease ? (
            <div className="grid w-full gap-3 md:grid-cols-3">
              <Combobox
                label="الحجز (اختياري)"
                placeholder={loadingReservations ? 'جارٍ تحميل الحجوزات…' : 'ابدأ من حجز نشط…'}
                options={reservationOptions}
                value={draft.reservationId}
                disabled={loadingReservations}
                clearable
                emptyText="لا توجد حجوزات نشطة — اختر العميل والوحدة مباشرة"
                onChange={(v) => pickReservation(v)}
              />
              <Combobox
                label="العميل"
                required
                placeholder={loadingPickers ? 'جارٍ تحميل العملاء…' : 'ابحث بالاسم أو الهاتف…'}
                options={clientOptions}
                value={draft.clientId}
                error={errors.clientId}
                disabled={Boolean(reservation) || loadingPickers}
                clearable
                emptyText="لا يوجد عملاء — أضِف عميلًا من صفحة العملاء"
                onChange={(v) => pickClient(v)}
              />
              <Combobox
                label="الوحدة"
                required
                placeholder={loadingPickers ? 'جارٍ تحميل الوحدات…' : 'ابحث بالمبنى أو رقم الوحدة…'}
                options={rentUnitOptions}
                value={draft.unitId}
                error={errors.unitId}
                disabled={Boolean(reservation) || loadingPickers}
                clearable
                emptyText="لا توجد وحدات متاحة للإيجار"
                onChange={(v) => pickUnit(v)}
              />
            </div>
          ) : (
            <>
              <Combobox
                containerClassName="min-w-0 flex-1"
                label="الحجز"
                required
                placeholder={loadingReservations ? 'جارٍ تحميل الحجوزات…' : 'ابحث باسم العميل أو الوحدة أو رقم الحجز…'}
                options={reservationOptions}
                value={draft.reservationId}
                error={errors.reservationId}
                disabled={loadingReservations}
                clearable
                emptyText={`لا توجد حجوزات نشطة${reservationsError ? '' : ' — أنشئ حجزًا من صفحة الحجوزات'}`}
                onChange={(v) => pickReservation(v)}
              />
              <Btn
                variant="glass"
                className="mt-[26px] shrink-0"
                iconStart={<IconPlus size={16} />}
                title="إنشاء حجز من صفحة الحجوزات"
                onClick={() => {
                  location.hash = '#/reservations'
                }}
              >
                حجز جديد
              </Btn>
            </>
          )}
        </div>

        {lease && reservation && (
          <p className="md:col-span-2 t-caption text-fg-3">
            عميل ووحدة الحجز تم تعبئتهما تلقائيًا — امسح الحجز أعلاه لاختيارهما مباشرة.
          </p>
        )}
        {pickersError && <p className="md:col-span-2 t-caption text-danger">{pickersError}</p>}

        {unit && (
          <>
            <TextInput label={lease ? 'المستأجر' : 'المشتري'} value={clientName} readOnly />
            <TextInput label="المبنى" value={buildingName} readOnly />
            <TextInput label="الوحدة" value={unitLoading ? '…' : unitLabel} readOnly />
            <TextInput
              label="نوع الوحدة والغرض"
              value={[unit.type_label, unit.purpose_label].filter(Boolean).join(' · ') || '—'}
              readOnly
            />
          </>
        )}

        {(reservation || unit) && (
          <div className="md:col-span-2 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-ctl border border-hairline bg-neutral-soft px-4 py-2.5 text-sm">
            {reservation && <InfoPair label="تاريخ الحجز" value={fmtDate(day(reservation.reservation_date))} />}
            {reservation && <InfoPair label="العربون المدفوع" value={egp(depositPaid)} tone={depositPaid > 0 ? 'text-success' : undefined} />}
            {!lease && <InfoPair label="سعر الوحدة المعروض" value={unit?.total_price ? egp(money(unit.total_price)) : '—'} />}
            {unit && <InfoPair label="المساحة" value={`${money(unit.area)} م²`} />}
            {lease && clientRecord?.phone && <InfoPair label="هاتف المستأجر" value={clientRecord.phone} ltr />}
          </div>
        )}
      </SectionCard>

      {/* 2. Header */}
      <SectionCard title="بيانات العقد" icon={<IconFile size={20} />} columns={2}>
        <TextInput label="رقم العقد" value="يُولَّد عند الحفظ" readOnly hint={`تلقائيًا (${lease ? 'سنوي' : 'سنوي'})`} />
        <DatePicker label="تاريخ العقد" required value={draft.date} error={errors.date} onChange={(v) => update({ date: v })} today={TODAY_ISO} />
      </SectionCard>

      {/* 3. Financial terms */}
      {lease ? (
        <SectionCard title="شروط الإيجار" icon={<IconWallet size={20} />} columns={2}>
          <DatePicker label="تاريخ البداية" required value={draft.startDate} error={errors.startDate} onChange={(v) => update({ startDate: v })} today={TODAY_ISO} />
          <div className="grid content-start gap-2">
            <NumericInput
              label="مدة العقد بالشهور"
              required
              suffix="شهر"
              min={1}
              max={120}
              value={draft.durationMonths}
              error={errors.durationMonths}
              onChange={(v) => update({ durationMonths: v })}
            />
            <QuickChips label="مدد جاهزة" options={DURATION_CHIPS} value={draft.durationMonths} onPick={(n) => update({ durationMonths: n })} />
          </div>
          <TextInput label="تاريخ النهاية" value={endDate ? fmtDate(endDate) : '—'} readOnly hint="يُحسب تلقائيًا من البداية والمدة" />
          <NumericInput
            label="الإيجار الشهري"
            required
            suffix="ج.م"
            min={0}
            value={draft.monthlyRent}
            error={errors.monthlyRent}
            onChange={(v) => update({ monthlyRent: v })}
          />
          <NumericInput
            label="مبلغ التأمين"
            suffix="ج.م"
            min={0}
            value={draft.securityDeposit}
            error={errors.securityDeposit}
            hint="مسترد؛ يُحصَّل عند التوقيع ولا يدخل في إجمالي العقد"
            onChange={(v) => update({ securityDeposit: v })}
          />
          <NumericInput
            label="عدد الأشهر المقدمة"
            suffix="شهر"
            min={0}
            stepper
            value={draft.advanceMonths}
            error={errors.advanceMonths}
            hint="تظهر كأول قسط مستحق في تاريخ العقد"
            onChange={(v) => update({ advanceMonths: v })}
          />
          <NumericInput label="نسبة الزيادة السنوية" suffix="٪" min={0} max={100} value={draft.annualIncreasePct} error={errors.annualIncreasePct} onChange={(v) => update({ annualIncreasePct: v })} />
          <NumericInput label="من السنة رقم" min={1} stepper value={draft.increaseFromYear} error={errors.increaseFromYear} onChange={(v) => update({ increaseFromYear: v })} />
          <TextInput containerClassName="md:col-span-2" label="إجمالي العقد" value={egp(rentTotal)} readOnly hint="مجموع الإيجار طوال المدة شاملًا الزيادات السنوية" />
          <Textarea containerClassName="md:col-span-2" label="ملاحظات (اختياري)" rows={2} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
        </SectionCard>
      ) : (
        <SectionCard title="الشروط المالية" icon={<IconWallet size={20} />} columns={2}>
          <NumericInput
            label="سعر الوحدة"
            required
            suffix="ج.م"
            min={0}
            value={draft.unitPrice}
            error={errors.unitPrice}
            hint={unit?.total_price && draft.unitPrice !== money(unit.total_price) ? `السعر المعروض ${egp(money(unit.total_price))}` : undefined}
            onChange={(v) => update({ unitPrice: v })}
          />
          <NumericInput
            label="خصم من الشركة"
            suffix="ج.م"
            min={0}
            value={draft.discount}
            error={errors.discount}
            hint="اختياري — مبلغ تتنازل عنه الشركة لهذا العميل برغبتها (دفعة كبيرة، سداد نقدي، صلة قرابة ...)"
            onChange={(v) => update({ discount: v })}
          />
          <TextInput
            label="سبب الخصم"
            value={draft.discountReason}
            disabled={discount <= 0}
            placeholder={discount > 0 ? 'مثال: سداد نقدي، دفعة كبيرة، صلة قرابة' : 'يُفعَّل عند إدخال خصم'}
            onChange={(e) => update({ discountReason: e.target.value })}
          />
          {discount > 0 && (
            <TextInput
              containerClassName="md:col-span-2"
              label="السعر بعد الخصم"
              value={egp(price)}
              readOnly
              hint={`${egp(listPrice)} − ${egp(discount)}${listPrice > 0 ? ` (${Math.round((discount / listPrice) * 1000) / 10}٪)` : ''}`}
            />
          )}
          <NumericInput label="مبلغ المقدم" required suffix="ج.م" min={0} value={draft.downPayment} error={errors.downPayment} onChange={(v) => update({ downPayment: v })} />
          <TextInput label="باقي المقدم" value={egp(down)} readOnly hint="يُسدَّد من إيصالات القبض بعد الترحيل" />
          <TextInput label="إجمالي الأقساط" value={egp(installmentsTotal)} readOnly hint={discount > 0 ? 'السعر بعد الخصم − المقدم' : 'سعر الوحدة − المقدم'} />
          <Textarea containerClassName="md:col-span-2" label="ملاحظات (اختياري)" rows={2} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
        </SectionCard>
      )}

      {/* 4. Distribution */}
      <SectionCard
        title="توزيع الأقساط"
        description={
          lease
            ? 'كل قسط = الإيجار الشهري × عدد الأشهر مع تطبيق الزيادة السنوية، والأشهر المقدمة قسط أول في تاريخ العقد'
            : 'يقسّم المطلوب (السعر − المقدم) إلى أقساط متساوية والأخير يتحمل الفرق؛ ثم عدّل ما تشاء'
        }
        icon={<IconLayers size={20} />}
        columns={3}
      >
        <NumericInput label="عدد الأقساط" min={1} max={240} value={draft.distCount ?? distCount} error={errors.distCount} onChange={(v) => update({ distCount: v })} />
        <div className="grid content-start gap-2">
          <NumericInput label="التسديد كل … شهر" suffix="شهر" min={1} max={120} value={draft.distInterval} error={errors.distInterval} onChange={(v) => update({ distInterval: v })} />
          <QuickChips label="فترات جاهزة" options={INTERVAL_CHIPS} value={draft.distInterval} onPick={(n) => update({ distInterval: n })} />
        </div>
        <DatePicker label="تاريخ أول قسط" value={distFirst} onChange={(v) => update({ distFirst: v })} today={TODAY_ISO} />
        <div className="md:col-span-3 flex flex-wrap items-center gap-3">
          <Btn iconStart={<IconLayers size={16} />} onClick={distribute}>
            توزيع
          </Btn>
          {draft.schedule.length > 0 && <span className="t-caption text-warning">سيتم استبدال الأقساط الحالية.</span>}
        </div>
      </SectionCard>

      {/* 5. Schedule */}
      <SectionCard
        title="جدول الأقساط"
        description="قابل للتعديل بالكامل: أضف أو احذف أو غيّر أي تاريخ أو مبلغ"
        icon={<IconBuilding size={20} />}
        actions={
          <>
            <Btn variant="glass" size="sm" iconStart={<IconPlus size={16} />} onClick={addRow}>
              إضافة قسط
            </Btn>
            {!lease && (
              <Btn variant="glass" size="sm" iconStart={<IconWallet size={16} />} onClick={addDownPayment}>
                إضافة مقدم
              </Btn>
            )}
            <Btn variant="glass" size="sm" iconStart={<IconDownload size={16} />} disabled={draft.schedule.length === 0} onClick={exportSchedule}>
              تصدير CSV
            </Btn>
          </>
        }
      >
        <ScheduleBar scheduled={scheduled} required={required} />

        {errors.schedule && (
          <p role="alert" className="t-caption flex items-center gap-1 text-danger">
            <IconAlert size={13} /> {errors.schedule}
          </p>
        )}

        {draft.schedule.length === 0 ? (
          <div className="rounded-ctl border border-dashed border-hairline px-4 py-10 text-center text-fg-2">
            لا توجد أقساط بعد. استخدم «توزيع» أو «إضافة قسط».
          </div>
        ) : (
          <div className="kit-table-scroll max-h-[60vh]">
            <table className="kit-table min-w-[48rem]" data-plain>
              <thead>
                <tr>
                  <th className="w-12 px-1.5 py-2.5 text-center font-bold">#</th>
                  <th className="px-1.5 py-2.5 text-start font-bold">تاريخ الاستحقاق</th>
                  <th className="px-1.5 py-2.5 text-start font-bold">المبلغ</th>
                  <th className="px-1.5 py-2.5 text-start font-bold">المدفوع</th>
                  <th className="px-1.5 py-2.5 text-start font-bold">متبقي القسط</th>
                  <th className="px-1.5 py-2.5 text-start font-bold">المتبقي</th>
                  <th className="w-12 px-1.5 py-2.5" aria-label="حذف" />
                </tr>
              </thead>
              <tbody>
                {orderedRows.map((r, idx) => (
                  <tr
                    key={r.key}
                    className={cn('align-top', r.isDownPayment && '[&>td]:bg-warning-soft', r.isDownPayment && idx === downRows.length - 1 && regularRows.length > 0 && '[&>td]:border-b-2 [&>td]:border-b-warning/60')}
                  >
                    <td className="px-1.5 py-3 text-center tabular-nums text-fg-2">
                      {r.isDownPayment ? (
                        <span className="inline-block rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning">مقدم</span>
                      ) : (
                        regularRows.indexOf(r) + 1
                      )}
                    </td>
                    <td className="px-1.5 py-2">
                      <DatePicker aria-label={r.isDownPayment ? 'تاريخ المقدم' : `تاريخ القسط ${regularRows.indexOf(r) + 1}`} value={r.dueDate} error={scheduleErrors[r.key]?.dueDate} onChange={(v) => setRow(r.key, { dueDate: v })} today={TODAY_ISO} />
                    </td>
                    <td className="px-1.5 py-2">
                      <NumericInput aria-label={r.isDownPayment ? 'مبلغ المقدم' : `مبلغ القسط ${regularRows.indexOf(r) + 1}`} suffix="ج.م" min={0} value={r.amount} error={scheduleErrors[r.key]?.amount} onChange={(v) => setRow(r.key, { amount: v })} />
                    </td>
                    <td className="px-1.5 py-2">
                      <NumericInput aria-label={r.isDownPayment ? 'المدفوع من المقدم' : `المدفوع من القسط ${regularRows.indexOf(r) + 1}`} suffix="ج.م" min={0} max={r.amount ?? undefined} value={r.paid ?? null} onChange={(v) => setRow(r.key, { paid: v })} />
                    </td>
                    <td className="px-1.5 py-3">
                      <PaidBox amount={r.amount ?? 0} paid={r.paid ?? 0} />
                    </td>
                    <td className="px-1.5 py-3">
                      <RemainingBox value={r.isDownPayment ? null : (remainingAfter.get(r.key) ?? 0)} />
                    </td>
                    <td className="px-1.5 py-2">
                      <IconBtn size="sm" icon={<IconTrash size={16} />} label={r.isDownPayment ? 'حذف المقدم' : `حذف القسط ${regularRows.indexOf(r) + 1}`} className="text-danger" onClick={() => void removeRow(r.key)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <FormFooter
        dirty={dirty}
        saving={saving !== null}
        onSave={post}
        saveLabel="ترحيل العقد"
        onCancel={() => guard(() => onDone(false))}
        cancelLabel="إلغاء"
      >
        <Btn variant="glass" onClick={print} aria-keyshortcuts="Control+P Meta+P" title={`طباعة العقد (${shortcutLabel('P')})`}>
          طباعة العقد
        </Btn>
        <Btn variant="glass" loading={saving === 'draft'} onClick={saveDraft} aria-keyshortcuts="Control+S Meta+S" title={`حفظ كمسودة (${shortcutLabel('S')})`}>
          حفظ كمسودة
        </Btn>
      </FormFooter>

      {prompt}
      {confirmDialog}
    </div>
  )
}

/* ==================================================================
   API details view
   ================================================================== */

const TH = 'px-3 py-2.5 text-start font-bold'
const TH_END = 'px-3 py-2.5 text-end font-bold'

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <GlassSurface padding="md" className="grid gap-1">
      <Text variant="label" className="text-fg-2">
        {label}
      </Text>
      <span className={`text-lg font-extrabold tabular-nums ${tone ?? 'text-fg'}`}>{value}</span>
    </GlassSurface>
  )
}

function ContractDetails({
  contractId,
  onBack,
  onChanged,
  onExpired,
}: {
  contractId: number
  onBack: () => void
  onChanged: () => void
  onExpired: (notice: string) => void
}) {
  const { settings } = useData()
  const toast = useToast()
  const [data, setData] = useState<ApiContract | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [posting, setPosting] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchContract(contractId)
      .then((c) => {
        if (alive) setData(c)
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (isAuthError(err)) return onExpired('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل العقد من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [contractId, reloadKey, onExpired])

  const reload = () => setReloadKey((k) => k + 1)

  const print = () => {
    if (!data) return
    void printDocument(
      <ContractDoc
        settings={settings}
        contract={contractFromApi(data)}
        client={clientFromApi(data)}
        buildingName={data.building_name ?? '—'}
        unitLabel={[data.unit_type_label, data.unit_name].filter(Boolean).join(' ') || '—'}
        schedule={scheduleOf(data)}
      />,
      `${contractTypeLabel(data.type === 'rent' ? 'إيجار' : 'بيع')}-${data.number}`,
    )
  }

  const post = async () => {
    if (!data) return
    setPosting(true)
    try {
      const updated = await postContract(data.id, data.draft_schedule ?? undefined)
      toast.success('تم ترحيل العقد', `${updated.number} — ${updated.installments_count} قسط`)
      reload()
      onChanged()
    } catch (err) {
      if (isAuthError(err)) return onExpired('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      toast.error('تعذّر ترحيل العقد', err instanceof Error ? err.message : undefined)
    } finally {
      setPosting(false)
    }
  }

  const doCancel = async () => {
    if (!data || !reason.trim()) return
    setCancelling(true)
    try {
      await cancelContract(data.id, reason.trim())
      toast.success(
        'تم إلغاء العقد',
        data.status === 'draft' ? `${data.number} — أُلغيت المسودة` : `${data.number} — الوحدة عادت «متاحة»`,
      )
      setCancelOpen(false)
      setReason('')
      reload()
      onChanged()
    } catch (err) {
      if (isAuthError(err)) return onExpired('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      toast.error('تعذّر إلغاء العقد', err instanceof Error ? err.message : undefined)
    } finally {
      setCancelling(false)
    }
  }

  const back = (
    <Btn variant="ghost" size="sm" iconStart={<IconChevronNext size={16} />} onClick={onBack}>
      رجوع
    </Btn>
  )

  if (loading && !data)
    return (
      <div className="grid gap-4">
        {back}
        <div className="rounded-ctl border border-hairline px-4 py-10 text-center text-fg-2">جارٍ تحميل العقد…</div>
      </div>
    )

  if (!data)
    return (
      <div className="grid gap-4">
        {back}
        {loadError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warning/40 bg-warning-soft px-4 py-2.5 t-caption text-fg-2">
            <span>{loadError}</span>
            <Btn size="sm" variant="glass" onClick={reload}>
              إعادة المحاولة
            </Btn>
          </div>
        )}
      </div>
    )

  const lease = data.type === 'rent'
  const draft = data.status === 'draft'
  const active = data.status === 'active'
  const canCancel = draft || active
  const value = data.contract_value
  const down = money(data.agreed_down_payment)
  const installments = [...(data.installments ?? [])].sort((a, b) => a.sequence_number - b.sequence_number)

  return (
    <div className="grid gap-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        <ProjectBadge />
      </div>

      {loadError && (
        <div className="rounded-card border border-warning/40 bg-warning-soft px-4 py-2.5 t-caption text-fg-2">{loadError}</div>
      )}

      {/* Header */}
      <GlassSurface variant="strong" padding="md" className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="grid gap-1">
          <Text variant="caption">{CODE_LABEL.contract}</Text>
          <span className="text-2xl font-extrabold tabular-nums">{data.number}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="grid gap-1">
            <Text variant="caption">النوع</Text>
            <StatusChip status={lease ? 'إيجار' : 'بيع'} tone={CONTRACT_TYPE_TONE[lease ? 'إيجار' : 'بيع']} size="sm" />
          </div>
          <div className="grid gap-1">
            <Text variant="caption">الحالة</Text>
            <StatusChip status={apiStatus(data.status)} size="sm" />
          </div>
          <InfoPair label="المشروع" value={settings.projectName.trim() || 'غير محدد'} />
          <InfoPair label="التاريخ" value={fmtDate(day(data.contract_date))} />
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Btn variant="glass" iconStart={<IconFile size={16} />} onClick={print}>
            طباعة العقد
          </Btn>
          {draft && (
            <Btn iconStart={<IconCheck size={16} />} loading={posting} onClick={() => void post()}>
              ترحيل العقد
            </Btn>
          )}
          {canCancel && (
            <Btn variant="danger" iconStart={<IconTrash size={16} />} onClick={() => setCancelOpen(true)}>
              إلغاء العقد
            </Btn>
          )}
        </div>
      </GlassSurface>

      {data.status === 'cancelled' && (
        <div className="rounded-ctl border border-danger/40 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">
          العقد ملغي{data.cancelled_at ? ` بتاريخ ${fmtDate(day(data.cancelled_at))}` : ''}
          {data.cancellation_reason ? ` — السبب: ${data.cancellation_reason}` : ''}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="العميل" description={lease ? 'المستأجر' : 'المشتري'}>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <InfoPair label="الاسم" value={data.client_name ?? '—'} strong />
            <InfoPair label="الهاتف" value={data.client_phone || '—'} ltr />
            <InfoPair label="رقم الحجز" value={data.reservation_id ? `#${data.reservation_id}` : '—'} />
          </div>
        </SectionCard>
        <SectionCard title="الوحدة">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <InfoPair label="المبنى" value={data.building_name ?? '—'} strong />
            <InfoPair label="الوحدة" value={[data.unit_type_label, data.unit_name].filter(Boolean).join(' ') || '—'} />
            <InfoPair label="المساحة" value={data.unit_area ? `${money(data.unit_area)} م²` : '—'} />
            {/* A lease has no per-meter price: the rent is the agreement. */}
            {!lease && (
              <InfoPair
                label="سعر المتر"
                value={data.unit_area ? egp(Math.round(value / money(data.unit_area))) : '—'}
              />
            )}
          </div>
        </SectionCard>
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        {lease ? (
          <>
            <Stat label="الإيجار الشهري" value={egp(money(data.monthly_rent))} />
            <Stat label="التأمين" value={egp(money(data.security_deposit))} />
            <Stat label="المدة" value={`${data.duration_months ?? 0} شهر`} />
            <Stat label="تاريخ البداية" value={fmtDate(day(data.start_date))} />
            <Stat label="تاريخ النهاية" value={fmtDate(day(data.end_date))} />
            <Stat
              label="الزيادة السنوية"
              value={money(data.annual_increase_pct) > 0 ? `${money(data.annual_increase_pct)}٪ من السنة ${data.increase_from_year ?? 2}` : 'بدون'}
            />
            <Stat label="إجمالي العقد" value={egp(value)} />
          </>
        ) : (
          <>
            <Stat label="سعر الوحدة" value={egp(value + money(data.discount))} />
            {money(data.discount) > 0 && <Stat label="الخصم" value={egp(money(data.discount))} tone="text-success" />}
            {money(data.discount) > 0 && <Stat label="السعر بعد الخصم" value={egp(value)} />}
            <Stat label="المقدم" value={egp(down)} />
            <Stat label="المسدد من المقدم" value={egp(money(data.paid_down_payment))} tone="text-success" />
            <Stat label="إجمالي الأقساط" value={egp(Math.max(0, value - down))} />
          </>
        )}
        <Stat label="المسدد" value={egp(data.paid_total)} tone="text-success" />
        <Stat
          label="المتبقي"
          value={data.status === 'cancelled' ? '—' : egp(data.remaining_total)}
          tone={data.status === 'cancelled' ? 'text-fg-3' : 'text-danger'}
        />
      </div>

      {data.discount_reason && money(data.discount) > 0 && (
        <div className="rounded-ctl border border-hairline bg-neutral-soft px-4 py-2.5 t-caption text-fg-2">
          سبب الخصم: {data.discount_reason}
        </div>
      )}

      {/* Draft schedule */}
      {draft && (
        <SectionCard title="جدول المسودة" description={`${(data.draft_schedule ?? []).length} سطر`}>
          {(data.draft_schedule ?? []).length === 0 ? (
            <div className="rounded-ctl border border-dashed border-hairline px-4 py-8 text-center text-fg-2">المسودة بلا جدول سداد.</div>
          ) : (
            <div className="kit-table-scroll max-h-[60vh]">
              <table className="kit-table min-w-[34rem]" data-plain>
                <thead>
                  <tr>
                    <th className="w-12 px-3 py-2.5 text-center font-bold">#</th>
                    <th className={TH}>تاريخ الاستحقاق</th>
                    <th className={TH_END}>المبلغ</th>
                    <th className={TH_END}>المدفوع</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.draft_schedule ?? []).map((r, i) => (
                    <tr key={i} className={r.is_down_payment ? '[&>td]:bg-warning-soft' : undefined}>
                      <td className="px-3 py-2.5 text-center tabular-nums text-fg-2">{r.is_down_payment ? 'مقدم' : i + 1}</td>
                      <td className="px-3 py-2.5 tabular-nums">{fmtDate(day(r.due_date))}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{egp(money(r.amount))}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-success">{egp(money(r.paid_amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Installments */}
      <SectionCard title="جدول الأقساط" description={`${installments.length} قسط`}>
        {installments.length === 0 ? (
          <div className="rounded-ctl border border-dashed border-hairline px-4 py-8 text-center text-fg-2">
            {draft ? 'لا توجد أقساط (العقد لم يُرحَّل بعد).' : 'لا توجد أقساط على هذا العقد.'}
          </div>
        ) : (
          <div className="kit-table-scroll max-h-[60vh]">
            <table className="kit-table min-w-[38rem]" data-plain>
              <thead>
                <tr>
                  <th className="w-12 px-3 py-2.5 text-center font-bold">#</th>
                  <th className={TH}>تاريخ الاستحقاق</th>
                  <th className={TH_END}>القيمة</th>
                  <th className={TH_END}>المسدد</th>
                  <th className={TH_END}>متبقي سداد القسط</th>
                  <th className={TH}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((r) => {
                  const overdue = r.is_overdue && money(r.remaining) > 0
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5 text-center tabular-nums text-fg-2">{r.sequence_number}</td>
                      <td className="px-3 py-2.5 tabular-nums">{fmtDate(day(r.due_date))}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{egp(money(r.amount))}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums text-success">{egp(money(r.paid_amount))}</td>
                      <td className="px-3 py-2.5 text-end tabular-nums">{egp(money(r.remaining))}</td>
                      <td className="px-3 py-2.5">
                        <StatusChip status={overdue ? 'متأخر' : (r.status_label ?? 'معلق')} size="sm" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {data.notes && (
        <SectionCard title="ملاحظات">
          <p className="whitespace-pre-wrap text-sm text-fg-2">{data.notes}</p>
        </SectionCard>
      )}

      <Modal
        open={cancelOpen}
        onClose={() => !cancelling && setCancelOpen(false)}
        size="sm"
        tone="danger"
        icon={<IconTrash size={20} />}
        title="إلغاء العقد؟"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              تراجع
            </Btn>
            <Btn variant="danger" onClick={() => void doCancel()} loading={cancelling} disabled={!reason.trim()}>
              إلغاء العقد
            </Btn>
          </>
        }
      >
        <div className="grid gap-3">
          <Text variant="body">
            {draft
              ? 'ستُلغى المسودة؛ الحجز يبقى على الوحدة كما هو.'
              : 'سيصبح العقد «ملغيًا» وتعود الوحدة «متاحة». الدفعات المسجّلة تبقى كما هي.'}
          </Text>
          <Textarea label="سبب الإلغاء" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </div>
  )
}

/* ==================================================================
   Pieces
   ================================================================== */

function RemainingBox({ value }: { value: number | null }) {
  const tone =
    value === null
      ? 'border-hairline bg-neutral-soft text-fg-3'
      : value === 0
        ? 'border-success/40 bg-success-soft text-success'
        : value > 0
          ? 'border-warning/40 bg-warning-soft text-warning'
          : 'border-danger/40 bg-danger-soft text-danger'
  return (
    <output aria-label="المتبقي" className={cn('block min-w-32 rounded-ctl border px-3 py-2 text-sm font-bold tabular-nums', tone)}>
      {value === null ? '—' : egp(value)}
    </output>
  )
}

function PaidBox({ amount, paid }: { amount: number; paid: number }) {
  const rest = Math.max(0, amount - paid)
  const tone =
    amount > 0 && rest === 0
      ? 'border-success/40 bg-success-soft text-success'
      : paid > 0
        ? 'border-warning/40 bg-warning-soft text-warning'
        : 'border-danger/40 bg-danger-soft text-danger'
  return (
    <output aria-label="متبقي القسط" className={cn('block min-w-32 rounded-ctl border px-3 py-2 text-sm font-bold tabular-nums', tone)}>
      {egp(rest)}
    </output>
  )
}

function ScheduleBar({ scheduled, required }: { scheduled: number; required: number }) {
  const diff = required - scheduled
  const match = diff === 0
  const pct = required > 0 ? Math.min(100, (scheduled / required) * 100) : scheduled > 0 ? 100 : 0
  return (
    <div aria-live="polite" className={`rounded-ctl border px-4 py-3 ${match ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5'}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <InfoPair label="إجمالي الأقساط المحددة" value={egp(scheduled)} strong />
        <InfoPair label="المطلوب" value={egp(required)} strong />
        <div className={`ms-auto flex items-center gap-1.5 text-sm font-medium ${match ? 'text-success' : 'text-warning'}`}>
          {match ? <IconCheckCircle size={16} /> : <IconAlert size={16} />}
          {match ? 'الأقساط مطابقة للمطلوب' : diff > 0 ? `ينقص ${egp(diff)}` : `يزيد ${egp(-diff)}`}
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hairline">
        <div
          className={`h-full w-full origin-right rounded-full transition-transform duration-300 ${match ? 'bg-success' : scheduled > required ? 'bg-danger' : 'bg-warning'}`}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
    </div>
  )
}
