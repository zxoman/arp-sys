import { useMemo, useState, type ReactNode } from 'react'
import { useData, egp, fmtDate, paymentLabel, upfrontLabel, type Client, type ISODate } from '@/lib'
import { TODAY_ISO } from '@/lib/domain'
import { Combobox, DatePicker, GlassSurface, IconBuilding, IconCheckCircle, IconFile, IconLayers, IconPhone, IconUsers, IconWallet, LiquidTabs, Select, SummaryCard, type Column } from '@/kit'
import { BarChart, DonutChart } from '@/kit/charts'
import { Text } from '@/components/ui'
import { ChartCard, KpiGrid, ReportActions, ReportFilterBar, ReportTable, inRange, lastMonths, monthLabel } from './shared'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL } from '@/lib/codes'

type View = 'owners' | 'distribution' | 'statement'
const VIEWS: { value: View; label: string; screen: string }[] = [
  { value: 'owners', label: 'الملاك ووحداتهم', screen: 'report-owner-units' },
  { value: 'distribution', label: 'توزيع الإيرادات', screen: 'report-revenue-distribution' },
  { value: 'statement', label: 'كشف حساب مالك', screen: 'report-owner-statement' },
]
/** Sale contracts in these states count as sales. */
const SOLD = new Set(['نشط', 'مكتمل'])

/**
 * Owners are clients of type مالك, plus anyone a building still lists as a shareholder. `shares`
 * maps each owner to their percent of every building they hold a share of.
 */
function useOwners() {
  const { clients, buildings } = useData()
  return useMemo(() => {
    const shares = new Map<string, Map<string, number>>()
    for (const b of buildings)
      for (const s of b.ownerShares) {
        const m = shares.get(s.clientId) ?? new Map<string, number>()
        m.set(b.id, s.share)
        shares.set(s.clientId, m)
      }
    const owners: Client[] = clients.filter((c) => c.type === 'مالك' || shares.has(c.id))
    return { owners, shares, sharesOf: (id: string) => shares.get(id) ?? new Map<string, number>() }
  }, [clients, buildings])
}

/**
 * Receipts with their building, shared by all three views. A lease's security deposit is refundable,
 * so it isn't revenue and is left out.
 */
function useReceipts() {
  const { payments, contracts, units, clients, installments } = useData()
  return useMemo(() => {
    const con = new Map(contracts.map((c) => [c.id, c]))
    const unit = new Map(units.map((u) => [u.id, u]))
    const client = new Map(clients.map((c) => [c.id, c.fullName]))
    const seq = new Map(installments.map((i) => [i.id, i.seq]))
    return payments.flatMap((p) => {
      const c = con.get(p.contractId)
      const u = c && unit.get(c.unitId)
      if (!c || !u || (c.type === 'إيجار' && p.installmentId === null)) return []
      const kind = p.installmentId === null ? upfrontLabel(c.type) : paymentLabel(c.type, seq.get(p.installmentId) ?? 0)
      return [{ ...p, buildingId: u.buildingId, unitNumber: u.number, contract: c.number, clientName: client.get(c.clientId) ?? '—', kind }]
    })
  }, [payments, contracts, units, clients, installments])
}

export default function ReportOwners({ screen }: { screen?: { id: string } }) {
  const [view, setView] = useState<View>(VIEWS.find((v) => v.screen === screen?.id)?.value ?? 'owners')
  return (
    <div className="grid gap-4">
      <LiquidTabs label="عرض التقرير" items={VIEWS} value={view} onChange={setView} className="print:hidden" />
      {view === 'owners' && <OwnersView />}
      {view === 'distribution' && <DistributionView />}
      {view === 'statement' && <StatementView />}
    </div>
  )
}

const pctFmt = (n: number) => `${Math.round(n * 10) / 10}%`
/** `برج النيل (60%)، ...` for an owner's holdings. */
const holdingsText = (holdings: Map<string, number>, bName: Map<string, string>) =>
  [...holdings].map(([b, pct]) => `${bName.get(b) ?? b} (${pctFmt(pct)})`).join('، ')

/* ==================================================================
   الملاك ووحداتهم
   ================================================================== */

type OwnerRow = {
  id: string
  name: string
  phone: string
  /** The share when the owner holds one building (or one is filtered); null for several different shares. */
  pct: number | null
  buildings: string
  units: number
  sold: number
  rented: number
  available: number
  salesValue: number
  salesShare: number
  collectedShare: number
}

