import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { egp, fmtDate, type ISODate } from '@/lib'
import { addMonths } from '@/lib/domain'
import { TODAY_ISO } from '@/data'
import {
  AnimatedNumber,
  Btn,
  DataTable,
  GlassSurface,
  IconAlert,
  IconCheckCircle,
  IconChevronNext,
  IconChevronPrev,
  IconWallet,
  IconX,
  StatusChip,
  type Column,
} from '@/kit'
import {
  ApiError,
  clearToken,
  EMPTY_COLLECTION_META,
  fetchCollectionCalendar,
  fetchCollections,
  hasToken,
  type ApiCalendarDay,
  type ApiCollectionRow,
  type CollectionMeta,
  type CollectionStatus,
} from '@/lib/api'
import { ApiLoginCard, CONTRACT_TYPE_TONE, goToReceipt, useNewShortcut } from './shared'
import { serialColumn } from '@/kit/codes'
import { CODE_LABEL } from '@/lib/codes'

/* ==================================================================
   Model
   ================================================================== */

/** Display status: the API recomputes it against today (overdue wins over partial). */
type DueStatus = 'مستحق' | 'متأخر' | 'جزئي' | 'مدفوع'
type Filter = 'الكل' | DueStatus
const FILTERS: Filter[] = ['الكل', 'مستحق', 'متأخر', 'جزئي', 'مدفوع']
const FILTER_TO_API: Record<Exclude<Filter, 'الكل'>, CollectionStatus> = {
  مستحق: 'due',
  متأخر: 'overdue',
  جزئي: 'partially_paid',
  مدفوع: 'paid',
}
const STATUS_LABEL: Record<CollectionStatus, DueStatus> = {
  due: 'مستحق',
  overdue: 'متأخر',
  partially_paid: 'جزئي',
  paid: 'مدفوع',
}
const TONE = { مستحق: 'indigo', متأخر: 'red', جزئي: 'yellow', مدفوع: 'green' } as const

type Tab = 'الأقساط' | 'المقدمات'
const TABS: readonly Tab[] = ['الأقساط', 'المقدمات']
const TAB_TO_ENDPOINT = { الأقساط: 'installments', المقدمات: 'down-payments' } as const

type TypeFilter = 'الكل' | 'بيع' | 'إيجار'
const TYPE_FILTERS: readonly TypeFilter[] = ['الكل', 'بيع', 'إيجار']
const TYPE_TO_API = { بيع: 'sale', إيجار: 'rent' } as const

type SortState = { key: string; dir: 'asc' | 'desc' } | null
const SORT_FIELDS = new Set(['contract_number', 'due_date', 'amount', 'paid_amount', 'remaining', 'sequence_number'])

const SEARCH_DELAY_MS = 300

/** API money is a decimal string; `null`/missing is zero. */
const money = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

const unitLabel = (row: ApiCollectionRow) => [row.building_name, row.unit_name].filter(Boolean).join(' — ') || '—'

/* ==================================================================
   Screen
   ================================================================== */

