import { useMemo, useState } from 'react'
import { egp, fmtDate, useData, type ISODate } from '@/lib'
import { addDays, addMonths } from '@/lib/domain'
import { TODAY_ISO } from '@/lib/domain'
import { IconCheckCircle, IconFile, IconWallet, IconTrendUp, LiquidTabs, NumericInput, Select, SummaryCard, type Column } from '@/kit'
import { AreaChart, BarChart, DonutChart } from '@/kit/charts'
import { cn } from '@/lib/cn'
import { Text } from '@/components/ui'
import { ChartCard, KpiGrid, ReportActions, ReportFilterBar, ReportTable, monthLabel } from './shared'

type Span = 'day' | 'month' | 'year'
type Group = 'day' | 'month' | 'year'

const SPAN_OPTIONS = [
  { value: 'day', label: 'أيام' },
  { value: 'month', label: 'أشهر' },
  { value: 'year', label: 'سنوات' },
]
const GROUP_ITEMS: { value: Group; label: string }[] = [
  { value: 'day', label: 'الدخل اليومي' },
  { value: 'month', label: 'الدخل الشهري' },
  { value: 'year', label: 'الدخل السنوي' },
]
const PRESETS: { label: string; n: number; span: Span }[] = [
  { label: '7 أيام', n: 7, span: 'day' },
  { label: '30 يومًا', n: 30, span: 'day' },
  { label: '6 أشهر', n: 6, span: 'month' },
  { label: '12 شهرًا', n: 12, span: 'month' },
  { label: 'سنتان', n: 2, span: 'year' },
]
/** Past this many buckets a chart turns unreadable, so the grouping is coarsened automatically. */
const MAX_BUCKETS = 62

/** First day of the period of `n` × `span` that ends on `end`. */
function periodStart(end: ISODate, n: number, span: Span): ISODate {
  if (span === 'day') return addDays(end, -(n - 1))
  return addDays(addMonths(end, span === 'month' ? -n : -12 * n), 1)
}

const keyOf = (date: ISODate, group: Group) => (group === 'day' ? date : group === 'month' ? date.slice(0, 7) : date.slice(0, 4))

function bucketKeys(start: ISODate, end: ISODate, group: Group): string[] {
  const keys: string[] = []
  if (group === 'day') {
    for (let d = start; d <= end; d = addDays(d, 1)) keys.push(d)
  } else if (group === 'month') {
    for (let m = `${start.slice(0, 7)}-01`; m.slice(0, 7) <= end.slice(0, 7); m = addMonths(m, 1)) keys.push(m.slice(0, 7))
  } else {
    for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) keys.push(String(y))
  }
  return keys
}

function labelOf(key: string, group: Group, many: boolean, full = false): string {
  if (group === 'year') return key
  if (group === 'month') {
    if (full) return monthLabel(key)
    return many ? `${key.slice(5)}/${key.slice(2, 4)}` : monthLabel(key, true)
  }
  const [, m, d] = key.split('-')
  return full ? fmtDate(key) : `${Number(d)}/${Number(m)}`
}

type Row = { id: string; key: string; period: string; sales: number; rent: number; total: number; receipts: number }

const sum = (rows: readonly { value: number }[]) => rows.reduce((s, r) => s + r.value, 0)