function OwnersView() {
  const { buildings, units, contracts } = useData()
  const { owners, sharesOf } = useOwners()
  const receipts = useReceipts()
  const [buildingId, setBuildingId] = useState('')

  const rows = useMemo<OwnerRow[]>(() => {
    const bName = new Map(buildings.map((b) => [b.id, b.name]))
    const unitBuilding = new Map(units.map((u) => [u.id, u.buildingId]))
    const salesBy = new Map<string, number>()
    for (const c of contracts)
      if (c.type === 'بيع' && SOLD.has(c.status)) {
        const b = unitBuilding.get(c.unitId)
        if (b) salesBy.set(b, (salesBy.get(b) ?? 0) + c.unitPrice)
      }
    const collectedBy = new Map<string, number>()
    for (const r of receipts) collectedBy.set(r.buildingId, (collectedBy.get(r.buildingId) ?? 0) + r.amount)
    return owners.flatMap((o) => {
      const holdings = new Map([...sharesOf(o.id)].filter(([b]) => !buildingId || b === buildingId))
      if (buildingId && !holdings.size) return []
      const mine = units.filter((u) => holdings.has(u.buildingId))
      const pcts = new Set(holdings.values())
      const byShare = (m: Map<string, number>) => Math.round([...holdings].reduce((s, [b, pct]) => s + ((m.get(b) ?? 0) * pct) / 100, 0))
      return [
        {
          id: o.id,
          name: o.fullName,
          phone: o.phone,
          pct: pcts.size === 1 ? [...pcts][0] : null,
          buildings: holdingsText(holdings, bName),
          units: mine.length,
          sold: mine.filter((u) => u.status === 'مباعة').length,
          rented: mine.filter((u) => u.status === 'مؤجرة').length,
          available: mine.filter((u) => u.status === 'متاحة').length,
          salesValue: [...holdings.keys()].reduce((s, b) => s + (salesBy.get(b) ?? 0), 0),
          salesShare: byShare(salesBy),
          collectedShare: byShare(collectedBy),
        },
      ]
    })
  }, [owners, sharesOf, buildings, units, contracts, receipts, buildingId])

  const sum = (f: (r: OwnerRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  const columns = useMemo<Column<OwnerRow>[]>(
    () => [
      { key: 'name', header: 'المالك', cell: (r) => <span className="font-semibold text-fg">{r.name}</span> },
      { key: 'phone', header: 'الهاتف', cell: (r) => <bdi dir="ltr" className="tabular-nums">{r.phone || '—'}</bdi> },
      { key: 'buildings', header: 'المباني والحصص', cell: (r) => <span className="line-clamp-1 max-w-[16rem]" title={r.buildings}>{r.buildings || '—'}</span> },
      {
        key: 'pct',
        header: 'نسبة الملكية',
        align: 'center',
        value: (r) => r.pct,
        csv: (r) => (r.pct == null ? (r.buildings ? 'متعددة' : '—') : pctFmt(r.pct)),
        cell: (r) => <span className="tabular-nums">{r.pct == null ? (r.buildings ? 'متعددة' : '—') : pctFmt(r.pct)}</span>,
      },
      { key: 'units', header: 'الوحدات', align: 'center' },
      { key: 'sold', header: 'المباعة', align: 'center' },
      { key: 'rented', header: 'المؤجرة', align: 'center' },
      { key: 'available', header: 'المتاحة', align: 'center' },
      { key: 'salesValue', header: 'قيمة المبيعات', align: 'end', cell: (r) => <span className="tabular-nums">{egp(r.salesValue)}</span> },
      { key: 'salesShare', header: 'حصته من المبيعات', align: 'end', cell: (r) => <span className="tabular-nums">{egp(r.salesShare)}</span> },
      { key: 'collectedShare', header: 'حصته من المحصل', align: 'end', cell: (r) => <span className="font-bold tabular-nums text-fg">{egp(r.collectedShare)}</span> },
    ],
    [],
  )

  return (
    <>
      <ReportFilterBar active={!!buildingId} onReset={() => setBuildingId('')}>
        <Select label="المبنى" placeholder="كل المباني" options={buildings.map((b) => ({ value: b.id, label: b.name }))} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
      </ReportFilterBar>
      <KpiGrid>
        <SummaryCard label="عدد الملاك" value={rows.length} icon={<IconUsers size={20} />} />
        <SummaryCard label="وحدات الملاك" value={sum((r) => r.units)} tone="neutral" icon={<IconLayers size={20} />} hint={`${sum((r) => r.sold)} مباعة · ${sum((r) => r.rented)} مؤجرة`} />
        <SummaryCard label="حصص المبيعات" value={sum((r) => r.salesShare)} format={egp} tone="warning" icon={<IconBuilding size={20} />} />
        <SummaryCard label="حصص المحصل" value={sum((r) => r.collectedShare)} format={egp} tone="success" icon={<IconWallet size={20} />} />
      </KpiGrid>
      <ChartCard title="حصة كل مالك من المبيعات">
        <BarChart label="حصة كل مالك من المبيعات" format={egp} data={[...rows].sort((a, b) => b.salesShare - a.salesShare).slice(0, 12).map((r) => ({ label: r.name.split(' ')[0], title: r.name, value: r.salesShare }))} />
      </ChartCard>
      <ReportTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="الملاك ووحداتهم" searchPlaceholder="ابحث باسم المالك أو المبنى…" initialSort={{ key: 'salesShare', dir: 'desc' }} emptyText="لا يوجد ملاك." />
      <ReportActions title="الملاك ووحداتهم" fileName="الملاك-ووحداتهم" columns={columns} rows={rows} shareText={`${rows.length} مالك · حصص المبيعات ${egp(sum((r) => r.salesShare))}`} />
    </>
  )
}

/* ==================================================================
   توزيع الإيرادات
   ================================================================== */

type DistRow = { id: string; owner: string; building: string; revenue: number; pct: number; share: number }

function DistributionView() {
  const { buildings, clients } = useData()
  const receipts = useReceipts()
  const [buildingId, setBuildingId] = useState('')
  const [from, setFrom] = useState<ISODate | null>(null)
  const [to, setTo] = useState<ISODate | null>(null)

  const revenueBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of receipts) if (inRange(r.date, from, to)) m.set(r.buildingId, (m.get(r.buildingId) ?? 0) + r.amount)
    return m
  }, [receipts, from, to])

  const rows = useMemo<DistRow[]>(() => {
    const cName = new Map(clients.map((c) => [c.id, c.fullName]))
    return buildings
      .filter((b) => !buildingId || b.id === buildingId)
      .flatMap((b) =>
        b.ownerShares.map((s) => {
          const revenue = revenueBy.get(b.id) ?? 0
          return { id: `${s.clientId}-${b.id}`, owner: cName.get(s.clientId) ?? '—', building: b.name, revenue, pct: s.share, share: Math.round((revenue * s.share) / 100) }
        }),
      )
  }, [clients, buildings, revenueBy, buildingId])

  const revenue = buildingId ? (revenueBy.get(buildingId) ?? 0) : [...revenueBy.values()].reduce((s, v) => s + v, 0)
  const distributed = rows.reduce((s, r) => s + r.share, 0)
  const donut = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.owner, (m.get(r.owner) ?? 0) + r.share)
    const list = [...m].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
    const rest = revenue - distributed
    return rest > 0 ? [...list, { label: 'غير موزع (الشركة)', value: rest, tone: 'neutral' as const }] : list
  }, [rows, revenue, distributed])

  const columns = useMemo<Column<DistRow>[]>(
    () => [
      { key: 'owner', header: 'المالك', cell: (r) => <span className="font-semibold text-fg">{r.owner}</span> },
      { key: 'building', header: 'المبنى' },
      { key: 'revenue', header: 'إيرادات المبنى', align: 'end', cell: (r) => <span className="tabular-nums">{egp(r.revenue)}</span> },
      { key: 'pct', header: 'نسبة الملكية', align: 'center', value: (r) => r.pct, cell: (r) => <span className="tabular-nums">{pctFmt(r.pct)}</span> },
      { key: 'share', header: 'حصة المالك', align: 'end', cell: (r) => <span className="font-bold tabular-nums text-fg">{egp(r.share)}</span> },
    ],
    [],
  )

  return (
    <>
      <ReportFilterBar active={!!(buildingId || from || to)} onReset={() => (setBuildingId(''), setFrom(null), setTo(null))}>
        <Select label="المبنى" placeholder="كل المباني" options={buildings.map((b) => ({ value: b.id, label: b.name }))} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <DatePicker label="من تاريخ" value={from} onChange={setFrom} max={to ?? undefined} today={TODAY_ISO} clearable />
        <DatePicker label="إلى تاريخ" value={to} onChange={setTo} min={from ?? undefined} today={TODAY_ISO} clearable />
      </ReportFilterBar>
      <KpiGrid>
        <SummaryCard label="إجمالي الإيرادات" value={revenue} format={egp} icon={<IconWallet size={20} />} />
        <SummaryCard label="الموزع على الملاك" value={distributed} format={egp} tone="success" icon={<IconCheckCircle size={20} />} hint={revenue ? `${Math.round((distributed / revenue) * 100)}% من الإيرادات` : undefined} />
        <SummaryCard label="غير موزع" value={Math.max(0, revenue - distributed)} format={egp} tone="neutral" icon={<IconBuilding size={20} />} />
        <SummaryCard label="عدد الملاك" value={new Set(rows.map((r) => r.owner)).size} tone="warning" icon={<IconUsers size={20} />} />
      </KpiGrid>
      <ChartCard title="توزيع الإيرادات حسب نسب الملكية">
        <DonutChart label="توزيع الإيرادات على الملاك" format={egp} centerLabel="إجمالي الإيرادات" data={donut} />
      </ChartCard>
      <ReportTable rows={rows} columns={columns} rowKey={(r) => r.id} caption="توزيع الإيرادات" searchPlaceholder="ابحث بالمالك أو المبنى…" initialSort={{ key: 'share', dir: 'desc' }} emptyText="لا توجد بيانات." />
      <ReportActions title="توزيع الإيرادات" fileName="توزيع-الإيرادات" columns={columns} rows={rows} shareText={`إيرادات ${egp(revenue)} · موزع ${egp(distributed)}`} />
    </>
  )
}

