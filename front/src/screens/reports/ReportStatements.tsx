import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { egp, fmtDate, paymentLabel, type ContractStatus, type ContractType, type ISODate, type Unit } from '@/lib'
import { toISO } from '@/lib/domain'
import { CONTRACT_TYPE_TONE, contractTypeLabel } from '../movement/shared'
import {
  Btn,
  Combobox,
  GlassSurface,
  IconAlert,
  IconBuilding,
  IconCheckCircle,
  IconFile,
  IconLayers,
  IconPhone,
  IconWallet,
  LiquidTabs,
  StatusChip,
  SummaryCard,
  type Column,
} from '@/kit'
import { Text, type BadgeTone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ChartCard, KpiGrid, ReportActions, ReportTable } from './shared'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL } from '@/lib/codes'
import {
  ApiError,
  clearToken,
  fetchAllBuildings,
  fetchAllUnits,
  fetchBuildingStatement,
  fetchUnitStatement,
  type ApiBuildingStatement,
  type ApiBuildingStatementContract,
  type ApiStatementFloor,
  type ApiStatementReservation,
  type ApiStatementUnit,
  type ApiUnit,
  type ApiUnitStatement,
  type ApiUnitStatementContract,
} from '@/lib/api'

/** The screens run on the server's real calendar, not the demo seed's fixed `TODAY_ISO`. */
const REAL_TODAY: ISODate = toISO(new Date())

type View = 'building' | 'unit'
const VIEWS: { value: View; label: string; screen: string }[] = [
  { value: 'building', label: 'كشف عقار', screen: 'report-building-statement' },
  { value: 'unit', label: 'كشف وحدة', screen: 'report-unit-statement' },
]

export default function ReportStatements({ screen }: { screen?: { id: string } }) {
  const [view, setView] = useState<View>(VIEWS.find((v) => v.screen === screen?.id)?.value ?? 'building')
  return (
    <div className="grid gap-4">
      <LiquidTabs label="نوع الكشف" items={VIEWS} value={view} onChange={setView} className="print:hidden" />
      {view === 'building' ? <BuildingStatement /> : <UnitStatement />}
    </div>
  )
}

const num = (v: number | string | null | undefined) => Number(v ?? 0)
const Money = ({ v, warn }: { v: number; warn?: boolean }) => (
  <span className={`tabular-nums ${warn && v > 0 ? 'text-warning' : ''}`}>{egp(v)}</span>
)

const Empty = ({ icon, text }: { icon: ReactNode; text: string }) => (
  <GlassSurface variant="strong" padding="lg" className="grid place-items-center gap-2 text-center text-fg-3">
    {icon}
    <Text variant="section">{text}</Text>
  </GlassSurface>
)

function Pair({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="t-caption">{label}</span>
      <span className="t-label text-fg">{value}</span>
    </div>
  )
}

/* Contract statuses on the API side (draft / active / cancelled) shown with the demo's chips. */
const CONTRACT_STATUS: Record<string, ContractStatus> = { draft: 'مسودة', active: 'نشط', cancelled: 'ملغي' }
const CONTRACT_TONE: Record<ContractStatus, BadgeTone> = {
  نشط: 'indigo',
  مكتمل: 'green',
  منتهي: 'neutral',
  مجدد: 'sky',
  مرتجع: 'yellow',
  ملغي: 'red',
  مسودة: 'neutral',
}
const contractType = (type: 'sale' | 'rent' | null): ContractType => (type === 'rent' ? 'إيجار' : 'بيع')
const contractStatusLabel = (status: string) => CONTRACT_STATUS[status] ?? '—'
const contractStatusTone = (status: string) => CONTRACT_TONE[CONTRACT_STATUS[status]] ?? 'neutral'

/* ==================================================================
   مجسّم العقار
   ================================================================== */

/** The demo's unit labels, mapped from the API's `available | reserved | sold | rented` + the flag. */
type FigureStatus = Extract<Unit['status'], 'متاحة' | 'محجوزة' | 'مباعة' | 'مؤجرة' | 'غير قابلة للبيع'>
const FIGURE_STATUS: Record<string, FigureStatus> = {
  available: 'متاحة',
  reserved: 'محجوزة',
  sold: 'مباعة',
  rented: 'مؤجرة',
}
/** A unit marked «غير قابلة للبيع» is closed only while it is not already sold/reserved/rented. */
const figureStatus = (u: { status: string; is_sellable: boolean }): FigureStatus =>
  !u.is_sellable && u.status === 'available' ? 'غير قابلة للبيع' : (FIGURE_STATUS[u.status] ?? 'متاحة')

const FIGURE_TYPE: Record<string, Unit['type']> = {
  apartment: 'شقة',
  shop: 'محل',
  warehouse: 'مستودع',
  studio: 'استوديو',
}
const figureType = (type: string): Unit['type'] => FIGURE_TYPE[type] ?? 'شقة'

type FigureUnit = { id: string; number: string; floor: number; type: Unit['type']; status: FigureStatus }

const statusOfApiUnit = (u: ApiUnit): FigureStatus => figureStatus(u)
const statusOfStatementUnit = (u: ApiStatementUnit): FigureStatus => figureStatus(u)

