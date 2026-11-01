import { useCallback, type ReactNode } from 'react'
import {
  egp,
  fmtDate,
  paymentLabel,
  useData,
  type Building,
  type Client,
  type Contract,
  type Installment,
  type Maintenance,
  type OwnerUnion,
  type Payment,
  type Reservation,
  type ContractType,
  type ISODate,
  type Unit,
} from '@/lib'
import {
  FieldGrid,
  IconBuilding,
  IconCalendar,
  IconFile,
  IconInfo,
  IconLayers,
  IconUsers,
  IconWallet,
  IconWrench,
  MiniTable,
  StatusChip,
  type RecordSection,
  type RecordView,
} from '@/kit'
import { exportXlsx } from '@/kit/xlsx'
import { PrintFields, PrintLayout, PrintSection, PrintTable, printDocument } from '@/kit/print'
import { TODAY_ISO } from '@/lib/domain'
import { CLIENT_TONE, codeOf, floorLabel, fmtNum } from './movement/shared'
import { CODE_LABEL, SERIAL_LABEL, codeFields, serialOf } from '@/lib/codes'

type Cell = string | number
/** One block of a `RecordView`: a field grid or a small table, printed and exported the same way. */
export type Block = { key: string; title: string; icon?: ReactNode; fields?: [string, string][]; table?: { headers: string[]; rows: Cell[][]; empty?: string } }

/** Turns plain blocks into the panel's sections, and into the print/CSV output of the same data. */
export function compose(
  base: Pick<RecordView, 'title' | 'subtitle' | 'status' | 'onEdit' | 'editLabel'>,
  blocks: Block[],
  printTitle: string,
  settings: Parameters<typeof PrintLayout>[0]['settings'],
  /** Code / serial pairs printed above the sections (not shown in the side panel). */
  printHead?: [string, string][],
): RecordView {
  const sections: RecordSection[] = blocks.map((b) => ({
    key: b.key,
    title: b.title,
    icon: b.icon,
    count: b.table ? b.table.rows.length : undefined,
    defaultOpen: b.fields ? true : b.table!.rows.length > 0,
    content: b.fields ? (
      <FieldGrid items={b.fields} />
    ) : (
      <MiniTable
        headers={b.table!.headers}
        empty={b.table!.empty}
        rows={b.table!.rows.map((r) => r.map((c, i) => (b.table!.headers[i] === 'الحالة' ? <StatusChip size="sm" status={String(c)} /> : c)))}
      />
    ),
  }))
  const name = `${printTitle}-${String(base.subtitle ?? '')}`.trim()
  return {
    ...base,
    sections,
    onPrint: () =>
      void printDocument(
        <PrintLayout settings={settings} title={printTitle} subtitle={typeof base.subtitle === 'string' ? base.subtitle : undefined}>
          {printHead && printHead.length > 0 && <PrintFields items={printHead} />}
          {blocks.map((b) => (
            <PrintSection key={b.key} title={b.title}>
              {b.fields ? <PrintFields items={b.fields} /> : <PrintTable headers={b.table!.headers} rows={b.table!.rows} empty={b.table!.empty ?? 'لا توجد سجلات.'} />}
            </PrintSection>
          ))}
        </PrintLayout>,
        name,
      ),
    onExport: () => {
      const rows: Cell[][] = []
      for (const b of blocks) {
        rows.push([b.title])
        if (b.fields) for (const [k, v] of b.fields) rows.push([k, v])
        else if (b.table) {
          rows.push(b.table.headers)
          rows.push(...b.table.rows)
        }
        rows.push([])
      }
      const [head = [], ...body] = rows
      void exportXlsx(name, head.map(String), body, { title: name })
    },
  }
}

const money = (n: number) => egp(n)
const date = (d: ISODate | null) => fmtDate(d)

export type DuesRecord = {
  id: string
  contractId: string
  clientId: string
  number: string
  type: ContractType
  clientName: string
  unitNumber: string
  seq: number
  dueDate: ISODate
  amount: number
  paidAmount: number
  balance: number
  days: number
}

