import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useData, egp, fmtDate, offersRent, offersSale, UNIT_PURPOSES, UNIT_TYPES, type ContractType, type ISODate, type Unit, type UnitStatus } from '@/lib'
import { addDays, diffDays, rentForYear, toISO } from '@/lib/domain'
import { TODAY_ISO } from '@/data'
import { Btn, GlassSurface, IconAlert, IconBuilding, IconCalendar, IconCheckCircle, IconLayers, IconUsers, IconWallet, IconXCircle, LiquidTabs, Select, StatusChip, SummaryCard, type Column } from '@/kit'
import { DonutChart, type DonutTone } from '@/kit/charts'
import { ApiLoginCard, CONTRACT_TYPE_TONE, RETURNS_KEY, floorLabel, usePersistentList } from '../movement/shared'
import { ChartCard, KpiGrid, ReportActions, ReportFilterBar, ReportTable } from './shared'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL } from '@/lib/codes'
import {
  ApiError,
  clearToken,
  fetchAllBuildings,
  fetchUnitStatus,
  hasToken,
  PURPOSE_FROM_API,
  PURPOSE_TO_API,
  UNIT_TYPE_TO_API,
  type ApiUnitStatus,
  type ApiUnitStatusRow,
} from '@/lib/api'

type View = 'available' | 'reserved' | 'sold' | 'rented' | 'returned' | 'nonsellable' | 'status'
const VIEWS: { value: View; label: string; screen: string }[] = [
  { value: 'available', label: 'الوحدات المتاحة', screen: 'report-available-units' },
  { value: 'reserved', label: 'الوحدات المحجوزة', screen: 'report-reserved-units' },
  { value: 'sold', label: 'الوحدات المباعة', screen: 'report-sold-units' },
  { value: 'rented', label: 'الوحدات المؤجرة', screen: 'report-rented-units' },
  { value: 'returned', label: 'الوحدات المرتجعة', screen: 'report-returned-units' },
  { value: 'nonsellable', label: 'الوحدات غير القابلة للبيع', screen: 'report-non-sellable-units' },
  { value: 'status', label: 'حالة الوحدات', screen: 'report-unit-status' },
]
const VIEW_STATUS: Record<Exclude<View, 'status'>, UnitStatus> = {
  available: 'متاحة',
  reserved: 'محجوزة',
  sold: 'مباعة',
  rented: 'مؤجرة',
  returned: 'مرتجعة',
  nonsellable: 'غير قابلة للبيع',
}
const STATUS_TONE: Record<UnitStatus, DonutTone> = { متاحة: 'success', محجوزة: 'warning', مباعة: 'primary', مؤجرة: 'primary-2', مرتجعة: 'danger', 'غير قابلة للبيع': 'neutral' }
/** Leases ending within this many days are flagged. */
const ENDING_SOON_DAYS = 60

/** Saved by the returns screen (إنهاء العقود), keyed by contract id. */
type ReturnInfo = { id: string; date: ISODate; reason: string; fee: number; refund: number }

/** Every row carries the unit's base fields; views add their own. */
type Row = Unit & {
  buildingName: string
  client?: string
  /** Reservation purpose, or the type of the returned contract. */
  dealType?: ContractType
  date?: ISODate
  expiry?: ISODate
  deposit?: number
  /** Sale price agreed in the contract (sold view). */
  salePrice?: number
  /** Rent due this month (rented view). */
  rent?: number
  remaining?: number
  paid?: number
  refund?: number
  reason?: string
  contract?: string
}

const Money = ({ v, warn }: { v: number | undefined; warn?: boolean }) =>
  v == null ? <span className="text-fg-3">—</span> : <span className={`tabular-nums ${warn && v > 0 ? 'text-warning' : ''}`}>{egp(v)}</span>
const DateCell = ({ d, tone }: { d?: ISODate | null; tone?: 'danger' | 'warning' }) => (
  <span className={`tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : ''}`}>{fmtDate(d)}</span>
)
const TypeBadge = ({ t }: { t?: ContractType }) => (t ? <StatusChip size="sm" status={t} tone={CONTRACT_TYPE_TONE[t]} /> : <span className="text-fg-3">—</span>)
/** Sale price per m² of a unit offered for sale; null for rent-only units. */
const ppm = (u: Unit) => (offersSale(u.purpose) && u.area > 0 ? Math.round(u.price / u.area) : null)

