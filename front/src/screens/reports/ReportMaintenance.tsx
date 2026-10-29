import { useMemo, useState } from 'react'
import { useData, egp, fmtDate, type ISODate, type Maintenance, type MaintenanceStatus, type MaintenanceType } from '@/lib'
import { TODAY_ISO } from '@/data'
import { DatePicker, IconAlert, IconCheckCircle, IconWallet, IconWrench, Select, StatusChip, SummaryCard, type Column } from '@/kit'
import { BarChart, DonutChart } from '@/kit/charts'
import { ChartCard, KpiGrid, ReportActions, ReportFilterBar, ReportTable, inRange } from './shared'

const STATUSES: MaintenanceStatus[] = ['جديد', 'جاري', 'منتهي']
const TYPES: MaintenanceType[] = ['سباكة', 'كهرباء', 'تكييف', 'دهانات', 'نجارة', 'مصاعد', 'عام']
const TONE = { جديد: 'indigo', جاري: 'yellow', منتهي: 'green' } as const
const DONUT_TONE = { جديد: 'primary', جاري: 'warning', منتهي: 'success' } as const

/** The maintenance screen also stores an invoice number on the record. */
type Row = Maintenance & { invoiceNumber?: string; buildingName: string; unitNumber: string; variance: number | null }

export default function ReportMaintenance() {
  const { maintenance, buildings, units } = useData()
  const [buildingId, setBuildingId] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState<ISODate | null>(null)
  const [to, setTo] = useState<ISODate | null>(null)

  const all = useMemo<Row[]>(() => {
    const bName = new Map(buildings.map((b) => [b.id, b.name]))
    const uNum = new Map(units.map((u) => [u.id, u.number]))
    return maintenance.map((m) => ({
      ...m,
      buildingName: bName.get(m.buildingId) ?? '—',
      unitNumber: m.unitId ? (uNum.get(m.unitId) ?? '—') : 'المبنى كاملًا',
      variance: m.actualCost == null ? null : m.actualCost - m.estimatedCost,
    }))
  }, [maintenance, buildings, units])

  // Status is applied after the chart/KPI scope so the status donut still shows every status.
  const scoped = useMemo(() => all.filter((m) => (!buildingId || m.buildingId === buildingId) && (!type || m.type === type) && inRange(m.requestDate, from, to)), [all, buildingId, type, from, to])
  const rows = useMemo(() => (status ? scoped.filter((m) => m.status === status) : scoped), [scoped, status])

  const k = useMemo(() => {
    const est = rows.reduce((s, m) => s + m.estimatedCost, 0)
    const act = rows.reduce((s, m) => s + (m.actualCost ?? 0), 0)
    const estDone = rows.filter((m) => m.actualCost != null).reduce((s, m) => s + m.estimatedCost, 0)
    return { est, act, open: rows.filter((m) => m.status !== 'منتهي').length, overrun: estDone ? Math.round(((act - estDone) / estDone) * 100) : 0 }
  }, [rows])

  const byStatus = STATUSES.map((s) => ({ label: s, value: scoped.filter((m) => m.status === s).length, tone: DONUT_TONE[s] }))
  const byBuilding = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.buildingName, (m.get(r.buildingName) ?? 0) + (r.actualCost ?? r.estimatedCost))
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, value]) => ({ label, value }))
  }, [rows])

  const columns = useMemo<Column<Row>[]>(
    () => [
      { key: 'id', header: 'رقم الطلب', value: (m) => m.id.toUpperCase(), cell: (m) => <span className="tabular-nums text-fg-2">{m.id.toUpperCase()}</span> },
      { key: 'buildingName', header: 'المبنى' },
      { key: 'unitNumber', header: 'الوحدة' },
      { key: 'type', header: 'النوع' },
      { key: 'description', header: 'الوصف', cell: (m) => <span className="line-clamp-1 max-w-[16rem]" title={m.description}>{m.description}</span> },
      { key: 'requestDate', header: 'تاريخ الطلب', cell: (m) => <span className="tabular-nums">{fmtDate(m.requestDate)}</span> },
      { key: 'assignedTo', header: 'المسؤول', value: (m) => m.assignedTo || '—' },
      { key: 'estimatedCost', header: 'التقديرية', align: 'end', cell: (m) => <span className="tabular-nums">{egp(m.estimatedCost)}</span> },
      { key: 'actualCost', header: 'الفعلية', align: 'end', value: (m) => m.actualCost ?? '', cell: (m) => (m.actualCost == null ? <span className="text-fg-3">—</span> : <span className="tabular-nums">{egp(m.actualCost)}</span>) },
      {
        key: 'variance',
        header: 'الفرق',
        align: 'end',
        value: (m) => m.variance ?? '',
        cell: (m) => (m.variance == null ? <span className="text-fg-3">—</span> : <span className={`tabular-nums ${m.variance > 0 ? 'text-danger' : 'text-success'}`}>{m.variance > 0 ? '+' : ''}{egp(m.variance)}</span>),
      },
      { key: 'completionDate', header: 'تاريخ الإنجاز', value: (m) => m.completionDate ?? '', cell: (m) => <span className="tabular-nums">{fmtDate(m.completionDate)}</span> },
      { key: 'invoiceNumber', header: 'رقم الفاتورة', value: (m) => m.invoiceNumber || '—' },
      { key: 'status', header: 'الحالة', cell: (m) => <StatusChip size="sm" status={m.status} tone={TONE[m.status]} /> },
    ],
    [],
  )

  const active = !!(buildingId || type || status || from || to)
  return (
    <div className="grid gap-4">
      <ReportFilterBar active={active} onReset={() => (setBuildingId(''), setType(''), setStatus(''), setFrom(null), setTo(null))}>
        <Select label="المبنى" placeholder="كل المباني" options={buildings.map((b) => ({ value: b.id, label: b.name }))} value={buildingId} onChange={(e) => setBuildingId(e.target.value)} />
        <Select label="نوع الطلب" placeholder="كل الأنواع" options={TYPES} value={type} onChange={(e) => setType(e.target.value)} />
        <Select label="الحالة" placeholder="كل الحالات" options={STATUSES} value={status} onChange={(e) => setStatus(e.target.value)} />
        <DatePicker label="تاريخ الطلب من" value={from} onChange={setFrom} max={to ?? undefined} today={TODAY_ISO} clearable />
        <DatePicker label="إلى" value={to} onChange={setTo} min={from ?? undefined} today={TODAY_ISO} clearable />
      </ReportFilterBar>
      <KpiGrid>
        <SummaryCard label="عدد الطلبات" value={rows.length} icon={<IconWrench size={20} />} hint={`${k.open} طلب مفتوح`} />
        <SummaryCard label="التكلفة التقديرية" value={k.est} format={egp} tone="neutral" icon={<IconWallet size={20} />} />
        <SummaryCard label="التكلفة الفعلية" value={k.act} format={egp} tone="success" icon={<IconCheckCircle size={20} />} trend={{ value: k.overrun, label: 'عن التقدير للطلبات المنفذة', goodWhen: 'down' }} />
        <SummaryCard label="طلبات مفتوحة" value={k.open} tone="warning" icon={<IconAlert size={20} />} />
      </KpiGrid>
      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <ChartCard title="التكلفة حسب المبنى" description="الفعلية، أو التقديرية إن لم تُسجل بعد">
          <BarChart label="تكلفة الصيانة حسب المبنى" format={egp} data={byBuilding} />
        </ChartCard>
        <ChartCard title="الطلبات حسب الحالة">
          <DonutChart label="طلبات الصيانة حسب الحالة" centerLabel="طلب" data={byStatus} />
        </ChartCard>
      </div>
      <ReportTable rows={rows} columns={columns} rowKey={(m) => m.id} caption="تقرير الصيانة" searchPlaceholder="ابحث بالمبنى أو الوصف أو المسؤول…" initialSort={{ key: 'requestDate', dir: 'desc' }} emptyText="لا توجد طلبات مطابقة." />
      <ReportActions title="تقرير الصيانة" fileName="تقرير-الصيانة" columns={columns} rows={rows} shareText={`${rows.length} طلب · تقديري ${egp(k.est)} · فعلي ${egp(k.act)}`} />
    </div>
  )
}
