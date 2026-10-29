import { useCallback, useEffect, useMemo, useState } from 'react'
import { useData, egp, fmtDate, paymentLabel, upfrontLabel, type ContractStatus, type ContractType, type Installment, type ISODate } from '@/lib'
import { addDays, addMonths, diffDays, toISO } from '@/lib/domain'
import { TODAY_ISO } from '@/data'
import { Btn, Combobox, DatePicker, IconAlert, IconCalendar, IconCheckCircle, IconFile, IconInfo, IconTrendUp, IconWallet, LiquidTabs, Select, StatusChip, SummaryCard, type Column } from '@/kit'
import { AreaChart, BarChart, DonutChart, type DonutTone } from '@/kit/charts'
import type { BadgeTone } from '@/components/ui'
import { compose } from '../records'
import type { RecordView } from '@/kit'
import { ApiLoginCard, FilterChips, goToReceipt } from '../movement/shared'
import {
  ApiError,
  clearToken,
  fetchAllBuildings,
  fetchAllClients,
  fetchDailyCollection,
  fetchDueOverdueReport,
  fetchInstallmentsSummary,
  fetchMonthlyRevenue,
  hasToken,
  PAYMENT_METHOD_FROM_API,
  type ApiCancelledCollectionPayment,
  type ApiCollectionPayment,
  type ApiDailyCollection,
  type ApiDueOverdueRow,
  type ApiInstallmentsSummaryRow,
  type ApiMonthlyRevenue,
  type ApiMonthlyRevenueMonth,
  type DueOverdueMeta,
  type InstallmentsSummaryCounts,
  EMPTY_DUE_OVERDUE_META,
} from '@/lib/api'
import { ChartCard, KpiGrid, ReportActions, ReportFilterBar, ReportTable, lastMonths, monthLabel } from './shared'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL } from '@/lib/codes'

type View = 'summary' | 'leases' | 'aging' | 'monthly' | 'daily'
const VIEWS: { value: View; label: string; screen: string }[] = [
  { value: 'summary', label: 'ملخص الأقساط والعقود', screen: 'report-installments-summary' },
  { value: 'leases', label: 'عقود الإيجار', screen: 'report-leases' },
  { value: 'aging', label: 'الأقساط المستحقة والمتأخرة', screen: 'report-due-overdue' },
  { value: 'monthly', label: 'الإيرادات الشهرية', screen: 'report-monthly-revenue' },
  { value: 'daily', label: 'التحصيل اليومي', screen: 'report-daily-collection' },
]

const CONTRACT_TONE: Record<ContractStatus, BadgeTone> = {
  مسودة: 'neutral',
  نشط: 'indigo',
  مكتمل: 'green',
  منتهي: 'neutral',
  مجدد: 'sky',
  مرتجع: 'yellow',
  ملغي: 'red',
}
const STATUS_OPTIONS: ContractStatus[] = ['نشط', 'مكتمل', 'منتهي', 'مجدد', 'مرتجع', 'ملغي']

/** Label for the building + client dropdowns. */
function useLookups() {
  const { buildings, clients, units } = useData()
  return useMemo(
    () => ({
      building: new Map(buildings.map((b) => [b.id, b])),
      client: new Map(clients.map((c) => [c.id, c])),
      unit: new Map(units.map((u) => [u.id, u])),
      buildingOptions: buildings.map((b) => ({ value: b.id, label: b.name })),
      clientOptions: clients.map((c) => ({ value: c.id, label: c.fullName })),
    }),
    [buildings, clients, units],
  )
}

export default function ReportInstallments({ screen }: { screen?: { id: string } }) {
  const initial = VIEWS.find((v) => v.screen === screen?.id)?.value ?? 'summary'
  const [view, setView] = useState<View>(initial)
  return (
    <div className="grid gap-4">
      <LiquidTabs label="عرض التقرير" items={VIEWS} value={view} onChange={setView} className="print:hidden" />
      {view === 'summary' && <SummaryView />}
      {view === 'leases' && <LeasesView />}
      {view === 'aging' && <AgingView />}
      {view === 'monthly' && <MonthlyView />}
      {view === 'daily' && <DailyView />}
    </div>
  )
}

/* ==================================================================
   1) ملخص الأقساط والعقود
   ================================================================== */

/** A schedule row as the summary prints it: the report only needs its number and due date. */
type InstallmentRef = { seq: number; dueDate: ISODate }

type SummaryRow = {
  id: string
  number: string
  status: ContractStatus
  type: ContractType
  clientId: string
  clientName: string
  buildingId: string
  unitNumber: string
  startDate: ISODate | null
  endDate: ISODate | null
  /** Sale down payment or lease security deposit. */
  upfront: number
  upfrontRemaining: number
  installmentsTotal: number
  contractValue: number
  unitPrice: number
  monthlyRent: number
  totalInstallments: number
  paidInstallmentsCount: number
  lastPaid: InstallmentRef | null
  nextDue: InstallmentRef | null
  currentInstallmentRemaining: number
  downPayment: number
  downPaymentRemaining: number
  securityDeposit: number
  totalPaid: number
  totalRemaining: number
}

const seqDate = (i: InstallmentRef | null, type: ContractType) => (i ? `${paymentLabel(type, i.seq)} — ${fmtDate(i.dueDate)}` : '-')

const refOf = (i: Installment | null): InstallmentRef | null => (i ? { seq: i.seq, dueDate: i.dueDate } : null)

/** The demo-backed rows: still used by the other report tabs of this screen. */
function useSummaryRows(): SummaryRow[] {
  const { contracts, installments, contractSummary } = useData()
  const look = useLookups()
  return useMemo<SummaryRow[]>(() => {
    const totals = new Map<string, number>()
    for (const i of installments) totals.set(i.contractId, (totals.get(i.contractId) ?? 0) + i.amount)
    return contracts
      .filter((c) => c.status !== 'مسودة')
      .flatMap((c) => {
        const s = contractSummary(c.id)
        if (!s) return []
        const client = look.client.get(c.clientId)
        const unit = look.unit.get(c.unitId)
        return [
          {
            id: c.id,
            number: c.number,
            status: c.status,
            type: c.type,
            clientId: c.clientId,
            clientName: client?.fullName ?? '—',
            buildingId: unit?.buildingId ?? '',
            unitNumber: unit?.number ?? '—',
            startDate: c.type === 'إيجار' ? c.startDate : null,
            endDate: c.type === 'إيجار' ? c.endDate : null,
            upfront: s.type === 'بيع' ? s.downPayment : s.securityDeposit,
            upfrontRemaining: s.type === 'بيع' ? s.downPaymentRemaining : s.securityDepositRemaining,
            installmentsTotal: totals.get(c.id) ?? 0,
            contractValue: s.contractValue,
            unitPrice: s.unitPrice,
            monthlyRent: s.monthlyRent,
            totalInstallments: s.totalInstallments,
            paidInstallmentsCount: s.paidInstallmentsCount,
            lastPaid: refOf(s.lastPaidInstallment),
            nextDue: refOf(s.nextDueInstallment),
            currentInstallmentRemaining: s.currentInstallmentRemaining,
            downPayment: s.downPayment,
            downPaymentRemaining: s.downPaymentRemaining,
            securityDeposit: s.securityDeposit,
            totalPaid: s.totalPaid,
            totalRemaining: s.totalRemaining,
          },
        ]
      })
    // contractSummary is re-bound whenever state changes
  }, [contracts, installments, contractSummary, look])
}