export default function ReportUnits({ screen }: { screen?: { id: string } }) {
  const [view, setView] = useState<View>(VIEWS.find((v) => v.screen === screen?.id)?.value ?? 'available')

  return (
    <div className="grid gap-4">
      <LiquidTabs label="عرض التقرير" items={VIEWS} value={view} onChange={setView} className="print:hidden" />
      {view === 'status' ? <UnitStatusView /> : <UnitReportsView view={view as Exclude<View, 'status'>} />}
    </div>
  )
}

/** The demo-backed unit reports (every tab but «حالة الوحدات»، which is server-driven). */
function UnitReportsView({ view }: { view: Exclude<View, 'status'> }) {
  const { units, buildings, clients, contracts, reservations, contractSummary } = useData()
  const returns = usePersistentList<ReturnInfo>(RETURNS_KEY).items
  const [buildingId, setBuildingId] = useState('')
  const [type, setType] = useState('')
  const [floor, setFloor] = useState('')
  const [purpose, setPurpose] = useState('')

  const bName = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings])
  const floors = useMemo(() => [...new Set(units.map((u) => u.floor))].sort((a, b) => a - b).map((f) => ({ value: String(f), label: floorLabel(f) })), [units])

  const scoped = useMemo(
    () =>
      units
        .filter((u) => (!buildingId || u.buildingId === buildingId) && (!type || u.type === type) && (!floor || String(u.floor) === floor) && (!purpose || u.purpose === purpose))
        .map((u): Row => ({ ...u, buildingName: bName.get(u.buildingId) ?? '—' })),
    [units, buildingId, type, floor, purpose, bName],
  )

  /** Joins each unit to its reservation / contract / return record for the active view. */
  const rows = useMemo<Row[]>(() => {
    const client = new Map(clients.map((c) => [c.id, c]))
    const latest = <T extends { unitId: string }>(list: T[], key: (x: T) => string) => {
      const m = new Map<string, T>()
      for (const x of list) if (!m.has(x.unitId) || key(x) > key(m.get(x.unitId)!)) m.set(x.unitId, x)
      return m
    }
    const list = scoped.filter((u) => u.status === VIEW_STATUS[view])
    const who = (clientId: string | undefined) => {
      const cl = clientId ? client.get(clientId) : undefined
      return { client: cl?.fullName }
    }
    if (view === 'reserved') {
      const res = latest(reservations.filter((r) => r.status === 'نشط'), (r) => r.date)
      return list.map((u) => {
        const r = res.get(u.id)
        return { ...u, ...who(r?.clientId), dealType: r?.purpose, date: r?.date, expiry: r?.expiryDate, deposit: r?.deposit }
      })
    }
    if (view === 'sold') {
      const con = latest(contracts.filter((c) => c.type === 'بيع' && (c.status === 'نشط' || c.status === 'مكتمل')), (c) => c.date)
      return list.map((u) => {
        const c = con.get(u.id)
        const s = c ? contractSummary(c.id) : null
        return { ...u, ...who(c?.clientId), contract: c?.number, date: c?.date, salePrice: c?.type === 'بيع' ? c.unitPrice : undefined, remaining: s?.totalRemaining }
      })
    }
    if (view === 'rented') {
      const con = latest(contracts.filter((c) => c.type === 'إيجار' && c.status === 'نشط'), (c) => c.date)
      return list.map((u) => {
        const c = con.get(u.id)
        if (c?.type !== 'إيجار') return u
        const s = contractSummary(c.id)
        const year = Math.max(1, Math.floor(Math.max(0, diffDays(TODAY_ISO, c.startDate)) / 365) + 1)
        return { ...u, ...who(c.clientId), contract: c.number, date: c.startDate, expiry: c.endDate, rent: rentForYear(c, year), deposit: c.securityDeposit, remaining: s?.totalRemaining }
      })
    }
    if (view === 'returned') {
      const con = latest(contracts.filter((c) => c.status === 'مرتجع'), (c) => c.date)
      const ret = new Map(returns.map((r) => [r.id, r]))
      return list.map((u) => {
        const c = con.get(u.id)
        const s = c ? contractSummary(c.id) : null
        const info = c ? ret.get(c.id) : undefined
        // Rent and the refundable deposit were both collected before the return.
        return { ...u, ...who(c?.clientId), contract: c?.number, dealType: c?.type, date: info?.date, reason: info?.reason, refund: info?.refund, paid: s ? s.totalPaid + s.securityDepositPaid : undefined }
      })
    }
    if (view === 'nonsellable') return list.map((u) => ({ ...u, reason: u.nonSellableReason }))
    return list
  }, [view, scoped, clients, contracts, reservations, returns, contractSummary])

  const total = rows.reduce((s, r) => s + (view === 'sold' ? (r.salePrice ?? r.price) : view === 'rented' ? (r.rent ?? r.monthlyRent) : r.price), 0)
  const area = rows.reduce((s, r) => s + r.area, 0)
  const forSale = rows.filter((r) => offersSale(r.purpose))
  const saleArea = forSale.reduce((s, r) => s + r.area, 0)
  const saleTotal = forSale.reduce((s, r) => s + r.price, 0)
  const forRent = rows.filter((r) => offersRent(r.purpose))
  const soonCutoff = addDays(TODAY_ISO, ENDING_SOON_DAYS)

  const columns = useMemo<Column<Row>[]>(() => {
    const base: Column<Row>[] = [
      { key: 'buildingName', header: 'المبنى' },
      { key: 'number', header: 'رقم الوحدة', cell: (r) => <bdi dir="ltr" className="font-semibold tabular-nums text-fg">{r.number}</bdi> },
      { key: 'type', header: 'النوع' },
      { key: 'floor', header: 'الدور', align: 'center', value: (r) => r.floor, csv: (r) => floorLabel(r.floor), cell: (r) => <span className="tabular-nums">{floorLabel(r.floor)}</span> },
      { key: 'area', header: 'المساحة', align: 'center', value: (r) => r.area, cell: (r) => <span className="tabular-nums">{r.area} م²</span> },
    ]
    const purposeCol: Column<Row> = { key: 'purpose', header: 'الغرض' }
    const price: Column<Row> = {
      key: 'price',
      header: 'سعر البيع',
      align: 'end',
      value: (r) => (offersSale(r.purpose) ? r.price : null),
      cell: (r) => <Money v={offersSale(r.purpose) ? r.price : undefined} />,
    }
    const rentCol: Column<Row> = {
      key: 'monthlyRent',
      header: 'الإيجار الشهري',
      align: 'end',
      value: (r) => (offersRent(r.purpose) ? r.monthlyRent : null),
      cell: (r) => <Money v={offersRent(r.purpose) ? r.monthlyRent : undefined} />,
    }
    const who: Column<Row> = {
      key: 'client',
      header: view === 'returned' ? 'العميل السابق' : view === 'sold' ? 'المشتري' : view === 'rented' ? 'المستأجر' : 'العميل',
      value: (r) => r.client ?? '',
      cell: (r) => <span className="text-fg">{r.client ?? '—'}</span>,
    }
    const contract: Column<Row> = { key: 'contract', header: CODE_LABEL.contract, value: (r) => r.contract ?? '', cell: (r) => <bdi dir="ltr" className="tabular-nums">{r.contract ?? '—'}</bdi> }
    const dealType = (header: string): Column<Row> => ({ key: 'dealType', header, align: 'center', value: (r) => r.dealType ?? '', cell: (r) => <TypeBadge t={r.dealType} /> })
    switch (view) {
      case 'available':
        return [
          ...base,
          purposeCol,
          { key: 'rooms', header: 'الغرف', align: 'center' },
          price,
          { key: 'ppm', header: 'سعر المتر', align: 'end', value: (r) => ppm(r), cell: (r) => <Money v={ppm(r) ?? undefined} /> },
          rentCol,
        ]
      case 'reserved':
        return [
          ...base,
          dealType('غرض الحجز'),
          {
            key: 'askPrice',
            header: 'السعر / الإيجار',
            align: 'end',
            value: (r) => (r.dealType === 'إيجار' ? r.monthlyRent : r.price),
            cell: (r) => (r.dealType === 'إيجار' ? <span className="tabular-nums">{egp(r.monthlyRent)} / شهريًا</span> : <Money v={r.price} />),
          },
          who,
          { key: 'date', header: 'تاريخ الحجز', value: (r) => r.date ?? '', cell: (r) => <DateCell d={r.date} /> },
          { key: 'deposit', header: 'العربون', align: 'end', value: (r) => r.deposit ?? 0, cell: (r) => <Money v={r.deposit} /> },
          { key: 'expiry', header: 'تاريخ الانتهاء', value: (r) => r.expiry ?? '', cell: (r) => <DateCell d={r.expiry} tone={r.expiry && r.expiry < TODAY_ISO ? 'danger' : undefined} /> },
        ]
      case 'sold':
        return [
          ...base,
          contract,
          serialColumn('contract', (r: Row) => r.contract ?? ''),
          who,
          { key: 'salePrice', header: 'سعر البيع', align: 'end', value: (r) => r.salePrice ?? r.price, cell: (r) => <Money v={r.salePrice ?? r.price} /> },
          { key: 'date', header: 'تاريخ العقد', value: (r) => r.date ?? '', cell: (r) => <DateCell d={r.date} /> },
          { key: 'remaining', header: 'المتبقي', align: 'end', value: (r) => r.remaining ?? 0, cell: (r) => <Money v={r.remaining} warn /> },
        ]
      case 'rented':
        return [
          base[0],
          base[1],
          who,
          { key: 'rent', header: 'الإيجار الشهري', align: 'end', value: (r) => r.rent ?? 0, cell: (r) => <Money v={r.rent} /> },
          { key: 'date', header: 'تاريخ البداية', value: (r) => r.date ?? '', cell: (r) => <DateCell d={r.date} /> },
          {
            key: 'expiry',
            header: 'تاريخ النهاية',
            value: (r) => r.expiry ?? '',
            cell: (r) => <DateCell d={r.expiry} tone={!r.expiry ? undefined : r.expiry < TODAY_ISO ? 'danger' : r.expiry <= soonCutoff ? 'warning' : undefined} />,
          },
        ]
      case 'returned':
        return [
          ...base,
          contract,
          serialColumn('contract', (r: Row) => r.contract ?? ''),
          dealType('نوع العقد'),
          who,
          { key: 'date', header: 'تاريخ الإرجاع', value: (r) => r.date ?? '', cell: (r) => <DateCell d={r.date} /> },
          { key: 'reason', header: 'السبب', value: (r) => r.reason ?? '', cell: (r) => <span className="line-clamp-1 max-w-[14rem]" title={r.reason}>{r.reason || '—'}</span> },
          { key: 'paid', header: 'المحصّل قبل الإرجاع', align: 'end', value: (r) => r.paid ?? 0, cell: (r) => <Money v={r.paid} /> },
          { key: 'refund', header: 'المبلغ المسترد', align: 'end', value: (r) => r.refund ?? 0, cell: (r) => <Money v={r.refund} /> },
        ]
      case 'nonsellable':
      default:
        return [...base, purposeCol, price, rentCol, { key: 'reason', header: 'السبب', value: (r) => r.reason ?? '', cell: (r) => <span className="text-fg">{r.reason || '—'}</span> }]
    }
  }, [view, soonCutoff])

  const viewLabel = VIEWS.find((v) => v.value === view)!.label
  const active = !!(buildingId || type || floor || purpose)

  return (
    <>
      <ReportFilterBar active={active} onReset={() => (setBuildingId(''), setType(''), setFloor(''), setPurpose(''))}>
        <Select label="المبنى" placeholder="كل المباني" options={buildings.map((b) => ({ value: b.id, label: b.name }))} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <Select label="نوع الوحدة" placeholder="كل الأنواع" options={[...UNIT_TYPES]} value={type} onChange={(e) => setType(e.target.value)} />
        <Select label="الدور" placeholder="كل الأدوار" options={floors} value={floor} onChange={(e) => setFloor(e.target.value)} />
        <Select label="الغرض" placeholder="بيع وإيجار" options={[...UNIT_PURPOSES]} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </ReportFilterBar>

      <KpiGrid>
        <SummaryCard label={`عدد ${viewLabel}`} value={rows.length} icon={<IconLayers size={20} />} hint={`${scoped.length ? Math.round((rows.length / scoped.length) * 100) : 0}% من الوحدات`} />
        {view === 'rented' ? (
          <SummaryCard label="الإيجار الشهري الحالي" value={total} format={egp} tone="success" icon={<IconWallet size={20} />} hint={`${rows.length} عقد إيجار ساري`} />
        ) : view === 'sold' ? (
          <SummaryCard label="إجمالي قيمة المبيعات" value={total} format={egp} tone="success" icon={<IconWallet size={20} />} />
        ) : view === 'available' || view === 'nonsellable' ? (
          <SummaryCard
            label="إجمالي قيمة البيع"
            value={saleTotal}
            format={egp}
            tone="success"
            icon={<IconWallet size={20} />}
            hint={`${forSale.length} للبيع · ${forRent.length} للإيجار بإجمالي ${egp(forRent.reduce((s, r) => s + r.monthlyRent, 0))} شهريًا`}
          />
        ) : view === 'reserved' ? (
          <SummaryCard
            label="قيمة حجوزات البيع"
            value={rows.reduce((s, r) => s + (r.dealType === 'بيع' ? r.price : 0), 0)}
            format={egp}
            tone="success"
            icon={<IconWallet size={20} />}
            hint={`${rows.filter((r) => r.dealType === 'بيع').length} للبيع · ${rows.filter((r) => r.dealType === 'إيجار').length} للإيجار`}
          />
        ) : (
          <SummaryCard label="إجمالي القيمة" value={total} format={egp} tone="success" icon={<IconWallet size={20} />} />
        )}
        {view === 'reserved' ? (
          <>
            <SummaryCard label="إجمالي العرابين" value={rows.reduce((s, r) => s + (r.deposit ?? 0), 0)} format={egp} tone="warning" icon={<IconCheckCircle size={20} />} />
            <SummaryCard label="حجوزات منتهية المدة" value={rows.filter((r) => r.expiry && r.expiry < TODAY_ISO).length} tone="danger" icon={<IconCalendar size={20} />} />
          </>
        ) : view === 'sold' ? (
          <>
            <SummaryCard label="المتبقي على المشترين" value={rows.reduce((s, r) => s + (r.remaining ?? 0), 0)} format={egp} tone="warning" icon={<IconAlert size={20} />} />
            <SummaryCard label="عدد المشترين" value={new Set(rows.map((r) => r.client).filter(Boolean)).size} tone="neutral" icon={<IconUsers size={20} />} />
          </>
        ) : view === 'rented' ? (
          <>
            <SummaryCard label="المتبقي على المستأجرين" value={rows.reduce((s, r) => s + (r.remaining ?? 0), 0)} format={egp} tone="warning" icon={<IconAlert size={20} />} hint="حتى نهاية مدد العقود" />
            <SummaryCard
              label={`عقود تنتهي خلال ${ENDING_SOON_DAYS} يومًا`}
              value={rows.filter((r) => r.expiry && r.expiry <= soonCutoff).length}
              tone="danger"
              icon={<IconCalendar size={20} />}
            />
          </>
        ) : view === 'returned' ? (
          <>
            <SummaryCard label="إجمالي المسترد" value={rows.reduce((s, r) => s + (r.refund ?? 0), 0)} format={egp} tone="danger" icon={<IconXCircle size={20} />} />
            <SummaryCard label="المحصّل قبل الإرجاع" value={rows.reduce((s, r) => s + (r.paid ?? 0), 0)} format={egp} tone="neutral" icon={<IconWallet size={20} />} />
          </>
        ) : (
          <>
            <SummaryCard label="إجمالي المساحة" value={area} format={(n) => `${Math.round(n).toLocaleString('en')} م²`} tone="neutral" icon={<IconBuilding size={20} />} />
            <SummaryCard label="متوسط سعر المتر" value={saleArea ? Math.round(saleTotal / saleArea) : 0} format={egp} tone="warning" icon={<IconCheckCircle size={20} />} hint="للوحدات المعروضة للبيع" />
          </>
        )}
      </KpiGrid>

      <ByBuilding rows={rows} title={viewLabel} />

      <ReportTable rows={rows} columns={columns} rowKey={(r) => r.id} caption={viewLabel} searchPlaceholder="ابحث برقم الوحدة أو المبنى أو العميل…" initialSort={{ key: 'buildingName', dir: 'asc' }} emptyText="لا توجد وحدات مطابقة." />
      <ReportActions title={viewLabel} fileName={viewLabel.replace(/\s+/g, '-')} columns={columns} rows={rows} shareText={view === 'rented' ? `${rows.length} وحدة مؤجرة بإيجار شهري ${egp(total)}` : `${rows.length} وحدة بقيمة ${egp(view === 'sold' || view === 'returned' ? total : saleTotal)}`} />
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="t-section px-1">{title}</h2>
      {children}
    </section>
  )
}

