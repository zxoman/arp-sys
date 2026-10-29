import { useMemo, useState } from 'react'
import { useData, egp, fmtDate, newId, type ISODate, type Maintenance as MaintenanceRecord, type MaintenanceStatus, type MaintenanceType } from '@/lib'
import { TODAY_ISO } from '@/data'
import {
  Btn,
  Combobox,
  DataTable,
  DatePicker,
  Drawer,
  IconPlus,
  IconWrench,
  NumericInput,
  Select,
  StatusChip,
  TextInput,
  Textarea,
  useToast,
  type Column,
} from '@/kit'
import { FilterChips, useNewShortcut, useShake, type Errors } from './shared'

/** Form labels → stored MaintenanceType. */
const TYPE_OPTIONS: { value: MaintenanceType; label: string }[] = [
  { value: 'كهرباء', label: 'كهربائي' },
  { value: 'سباكة', label: 'سباكة' },
  { value: 'نجارة', label: 'نجارة' },
  { value: 'دهانات', label: 'دهان' },
  { value: 'عام', label: 'عام' },
]
const TYPE_LABEL: Record<string, string> = { كهرباء: 'كهربائي', دهانات: 'دهان' }
const STATUSES: MaintenanceStatus[] = ['جديد', 'جاري', 'منتهي']
const TONE = { جديد: 'indigo', جاري: 'yellow', منتهي: 'green' } as const
type Filter = 'الكل' | MaintenanceStatus
const FILTERS: Filter[] = ['الكل', ...STATUSES]

/** `invoiceNumber` isn't in the Maintenance model yet; it's stored alongside the record. */
type Stored = MaintenanceRecord & { invoiceNumber?: string }
type Row = Stored & { unitLabel: string; buildingName: string }

type Draft = {
  unitId: string | null
  type: string
  description: string
  requestDate: ISODate | null
  assignedTo: string
  estimatedCost: number | null
  actualCost: number | null
  status: MaintenanceStatus
  completionDate: ISODate | null
  invoiceNumber: string
}
type Key = keyof Draft

const EMPTY: Draft = {
  unitId: null,
  type: '',
  description: '',
  requestDate: TODAY_ISO,
  assignedTo: '',
  estimatedCost: null,
  actualCost: null,
  status: 'جديد',
  completionDate: null,
  invoiceNumber: '',
}
const req = 'هذا الحقل مطلوب'