export default function ReportIncome() {
  const { payments, contracts, units, buildings } = useData()
  const [count, setCount] = useState<number | null>(30)
  const [span, setSpan] = useState<Span>('day')
  const [group, setGroup] = useState<Group>('day')
  const [buildingId, setBuildingId] = useState('')

  const n = Math.max(1, Math.min(count ?? 1, span === 'day' ? 3650 : span === 'month' ? 120 : 20))
  const from = periodStart(TODAY_ISO, n, span)

  const buildingOptions = useMemo(
    () => [{ value: '', label: 'كل العقارات' }, ...buildings.map((b) => ({ value: b.id, label: b.name }))],
    [buildings],
  )

  /** Receipts inside the period, tagged sale / rent and with their building. */
  const incomes = useMemo(() => {
    const contractById = new Map(contracts.map((c) => [c.id, c]))
    const unitById = new Map(units.map((u) => [u.id, u]))
    return payments.flatMap((p) => {
      if (p.date < from || p.date > TODAY_ISO) return []
      const c = contractById.get(p.contractId)
      if (!c) return []
      const b = unitById.get(c.unitId)?.buildingId ?? ''
      if (buildingId && b !== buildingId) return []
      return [{ date: p.date, amount: p.amount, type: c.type, buildingId: b }]
    })
  }, [payments, contracts, units, buildingId, from])

  const effectiveGroup: Group = useMemo(() => {
    let g = group
    if (g === 'day' && bucketKeys(from, TODAY_ISO, 'day').length > MAX_BUCKETS) g = 'month'
    if (g === 'month' && bucketKeys(from, TODAY_ISO, 'month').length > MAX_BUCKETS) g = 'year'
    return g
  }, [group, from])
  const coarsened = effectiveGroup !== group

  const rows = useMemo<Row[]>(() => {
    const keys = bucketKeys(from, TODAY_ISO, effectiveGroup)
    const many = keys.length > 12
    const byKey = new Map<string, Row>(
      keys.map((k) => [k, { id: k, key: k, period: labelOf(k, effectiveGroup, many, true), sales: 0, rent: 0, total: 0, receipts: 0 }]),
    )
    for (const i of incomes) {
      const r = byKey.get(keyOf(i.date, effectiveGroup))
      if (!r) continue
      if (i.type === 'بيع') r.sales += i.amount
      else r.rent += i.amount
      r.total += i.amount
      r.receipts += 1
    }
    return [...byKey.values()]
  }, [incomes, from, effectiveGroup])

  const many = rows.length > 12
  const series = (pick: (r: Row) => number) =>
    rows.map((r) => ({ label: labelOf(r.key, effectiveGroup, many), title: r.period, value: pick(r) }))

  const totals = useMemo(() => ({ sales: sum(rows.map((r) => ({ value: r.sales }))), rent: sum(rows.map((r) => ({ value: r.rent }))), receipts: incomes.length }), [rows, incomes])
  const total = totals.sales + totals.rent
  const average = rows.length ? Math.round(total / rows.length) : 0
  const periodWord = effectiveGroup === 'day' ? 'يوم' : effectiveGroup === 'month' ? 'شهر' : 'سنة'
  const best = rows.reduce<Row | null>((a, r) => (!a || r.total > a.total ? r : a), null)

  const byBuilding = useMemo(() => {
    const m = new Map<string, { sales: number; rent: number }>()
    for (const i of incomes) {
      const e = m.get(i.buildingId) ?? { sales: 0, rent: 0 }
      if (i.type === 'بيع') e.sales += i.amount
      else e.rent += i.amount
      m.set(i.buildingId, e)
    }
    const name = new Map(buildings.map((b) => [b.id, b.name]))
    return [...m].map(([id, v]) => ({ label: name.get(id) ?? '—', ...v }))
  }, [incomes, buildings])

  const columns = useMemo<Column<Row>[]>(
    () => [
      { key: 'key', header: effectiveGroup === 'day' ? 'اليوم' : effectiveGroup === 'month' ? 'الشهر' : 'السنة', csv: (r) => r.period, cell: (r) => <span className="font-semibold tabular-nums text-fg">{r.period}</span> },
      { key: 'sales', header: 'دخل المبيعات', align: 'end', cell: (r) => <span className="tabular-nums">{egp(r.sales)}</span> },
      { key: 'rent', header: 'دخل الإيجارات', align: 'end', cell: (r) => <span className="tabular-nums">{egp(r.rent)}</span> },
      { key: 'total', header: 'إجمالي الدخل', align: 'end', cell: (r) => <span className="font-bold tabular-nums text-fg">{egp(r.total)}</span> },
      { key: 'receipts', header: 'عدد الإيصالات', align: 'center', cell: (r) => <span className="tabular-nums">{r.receipts}</span> },
    ],
    [effectiveGroup],
  )

  const spanLabel = `${n} ${SPAN_OPTIONS.find((o) => o.value === span)!.label}`
  const title = `كشف الدخل — آخر ${spanLabel}`
  const empty = total === 0

  const setPreset = (p: (typeof PRESETS)[number]) => {
    setCount(p.n)
    setSpan(p.span)
    setGroup(p.span)
  }
  const changeSpan = (s: Span) => {
    setSpan(s)
    setGroup(s)
  }

  return (
    <>
      <ReportFilterBar>
        <NumericInput label="المدة (رقم)" required min={1} value={count} onChange={setCount} stepper />
        <Select label="نوع الفترة" options={SPAN_OPTIONS} value={span} onChange={(e) => changeSpan(e.target.value as Span)} />
        <Select label="العقار" options={buildingOptions} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <div className="grid gap-1.5">
          <span className="t-caption">اختيار سريع</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="فترات جاهزة">
            {PRESETS.map((p) => {
              const on = p.n === n && p.span === span
              return (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPreset(p)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors',
                    on ? 'border-primary bg-primary-soft text-primary dark:text-indigo-300' : 'border-hairline text-fg-2 hover:bg-fg/5',
                  )}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      </ReportFilterBar>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <LiquidTabs label="تجميع الدخل" items={GROUP_ITEMS} value={group} onChange={setGroup} />
        <span className="t-caption">
          من {fmtDate(from)} إلى {fmtDate(TODAY_ISO)}
          {coarsened && ` · جُمّع الدخل ${effectiveGroup === 'month' ? 'شهريًا' : 'سنويًا'} لكثرة الفترات`}
        </span>
      </div>

      <KpiGrid>
        <SummaryCard label="إجمالي الدخل" value={total} format={egp} icon={<IconWallet size={20} />} tone="primary" hint={`${totals.receipts} إيصال`} />
        <SummaryCard label="دخل المبيعات" value={totals.sales} format={egp} icon={<IconCheckCircle size={20} />} tone="success" hint={total ? `${Math.round((totals.sales / total) * 100)}٪ من الدخل` : undefined} />
        <SummaryCard label="دخل الإيجارات" value={totals.rent} format={egp} icon={<IconFile size={20} />} tone="warning" hint={total ? `${Math.round((totals.rent / total) * 100)}٪ من الدخل` : undefined} />
        <SummaryCard label={`متوسط الدخل لكل ${periodWord}`} value={average} format={egp} icon={<IconTrendUp size={20} />} tone="neutral" hint={best && best.total ? `الأعلى: ${best.period}` : undefined} />
      </KpiGrid>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <ChartCard title="الدخل المجمل" description={`المبيعات + الإيجارات — ${spanLabel}`}>
          <BarChart label={`الدخل المجمل خلال ${spanLabel}`} format={egp} data={series((r) => r.total)} />
        </ChartCard>
        <ChartCard title="نسبة المبيعات إلى الإيجارات">
          <DonutChart
            label="توزيع الدخل بين المبيعات والإيجارات"
            format={egp}
            centerLabel="الدخل"
            data={[
              { label: 'المبيعات', value: totals.sales, tone: 'success' },
              { label: 'الإيجارات', value: totals.rent, tone: 'warning' },
            ]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="تحليل الإيجارات" description={`دخل الإيجارات — ${spanLabel}`}>
          <AreaChart label={`دخل الإيجارات خلال ${spanLabel}`} tone="primary" format={egp} data={series((r) => r.rent)} />
          <div className="grid gap-2 border-t border-hairline pt-3">
            <Text variant="label">الإيجارات حسب العقار</Text>
            <BarChart label="دخل الإيجارات حسب العقار" format={egp} height={160} data={byBuilding.map((b) => ({ label: b.label, value: b.rent }))} />
          </div>
        </ChartCard>
        <ChartCard title="تحليل المبيعات" description={`دخل المبيعات — ${spanLabel}`}>
          <BarChart label={`دخل المبيعات خلال ${spanLabel}`} format={egp} data={series((r) => r.sales)} />
          <div className="grid gap-2 border-t border-hairline pt-3">
            <Text variant="label">المبيعات حسب العقار</Text>
            <BarChart label="دخل المبيعات حسب العقار" format={egp} height={160} data={byBuilding.map((b) => ({ label: b.label, value: b.sales }))} />
          </div>
        </ChartCard>
      </div>

      <ReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption={title}
        searchable={false}
        initialSort={{ key: 'key', dir: 'desc' }}
        emptyText="لا يوجد دخل في هذه الفترة."
      />
      <ReportActions
        title={title}
        fileName={`كشف-الدخل-${n}-${span}`}
        columns={columns}
        rows={rows}
        shareText={`${spanLabel}: إجمالي ${egp(total)} · مبيعات ${egp(totals.sales)} · إيجارات ${egp(totals.rent)}${empty ? '' : ` · متوسط ${egp(average)}/${periodWord}`}`}
        details={[
          ['الفترة', `${fmtDate(from)} — ${fmtDate(TODAY_ISO)}`],
          ['العقار', buildingOptions.find((o) => o.value === buildingId)?.label ?? 'كل العقارات'],
          ['إجمالي الدخل', egp(total)],
          ['دخل المبيعات', egp(totals.sales)],
          ['دخل الإيجارات', egp(totals.rent)],
        ]}
      />
    </>
  )
}