function ByBuilding({ rows, title }: { rows: Row[]; title: string }) {
  const data = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.buildingName, (m.get(r.buildingName) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
  }, [rows])
  return (
    <ChartCard title={`${title} حسب المبنى`}>
      <DonutChart label={`${title} حسب المبنى`} centerLabel="وحدة" data={data} />
    </ChartCard>
  )
}

/* ==================================================================
   حالة الوحدات — server-driven (`GET /admin/reports/unit-status`)
   ================================================================== */

/** The four states a unit can be in, plus «غير قابلة للبيع» (available but flagged unsellable). */
const STATE_LABEL = { available: 'متاحة', reserved: 'محجوزة', sold: 'مباعة', rented: 'مؤجرة', closed: 'غير قابلة للبيع' } as const
const STATE_ORDER = ['available', 'reserved', 'sold', 'rented', 'closed'] as const
/** API value → the Arabic label the Select shows. */
const TYPE_LABEL_FROM_API: Record<string, string> = Object.fromEntries(Object.entries(UNIT_TYPE_TO_API).map(([ar, api]) => [api, ar]))
const STATE_TONE: Record<keyof typeof STATE_LABEL, DonutTone> = {
  available: 'success',
  reserved: 'warning',
  sold: 'primary',
  rented: 'primary-2',
  closed: 'neutral',
}

