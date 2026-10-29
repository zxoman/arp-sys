import { useEffect, useMemo, useState } from 'react'
import { useData, egp, fmtDate, type ContractSummary, type ContractType, type ISODate } from '@/lib'
import { TODAY_ISO } from '@/data'
import {
  Btn,
  Combobox,
  DataTable,
  DatePicker,
  Drawer,
  IconAlert,
  IconPlus,
  IconRefresh,
  NumericInput,
  StatusChip,
  Textarea,
  useConfirm,
  useToast,
  type Column,
} from '@/kit'
import {
  CONTRACT_TYPE_TONE,
  contractTypeLabel,
  fmtNum,
  InfoPair,
  RETURNS_KEY,
  Segmented,
  takeReturnPrefill,
  useNewShortcut,
  usePersistentList,
  useShake,
  type Errors,
} from './shared'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL } from '@/lib/codes'

/** Return details; the Contract model has no fields for them, so they're kept per contract. */
type ReturnInfo = { id: string; date: ISODate; reason: string; fee: number; refund: number; dues?: number }

type Row = {
  id: string
  number: string
  type: ContractType
  ended: boolean
  clientName: string
  unitLabel: string
  paid: number
  info: ReturnInfo | null
}

type Draft = { type: ContractType; contractId: string | null; date: ISODate | null; reason: string; fee: number | null; refund: number | null; refundTouched: boolean }
type Key = 'contractId' | 'date' | 'reason' | 'fee' | 'refund'

const EMPTY: Draft = { type: 'بيع', contractId: null, date: TODAY_ISO, reason: '', fee: null, refund: null, refundTouched: false }
const req = 'هذا الحقل مطلوب'
const TYPES: readonly ContractType[] = ['بيع', 'إيجار']

/** Everything collected on the contract, refundable deposit included. */
const collected = (s: ContractSummary) => s.totalPaid + s.securityDepositPaid
/** What a return refunds before the fee: a sale gives back what was paid, a lease only its deposit. */
const refundBase = (s: ContractSummary) => (s.type === 'بيع' ? s.totalPaid : s.securityDepositPaid)

