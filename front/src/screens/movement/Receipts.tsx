import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useData, egp, fmtDate, type ISODate, type Settings } from '@/lib'
import { TODAY_ISO } from '@/data'
import {
  ApiError,
  cancelReceipt,
  clearToken,
  createReceipt,
  fetchActiveContracts,
  fetchContract,
  fetchReceipts,
  hasToken,
  PAYMENT_METHOD_TO_API,
  PAYMENT_METHODS,
  type ApiContract,
  type ApiReceipt,
  type PageMeta,
} from '@/lib/api'
import {
  Btn,
  Combobox,
  DataTable,
  DatePicker,
  IconAlert,
  IconCheckCircle,
  IconFile,
  IconTrash,
  IconWallet,
  Modal,
  NumericInput,
  SectionCard,
  Select,
  StatusChip,
  TextInput,
  Textarea,
  useConfirm,
  useToast,
  useUnsaved,
  toLatinDigits,
  type Column,
  type RecordView,
} from '@/kit'
import { PrintAmount, PrintFields, PrintLayout, PrintSignatures, printDocument } from '@/kit/print'
import { shortcutLabel, useShortcutAction } from '@/kit/shortcuts'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL, codeLine } from '@/lib/codes'
import { ApiLoginCard, FilterChips, InfoPair, RECEIPT_PREFILL_KEY, useNewShortcut, useShake, type Errors } from './shared'

const SEARCH_DELAY_MS = 300
const req = 'هذا الحقل مطلوب'

/** 401/419 means the stored token is missing, revoked or expired. */
const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)

/** API money is a decimal string; `null`/missing is zero. */
const money = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** Keys of the locally chosen lines: `down` (مقدم/تأمين) or `i-<installment id>`. */
const DOWN = 'down'
const lineKey = (installmentId: number | null) => (installmentId === null ? DOWN : `i-${installmentId}`)

type Draft = {
  date: ISODate | null
  contractId: string | null
  method: string
  amount: number | null
  reference: string
  notes: string
}
type Key = keyof Draft

const emptyDraft = (contractId: string | null = null): Draft => ({
  date: TODAY_ISO,
  contractId,
  method: PAYMENT_METHODS[0],
  amount: null,
  reference: '',
  notes: '',
})

/** Pre-fill handed over by demo screens («تسجيل دفع»); only a numeric API id can be honoured. */
function takePrefill(): { contractId: string | null; installmentId: number | null } {
  try {
    const raw = sessionStorage.getItem(RECEIPT_PREFILL_KEY)
    sessionStorage.removeItem(RECEIPT_PREFILL_KEY)
    if (!raw) return { contractId: null, installmentId: null }
    const p = JSON.parse(raw) as { contractId?: string; installmentId?: string }
    const contractId = p.contractId && /^\d+$/.test(p.contractId) ? p.contractId : null
    const installmentId = p.installmentId && /^\d+$/.test(p.installmentId) ? Number(p.installmentId) : null
    return { contractId, installmentId }
  } catch {
    return { contractId: null, installmentId: null }
  }
}

type PayRow = {
  key: string
  installmentId: number | null
  seq: number | null
  dueDate: ISODate
  /** The full amount of the line. */
  amount: number
  /** What was already collected before this receipt. */
  paid: number
}

type Filter = 'الكل' | 'صالح' | 'ملغي'
const FILTERS: readonly Filter[] = ['الكل', 'صالح', 'ملغي']
const SORT_FIELDS: Record<string, string> = {
  number: 'number',
  date: 'paid_at',
  amount: 'total_amount',
  status: 'status',
}
const STATUS_FROM_API: Record<string, string> = { valid: 'مدفوع', cancelled: 'ملغي' }

/** `2026-10-29T00:00:00Z` / `2026-10-29` → `2026-10-29`. */
const day = (value: string) => value.slice(0, 10)

/* ==================================================================
   Screen
   ================================================================== */