/** One API row → the shape the table and cards read. */
const summaryRowFromApi = (r: ApiInstallmentsSummaryRow): SummaryRow => ({
  id: String(r.id),
  number: r.number,
  status: r.status === 'cancelled' ? 'ملغي' : 'نشط',
  type: r.type === 'rent' ? 'إيجار' : 'بيع',
  clientId: r.client_id === null ? '' : String(r.client_id),
  clientName: r.client_name ?? '—',
  buildingId: r.building_id === null ? '' : String(r.building_id),
  unitNumber: r.unit_name ?? '—',
  startDate: r.start_date,
  endDate: r.end_date,
  upfront: r.type === 'rent' ? r.security_deposit : r.down_payment,
  upfrontRemaining: r.upfront_remaining,
  installmentsTotal: r.installments_total,
  contractValue: r.contract_value,
  unitPrice: r.unit_price,
  monthlyRent: r.monthly_rent,
  totalInstallments: r.total_installments,
  paidInstallmentsCount: r.paid_installments,
  lastPaid: r.last_paid_installment
    ? { seq: r.last_paid_installment.sequence_number, dueDate: r.last_paid_installment.due_date }
    : null,
  nextDue: r.next_due_installment
    ? { seq: r.next_due_installment.sequence_number, dueDate: r.next_due_installment.due_date }
    : null,
  currentInstallmentRemaining: r.current_installment_remaining,
  downPayment: r.down_payment,
  downPaymentRemaining: r.down_payment_remaining,
  securityDeposit: r.security_deposit,
  totalPaid: r.total_paid,
  totalRemaining: r.total_remaining,
})

const TC = 'kit-compact'
const HC = 'kit-th-wrap kit-compact'
const ctype = (h: string, key: string, minWidth: string, extra: Partial<Column<SummaryRow>> = {}): Column<SummaryRow> => ({ key, header: h, minWidth, headerClassName: HC, className: `${TC} kit-num`, ...extra })

/** Contract status as the API stores it; the prototype's مكتمل/منتهي/مجدد/مرتجع have no API state. */
const SUMMARY_STATUS: { value: string; label: string }[] = [
  { value: 'نشط', label: 'نشط' },
  { value: 'ملغي', label: 'ملغي' },
]
const STATUS_TO_API: Record<string, 'active' | 'cancelled'> = { 'نشط': 'active', 'ملغي': 'cancelled' }

const EMPTY_COUNTS: InstallmentsSummaryCounts = { all: 0, sale: 0, rent: 0 }

