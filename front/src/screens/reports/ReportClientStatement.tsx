import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { egp, fmtDate, paymentLabel, upfrontLabel, type ContractStatus, type ContractType, type ISODate } from '@/lib'
import { toISO } from '@/lib/domain'
import { ApiLoginCard, CONTRACT_TYPE_TONE, contractTypeLabel } from '../movement/shared'
import { Combobox, DatePicker, GlassSurface, IconAlert, IconCheckCircle, IconFile, IconPhone, IconUsers, IconWallet, Select, StatusChip, SummaryCard, type Column } from '@/kit'
import { Text, type BadgeTone } from '@/components/ui'
import { ChartCard, KpiGrid, ReportActions, ReportFilterBar, ReportTable, inRange } from './shared'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL } from '@/lib/codes'
import {
  ApiError,
  clearToken,
  fetchAllClients,
  fetchCustomerStatement,
  hasToken,
  PAYMENT_METHOD_FROM_API,
  STATEMENT_ALL_TIME_FROM,
  STATEMENT_ALL_TIME_TO,
  type ApiCustomerStatement,
  type ApiCustomerStatementContract,
} from '@/lib/api'

/** The screen runs on the server's real calendar, not the demo seed's fixed `TODAY_ISO`. */
const REAL_TODAY: ISODate = toISO(new Date())

const CONTRACT_TONE: Record<ContractStatus, BadgeTone> = {
  مسودة: 'neutral',
  نشط: 'indigo',
  مكتمل: 'green',
  منتهي: 'neutral',
  مجدد: 'sky',
  مرتجع: 'yellow',
  ملغي: 'red',
}

const STATUS_LABEL: Record<string, ContractStatus> = { draft: 'مسودة', active: 'نشط', cancelled: 'ملغي' }
const contractType = (type: 'sale' | 'rent' | null): ContractType => (type === 'rent' ? 'إيجار' : 'بيع')
const num = (v: string | number | null | undefined) => Number(v ?? 0)
const Money = ({ v, warn }: { v: number; warn?: boolean }) => <span className={`tabular-nums ${warn && v > 0 ? 'text-warning' : ''}`}>{egp(v)}</span>

/** One movement of the ledger: the down payment and each scheduled row debit, each payment credits. */
type Entry = {
  id: string
  date: ISODate
  order: number
  label: string
  contract: string | null
  debit: number
  credit: number
}

type LedgerRow = Entry & { balance: number }

/** The client's contracts as the «عقود العميل» table prints them. */
type ContractRow = {
  id: number
  number: string
  type: ContractType
  date: ISODate | null
  unit: string | null
  status: string
  value: number
  upfront: number
  upfrontPaid: number
  upfrontRemaining: number
  installmentsTotal: number
  paidCount: number
  rowsCount: number
  installmentsPaid: number
  overdue: number
  totalPaid: number
  totalRemaining: number
  nextDue: { seq: number; date: ISODate } | null
}

function contractRow(c: ApiCustomerStatementContract): ContractRow {
  const rows = c.installments.filter((i) => i.status !== 'cancelled')
  const paid = rows.filter((i) => num(i.remaining) <= 0)
  const next = rows.find((i) => num(i.remaining) > 0)
  return {
    id: c.id,
    number: c.number,
    type: contractType(c.type),
    date: (c.contract_date ?? '').slice(0, 10) || null,
    unit: c.unit,
    status: c.status ?? '',
    value: num(c.total_price),
    upfront: num(c.agreed_down_payment),
    upfrontPaid: num(c.down_payment_paid),
    upfrontRemaining: num(c.down_payment_remaining),
    installmentsTotal: num(c.installment_totals.required),
    paidCount: paid.length,
    rowsCount: rows.length,
    installmentsPaid: num(c.installment_totals.paid),
    overdue: num(c.installment_totals.overdue),
    totalPaid: num(c.total_collected),
    totalRemaining: num(c.total_remaining),
    nextDue: next ? { seq: next.sequence_number, date: (next.due_date ?? '').slice(0, 10) } : null,
  }
}

