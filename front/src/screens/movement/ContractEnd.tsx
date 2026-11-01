import { useEffect, useMemo, useState } from 'react'
import { ApiError, cancelContract, clearToken, fetchContracts, type ApiContract } from '@/lib/api'
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
import { egp, fmtDate, type ISODate } from '@/lib'
import { TODAY_ISO } from '@/lib/domain'
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

/**
 * The API has no columns for the administrative fee / refunded amount, so those two numbers stay a
 * browser-side note per contract. The cancellation itself — status, date, reason and freeing the
 * unit — is all server-side (`POST /admin/contracts/{id}/cancel`).
 */
type ReturnInfo = { id: string; date: ISODate; reason: string; fee: number; refund: number }

type Row = {
  id: string
  number: string
  type: 'sale' | 'rent'
  clientName: string
  unitLabel: string
  paid: number
  cancelledAt: string | null
  cancelReason: string | null
  info: ReturnInfo | null
}

type Draft = {
  type: (typeof TYPES)[number]
  contractId: string | null
  date: ISODate | null
  reason: string
  fee: number | null
  refund: number | null
  refundTouched: boolean
}
type Key = 'contractId' | 'date' | 'reason' | 'fee' | 'refund'

const TYPES = ['بيع', 'إيجار'] as const
const TYPE_TO_API: Record<(typeof TYPES)[number], 'sale' | 'rent'> = { بيع: 'sale', إيجار: 'rent' }
const API_TO_TYPE: Record<'sale' | 'rent', (typeof TYPES)[number]> = { sale: 'بيع', rent: 'إيجار' }

const EMPTY: Draft = {
  type: 'بيع',
  contractId: null,
  date: TODAY_ISO,
  reason: '',
  fee: null,
  refund: null,
  refundTouched: false,
}
const req = 'هذا الحقل مطلوب'

const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)
const money = (value: string | number | null | undefined) => Number(value ?? 0)

const contractCode = (c: Pick<ApiContract, 'id' | 'number'>) => c.number || `C-${c.id}`

/** Everything the contract has actually collected. */
const collected = (c: ApiContract) => money(c.paid_total)

/**
 * What a return can refund before the fee: a sale gives back what was paid; a lease gives back the
 * agreed security deposit (its own installments are rent, not a refundable deposit).
 */
const refundBase = (c: ApiContract) => (c.type === 'sale' ? collected(c) : money(c.security_deposit))

const unitLabelOf = (c: ApiContract) =>
  [c.building_name, c.unit_name].filter(Boolean).join(' — ') || '—'

const toRow = (c: ApiContract, info: ReturnInfo | null): Row => ({
  id: String(c.id),
  number: contractCode(c),
  type: c.type,
  clientName: c.client_name ?? '—',
  unitLabel: unitLabelOf(c),
  paid: collected(c),
  cancelledAt: c.cancelled_at,
  cancelReason: c.cancellation_reason,
  info,
})

/**
 * «المرتجعات وإنهاء العقود» — a return (sale) or a lease termination is one server operation:
 * `POST /admin/contracts/{id}/cancel`, which marks the contract cancelled, cancels its remaining
 * installments and frees the unit. The list below reads the cancelled contracts from the API, so a
 * contract cancelled anywhere in the app shows up here immediately.
 */