function SummaryView() {
  // ── Session ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => hasToken())
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Report rows (server) ─────────────────────────────────────────────────
  const [rows, setRows] = useState<SummaryRow[]>([])
  const [counts, setCounts] = useState<InstallmentsSummaryCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  const [kind, setKind] = useState<ContractType>('بيع')
  const [buildingId, setBuildingId] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  // ── Filter options (server) ──────────────────────────────────────────────
  const [buildingOptions, setBuildingOptions] = useState<{ value: string; label: string }[]>([])
  const [clientOptions, setClientOptions] = useState<{ value: string; label: string }[]>([])

  const lostSession = useCallback((notice: string) => {
    clearToken()
    setAuthed(false)
    setRows([])
    setLoginNotice(notice)
  }, [])

  const reloggedIn = useCallback(() => {
    setAuthed(true)
    setLoginNotice(null)
    setLoadError(null)
    setBuildingId('')
    setClientId(null)
    setStatus('')
    reload()
  }, [])

  useEffect(() => {
    if (!authed) return
    let alive = true
    Promise.all([fetchAllBuildings(), fetchAllClients()])
      .then(([buildings, clients]) => {
        if (!alive) return
        setBuildingOptions(buildings.map((b) => ({ value: String(b.id), label: b.name })))
        setClientOptions(clients.map((c) => ({ value: String(c.id), label: c.name })))
      })
      .catch(() => {
        // The report still works without the pickers' options.
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
    fetchInstallmentsSummary({
      type: kind === 'بيع' ? 'sale' : 'rent',
      buildingId: buildingId || undefined,
      clientId: clientId ?? undefined,
      status: status ? STATUS_TO_API[status] : undefined,
    })
      .then((result) => {
        if (!alive) return
        setRows(result.rows.map(summaryRowFromApi))
        setCounts(result.counts)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        setCounts(EMPTY_COUNTS)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل ملخص الأقساط والعقود')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, kind, buildingId, clientId, status, reloadKey])

  const k = useMemo(() => {
    const sum = (f: (r: SummaryRow) => number) => rows.reduce((s, r) => s + f(r), 0)
    const value = sum((r) => r.contractValue)
    const collected = sum((r) => r.totalPaid)
    return { value, collected, remaining: sum((r) => r.totalRemaining), dpRemaining: sum((r) => r.upfrontRemaining), rate: value ? Math.round((collected / value) * 100) : 0 }
  }, [rows])

  const columns = useMemo<Column<SummaryRow>[]>(() => {
    const client = (header: string): Column<SummaryRow> => ({
      key: 'clientName',
      header,
      minWidth: '9.5rem',
      headerClassName: `${HC} kit-sticky`,
      className: `${TC} kit-sticky font-semibold text-fg`,
    })
    const number = ctype(CODE_LABEL.contract, 'number', '6rem', { cell: (r) => <span className="font-semibold text-fg">{r.number}</span> })
    const unit = ctype('رقم الوحدة', 'unitNumber', '5.5rem')
    const paidCount = ctype('الأقساط المسددة', 'paidInstallmentsCount', '6.5rem', {
      align: 'end',
      csv: (r) => `${r.paidInstallmentsCount} من ${r.totalInstallments}`,
      cell: (r) => <>{r.paidInstallmentsCount} <span className="text-fg-3">من {r.totalInstallments}</span></>,
    })
    const last = ctype('آخر قسط مسدد', 'last', '8.5rem', {
      value: (r) => r.lastPaid?.dueDate ?? '',
      csv: (r) => seqDate(r.lastPaid, r.type),
      cell: (r) => <SeqDate i={r.lastPaid} type={r.type} />,
    })
    const next = ctype('القسط الحالي المطلوب سداده', 'next', '9rem', {
      value: (r) => r.nextDue?.dueDate ?? '',
      csv: (r) => seqDate(r.nextDue, r.type),
      cell: (r) => <SeqDate i={r.nextDue} type={r.type} due />,
    })
    const money = (header: string, key: keyof SummaryRow, min = '6.5rem', warn = false, bold = false): Column<SummaryRow> =>
      ctype(header, String(key), min, {
        align: 'end',
        value: (r) => r[key] as number,
        cell: (r) => <Money v={r[key] as number} warn={warn} bold={bold} />,
      })
    const dateCol = (header: string, key: 'startDate' | 'endDate'): Column<SummaryRow> =>
      ctype(header, key, '6.5rem', { align: 'end', value: (r) => r[key] ?? '', cell: (r) => (r[key] ? fmtDate(r[key]) : '-') })
    const curRemaining = money('متبقي القسط الشغال', 'currentInstallmentRemaining', '6.5rem', true)
    const totalRemaining = money('إجمالي المتبقي', 'totalRemaining', '7rem', false, true)
    return kind === 'بيع'
      ? [
          client('العميل'),
          number,
          serialColumn('contract', (r: SummaryRow) => r.number),
          unit,
          money('سعر الوحدة', 'unitPrice', '7rem'),
          money('المقدم', 'downPayment'),
          money('باقي المقدم', 'downPaymentRemaining', '6.5rem', true),
          money('إجمالي الأقساط', 'installmentsTotal', '7rem'),
          paidCount,
          last,
          next,
          curRemaining,
          totalRemaining,
        ]
      : [
          client('المستأجر'),
          number,
          serialColumn('contract', (r: SummaryRow) => r.number),
          unit,
          money('الإيجار الشهري', 'monthlyRent'),
          money('التأمين', 'securityDeposit'),
          dateCol('تاريخ البداية', 'startDate'),
          dateCol('تاريخ النهاية', 'endDate'),
          paidCount,
          last,
          next,
          curRemaining,
          totalRemaining,
        ]
  }, [kind])

  const active = !!(buildingId || clientId || status)
  const label = kind === 'بيع' ? 'عقود البيع' : 'عقود الإيجار'

  if (!authed) {
    return (
      <ApiLoginCard
        entity="ملخص الأقساط والعقود"
        icon={<IconFile size={20} />}
        notice={loginNotice}
        onLoggedIn={reloggedIn}
      />
    )
  }

  return (
    <>
      <FilterChips
        label="نوع العقود"
        options={SUMMARY_KINDS}
        value={kind === 'بيع' ? 'عقود البيع' : 'عقود الإيجار'}
        onChange={(v) => setKind(v === 'عقود البيع' ? 'بيع' : 'إيجار')}
        counts={{ 'عقود البيع': counts.sale, 'عقود الإيجار': counts.rent }}
      />
      <ReportFilterBar active={active} onReset={() => (setBuildingId(''), setClientId(null), setStatus(''))}>
        <Select label="المبنى" placeholder="كل المباني" options={buildingOptions} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <Combobox label={kind === 'بيع' ? 'العميل' : 'المستأجر'} placeholder="الكل" options={clientOptions} value={clientId} onChange={setClientId} clearable />
        <Select label="حالة العقد" placeholder="كل الحالات" options={SUMMARY_STATUS} value={status} onChange={(e) => setStatus(e.target.value)} />
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
        <SummaryCard label="عدد العقود" value={rows.length} icon={<IconFile size={20} />} hint={`قيمة ${egp(k.value)}`} />
        <SummaryCard label="إجمالي المحصل" value={k.collected} format={egp} tone="success" icon={<IconCheckCircle size={20} />} hint={`${k.rate}% من قيمة العقود`} />
        <SummaryCard label="إجمالي المتبقي" value={k.remaining} format={egp} tone="warning" icon={<IconWallet size={20} />} />
        <SummaryCard label={kind === 'بيع' ? 'باقي المقدمات' : 'باقي التأمينات'} value={k.dpRemaining} format={egp} tone="danger" icon={<IconAlert size={20} />} />
      </KpiGrid>
      <ChartCard title="المحصل مقابل المتبقي" description={`لكل ${label} المطابقة للفلاتر`}>
        <DonutChart
          label="توزيع قيمة العقود"
          format={egp}
          centerLabel="قيمة العقود"
          data={[
            { label: 'محصل', value: k.collected, tone: 'success' },
            { label: 'متبقي أقساط', value: Math.max(0, k.remaining - k.dpRemaining), tone: 'primary' },
            { label: kind === 'بيع' ? 'متبقي مقدم' : 'متبقي تأمين', value: k.dpRemaining, tone: 'warning' },
          ]}
        />
      </ChartCard>
      <ReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption={`ملخص الأقساط والعقود — ${label}`}
        loading={loading}
        searchPlaceholder="ابحث برقم العقد أو العميل أو الوحدة…"
        initialSort={{ key: 'number', dir: 'asc' }}
        emptyText="لا توجد عقود مطابقة."
      />
      <ReportActions title={`ملخص الأقساط والعقود — ${label}`} fileName={`ملخص-${label.replace(/\s+/g, '-')}`} columns={columns} rows={rows} shareText={`${rows.length} عقد · المحصل ${egp(k.collected)} · المتبقي ${egp(k.remaining)}`} />
    </>
  )
}

const SUMMARY_KINDS = ['عقود البيع', 'عقود الإيجار'] as const

/* ==================================================================
   عقود الإيجار
   ================================================================== */

type LeaseTab = 'النشطة' | 'المنتهية' | 'تنتهي خلال 30 يوم' | 'تنتهي خلال 60 يوم' | 'تنتهي خلال 90 يوم'
const LEASE_TABS: readonly LeaseTab[] = ['النشطة', 'المنتهية', 'تنتهي خلال 30 يوم', 'تنتهي خلال 60 يوم', 'تنتهي خلال 90 يوم']
const SOON_DAYS: Partial<Record<LeaseTab, number>> = { 'تنتهي خلال 30 يوم': 30, 'تنتهي خلال 60 يوم': 60, 'تنتهي خلال 90 يوم': 90 }

function LeasesView() {
  const all = useSummaryRows()
  const look = useLookups()
  const [tab, setTab] = useState<LeaseTab>('النشطة')
  const [buildingId, setBuildingId] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)

  const leases = useMemo(
    () =>
      all
        .filter((r) => r.type === 'إيجار' && r.endDate && (!buildingId || r.buildingId === buildingId) && (!clientId || r.clientId === clientId))
        .map((r) => ({ ...r, daysLeft: diffDays(r.endDate!, TODAY_ISO) })),
    [all, buildingId, clientId],
  )
  type Lease = (typeof leases)[number]
  const inTab = (r: Lease, t: LeaseTab) => {
    if (t === 'النشطة') return r.status === 'نشط'
    if (t === 'المنتهية') return r.status === 'منتهي' || r.status === 'مجدد' || (r.status === 'نشط' && r.daysLeft < 0)
    return r.status === 'نشط' && r.daysLeft >= 0 && r.daysLeft <= SOON_DAYS[t]!
  }
  const counts = useMemo(() => Object.fromEntries(LEASE_TABS.map((t) => [t, leases.filter((r) => inTab(r, t)).length])) as Record<LeaseTab, number>, [leases])
  const rows = useMemo(() => leases.filter((r) => inTab(r, tab)), [leases, tab])

  const columns = useMemo<Column<Lease>[]>(() => {
    const c = (header: string, key: string, minWidth: string, extra: Partial<Column<Lease>> = {}): Column<Lease> => ({ key, header, minWidth, headerClassName: HC, className: `${TC} kit-num`, ...extra })
    return [
      { key: 'clientName', header: 'المستأجر', minWidth: '9.5rem', headerClassName: `${HC} kit-sticky`, className: `${TC} kit-sticky font-semibold text-fg` },
      c(CODE_LABEL.contract, 'number', '6rem'),
      serialColumn('contract', (r: Lease) => r.number),
      c('رقم الوحدة', 'unitNumber', '5.5rem'),
      c('الإيجار الشهري', 'monthlyRent', '7rem', { align: 'end', cell: (r) => <Money v={r.monthlyRent} /> }),
      c('التأمين', 'securityDeposit', '6.5rem', { align: 'end', cell: (r) => <Money v={r.securityDeposit} /> }),
      c('تاريخ البداية', 'startDate', '6.5rem', { align: 'end', cell: (r) => fmtDate(r.startDate) }),
      c('تاريخ النهاية', 'endDate', '6.5rem', { align: 'end', cell: (r) => fmtDate(r.endDate) }),
      c('الأيام المتبقية', 'daysLeft', '7rem', {
        align: 'center',
        csv: (r) => (r.status !== 'نشط' ? '-' : r.daysLeft < 0 ? `انتهى منذ ${-r.daysLeft} يوم` : `${r.daysLeft} يوم`),
        cell: (r) =>
          r.status !== 'نشط' ? <span className="text-fg-3">-</span> : <StatusChip size="sm" status={r.daysLeft < 0 ? `انتهى منذ ${-r.daysLeft} يوم` : `${r.daysLeft} يوم`} tone={r.daysLeft < 0 ? 'red' : r.daysLeft <= 30 ? 'red' : r.daysLeft <= 60 ? 'yellow' : r.daysLeft <= 90 ? 'sky' : 'green'} />,
      }),
      c('متبقي الإيجار', 'totalRemaining', '7rem', { align: 'end', cell: (r) => <Money v={r.totalRemaining} warn /> }),
      c('الحالة', 'status', '5.5rem', { cell: (r) => <StatusChip status={r.status} tone={CONTRACT_TONE[r.status]} size="sm" /> }),
    ]
  }, [])

  const monthly = rows.reduce((s, r) => s + r.monthlyRent, 0)
  return (
    <>
      <FilterChips label="عرض عقود الإيجار" options={LEASE_TABS} value={tab} onChange={setTab} counts={counts} />
      <ReportFilterBar active={!!(buildingId || clientId)} onReset={() => (setBuildingId(''), setClientId(null))}>
        <Select label="المبنى" placeholder="كل المباني" options={look.buildingOptions} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <Combobox label="المستأجر" placeholder="الكل" options={look.clientOptions} value={clientId} onChange={setClientId} clearable />
      </ReportFilterBar>
      <KpiGrid>
        <SummaryCard label="عدد العقود" value={rows.length} icon={<IconFile size={20} />} />
        <SummaryCard label="الإيجار الشهري" value={monthly} format={egp} tone="success" icon={<IconWallet size={20} />} />
        <SummaryCard label="إجمالي التأمينات" value={rows.reduce((s, r) => s + r.securityDeposit, 0)} format={egp} tone="neutral" icon={<IconCheckCircle size={20} />} />
        <SummaryCard label="المتبقي من الإيجار" value={rows.reduce((s, r) => s + r.totalRemaining, 0)} format={egp} tone="warning" icon={<IconAlert size={20} />} />
      </KpiGrid>
      <ReportTable rows={rows} columns={columns} rowKey={(r) => r.id} caption={`عقود الإيجار — ${tab}`} searchPlaceholder="ابحث بالمستأجر أو رقم العقد أو الوحدة…" initialSort={{ key: tab === 'النشطة' || tab === 'المنتهية' ? 'number' : 'daysLeft', dir: 'asc' }} emptyText="لا توجد عقود إيجار في هذا العرض." />
      <ReportActions title={`عقود الإيجار — ${tab}`} fileName={`عقود-الإيجار-${tab.replace(/\s+/g, '-')}`} columns={columns} rows={rows} shareText={`${rows.length} عقد إيجار · إيجار شهري ${egp(monthly)}`} />
    </>
  )
}

function Money({ v, warn, bold }: { v: number; warn?: boolean; bold?: boolean }) {
  return <span className={`whitespace-nowrap tabular-nums ${bold ? 'font-bold text-fg' : ''} ${warn && v > 0 ? 'text-warning' : ''}`}>{egp(v)}</span>
}

function SeqDate({ i, type, due }: { i: InstallmentRef | null; type: ContractType; due?: boolean }) {
  if (!i) return <span className="text-fg-3">-</span>
  const late = due && i.dueDate < TODAY_ISO
  return (
    <span className="grid">
      <span className="tabular-nums font-semibold">{paymentLabel(type, i.seq)}</span>
      <span className={`t-caption tabular-nums ${late ? 'text-danger' : ''}`}>{fmtDate(i.dueDate)}</span>
    </span>
  )
}

/* ==================================================================
   2) الأقساط المستحقة والمتأخرة
   ================================================================== */

type Bucket = 'all' | '0-30' | '31-60' | '61-90' | '90+'
const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: '0-30', label: '0-30 يوم' },
  { value: '31-60', label: '31-60 يوم' },
  { value: '61-90', label: '61-90 يوم' },
  { value: '90+', label: '+90 يوم' },
]
const BUCKET_LABEL: Record<Exclude<Bucket, 'all'>, string> = { '0-30': '0-30 يوم', '31-60': '31-60 يوم', '61-90': '61-90 يوم', '90+': 'أكثر من 90 يوم' }

/** One late installment as the report prints it; the API already decided its bucket and days late. */
type AgingRow = {
  id: string
  contractId: string
  number: string
  type: ContractType
  clientId: string
  clientName: string
  unitNumber: string
  buildingName: string
  seq: number
  dueDate: ISODate
  amount: number
  paidAmount: number
  balance: number
  days: number
  bucket: Exclude<Bucket, 'all'>
}

const agingRowFromApi = (r: ApiDueOverdueRow): AgingRow => ({
  id: String(r.id),
  contractId: String(r.contract_id),
  number: r.contract_number,
  type: r.contract_type === 'rent' ? 'إيجار' : 'بيع',
  clientId: r.client_id === null ? '' : String(r.client_id),
  clientName: r.client_name ?? '—',
  unitNumber: r.unit_name ?? '—',
  buildingName: r.building_name ?? '—',
  seq: r.sequence_number,
  dueDate: r.due_date,
  amount: r.amount,
  paidAmount: r.paid_amount,
  balance: r.remaining,
  days: r.days_overdue,
  bucket: r.bucket,
})

function DelayChip({ days }: { days: number }) {
  return <StatusChip size="sm" status={days === 0 ? 'مستحق اليوم' : `${days} يوم`} tone={days === 0 ? 'indigo' : days <= 30 ? 'yellow' : 'red'} />
}

function AgingView() {
  const { settings } = useData()

  // ── Session ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => hasToken())
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Report rows (server) ─────────────────────────────────────────────────
  const [rows, setRows] = useState<AgingRow[]>([])
  const [meta, setMeta] = useState<DueOverdueMeta>(EMPTY_DUE_OVERDUE_META)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  const [bucket, setBucket] = useState<Bucket>('all')
  const [buildingId, setBuildingId] = useState('')
  const [clientId, setClientId] = useState<string | null>(null)

  // ── Filter options (server) ──────────────────────────────────────────────
  const [buildingOptions, setBuildingOptions] = useState<{ value: string; label: string }[]>([])
  const [clientOptions, setClientOptions] = useState<{ value: string; label: string }[]>([])

  const lostSession = useCallback((notice: string) => {
    clearToken()
    setAuthed(false)
    setRows([])
    setMeta(EMPTY_DUE_OVERDUE_META)
    setLoginNotice(notice)
  }, [])

  const reloggedIn = useCallback(() => {
    setAuthed(true)
    setLoginNotice(null)
    setLoadError(null)
    setBuildingId('')
    setClientId(null)
    setBucket('all')
    reload()
  }, [])

  useEffect(() => {
    if (!authed) return
    let alive = true
    Promise.all([fetchAllBuildings(), fetchAllClients()])
      .then(([buildings, clients]) => {
        if (!alive) return
        setBuildingOptions(buildings.map((b) => ({ value: String(b.id), label: b.name })))
        setClientOptions(clients.map((c) => ({ value: String(c.id), label: c.name })))
      })
      .catch(() => {
        // The report still works without the pickers' options.
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
    fetchDueOverdueReport({
      buildingId: buildingId || undefined,
      clientId: clientId ?? undefined,
      bucket: bucket === 'all' ? undefined : bucket,
    })
      .then((result) => {
        if (!alive) return
        setRows(result.rows.map(agingRowFromApi))
        setMeta(result.meta)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        setMeta(EMPTY_DUE_OVERDUE_META)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل الأقساط المستحقة والمتأخرة')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, buildingId, clientId, bucket, reloadKey])

  const totals = meta.buckets
  const clientsLate = useMemo(() => new Set(rows.filter((r) => r.days > 0).map((r) => r.clientId)).size, [rows])

  const columns = useMemo<Column<AgingRow>[]>(
    () => [
      { key: 'number', header: CODE_LABEL.contract, cell: (r) => <span className="font-semibold tabular-nums text-fg">{r.number}</span> },
      serialColumn('contract', (r: AgingRow) => r.number),
      { key: 'clientName', header: 'العميل' },
      { key: 'unitNumber', header: 'الوحدة' },
      { key: 'seq', header: 'الدفعة', value: (r) => r.seq, csv: (r) => paymentLabel(r.type, r.seq), cell: (r) => <span className="tabular-nums">{paymentLabel(r.type, r.seq)}</span> },
      { key: 'dueDate', header: 'تاريخ الاستحقاق', cell: (r) => <span className="tabular-nums">{fmtDate(r.dueDate)}</span> },
      { key: 'amount', header: 'قيمة الدفعة', align: 'end', cell: (r) => <Money v={r.amount} /> },
      { key: 'paidAmount', header: 'المسدد', align: 'end', cell: (r) => <Money v={r.paidAmount} /> },
      { key: 'balance', header: 'المتبقي', align: 'end', cell: (r) => <span className="font-bold tabular-nums text-fg">{egp(r.balance)}</span> },
      { key: 'days', header: 'أيام التأخير', align: 'center', cell: (r) => <DelayChip days={r.days} /> },
    ],
    [],
  )

  /** What the row opens into: the due row itself, plus a «تسجيل دفع» shortcut to the receipts screen. */
  const detail = useCallback(
    (r: AgingRow): RecordView =>
      compose(
        {
          title: r.clientName,
          subtitle: `${r.number} — ${paymentLabel(r.type, r.seq)}`,
          status: <DelayChip days={r.days} />,
          onEdit: () => goToReceipt(r.contractId, r.id),
          editLabel: 'تسجيل دفع',
        },
        [
          {
            key: 'due',
            title: 'بيانات الاستحقاق',
            icon: <IconInfo size={16} />,
            fields: [
              ['العقد', r.number],
              ['نوع العقد', r.type],
              ['العميل', r.clientName],
              ['الوحدة', r.unitNumber],
              ['المبنى', r.buildingName],
              ['الدفعة', paymentLabel(r.type, r.seq)],
              ['تاريخ الاستحقاق', fmtDate(r.dueDate)],
              ['أيام التأخير', r.days === 0 ? 'مستحق اليوم' : `${r.days} يوم`],
              ['فئة التأخير', BUCKET_LABEL[r.bucket]],
              ['قيمة الدفعة', egp(r.amount)],
              ['المسدد', egp(r.paidAmount)],
              ['المتبقي', egp(r.balance)],
            ],
          },
        ],
        'تفاصيل قسط مستحق',
        settings,
      ),
    [settings],
  )

  const active = !!(buildingId || clientId || bucket !== 'all')

  if (!authed) {
    return (
      <ApiLoginCard
        entity="الأقساط المستحقة والمتأخرة"
        icon={<IconAlert size={20} />}
        notice={loginNotice}
        onLoggedIn={reloggedIn}
      />
    )
  }

  return (
    <>
      <ReportFilterBar active={active} onReset={() => (setBuildingId(''), setClientId(null), setBucket('all'))}>
        <Select label="المبنى" placeholder="كل المباني" options={buildingOptions} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <Combobox label="العميل" placeholder="كل العملاء" options={clientOptions} value={clientId} onChange={setClientId} clearable />
        <div className="sm:col-span-2 lg:col-span-1 grid gap-1.5">
          <span className="t-label text-fg-2">مدة التأخير</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="مدة التأخير">
            {BUCKETS.map((b) => (
              <button
                key={b.value}
                type="button"
                role="radio"
                aria-checked={bucket === b.value}
                onClick={() => setBucket(b.value)}
                className={`t-caption rounded-full border px-3 py-1.5 font-semibold ${
                  bucket === b.value
                    ? 'border-transparent bg-[var(--primary)] text-white'
                    : 'border-[var(--hairline)] bg-[var(--field-bg)] text-fg-2 hover:text-fg'
                }`}
              >
                {b.label} <span className="tabular-nums opacity-75">({totals[b.value].count})</span>
              </button>
            ))}
          </div>
        </div>
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
        <SummaryCard label="إجمالي المستحق والمتأخر" value={totals[bucket].total} format={egp} tone="danger" icon={<IconAlert size={20} />} hint={`${totals[bucket].count} قسط`} />
        <SummaryCard label="متأخر أكثر من 90 يوم" value={totals['90+'].total} format={egp} tone="warning" icon={<IconCalendar size={20} />} hint={`${totals['90+'].count} قسط`} />
        <SummaryCard label="عملاء متأخرون" value={clientsLate} tone="neutral" icon={<IconFile size={20} />} />
        <SummaryCard label="يستحق خلال 7 أيام" value={meta.due_within_7_days.total} format={egp} icon={<IconWallet size={20} />} hint={`${meta.due_within_7_days.count} قسط`} />
      </KpiGrid>
      <ChartCard title="أعمار المديونية" description="توزيع المبالغ المتأخرة حسب مدة التأخير">
        <DonutChart
          label="أعمار المديونية"
          format={egp}
          centerLabel="إجمالي المتأخر"
          data={[
            { label: '0-30 يوم', value: totals['0-30'].total, tone: 'primary' },
            { label: '31-60 يوم', value: totals['31-60'].total, tone: 'warning' },
            { label: '61-90 يوم', value: totals['61-90'].total, tone: 'primary-2' },
            { label: '+90 يوم', value: totals['90+'].total, tone: 'danger' },
          ]}
        />
      </ChartCard>
      <ReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption="الأقساط المستحقة والمتأخرة"
        loading={loading}
        detail={detail}
        searchPlaceholder="ابحث بالعميل أو العقد أو الوحدة…"
        initialSort={{ key: 'days', dir: 'desc' }}
        emptyText="لا توجد أقساط مستحقة أو متأخرة."
      />
      <ReportActions title="الأقساط المستحقة والمتأخرة" fileName="الأقساط-المتأخرة" lateRow={(r) => r.days > 0} columns={columns} rows={rows} shareText={`${rows.length} قسط متأخر بإجمالي ${egp(totals[bucket].total)}`} />
    </>
  )
}

/* ==================================================================
   3) الإيرادات الشهرية
   ================================================================== */

/** One month of the API rollup, named for the table. */
type MonthRow = {
  id: string
  month: string
  /** Payment lines; a receipt may carry several. */
  payments: number
  /** Distinct receipt numbers — a deposit or a direct payment has none. */
  receipts: number
  reservations: number
  downPayments: number
  installments: number
  total: number
  cancelled: number
  cumulative: number
}

const monthRowFromApi = (m: ApiMonthlyRevenueMonth): MonthRow => ({
  id: m.month,
  month: m.month,
  payments: m.payments,
  receipts: m.receipts,
  reservations: m.reservations,
  downPayments: m.down_payments,
  installments: m.installments,
  total: m.total,
  cancelled: m.cancelled,
  cumulative: m.cumulative,
})

function MonthlyView() {
  const [today] = useState(() => toISO(new Date()))
  // The screen has no date pickers: it shows the last 12 calendar months up to today.
  const period = useMemo(() => {
    const months = lastMonths(12, today)
    return { from: `${months[0]}-01`, to: addDays(addMonths(`${months[months.length - 1]}-01`, 1), -1) }
  }, [today])

  // ── Session ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => hasToken())
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Report (server) ──────────────────────────────────────────────────────
  const [data, setData] = useState<ApiMonthlyRevenue | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  const [buildingId, setBuildingId] = useState('')
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
    fetchMonthlyRevenue({ from: period.from, to: period.to, buildingId: buildingId || undefined })
      .then((result) => {
        if (alive) setData(result)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setData(null)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل الإيرادات الشهرية')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, buildingId, period.from, period.to, reloadKey])

  const rows = useMemo<MonthRow[]>(() => (data?.months ?? []).map(monthRowFromApi), [data])
  const totals = data?.totals ?? null

  const currentMonth = today.slice(0, 7)
  const current = rows.find((r) => r.month === currentMonth) ?? null
  const previousMonth = addMonths(`${currentMonth}-01`, -1).slice(0, 7)
  const previous = rows.find((r) => r.month === previousMonth) ?? null
  const trend =
    current && previous && previous.total > 0
      ? Math.round(((current.total - previous.total) / previous.total) * 100)
      : null
  const best = rows.reduce<MonthRow | null>((a, b) => (!a || b.total > a.total ? b : a), null)
  const total = totals?.total ?? 0
  const last6 = rows.slice(-6)
  const base = rows.slice(0, -6).reduce((s, r) => s + r.total, 0)

  const columns = useMemo<Column<MonthRow>[]>(() => {
    const cols: Column<MonthRow>[] = [
      { key: 'month', header: 'الشهر', value: (r) => r.month, csv: (r) => monthLabel(r.month), cell: (r) => <span className="font-semibold text-fg">{monthLabel(r.month)}</span> },
      { key: 'payments', header: 'عدد الدفعات', align: 'center', cell: (r) => <span className="tabular-nums">{r.payments}</span> },
      { key: 'receipts', header: 'عدد الإيصالات', align: 'center', cell: (r) => <span className="tabular-nums">{r.receipts}</span> },
      { key: 'reservations', header: 'دفعات الحجز', align: 'end', cell: (r) => <Money v={r.reservations} /> },
      { key: 'downPayments', header: 'مقدمات وتأمينات', align: 'end', cell: (r) => <Money v={r.downPayments} /> },
      { key: 'installments', header: 'أقساط وإيجارات', align: 'end', cell: (r) => <Money v={r.installments} /> },
      { key: 'total', header: 'الإجمالي', align: 'end', cell: (r) => <Money v={r.total} bold /> },
      { key: 'cumulative', header: 'التراكمي', align: 'end', cell: (r) => <Money v={r.cumulative} /> },
    ]
    // Cancelled lines are only worth a column when the period has any.
    if (totals && totals.cancelled > 0) {
      cols.push({ key: 'cancelled', header: 'ملغي (لا يُحتسب)', align: 'end', cell: (r) => <Money v={r.cancelled} warn /> })
    }
    return cols
  }, [totals])

  if (!authed) {
    return (
      <ApiLoginCard
        entity="الإيرادات الشهرية"
        icon={<IconWallet size={20} />}
        notice={loginNotice}
        onLoggedIn={reloggedIn}
      />
    )
  }

  return (
    <>
      <ReportFilterBar active={!!buildingId} onReset={() => setBuildingId('')}>
        <Select label="المبنى" placeholder="كل المباني" options={buildingOptions} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
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
        <SummaryCard label="إيرادات آخر 12 شهر" value={total} format={egp} icon={<IconWallet size={20} />} hint={`عدد الدفعات: ${totals?.payments ?? 0} · عدد الإيصالات: ${totals?.receipts ?? 0}`} />
        <SummaryCard
          label={`إيرادات ${monthLabel(currentMonth)}`}
          value={current?.total ?? 0}
          format={egp}
          tone="success"
          icon={<IconTrendUp size={20} />}
          trend={trend !== null ? { value: trend, label: 'عن الشهر السابق' } : undefined}
        />
        <SummaryCard label="متوسط شهري" value={Math.round(total / 12)} format={egp} tone="neutral" icon={<IconCalendar size={20} />} />
        <SummaryCard label="أفضل شهر" value={best?.total ?? 0} format={egp} tone="warning" icon={<IconCheckCircle size={20} />} hint={best ? monthLabel(best.month) : undefined} />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <ChartCard title="الإيرادات الشهرية" description={`المحصّل فعليًا · ${monthLabel(period.from.slice(0, 7))} — ${monthLabel(period.to.slice(0, 7))}`}>
          <BarChart label="الإيرادات المحصلة لكل شهر" format={egp} data={rows.map((r) => ({ label: monthLabel(r.month, true), title: monthLabel(r.month), value: r.total }))} />
        </ChartCard>
        <ChartCard title="الاتجاه التراكمي" description="آخر 6 أشهر">
          <AreaChart label="الإيرادات التراكمية لآخر 6 أشهر" format={egp} data={last6.map((r) => ({ label: monthLabel(r.month, true), title: monthLabel(r.month), value: r.cumulative - base }))} />
        </ChartCard>
      </div>
      <ReportTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="الإيرادات الشهرية" searchable={false} loading={loading} initialSort={{ key: 'month', dir: 'desc' }} emptyText="لا توجد تحصيلات في هذه الفترة." />
      {totals && (totals.cancelled > 0 || totals.receipts !== totals.payments) && (
        <p className="t-caption px-1">
          {totals.cancelled > 0 &&
            `المبلغ الملغي (${egp(totals.cancelled)}) يُحسب في شهر الإلغاء ولا يدخل في الإيرادات. `}
          {totals.receipts !== totals.payments &&
            `عدد الإيصالات (${totals.receipts}) أقل من عدد الدفعات (${totals.payments}) لأن دفعات الحجز والدفعات المسجلة مباشرة على القسط بلا إيصال — ومبالغها محسوبة كاملة.`}
        </p>
      )}
      <ReportActions
        title="الإيرادات الشهرية"
        fileName="الإيرادات-الشهرية"
        columns={columns}
        rows={rows}
        details={[
          ['الفترة', `${fmtDate(period.from)} — ${fmtDate(period.to)}`],
          ['المبنى', buildingOptions.find((b) => b.value === buildingId)?.label ?? 'كل المباني'],
          ['إجمالي المحصّل', egp(total)],
        ]}
        shareText={`إيرادات ${monthLabel(period.from.slice(0, 7))} — ${monthLabel(period.to.slice(0, 7))}: ${egp(total)}`}
      />
    </>
  )
}

/* ==================================================================
   4) التحصيل اليومي
   ================================================================== */

/** One collected line as the table prints it. */
type ReceiptRow = {
  id: string
  date: ISODate | null
  receiptNumber: string | null
  number: string
  clientName: string
  unitName: string
  buildingName: string
  kind: string
  method: string
  amount: number
}

/** One cancelled line: kept apart because it is not collected money. */
type CancelledRow = {
  id: string
  date: ISODate | null
  cancelledAt: ISODate | null
  receiptNumber: string | null
  number: string
  clientName: string
  unitName: string
  kind: string
  method: string
  amount: number
  reason: string
}

const METHOD_TONES: DonutTone[] = ['success', 'primary', 'warning', 'danger', 'primary-2', 'neutral']

const methodLabel = (method: string) => PAYMENT_METHOD_FROM_API[method] ?? method

const contractTypeOf = (type: 'sale' | 'rent' | null): ContractType => (type === 'rent' ? 'إيجار' : 'بيع')

/** «دفعة حجز» / «المقدم» / «التأمين» / «القسط 3» — what the line paid. */
function kindOf(p: Pick<ApiCollectionPayment, 'payment_type' | 'contract_type' | 'sequence_number'>): string {
  if (p.payment_type === 'reservation') return 'دفعة حجز'
  const type = contractTypeOf(p.contract_type)
  if (p.payment_type === 'down_payment') return upfrontLabel(type)
  return paymentLabel(type, p.sequence_number ?? 1)
}

const receiptRowFromApi = (p: ApiCollectionPayment): ReceiptRow => ({
  id: String(p.id),
  date: p.paid_at,
  receiptNumber: p.receipt_number,
  number: p.contract_number ?? '—',
  clientName: p.client_name ?? '—',
  unitName: p.unit_name ?? '—',
  buildingName: p.building_name ?? '—',
  kind: kindOf(p),
  method: methodLabel(p.method),
  amount: p.amount,
})

const cancelledRowFromApi = (p: ApiCancelledCollectionPayment): CancelledRow => ({
  id: `c-${p.id}`,
  date: p.paid_at,
  cancelledAt: p.cancelled_at,
  receiptNumber: p.receipt_number,
  number: p.contract_number ?? '—',
  clientName: p.client_name ?? '—',
  unitName: p.unit_name ?? '—',
  kind: kindOf(p),
  method: methodLabel(p.method),
  amount: p.amount,
  reason: p.cancel_reason ?? '—',
})

function DailyView() {
  const [today] = useState(() => toISO(new Date()))
  const defaultFrom = addDays(today, -29)

  // ── Session ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => hasToken())
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Report (server) ──────────────────────────────────────────────────────
  const [data, setData] = useState<ApiDailyCollection | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  const [buildingId, setBuildingId] = useState('')
  const [buildingOptions, setBuildingOptions] = useState<{ value: string; label: string }[]>([])
  const [from, setFrom] = useState<ISODate | null>(defaultFrom)
  const [to, setTo] = useState<ISODate | null>(today)

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
    setFrom(defaultFrom)
    setTo(today)
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFrom, today])

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
    if (!from || !to) {
      setData(null)
      return
    }
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchDailyCollection({ from, to, buildingId: buildingId || undefined })
      .then((result) => {
        if (alive) setData(result)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setData(null)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل التحصيل اليومي')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, buildingId, from, to, reloadKey])

  const rows = useMemo<ReceiptRow[]>(() => (data?.payments ?? []).map(receiptRowFromApi), [data])
  const cancelled = useMemo<CancelledRow[]>(() => (data?.cancelled_payments ?? []).map(cancelledRowFromApi), [data])
  const summary = data?.summary ?? null
  const total = summary?.collected ?? 0
  const days = summary?.days ?? 1

  /** The bar chart fills the last 14 days of the period, zero days included. */
  const daily = useMemo(() => {
    const end = to ?? today
    const start = from ?? end
    const span = Math.min(14, Math.max(1, diffDays(end, start) + 1))
    const first = addDays(end, -(span - 1))
    const amounts = new Map((data?.by_day ?? []).map((d) => [d.date, d.amount]))
    return Array.from({ length: span }, (_, i) => {
      const d = addDays(first, i)
      return { label: d.slice(8), title: fmtDate(d), value: amounts.get(d) ?? 0 }
    })
  }, [data, from, to, today])

  const byMethod = useMemo(
    () =>
      (data?.by_method ?? []).map((m, i) => ({
        label: methodLabel(m.method),
        value: m.amount,
        tone: METHOD_TONES[i % METHOD_TONES.length],
      })),
    [data],
  )

  const columns = useMemo<Column<ReceiptRow>[]>(
    () => [
      { key: 'date', header: 'التاريخ', cell: (r) => <span className="tabular-nums">{r.date ? fmtDate(r.date) : '—'}</span> },
      {
        key: 'receiptNumber',
        header: CODE_LABEL.receipt,
        value: (r) => r.receiptNumber ?? '',
        csv: (r) => r.receiptNumber ?? '',
        cell: (r) => <span className="tabular-nums font-semibold text-fg">{r.receiptNumber ?? '—'}</span>,
      },
      serialColumn('receipt', (r: ReceiptRow) => r.receiptNumber ?? ''),
      { key: 'number', header: CODE_LABEL.contract, cell: (r) => <span className="tabular-nums">{r.number}</span> },
      { key: 'clientName', header: 'العميل' },
      { key: 'unitName', header: 'الوحدة' },
      { key: 'buildingName', header: 'المبنى' },
      { key: 'kind', header: 'البيان' },
      { key: 'method', header: 'طريقة الدفع' },
      { key: 'amount', header: 'المبلغ', align: 'end', cell: (r) => <span className="font-bold tabular-nums text-fg">{egp(r.amount)}</span> },
    ],
    [],
  )

  const cancelledColumns = useMemo<Column<CancelledRow>[]>(
    () => [
      { key: 'date', header: 'تاريخ الدفع', cell: (r) => <span className="tabular-nums">{r.date ? fmtDate(r.date) : '—'}</span> },
      { key: 'cancelledAt', header: 'تاريخ الإلغاء', cell: (r) => <span className="tabular-nums">{r.cancelledAt ? fmtDate(r.cancelledAt) : '—'}</span> },
      {
        key: 'receiptNumber',
        header: CODE_LABEL.receipt,
        value: (r) => r.receiptNumber ?? '',
        csv: (r) => r.receiptNumber ?? '',
        cell: (r) => <span className="tabular-nums">{r.receiptNumber ?? '—'}</span>,
      },
      { key: 'number', header: CODE_LABEL.contract, cell: (r) => <span className="tabular-nums">{r.number}</span> },
      { key: 'clientName', header: 'العميل' },
      { key: 'unitName', header: 'الوحدة' },
      { key: 'kind', header: 'البيان' },
      { key: 'method', header: 'طريقة الدفع' },
      { key: 'amount', header: 'المبلغ', align: 'end', cell: (r) => <Money v={r.amount} warn /> },
      { key: 'reason', header: 'سبب الإلغاء' },
    ],
    [],
  )

  const active = !!buildingId || from !== defaultFrom || to !== today

  if (!authed) {
    return (
      <ApiLoginCard
        entity="التحصيل اليومي"
        icon={<IconWallet size={20} />}
        notice={loginNotice}
        onLoggedIn={reloggedIn}
      />
    )
  }

  return (
    <>
      <ReportFilterBar active={active} onReset={() => (setBuildingId(''), setFrom(defaultFrom), setTo(today))}>
        <Select label="المبنى" placeholder="كل المباني" options={buildingOptions} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <DatePicker label="من تاريخ" value={from} onChange={setFrom} max={to ?? undefined} clearable />
        <DatePicker label="إلى تاريخ" value={to} onChange={setTo} min={from ?? undefined} clearable />
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
        <SummaryCard label="إجمالي التحصيل للفترة" value={total} format={egp} icon={<IconWallet size={20} />} hint={`${summary?.lines ?? 0} دفعة على ${days} يوم`} />
        <SummaryCard
          label="الصافي بعد الملغي"
          value={summary?.net ?? 0}
          format={egp}
          tone="success"
          icon={<IconCheckCircle size={20} />}
          hint={summary && summary.cancelled > 0 ? `استُبعد ${egp(summary.cancelled)} ملغي` : 'لا توجد حركات ملغاة'}
        />
        <SummaryCard label="عدد الإيصالات" value={summary?.receipts ?? 0} tone="neutral" icon={<IconFile size={20} />} hint="الدفعات بلا إيصال محسوبة أيضًا" />
        <SummaryCard label="متوسط يومي" value={Math.round(total / Math.max(1, days))} format={egp} tone="warning" icon={<IconCalendar size={20} />} hint={`على ${days} يوم`} />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <ChartCard title="التحصيل اليومي" description={days > 14 ? `آخر 14 يوم حتى ${to ? fmtDate(to) : fmtDate(today)}` : `كل أيام الفترة (${days})`}>
          <BarChart label="التحصيل اليومي للفترة" format={egp} data={daily} />
        </ChartCard>
        <ChartCard title="حسب طريقة الدفع" description={summary ? `${summary.lines} دفعة` : undefined}>
          <DonutChart label="التحصيل حسب طريقة الدفع" format={egp} centerLabel="إجمالي التحصيل" data={byMethod} />
        </ChartCard>
      </div>
      <ReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption="دفعات الفترة"
        loading={loading}
        searchPlaceholder="ابحث برقم الإيصال أو العميل أو العقد…"
        initialSort={{ key: 'date', dir: 'desc' }}
        emptyText="لا توجد دفعات في هذه الفترة."
      />
      {summary && summary.lines !== summary.receipts && (
        <p className="t-caption px-1">
          {summary.lines} دفعة على {summary.receipts} إيصال — لأن دفعات الحجز والدفعات المسجلة مباشرة على القسط بلا إيصال، ومبالغها محسوبة كاملة.
        </p>
      )}
      {cancelled.length > 0 && (
        <div className="grid gap-2">
          <h3 className="t-section px-1">دفعات ملغاة</h3>
          <p className="t-caption px-1">
            {cancelled.length} دفعة بإجمالي {egp(summary?.cancelled ?? 0)} — مسجلة للإيضاح فقط ولا تدخل في التحصيل.
          </p>
          <ReportTable
            rows={cancelled}
            columns={cancelledColumns}
            rowKey={(r) => r.id}
            caption="دفعات ملغاة"
            searchable={false}
            initialSort={{ key: 'cancelledAt', dir: 'desc' }}
            emptyText="لا توجد دفعات ملغاة."
          />
        </div>
      )}
      <ReportActions
        title="التحصيل اليومي"
        fileName="التحصيل-اليومي"
        columns={columns}
        rows={rows}
        details={[
          ['الفترة', from && to ? `${fmtDate(from)} — ${fmtDate(to)}` : '—'],
          ['المبنى', buildingOptions.find((b) => b.value === buildingId)?.label ?? 'كل المباني'],
          ['إجمالي التحصيل', egp(total)],
          ['الملغي', egp(summary?.cancelled ?? 0)],
        ]}
        shareText={`تحصيل ${from ? fmtDate(from) : '—'} — ${to ? fmtDate(to) : '—'}: ${egp(total)} (${summary?.lines ?? 0} دفعة)`}
      />
    </>
  )
}