const STATUS_FILL: Record<FigureStatus, string> = {
  مباعة: 'bg-success text-white',
  مؤجرة: 'bg-primary text-white',
  محجوزة: 'bg-warning text-white',
  'غير قابلة للبيع': 'bg-fg-3 text-white',
  متاحة: 'bg-primary-soft text-fg-2 ring-1 ring-inset ring-hairline',
}
const TYPE_FILL: Record<Unit['type'], string> = {
  شقة: 'bg-indigo-500 text-white',
  استوديو: 'bg-violet-500 text-white',
  روف: 'bg-sky-500 text-white',
  محل: 'bg-amber-500 text-white',
  مكتب: 'bg-teal-500 text-white',
  ميزانين: 'bg-pink-500 text-white',
  مستودع: 'bg-stone-500 text-white',
  بدروم: 'bg-slate-600 text-white',
}
type ColorBy = 'status' | 'type'
const fillOf = (u: FigureUnit, by: ColorBy) => (by === 'type' ? TYPE_FILL[u.type] : STATUS_FILL[u.status])
/** Swatch-only part of a fill class (no text colour), for legends and dots. */
const swatch = (cls: string) => cls.replace(/\btext-\S+/g, '')

const STATUS_LEGEND: [string, string][] = [
  ['مباعة', STATUS_FILL.مباعة],
  ['مؤجرة', STATUS_FILL.مؤجرة],
  ['محجوزة', STATUS_FILL.محجوزة],
  ['مغلقة', STATUS_FILL['غير قابلة للبيع']],
  ['متاحة', STATUS_FILL.متاحة],
]
const TYPE_LEGEND: [string, string][] = Object.entries(TYPE_FILL)

/** `بدروم 2` below ground, `الأرضي`, `الدور 3`. */
const levelLabel = (floor: number) => (floor < 0 ? `بدروم ${-floor}` : floor === 0 ? 'الأرضي' : `الدور ${floor}`)

/**
 * The building drawn as a stack of floors: top floor first, a ground line, then basements below it.
 * `mode="floor"` makes each floor a button (units are small windows); `mode="unit"` makes each unit
 * a numbered button.
 */