/** One builder per entity type; all return the same RecordView the shared side panel renders. */
export function useRecordViews() {
  const { clients, units, buildings, contracts, installments, payments, maintenance, reservations, settings, contractSummary } = useData()

  const unitName = useCallback(
    (id: string | null) => {
      const u = units.find((x) => x.id === id)
      if (!u) return '—'
      return `${buildings.find((b) => b.id === u.buildingId)?.name ?? ''} · ${u.number}`
    },
    [units, buildings],
  )
  const clientName = useCallback((id: string) => clients.find((c) => c.id === id)?.fullName ?? '—', [clients])

  /** The contract-linked tables every entity shares: contracts → installments → receipts → returns. */
  const contractBlocks = useCallback(
    (contractIds: Set<string>, includeClientColumn: boolean): Block[] => {
      const cs = contracts.filter((c) => contractIds.has(c.id))
      const num = new Map(cs.map((c) => [c.id, c]))
      const who = (clientId: string) => clientName(clientId)
      return [
        {
          key: 'contracts',
          title: 'العقود',
          icon: <IconFile size={16} />,
          table: {
            headers: includeClientColumn ? [CODE_LABEL.contract, 'العميل', 'النوع', 'التاريخ', 'الحالة'] : [CODE_LABEL.contract, 'النوع', 'الوحدة', 'التاريخ', 'الحالة'],
            rows: cs.map((c) => (includeClientColumn ? [c.number, who(c.clientId), c.type, date(c.date), c.status] : [c.number, c.type, unitName(c.unitId), date(c.date), c.status])),
          },
        },
        {
          key: 'installments',
          title: 'الأقساط',
          icon: <IconCalendar size={16} />,
          table: {
            headers: ['العقد', 'الدفعة', 'الاستحقاق', 'المبلغ', 'المسدد', 'الحالة'],
            rows: installments
              .filter((i) => contractIds.has(i.contractId))
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .map((i) => [num.get(i.contractId)?.number ?? '—', paymentLabel(num.get(i.contractId)?.type ?? 'بيع', i.seq), date(i.dueDate), money(i.amount), money(i.paidAmount), i.status]),
          },
        },
        {
          key: 'receipts',
          title: 'الإيصالات',
          icon: <IconWallet size={16} />,
          table: {
            headers: [CODE_LABEL.receipt, 'التاريخ', 'المبلغ', 'الطريقة'],
            rows: payments.filter((p) => contractIds.has(p.contractId)).sort((a, b) => b.date.localeCompare(a.date)).map((p) => [p.receiptNumber, date(p.date), money(p.amount), p.method]),
          },
        },
        {
          key: 'returns',
          title: 'المرتجعات',
          icon: <IconLayers size={16} />,
          table: {
            headers: ['العقد', 'الوحدة', 'التاريخ', 'الحالة'],
            rows: cs.filter((c) => c.status === 'مرتجع').map((c) => [c.number, unitName(c.unitId), date(c.date), c.status]),
            empty: 'لا توجد مرتجعات.',
          },
        },
      ]
    },
    [contracts, installments, payments, unitName, clientName],
  )

  const maintenanceBlock = useCallback(
    (unitIds: Set<string>): Block => ({
      key: 'maintenance',
      title: 'طلبات الصيانة',
      icon: <IconWrench size={16} />,
      table: {
        headers: ['النوع', 'الوحدة', 'التاريخ', 'التكلفة', 'الحالة'],
        rows: maintenance.filter((m) => m.unitId && unitIds.has(m.unitId)).map((m) => [m.type, unitName(m.unitId), date(m.requestDate), money(m.actualCost ?? m.estimatedCost), m.status]),
      },
    }),
    [maintenance, unitName],
  )

  const client = useCallback(
    (c: Client, onEdit?: () => void): RecordView => {
      const cs = new Set(contracts.filter((x) => x.clientId === c.id).map((x) => x.id))
      const res = reservations.filter((r) => r.clientId === c.id)
      const unitIds = new Set([...contracts.filter((x) => cs.has(x.id)).map((x) => x.unitId), ...res.map((r) => r.unitId)])
      const owned = buildings.flatMap((b) => b.ownerShares.filter((s) => s.clientId === c.id).map((s) => `${b.name} (${s.share}٪)`))
      const [contractsB, ...rest] = contractBlocks(cs, false)
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'البيانات الأساسية',
          icon: <IconInfo size={16} />,
          fields: [
            ['النوع', c.type],
            [CODE_LABEL.client, codeOf(c.id)],
            ['الهاتف', c.phone || '—'],
            ['هاتف آخر', c.phone2 || '—'],
            ['رقم الهوية', c.nationalId || '—'],
            ['العنوان', c.address || '—'],
            ...(owned.length ? ([['الملكية', owned.join('، ')]] as [string, string][]) : []),
            ['ملاحظات', c.notes || '—'],
          ],
        },
        {
          key: 'reservations',
          title: 'الحجوزات',
          icon: <IconCalendar size={16} />,
          table: { headers: ['الوحدة', 'الغرض', 'التاريخ', 'العربون', 'الحالة'], rows: res.map((r) => [unitName(r.unitId), r.purpose, date(r.date), money(r.deposit), r.status]) },
        },
        contractsB,
        ...rest,
        maintenanceBlock(unitIds),
      ]
      return compose(
        { title: c.fullName, subtitle: `${c.type} — ${codeOf(c.id)}`, status: <StatusChip size="sm" status={c.type} tone={CLIENT_TONE[c.type]} />, onEdit },
        blocks,
        `كشف العميل`,
        settings,
        codeFields('client', codeOf(c.id), c.id),
      )
    },
    [contracts, reservations, buildings, contractBlocks, maintenanceBlock, unitName, settings],
  )

  const unit = useCallback(
    (u: Unit & { buildingName?: string }, onEdit?: () => void): RecordView => {
      const cs = new Set(contracts.filter((x) => x.unitId === u.id).map((x) => x.id))
      const res = reservations.filter((r) => r.unitId === u.id)
      const buildingName = u.buildingName ?? buildings.find((b) => b.id === u.buildingId)?.name ?? '—'
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'البيانات الأساسية',
          icon: <IconBuilding size={16} />,
          fields: [
            ['المبنى', buildingName],
            ['الدور', floorLabel(u.floor)],
            ['النوع', u.type],
            ['الغرض', u.purpose],
            ['المساحة', `${fmtNum(u.area)} م²`],
            ['الغرف / الحمامات', `${u.rooms} / ${u.bathrooms}`],
            ['سعر البيع', u.price ? money(u.price) : '—'],
            ['الإيجار الشهري', u.monthlyRent ? money(u.monthlyRent) : '—'],
            ...(u.nonSellableReason ? ([['سبب عدم البيع', u.nonSellableReason]] as [string, string][]) : []),
            ['الوصف', u.description || '—'],
          ],
        },
        {
          key: 'reservations',
          title: 'الحجوزات',
          icon: <IconUsers size={16} />,
          table: { headers: ['العميل', 'الغرض', 'التاريخ', 'العربون', 'الحالة'], rows: res.map((r) => [clientName(r.clientId), r.purpose, date(r.date), money(r.deposit), r.status]) },
        },
        ...contractBlocks(cs, true),
        maintenanceBlock(new Set([u.id])),
      ]
      return compose(
        { title: `الوحدة ${u.number}`, subtitle: `${buildingName} — ${codeOf(u.id)}`, status: <StatusChip size="sm" status={u.status} />, onEdit },
        blocks,
        'كشف الوحدة',
        settings,
      )
    },
    [contracts, reservations, buildings, contractBlocks, maintenanceBlock, clientName, settings],
  )

  const dues = useCallback(
    (r: DuesRecord, onPay?: () => void): RecordView => {
      const label = paymentLabel(r.type, r.seq)
      const cl = clients.find((c) => c.id === r.clientId)
      const summary = contractSummary(r.contractId)
      const others = installments.filter((i) => i.contractId === r.contractId && i.id !== r.id && i.amount > i.paidAmount && i.dueDate <= TODAY_ISO)
      const blocks: Block[] = [
        {
          key: 'due',
          title: 'بيانات الاستحقاق',
          icon: <IconInfo size={16} />,
          fields: [
            ['العقد', r.number],
            ['العميل', r.clientName],
            ['الوحدة', r.unitNumber],
            ['الدفعة', label],
            ['تاريخ الاستحقاق', date(r.dueDate)],
            ['أيام التأخير', r.days === 0 ? 'مستحق اليوم' : `${r.days} يوم`],
            ['قيمة الدفعة', money(r.amount)],
            ['المسدد', money(r.paidAmount)],
            ['المتبقي', money(r.balance)],
            ...(summary ? ([['إجمالي المتبقي على العقد', money(summary.totalRemaining)]] as [string, string][]) : []),
          ],
        },
        {
          key: 'client',
          title: 'العميل',
          icon: <IconUsers size={16} />,
          fields: [
            ['الاسم', r.clientName],
            ['الهاتف', cl?.phone || '—'],
            ['هاتف آخر', cl?.phone2 || '—'],
            ['العنوان', cl?.address || '—'],
          ],
        },
        {
          key: 'receipts',
          title: 'إيصالات العقد',
          icon: <IconWallet size={16} />,
          table: {
            headers: [CODE_LABEL.receipt, 'التاريخ', 'المبلغ', 'الطريقة'],
            rows: payments.filter((p) => p.contractId === r.contractId).sort((a, b) => b.date.localeCompare(a.date)).map((p) => [p.receiptNumber, date(p.date), money(p.amount), p.method]),
          },
        },
        {
          key: 'others',
          title: 'أقساط أخرى مستحقة على العقد',
          icon: <IconCalendar size={16} />,
          table: {
            headers: ['الدفعة', 'الاستحقاق', 'المتبقي', 'الحالة'],
            rows: others.map((i) => [paymentLabel(r.type, i.seq), date(i.dueDate), money(i.amount - i.paidAmount), i.status === 'معلق' ? 'متأخر' : i.status]),
            empty: 'لا توجد أقساط أخرى مستحقة.',
          },
        },
      ]
      return compose(
        {
          title: r.clientName,
          subtitle: `${r.number} — ${label}`,
          status: <StatusChip size="sm" status={r.days === 0 ? 'مستحق اليوم' : `${r.days} يوم`} tone={r.days === 0 ? 'indigo' : r.days <= 30 ? 'yellow' : 'red'} />,
          onEdit: onPay,
          editLabel: 'تسجيل دفع',
        },
        blocks,
        'تفاصيل قسط مستحق',
        settings,
      )
    },
    [clients, installments, payments, contractSummary, settings],
  )


  const building = useCallback(
    (b: Building, onEdit?: () => void): RecordView => {
      const us = units.filter((u) => u.buildingId === b.id)
      const ids = new Set(us.map((u) => u.id))
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'البيانات الأساسية',
          icon: <IconInfo size={16} />,
          fields: [
            ['الحالة', b.status],
            ['العنوان', b.address || '—'],
            ['الحي / المدينة', [b.district, b.city].filter(Boolean).join(' / ') || '—'],
            ['الأدوار', String(b.totalFloors)],
            ['الوحدات', String(us.length || b.totalUnits)],
            ['الأنواع', b.types.join('، ')],
          ],
        },
        {
          key: 'owners',
          title: 'الملاك',
          icon: <IconUsers size={16} />,
          table: { headers: ['المالك', 'الحصة'], rows: b.ownerShares.map((s) => [clientName(s.clientId), `${s.share}٪`]) },
        },
        {
          key: 'units',
          title: 'الوحدات',
          icon: <IconLayers size={16} />,
          table: { headers: ['الوحدة', 'الدور', 'النوع', 'الحالة'], rows: us.map((u) => [u.number, floorLabel(u.floor), u.type, u.status]) },
        },
        maintenanceBlock(ids),
      ]
      return compose({ title: b.name, subtitle: [b.district, b.city].filter(Boolean).join(' — '), status: <StatusChip size="sm" status={b.status} />, onEdit }, blocks, 'بيانات المبنى', settings)
    },
    [units, maintenanceBlock, clientName, settings],
  )

  const reservation = useCallback(
    (r: Reservation, onEdit?: () => void): RecordView => {
      const cl = clients.find((c) => c.id === r.clientId)
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'بيانات الحجز',
          icon: <IconInfo size={16} />,
          fields: [
            ['العميل', cl?.fullName ?? '—'],
            ['الوحدة', unitName(r.unitId)],
            ['الغرض', r.purpose],
            ['تاريخ الحجز', date(r.date)],
            ['تاريخ الانتهاء', date(r.expiryDate)],
            ['العربون', money(r.deposit)],
          ],
        },
        { key: 'client', title: 'العميل', icon: <IconUsers size={16} />, fields: [['الاسم', cl?.fullName ?? '—'], ['الهاتف', cl?.phone || '—'], ['رقم الهوية', cl?.nationalId || '—']] },
      ]
      return compose({ title: `حجز ${unitName(r.unitId)}`, subtitle: cl?.fullName ?? '—', status: <StatusChip size="sm" status={r.status} />, onEdit }, blocks, 'بيانات الحجز', settings, codeFields('reservation', r.id.toUpperCase(), r.id))
    },
    [clients, unitName, settings],
  )

  const contract = useCallback(
    (c: Contract, onEdit?: () => void): RecordView => {
      const sum = contractSummary(c.id)
      const terms: [string, string][] =
        c.type === 'بيع'
          ? [['سعر الوحدة', money(c.unitPrice + (c.discount ?? 0))], ...(c.discount ? ([['الخصم', money(c.discount)], ['السعر بعد الخصم', money(c.unitPrice)]] as [string, string][]) : []), ['المقدم', money(c.downPayment)]]
          : [['الإيجار الشهري', money(c.monthlyRent)], ['المدة', `${c.durationMonths} شهر`], ['من', date(c.startDate)], ['إلى', date(c.endDate)], ['التأمين', money(c.securityDeposit)]]
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'بيانات العقد',
          icon: <IconInfo size={16} />,
          fields: [
            ['العميل', clientName(c.clientId)],
            ['الوحدة', unitName(c.unitId)],
            ['النوع', c.type],
            ['تاريخ التوقيع', date(c.date)],
            ...terms,
            ...(sum ? ([['إجمالي المتبقي', money(sum.totalRemaining)]] as [string, string][]) : []),
          ],
        },
        ...contractBlocks(new Set([c.id]), false).filter((b) => b.key !== 'contracts'),
      ]
      return compose({ title: `عقد ${c.number}`, subtitle: `${clientName(c.clientId)} — ${c.type}`, status: <StatusChip size="sm" status={c.status} />, onEdit }, blocks, 'بيانات العقد', settings, codeFields('contract', c.number))
    },
    [contractSummary, clientName, unitName, contractBlocks, settings],
  )

  const installment = useCallback(
    (i: Installment, onEdit?: () => void): RecordView => {
      const c = contracts.find((x) => x.id === i.contractId)
      const label = paymentLabel(c?.type ?? 'بيع', i.seq)
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'بيانات القسط',
          icon: <IconInfo size={16} />,
          fields: [
            ['العقد', c?.number ?? '—'],
            ['العميل', c ? clientName(c.clientId) : '—'],
            ['الوحدة', c ? unitName(c.unitId) : '—'],
            ['الدفعة', label],
            ['الاستحقاق', date(i.dueDate)],
            ['المبلغ', money(i.amount)],
            ['المسدد', money(i.paidAmount)],
            ['المتبقي', money(i.amount - i.paidAmount)],
          ],
        },
        {
          key: 'receipts',
          title: 'إيصالات هذا القسط',
          icon: <IconWallet size={16} />,
          table: { headers: [CODE_LABEL.receipt, 'التاريخ', 'المبلغ', 'الطريقة'], rows: payments.filter((p) => p.installmentId === i.id).map((p) => [p.receiptNumber, date(p.date), money(p.amount), p.method]) },
        },
      ]
      return compose({ title: `${c?.number ?? ''} — ${label}`, subtitle: c ? clientName(c.clientId) : undefined, status: <StatusChip size="sm" status={i.status} />, onEdit, editLabel: 'تسجيل دفع' }, blocks, 'بيانات القسط', settings)
    },
    [contracts, payments, clientName, unitName, settings],
  )

  const receipt = useCallback(
    (p: Payment, onEdit?: () => void): RecordView => {
      const c = contracts.find((x) => x.id === p.contractId)
      const inst = installments.find((i) => i.id === p.installmentId)
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'بيانات الإيصال',
          icon: <IconInfo size={16} />,
          fields: [
            ['التاريخ', date(p.date)],
            ['المبلغ', money(p.amount)],
            ['طريقة الدفع', p.method],
            ['العقد', c?.number ?? '—'],
            ['العميل', c ? clientName(c.clientId) : '—'],
            ['الوحدة', c ? unitName(c.unitId) : '—'],
            ['عن', c ? paymentLabel(c.type, inst?.seq ?? null) : '—'],
            ['ملاحظات', p.notes || '—'],
          ],
        },
      ]
      const view = compose({ title: `إيصال ${p.receiptNumber}`, subtitle: c ? clientName(c.clientId) : undefined, status: <StatusChip size="sm" status={money(p.amount)} tone="green" />, onEdit }, blocks, 'إيصال قبض', settings, codeFields('receipt', p.receiptNumber))

      /** Prints every receipt already paid on this receipt's contract, with the total. */
      const printPaid = () => {
        const paid = payments.filter((x) => x.contractId === p.contractId).sort((a, b) => a.date.localeCompare(b.date) || a.receiptNumber.localeCompare(b.receiptNumber))
        const seqOf = new Map(installments.map((i) => [i.id, i.seq]))
        const total = paid.reduce((s, x) => s + x.amount, 0)
        void printDocument(
          <PrintLayout settings={settings} title="الإيصالات المسددة" subtitle={c ? `عقد ${c.number} — ${clientName(c.clientId)}` : undefined}>
            <PrintFields
              items={[
                ...(c ? codeFields('contract', c.number) : []),
                ['العميل', c ? clientName(c.clientId) : '—'],
                ['الوحدة', c ? unitName(c.unitId) : '—'],
                ['عدد الإيصالات', String(paid.length)],
                ['إجمالي المسدد', money(total)],
              ]}
            />
            <PrintTable
              headers={['#', SERIAL_LABEL.receipt, CODE_LABEL.receipt, 'التاريخ', 'عن', 'طريقة الدفع', 'المبلغ']}
              rows={paid.map((x, i) => [i + 1, serialOf(x.receiptNumber), x.receiptNumber, date(x.date), c ? paymentLabel(c.type, x.installmentId ? (seqOf.get(x.installmentId) ?? null) : null) : '—', x.method, money(x.amount)])}
              empty="لا توجد إيصالات مسددة."
            />
            <PrintFields items={[['إجمالي المسدد', money(total)]]} />
          </PrintLayout>,
          `الإيصالات-المسددة-${c?.number ?? p.receiptNumber}`,
        )
      }
      return { ...view, printLabel: 'طباعة الإيصال', extraActions: [{ label: 'طباعة', title: 'طباعة كل الإيصالات المسددة على هذا العقد', onClick: printPaid }] }
    },
    [contracts, installments, payments, clientName, unitName, settings],
  )

  const maintenanceRec = useCallback(
    (m: Maintenance, onEdit?: () => void): RecordView => {
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'بيانات الطلب',
          icon: <IconInfo size={16} />,
          fields: [
            ['النوع', m.type],
            ['المبنى', buildings.find((b) => b.id === m.buildingId)?.name ?? '—'],
            ['الوحدة', m.unitId ? unitName(m.unitId) : 'المبنى كله'],
            ['تاريخ الطلب', date(m.requestDate)],
            ['المسؤول', m.assignedTo || '—'],
            ['التكلفة التقديرية', money(m.estimatedCost)],
            ['التكلفة الفعلية', m.actualCost == null ? '—' : money(m.actualCost)],
            ['تاريخ الإنجاز', date(m.completionDate)],
            ['الوصف', m.description || '—'],
          ],
        },
      ]
      return compose({ title: `${m.type} — ${m.unitId ? unitName(m.unitId) : 'المبنى'}`, subtitle: m.description, status: <StatusChip size="sm" status={m.status} />, onEdit }, blocks, 'طلب صيانة', settings)
    },
    [buildings, unitName, settings],
  )

  const union = useCallback(
    (u: OwnerUnion, onEdit?: () => void): RecordView => {
      const blocks: Block[] = [
        {
          key: 'info',
          title: 'بيانات الاتحاد',
          icon: <IconInfo size={16} />,
          fields: [
            ['المبنى', buildings.find((b) => b.id === u.buildingId)?.name ?? '—'],
            ['الرسوم الشهرية', money(u.monthlyFee)],
            ['موعد الاجتماعات', u.meetingSchedule || '—'],
            ['ملاحظات', u.notes || '—'],
          ],
        },
        { key: 'members', title: 'الأعضاء', icon: <IconUsers size={16} />, table: { headers: ['العضو', 'الهاتف'], rows: u.memberIds.map((id) => [clientName(id), clients.find((c) => c.id === id)?.phone || '—']) } },
      ]
      return compose({ title: u.name, subtitle: buildings.find((b) => b.id === u.buildingId)?.name, onEdit }, blocks, 'اتحاد ملاك', settings)
    },
    [buildings, clients, clientName, settings],
  )

  return { client, unit, dues, building, reservation, contract, installment, receipt, maintenance: maintenanceRec, union }
}