export default function ContractEnd() {
  const toast = useToast()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const returns = usePersistentList<ReturnInfo>(RETURNS_KEY)

  const [rows, setRows] = useState<ApiContract[]>([])
  const [active, setActive] = useState<ApiContract[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [saving, setSaving] = useState(false)
  const [formRef, shake] = useShake<HTMLFormElement>()

  // The cancelled contracts (what this screen lists) and the cancellable ones (its picker).
  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    Promise.all([
      fetchContracts({ status: 'cancelled', perPage: 100 }),
      fetchContracts({ status: 'active,draft', perPage: 100 }),
    ])
      .then(([cancelled, ongoing]) => {
        if (!alive) return
        setRows(cancelled.items)
        setActive(ongoing.items)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        if (isAuthError(err)) {
          clearToken()
          return
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل المرتجعات من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [reloadKey])

  const reload = () => setReloadKey((k) => k + 1)

  const infoById = useMemo(() => new Map(returns.items.map((r) => [r.id, r])), [returns.items])

  const tableRows = useMemo<Row[]>(
    () => rows.map((c) => toRow(c, infoById.get(String(c.id)) ?? null)),
    [rows, infoById],
  )

  const openNew = (patch: Partial<Draft> = {}) => {
    setDraft({ ...EMPTY, ...patch })
    setErrors({})
    setOpen(true)
  }
  useNewShortcut(() => openNew())

  // «إرجاع» / «إنهاء» on the contract details page opens the form for that contract.
  useEffect(() => {
    const id = takeReturnPrefill()
    if (!id) return
    fetchContracts({ status: 'active,draft', perPage: 100 })
      .then((result) => {
        const found = result.items.find((c) => String(c.id) === id)
        if (found) openNew({ type: API_TO_TYPE[found.type], contractId: id })
      })
      .catch(() => {
        // The drawer can still be opened manually.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wantedType = TYPE_TO_API[draft.type]
  const options = useMemo(
    () =>
      active
        .filter((c) => c.type === wantedType)
        .map((c) => ({
          value: String(c.id),
          label: `${contractCode(c)} — ${c.client_name ?? '—'}`,
          description: `${contractTypeLabel(API_TO_TYPE[c.type])} · ${unitLabelOf(c)}`,
        })),
    [active, wantedType],
  )

  const contract = active.find((c) => String(c.id) === draft.contractId) ?? null
  const isSale = draft.type === 'بيع'
  const base = contract ? refundBase(contract) : 0
  const baseLabel = isSale ? 'إجمالي المدفوع' : 'التأمين المتفق عليه'
  const unpaid = useMemo(
    () =>
      (contract?.installments ?? [])
        .filter((i) => money(i.amount) - money(i.paid_amount) > 0)
        .sort((a, b) => a.sequence_number - b.sequence_number),
    [contract],
  )
  const unpaidTotal = unpaid.reduce((s, i) => s + money(i.amount) - money(i.paid_amount), 0)
  const autoRefund = Math.max(0, base - (draft.fee ?? 0))
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
    else if (!draft.reason.trim()) e.reason = 'سبب الإرجاع مطلوب ليُسجَّل في العقد'
    if ((draft.fee ?? 0) > base) e.fee = `الخصم أكبر من ${baseLabel}`
    if (refund > base) e.refund = `المبلغ المرتد أكبر من ${baseLabel}`
    setErrors(e)
    if (Object.keys(e).length) return shake()
    if (!contract) return

    const ok = await confirm({
      title: isSale ? 'تأكيد إرجاع العقد؟' : 'تأكيد إنهاء عقد الإيجار؟',
      description: isSale
        ? 'سيُلغى العقد وتصبح الوحدة «متاحة» وتُلغى أقساطه غير المسددة. لا يمكن التراجع.'
        : 'سيُلغى العقد وتصبح الوحدة «متاحة» وتُلغى أقساطه غير المسددة. لا يمكن التراجع.',
      details: [
        ['العميل', contract.client_name ?? '—'],
        ['العقد', contractCode(contract)],
        ['الوحدة', unitLabelOf(contract)],
        [isSale ? 'يُرد للعميل' : 'يُرد من التأمين', egp(refund)],
      ],
      confirmLabel: isSale ? 'تأكيد الإرجاع' : 'تأكيد الإنهاء',
    })
    if (!ok) return

    setSaving(true)
    try {
      await cancelContract(contract.id, draft.reason.trim())
      // Fee/refund are a local note: the API has no columns for them (see ReturnInfo).
      returns.upsert({
        id: String(contract.id),
        date: draft.date ?? TODAY_ISO,
        reason: draft.reason.trim(),
        fee: draft.fee ?? 0,
        refund,
      })
      toast.success(
        isSale ? 'تم تسجيل المرتجع' : 'تم إنهاء عقد الإيجار',
        `${contractCode(contract)} — الوحدة أصبحت «متاحة».`,
      )
      setOpen(false)
      reload()
    } catch (err) {
      if (isAuthError(err)) {
        clearToken()
        setOpen(false)
        return
      }
      toast.error('تعذّر إلغاء العقد', err instanceof ApiError ? err.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: 'number',
        header: CODE_LABEL.return,
        cell: (r) => <span className="font-semibold tabular-nums text-fg">{r.number}</span>,
      },
      serialColumn('return', (r) => r.number),
      {
        key: 'type',
        header: 'النوع',
        value: (r) => contractTypeLabel(API_TO_TYPE[r.type]),
        cell: (r) => (
          <StatusChip status={API_TO_TYPE[r.type]} tone={CONTRACT_TYPE_TONE[API_TO_TYPE[r.type]]} size="sm" />
        ),
      },
      { key: 'clientName', header: 'العميل' },
      { key: 'unitLabel', header: 'الوحدة' },
      {
        key: 'date',
        header: 'تاريخ الإرجاع',
        value: (r) => r.cancelledAt ?? '',
        cell: (r) => <span className="tabular-nums">{fmtDate(r.cancelledAt ? r.cancelledAt.slice(0, 10) : null)}</span>,
      },
      {
        key: 'paid',
        header: 'إجمالي المحصّل',
        align: 'end',
        value: (r) => r.paid,
        cell: (r) => <span className="tabular-nums">{egp(r.paid)}</span>,
      },
      {
        key: 'fee',
        header: 'الخصم',
        align: 'end',
        value: (r) => r.info?.fee ?? null,
        cell: (r) => (r.info ? <span className="tabular-nums text-danger">{egp(r.info.fee)}</span> : '—'),
      },
      {
        key: 'refund',
        header: 'المرتد للعميل',
        align: 'end',
        value: (r) => r.info?.refund ?? null,
        cell: (r) => (r.info ? <span className="font-semibold tabular-nums">{egp(r.info.refund)}</span> : '—'),
      },
      { key: 'reason', header: 'السبب', value: (r) => r.cancelReason ?? r.info?.reason ?? '—' },
      {
        key: 'status',
        header: 'الحالة',
        sortable: false,
        searchable: false,
        csv: false,
        cell: () => <StatusChip status="ملغي" tone="red" size="sm" />,
      },
    ],
    [],
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

      <DataTable
        rows={tableRows}
        columns={columns}
        rowKey={(r) => r.id}
        caption="المرتجعات"
        loading={loading}
        title={
          <Btn iconStart={<IconPlus size={16} />} onClick={() => openNew()}>
            تسجيل مرتجع / إنهاء إيجار
          </Btn>
        }
        searchPlaceholder="ابحث برقم العقد أو العميل…"
        exportName="المرتجعات"
        initialSort={{ key: 'date', dir: 'desc' }}
        emptyText={loadError ? 'لا توجد بيانات من الخادم.' : 'لا توجد عقود ملغاة. أي عقد يُلغى من «العقود» يظهر هنا.'}
      />

      <Drawer
        open={open}
        onClose={() => !saving && setOpen(false)}
        size="lg"
        tone="danger"
        icon={<IconRefresh size={20} />}
        title={isSale ? 'تسجيل مرتجع' : 'إنهاء عقد إيجار'}
        description="يُسجَّل الإلغاء على الخادم: العقد يصبح «ملغي»، وتُلغى أقساطه غير المسددة، وتصبح الوحدة «متاحة»."
        footer={
          <>
            <Btn variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              إلغاء
            </Btn>
            <Btn variant="danger" type="submit" form="return-form" loading={saving}>
              {isSale ? 'حفظ المرتجع' : 'إنهاء العقد'}
            </Btn>
          </>
        }
      >
        <form
          id="return-form"
          ref={formRef}
          noValidate
          className="grid gap-4"
          onSubmit={(e) => (e.preventDefault(), void save())}
        >
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

          {contract && (
            <div className="rise-in grid gap-3 rounded-ctl border border-hairline p-4">
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <InfoPair label="العميل" value={contract.client_name ?? '—'} strong />
                <InfoPair label="الوحدة" value={unitLabelOf(contract)} />
                {contract.type === 'sale' ? (
                  <InfoPair label="سعر البيع" value={egp(money(contract.total_price))} />
                ) : (
                  <InfoPair label="الإيجار الشهري" value={egp(money(contract.monthly_rent))} />
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <InfoPair label="المدفوع من المقدم" value={egp(money(contract.paid_down_payment))} tone="text-success" />
                <InfoPair
                  label="المدفوع من الأقساط"
                  value={egp(Math.max(0, collected(contract) - money(contract.paid_down_payment)))}
                  tone="text-success"
                />
                <InfoPair label="إجمالي المدفوع" value={egp(collected(contract))} strong tone="text-success" />
              </div>
              {!isSale && <InfoPair label="التأمين المتفق عليه" value={egp(money(contract.security_deposit))} />}
              <div className="border-t border-hairline pt-3">
                <div className="t-label mb-2 text-fg-2">
                  الأقساط غير المسددة: {fmtNum(unpaid.length)} — {egp(unpaidTotal)}
                </div>
                {unpaid.length > 0 && (
                  <ul className="max-h-40 overflow-auto text-sm">
                    {unpaid.map((i) => (
                      <li key={i.id} className="flex justify-between border-b border-hairline py-1 last:border-0">
                        <span>
                          القسط {fmtNum(i.sequence_number)} — {fmtDate(i.due_date.slice(0, 10))}
                        </span>
                        <span className="tabular-nums">{egp(money(i.amount) - money(i.paid_amount))}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {unpaid.some((i) => money(i.paid_amount) > 0) && (
                  <p className="t-caption mt-2 flex items-center gap-1 text-warning">
                    <IconAlert size={13} /> الأقساط المسدد جزء منها تبقى في السجل؛ يُلغى القسط بحالته على الخادم.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <DatePicker
              label={isSale ? 'تاريخ الإرجاع' : 'تاريخ الإنهاء'}
              value={draft.date}
              error={errors.date}
              today={TODAY_ISO}
              onChange={(v) => update({ date: v })}
              hint="للعلم في هذا الجهاز — تاريخ الإلغاء الرسمي يسجّله الخادم عند التنفيذ."
            />
            <NumericInput
              label={isSale ? 'خصم/مصاريف إدارية' : 'خصومات أخرى'}
              suffix="ج.م"
              min={0}
              value={draft.fee}
              error={errors.fee}
              onChange={(v) => update({ fee: v })}
            />
            <Textarea
              containerClassName="sm:col-span-2"
              label={isSale ? 'سبب الإرجاع' : 'سبب الإنهاء'}
              required
              rows={2}
              value={draft.reason}
              error={errors.reason}
              hint="يُحفظ على العقد ويظهر في سجل العمليات."
              onChange={(e) => update({ reason: e.target.value })}
            />
            <NumericInput
              containerClassName="sm:col-span-2"
              label="المبلغ المرتد للعميل"
              suffix="ج.م"
              min={0}
              value={refund}
              error={errors.refund}
              hint={
                draft.refundTouched && refund !== autoRefund ? (
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => update({ refundTouched: false })}
                  >
                    عُدِّل يدويًا — إعادة الحساب التلقائي ({egp(autoRefund)})
                  </button>
                ) : (
                  `${baseLabel} − الخصم (قابل للتعديل)`
                )
              }
              onChange={(v) => update({ refund: v, refundTouched: true })}
            />
          </div>

          <p className="t-caption flex items-start gap-1.5 text-fg-3">
            <IconAlert size={13} className="mt-0.5 shrink-0" />
            الخصم والمبلغ المرتد يُحفظان في هذا المتصفح فقط (الـAPI لا يحتوي حقولًا لهما بعد)؛ أما إلغاء العقد
            وتاريخ الإلغاء وسببه والوحدة فكلها على الخادم.
          </p>
        </form>
      </Drawer>
      {confirmDialog}
    </div>
  )
}
