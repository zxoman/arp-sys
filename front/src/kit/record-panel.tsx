import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { Btn, IconBtn } from './core'
import { IconChevronDown, IconChevronNext, IconChevronPrev, IconDownload, IconFile, IconPencil, IconX } from './icons'

/** Everything the side panel renders for one record; each entity type builds its own. */
export type RecordView = {
  title: ReactNode
  subtitle?: ReactNode
  /** Status badge next to the title. */
  status?: ReactNode
  sections: RecordSection[]
  onEdit?: () => void
  /** Label of the primary action; defaults to «تعديل». */
  editLabel?: string
  onPrint?: () => void
  /** Label of the print button; defaults to «طباعة». */
  printLabel?: string
  /** Extra buttons shown after print/export. */
  extraActions?: { label: string; title?: string; onClick: () => void }[]
  onExport?: () => void
}

export type RecordSection = {
  key: string
  title: string
  icon?: ReactNode
  /** Shown as a small counter in the section header. */
  count?: number
  /** Sections start expanded unless this is `false`. */
  defaultOpen?: boolean
  content: ReactNode
}

export type RecordPanelProps = {
  view: RecordView | null
  /** 0-based position among the table's current rows, and their count. */
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}

/**
 * Non-modal side panel (inline-end edge, left in RTL). The table behind it stays visible and
 * interactive, so picking another row swaps the content; ‹ › step through the table's rows.
 */
export function RecordPanel({ view, index, total, onPrev, onNext, onClose }: RecordPanelProps) {
  const [shown, setShown] = useState(view)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (view) {
      setShown(view)
      setClosing(false)
      return
    }
    setClosing(true)
    const t = window.setTimeout(() => setShown(null), 200)
    return () => window.clearTimeout(t)
  }, [view])

  useEffect(() => {
    if (!view) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape' && !document.querySelector('.kit-layer')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, onClose])

  if (!shown) return null

  return createPortal(
    <aside className="kit-record-panel print:hidden" data-closing={closing || undefined} role="complementary" aria-label="تفاصيل السجل">
      <header className="grid gap-3 border-b border-hairline p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="t-section min-w-0 break-words">{shown.title}</h2>
              {shown.status}
            </div>
            {shown.subtitle && <p className="t-caption mt-0.5">{shown.subtitle}</p>}
          </div>
          <IconBtn size="sm" icon={<IconX size={18} />} label="إغلاق" onClick={onClose} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shown.onEdit && (
            <Btn size="sm" iconStart={<IconPencil size={15} />} onClick={shown.onEdit}>
              {shown.editLabel ?? 'تعديل'}
            </Btn>
          )}
          {shown.onPrint && (
            <Btn size="sm" variant="glass" iconStart={<IconFile size={15} />} onClick={shown.onPrint}>
              {shown.printLabel ?? 'طباعة'}
            </Btn>
          )}
          {shown.extraActions?.map((a) => (
            <Btn key={a.label} size="sm" variant="glass" iconStart={<IconFile size={15} />} title={a.title} onClick={a.onClick}>
              {a.label}
            </Btn>
          ))}
          {shown.onExport && (
            <Btn size="sm" variant="glass" iconStart={<IconDownload size={15} />} onClick={shown.onExport}>
              تصدير
            </Btn>
          )}
          <div className="ms-auto flex items-center gap-1" role="group" aria-label="التنقل بين السجلات">
            <IconBtn size="sm" variant="glass" icon={<IconChevronPrev size={16} />} label="السجل السابق" disabled={index <= 0} onClick={onPrev} />
            <span className="t-caption min-w-12 text-center tabular-nums">
              {total ? index + 1 : 0} / {total}
            </span>
            <IconBtn size="sm" variant="glass" icon={<IconChevronNext size={16} />} label="السجل التالي" disabled={index >= total - 1} onClick={onNext} />
          </div>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4">
        {shown.sections.map((s) => (
          <details key={`${s.key}`} className="kit-record-sec glass rounded-card" open={s.defaultOpen !== false}>
            <summary className="flex items-center gap-2 px-4 py-3">
              {s.icon && <span className="text-fg-3">{s.icon}</span>}
              <span className="t-label flex-1 font-bold">{s.title}</span>
              {s.count != null && <span className="t-caption rounded-full bg-neutral-soft px-2 py-0.5 tabular-nums">{s.count}</span>}
              <IconChevronDown size={16} className="kit-record-chev text-fg-3 transition-transform" />
            </summary>
            <div className="px-4 pb-4">{s.content}</div>
          </details>
        ))}
      </div>
    </aside>,
    document.body,
  )
}

/* ---------- section building blocks ---------- */

export function FieldGrid({ items, className }: { items: readonly (readonly [string, ReactNode])[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-3', className)}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="t-caption">{label}</dt>
          <dd className="t-body break-words font-semibold text-fg">{value === '' || value == null ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function MiniTable({ headers, rows, empty = 'لا توجد سجلات.' }: { headers: readonly string[]; rows: readonly (readonly ReactNode[])[]; empty?: string }) {
  if (!rows.length) return <p className="t-caption py-1">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="kit-record-mini">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