export default function ContractEnd() {
  const { contracts, clients, units, buildings, installments, contractSummary, dispatch } = useData()
  const toast = useToast()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const returns = usePersistentList<ReturnInfo>(RETURNS_KEY)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [formRef, shake] = useShake<HTMLFormElement>()

  const openNew = (patch: Partial<Draft> = {}) => {
    setDraft({ ...EMPTY, ...patch })
    setErrors({})
    setOpen(true)
  }
  useNewShortcut(() => openNew())

  // «إرجاع» / «إنهاء» on the contract details page opens the form for that contract.
  useEffect(() => {
    const id = takeReturnPrefill()
    const c = id ? contracts.find((x) => x.id === id) : undefined
    if (c) openNew({ type: c.type, contractId: c.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.fullName])), [clients])
  const unitLabel = useMemo(() => {
    const bName = new Map(buildings.map((b) => [b.id, b.name]))
    return new Map(units.map((u) => [u.id, `${bName.get(u.buildingId) ?? ''} — ${u.number}`]))
  }, [units, buildings])
  const infoById = useMemo(() => new Map(returns.items.map((r) => [r.id, r])), [returns.items])

  const paidOf = (id: string) => {
    const s = contractSummary(id)
    return s ? collected(s) : 0
  }

  const rows = useMemo<Row[]>(
    () =>
      contracts
        .filter((c) => c.status === 'مرتجع' || (c.type === 'إيجار' && c.status === 'منتهي' && infoById.has(c.id)))
        .map((c) => ({
          id: c.id,
          number: c.number,
          type: c.type,
          ended: c.status !== 'مرتجع',
          clientName: clientName.get(c.clientId) ?? '—',
          unitLabel: unitLabel.get(c.unitId) ?? '—',
          paid: paidOf(c.id),
          info: infoById.get(c.id) ?? null,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contracts, clientName, unitLabel, infoById, contractSummary],
  )

  const options = useMemo(
    () =>
      contracts
        .filter((c) => c.type === draft.type && (c.status === 'نشط' || (c.type === 'بيع' && c.status === 'مكتمل')))
        .map((c) => ({
          value: c.id,
          label: `${c.number} — ${clientName.get(c.clientId) ?? '—'}`,
          description: `${contractTypeLabel(c.type)} · ${unitLabel.get(c.unitId) ?? ''}`,
        })),
    [contracts, clientName, unitLabel, draft.type],
  )

  const contract = contracts.find((c) => c.id === draft.contractId) ?? null
  const summary = contract ? contractSummary(contract.id) : null
  const isSale = draft.type !== 'إيجار'
  const base = summary ? refundBase(summary) : 0
  const baseLabel = isSale ? 'إجمالي المدفوع' : 'التأمين المحصّل'
  const endDate = draft.date ?? TODAY_ISO
  const unpaid = useMemo(
    () => (contract ? installments.filter((i) => i.contractId === contract.id && i.amount - i.paidAmount > 0).sort((a, b) => a.seq - b.seq) : []),
    [contract, installments],
  )
  const unpaidTotal = unpaid.reduce((s, i) => s + i.amount - i.paidAmount, 0)
  /** Rent already due on the termination date and still unpaid; later months are cancelled. */
  const dues = isSale ? 0 : unpaid.filter((i) => i.dueDate <= endDate).reduce((s, i) => s + i.amount - i.paidAmount, 0)
  const cancelled = isSale ? [] : unpaid.filter((i) => i.dueDate > endDate && i.paidAmount === 0)
  const autoRefund = Math.max(0, base - dues - (draft.fee ?? 0))
  const owed = Math.max(0, dues + (draft.fee ?? 0) - base)
  const refund = draft.refundTouched ? (draft.refund ?? 0) : autoRefund

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch)) delete next[k as Key]
      return next
    })
  }

  const save = async () => {
    const e: Errors<Key> = {}
    if (!draft.contractId) e.contractId = req
    if (!draft.date) e.date = req
    else if (contract && draft.date < contract.date) e.date = 'تاريخ الإرجاع قبل تاريخ العقد'
    if (!isSale && (draft.fee ?? 0) < 0) e.fee = 'قيمة غير صحيحة'
    if (isSale && (draft.fee ?? 0) > base) e.fee = `الخصم أكبر من ${baseLabel}`
    if (refund > base) e.refund = `المبلغ المرتد أكبر من ${baseLabel}`
    setErrors(e)
    if (Object.keys(e).length) return shake()
    const ok = await confirm({
      title: isSale ? 'تأكيد إرجاع العقد؟' : 'تأكيد إنهاء عقد الإيجار؟',
      description: isSale ? 'سيُلغى العقد وتصبح الوحدة «مرتجعة». لا يمكن التراجع عن هذا الإجراء.' : 'سيُنهى العقد وتصبح الوحدة «متاحة» وتُلغى الأشهر القادمة غير المسددة.',
      details: [
        ['العميل', clientName.get(contract!.clientId) ?? '—'],
        ['العقد', contract!.number],
        ['الوحدة', unitLabel.get(contract!.unitId) ?? '—'],
        [isSale ? 'يُرد للعميل' : 'يُرد من التأمين', egp(refund)],
      ],
      confirmLabel: isSale ? 'تأكيد الإرجاع' : 'تأكيد الإنهاء',
    })
    if (!ok) return
    if (isSale) {
      dispatch({ type: 'RETURN_CONTRACT', payload: { id: contract!.id } })
      returns.upsert({ id: contract!.id, date: draft.date!, reason: draft.reason.trim(), fee: draft.fee ?? 0, refund })
      toast.success('تم تسجيل المرتجع', `${contract!.number} — يُرد للعميل ${egp(refund)}، والوحدة أصبحت «مرتجعة»`)
    } else {
      dispatch({ type: 'END_LEASE', payload: { id: contract!.id, date: draft.date! } })
      returns.upsert({ id: contract!.id, date: draft.date!, reason: draft.reason.trim(), fee: draft.fee ?? 0, refund, dues })
      toast.success('تم إنهاء عقد الإيجار', `${contract!.number} — يُرد من التأمين ${egp(refund)}، والوحدة أصبحت «متاحة»`)
    }
    setOpen(false)
  }

  const columns = useMemo<Column<Row>[]>(
    () => [
      { key: 'number', header: CODE_LABEL.return, cell: (r) => <span className="font-semibold tabular-nums text-fg">{r.number}</span> },
      serialColumn('return', (r) => r.number),
      {
        key: 'type',
        header: 'النوع',
        cell: (r) => <StatusChip status={contractTypeLabel(r.type)} tone={CONTRACT_TYPE_TONE[r.type]} size="sm" />,
      },
      { key: 'clientName', header: 'العميل' },
      { key: 'unitLabel', header: 'الوحدة' },
      { key: 'date', header: 'تاريخ الإرجاع', value: (r) => r.info?.date ?? '', cell: (r) => <span className="tabular-nums">{fmtDate(r.info?.date)}</span> },
      { key: 'paid', header: 'إجمالي المحصّل', align: 'end', cell: (r) => <span className="tabular-nums">{egp(r.paid)}</span> },
      { key: 'fee', header: 'الخصم', align: 'end', value: (r) => r.info?.fee ?? null, cell: (r) => (r.info ? <span className="tabular-nums text-danger">{egp(r.info.fee)}</span> : '—') },
      { key: 'refund', header: 'المرتد للعميل', align: 'end', value: (r) => r.info?.refund ?? null, cell: (r) => (r.info ? <span className="font-semibold tabular-nums">{egp(r.info.refund)}</span> : '—') },
      { key: 'reason', header: 'السبب', value: (r) => r.info?.reason || '—' },
      { key: 'status', header: 'الحالة', sortable: false, searchable: false, csv: false, cell: (r) => <StatusChip status={r.ended ? 'منتهي' : 'مرتجع'} size="sm" /> },
    ],
    [],
  )

  return (
    <div className="grid gap-4">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        caption="المرتجعات"
        title={
          <Btn iconStart={<IconPlus size={16} />} onClick={() => openNew()}>
            تسجيل مرتجع / إنهاء إيجار
          </Btn>
        }
        searchPlaceholder="ابحث برقم العقد أو العميل…"
        exportName="المرتجعات"
        initialSort={{ key: 'date', dir: 'desc' }}
        emptyText="لا توجد مرتجعات."
      />

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        tone="danger"
        icon={<IconRefresh size={20} />}
        title={isSale ? 'تسجيل مرتجع' : 'إنهاء عقد إيجار'}
        description={
          isSale
            ? 'يصبح العقد «مرتجع» والوحدة «مرتجعة» وتُلغى الأقساط التي لم يُسدد منها شيء.'
            : 'يصبح العقد «منتهي» والوحدة «متاحة» وتُلغى الأقساط المستقبلية غير المسددة.'
        }
        footer={
          <>
            <Btn variant="ghost" onClick={() => setOpen(false)}>إلغاء</Btn>
            <Btn variant="danger" type="submit" form="return-form">{isSale ? 'حفظ المرتجع' : 'إنهاء العقد'}</Btn>
          </>
        }
      >
        <form id="return-form" ref={formRef} noValidate className="grid gap-4" onSubmit={(e) => (e.preventDefault(), save())}>
          <div className="grid gap-1.5">
            <span className="t-label">نوع العقد</span>
            <Segmented
              label="نوع العقد"
              options={TYPES}
              value={draft.type}
              onChange={(t) => update({ type: t, contractId: null, fee: null, refund: null, refundTouched: false })}
            />
          </div>
          <Combobox
            label="العقد"
            required
            placeholder="ابحث برقم العقد أو اسم العميل…"
            options={options}
            value={draft.contractId}
            error={errors.contractId}
            clearable
            onChange={(v) => update({ contractId: v, fee: null, refund: null, refundTouched: false })}
            emptyText="لا توجد عقود نشطة مطابقة"
          />

          {contract && summary && (
            <div className="rise-in grid gap-3 rounded-ctl border border-hairline p-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <InfoPair label="العميل" value={clientName.get(contract.clientId) ?? '—'} strong />
                <InfoPair label="الوحدة" value={unitLabel.get(contract.unitId) ?? '—'} />
                {contract.type === 'بيع' ? (
                  <InfoPair label="سعر البيع" value={egp(contract.unitPrice)} />
                ) : (
                  <InfoPair label="الإيجار الشهري" value={egp(contract.monthlyRent)} />
                )}
              </div>
              {contract.type === 'بيع' ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <InfoPair label="المدفوع من المقدم" value={egp(summary.downPaymentPaid)} tone="text-success" />
                  <InfoPair label="المدفوع من الأقساط" value={egp(summary.paidInstallmentsTotal)} tone="text-success" />
                  <InfoPair label="إجمالي المدفوع" value={egp(summary.totalPaid)} strong tone="text-success" />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <InfoPair label="الإيجار المحصّل" value={egp(summary.paidInstallmentsTotal)} tone="text-success" />
                  <InfoPair label="التأمين المحصّل" value={egp(summary.securityDepositPaid)} strong tone="text-success" />
                  <InfoPair label="نهاية المدة" value={fmtDate(contract.endDate)} />
                </div>
              )}
              <div className="border-t border-hairline pt-3">
                <div className="t-label mb-2 text-fg-2">
                  {isSale ? 'الأقساط غير المسددة' : 'أشهر الإيجار غير المسددة'}: {fmtNum(unpaid.length)} — {egp(unpaidTotal)}
                </div>
                {unpaid.length > 0 && (
                  <ul className="max-h-40 overflow-auto text-sm">
                    {unpaid.map((i) => (
                      <li key={i.id} className="flex justify-between border-b border-hairline py-1 last:border-0">
                        <span>
                          {isSale ? 'القسط' : 'الشهر'} {fmtNum(i.seq)} — {fmtDate(i.dueDate)}
                        </span>
                        <span className="tabular-nums">
                          {egp(i.amount - i.paidAmount)}
                          {i.paidAmount > 0 && <span className="t-caption ms-1">(جزئي)</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {unpaid.some((i) => i.paidAmount > 0) && (
                  <p className="t-caption mt-2 flex items-center gap-1 text-warning">
                    <IconAlert size={13} /> الدفعات المسدد جزء منها تبقى في السجل؛ تُلغى الدفعات التي لم يُسدد منها شيء.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <DatePicker label={isSale ? 'تاريخ الإرجاع' : 'تاريخ الإنهاء'} required value={draft.date} error={errors.date} today={TODAY_ISO} onChange={(v) => update({ date: v })} />
            <NumericInput label={isSale ? 'خصم/مصاريف إدارية' : 'خصومات أخرى'} suffix="ج.م" min={0} value={draft.fee} error={errors.fee} onChange={(v) => update({ fee: v })} />
            <Textarea containerClassName="sm:col-span-2" label={isSale ? 'سبب الإرجاع (اختياري)' : 'سبب الإنهاء (اختياري)'} rows={2} value={draft.reason} error={errors.reason} onChange={(e) => update({ reason: e.target.value })} />
            <NumericInput
              containerClassName="sm:col-span-2"
              label="المبلغ المرتد للعميل"
              suffix="ج.م"
              min={0}
              value={refund}
              error={errors.refund}
              hint={
                draft.refundTouched && refund !== autoRefund ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => update({ refundTouched: false })}>
                    عُدِّل يدويًا — إعادة الحساب التلقائي ({egp(autoRefund)})
                  </button>
                ) : (
                  isSale ? `${baseLabel} − الخصم (قابل للتعديل)` : 'التأمين − المستحقات غير المسددة − الخصومات (قابل للتعديل)'
                )
              }
              onChange={(v) => update({ refund: v, refundTouched: true })}
            />
          </div>
          {!isSale && contract && (
            <div className="rise-in grid gap-2 rounded-ctl border border-hairline p-4 text-sm">
              <InfoPair label="مستحقات إيجار غير مسددة حتى تاريخ الإنهاء" value={egp(dues)} tone={dues > 0 ? 'text-danger' : undefined} />
              <InfoPair label="أقساط مستقبلية ستُلغى" value={`${fmtNum(cancelled.length)} — ${egp(cancelled.reduce((s, i) => s + i.amount, 0))}`} />
              {owed > 0 && (
                <p className="t-caption flex items-center gap-1 text-danger">
                  <IconAlert size={13} /> المستحقات والخصومات تتجاوز التأمين بمقدار {egp(owed)} — يبقى على العميل.
                </p>
              )}
            </div>
          )}
        </form>
      </Drawer>
      {confirmDialog}
    </div>
  )
}