/** The building rollup as the breakdown table prints it. */
type BuildingStatusRow = {
  id: string
  name: string
  total: number
  available: number
  reserved: number
  sold: number
  rented: number
  closed: number
  area: number
  saleValue: number
  monthlyRent: number
}

const buildingStatusRow = (b: ApiUnitStatus['by_building'][number]): BuildingStatusRow => ({
  id: String(b.id),
  name: b.name ?? '—',
  total: b.total,
  available: b.available,
  reserved: b.reserved,
  sold: b.sold,
  rented: b.rented,
  closed: b.closed,
  area: b.area,
  saleValue: b.sale_value,
  monthlyRent: b.monthly_rent,
})

function UnitStatusView() {
  // ── Session ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => hasToken())
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Report (server) ──────────────────────────────────────────────────────
  const [data, setData] = useState<ApiUnitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  const [buildingId, setBuildingId] = useState('')
  const [type, setType] = useState('')
  const [purpose, setPurpose] = useState('')
  const [buildingOptions, setBuildingOptions] = useState<{ value: string; label: string }[]>([])

  const lostSession = useCallback((notice: string) => {
    clearToken()
    setAuthed(false)
    setData(null)
    setLoginNotice(notice)
  }, [])

  const reloggedIn = useCallback(() => {
    setAuthed(true)
    setLoginNotice(null)
    setLoadError(null)
    setBuildingId('')
    setType('')
    setPurpose('')
    reload()
  }, [])

  useEffect(() => {
    if (!authed) return
    let alive = true
    fetchAllBuildings()
      .then((buildings) => {
        if (alive) setBuildingOptions(buildings.map((b) => ({ value: String(b.id), label: b.name })))
      })
      .catch(() => {
        // The report still works without the building filter.
      })
    return () => {
      alive = false
    }
  }, [authed, reloadKey])

  useEffect(() => {
    if (!authed) return
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchUnitStatus({ buildingId: buildingId || undefined, type: type || undefined, purpose: purpose || undefined })
      .then((result) => {
        if (alive) setData(result)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setData(null)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل حالة الوحدات')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, buildingId, type, purpose, reloadKey])

  const counts = data?.counts
  const totals = data?.totals
  const units = useMemo<ApiUnitStatusRow[]>(() => data?.units ?? [], [data])
  const buildings = useMemo<BuildingStatusRow[]>(() => (data?.by_building ?? []).map(buildingStatusRow), [data])

  /** Money behind each state: sale value for available / reserved / sold, the live rent for rented. */
  const valueOf = useCallback(
    (state: keyof typeof STATE_LABEL) =>
      units.reduce((sum, u) => {
        // A closed unit is only «غير قابلة للبيع», never «متاحة» at the same time.
        if (state === 'closed') return u.is_closed ? sum + (u.sale_price ?? 0) : sum
        if (u.is_closed || state !== u.status) return sum
        return sum + (state === 'rented' ? (u.monthly_rent ?? 0) : (u.sale_price ?? 0))
      }, 0),
    [units],
  )

  const donut = useMemo(
    () => STATE_ORDER.map((state) => ({ label: STATE_LABEL[state], value: counts?.[state] ?? 0, tone: STATE_TONE[state] })),
    [counts],
  )

  const columns = useMemo<Column<ApiUnitStatusRow>[]>(
    () => [
      { key: 'building_name', header: 'المبنى', value: (r) => r.building_name ?? '', cell: (r) => r.building_name ?? '—' },
      { key: 'name', header: 'رقم الوحدة', cell: (r) => <bdi dir="ltr" className="font-semibold tabular-nums text-fg">{r.name}</bdi> },
      { key: 'type_label', header: 'النوع', value: (r) => r.type_label ?? r.type, cell: (r) => r.type_label ?? r.type },
      {
        key: 'floor',
        header: 'الدور',
        align: 'center',
        value: (r) => r.floor ?? 0,
        csv: (r) => (r.floor == null ? '' : floorLabel(r.floor)),
        cell: (r) => <span className="tabular-nums">{r.floor == null ? '—' : floorLabel(r.floor)}</span>,
      },
      { key: 'area', header: 'المساحة', align: 'center', value: (r) => r.area, cell: (r) => <span className="tabular-nums">{r.area} م²</span> },
      { key: 'purpose_label', header: 'الغرض', value: (r) => r.purpose_label ?? '', cell: (r) => r.purpose_label ?? '—' },
      { key: 'sale_price', header: 'سعر البيع', align: 'end', value: (r) => r.sale_price ?? 0, cell: (r) => <Money v={r.sale_price ?? undefined} /> },
      {
        key: 'monthly_rent',
        header: 'الإيجار الشهري',
        align: 'end',
        value: (r) => r.monthly_rent ?? 0,
        cell: (r) => <Money v={r.monthly_rent ?? undefined} />,
      },
      {
        key: 'status',
        header: 'الحالة',
        value: (r) => r.status_label ?? r.status,
        csv: (r) => (r.is_closed ? STATE_LABEL.closed : (r.status_label ?? r.status)),
        cell: (r) => (
          <span className="grid gap-1">
            <StatusChip size="sm" status={r.is_closed ? STATE_LABEL.closed : (r.status_label ?? r.status)} />
            {r.is_closed && r.non_sellable_reason && <span className="t-caption">{r.non_sellable_reason}</span>}
          </span>
        ),
      },
    ],
    [],
  )

  const buildingColumns = useMemo<Column<BuildingStatusRow>[]>(() => {
    const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '0%')
    return [
      { key: 'name', header: 'المبنى', cell: (r) => <span className="font-semibold text-fg">{r.name}</span> },
      { key: 'total', header: 'الإجمالي', align: 'center', cell: (r) => <span className="font-bold tabular-nums">{r.total}</span> },
      ...STATE_ORDER.map(
        (state): Column<BuildingStatusRow> => ({
          key: state,
          header: STATE_LABEL[state],
          align: 'center',
          value: (r) => r[state],
          csv: (r) => `${r[state]} (${pct(r[state], r.total)})`,
          cell: (r) => (
            <span className="grid justify-items-center">
              <span className="tabular-nums">{r[state]}</span>
              <span className="t-caption tabular-nums">{pct(r[state], r.total)}</span>
            </span>
          ),
        }),
      ),
      { key: 'saleValue', header: 'قيمة البيع', align: 'end', value: (r) => r.saleValue, cell: (r) => <Money v={r.saleValue} /> },
      { key: 'monthlyRent', header: 'الإيجار الشهري', align: 'end', value: (r) => r.monthlyRent, cell: (r) => <Money v={r.monthlyRent} /> },
      { key: 'area', header: 'المساحة', align: 'end', value: (r) => r.area, csv: (r) => r.area, cell: (r) => <span className="tabular-nums">{Math.round(r.area).toLocaleString('en')} م²</span> },
    ]
  }, [])

  const active = !!(buildingId || type || purpose)

  if (!authed) {
    return <ApiLoginCard entity="حالة الوحدات" icon={<IconLayers size={20} />} notice={loginNotice} onLoggedIn={reloggedIn} />
  }

  return (
    <>
      <ReportFilterBar active={active} onReset={() => (setBuildingId(''), setType(''), setPurpose(''))}>
        <Select label="المبنى" placeholder="كل المباني" options={buildingOptions} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <Select
          label="نوع الوحدة"
          placeholder="كل الأنواع"
          options={Object.keys(UNIT_TYPE_TO_API)}
          value={TYPE_LABEL_FROM_API[type] ?? ''}
          onChange={(e) => setType(UNIT_TYPE_TO_API[e.target.value] ?? '')}
        />
        <Select
          label="الغرض"
          placeholder="بيع وإيجار"
          options={[...UNIT_PURPOSES]}
          value={PURPOSE_FROM_API[purpose] ?? ''}
          onChange={(e) => setPurpose(PURPOSE_TO_API[e.target.value] ?? '')}
        />
      </ReportFilterBar>
      {loadError && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <IconAlert size={16} />
          <span className="flex-1">{loadError}</span>
          <Btn size="sm" variant="glass" onClick={reload}>
            إعادة المحاولة
          </Btn>
        </div>
      )}
      <KpiGrid>
        <SummaryCard
          label="إجمالي الوحدات"
          value={counts?.total ?? 0}
          tone="neutral"
          icon={<IconBuilding size={20} />}
          hint={`${Math.round(totals?.area ?? 0).toLocaleString('en')} م²`}
        />
        {STATE_ORDER.map((state) => {
          const count = counts?.[state] ?? 0
          const pct = counts?.total ? Math.round((count / counts.total) * 100) : 0
          return (
            <SummaryCard
              key={state}
              label={STATE_LABEL[state]}
              value={count}
              tone={state === 'available' ? 'success' : state === 'closed' ? 'neutral' : state === 'rented' ? 'warning' : 'primary'}
              icon={<IconLayers size={20} />}
              hint={`${pct}% من الوحدات · ${egp(valueOf(state))}${state === 'rented' ? ' شهريًا' : ''}`}
            />
          )
        })}
        <SummaryCard
          label="قيمة الوحدات للبيع"
          value={totals?.sale_value ?? 0}
          format={egp}
          tone="success"
          icon={<IconWallet size={20} />}
          hint={totals?.sale_area ? `${Math.round(totals.sale_value / totals.sale_area).toLocaleString('en')} ج.م للمتر` : 'لا توجد وحدات معروضة للبيع'}
        />
        <SummaryCard
          label="الإيجار الشهري الساري"
          value={totals?.monthly_rent ?? 0}
          format={egp}
          tone="warning"
          icon={<IconCalendar size={20} />}
          hint={`${counts?.rented ?? 0} وحدة مؤجرة`}
        />
      </KpiGrid>
      <ChartCard title="توزيع حالات الوحدات" description="بما فيها الوحدات غير القابلة للبيع">
        <DonutChart label="توزيع الوحدات حسب الحالة" centerLabel="وحدة" data={donut} />
      </ChartCard>
      <Section title="الحالات حسب المبنى">
        <ReportTable
          rows={buildings}
          columns={buildingColumns}
          rowKey={(r) => r.id}
          caption="حالة الوحدات حسب المبنى"
          searchable={false}
          initialSort={{ key: 'total', dir: 'desc' }}
          emptyText="لا توجد وحدات."
        />
      </Section>
      <ReportTable
        rows={units}
        columns={columns}
        rowKey={(r) => String(r.id)}
        caption="الوحدات وحالتها"
        loading={loading}
        searchPlaceholder="ابحث برقم الوحدة أو المبنى أو النوع…"
        initialSort={{ key: 'building_name', dir: 'asc' }}
        emptyText="لا توجد وحدات مطابقة."
      />
      {counts && counts.total > 0 && (
        <p className="t-caption px-1">
          {counts.closed > 0 && `${counts.closed} وحدة «غير قابلة للبيع» محسوبة على حدة (متاحة لكن موسومة يدويًا). `}
          لا توجد حالة «مرتجعة» في النظام: عند إلغاء عقد الوحدة تعود «متاحة».
        </p>
      )}
      <ReportActions
        title="حالة الوحدات"
        fileName="حالة-الوحدات"
        columns={columns}
        rows={units}
        details={[
          ['المبنى', buildingOptions.find((b) => b.value === buildingId)?.label ?? 'كل المباني'],
          ['الإجمالي', `${counts?.total ?? 0} وحدة على ${Math.round(totals?.area ?? 0).toLocaleString('en')} م²`],
          ['القيمة للبيع', egp(totals?.sale_value ?? 0)],
          ['الإيجار الشهري', egp(totals?.monthly_rent ?? 0)],
          ['حتى تاريخ', toISO(new Date())],
        ]}
        shareText={`${counts?.total ?? 0} وحدة: ${counts?.available ?? 0} متاحة · ${counts?.reserved ?? 0} محجوزة · ${counts?.sold ?? 0} مباعة · ${counts?.rented ?? 0} مؤجرة`}
      />
    </>
  )
}