function BuildingFigure({
  name,
  floors,
  units,
  mode,
  selectedFloor = null,
  selectedUnit = null,
  onSelectFloor,
  onSelectUnit,
}: {
  name: string
  floors: number[]
  units: FigureUnit[]
  mode: 'floor' | 'unit'
  selectedFloor?: number | null
  selectedUnit?: string | null
  onSelectFloor?: (floor: number | null) => void
  onSelectUnit?: (id: string) => void
}) {
  const [colorBy, setColorBy] = useState<ColorBy>('status')
  const ordered = [...floors].sort((a, b) => b - a)
  const above = ordered.filter((f) => f >= 0)
  const below = ordered.filter((f) => f < 0)
  const legend = colorBy === 'type' ? TYPE_LEGEND : STATUS_LEGEND

  const row = (f: number) => {
    const list = units.filter((u) => u.floor === f)
    const on = selectedFloor === f
    const label = (
      <span className={cn('w-16 shrink-0 text-[12px] font-bold', on ? 'text-primary dark:text-indigo-300' : 'text-fg-2')}>{levelLabel(f)}</span>
    )
    const cells = (
      <span className="flex flex-nowrap items-center gap-1.5">
        {list.length === 0 && <span className="text-[11px] text-fg-3">لا وحدات</span>}
        {list.map((u) =>
          mode === 'unit' ? (
            <button
              key={u.id}
              type="button"
              aria-pressed={selectedUnit === u.id}
              onClick={() => onSelectUnit?.(u.id)}
              title={`وحدة ${u.number} — ${u.type} — ${u.status}`}
              className={cn(
                'grid h-11 min-w-[3.25rem] place-items-center rounded-t-[10px] rounded-b-[3px] px-1.5 text-[12px] font-bold tabular-nums transition-all duration-200',
                fillOf(u, colorBy),
                selectedUnit === u.id
                  ? 'z-[1] scale-110 shadow-lg ring-2 ring-primary ring-offset-2 ring-offset-bg'
                  : 'hover:-translate-y-0.5 hover:brightness-110',
              )}
            >
              {u.number}
            </button>
          ) : (
            <span key={u.id} title={`وحدة ${u.number} — ${u.type} — ${u.status}`} className={cn('h-6 w-5 rounded-t-[6px] rounded-b-[2px]', fillOf(u, colorBy))} />
          ),
        )}
      </span>
    )
    const cls = 'flex min-h-[52px] items-center gap-3 rounded-md border px-2.5 py-2 text-start transition-colors'
    return mode === 'floor' ? (
      <button
        key={f}
        type="button"
        aria-pressed={on}
        onClick={() => onSelectFloor?.(on ? null : f)}
        title={`${levelLabel(f)} — ${list.length} وحدة`}
        className={cn(cls, on ? 'border-primary bg-primary-soft shadow-soft' : 'border-hairline bg-bg hover:border-primary/50 hover:bg-primary-soft/60')}
      >
        {label}
        {cells}
      </button>
    ) : (
      <div key={f} className={cn(cls, 'border-hairline bg-bg')}>
        {label}
        {cells}
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <LiquidTabs
          label="تلوين الوحدات حسب"
          items={[
            { value: 'status', label: 'الحالة' },
            { value: 'type', label: 'النوع' },
          ]}
          value={colorBy}
          onChange={setColorBy}
        />
        <span className="t-caption">{floors.length} طابق · {units.length} وحدة</span>
      </div>
      <div className="max-h-[75vh] overflow-auto rounded-ctl border border-hairline bg-linear-135 from-sky-500/5 to-transparent p-4">
        <div role="group" aria-label={`مجسّم ${name}`} className="mx-auto grid w-max min-w-[280px] justify-items-stretch transition-[width] duration-300">
          <div
            aria-hidden="true"
            className="mx-auto h-8 w-[104%] justify-self-center bg-linear-135 from-primary to-primary-2 [clip-path:polygon(6%_100%,14%_0,86%_0,94%_100%)]"
          />
          <div className="grid gap-1 rounded-t-md border-x-4 border-t-4 border-fg-3/40 bg-neutral-soft p-1.5">
            {above.map(row)}
            <div aria-hidden="true" className="mx-auto mt-0.5 h-4 w-12 rounded-t-md bg-fg-3/50" />
          </div>
          <div className="relative -mx-3 flex items-center gap-2 rounded-sm bg-success/70 px-3 py-1 text-[11px] font-bold text-white">
            <span>مستوى الأرض</span>
            <span aria-hidden="true" className="h-px flex-1 bg-white/40" />
          </div>
          {below.length > 0 ? (
            <div className="grid gap-1 border-x-4 border-b-4 border-fg-3/40 bg-linear-to-b from-stone-500/25 to-stone-700/30 p-1.5">
              {below.map(row)}
            </div>
          ) : (
            <div aria-hidden="true" className="h-3 bg-stone-500/25" />
          )}
        </div>
      </div>
      <ul className="m-0 flex list-none flex-wrap justify-center gap-x-4 gap-y-1 p-0 text-[11.5px] text-fg-3" aria-label="دليل الألوان">
        {legend.map(([label, cls]) => (
          <li key={label} className="inline-flex items-center gap-1.5">
            <span className={cn('size-3 rounded-[3px]', swatch(cls))} /> {label}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ==================================================================
   كشف عقار
   ================================================================== */

type Totals = { sales: number; remaining: number; due: number; monthly_rent: number; overdue: number; collected: number }

/** Rows of the financial totals table: label, amount, note, optional text-colour class. */
function totalsRows(d: Totals): [string, number, string, string?][] {
  return [
    ['إجمالي المبيعات', d.sales, 'قيمة عقود البيع السارية'],
    ['إجمالي المتبقي', d.remaining, 'غير المحصّل من العقود السارية', 'text-warning'],
    ['إجمالي المستحق', d.due, 'غير مسدد حتى نهاية الشهر الحالي', 'text-warning'],
    ['إجمالي الإيجار الشهري', d.monthly_rent, 'عقود الإيجار السارية'],
    ['إجمالي المتأخرات', d.overdue, 'استحقاقات فات موعدها ولم تُسدد', 'text-danger'],
    ['المحصّل خلال الفترة', d.collected, 'كل الدفعات الصحيحة المسجلة', 'text-success'],
  ]
}

/** The six figures of one floor, plus its units. */
function FloorDetails({ row, units, onClear }: { row: ApiStatementFloor | undefined; units: FigureUnit[]; onClear: () => void }) {
  if (!row)
    return (
      <div className="grid h-full min-h-[200px] place-items-center rounded-ctl border border-dashed border-hairline p-6 text-center">
        <div className="grid justify-items-center gap-2 text-fg-3">
          <IconLayers size={28} />
          <Text variant="section">اختر طابقًا من المجسّم</Text>
          <Text variant="caption">ستظهر هنا إجماليات الطابق: المبيعات والمتبقي والمستحق والإيجار والمتأخرات والمحصّل.</Text>
        </div>
      </div>
    )
  return (
    <div className="rise-in grid gap-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Text variant="section">{levelLabel(row.floor)}</Text>
          <Text variant="caption">{row.units} وحدة</Text>
        </div>
        <Btn variant="ghost" size="sm" onClick={onClear}>
          إلغاء التحديد
        </Btn>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {totalsRows({
          sales: row.sales,
          remaining: row.remaining,
          due: row.due,
          monthly_rent: row.monthly_rent,
          overdue: row.overdue,
          collected: row.collected,
        }).map(([label, value, note, tone]) => (
          <div key={label} className="grid gap-1 rounded-ctl border border-hairline bg-bg/60 p-3">
            <span className="t-caption">{label}</span>
            <span className={cn('text-[18px] font-extrabold tabular-nums', tone ?? 'text-fg')}>{egp(value)}</span>
            <span className="text-[11.5px] leading-snug text-fg-3">{note}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" aria-label="وحدات الطابق">
        {units.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[12px] text-fg-2">
            <span className={cn('size-2.5 rounded-full', swatch(STATUS_FILL[u.status]))} />
            وحدة {u.number} · {u.type} · {u.status === 'غير قابلة للبيع' ? 'مغلقة' : u.status}
          </span>
        ))}
      </div>
    </div>
  )
}

function BuildingStatement() {

  // ── Building picker (server) ─────────────────────────────────────────────
  const [buildingOptions, setBuildingOptions] = useState<{ value: string; label: string; description?: string }[]>([])
  const [buildingId, setBuildingId] = useState<string | null>(null)

  // ── The statement ────────────────────────────────────────────────────────
  const [data, setData] = useState<ApiBuildingStatement | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [floor, setFloor] = useState<number | null>(null)

  const lostSession = useCallback((notice: string) => {
    clearToken()
    setData(null)
  }, [])

  useEffect(() => {
    let alive = true
    fetchAllBuildings()
      .then((buildings) => {
        if (!alive) return
        const options = buildings.map((b) => ({
          value: String(b.id),
          label: b.name,
          description: [b.district, b.city].filter(Boolean).join(' · '),
        }))
        setBuildingOptions(options)
        // The demo opened on the first building; keep that so the report is never blank by accident.
        setBuildingId((current) => current ?? options[0]?.value ?? null)
      })
      .catch((err: unknown) => {
        if (!alive) return
        // A stale token would otherwise leave an empty picker with no way back to the card.
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        // Other failures leave the picker empty; the retry banner below the card handles a dead API.
      })
    return () => {
      alive = false
    }
  }, [reloadKey, lostSession])

  useEffect(() => {
    if (!buildingId) {
      setData(null)
      return
    }
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchBuildingStatement(buildingId)
      .then((result) => {
        if (alive) setData(result)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setData(null)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل كشف العقار')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [buildingId, reloadKey, lostSession])

  // A new building starts a new figure, so a floor of the old one cannot stay selected.
  useEffect(() => setFloor(null), [buildingId])

  const units = useMemo<FigureUnit[]>(
    () =>
      (data?.units ?? []).map((u) => ({
        id: String(u.id),
        number: u.name,
        floor: u.floor,
        type: figureType(u.type),
        status: statusOfStatementUnit(u),
      })),
    [data],
  )
  const floors = useMemo(() => [...new Set(units.map((u) => u.floor))].sort((a, b) => b - a), [units])
  const selectedFloor = data?.floors.find((f) => f.floor === floor)

  const columns = useMemo<Column<ApiBuildingStatementContract>[]>(
    () => [
      { key: 'number', header: CODE_LABEL.contract, cell: (r) => <span className="font-semibold tabular-nums text-fg">{r.number}</span> },
      serialColumn('contract', (r) => r.number),
      { key: 'type', header: 'النوع', value: (r) => contractTypeLabel(contractType(r.type)), cell: (r) => <StatusChip status={contractTypeLabel(contractType(r.type))} tone={CONTRACT_TYPE_TONE[contractType(r.type)]} size="sm" /> },
      { key: 'unit_name', header: 'الوحدة', value: (r) => r.unit_name ?? '', cell: (r) => r.unit_name ?? <span className="text-fg-3">—</span> },
      { key: 'client_name', header: 'العميل', value: (r) => r.client_name ?? '', cell: (r) => r.client_name ?? <span className="text-fg-3">—</span> },
      { key: 'contract_date', header: 'تاريخ التعاقد', value: (r) => r.contract_date ?? '', csv: (r) => (r.contract_date ? fmtDate(r.contract_date) : '—'), cell: (r) => (r.contract_date ? <span className="tabular-nums">{fmtDate(r.contract_date)}</span> : <span className="text-fg-3">—</span>) },
      { key: 'value', header: 'قيمة العقد', align: 'end', cell: (r) => <Money v={r.value} /> },
      { key: 'paid', header: 'المسدد', align: 'end', cell: (r) => <Money v={r.paid} /> },
      { key: 'remaining', header: 'المتبقي', align: 'end', cell: (r) => <Money v={r.remaining} warn /> },
      { key: 'due', header: 'المستحق', align: 'end', cell: (r) => (r.due > 0 ? <span className="tabular-nums text-warning">{egp(r.due)}</span> : <span className="text-fg-3">—</span>) },
      { key: 'overdue', header: 'المتأخر', align: 'end', cell: (r) => (r.overdue > 0 ? <span className="tabular-nums text-danger">{egp(r.overdue)}</span> : <span className="text-fg-3">—</span>) },
      { key: 'status', header: 'الحالة', value: (r) => contractStatusLabel(r.status), cell: (r) => <StatusChip status={contractStatusLabel(r.status)} tone={contractStatusTone(r.status)} size="sm" /> },
    ],
    [],
  )

  const reservationColumns = useMemo<Column<ApiStatementReservation>[]>(
    () => [
      { key: 'client_name', header: 'العميل', value: (r) => r.client_name ?? '', cell: (r) => r.client_name ?? <span className="text-fg-3">—</span> },
      { key: 'unit_name', header: 'الوحدة', value: (r) => (r.is_building_level ? 'حجز على العقار' : (r.unit_name ?? '')), cell: (r) => (r.is_building_level ? <span className="text-fg-3">حجز على العقار</span> : (r.unit_name ?? '—')) },
      { key: 'reservation_date', header: 'تاريخ الحجز', value: (r) => r.reservation_date ?? '', csv: (r) => (r.reservation_date ? fmtDate(r.reservation_date) : '—'), cell: (r) => (r.reservation_date ? <span className="tabular-nums">{fmtDate(r.reservation_date)}</span> : <span className="text-fg-3">—</span>) },
      { key: 'client_phone', header: 'الهاتف', value: (r) => r.client_phone ?? '', cell: (r) => (r.client_phone ? <bdi dir="ltr" className="tabular-nums">{r.client_phone}</bdi> : <span className="text-fg-3">—</span>) },
      { key: 'deposit_paid', header: 'العربون المدفوع', align: 'end', cell: (r) => <Money v={r.deposit_paid} /> },
      { key: 'status', header: 'الحالة', value: (r) => r.status_label ?? '', cell: (r) => <StatusChip status={r.status_label ?? '—'} size="sm" /> },
    ],
    [],
  )

  const building = data?.building
  const totals = data?.totals

  return (
    <>
      <GlassSurface padding="md" className="rise-in max-w-xl print:hidden" role="search" aria-label="اختيار العقار">
        <Combobox label="العقار" required placeholder="اختر العقار…" options={buildingOptions} value={buildingId} onChange={setBuildingId} clearable />
      </GlassSurface>

      {loadError && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <IconAlert size={16} />
          <span className="flex-1">{loadError}</span>
          <button type="button" className="rounded-ctl px-2 py-1 font-semibold underline" onClick={() => setReloadKey((k) => k + 1)}>
            إعادة المحاولة
          </button>
        </div>
      )}

      {!buildingId || !building || !data || !totals ? (
        <Empty icon={<IconBuilding size={28} />} text="اختر عقارًا لعرض كشفه" />
      ) : (
        <>
          <GlassSurface variant="strong" padding="md" className="rise-in flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-4">
              <span className="grid size-14 place-items-center rounded-ctl bg-[var(--primary-soft)] text-primary">
                <IconBuilding size={26} />
              </span>
              <div>
                <Text variant="section">{building.name}</Text>
                <span className="t-caption">{[building.district, building.city].filter(Boolean).join('، ') || '—'}</span>
              </div>
            </div>
            <Pair label="الكود" value={<span className="tabular-nums">{building.number ?? '—'}</span>} />
            <Pair label="الأدوار" value={<span className="tabular-nums">{building.floors_count}</span>} />
            <Pair label="الوحدات" value={<span className="tabular-nums">{building.units_count}</span>} />
            <Pair label="حتى" value={<span className="tabular-nums">{fmtDate(REAL_TODAY)}</span>} />
          </GlassSurface>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="إجمالي الوحدات" value={data.counts.total} icon={<IconLayers size={20} />} tone="primary" />
            <SummaryCard label="الوحدات المباعة" value={data.counts.sold} icon={<IconCheckCircle size={20} />} tone="success" />
            <SummaryCard label="الوحدات المستأجرة" value={data.counts.rented} icon={<IconFile size={20} />} tone="primary" />
            <SummaryCard label="الوحدات المحجوزة" value={data.counts.reserved} icon={<IconAlert size={20} />} tone="warning" />
            <SummaryCard label="الوحدات المغلقة" value={data.counts.closed} icon={<IconBuilding size={20} />} tone="neutral" hint="غير قابلة للبيع" />
          </div>

          <ChartCard title="الإجماليات المالية" description={`${building.name} — عقود سارية فقط`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <caption className="sr-only">الإجماليات المالية للعقار</caption>
                <thead>
                  <tr className="border-b border-hairline text-start text-fg-3">
                    <th scope="col" className="px-3 py-2 text-start font-semibold">البند</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">المبلغ</th>
                    <th scope="col" className="px-3 py-2 text-start font-semibold">ملاحظة</th>
                  </tr>
                </thead>
                <tbody>
                  {totalsRows(totals).map(([label, value, note, tone]) => (
                    <tr key={label} className="border-b border-hairline last:border-0">
                      <th scope="row" className="px-3 py-2.5 text-start font-bold text-fg">{label}</th>
                      <td className={`px-3 py-2.5 font-bold tabular-nums ${tone ?? 'text-fg'}`}>{egp(value)}</td>
                      <td className="px-3 py-2.5 text-fg-3">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totals.cancelled > 0 && (
              <p className="t-caption px-1">لا تدخل الدفعات الملغاة ({egp(totals.cancelled)}) في المحصّل؛ الإيصالات الملغاة لا تُحذف.</p>
            )}
          </ChartCard>

          <ChartCard title="مجسّم العقار" description="اضغط على أي طابق لعرض إجمالياته المالية">
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(300px,1fr)_minmax(0,1.2fr)]">
              <BuildingFigure
                name={building.name}
                floors={floors}
                units={units}
                mode="floor"
                selectedFloor={floor}
                onSelectFloor={setFloor}
              />
              <FloorDetails row={selectedFloor} units={units.filter((u) => u.floor === floor)} onClear={() => setFloor(null)} />
            </div>
          </ChartCard>

          <ChartCard title="عقود العقار" description={`${data.contracts.length} عقد`}>
            <ReportTable
              rows={data.contracts}
              columns={columns}
              rowKey={(r) => String(r.id)}
              caption={`عقود ${building.name}`}
              loading={loading}
              searchPlaceholder="ابحث برقم العقد أو العميل…"
              initialSort={{ key: 'contract_date', dir: 'desc' }}
              emptyText="لا توجد عقود لهذا العقار."
            />
          </ChartCard>

          {data.reservations.length > 0 && (
            <ChartCard title="حجوزات العقار" description={`${data.reservations.length} حجز`}>
              <ReportTable
                rows={data.reservations}
                columns={reservationColumns}
                rowKey={(r) => String(r.id)}
                caption={`حجوزات ${building.name}`}
                searchable={false}
                initialSort={{ key: 'reservation_date', dir: 'desc' }}
                emptyText="لا توجد حجوزات."
                exportName={`حجوزات-${building.name.replace(/\s+/g, '-')}-${REAL_TODAY}`}
              />
            </ChartCard>
          )}

          <ReportActions
            title={`كشف عقار — ${building.name}`}
            fileName={`كشف-عقار-${building.name.replace(/\s+/g, '-')}`}
            columns={columns}
            rows={data.contracts}
            lateRow={(r) => r.overdue > 0}
            shareText={`${data.counts.total} وحدة · مباعة ${data.counts.sold} · مؤجرة ${data.counts.rented} · محجوزة ${data.counts.reserved} · مغلقة ${data.counts.closed}`}
            details={[
              ['العقار', building.name],
              ['العنوان', [building.district, building.city].filter(Boolean).join('، ') || '—'],
              ['إجمالي الوحدات', String(data.counts.total)],
              ['المباعة', String(data.counts.sold)],
              ['المستأجرة', String(data.counts.rented)],
              ['المحجوزة', String(data.counts.reserved)],
              ['المغلقة', String(data.counts.closed)],
              ...totalsRows(totals).map(([l, v]) => [l, egp(v)] as [string, string]),
            ]}
          />
        </>
      )}
    </>
  )
}

/* ==================================================================
   كشف وحدة
   ================================================================== */

type RentStatus = 'مسدد' | 'متأخر' | 'متهرب'
const RENT_TONE: Record<RentStatus, BadgeTone> = { مسدد: 'green', متأخر: 'yellow', متهرب: 'red' }
/** Unpaid months at or beyond which a tenant is flagged «متهرب». */
const ABSCOND_MONTHS = 3

type ScheduleState = 'مدفوع' | 'جزئي' | 'متأخر' | 'قادم' | 'ملغي'
const STATE_TONE: Record<ScheduleState, BadgeTone> = { مدفوع: 'green', جزئي: 'yellow', متأخر: 'red', قادم: 'neutral', ملغي: 'neutral' }

type ScheduleRow = {
  id: string
  seq: number
  label: string
  dueDate: string
  amount: number
  paidAmount: number
  remaining: number
  paidDate: string
  state: ScheduleState
}

/** The unit's contract and the financial figures of its current contract. */
function UnitFigures({ contract, totals }: { contract: ApiUnitStatementContract | null; totals: ApiUnitStatement['totals'] }) {
  const money: [string, number, string, string?][] = [
    ['إجمالي المبيعات', totals.sales, 'قيمة عقد البيع'],
    ['إجمالي المتبقي', totals.remaining, 'غير المحصّل من العقد', 'text-warning'],
    ['إجمالي المستحق', totals.due, 'حتى نهاية الشهر الحالي', 'text-warning'],
    ['إجمالي الإيجار الشهري', totals.monthly_rent, 'عقد الإيجار الساري'],
    ['إجمالي المتأخرات', totals.overdue, 'استحقاقات فات موعدها', 'text-danger'],
    ['العربون المدفوع', totals.deposit_paid, 'دفعات الحجز الصحيحة'],
  ]
  return (
    <div className="rise-in grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="إجماليات الوحدة">
      <div className="grid gap-1 rounded-ctl border border-hairline bg-bg/60 p-3 sm:col-span-2 xl:col-span-1">
        <span className="t-caption">العقد</span>
        {contract ? (
          <>
            <span className="text-[16px] font-extrabold tabular-nums text-fg">{contract.number}</span>
            <span className="inline-flex flex-wrap items-center gap-1.5 text-[11.5px] text-fg-3">
              {contractTypeLabel(contractType(contract.type))} · <StatusChip status={contractStatusLabel(contract.status)} tone={contractStatusTone(contract.status)} size="sm" />
            </span>
          </>
        ) : (
          <span className="text-[14px] font-bold text-fg-3">لا يوجد عقد ساري</span>
        )}
      </div>
      {money.map(([label, value, note, tone]) => (
        <div key={label} className="grid gap-1 rounded-ctl border border-hairline bg-bg/60 p-3">
          <span className="t-caption">{label}</span>
          <span className={cn('text-[18px] font-extrabold tabular-nums', tone ?? 'text-fg')}>{egp(value)}</span>
          <span className="text-[11.5px] leading-snug text-fg-3">{note}</span>
        </div>
      ))}
    </div>
  )
}

function UnitStatement() {

  // ── Building + unit pickers (server) ─────────────────────────────────────
  const [buildingOptions, setBuildingOptions] = useState<{ value: string; label: string; description?: string }[]>([])
  const [buildingId, setBuildingId] = useState<string | null>(null)
  const [units, setUnits] = useState<ApiUnit[]>([])
  const [unitId, setUnitId] = useState<string | null>(null)

  // ── The statement ────────────────────────────────────────────────────────
  const [data, setData] = useState<ApiUnitStatement | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const lostSession = useCallback((notice: string) => {
    clearToken()
    setData(null)
  }, [])

  useEffect(() => {
    let alive = true
    fetchAllBuildings()
      .then((buildings) => {
        if (!alive) return
        const options = buildings.map((b) => ({
          value: String(b.id),
          label: b.name,
          description: [b.district, b.city].filter(Boolean).join(' · '),
        }))
        setBuildingOptions(options)
        setBuildingId((current) => current ?? options[0]?.value ?? null)
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        // Same as the building view: the retry banner covers an API that is down.
      })
    return () => {
      alive = false
    }
  }, [reloadKey, lostSession])

  useEffect(() => {
    if (!buildingId) {
      setUnits([])
      return
    }
    let alive = true
    fetchAllUnits(Number(buildingId))
      .then((list) => {
        if (alive) setUnits(list)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setUnits([])
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
      })
    return () => {
      alive = false
    }
  }, [buildingId, reloadKey])

  useEffect(() => {
    setUnitId(null)
    setData(null)
  }, [buildingId])

  useEffect(() => {
    if (!unitId) {
      setData(null)
      return
    }
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchUnitStatement(unitId)
      .then((result) => {
        if (alive) setData(result)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setData(null)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل كشف الوحدة')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [unitId, reloadKey, lostSession])

  const figureUnits = useMemo<FigureUnit[]>(
    () =>
      units.map((u) => ({
        id: String(u.id),
        number: u.name,
        floor: u.floor_number ?? 0,
        type: figureType(u.type),
        status: statusOfApiUnit(u),
      })),
    [units],
  )
  const floors = useMemo(() => [...new Set(figureUnits.map((u) => u.floor))].sort((a, b) => b - a), [figureUnits])
  const buildingLabel = buildingOptions.find((b) => b.value === buildingId)?.label ?? '—'

  const unit = data?.unit
  const contract = data?.current_contract ?? null
  const isRent = contract?.type === 'rent'

  const schedule = useMemo<ScheduleRow[]>(() => {
    if (!contract) return []
    const type = contractType(contract.type)
    return [...contract.installments]
      .sort((a, b) => a.sequence_number - b.sequence_number)
      .map((i) => ({
        id: String(i.id),
        seq: i.sequence_number,
        label: paymentLabel(type, i.sequence_number),
        dueDate: (i.due_date ?? '').slice(0, 10),
        amount: num(i.amount),
        paidAmount: num(i.paid_amount),
        remaining: num(i.remaining),
        paidDate: (i.paid_at ?? '').slice(0, 10),
        state: i.is_cancelled
          ? 'ملغي'
          : num(i.remaining) <= 0
            ? 'مدفوع'
            : i.is_overdue
              ? 'متأخر'
              : num(i.paid_amount) > 0
                ? 'جزئي'
                : 'قادم',
      }))
  }, [contract])

  const overdueRows = useMemo(() => schedule.filter((r) => r.state === 'متأخر'), [schedule])
  const rentStatus: RentStatus | null =
    isRent && contract?.is_active
      ? overdueRows.length === 0
        ? 'مسدد'
        : overdueRows.length >= ABSCOND_MONTHS
          ? 'متهرب'
          : 'متأخر'
      : null
  const oldestLate = overdueRows[0] ? Math.max(0, Math.round((Date.parse(REAL_TODAY) - Date.parse(overdueRows[0].dueDate)) / 86_400_000)) : 0

  const columns = useMemo<Column<ScheduleRow>[]>(
    () => [
      { key: 'seq', header: 'الدفعة', value: (r) => r.seq, csv: (r) => r.label, cell: (r) => <span className="tabular-nums">{r.label}</span> },
      { key: 'dueDate', header: 'تاريخ الاستحقاق', csv: (r) => (r.dueDate ? fmtDate(r.dueDate) : '—'), cell: (r) => (r.dueDate ? <span className="tabular-nums">{fmtDate(r.dueDate)}</span> : <span className="text-fg-3">—</span>) },
      { key: 'amount', header: 'المبلغ', align: 'end', cell: (r) => <Money v={r.amount} /> },
      { key: 'paidAmount', header: 'المسدد', align: 'end', cell: (r) => <Money v={r.paidAmount} /> },
      { key: 'remaining', header: 'المتبقي', align: 'end', cell: (r) => <Money v={r.remaining} warn /> },
      {
        key: 'paidDate',
        header: 'يوم السداد',
        csv: (r) => (r.paidDate ? fmtDate(r.paidDate) : '—'),
        cell: (r) => (r.paidDate ? <span className="tabular-nums text-success">{fmtDate(r.paidDate)}</span> : <span className="text-fg-3">—</span>),
      },
      { key: 'state', header: 'الحالة', value: (r) => r.state, cell: (r) => <StatusChip status={r.state} tone={STATE_TONE[r.state]} size="sm" /> },
    ],
    [],
  )

  const showSchedule = !!contract && contract.installments.length > 0

  return (
    <>
      <GlassSurface padding="md" className="rise-in max-w-xl print:hidden" role="search" aria-label="اختيار العقار">
        <Combobox label="العقار" required placeholder="اختر العقار…" options={buildingOptions} value={buildingId} onChange={setBuildingId} clearable />
      </GlassSurface>

      {loadError && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <IconAlert size={16} />
          <span className="flex-1">{loadError}</span>
          <button type="button" className="rounded-ctl px-2 py-1 font-semibold underline" onClick={() => setReloadKey((k) => k + 1)}>
            إعادة المحاولة
          </button>
        </div>
      )}

      {!buildingId ? (
        <Empty icon={<IconBuilding size={28} />} text="اختر عقارًا لعرض وحداته" />
      ) : (
        <ChartCard title="مجسّم العقار" description="اضغط على أي وحدة لعرض كشفها">
          <BuildingFigure
            name={buildingLabel}
            floors={floors}
            units={figureUnits}
            mode="unit"
            selectedUnit={unitId}
            onSelectUnit={setUnitId}
          />
        </ChartCard>
      )}

      {!unitId || !unit || !data ? (
        <Empty icon={<IconLayers size={28} />} text="اختر وحدة من المجسّم لعرض كشفها" />
      ) : (
        <>
          <GlassSurface variant="strong" padding="md" className="rise-in flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-4">
              <span className="grid size-14 place-items-center rounded-ctl bg-[var(--primary-soft)] text-primary">
                <IconLayers size={26} />
              </span>
              <div>
                <Text variant="section">
                  {unit.type_label ?? figureType(unit.type)} {unit.name}
                </Text>
                <span className="t-caption">{unit.building_name ?? '—'}</span>
              </div>
            </div>
            <Pair label="حالة الوحدة" value={<StatusChip status={figureStatus(unit)} tone={figureStatus(unit) === 'غير قابلة للبيع' ? 'neutral' : undefined} />} />
            <Pair label="الدور" value={<span className="tabular-nums">{unit.floor === null ? '—' : levelLabel(unit.floor)}</span>} />
            <Pair label="المساحة" value={<span className="tabular-nums">{unit.area} م²</span>} />
            <Pair label="الغرف / الحمامات" value={<span className="tabular-nums">{unit.rooms ?? '—'} / {unit.bathrooms ?? '—'}</span>} />
            <Pair label="الغرض" value={unit.purpose_label ?? '—'} />
            {unit.total_price !== null && unit.total_price > 0 && <Pair label="سعر البيع" value={<span className="tabular-nums">{egp(unit.total_price)}</span>} />}
          </GlassSurface>

          <UnitFigures contract={contract} totals={data.totals} />

          {!contract && data.current_reservation === null && (
            <Empty
              icon={<IconCheckCircle size={28} />}
              text={figureStatus(unit) === 'غير قابلة للبيع' && unit.non_sellable_reason ? `الوحدة مغلقة: ${unit.non_sellable_reason}` : 'الوحدة متاحة — لا توجد عقود نشطة عليها'}
            />
          )}

          {!contract && data.current_reservation !== null && (
            <GlassSurface variant="strong" padding="md" className="rise-in flex flex-wrap items-center gap-x-8 gap-y-3">
              <Pair label="العميل الحاجز" value={data.current_reservation.client_name ?? '—'} />
              <Pair label="تاريخ الحجز" value={<span className="tabular-nums">{data.current_reservation.reservation_date ? fmtDate(data.current_reservation.reservation_date) : '—'}</span>} />
              <Pair label="العربون المدفوع" value={<span className="tabular-nums">{egp(data.current_reservation.deposit_paid)}</span>} />
              <Pair label="حالة الحجز" value={<StatusChip status={data.current_reservation.status_label ?? '—'} size="sm" />} />
            </GlassSurface>
          )}

          {contract && (
            <div className="grid gap-4 lg:grid-cols-2">
              <GlassSurface variant="strong" padding="md" className="rise-in grid content-start gap-4">
                <Text variant="section">معلومات العميل</Text>
                {data.client ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Pair label="الاسم" value={data.client.name} />
                    <Pair label="الهاتف" value={<span className="inline-flex items-center gap-1.5"><IconPhone size={14} /><bdi dir="ltr" className="tabular-nums">{data.client.phone || '—'}</bdi></span>} />
                    <Pair label="هاتف آخر" value={<bdi dir="ltr" className="tabular-nums">{data.client.phone_2 || '—'}</bdi>} />
                    <Pair label="الرقم القومي" value={<bdi dir="ltr" className="tabular-nums">{data.client.national_id || '—'}</bdi>} />
                  </div>
                ) : (
                  <Text variant="caption">لا توجد بيانات للعميل.</Text>
                )}
              </GlassSurface>

              <GlassSurface variant="strong" padding="md" className="rise-in grid content-start gap-4">
                <Text variant="section">{isRent ? 'العقد وحالة الإيجار' : 'تفاصيل الوحدة والعقد'}</Text>
                <div className="grid grid-cols-2 gap-4">
                  <Pair label="رقم العقد" value={<span className="tabular-nums">{contract.number}</span>} />
                  <Pair label="تاريخ التعاقد" value={<span className="tabular-nums">{contract.contract_date ? fmtDate(contract.contract_date) : '—'}</span>} />
                  {isRent ? (
                    <>
                      <Pair label="الإيجار الشهري" value={<span className="font-bold tabular-nums">{egp(contract.monthly_rent)}</span>} />
                      <Pair label="التأمين" value={<span className="tabular-nums">{egp(contract.security_deposit)}</span>} />
                      <Pair label="بداية الإيجار" value={<span className="tabular-nums">{contract.start_date ? fmtDate(contract.start_date) : '—'}</span>} />
                      <Pair label="نهاية الإيجار" value={<span className="tabular-nums">{contract.end_date ? fmtDate(contract.end_date) : '—'}</span>} />
                      <Pair label="حالة الإيجار الحالي" value={rentStatus ? <StatusChip status={rentStatus} tone={RENT_TONE[rentStatus]} /> : '—'} />
                      <Pair
                        label="الأشهر غير المسددة"
                        value={
                          overdueRows.length ? (
                            <span className="tabular-nums text-danger">
                              {overdueRows.length} · {egp(data.totals.overdue)}
                            </span>
                          ) : (
                            '0'
                          )
                        }
                      />
                    </>
                  ) : (
                    <>
                      <Pair label="سعر البيع" value={<span className="font-bold tabular-nums">{egp(contract.unit_price)}</span>} />
                      <Pair label="المقدم" value={<span className="tabular-nums">{egp(contract.down_payment)}</span>} />
                      <Pair label="المقدم المسدد" value={<span className="tabular-nums">{egp(contract.down_payment_paid)}</span>} />
                      <Pair label="باقي المقدم" value={<span className="tabular-nums text-warning">{egp(contract.down_payment_remaining)}</span>} />
                      <Pair label="العقار" value={unit.building_name ?? '—'} />
                      <Pair label="العنوان" value={[unit.building_district, unit.building_city].filter(Boolean).join('، ') || '—'} />
                    </>
                  )}
                </div>
                {isRent && rentStatus && rentStatus !== 'مسدد' && (
                  <Text variant="caption">
                    {rentStatus === 'متهرب'
                      ? `تجاوزت المتأخرات ${ABSCOND_MONTHS} أشهر؛ أقدم استحقاق متأخر منذ ${oldestLate} يومًا.`
                      : `أقدم استحقاق متأخر منذ ${oldestLate} يومًا. يُصنَّف «متهرب» عند ${ABSCOND_MONTHS} أشهر متأخرة أو أكثر.`}
                  </Text>
                )}
              </GlassSurface>
            </div>
          )}

          {showSchedule && contract && (
            <>
              <ChartCard
                title={isRent ? 'جدول الإيجار' : 'تفاصيل الأقساط'}
                description={isRent ? 'وقت الاستحقاق واليوم الذي تم السداد فيه' : 'جدول أقساط العقد وما تم سداده'}
              >
                <ReportTable
                  rows={schedule}
                  columns={columns}
                  rowKey={(r) => r.id}
                  caption={`${isRent ? 'جدول إيجار' : 'أقساط'} وحدة ${unit.name}`}
                  loading={loading}
                  searchable={false}
                  initialSort={{ key: 'seq', dir: 'asc' }}
                  emptyText="لا يوجد جدول سداد لهذا العقد."
                />
              </ChartCard>
              <ReportActions
                title={`كشف وحدة — ${unit.type_label ?? ''} ${unit.name}`.trim()}
                fileName={`كشف-وحدة-${unit.name}`}
                columns={columns}
                rows={schedule}
                lateRow={(r) => r.state === 'متأخر'}
                shareText={`${unit.building_name ?? ''} · ${figureStatus(unit)}${data.client ? ` · ${data.client.name}` : ''}`}
                details={[
                  ['العقار', unit.building_name ?? '—'],
                  ['الوحدة', `${unit.type_label ?? ''} ${unit.name}`.trim()],
                  ['الحالة', figureStatus(unit)],
                  ['العميل', data.client?.name ?? '—'],
                  ['الهاتف', data.client?.phone || '—'],
                  ...(isRent
                    ? ([
                        ['الإيجار الشهري', egp(contract.monthly_rent)],
                        ['حالة الإيجار', rentStatus ?? '—'],
                      ] as [string, string][])
                    : []),
                  ['المتبقي', egp(data.totals.remaining)],
                ]}
              />
            </>
          )}
        </>
      )}
    </>
  )
}
