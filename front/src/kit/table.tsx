import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Text } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useData } from '@/lib'
import { Btn } from './core'
import { PrintFields, PrintLayout, PrintTable, printDocument } from './print'
import { exportXlsx } from './xlsx'
import { RecordPanel, type RecordView } from './record-panel'
import { TextInput } from './fields'
import { IconArrowUp, IconDownload, IconFile, IconSearch, IconX } from './icons'
import { matchesAll, normalizeSearch } from './utils'

/* ==================================================================
   CSV
   ================================================================== */

export type CellValue = string | number | null | undefined

function csvCell(value: CellValue): string {
  if (value == null) return ''
  let text = String(value)
  // Text starting with = + - @ (or a tab/CR) would run as a formula in Excel/Sheets.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** RFC 4180 CSV text (CRLF line endings, quoted where needed, formula-safe). */
export function toCsv(headers: readonly string[], rows: readonly (readonly CellValue[])[]): string {
  const line = (cells: readonly CellValue[]) => cells.map(csvCell).join(',')
  return [line(headers), ...rows.map(line)].join('\r\n')
}

/** Downloads a CSV with a UTF-8 BOM so Excel shows Arabic text correctly. */
export function exportCsv(filename: string, headers: readonly string[], rows: readonly (readonly CellValue[])[]): void {
  const blob = new Blob(['\uFEFF', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ==================================================================
   Pagination
   ================================================================== */

type PageSlot = number | 'gap'

function pageSlots(page: number, count: number): PageSlot[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i)
  const keep = new Set([0, count - 1, page - 1, page, page + 1])
  if (page <= 3) [1, 2, 3, 4].forEach((p) => keep.add(p))
  if (page >= count - 4) [count - 5, count - 4, count - 3, count - 2].forEach((p) => keep.add(p))
  const pages = [...keep].filter((p) => p >= 0 && p < count).sort((a, b) => a - b)
  const slots: PageSlot[] = []
  pages.forEach((p, i) => {
    const gap = i > 0 ? p - pages[i - 1] : 1
    if (gap === 2) slots.push(p - 1)
    else if (gap > 2) slots.push('gap')
    slots.push(p)
  })
  return slots
}

export type PaginationProps = {
  /** Zero-based. */
  page: number
  count: number
  onChange: (page: number) => void
  className?: string
}

/**
 * `« ‹ 1 2 3 › »`. The glyphs are bidi-mirrored characters, so in RTL they point the
 * reading direction (first page is on the right) with no extra CSS.
 */
export function Pagination({ page, count, onChange, className }: PaginationProps) {
  const first = page <= 0
  const last = page >= count - 1
  return (
    <nav aria-label="ترقيم الصفحات" className={cn('kit-pager', className)}>
      <button type="button" className="kit-page" data-glyph="true" aria-label="الصفحة الأولى" disabled={first} onClick={() => onChange(0)}>
        «
      </button>
      <button type="button" className="kit-page" data-glyph="true" aria-label="الصفحة السابقة" disabled={first} onClick={() => onChange(page - 1)}>
        ‹
      </button>
      {pageSlots(page, count).map((slot, i) =>
        slot === 'gap' ? (
          <span key={`gap-${i}`} className="kit-page-gap" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={slot}
            type="button"
            className="kit-page"
            aria-label={`الصفحة ${slot + 1}`}
            aria-current={slot === page ? 'page' : undefined}
            onClick={() => onChange(slot)}
          >
            {slot + 1}
          </button>
        ),
      )}
      <button type="button" className="kit-page" data-glyph="true" aria-label="الصفحة التالية" disabled={last} onClick={() => onChange(page + 1)}>
        ›
      </button>
      <button type="button" className="kit-page" data-glyph="true" aria-label="الصفحة الأخيرة" disabled={last} onClick={() => onChange(count - 1)}>
        »
      </button>
    </nav>
  )
}

/* ==================================================================
   DataTable
   ================================================================== */

export type Column<T> = {
  key: string
  header: ReactNode
  /** Raw value for sorting, searching and CSV. Defaults to `row[key]` when that's a string/number. */
  value?: (row: T) => CellValue
  /** Custom cell rendering; falls back to `value`. */
  cell?: (row: T) => ReactNode
  /** Default true. */
  sortable?: boolean
  /** Included in the search box. Default true. */
  searchable?: boolean
  /** `false` leaves the column out of the CSV; a function overrides the exported value. */
  csv?: false | ((row: T) => CellValue)
  /** CSV header when `header` isn't plain text. */
  csvHeader?: string
  align?: 'start' | 'center' | 'end'
  /** CSS width, e.g. `12rem`; needed for stable columns in virtual mode. */
  width?: string
  /** CSS min-width of the column (set on the header cell). */
  minWidth?: string
  /** Extra classes for the header cell (e.g. `kit-th-wrap`, `kit-sticky`). */
  headerClassName?: string
  className?: string
  /** Left out of the on-screen table but kept in print and export (e.g. a serial number for ordering printed papers). */
  printOnly?: boolean
}

export type SortState = { key: string; dir: 'asc' | 'desc' } | null

export type DataTableProps<T> = {
  rows: readonly T[]
  /** Keep the array identity stable (useMemo) so the search index isn't rebuilt each render. */
  columns: readonly Column<T>[]
  rowKey: (row: T) => string
  /** Per-row buttons in a trailing column; clicks there don't trigger `onRowClick`. */
  actions?: (row: T) => ReactNode
  actionsHeader?: string
  actionsWidth?: string
  /** Rendered at the start of the toolbar. */
  title?: ReactNode
  /** Extra toolbar controls, placed before the export button. */
  toolbar?: ReactNode
  searchable?: boolean
  searchPlaceholder?: string
  /**
   * Server-side search: when set, the table doesn't filter locally and shows this value in the search
   * box. Use with `serverPagination` so the caller controls paging and refetches.
   */
  serverSearch?: { value: string; onChange: (value: string) => void }
  /** Server-side pagination: `rows` is already the current page; `page` is 0-based. */
  serverPagination?: {
    page: number
    pageCount: number
    total: number
    /** 1-based index of the first row on this page (0 when empty). */
    from: number
    /** 1-based index of the last row on this page (0 when empty). */
    to: number
    onChange: (page: number) => void
  }
  /** Server-side sorting: header clicks report the next sort state instead of sorting the loaded rows. */
  serverSort?: { value: SortState; onChange: (sort: SortState) => void }
  /** CSV file name; `false` hides the export button. */
  exportName?: string | false
  /** Called after export with the number of exported rows. */
  onExport?: (count: number) => void
  /** Rows matching this are highlighted red in the Excel export. */
  lateRow?: (row: T) => boolean
  pageSize?: number
  /** Past this many (filtered) rows the table scrolls virtually instead of paginating. */
  virtualThreshold?: number
  /** Fixed row height in virtual mode, px. */
  rowHeight?: number
  initialSort?: SortState
  onRowClick?: (row: T) => void
  /**
   * Builds the side-panel content for a clicked row (prev/next walk the filtered rows). Without
   * it, rows that have no `onRowClick` open a generic panel listing the row's columns; `false`
   * turns the panel off.
   */
  detail?: false | ((row: T) => RecordView | null)
  /** Extra class on a row's `<tr>`. */
  rowClassName?: (row: T) => string | undefined
  emptyText?: ReactNode
  /** Shows skeleton rows instead of data (e.g. while rows are being fetched or computed). */
  loading?: boolean
  /** Accessible table name. */
  caption?: string
  className?: string
  /** Height cap of the scroll area. */
  maxHeightClassName?: string
}

const collator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' })
const OVERSCAN = 8
const HEADER_HEIGHT = 46
const alignClass = { start: 'text-start', center: 'text-center', end: 'text-end' } as const

function cellValue<T>(column: Column<T>, row: T): CellValue {
  if (column.value) return column.value(row)
  const raw = (row as Record<string, unknown>)[column.key]
  return typeof raw === 'string' || typeof raw === 'number' ? raw : undefined
}

const isEmpty = (v: CellValue) => v == null || v === ''

function compareValues(a: CellValue, b: CellValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

/**
 * Search (Arabic-normalized, across searchable columns) → sort (click a header: ascending,
 * descending, off; empty values last) → 20-row pages, or virtual scrolling once more than
 * `virtualThreshold` rows match. Sticky blurred header, zebra stripes, row actions, CSV export of
 * the current filtered + sorted rows.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  actions,
  actionsHeader = 'إجراءات',
  actionsWidth = '9rem',
  title,
  toolbar,
  searchable = true,
  searchPlaceholder = 'ابحث في الجدول…',
  serverSearch,
  serverPagination,
  serverSort,
  exportName = 'export',
  onExport,
  lateRow,
  pageSize = 20,
  virtualThreshold = 100,
  rowHeight = 52,
  initialSort = null,
  onRowClick,
  detail,
  rowClassName,
  emptyText = 'لا توجد بيانات',
  loading = false,
  caption,
  className,
  maxHeightClassName = 'max-h-[68vh]',
}: DataTableProps<T>) {
  const [localQuery, setLocalQuery] = useState('')
  const [localSort, setLocalSort] = useState<SortState>(initialSort)
  const [localPage, setLocalPage] = useState(0)
  const query = serverSearch ? serverSearch.value : localQuery
  const sort = serverSort ? serverSort.value : localSort
  const page = serverPagination ? serverPagination.page : localPage
  const updateQuery = (value: string) => (serverSearch ? serverSearch.onChange(value) : setLocalQuery(value))
  const scrollRef = useRef<HTMLDivElement>(null)
  const { settings } = useData()
  const [openKey, setOpenKey] = useState<string | null>(null)
  const panelOn = detail !== false && (detail !== undefined || !onRowClick)

  const searchIndex = useMemo(() => {
    if (!searchable) return null
    const searchColumns = columns.filter((c) => c.searchable !== false)
    return rows.map((row) => normalizeSearch(searchColumns.map((c) => cellValue(c, row) ?? '').join(' ')))
  }, [rows, columns, searchable])

  const filtered = useMemo(() => {
    const q = serverSearch ? '' : normalizeSearch(query)
    let order = rows.map((_, i) => i)
    if (q && searchIndex) order = order.filter((i) => matchesAll(searchIndex[i], q))
    const column = sort && columns.find((c) => c.key === sort.key)
    if (!serverSort && sort && column) {
      const direction = sort.dir === 'asc' ? 1 : -1
      const values = new Map(order.map((i) => [i, cellValue(column, rows[i])]))
      order.sort((a, b) => {
        const va = values.get(a)
        const vb = values.get(b)
        if (isEmpty(va) || isEmpty(vb)) return isEmpty(va) === isEmpty(vb) ? a - b : isEmpty(va) ? 1 : -1
        return direction * compareValues(va, vb) || a - b
      })
    }
    return order.map((i) => rows[i])
  }, [rows, columns, query, sort, searchIndex, serverSearch, serverSort])

  const total = serverPagination ? serverPagination.total : filtered.length
  const openIndex = openKey == null ? -1 : filtered.findIndex((r) => rowKey(r) === openKey)
  const openRow = openIndex >= 0 ? filtered[openIndex] : null

  const genericView = (row: T): RecordView => {
    const cols = columns.filter((c) => c.csv !== false)
    const label = (c: Column<T>) => (typeof c.header === 'string' ? c.header : c.key)
    const text = (c: Column<T>) => String(cellValue(c, row) ?? '—')
    const lead = cols.find((c) => c.key !== 'id' && c.key !== 'seq') ?? cols[0]
    const title = lead ? text(lead) : rowKey(row)
    const name = String(exportName || caption || 'سجل')
    return {
      title,
      subtitle: caption,
      sections: [
        {
          key: 'data',
          title: 'البيانات',
          content: (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {cols.filter((c) => !c.printOnly).map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="t-caption">{label(c)}</dt>
                  <dd className="t-body break-words font-semibold text-fg">{c.cell ? c.cell(row) : text(c)}</dd>
                </div>
              ))}
            </dl>
          ),
        },
      ],
      onExport: () => exportCsv(`${name}-${title}`, cols.map(label), [cols.map((c) => cellValue(c, row))]),
      onPrint: () =>
        void printDocument(
          <PrintLayout settings={settings} title={String(title)} subtitle={caption}>
            <PrintFields items={cols.map((c) => [label(c), text(c)] as [string, string])} />
          </PrintLayout>,
          `${name}-${title}`,
        ),
    }
  }
  const panelView = panelOn && openRow ? ((detail ? detail(openRow) : null) ?? (detail ? null : genericView(openRow))) : null

  function openAt(i: number) {
    const row = filtered[i]
    if (!row) return
    setOpenKey(rowKey(row))
    if (!virtual && !serverPagination) setLocalPage(Math.floor(i / pageSize))
  }
  const rowClick = onRowClick && !panelOn ? onRowClick : panelOn ? (row: T) => setOpenKey(rowKey(row)) : undefined
  const virtual = !serverPagination && total > virtualThreshold
  const pageCount = serverPagination ? Math.max(1, serverPagination.pageCount) : Math.max(1, Math.ceil(total / pageSize))
  const currentPage = serverPagination ? Math.min(page, pageCount - 1) : Math.min(localPage, pageCount - 1)

  // A new search or sort starts from the top.
  useEffect(() => {
    if (!serverPagination) setLocalPage(0)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [query, sort])

  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(640)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !virtual) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setScrollTop(el.scrollTop))
    }
    const observer = new ResizeObserver(() => setViewport(el.clientHeight))
    observer.observe(el)
    setViewport(el.clientHeight)
    setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [virtual])

  let start: number
  let end: number
  if (virtual) {
    const bodyTop = Math.max(0, scrollTop - HEADER_HEIGHT)
    start = Math.min(total, Math.max(0, Math.floor(bodyTop / rowHeight) - OVERSCAN))
    end = Math.min(total, Math.ceil((bodyTop + viewport) / rowHeight) + OVERSCAN)
  } else if (serverPagination) {
    start = serverPagination.from ? serverPagination.from - 1 : 0
    end = start + filtered.length
  } else {
    start = currentPage * pageSize
    end = Math.min(total, start + pageSize)
  }
  const visible = serverPagination ? filtered : filtered.slice(start, end)
  const screenColumns = useMemo(() => columns.filter((c) => !c.printOnly), [columns])
  const columnCount = screenColumns.length + (actions ? 1 : 0)

  function toggleSort(key: string) {
    const next: SortState = sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null
    if (serverSort) serverSort.onChange(next)
    else setLocalSort(next)
  }

  function goToPage(next: number) {
    if (serverPagination) serverPagination.onChange(next)
    else setLocalPage(next)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  const tableData = () => {
    const exported = columns.filter((c) => c.csv !== false)
    const headers = exported.map((c) => c.csvHeader ?? (typeof c.header === 'string' ? c.header : c.key))
    const data = filtered.map((row) => exported.map((c) => (typeof c.csv === 'function' ? c.csv(row) : cellValue(c, row))))
    return { headers, data }
  }

  function handleExport() {
    const { headers, data } = tableData()
    const late = lateRow ? new Set(filtered.flatMap((row, i) => (lateRow(row) ? [i] : []))) : undefined
    void exportXlsx(String(exportName), headers, data, { title: caption ?? String(exportName), subtitle: `${data.length} سجل`, lateRows: late })
    onExport?.(data.length)
  }

  function handlePrint() {
    const { headers, data } = tableData()
    const name = String(caption ?? (exportName || 'سجل'))
    void printDocument(
      <PrintLayout settings={settings} title={name} subtitle={`${data.length} سجل`}>
        <PrintTable headers={['#', ...headers]} rows={data.map((r, i) => [i + 1, ...r])} />
      </PrintLayout>,
      name,
    )
  }

  return (
    <div className={cn('grid min-w-0 gap-3', className)}>
      <div className="flex flex-wrap items-center gap-3">
        {title}
        {searchable && (
          <TextInput
            aria-label="بحث في الجدول"
            role="searchbox"
            enterKeyHint="search"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={searchPlaceholder}
            leading={<IconSearch size={16} />}
            trailing={
              query ? (
                <button type="button" className="kit-field-btn" aria-label="مسح البحث" onClick={() => updateQuery('')}>
                  <IconX size={14} />
                </button>
              ) : undefined
            }
            containerClassName="min-w-[14rem] flex-1 sm:max-w-sm"
          />
        )}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {toolbar}
          {exportName !== false && (
            <>
              <Btn variant="glass" iconStart={<IconFile size={16} />} disabled={loading || total === 0} onClick={handlePrint}>
                طباعة
              </Btn>
              <Btn variant="glass" iconStart={<IconDownload size={16} />} disabled={loading || total === 0} onClick={handleExport}>
                تصدير Excel
              </Btn>
            </>
          )}
        </div>
      </div>

      <div ref={scrollRef} className={cn('kit-table-scroll', maxHeightClassName)}>
        <table
          className="kit-table"
          data-virtual={virtual || undefined}
          aria-label={caption}
          aria-busy={loading || undefined}
          aria-rowcount={virtual ? total + 1 : undefined}
        >
          <thead>
            <tr aria-rowindex={virtual ? 1 : undefined}>
              {screenColumns.map((column) => {
                const direction = sort?.key === column.key ? sort.dir : null
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
                    className={cn('t-label', alignClass[column.align ?? 'start'], column.headerClassName)}
                    style={column.width || column.minWidth ? { width: column.width, minWidth: column.minWidth } : undefined}
                  >
                    {column.sortable === false ? (
                      column.header
                    ) : (
                      <button type="button" className="kit-th-btn" onClick={() => toggleSort(column.key)}>
                        {column.header}
                        <IconArrowUp size={14} className="kit-sort-icon" />
                      </button>
                    )}
                  </th>
                )
              })}
              {actions && (
                <th scope="col" className="t-label kit-col-actions" style={virtual ? { width: actionsWidth } : undefined}>
                  {actionsHeader}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }, (_, r) => (
                <tr key={`skeleton-${r}`} className="kit-row" aria-hidden="true">
                  {Array.from({ length: columnCount }, (_, c) => (
                    <td key={c}>
                      <span
                        className="skeleton block h-3.5"
                        style={{
                          width: `${[72, 56, 64, 48, 60][(r + c) % 5]}%`,
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <>
                {virtual && start > 0 && (
                  <tr className="kit-spacer" aria-hidden="true">
                    <td colSpan={columnCount} style={{ height: start * rowHeight }} />
                  </tr>
                )}
                {visible.map((row, i) => {
                  const index = start + i
                  return (
                    <tr
                      key={rowKey(row)}
                      className={cn('kit-row t-body', rowClassName?.(row))}
                      data-stripe={index % 2 === 1 || undefined}
                      data-clickable={rowClick ? true : undefined}
                      data-active={panelOn && openKey === rowKey(row) ? true : undefined}
                      aria-rowindex={virtual ? index + 2 : undefined}
                      tabIndex={rowClick ? 0 : undefined}
                      style={virtual ? { height: rowHeight } : undefined}
                      onClick={rowClick ? () => rowClick(row) : undefined}
                      onKeyDown={
                        rowClick
                          ? (event) => {
                              if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                                event.preventDefault()
                                rowClick(row)
                              }
                            }
                          : undefined
                      }
                    >
                      {screenColumns.map((column) => (
                        <td key={column.key} className={cn(alignClass[column.align ?? 'start'], column.className)}>
                          {column.cell ? column.cell(row) : (cellValue(column, row) ?? '—')}
                        </td>
                      ))}
                      {actions && (
                        <td className="kit-col-actions" onClick={(event) => event.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5">{actions(row)}</div>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {virtual && end < total && (
                  <tr className="kit-spacer" aria-hidden="true">
                    <td colSpan={columnCount} style={{ height: (total - end) * rowHeight }} />
                  </tr>
                )}
                {total === 0 && (
                  <tr>
                    <td colSpan={columnCount} className="py-14 text-center">
                      <span className="mx-auto mb-2 grid size-11 place-items-center rounded-full bg-neutral-soft text-fg-3">
                        <IconSearch size={18} />
                      </span>
                      <Text variant="label" as="p" className="text-fg-2">
                        {query ? 'لا توجد نتائج مطابقة' : 'لا توجد بيانات'}
                      </Text>
                      {!query && emptyText !== 'لا توجد بيانات' && (
                        <Text variant="caption" as="p">
                          {emptyText}
                        </Text>
                      )}
                      {query && (
                        <Btn variant="ghost" size="sm" className="mt-1" onClick={() => updateQuery('')}>
                          مسح البحث
                        </Btn>
                      )}
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Text variant="caption" aria-live="polite">
          {loading
            ? 'جارٍ التحميل…'
            : total === 0
              ? 'لا توجد صفوف'
              : serverPagination
                ? `عرض ${serverPagination.from} إلى ${serverPagination.to} من أصل ${total.toLocaleString('en-US')}`
                : virtual
                  ? `${total.toLocaleString('en-US')} صفًا · تمرير سلس دون ترقيم`
                  : `عرض ${start + 1} إلى ${end} من أصل ${total.toLocaleString('en-US')}`}
          {!serverPagination && query && rows.length !== total && ` · مطابقة من ${rows.length.toLocaleString('en-US')}`}
        </Text>
        {!virtual && pageCount > 1 && <Pagination page={currentPage} count={pageCount} onChange={goToPage} />}
      </div>
      {panelOn && (
        <RecordPanel
          view={panelView}
          index={openIndex}
          total={total}
          onPrev={() => openAt(openIndex - 1)}
          onNext={() => openAt(openIndex + 1)}
          onClose={() => setOpenKey(null)}
        />
      )}
    </div>
  )
}
