import type { ReactNode } from 'react'
import {
  Btn,
  DataTable,
  GlassSurface,
  IconDownload,
  IconFile,
  IconRefresh,
  useToast,
  type CellValue,
  type Column,
  type DataTableProps,
} from '@/kit'
import { exportXlsx } from '@/kit/xlsx'
import { PrintFields, PrintLayout, PrintTable, printDocument } from '@/kit/print'
import { shortcutLabel, useShortcutAction } from '@/kit/shortcuts'
import { Text } from '@/components/ui'
import { useData } from '@/lib'
import { cn } from '@/lib/cn'
import { addMonths, type ISODate } from '@/lib/domain'
import { TODAY_ISO } from '@/lib/domain'

/* ==================================================================
   Layout pieces: filter bar → KPIs → chart → table → actions
   ================================================================== */

export function ReportFilterBar({ children, onReset, active }: { children: ReactNode; onReset?: () => void; active?: boolean }) {
  return (
    <GlassSurface padding="md" className="rise-in grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-end" role="search" aria-label="تصفية التقرير">
      {children}
      {onReset && (
        <div className="flex lg:justify-end">
          <Btn variant="ghost" size="sm" iconStart={<IconRefresh size={16} />} disabled={!active} onClick={onReset}>
            إعادة ضبط الفلاتر
          </Btn>
        </div>
      )}
    </GlassSurface>
  )
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}

export function ChartCard({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <GlassSurface variant="strong" padding="md" className={cn('rise-in grid gap-4', className)}>
      <div>
        <Text variant="section">{title}</Text>
        {description && <Text variant="caption">{description}</Text>}
      </div>
      {children}
    </GlassSurface>
  )
}

/**
 * Sortable, searchable 20-row table. The main table's CSV export lives in the action bar; pass
 * `exportName` to give a secondary table its own export button.
 */
export function ReportTable<T>(props: DataTableProps<T>) {
  return (
    <GlassSurface variant="strong" padding="sm" className="min-w-0">
      <DataTable pageSize={20} exportName={false} {...props} />
    </GlassSurface>
  )
}

/* ==================================================================
   CSV / actions
   ================================================================== */

function headerText(c: Column<unknown>): string {
  if (c.csvHeader) return c.csvHeader
  return typeof c.header === 'string' ? c.header : c.key
}

/** Builds CSV headers + rows from table columns (respecting `csv`, `value` and raw fields). */
export function csvOf<T>(columns: readonly Column<T>[], rows: readonly T[]): { headers: string[]; rows: CellValue[][] } {
  const cols = columns.filter((c) => c.csv !== false)
  return {
    headers: cols.map((c) => headerText(c as Column<unknown>)),
    rows: rows.map((r) =>
      cols.map((c) => {
        if (typeof c.csv === 'function') return c.csv(r)
        if (c.value) return c.value(r)
        const raw = (r as Record<string, unknown>)[c.key]
        return typeof raw === 'string' || typeof raw === 'number' ? raw : ''
      }),
    ),
  }
}

export type ReportActionsProps<T> = {
  title: string
  fileName: string
  columns: readonly Column<T>[]
  rows: readonly T[]
  /** One-line summary used when sharing. */
  shareText: string
  /** Label/value pairs printed above the table (e.g. the client of a statement). */
  details?: readonly (readonly [string, string])[]
  /** Rows matching this are highlighted red (late payers) in the Excel export. */
  lateRow?: (row: T) => boolean
}

export function ReportActions<T>({ title, fileName, columns, rows, shareText, details, lateRow }: ReportActionsProps<T>) {
  const toast = useToast()
  const { settings } = useData()
  const exportIt = () => {
    if (!rows.length) return toast.info('لا توجد بيانات للتصدير')
    const csv = csvOf(columns, rows)
    void exportXlsx(`${fileName}-${TODAY_ISO}`, csv.headers, csv.rows, {
      title,
      subtitle: shareText,
      lateRows: lateRow ? new Set(rows.flatMap((r, i) => (lateRow(r) ? [i] : []))) : undefined,
    })
    toast.success('تم تصدير الملف', `${rows.length} صف — ${title}`)
  }
  const print = () => {
    const csv = csvOf(columns, rows)
    void printDocument(
      <PrintLayout settings={settings} title={title} subtitle={shareText}>
        {details && details.length > 0 && <PrintFields items={details} />}
        <PrintTable headers={csv.headers} rows={csv.rows} empty="لا توجد بيانات مطابقة للتصفية الحالية." />
      </PrintLayout>,
      `${fileName}-${TODAY_ISO}`,
    )
  }
  useShortcutAction('print', print)
  useShortcutAction('primary', exportIt)
  const share = async () => {
    const text = `${title}\n${shareText}`
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url: location.href })
        return
      }
      await navigator.clipboard.writeText(`${text}\n${location.href}`)
      toast.success('تم نسخ ملخص التقرير', 'يمكنك لصقه في أي محادثة أو بريد.')
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast.error('تعذّرت المشاركة', 'المتصفح لا يسمح بالمشاركة أو النسخ هنا.')
    }
  }
  return (
    <GlassSurface padding="sm" className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Text variant="caption" className="px-2">
        {rows.length} سجل · محدث حتى {TODAY_ISO.split('-').reverse().join('/')}
      </Text>
      <div className="flex flex-wrap gap-2" role="group" aria-label="إجراءات التقرير">
        <Btn
          variant="glass"
          iconStart={<IconFile size={16} />}
          onClick={print}
          aria-keyshortcuts="Control+P Meta+P"
          title={`طباعة (${shortcutLabel('P')})`}
        >
          طباعة
          <kbd
            dir="ltr"
            className="hidden rounded bg-neutral-soft px-1 py-0.5 font-sans text-[10.5px] font-bold leading-none text-fg-3 xl:inline"
          >
            {shortcutLabel('P')}
          </kbd>
        </Btn>
        <Btn variant="glass" iconStart={<IconDownload size={16} />} onClick={exportIt}>
          تصدير Excel (CSV)
        </Btn>
        <Btn variant="primary" iconStart={<ShareIcon />} onClick={share}>
          مشاركة
        </Btn>
      </div>
    </GlassSurface>
  )
}

function ShareIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  )
}

/* ==================================================================
   Dates
   ================================================================== */

export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

/** `2025-06` keys for the `count` months ending with the month of `end` (oldest first). */
export function lastMonths(count: number, end: ISODate = TODAY_ISO): string[] {
  const first = `${end.slice(0, 7)}-01`
  return Array.from({ length: count }, (_, i) => addMonths(first, i - count + 1).slice(0, 7))
}

/** `2025-06` → `يونيو 2025`; `short` drops the year. */
export function monthLabel(key: string, short = false): string {
  const [y, m] = key.split('-').map(Number)
  return short ? MONTHS_AR[m - 1] : `${MONTHS_AR[m - 1]} ${y}`
}

export const inRange = (d: ISODate, from: ISODate | null, to: ISODate | null) => (!from || d >= from) && (!to || d <= to)
