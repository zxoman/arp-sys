import { useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  clearToken,
  fetchAuditLogs,
  type ApiAuditLog,
  type PageMeta,
} from '@/lib/api'
import { Text } from '@/components/ui'
import {
  Btn,
  DataTable,
  Drawer,
  FieldGrid,
  IconEye,
  IconInfo,
  IconRefresh,
  MiniTable,
  Select,
  TextInput,
  type Column,
} from '@/kit'
import { codeOf, fmtNum } from './movement/shared'

const SEARCH_DELAY_MS = 350

/**
 * Arabic label per `App\Enums\AuditAction` value. Anything unknown falls back to the raw value so a
 * new action never renders blank.
 */
const ACTION_LABELS: Record<string, string> = {
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  restore: 'استرجاع',
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  failed_login: 'محاولة دخول فاشلة',
  password_change: 'تغيير كلمة مرور',
  status_change: 'تغيير حالة',
  cancel: 'إلغاء',
  post: 'ترحيل',
  convert: 'تحويل',
  rejected_operation: 'عملية مرفوضة',
  export: 'تصدير',
  payment: 'سداد',
  permission_change: 'تغيير صلاحيات',
}

/** Badge colour per action family. */
const ACTION_TONE: Record<string, string> = {
  create: 'bg-success-soft text-success',
  update: 'bg-primary-soft text-primary',
  delete: 'bg-danger-soft text-danger',
  cancel: 'bg-warning-soft text-warning',
  login: 'bg-neutral-soft text-fg-2',
  logout: 'bg-neutral-soft text-fg-2',
  failed_login: 'bg-danger-soft text-danger',
  rejected_operation: 'bg-danger-soft text-danger',
}

const ENTITY_LABELS: Record<string, string> = {
  buildings: 'المباني',
  floors: 'الأدوار',
  units: 'الوحدات',
  clients: 'العملاء',
  reservations: 'الحجوزات',
  reservation_payments: 'دفعات الحجز',
  contracts: 'العقود',
  installments: 'الأقساط',
  installment_payments: 'دفعات الأقساط',
  contract_down_payments: 'المقدمات',
  receipts: 'الإيصالات',
  settings: 'الإعدادات',
  users: 'المستخدمون',
  roles: 'الأدوار',
  auth: 'الحساب',
}

/** Entity types the API writes today, for the filter picker. */
const ENTITY_TYPES = Object.keys(ENTITY_LABELS)

const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))

const isAuthError = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 419)

const dateTimeOf = (value: string | null | undefined) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const actionLabel = (value: string | null) => (value ? (ACTION_LABELS[value] ?? value) : '—')
const entityLabel = (value: string | null) => (value ? (ENTITY_LABELS[value] ?? value) : '—')

/** `{ total_price: "500000.00" }` → readable RTL rows; nested objects fall back to JSON. */
function valueRows(values: Record<string, unknown> | null): [string, string][] {
  if (!values) return []
  return Object.entries(values).map(([key, value]) => {
    let shown: string
    if (value === null || value === undefined || value === '') shown = '—'
    else if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value))) {
      const n = Number(value)
      shown = Number.isFinite(n) ? n.toLocaleString('ar-EG') : String(value)
    } else if (typeof value === 'object') shown = JSON.stringify(value, null, 2)
    else shown = String(value)
    return [key, shown]
  })
}

/**
 * `GET /admin/audit-logs` — the append-only audit trail every service writes through
 * `AuditLogger`. Read-only: filters by text, action, entity type, user and date range.
 */