export default function Maintenance() {
  const { maintenance, units, buildings, dispatch } = useData()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('الكل')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [formRef, shake] = useShake<HTMLFormElement>()

  const openNew = () => {
    setDraft(EMPTY)
    setErrors({})
    setOpen(true)
  }
  useNewShortcut(openNew)

  const bName = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings])
  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units])

  const rows = useMemo<Row[]>(
    () =>
      (maintenance as Stored[]).map((m) => ({
        ...m,
        unitLabel: m.unitId ? (unitById.get(m.unitId)?.number ?? '—') : 'المبنى كاملًا',
        buildingName: bName.get(m.buildingId) ?? '—',
      })),
    [maintenance, unitById, bName],
  )
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { الكل: rows.length, جديد: 0, جاري: 0, منتهي: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])
  const filtered = useMemo(() => (filter === 'الكل' ? rows : rows.filter((r) => r.status === filter)), [rows, filter])

  const unitOptions = useMemo(
    () => units.map((u) => ({ value: u.id, label: `${bName.get(u.buildingId) ?? ''} — ${u.type} ${u.number}`, description: `الدور ${u.floor}` })),
    [units, bName],
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

  const save = () => {
    const e: Errors<Key> = {}
    if (!draft.unitId) e.unitId = req
    if (!draft.type) e.type = req
    if (!draft.description.trim()) e.description = req
    if (draft.status === 'منتهي' && !draft.completionDate) e.completionDate = 'أدخل تاريخ الإنجاز للطلب المنتهي'
    if (draft.completionDate && draft.requestDate && draft.completionDate < draft.requestDate) e.completionDate = 'تاريخ الإنجاز قبل تاريخ الطلب'
    setErrors(e)
    if (Object.keys(e).length) return shake()
    const record: Stored = {
      id: newId('maintenance', maintenance),
      unitId: draft.unitId,
      buildingId: unit!.buildingId,
      type: draft.type as MaintenanceType,
      description: draft.description.trim(),
      requestDate: draft.requestDate ?? TODAY_ISO,
      assignedTo: draft.assignedTo.trim(),
      estimatedCost: draft.estimatedCost ?? 0,
      actualCost: draft.actualCost,
      status: draft.status,
      completionDate: draft.completionDate,
      invoiceNumber: draft.invoiceNumber.trim(),
    }
    dispatch({ type: 'ADD_MAINTENANCE', payload: record })
    toast.success('تم حفظ طلب الصيانة', `${record.id.toUpperCase()} — ${bName.get(record.buildingId) ?? ''}`)
    setOpen(false)
  }

  const columns = useMemo<Column<Row>[]>(
    () => [
      { key: 'id', header: 'رقم الطلب', value: (m) => m.id.toUpperCase(), cell: (m) => <span className="tabular-nums text-fg-2">{m.id.toUpperCase()}</span> },
      { key: 'buildingName', header: 'المبنى' },
      { key: 'unitLabel', header: 'الوحدة' },
      { key: 'type', header: 'النوع', value: (m) => TYPE_LABEL[m.type] ?? m.type },
      { key: 'description', header: 'الوصف', cell: (m) => <span className="line-clamp-1 max-w-[18rem]" title={m.description}>{m.description}</span> },
      { key: 'requestDate', header: 'تاريخ الطلب', cell: (m) => <span className="tabular-nums">{fmtDate(m.requestDate)}</span> },
      { key: 'assignedTo', header: 'المسؤول', value: (m) => m.assignedTo || '—' },
      { key: 'estimatedCost', header: 'التقديرية', align: 'end', cell: (m) => <span className="tabular-nums">{egp(m.estimatedCost)}</span> },
      { key: 'actualCost', header: 'الفعلية', align: 'end', cell: (m) => (m.actualCost == null ? '—' : <span className="tabular-nums">{egp(m.actualCost)}</span>) },
      { key: 'status', header: 'الحالة', cell: (m) => <StatusChip status={m.status} tone={TONE[m.status]} size="sm" /> },
    ],
    [],
  )

  return (
    <div className="grid gap-4">
      <FilterChips label="تصفية حسب الحالة" options={FILTERS} value={filter} onChange={setFilter} counts={counts} />
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(m) => m.id}
        caption="طلبات الصيانة"
        title={
          <Btn iconStart={<IconPlus size={16} />} onClick={openNew}>
            طلب صيانة جديد
          </Btn>
        }
        searchPlaceholder="ابحث بالمبنى أو الوصف أو المسؤول…"
        exportName="طلبات-الصيانة"
        initialSort={{ key: 'requestDate', dir: 'desc' }}
        emptyText="لا توجد طلبات صيانة."
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        icon={<IconWrench size={20} />}
        title="طلب صيانة جديد"
        description="الحقول المعلَّمة بـ * مطلوبة"
        footer={
          <>
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn type="submit" form="maintenance-form">حفظ</Btn>
          </>
        }
      >
        <form id="maintenance-form" ref={formRef} noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => (e.preventDefault(), save())}>
          <Combobox
            containerClassName="sm:col-span-2"
            label="الوحدة"
            required
            placeholder="ابحث بالمبنى أو رقم الوحدة…"
            options={unitOptions}
            value={draft.unitId}
            error={errors.unitId}
            clearable
            onChange={(v) => update({ unitId: v })}
          />
          <TextInput label="المبنى" value={unit ? (bName.get(unit.buildingId) ?? '') : ''} placeholder="يُحدد من الوحدة" readOnly />
          <Select label="نوع الطلب" required placeholder="اختر النوع" options={TYPE_OPTIONS} value={draft.type} error={errors.type} onChange={(e) => update({ type: e.target.value })} />
          <Textarea containerClassName="sm:col-span-2" label="الوصف" required rows={3} value={draft.description} error={errors.description} onChange={(e) => update({ description: e.target.value })} />
          <DatePicker label="تاريخ الطلب" value={draft.requestDate} today={TODAY_ISO} onChange={(v) => update({ requestDate: v })} />
          <TextInput label="المسؤول" value={draft.assignedTo} onChange={(e) => update({ assignedTo: e.target.value })} />
          <NumericInput label="التكلفة التقديرية" suffix="ج.م" min={0} value={draft.estimatedCost} onChange={(v) => update({ estimatedCost: v })} />
          <NumericInput label="التكلفة الفعلية" suffix="ج.م" min={0} value={draft.actualCost} onChange={(v) => update({ actualCost: v })} />
          <Select
            label="الحالة"
            options={STATUSES}
            value={draft.status}
            onChange={(e) => {
              const status = e.target.value as MaintenanceStatus
              update({ status, completionDate: status === 'منتهي' ? (draft.completionDate ?? TODAY_ISO) : draft.completionDate })
            }}
          />
          <DatePicker
            label="تاريخ الإنجاز"
            required={draft.status === 'منتهي'}
            value={draft.completionDate}
            error={errors.completionDate}
            today={TODAY_ISO}
            clearable
            onChange={(v) => update({ completionDate: v })}
          />
          <TextInput containerClassName="sm:col-span-2" label="رقم الفاتورة" dir="ltr" value={draft.invoiceNumber} onChange={(e) => update({ invoiceNumber: e.target.value })} />
        </form>
      </Drawer>
    </div>
  )
}