/* ==================================================================
   كشف حساب مالك
   ================================================================== */

type Entry = { id: string; date: ISODate; receiptNumber: string; label: string; building: string; amount: number; pct: number; share: number; balance: number }

function StatementView() {
  const { buildings } = useData()
  const { owners, shares, sharesOf } = useOwners()
  const receipts = useReceipts()
  const [ownerId, setOwnerId] = useState<string | null>(() => (owners.find((o) => shares.has(o.id)) ?? owners[0])?.id ?? null)
  const [from, setFrom] = useState<ISODate | null>(null)
  const [to, setTo] = useState<ISODate | null>(null)
  const owner = owners.find((o) => o.id === ownerId)
  const bName = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings])

  const holdings = useMemo(() => (owner ? sharesOf(owner.id) : new Map<string, number>()), [owner, sharesOf])
  const holdingsLabel = holdingsText(holdings, bName) || '—'

  const all = useMemo<Entry[]>(() => {
    let run = 0
    return receipts
      .filter((r) => holdings.has(r.buildingId))
      .sort((a, b) => a.date.localeCompare(b.date) || a.receiptNumber.localeCompare(b.receiptNumber))
      .map((r) => {
        const pct = holdings.get(r.buildingId)!
        const share = Math.round((r.amount * pct) / 100)
        run += share
        return { id: r.id, date: r.date, receiptNumber: r.receiptNumber, label: `${r.kind} — ${r.clientName} · وحدة ${r.unitNumber} (عقد ${r.contract})`, building: bName.get(r.buildingId) ?? '—', amount: r.amount, pct, share, balance: run }
      })
  }, [holdings, receipts, bName])
  const rows = useMemo(() => all.filter((e) => inRange(e.date, from, to)), [all, from, to])
  const income = rows.reduce((s, e) => s + e.share, 0)
  const gross = rows.reduce((s, e) => s + e.amount, 0)
  const monthly = useMemo(() => lastMonths(12).map((m) => ({ label: monthLabel(m, true), title: monthLabel(m), value: all.filter((e) => e.date.startsWith(m)).reduce((s, e) => s + e.share, 0) })), [all])

  const columns = useMemo<Column<Entry>[]>(
    () => [
      { key: 'date', header: 'التاريخ', value: (e) => `${e.date}-${e.receiptNumber}`, csv: (e) => fmtDate(e.date), cell: (e) => <span className="tabular-nums">{fmtDate(e.date)}</span> },
      { key: 'receiptNumber', header: CODE_LABEL.receipt, cell: (e) => <span className="tabular-nums">{e.receiptNumber}</span> },
      serialColumn('receipt', (e) => e.receiptNumber),
      { key: 'label', header: 'البيان' },
      { key: 'building', header: 'المبنى' },
      { key: 'amount', header: 'قيمة الإيصال', align: 'end', cell: (e) => <span className="tabular-nums">{egp(e.amount)}</span> },
      { key: 'pct', header: 'النسبة', align: 'center', value: (e) => e.pct, cell: (e) => <span className="tabular-nums">{pctFmt(e.pct)}</span> },
      { key: 'share', header: 'حصة المالك', align: 'end', cell: (e) => <span className="tabular-nums text-success">{egp(e.share)}</span> },
      { key: 'balance', header: 'الرصيد التراكمي', align: 'end', cell: (e) => <span className="font-bold tabular-nums text-fg">{egp(e.balance)}</span> },
    ],
    [],
  )

  return (
    <>
      <ReportFilterBar active={!!(from || to)} onReset={() => (setFrom(null), setTo(null))}>
        <Combobox
          containerClassName="lg:col-span-2"
          label="المالك"
          required
          placeholder="ابحث بالاسم أو الهاتف…"
          options={owners.map((o) => ({ value: o.id, label: o.fullName, description: o.phone, keywords: o.nationalId }))}
          value={ownerId}
          onChange={setOwnerId}
        />
        <DatePicker label="من تاريخ" value={from} onChange={setFrom} max={to ?? undefined} today={TODAY_ISO} clearable />
        <DatePicker label="إلى تاريخ" value={to} onChange={setTo} min={from ?? undefined} today={TODAY_ISO} clearable />
      </ReportFilterBar>
      {!owner ? (
        <GlassSurface variant="strong" padding="lg" className="grid place-items-center gap-2 text-center">
          <IconUsers size={28} className="text-fg-3" />
          <Text variant="section">اختر مالكًا لعرض كشف حسابه</Text>
        </GlassSurface>
      ) : (
        <>
          <GlassSurface variant="strong" padding="md" className="rise-in flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-4">
              <span className="grid size-14 place-items-center rounded-full bg-[var(--primary-soft)] text-xl font-bold text-primary">{owner.fullName.trim()[0]}</span>
              <div>
                <Text variant="section">{owner.fullName}</Text>
                <span className="t-caption inline-flex items-center gap-1.5">
                  <IconPhone size={14} /> <bdi dir="ltr" className="tabular-nums">{owner.phone || '—'}</bdi>
                </span>
              </div>
            </div>
            <Pair label="الرقم القومي" value={<bdi dir="ltr" className="tabular-nums">{owner.nationalId || '—'}</bdi>} />
            <Pair label="المباني والحصص" value={<span className="tabular-nums">{holdingsLabel}</span>} />
            <Pair label="العنوان" value={owner.address || '—'} />
          </GlassSurface>
          <KpiGrid>
            <SummaryCard label="إجمالي حصة المالك" value={income} format={egp} tone="success" icon={<IconWallet size={20} />} />
            <SummaryCard label="إجمالي التحصيل بمبانيه" value={gross} format={egp} tone="neutral" icon={<IconBuilding size={20} />} />
            <SummaryCard label="عدد الإيصالات" value={rows.length} icon={<IconFile size={20} />} />
            <SummaryCard label="متوسط الحصة الشهرية" value={Math.round(monthly.reduce((s, m) => s + m.value, 0) / 12)} format={egp} tone="warning" icon={<IconCheckCircle size={20} />} hint="آخر 12 شهر" />
          </KpiGrid>
          <ChartCard title="حصة المالك الشهرية" description="آخر 12 شهر">
            <BarChart label="حصة المالك الشهرية" format={egp} data={monthly} />
          </ChartCard>
          <ReportTable rows={rows} columns={columns} rowKey={(e) => e.id} caption={`كشف حساب ${owner.fullName}`} searchPlaceholder="ابحث بالعميل أو الإيصال…" initialSort={{ key: 'date', dir: 'asc' }} emptyText="لا توجد إيرادات في هذه الفترة." />
          <GlassSurface variant="strong" padding="sm" className="grid grid-cols-2 gap-3 px-5 sm:grid-cols-3" aria-label="إجماليات الكشف">
            <Pair label="عدد الحركات" value={<span className="tabular-nums">{rows.length}</span>} />
            <Pair label="إجمالي الإيصالات" value={<span className="tabular-nums">{egp(gross)}</span>} />
            <Pair label="إجمالي حصة المالك" value={<span className="tabular-nums font-bold text-success">{egp(income)}</span>} />
          </GlassSurface>
          <ReportActions
            title={`كشف حساب ${owner.fullName}`}
            fileName={`كشف-حساب-مالك-${owner.fullName.replace(/\s+/g, '-')}`}
            columns={columns}
            rows={rows}
            shareText={`حصة المالك ${egp(income)} من تحصيل ${egp(gross)}`}
            details={[
              ['المالك', owner.fullName],
              ['الهاتف', owner.phone || '—'],
              ['الرقم القومي', owner.nationalId || '—'],
              ['المباني والحصص', holdingsLabel],
              ['الفترة', from || to ? `${from ? fmtDate(from) : 'البداية'} — ${to ? fmtDate(to) : 'اليوم'}` : 'كل الحركات'],
            ]}
          />
        </>
      )}
    </>
  )
}

function Pair({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="t-caption">{label}</span>
      <span className="t-label text-fg">{value}</span>
    </div>
  )
}