export default function Logs() {
  const [rows, setRows] = useState<ApiAuditLog[]>([])
  const [meta, setMeta] = useState<PageMeta>({ current_page: 1, last_page: 1, per_page: 20, total: 0, from: null, to: null })
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [current, setCurrent] = useState<ApiAuditLog | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setLoadError(null)
    fetchAuditLogs({
      search,
      action: action || undefined,
      entityType: entityType || undefined,
      from: from || undefined,
      to: to || undefined,
      page: page + 1,
    })
      .then((result) => {
        if (!alive) return
        setRows(result.items)
        setMeta(result.meta)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setRows([])
        if (isAuthError(err)) {
          clearToken()
          return
        }
        setLoadError(err instanceof Error ? err.message : 'تعذّر تحميل سجل العمليات من الخادم')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [search, action, entityType, from, to, page, reloadKey])

  const reload = () => setReloadKey((k) => k + 1)
  const resetFilters = () => {
    setSearchInput('')
    setSearch('')
    setAction('')
    setEntityType('')
    setFrom('')
    setTo('')
    setPage(0)
  }

  const columns: Column<ApiAuditLog>[] = [
    {
      key: 'occurred_at',
      header: 'التاريخ والوقت',
      width: '11rem',
      value: (l) => l.occurred_at ?? '',
      cell: (l) => <span className="tabular-nums text-fg-2">{dateTimeOf(l.occurred_at)}</span>,
    },
    {
      key: 'user',
      header: 'المستخدم',
      value: (l) => (l.is_automatic ? 'النظام' : (l.user_name ?? '')),
      cell: (l) => (
        <span className="font-semibold text-fg">
          {l.is_automatic ? 'النظام' : (l.user_name ?? '—')}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'العملية',
      width: '8rem',
      value: (l) => actionLabel(l.action),
      cell: (l) => {
        const tone = (l.action && ACTION_TONE[l.action]) || 'bg-neutral-soft text-fg-2'
        return (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-bold ${tone}`}>
            {actionLabel(l.action)}
          </span>
        )
      },
    },
    {
      key: 'entity',
      header: 'الكيان',
      width: '9rem',
      value: (l) => `${entityLabel(l.entity_type)} ${l.entity_id ?? ''}`,
      cell: (l) => (
        <span className="text-fg-2">
          {entityLabel(l.entity_type)}
          {l.entity_id != null && <span className="tabular-nums text-fg-3"> #{fmtNum(l.entity_id)}</span>}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'السبب / الوصف',
      cell: (l) => (
        <span className="line-clamp-1 max-w-[26rem] text-fg-2" title={l.reason ?? undefined}>
          {l.reason ?? '—'}
        </span>
      ),
    },
    {
      key: 'ip',
      header: 'IP',
      width: '8rem',
      value: (l) => l.ip ?? '',
      cell: (l) => (l.ip ? <span dir="ltr" className="tabular-nums text-fg-3">{l.ip}</span> : <span className="text-fg-3">—</span>),
    },
  ]

  const oldRows = useMemo(() => valueRows(current?.old_values ?? null), [current])
  const newRows = useMemo(() => valueRows(current?.new_values ?? null), [current])
  const notLoaded = loadError !== null && rows.length === 0

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
        rows={rows}
        columns={columns}
        rowKey={(l) => String(l.id)}
        caption="سجل العمليات"
        loading={loading}
        title={
          <div className="flex items-center gap-2">
            <Btn variant="glass" size="sm" iconStart={<IconRefresh size={15} />} onClick={reload}>
              تحديث
            </Btn>
            <Btn variant="ghost" size="sm" onClick={resetFilters}>
              إعادة ضبط الفلاتر
            </Btn>
          </div>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="نوع العملية"
              value={action}
              onChange={(e) => {
                setAction(e.target.value)
                setPage(0)
              }}
              options={[{ value: '', label: 'كل العمليات' }, ...ACTION_OPTIONS]}
            />
            <Select
              aria-label="الكيان"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value)
                setPage(0)
              }}
              options={[{ value: '', label: 'كل الكيانات' }, ...ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_LABELS[t] }))]}
            />
            <TextInput
              type="date"
              aria-label="من تاريخ"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value)
                setPage(0)
              }}
            />
            <TextInput
              type="date"
              aria-label="إلى تاريخ"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value)
                setPage(0)
              }}
            />
          </div>
        }
        serverSearch={{ value: searchInput, onChange: setSearchInput }}
        serverPagination={{
          page,
          pageCount: meta.last_page,
          total: meta.total,
          from: meta.from ?? 0,
          to: meta.to ?? 0,
          onChange: setPage,
        }}
        searchPlaceholder="ابحث في الوصف أو الكيان أو المسار…"
        exportName="سجل-العمليات"
        actionsWidth="5rem"
        onRowClick={setCurrent}
        actions={(l) => (
          <Btn variant="ghost" size="sm" iconStart={<IconEye size={15} />} onClick={() => setCurrent(l)}>
            عرض
          </Btn>
        )}
        emptyText={notLoaded ? 'لا توجد بيانات من الخادم.' : 'لا توجد عمليات مسجّلة مطابقة للفلاتر.'}
      />

      <Drawer
        open={current !== null}
        onClose={() => setCurrent(null)}
        size="lg"
        icon={<IconInfo size={20} />}
        title={current ? actionLabel(current.action) : 'تفاصيل العملية'}
        description={
          current
            ? `${codeOf(`log-${current.id}`)} — ${dateTimeOf(current.occurred_at)} — ${current.is_automatic ? 'النظام' : (current.user_name ?? '—')}`
            : undefined
        }
        footer={
          <Btn variant="ghost" onClick={() => setCurrent(null)}>
            إغلاق
          </Btn>
        }
      >
        {current && (
          <div className="grid gap-5">
            <FieldGrid
              items={[
                ['العملية', actionLabel(current.action)],
                ['الكيان', `${entityLabel(current.entity_type)}${current.entity_id != null ? ` #${fmtNum(current.entity_id)}` : ''}`],
                ['المستخدم', current.is_automatic ? 'النظام (تلقائي)' : (current.user_name ?? '—')],
                ['نوع الفاعل', current.actor_type ?? '—'],
                ['التاريخ', dateTimeOf(current.occurred_at)],
                ['IP', current.ip ?? '—'],
                ['الطريقة', current.http_method ?? '—'],
                ['المسار', current.endpoint ?? '—'],
                ['رقم العملية', current.operation_id ?? '—'],
              ]}
            />

            <div className="grid gap-1.5">
              <Text variant="label">الوصف</Text>
              <Text variant="body" className="text-fg-2">
                {current.reason ?? '—'}
              </Text>
            </div>

            {current.changed_fields?.length ? (
              <div className="grid gap-1.5">
                <Text variant="label">الحقول المتغيرة</Text>
                <div className="flex flex-wrap gap-1.5">
                  {current.changed_fields.map((f) => (
                    <span key={f} className="rounded-full bg-neutral-soft px-2 py-0.5 text-[12px] font-semibold text-fg-2">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {oldRows.length > 0 && (
              <div className="grid gap-1.5">
                <Text variant="label">القيم قبل</Text>
                <MiniTable
                  headers={['الحقل', 'القيمة']}
                  rows={oldRows.map(([k, v]) => [<span key={k} className="font-mono text-[12px]">{k}</span>, v])}
                  empty="—"
                />
              </div>
            )}

            {newRows.length > 0 && (
              <div className="grid gap-1.5">
                <Text variant="label">القيم بعد</Text>
                <MiniTable
                  headers={['الحقل', 'القيمة']}
                  rows={newRows.map(([k, v]) => [<span key={k} className="font-mono text-[12px]">{k}</span>, v])}
                  empty="—"
                />
              </div>
            )}

            {current.meta && Object.keys(current.meta).length > 0 && (
              <div className="grid gap-1.5">
                <Text variant="label">بيانات إضافية</Text>
                <pre dir="ltr" className="overflow-x-auto rounded-ctl border border-hairline bg-neutral-soft p-3 text-[12px] leading-relaxed">
                  {JSON.stringify(current.meta, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