export default function Receipts() {
  const { settings } = useData()
  const toast = useToast()
  const { confirm, dialog: confirmDialog } = useConfirm()

  // ── Session ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => hasToken())
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Receipts list (server) ───────────────────────────────────────────────
  const [rows, setRows] = useState<ApiReceipt[]>([])
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, last_page: 1, per_page: 15, total: 0, from: null, to: null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('الكل')
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  // ── Form ────────────────────────────────────────────────────────────────
  const prefill = useRef(takePrefill())
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(prefill.current.contractId))
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<Errors<Key>>({})
  const [formRef, shake] = useShake<HTMLDivElement>()
  const { prompt } = useUnsaved(dirty)

  const [contracts, setContracts] = useState<ApiContract[]>([])
  const [contractEpoch, setContractEpoch] = useState(0)
  const [contract, setContract] = useState<ApiContract | null>(null)
  const [loadingContract, setLoadingContract] = useState(false)
  const [saving, setSaving] = useState(false)
  const [rowPay, setRowPay] = useState<Record<string, number>>({})
  /** Bumped on every reset: NumericInput keeps its own text until remounted. */
  const [formEpoch, setFormEpoch] = useState(0)
  /** Bumped when the lines are typed by hand, so «المبلغ المستلم» re-reads the new sum. */
  const [totalEpoch, setTotalEpoch] = useState(0)

  // ── Cancel dialog ───────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<ApiReceipt | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const lostSession = useCallback((notice: string) => {
    clearToken()
    setAuthed(false)
    setRows([])
    setContract(null)
    setLoginNotice(notice)
  }, [])

  const reloggedIn = useCallback(() => {
    setAuthed(true)
    setLoginNotice(null)
    setLoadError(null)
    setSearchInput('')
    setSearch('')
    setFilter('الكل')
    setPage(0)
    reload()
    setContractEpoch((k) => k + 1)
  }, [])

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setDirty(true)
    setErrors((e) => {
      const next = { ...e }
      for (const k of Object.keys(patch) as Key[]) delete next[k]
      return next
    })
  }

  // ── Data: receipts page ─────────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (!authed) return
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchReceipts({
      search,
      status: filter === 'الكل' ? undefined : filter === 'صالح' ? 'valid' : 'cancelled',
      page: page + 1,
      sort: sort ? SORT_FIELDS[sort.key] : undefined,
      dir: sort?.dir,
    })
      .then((result) => {
        if (!alive) return
        setRows(result.items)
        setMeta(result.meta)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل الإيصالات من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, search, filter, page, sort, reloadKey])

  // ── Data: active contracts (the picker) ─────────────────────────────────
  useEffect(() => {
    if (!authed) return
    let alive = true
    fetchActiveContracts()
      .then((list) => {
        if (!alive) return
        setContracts(list)
        // A handoff may name a contract: keep it only if it is really collectable.
        setDraft((d) => {
          if (!d.contractId) return d
          return list.some((c) => String(c.id) === d.contractId) ? d : { ...d, contractId: null }
        })
      })
      .catch((err: unknown) => {
        if (!alive) return
        if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        toast.error('تعذّر تحميل العقود النشطة', err instanceof Error ? err.message : undefined)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, contractEpoch])

  // ── Data: the picked contract with its installments ─────────────────────
  useEffect(() => {
    if (!authed || !draft.contractId) {
      setContract(null)
      return
    }
    let alive = true
    setLoadingContract(true)
    fetchContract(Number(draft.contractId))
      .then((c) => {
        if (!alive) return
        setContract(c)
        // Handoff from «تسجيل دفع»: select that installment once.
        const handed = prefill.current.installmentId
        if (handed && c.installments?.some((i) => i.id === handed && Number(i.remaining) > 0)) {
          const line = c.installments.find((i) => i.id === handed)!
          setRowPay({ [lineKey(handed)]: Number(line.remaining) })
          setDraft((d) => ({ ...d, amount: Number(line.remaining) }))
        }
        prefill.current.installmentId = null
      })
      .catch((err: unknown) => {
        if (!alive) return
        setContract(null)
        if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        toast.error('تعذّر تحميل العقد', err instanceof Error ? err.message : undefined)
      })
      .finally(() => {
        if (alive) setLoadingContract(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, draft.contractId])

  const pickContract = (id: string | null) => {
    setRowPay({})
    setContract(null)
    update({ contractId: id, amount: null })
  }

  // ── Lines to collect ────────────────────────────────────────────────────
  const payList = useMemo<PayRow[]>(() => {
    if (!contract) return []
    const list: PayRow[] = []
    const downRemaining = Number(contract.remaining_down_payment ?? 0)
    if (downRemaining > 0) {
      list.push({
        key: DOWN,
        installmentId: null,
        seq: 0,
        dueDate: day(contract.contract_date),
        amount: Number(contract.agreed_down_payment),
        paid: Number(contract.paid_down_payment ?? 0),
      })
    }
    const installments = [...(contract.installments ?? [])].sort((a, b) => a.sequence_number - b.sequence_number)
    for (const i of installments) {
      if (Number(i.remaining) <= 0) continue
      list.push({
        key: lineKey(i.id),
        installmentId: i.id,
        seq: i.sequence_number,
        dueDate: day(i.due_date),
        amount: Number(i.amount),
        paid: Number(i.paid_amount),
      })
    }
    return list
  }, [contract])

  const room = (r: PayRow) => Math.max(0, r.amount - r.paid)
  /**
   * Only lines with a positive amount are lines. A picked row that the typed amount does not reach is
   * dropped again, so «حدّد الكل» ثم كتابة مبلغ جزئي sends one partial line instead of zero-amount lines.
   */
  const payRows = payList.filter((r) => (rowPay[r.key] ?? 0) > 0)
  const amount = draft.amount ?? 0
  const spread = payRows.reduce((sum, r) => sum + (rowPay[r.key] ?? 0), 0)
  const after = payRows.reduce((sum, r) => sum + room(r) - (rowPay[r.key] ?? 0), 0)

  const applyPay = (m: Record<string, number>, received?: number | null) => {
    setRowPay(m)
    update({ amount: received === undefined ? (Object.values(m).reduce((a, b) => a + b, 0) || null) : received })
  }

  const toggleRow = (r: PayRow, on: boolean) => {
    const m = { ...rowPay }
    if (on) m[r.key] = room(r)
    else delete m[r.key]
    applyPay(m)
  }

  /**
   * Typing an amount fills the picked lines first (in table order, each up to its remaining), then the
   * lines after them, and drops whatever is left at zero — so one amount may cover a part of one line,
   * all of several lines, or everything up to the end of the schedule.
   */
  const receive = (v: number | null) => {
    let left = v ?? 0
    const picked = payList.filter((r) => (rowPay[r.key] ?? 0) > 0)
    const order = picked.length ? [...picked, ...payList.filter((r) => !picked.includes(r))] : payList
    const m: Record<string, number> = {}
    for (const r of order) {
      if (left <= 0) break
      const cap = room(r)
      if (cap <= 0) continue
      const take = Math.min(cap, left)
      if (take > 0) m[r.key] = Math.round(take * 100) / 100
      left -= take
    }
    applyPay(m, v)
  }

  /**
   * A single line typed by hand: it is capped at what that line still owes, and «المبلغ المستلم» is
   * rebuilt as the sum, so the total and the lines can never disagree.
   */
  const setLine = (r: PayRow, raw: string) => {
    const digits = toLatinDigits(raw).replace(/[^\d.]/g, '')
    const m = { ...rowPay }
    if (digits === '' || digits === '.') {
      delete m[r.key]
      applyPay(m)
      setTotalEpoch((k) => k + 1)
      return
    }
    const n = Number(digits)
    if (!Number.isFinite(n)) return
    const take = Math.min(Math.max(0, n), room(r))
    if (take > 0) m[r.key] = Math.round(take * 100) / 100
    else delete m[r.key]
    applyPay(m)
    // The total field keeps its own text while focused; remount it so it shows the new sum.
    setTotalEpoch((k) => k + 1)
  }

  // ── Validation & save ───────────────────────────────────────────────────
  const validate = () => {
    const e: Errors<Key> = {}
    if (!draft.date) e.date = req
    if (!draft.contractId) e.contractId = req
    if (!payRows.length) e.amount = 'حدّد قسطًا واحدًا على الأقل من الجدول'
    if (!draft.method) e.method = req
    if (!e.amount) {
      if (!draft.amount || draft.amount <= 0) e.amount = 'أدخل مبلغًا صحيحًا'
      else if (Math.abs(draft.amount - spread) > 0.001)
        e.amount =
          draft.amount > spread
            ? `المبلغ أكبر من المتاح للتحصيل (${egp(spread)})`
            : `المبلغ لا يطابق الموزَّع على الأقساط المحددة (${egp(spread)})`
    }
    setErrors(e)
    if (Object.keys(e).length) {
      shake()
      return false
    }
    return true
  }

  const receiptLabel = (r: ApiReceipt) =>
    [
      ...(r.installments ?? []).map((line) =>
        line.sequence_number === null ? 'قسط' : `القسط ${line.sequence_number}${line.due_date ? ` (استحقاق ${fmtDate(day(line.due_date))})` : ''}`,
      ),
      ...(r.down_payment ? ['المقدم/التأمين'] : []),
    ].join(' + ') || '—'

  const save = async () => {
    if (!contract || saving) return
    if (!validate()) return
    setSaving(true)
    // Only positive lines are sent (validate() already guaranteed the total matches them).
    const lines = payRows
      .filter((r) => r.installmentId !== null && (rowPay[r.key] ?? 0) > 0)
      .map((r) => ({ installmentId: r.installmentId!, amount: rowPay[r.key]! }))
    const downLine = (rowPay[DOWN] ?? 0) > 0 ? rowPay[DOWN] : null
    try {
      const created = await createReceipt({
        contractId: contract.id,
        paidAt: draft.date!,
        method: PAYMENT_METHOD_TO_API[draft.method] ?? null,
        reference: draft.reference,
        notes: draft.notes,
        installments: lines,
        downPayment: downLine,
      })
      setDirty(false)
      toast.show({
        tone: 'success',
        title: 'تم حفظ الإيصال',
        description: `${created.number} — ${egp(money(created.total_amount))}${after > 0 ? ` · متبقي ${egp(after)} (جزئي)` : ' · تم سداد الدفعة بالكامل'}`,
        action: { label: 'طباعة', onClick: () => printReceipt(created, after) },
      })
      setDraft(emptyDraft())
      setRowPay({})
      setContract(null)
      setErrors({})
      setFormEpoch((k) => k + 1)
      setPage(0)
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      // A server-side cap (a line paid elsewhere meanwhile) lands on the amount field. Use the field
      // messages themselves, never the exception's «… (and 1 more error)» summary.
      const message =
        err instanceof ApiError
          ? Object.values(err.errors).flat()[0] ?? (err.status === 422 ? err.message : undefined)
          : undefined
      if (message) setErrors({ amount: message })
      toast.error('تعذّر حفظ الإيصال', message ?? (err instanceof Error ? err.message : undefined))
    } finally {
      setSaving(false)
    }
  }

  useShortcutAction('save', () => void save())
  useNewShortcut(() => {
    setDraft(emptyDraft())
    setRowPay({})
    setContract(null)
    setErrors({})
    setDirty(false)
    setFormEpoch((k) => k + 1)
  })

  // ── Print ───────────────────────────────────────────────────────────────
  const printReceipt = (r: ApiReceipt, remainingAfter: number | null = null) => {
    void printDocument(
      <ReceiptDoc
        settings={settings}
        number={r.number}
        date={day(r.paid_at)}
        clientName={r.client_name ?? '—'}
        contractNumber={r.contract_number ?? '—'}
        unit={[r.building_name, [r.unit_type_label, r.unit_name].filter(Boolean).join(' ')].filter(Boolean).join(' — ') || '—'}
        forLabel={receiptLabel(r)}
        method={r.payment_method_label ?? '—'}
        reference={r.reference ?? ''}
        amount={money(r.total_amount)}
        remainingAfter={remainingAfter}
        notes={r.notes ?? ''}
      />,
      `إيصال-${r.number}`,
    )
  }

  // ── Cancel ──────────────────────────────────────────────────────────────
  const openCancel = (r: ApiReceipt) => {
    setCancelTarget(r)
    setCancelReason('')
  }

  const doCancel = async () => {
    if (!cancelTarget || !cancelReason.trim() || cancelling) return
    setCancelling(true)
    try {
      await cancelReceipt(cancelTarget.id, cancelReason.trim())
      toast.success('تم إلغاء الإيصال', `${cancelTarget.number} — أُلغيت دفعاته وعادت الأقساط كما كانت.`)
      setCancelTarget(null)
      setCancelReason('')
      setPage((p) => (rows.length === 1 && p > 0 ? p - 1 : p))
      reload()
    } catch (err) {
      if (isAuthError(err)) return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
      toast.error('تعذّر إلغاء الإيصال', err instanceof Error ? err.message : undefined)
    } finally {
      setCancelling(false)
    }
  }

  // ── Table ───────────────────────────────────────────────────────────────
  const confirmCancel = async (r: ApiReceipt) => {
    const ok = await confirm({
      title: 'إلغاء الإيصال؟',
      description: 'سيتم إلغاء كل الدفعات التي أنشأها هذا الإيصال، وتعود الأقساط إلى ما كانت عليه. لا يُحذف شيء.',
      details: [
        ['الإيصال', r.number],
        ['العميل', r.client_name ?? '—'],
        ['العقد', r.contract_number ?? '—'],
        ['المبلغ', egp(money(r.total_amount))],
      ],
      confirmLabel: 'متابعة',
    })
    if (ok) openCancel(r)
  }

  const columns = useMemo<Column<ApiReceipt>[]>(
    () => [
      { key: 'number', header: CODE_LABEL.receipt, cell: (r) => <span className="font-semibold tabular-nums text-fg">{r.number}</span> },
      serialColumn('receipt', (r) => r.number),
      { key: 'date', header: 'التاريخ', value: (r) => day(r.paid_at), cell: (r) => <span className="tabular-nums">{fmtDate(day(r.paid_at))}</span> },
      { key: 'contract', header: 'العقد', sortable: false, value: (r) => r.contract_number ?? '', cell: (r) => r.contract_number ?? '—' },
      { key: 'client', header: 'العميل', sortable: false, value: (r) => r.client_name ?? '', cell: (r) => <span className="font-semibold text-fg">{r.client_name ?? '—'}</span> },
      { key: 'for', header: 'الدفعة', sortable: false, value: (r) => receiptLabel(r) },
      { key: 'method', header: 'طريقة الدفع', sortable: false, value: (r) => r.payment_method_label ?? '—' },
      {
        key: 'amount',
        header: 'المبلغ',
        align: 'end',
        cell: (r) => <span className={cn('tabular-nums', r.status === 'cancelled' ? 'text-fg-3 line-through' : 'text-success')}>{egp(money(r.total_amount))}</span>,
      },
      {
        key: 'status',
        header: 'الحالة',
        value: (r) => STATUS_FROM_API[r.status] ?? r.status,
        cell: (r) => <StatusChip status={STATUS_FROM_API[r.status] ?? r.status} size="sm" />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const receiptView = (r: ApiReceipt): RecordView => ({
    title: r.number,
    subtitle: `${r.client_name ?? '—'} · ${r.contract_number ?? '—'}`,
    status: <StatusChip status={STATUS_FROM_API[r.status] ?? r.status} size="sm" />,
    sections: [
      {
        key: 'info',
        title: 'بيانات الإيصال',
        content: (
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <InfoPair label="التاريخ" value={fmtDate(day(r.paid_at))} />
            <InfoPair label="طريقة الدفع" value={r.payment_method_label ?? '—'} />
            <InfoPair label="رقم الشيك/التحويل" value={r.reference || '—'} ltr />
            <InfoPair label="المبلغ" value={egp(money(r.total_amount))} strong />
            <InfoPair label="المبنى" value={r.building_name ?? '—'} />
            <InfoPair label="الوحدة" value={[r.unit_type_label, r.unit_name].filter(Boolean).join(' ') || '—'} />
            <InfoPair label="سجّله" value={r.created_by_name ?? '—'} />
          </div>
        ),
      },
      {
        key: 'lines',
        title: 'الدفعات المغطاة',
        count: (r.installments?.length ?? 0) + (r.down_payment ? 1 : 0),
        content: (
          <ul className="grid gap-1.5 text-sm">
            {(r.installments ?? []).map((line) => (
              <li key={line.payment_id} className="flex items-baseline justify-between gap-3">
                <span className="text-fg-2">
                  {line.sequence_number === null ? 'قسط' : `القسط ${line.sequence_number}`}
                  {line.due_date ? ` — استحقاق ${fmtDate(day(line.due_date))}` : ''}
                </span>
                <span className="font-semibold tabular-nums">{egp(money(line.amount))}</span>
              </li>
            ))}
            {r.down_payment && (
              <li className="flex items-baseline justify-between gap-3">
                <span className="text-fg-2">المقدم/التأمين</span>
                <span className="font-semibold tabular-nums">{egp(money(r.down_payment.amount))}</span>
              </li>
            )}
          </ul>
        ),
      },
      ...(r.status === 'cancelled'
        ? [
            {
              key: 'cancel',
              title: 'الإلغاء',
              content: (
                <div className="grid gap-1 text-sm">
                  <InfoPair label="تاريخ الإلغاء" value={r.cancelled_at ? fmtDate(day(r.cancelled_at)) : '—'} />
                  <InfoPair label="السبب" value={r.cancel_reason || '—'} />
                </div>
              ),
            },
          ]
        : []),
      ...(r.notes ? [{ key: 'notes', title: 'ملاحظات', content: <p className="m-0 text-sm text-fg-2">{r.notes}</p> }] : []),
    ],
    onPrint: () => printReceipt(r),
    printLabel: 'طباعة الإيصال',
    ...(r.status === 'valid'
      ? { extraActions: [{ label: 'إلغاء الإيصال', title: 'إلغاء الإيصال وكل دفعاته', onClick: () => void confirmCancel(r) }] }
      : {}),
  })

  if (!authed) {
    return <ApiLoginCard entity="الإيصالات" icon={<IconFile size={20} />} notice={loginNotice} onLoggedIn={reloggedIn} />
  }

  const contractOptions = contracts.map((c) => ({
    value: String(c.id),
    label: `${c.number} — ${c.client_name ?? '—'}`,
    description: `${c.type === 'rent' ? 'إيجار' : 'بيع'} · ${[c.building_name, c.unit_name].filter(Boolean).join(' — ') || '—'}`,
    keywords: [c.client_name, c.unit_name, c.building_name].filter(Boolean).join(' '),
  }))

  return (
    <div className="grid gap-4">
      <div ref={formRef} className="grid gap-4">
        <SectionCard
          title="إيصال قبض"
          description="إيصال واحد قد يغطي عدة أقساط و/أو جزءًا من المقدم — الحقول المعلَّمة بـ * مطلوبة"
          icon={<IconFile size={20} />}
          columns={2}
        >
          <TextInput label="رقم الإيصال" value="تلقائي" readOnly hint="يُولَّد على الخادم عند الحفظ" />
          <DatePicker
            label="تاريخ الاستلام"
            required
            value={draft.date}
            error={errors.date}
            max={TODAY_ISO}
            today={TODAY_ISO}
            onChange={(v) => update({ date: v })}
          />

          <Combobox
            containerClassName="md:col-span-2"
            label="العقد"
            required
            placeholder="ابحث برقم العقد أو اسم العميل…"
            options={contractOptions}
            value={draft.contractId}
            error={errors.contractId}
            clearable
            emptyText="لا توجد عقود نشطة — رحّل عقدًا أولًا"
            onChange={pickContract}
          />

          {loadingContract && <p className="md:col-span-2 t-caption text-fg-3">جارٍ تحميل أقساط العقد…</p>}

          {contract && (
            <div className="rise-in md:col-span-2 flex flex-wrap gap-x-6 gap-y-2 rounded-ctl border border-hairline px-4 py-3">
              <InfoPair label="العميل" value={contract.client_name ?? '—'} strong />
              <InfoPair label="النوع" value={contract.type === 'rent' ? 'إيجار' : 'بيع'} />
              <InfoPair label="الوحدة" value={[contract.building_name, contract.unit_name].filter(Boolean).join(' — ') || '—'} />
              <InfoPair label="إجمالي المتبقي على العقد" value={egp(contract.remaining_total)} />
              {Number(contract.remaining_down_payment) > 0 && (
                <InfoPair label="متبقي المقدم/التأمين" value={egp(Number(contract.remaining_down_payment))} />
              )}
            </div>
          )}

          {contract && (
            <div className="rise-in md:col-span-2 overflow-x-auto rounded-ctl border border-hairline">
              <p className="m-0 border-b border-hairline px-3 py-2 t-caption text-fg-3">
                اكتب «المدفوع الآن» في أي سطر مباشرةً (لا يزيد عن المتبقي) — أو اكتب الإجمالي في «المبلغ المستلم» ليُوزَّع
                على الأسطر المحددة.
              </p>
              <table className="kit-table" data-plain>
                <thead>
                  <tr>
                    <th className="w-10 px-1.5 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label="تحديد كل الأقساط غير المسددة"
                        className="size-4 cursor-pointer accent-[var(--primary)]"
                        checked={payList.some((r) => room(r) > 0) && payList.filter((r) => room(r) > 0).every((r) => r.key in rowPay)}
                        onChange={(e) => {
                          const m: Record<string, number> = {}
                          if (e.target.checked) for (const r of payList) if (room(r) > 0) m[r.key] = room(r)
                          applyPay(m)
                        }}
                      />
                    </th>
                    <th className="px-1.5 py-2 text-start font-bold">التاريخ</th>
                    <th className="px-1.5 py-2 text-start font-bold">المبلغ</th>
                    <th className="px-1.5 py-2 text-start font-bold">المدفوع الآن</th>
                    <th className="px-1.5 py-2 text-start font-bold">المتبقي</th>
                    <th className="px-1.5 py-2 text-start font-bold">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {payList.map((r) => {
                    const checked = (rowPay[r.key] ?? 0) > 0
                    const pay = rowPay[r.key] ?? 0
                    const left = r.amount - r.paid - pay
                    const tone =
                      left <= 0 ? 'border-success/40 bg-success-soft text-success' : r.paid + pay > 0 ? 'border-warning/40 bg-warning-soft text-warning' : 'border-danger/40 bg-danger-soft text-danger'
                    return (
                      <tr key={r.key} className={cn('kit-row t-body', r.installmentId === null && 'kit-row-down')} data-active={checked || undefined}>
                        <td className="px-1.5 py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label="تحديد كمسدَّد الآن"
                            className="size-4 cursor-pointer accent-[var(--primary)] disabled:cursor-not-allowed"
                            checked={checked}
                            disabled={room(r) <= 0 && !checked}
                            onChange={(e) => toggleRow(r, e.target.checked)}
                          />
                        </td>
                        <td className="px-1.5 py-2 tabular-nums">
                          {r.installmentId === null ? (
                            <span className="me-2 rounded-ctl bg-warning-soft px-1.5 py-0.5 text-xs font-bold text-warning">مقدم</span>
                          ) : (
                            <span className="me-2 text-fg-3">#{r.seq}</span>
                          )}
                          {fmtDate(r.dueDate)}
                        </td>
                        <td className="px-1.5 py-2 tabular-nums">{egp(r.amount)}</td>
                        <td className="px-1.5 py-2">
                          <div className="grid gap-0.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`المدفوع الآن — ${r.installmentId === null ? 'المقدم/التأمين' : `القسط ${r.seq}`}`}
                              className="w-28 rounded-ctl border border-hairline bg-transparent px-2 py-1 text-sm font-bold tabular-nums text-fg focus:border-primary focus:outline-none"
                              placeholder="0"
                              value={pay > 0 ? String(pay) : ''}
                              onChange={(e) => setLine(r, e.target.value)}
                              onFocus={(e) => e.target.select()}
                            />
                            {r.paid > 0 && (
                              <span className="t-caption text-[11px] text-fg-3">سابقًا {egp(r.paid)}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-1.5 py-2">
                          <output className={cn('block w-28 rounded-ctl border px-2 py-1 text-sm font-bold tabular-nums', tone)}>{egp(Math.max(0, left))}</output>
                        </td>
                        <td className="px-1.5 py-2">
                          {checked && amount > 0 ? <StatusChip size="sm" status={left <= 0 ? 'مدفوع' : 'جزئي'} /> : '—'}
                        </td>
                      </tr>
                    )
                  })}
                  {!payList.length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center t-caption">
                        لا يوجد متبقٍ على هذا العقد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <Select label="طريقة الدفع" required options={PAYMENT_METHODS} value={draft.method} error={errors.method} onChange={(e) => update({ method: e.target.value })} />
          <NumericInput
            key={`${formEpoch}-${totalEpoch}`}
            label="المبلغ المستلم"
            required
            suffix="ج.م"
            min={0}
            value={draft.amount}
            error={errors.amount}
            hint={
              payRows.length && amount > 0 && after > 0
                ? 'دفعة جزئية — ستُسجَّل الدفعة «جزئي»'
                : 'اكتب المبلغ هنا ليُوزَّع على الأسطر المحددة، أو اكتب «المدفوع الآن» في أي سطر مباشرةً'
            }
            onChange={receive}
          />
          <TextInput label="رقم الشيك/التحويل" dir="ltr" value={draft.reference} onChange={(e) => update({ reference: e.target.value })} />
          <Textarea label="ملاحظات (اختياري)" rows={1} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
        </SectionCard>

        <SectionCard title="ملخص الدفعة" icon={<IconWallet size={20} />} columns={3}>
          <Figure label="قيمة الأقساط المحددة" value={payRows.length ? egp(payRows.reduce((a, r) => a + r.amount, 0)) : '—'} />
          <Figure label="المسدد سابقًا" value={payRows.length ? egp(payRows.reduce((a, r) => a + r.paid, 0)) : '—'} tone="text-success" />
          <Figure
            label="المتبقي بعد هذا السداد"
            value={payRows.length ? egp(after) : '—'}
            tone={!payRows.length ? '' : after === 0 ? 'text-success' : 'text-warning'}
            badge={payRows.length && amount > 0 ? <StatusChip size="sm" status={after === 0 ? 'مدفوع' : 'جزئي'} /> : null}
          />
        </SectionCard>

        <div className="flex flex-wrap justify-end gap-2">
          <Btn
            iconStart={<IconCheckCircle size={16} />}
            loading={saving}
            onClick={() => void save()}
            aria-keyshortcuts="Control+S Meta+S"
            title={`حفظ (${shortcutLabel('S')})`}
          >
            حفظ الإيصال
          </Btn>
        </div>
      </div>

      <FilterChips
        label="تصفية حسب حالة الإيصال"
        options={FILTERS}
        value={filter}
        onChange={(v) => {
          setFilter(v)
          setPage(0)
        }}
      />

      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-warning/40 bg-warning-soft px-4 py-2.5 t-caption text-fg-2">
          <span>{loadError}</span>
          <Btn size="sm" variant="glass" onClick={reload}>
            إعادة المحاولة
          </Btn>
        </div>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => String(r.id)}
        title={
          <div className="flex items-center gap-2">
            <span className="font-semibold text-fg">الإيصالات السابقة</span>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => {
                clearToken()
                setAuthed(false)
                setRows([])
                setContract(null)
                setLoginNotice(null)
              }}
            >
              خروج
            </Btn>
          </div>
        }
        caption="الإيصالات السابقة"
        loading={loading}
        searchPlaceholder="ابحث برقم الإيصال أو العميل أو العقد…"
        serverSearch={{ value: searchInput, onChange: setSearchInput }}
        serverSort={{ value: sort, onChange: (s) => { setSort(s); setPage(0) } }}
        serverPagination={{ page, pageCount: meta.last_page, total: meta.total, from: meta.from ?? 0, to: meta.to ?? 0, onChange: setPage }}
        exportName="إيصالات-القبض"
        actionsWidth="8rem"
        detail={receiptView}
        actions={(r) => (
          <div className="flex items-center justify-end gap-1">
            <Btn size="sm" variant="ghost" onClick={() => printReceipt(r)}>
              طباعة
            </Btn>
            {r.status === 'valid' && (
              <Btn size="sm" variant="ghost" className="text-danger" onClick={() => void confirmCancel(r)} title="إلغاء الإيصال">
                <IconTrash size={16} />
              </Btn>
            )}
          </div>
        )}
        emptyText="لا توجد إيصالات بعد."
      />

      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        size="sm"
        tone="danger"
        icon={<IconAlert size={20} />}
        title="إلغاء الإيصال"
        description={
          cancelTarget
            ? `${cancelTarget.number} — ${egp(money(cancelTarget.total_amount))}. تُلغى كل دفعاته وتعود الأقساط كما كانت.`
            : undefined
        }
        footer={
          <>
            <Btn variant="ghost" onClick={() => setCancelTarget(null)}>
              تراجع
            </Btn>
            <Btn variant="danger" loading={cancelling} disabled={!cancelReason.trim()} onClick={() => void doCancel()}>
              إلغاء الإيصال
            </Btn>
          </>
        }
      >
        <Textarea
          label="سبب الإلغاء"
          required
          rows={2}
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          hint="يُسجَّل السبب في سجل التدقيق ولا يمكن التراجع."
        />
      </Modal>

      {prompt}
      {confirmDialog}
    </div>
  )
}

/* ==================================================================
   Pieces
   ================================================================== */

function Figure({ label, value, tone = '', badge }: { label: string; value: string; tone?: string; badge?: ReactNode }) {
  return (
    <div className="rounded-ctl border border-hairline px-4 py-3" aria-live="polite">
      <div className="t-caption flex items-center justify-between gap-2">
        {label}
        {badge}
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${tone || 'text-fg'}`}>{value}</div>
    </div>
  )
}

/* ==================================================================
   Print
   ================================================================== */

type ReceiptDocProps = {
  settings: Settings
  number: string
  date: ISODate
  clientName: string
  contractNumber: string
  unit: string
  forLabel: string
  method: string
  reference: string
  amount: number
  /** null when unknown (reprints of old receipts). */
  remainingAfter: number | null
  notes: string
}

function ReceiptDoc(r: ReceiptDocProps) {
  return (
    <PrintLayout settings={r.settings} title="إيصال قبض" subtitle={`${codeLine('receipt', r.number)} · التاريخ: ${fmtDate(r.date)}`}>
      <PrintFields
        items={[
          ['استلمنا من', r.clientName],
          ['العقد', r.contractNumber],
          ['الوحدة', r.unit],
          ['وذلك عن', r.forLabel],
          ['طريقة الدفع', r.method],
          r.reference ? ['رقم الشيك/التحويل', <bdi dir="ltr">{r.reference}</bdi>] : null,
          r.remainingAfter !== null ? ['المتبقي بعد الدفعة', egp(r.remainingAfter)] : null,
          r.notes ? ['ملاحظات', r.notes] : null,
        ]}
      />
      <PrintAmount label="المبلغ المستلم" value={egp(r.amount)} />
      <PrintSignatures labels={['المستلم', 'توقيع العميل']} />
    </PrintLayout>
  )
}