export default function ReportClientStatement() {
  // ── Session ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => hasToken())
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Client picker (server) ───────────────────────────────────────────────
  const [clientOptions, setClientOptions] = useState<{ value: string; label: string; description?: string; keywords?: string }[]>([])
  const [clientId, setClientId] = useState<string | null>(null)
  const picked = useMemo(() => clientOptions.find((o) => o.value === clientId) ?? null, [clientOptions, clientId])

  // ── The statement itself (all time; the period is filtered locally) ──────
  const [data, setData] = useState<ApiCustomerStatement | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // ── Local filters ────────────────────────────────────────────────────────
  const [from, setFrom] = useState<ISODate | null>(null)
  const [to, setTo] = useState<ISODate | null>(null)
  const [contractNumber, setContractNumber] = useState('')

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
    setClientId(null)
    setFrom(null)
    setTo(null)
    setContractNumber('')
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!authed) return
    let alive = true
    fetchAllClients()
      .then((clients) => {
        if (!alive) return
        setClientOptions(
          clients.map((c) => ({
            value: String(c.id),
            label: c.name,
            description: [c.phone, c.phone_2].filter(Boolean).join(' · '),
            keywords: c.national_id ?? '',
          })),
        )
      })
      .catch(() => {
        // The statement still works once a client is picked from a previous list.
      })
    return () => {
      alive = false
    }
  }, [authed, reloadKey])

  useEffect(() => {
    if (!authed || !clientId) {
      setData(null)
      return
    }
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchCustomerStatement({ clientId, from: STATEMENT_ALL_TIME_FROM, to: STATEMENT_ALL_TIME_TO })
      .then((result) => {
        if (alive) setData(result)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setData(null)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل كشف الحساب')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [authed, clientId, reloadKey, lostSession])

  // A client change starts a new statement, so a contract of the old client cannot stay selected.
  useEffect(() => setContractNumber(''), [clientId])

  const contracts = useMemo<ContractRow[]>(() => (data?.contracts ?? []).map(contractRow), [data])
  const shownContracts = useMemo(
    () => (contractNumber ? contracts.filter((c) => c.number === contractNumber) : contracts),
    [contracts, contractNumber],
  )

  /** The ledger of the whole client (contract filter applied later, before the running balance). */
  const entries = useMemo<Entry[]>(() => {
    if (!data) return []
    const typeOf = new Map(data.contracts.map((c) => [c.id, contractType(c.type)]))
    const number = new Map(data.contracts.map((c) => [c.id, c.number]))
    const unit = new Map(data.contracts.map((c) => [c.id, c.unit]))
    const seq = new Map<number, number>()
    for (const c of data.contracts) for (const i of c.installments) seq.set(i.id, i.sequence_number)

    const out: Entry[] = []
    for (const c of data.contracts) {
      // A cancelled contract keeps its money movements but its schedule is closed.
      const upfront = num(c.agreed_down_payment)
      if (upfront > 0 && c.contract_date) {
        const what = upfrontLabel(contractType(c.type))
        out.push({
          id: `dp-${c.id}`,
          date: c.contract_date.slice(0, 10),
          order: 0,
          label: `${what}${unit.get(c.id) ? ` الوحدة ${unit.get(c.id)}` : ''}`,
          contract: c.number,
          debit: upfront,
          credit: 0,
        })
      }
      for (const i of c.installments) {
        if (i.status === 'cancelled' || !i.due_date) continue
        out.push({
          id: `i-${i.id}`,
          date: i.due_date.slice(0, 10),
          order: 1,
          label: `استحقاق ${paymentLabel(contractType(c.type), i.sequence_number)}`,
          contract: c.number,
          debit: num(i.amount),
          credit: 0,
        })
      }
    }

    for (const p of data.payments) {
      if (p.is_cancelled || p.status === 'cancelled' || !p.paid_at) continue
      const type = p.contract_id !== null ? typeOf.get(p.contract_id) : undefined
      const what =
        p.payment_type === 'reservation'
          ? 'دفعة حجز'
          : p.payment_type === 'down_payment'
            ? `سداد ${upfrontLabel(type ?? 'بيع')}`
            : `سداد ${paymentLabel(type ?? 'بيع', p.entity_id !== null ? (seq.get(p.entity_id) ?? null) : null)}`
      const method = p.payment_method ? PAYMENT_METHOD_FROM_API[p.payment_method] : null
      out.push({
        id: `p-${p.id}`,
        date: p.paid_at.slice(0, 10),
        order: 2,
        label: method ? `${what} (${method})` : what,
        contract: p.contract_id !== null ? (number.get(p.contract_id) ?? p.contract_number) : null,
        debit: 0,
        credit: num(p.amount),
      })
    }

    out.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
    return out
  }, [data])

  /**
   * The contract filter rebuilds the running balance for that contract alone; the period only hides
   * rows, so the closing balance keeps meaning «what is left» at the end of the period.
   */
  const scoped = useMemo<LedgerRow[]>(() => {
    const rows = contractNumber ? entries.filter((e) => e.contract === contractNumber) : entries
    let run = 0
    return rows.map((e) => ((run += e.debit - e.credit), { ...e, balance: run }))
  }, [entries, contractNumber])
  const shown = useMemo(() => scoped.filter((e) => inRange(e.date, from, to)), [scoped, from, to])
  const totals = useMemo(
    () => ({
      debit: shown.reduce((s, e) => s + e.debit, 0),
      credit: shown.reduce((s, e) => s + e.credit, 0),
      overdue: shownContracts.reduce((s, c) => s + c.overdue, 0),
    }),
    [shown, shownContracts],
  )
  /** Carried forward: everything up to the period's end, so the closing balance still means «المتبقي». */
  const closing = useMemo(() => scoped.filter((e) => !to || e.date <= to).at(-1)?.balance ?? 0, [scoped, to])
  const cancelled = useMemo(() => (data?.payments ?? []).filter((p) => p.is_cancelled || p.status === 'cancelled'), [data])

  const contractOptions = useMemo(
    () => [{ value: '', label: 'كل العقود' }, ...contracts.map((c) => ({ value: c.number, label: `${c.number} — ${contractTypeLabel(c.type)}${c.unit ? ` — وحدة ${c.unit}` : ''}` }))],
    [contracts],
  )

  const columns = useMemo<Column<LedgerRow>[]>(
    () => [
      { key: 'date', header: 'التاريخ', value: (e) => `${e.date}-${e.order}`, csv: (e) => fmtDate(e.date), cell: (e) => <span className="tabular-nums">{fmtDate(e.date)}</span> },
      {
        key: 'label',
        header: 'البيان',
        cell: (e) => (
          <span className="grid">
            <span className={e.credit ? 'text-success' : 'text-fg'}>{e.label}</span>
            <span className="t-caption tabular-nums">{e.contract ? `عقد ${e.contract}` : 'حجز — بدون عقد'}</span>
          </span>
        ),
      },
      { key: 'debit', header: 'مدين', align: 'end', cell: (e) => (e.debit ? <Money v={e.debit} /> : <span className="text-fg-3">—</span>) },
      { key: 'credit', header: 'دائن', align: 'end', cell: (e) => (e.credit ? <span className="tabular-nums text-success">{egp(e.credit)}</span> : <span className="text-fg-3">—</span>) },
      { key: 'balance', header: 'الرصيد', align: 'end', cell: (e) => <span className="font-bold tabular-nums text-fg">{egp(e.balance)}</span> },
    ],
    [],
  )

  const contractColumns = useMemo<Column<ContractRow>[]>(
    () => [
      { key: 'number', header: CODE_LABEL.contract, cell: (r) => <span className="font-semibold tabular-nums text-fg">{r.number}</span> },
      serialColumn('contract', (r) => r.number),
      { key: 'unit', header: 'الوحدة', value: (r) => r.unit ?? '', cell: (r) => r.unit ?? <span className="text-fg-3">—</span> },
      { key: 'type', header: 'النوع', value: (r) => contractTypeLabel(r.type), cell: (r) => <StatusChip status={contractTypeLabel(r.type)} tone={CONTRACT_TYPE_TONE[r.type]} size="sm" /> },
      { key: 'value', header: 'قيمة العقد', align: 'end', cell: (r) => <Money v={r.value} /> },
      { key: 'upfront', header: 'المقدم/التأمين', align: 'end', cell: (r) => <Money v={r.upfront} /> },
      { key: 'upfrontPaid', header: 'المسدد منه', align: 'end', cell: (r) => <Money v={r.upfrontPaid} /> },
      { key: 'upfrontRemaining', header: 'باقي المقدم/التأمين', align: 'end', cell: (r) => <Money v={r.upfrontRemaining} warn /> },
      { key: 'installmentsTotal', header: 'إجمالي الأقساط', align: 'end', cell: (r) => <Money v={r.installmentsTotal} /> },
      {
        key: 'paidCount',
        header: 'الدفعات المسددة',
        align: 'center',
        value: (r) => r.paidCount,
        csv: (r) => `${r.paidCount}/${r.rowsCount}`,
        cell: (r) => <span className="tabular-nums">{r.paidCount} / {r.rowsCount}</span>,
      },
      { key: 'installmentsPaid', header: 'مجموع المسدد', align: 'end', cell: (r) => <Money v={r.installmentsPaid} /> },
      {
        key: 'next',
        header: 'الدفعة الحالية',
        value: (r) => r.nextDue?.date ?? '',
        csv: (r) => (r.nextDue ? `#${r.nextDue.seq} ${fmtDate(r.nextDue.date)}` : '—'),
        cell: (r) => (r.nextDue ? <span className="tabular-nums">#{r.nextDue.seq} — {fmtDate(r.nextDue.date)}</span> : <span className="text-fg-3">—</span>),
      },
      { key: 'overdue', header: 'المتأخر', align: 'end', cell: (r) => (r.overdue > 0 ? <span className="tabular-nums text-danger">{egp(r.overdue)}</span> : <span className="text-fg-3">—</span>) },
      { key: 'totalRemaining', header: 'إجمالي المتبقي', align: 'end', cell: (r) => <span className="font-bold tabular-nums text-fg">{egp(r.totalRemaining)}</span> },
      { key: 'status', header: 'الحالة', value: (r) => r.status, cell: (r) => <StatusChip status={STATUS_LABEL[r.status] ?? '—'} tone={CONTRACT_TONE[STATUS_LABEL[r.status]] ?? 'neutral'} size="sm" /> },
    ],
    [],
  )

  const active = !!(contractNumber || from || to)
  const units = useMemo(() => [...new Set(contracts.map((c) => c.unit).filter((u): u is string => !!u))], [contracts])

  if (!authed) {
    return (
      <ApiLoginCard
        entity="كشف حساب عميل"
        icon={<IconFile size={20} />}
        notice={loginNotice}
        onLoggedIn={reloggedIn}
      />
    )
  }

  return (
    <>
      <p className="t-caption px-1 print:hidden">المدين = المستحق على العميل | الدائن = المسدد | الرصيد = المتبقي</p>
      <ReportFilterBar active={active} onReset={() => (setContractNumber(''), setFrom(null), setTo(null))}>
        <Combobox
          label="العميل"
          required
          placeholder="ابحث بالاسم أو الهاتف أو الرقم القومي…"
          options={clientOptions}
          value={clientId}
          onChange={setClientId}
          clearable
        />
        <Select label="العقد" options={contractOptions} value={contractNumber} onChange={(e) => setContractNumber(e.target.value)} disabled={!clientId} />
        <DatePicker label="من تاريخ" value={from} onChange={setFrom} max={to ?? undefined} today={REAL_TODAY} clearable />
        <DatePicker label="إلى تاريخ" value={to} onChange={setTo} min={from ?? undefined} today={REAL_TODAY} clearable />
      </ReportFilterBar>

      {loadError && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          <IconAlert size={16} />
          <span className="flex-1">{loadError}</span>
          <button type="button" className="rounded-ctl px-2 py-1 font-semibold underline" onClick={() => setReloadKey((k) => k + 1)}>
            إعادة المحاولة
          </button>
        </div>
      )}

      {!clientId ? (
        <GlassSurface variant="strong" padding="lg" className="grid place-items-center gap-2 text-center">
          <IconUsers size={28} className="text-fg-3" />
          <Text variant="section">اختر عميلًا لعرض كشف حسابه</Text>
        </GlassSurface>
      ) : (
        <>
          <GlassSurface variant="strong" padding="md" className="rise-in flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex items-center gap-4">
              <span className="grid size-14 place-items-center rounded-full bg-[var(--primary-soft)] text-xl font-bold text-primary">{(data?.client.name ?? picked?.label ?? '؟').trim()[0]}</span>
              <div>
                <Text variant="section">{data?.client.name ?? picked?.label ?? '—'}</Text>
                <span className="t-caption inline-flex items-center gap-1.5">
                  <IconPhone size={14} /> <bdi dir="ltr" className="tabular-nums">{data?.client.phone ?? '—'}</bdi>
                </span>
              </div>
            </div>
            <Pair label="الرقم القومي" value={<bdi dir="ltr" className="tabular-nums">{picked?.keywords || '—'}</bdi>} />
            <Pair label="الوحدات" value={units.length ? units.join('، ') : 'لا توجد'} />
            <Pair label="العقود" value={<span className="tabular-nums">{contracts.length}</span>} />
            <Pair label="الفترة" value={<span className="tabular-nums">{from || to ? `${from ? fmtDate(from) : 'البداية'} — ${to ? fmtDate(to) : 'اليوم'}` : 'كل الحركات'}</span>} />
          </GlassSurface>

          <KpiGrid>
            <SummaryCard label="إجمالي المدين" value={totals.debit} format={egp} tone="neutral" icon={<IconFile size={20} />} hint={`${shown.length} حركة`} />
            <SummaryCard label="إجمالي الدائن (المسدد)" value={totals.credit} format={egp} tone="success" icon={<IconCheckCircle size={20} />} />
            <SummaryCard label="الرصيد المستحق" value={closing} format={egp} tone="warning" icon={<IconWallet size={20} />} hint={to ? `حتى ${fmtDate(to)}` : 'شامل الدفعات المستقبلية'} />
            <SummaryCard label="متأخرات" value={totals.overdue} format={egp} tone="danger" icon={<IconAlert size={20} />} hint="أقساط تجاوزت تاريخ استحقاقها" />
          </KpiGrid>

          <ReportTable
            rows={shown}
            columns={columns}
            rowKey={(e) => e.id}
            caption={data ? `كشف حساب ${data.client.name}` : 'كشف حساب العميل'}
            loading={loading}
            searchPlaceholder="ابحث في البيان أو رقم العقد…"
            initialSort={{ key: 'date', dir: 'asc' }}
            emptyText="لا توجد حركات في هذه الفترة."
          />
          <GlassSurface variant="strong" padding="sm" className="grid grid-cols-2 gap-3 px-5 sm:grid-cols-4" aria-label="إجماليات الكشف">
            <Pair label="الحركات" value={`${shown.length} حركة`} />
            <Pair label="مدين" value={<span className="tabular-nums">{egp(totals.debit)}</span>} />
            <Pair label="دائن" value={<span className="tabular-nums text-success">{egp(totals.credit)}</span>} />
            <Pair label="الرصيد الختامي" value={<span className="tabular-nums font-bold text-fg">{egp(closing)}</span>} />
          </GlassSurface>
          {cancelled.length > 0 && (
            <p className="t-caption px-1">
              لا تدخل {cancelled.length} دفعة ملغاة (بإجمالي {egp(cancelled.reduce((s, p) => s + num(p.amount), 0))}) في الرصيد؛ الإيصالات الملغاة لا تُحذف.
            </p>
          )}
          <ReportActions
            title={data ? `كشف حساب ${data.client.name}` : 'كشف حساب عميل'}
            fileName={`كشف-حساب-${(data?.client.name ?? 'عميل').replace(/\s+/g, '-')}`}
            columns={columns}
            rows={shown}
            shareText={`مدين ${egp(totals.debit)} · دائن ${egp(totals.credit)} · الرصيد ${egp(closing)}`}
            details={[
              ['العميل', data?.client.name ?? picked?.label ?? '—'],
              ['الهاتف', data?.client.phone ?? '—'],
              ['الرقم القومي', picked?.keywords || '—'],
              ['الوحدات', units.length ? units.join('، ') : 'لا توجد'],
              ['الفترة', from || to ? `${from ? fmtDate(from) : 'البداية'} — ${to ? fmtDate(to) : 'اليوم'}` : 'كل الحركات'],
              ['الرصيد الختامي', egp(closing)],
            ]}
          />

          <ChartCard title="عقود العميل" description="عقود العميل وقيم ملخص كل عقد">
            <ReportTable
              rows={shownContracts}
              columns={contractColumns}
              rowKey={(r) => String(r.id)}
              caption={data ? `عقود ${data.client.name}` : 'عقود العميل'}
              searchable={false}
              loading={loading}
              initialSort={{ key: 'number', dir: 'asc' }}
              emptyText="لا توجد عقود لهذا العميل."
              exportName={`عقود-${(data?.client.name ?? 'عميل').replace(/\s+/g, '-')}-${REAL_TODAY}`}
            />
          </ChartCard>
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