export default function RentDue() {
  // ── Session ──────────────────────────────────────────────────────────────
  const [authed, setAuthed] = useState(() => hasToken())
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  // ── Collection list (server) ─────────────────────────────────────────────
  const [rows, setRows] = useState<ApiCollectionRow[]>([])
  const [meta, setMeta] = useState<CollectionMeta>(EMPTY_COLLECTION_META)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('الأقساط')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('الكل')
  const [filter, setFilter] = useState<Filter>('الكل')
  const [day, setDay] = useState<ISODate | null>(null)
  const [month, setMonth] = useState<ISODate>(() => `${TODAY_ISO.slice(0, 7)}-01`)
  const [sort, setSort] = useState<SortState>({ key: 'due_date', dir: 'asc' })
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  // ── Month calendar (server) ──────────────────────────────────────────────
  const [calendarDays, setCalendarDays] = useState<ApiCalendarDay[]>([])

  useNewShortcut(() => {
    location.hash = '#/receipts'
  })

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
    setSearchInput('')
    setSearch('')
    setFilter('الكل')
    setPage(0)
    reload()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  // ── Data: one page of rows ───────────────────────────────────────────────
  useEffect(() => {
    if (!authed) return
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchCollections(TAB_TO_ENDPOINT[tab], {
      search,
      type: typeFilter === 'الكل' ? undefined : TYPE_TO_API[typeFilter],
      status: filter === 'الكل' ? undefined : FILTER_TO_API[filter],
      dueOn: day ?? undefined,
      page: page + 1,
      sort: sort && SORT_FIELDS.has(sort.key) ? sort.key : undefined,
      dir: sort?.dir,
      perPage: 15,
    })
      .then((result) => {
        if (!alive) return
        setRows(result.items)
        setMeta(result.meta)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        setMeta(EMPTY_COLLECTION_META)
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          return lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل الأقساط من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, tab, search, typeFilter, filter, day, page, sort, reloadKey])

  // ── Data: calendar of the visible month ──────────────────────────────────
  useEffect(() => {
    if (!authed) return
    let alive = true
    fetchCollectionCalendar(TAB_TO_ENDPOINT[tab], {
      month,
      type: typeFilter === 'الكل' ? undefined : TYPE_TO_API[typeFilter],
    })
      .then((result) => {
        if (alive) setCalendarDays(result.days)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setCalendarDays([])
        if (err instanceof ApiError && (err.status === 401 || err.status === 419)) {
          lostSession('انتهت الجلسة أو التوكن غير صالح. سجّل الدخول من جديد.')
        }
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, tab, month, typeFilter, reloadKey])

  const typeCounts = useMemo<Partial<Record<TypeFilter, number>>>(() => {
    const counts = meta.type_counts
    return { الكل: counts.all, بيع: counts.sale, إيجار: counts.rent }
  }, [meta])

  const statusCounts = useMemo(() => {
    const counts = meta.counts
    return { الكل: counts.all, مستحق: counts.due, متأخر: counts.overdue, جزئي: counts.partially_paid, مدفوع: counts.paid }
  }, [meta])

  const columns = useMemo<Column<ApiCollectionRow>[]>(
    () => [
      {
        key: 'contract_number',
        header: CODE_LABEL.contract,
        cell: (r) => <span className="tabular-nums font-semibold text-fg">{r.contract_number}</span>,
      },
      serialColumn('contract', (r) => r.contract_number),
      {
        key: 'type',
        header: 'النوع',
        sortable: false,
        cell: (r) => (
          <StatusChip
            status={r.contract_type === 'rent' ? 'إيجار' : 'بيع'}
            tone={CONTRACT_TYPE_TONE[r.contract_type === 'rent' ? 'إيجار' : 'بيع']}
            size="sm"
          />
        ),
      },
      { key: 'client_name', header: 'العميل', sortable: false, cell: (r) => r.client_name || '—' },
      { key: 'unit', header: 'الوحدة', sortable: false, cell: unitLabel, searchable: false },
      {
        key: 'sequence_number',
        header: 'رقم القسط',
        align: 'center',
        cell: (r) =>
          r.kind === 'down_payment' ? (
            <span className="rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-[11px] font-bold text-warning">مقدم</span>
          ) : (
            <span className="tabular-nums">{r.sequence_number}</span>
          ),
      },
      {
        key: 'due_date',
        header: 'تاريخ الاستحقاق',
        cell: (r) => <span className={`tabular-nums ${r.is_overdue ? 'text-danger' : ''}`}>{fmtDate(r.due_date)}</span>,
      },
      { key: 'amount', header: 'قيمة القسط', align: 'end', cell: (r) => <span className="tabular-nums">{egp(money(r.amount))}</span> },
      {
        key: 'paid_amount',
        header: 'المسدد',
        align: 'end',
        cell: (r) => <span className="tabular-nums text-success">{egp(money(r.paid_amount))}</span>,
      },
      {
        key: 'remaining',
        header: 'متبقي سداد القسط',
        align: 'end',
        cell: (r) => (
          <span className={`tabular-nums font-bold ${money(r.remaining) > 0 ? 'text-fg' : 'text-fg-3'}`}>{egp(money(r.remaining))}</span>
        ),
      },
      {
        key: 'status',
        header: 'الحالة',
        cell: (r) => {
          const label = STATUS_LABEL[r.status]
          return <StatusChip status={label} tone={TONE[label]} size="sm" />
        },
        searchable: false,
        sortable: false,
        csv: (r) => STATUS_LABEL[r.status],
      },
    ],
    [],
  )

  if (!authed) {
    return (
      <ApiLoginCard
        entity="الأقساط والإيجارات المستحقة"
        icon={<IconWallet size={20} />}
        notice={loginNotice}
        onLoggedIn={reloggedIn}
      />
    )
  }

  return (
    <div className="grid gap-4">
      {/* Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="إجمالي المستحق" value={money(meta.totals.remaining)} tone="text-primary" icon={<IconWallet size={18} />} />
        <Stat label="إجمالي المحصل" value={money(meta.totals.paid)} tone="text-success" icon={<IconCheckCircle size={18} />} />
        <Stat label="إجمالي المتأخر" value={money(meta.totals.overdue)} tone="text-danger" icon={<IconAlert size={18} />} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-hairline bg-neutral-soft p-0.5" role="tablist" aria-label="الأقساط أو المقدمات">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  if (t === tab) return
                  setTab(t)
                  setPage(0)
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  tab === t ? 'bg-[var(--glass-strong)] text-fg shadow-soft' : 'text-fg-3 hover:text-fg'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              clearToken()
              setAuthed(false)
              setRows([])
              setLoginNotice(null)
            }}
            className="text-xs font-semibold text-fg-3 hover:text-danger"
          >
            خروج
          </button>
        </div>
        {tab === 'المقدمات' && (
          <span className="t-caption">المقدم/التأمين يُعرض كسطر واحد بتاريخ العقد، ويُحصَّل من صفحة الإيصالات.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="تصفية حسب نوع العقد">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={typeFilter === t}
            onClick={() => {
              setTypeFilter(t)
              setPage(0)
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm ${
              typeFilter === t
                ? 'border-primary bg-primary text-white shadow-raised'
                : 'border-hairline bg-neutral-soft text-fg-2 hover:text-fg'
            }`}
          >
            {t}
            <span className={`tabular-nums text-xs ${typeFilter === t ? 'text-white/80' : 'text-fg-3'}`}>{typeCounts[t] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        <div className="w-full max-w-xl justify-self-center">
          <DueCalendar days={calendarDays} month={month} onMonth={setMonth} selected={day} onSelect={(d) => { setDay((cur) => (cur === d ? null : d)); setPage(0) }} />
        </div>

        <div className="grid min-w-0 gap-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="تصفية حسب الحالة">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => {
                  setFilter(f)
                  setPage(0)
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm ${
                  filter === f
                    ? 'border-primary bg-primary text-white shadow-raised'
                    : 'border-hairline bg-neutral-soft text-fg-2 hover:text-fg'
                }`}
              >
                {f}
                <span className={`tabular-nums text-xs ${filter === f ? 'text-white/80' : 'text-fg-3'}`}>{statusCounts[f]}</span>
              </button>
            ))}
            {day && (
              <button
                type="button"
                onClick={() => {
                  setDay(null)
                  setPage(0)
                }}
                className="ms-auto inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary-soft px-3 py-1.5 text-sm text-primary"
              >
                يوم {fmtDate(day)}
                <IconX size={14} aria-label="إلغاء تصفية اليوم" />
              </button>
            )}
          </div>

          {loadError && (
            <div className="flex items-center gap-2 rounded-ctl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              <IconAlert size={16} />
              <span className="flex-1">{loadError}</span>
              <Btn size="sm" variant="glass" onClick={reload}>
                إعادة المحاولة
              </Btn>
            </div>
          )}

          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => `${r.kind}-${r.id}`}
            rowClassName={(r) => (r.kind === 'down_payment' ? 'kit-row-down' : undefined)}
            caption={tab === 'الأقساط' ? 'الأقساط المستحقة' : 'المقدمات المستحقة'}
            loading={loading}
            searchPlaceholder="ابحث برقم العقد أو العميل أو الوحدة…"
            exportName={tab === 'الأقساط' ? 'الأقساط-المستحقة' : 'المقدمات-المستحقة'}
            initialSort={{ key: 'due_date', dir: 'asc' }}
            serverSearch={{ value: searchInput, onChange: setSearchInput }}
            serverSort={{ value: sort, onChange: (s) => { setSort(s); setPage(0) } }}
            serverPagination={{ page, pageCount: meta.last_page, total: meta.total, from: meta.from ?? 0, to: meta.to ?? 0, onChange: setPage }}
            actionsWidth="8rem"
            actions={(r) =>
              money(r.remaining) > 0 ? (
                <Btn
                  size="sm"
                  variant={r.is_overdue ? 'danger' : 'primary'}
                  onClick={() => goToReceipt(String(r.contract_id), r.kind === 'installment' ? String(r.id) : undefined)}
                >
                  تسجيل دفع
                </Btn>
              ) : null
            }
            emptyText={day ? 'لا توجد أقساط في هذا اليوم.' : tab === 'الأقساط' ? 'لا توجد أقساط مطابقة.' : 'لا توجد مقدمات مطابقة.'}
          />
        </div>
      </div>
    </div>
  )
}

/* ==================================================================
   Pieces
   ================================================================== */

function Stat({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: ReactNode }) {
  return (
    <GlassSurface className="flex items-center gap-3">
      <span className={`grid size-10 place-items-center rounded-ctl bg-neutral-soft ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <div className="t-caption">{label}</div>
        <AnimatedNumber value={value} format={egp} className={`block text-xl font-bold tabular-nums ${tone}`} />
      </div>
    </GlassSurface>
  )
}

const WEEKDAYS = ['سبت', 'أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة']
const monthName = (iso: ISODate) =>
  new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

type DayKind = 'paid' | 'upcoming' | 'overdue'
const DAY_CLASS: Record<DayKind, string> = {
  paid: 'bg-success/15 text-success',
  upcoming: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  overdue: 'bg-danger/15 text-danger',
}
const DOT_CLASS: Record<DayKind, string> = { paid: 'bg-success', upcoming: 'bg-blue-500', overdue: 'bg-danger' }

function DueCalendar({
  days,
  month,
  onMonth,
  selected,
  onSelect,
}: {
  days: ApiCalendarDay[]
  month: ISODate
  onMonth: (m: ISODate) => void
  selected: ISODate | null
  onSelect: (d: ISODate) => void
}) {
  const prefix = month.slice(0, 7)

  /** Worst state per day: overdue > upcoming > paid. */
  const byDay = useMemo(() => {
    const m = new Map<string, { kind: DayKind; count: number }>()
    for (const d of days) {
      if (!d.date.startsWith(prefix)) continue
      const kind: DayKind = d.overdue > 0 ? 'overdue' : d.due > 0 ? 'upcoming' : 'paid'
      m.set(d.date, { kind, count: d.total })
    }
    return m
  }, [days, prefix])

  const [y, mo] = prefix.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  // getUTCDay: 0 = Sunday; Saturday-first offset.
  const lead = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 1) % 7
  const cells: (ISODate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`),
  ]

  return (
    <GlassSurface className="grid gap-3">
      <div className="flex items-center justify-between">
        <Btn variant="ghost" size="sm" aria-label="الشهر السابق" iconStart={<IconChevronPrev size={16} />} onClick={() => onMonth(addMonths(month, -1))} />
        <div className="text-center">
          <div className="font-semibold text-fg">{monthName(month)}</div>
          {prefix !== TODAY_ISO.slice(0, 7) && (
            <button type="button" className="t-caption text-primary hover:underline" onClick={() => onMonth(`${TODAY_ISO.slice(0, 7)}-01`)}>
              العودة لليوم
            </button>
          )}
        </div>
        <Btn variant="ghost" size="sm" aria-label="الشهر التالي" iconStart={<IconChevronNext size={16} />} onClick={() => onMonth(addMonths(month, 1))} />
      </div>

      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`تقويم الاستحقاقات — ${monthName(month)}`}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="t-caption py-1" role="columnheader">
            {d}
          </div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`e${i}`} />
          const info = byDay.get(iso)
          const isSel = selected === iso
          const isToday = iso === TODAY_ISO
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              aria-selected={isSel}
              aria-label={`${fmtDate(iso)}${info ? ` — ${info.count} قسط` : ''}`}
              disabled={!info}
              onClick={() => onSelect(iso)}
              className={`relative aspect-square rounded-ctl text-sm tabular-nums transition ${
                info ? `${DAY_CLASS[info.kind]} font-semibold hover:brightness-95` : 'text-fg-3'
              } ${isSel ? 'ring-2 ring-primary ring-offset-1 ring-offset-transparent' : ''} ${isToday ? 'outline outline-1 outline-fg-3' : ''}`}
            >
              {Number(iso.slice(8))}
              {info && info.count > 1 && (
                <span className={`absolute bottom-1 left-1/2 size-1.5 -translate-x-1/2 rounded-full ${DOT_CLASS[info.kind]}`} />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-4 border-t border-hairline pt-3 text-xs text-fg-2">
        <Legend kind="paid" label="مدفوع" />
        <Legend kind="upcoming" label="قادم" />
        <Legend kind="overdue" label="متأخر" />
      </div>
    </GlassSurface>
  )
}

function Legend({ kind, label }: { kind: DayKind; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${DOT_CLASS[kind]}`} />
      {label}
    </span>
  )
}
