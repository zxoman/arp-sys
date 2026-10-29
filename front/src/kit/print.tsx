/**
 * Shared print layout for every printable document (contracts, receipts, reports, statements).
 *
 *   PrintLayout   A4 · RTL sheet: header (company logo right · name/address/phone centred · our
 *                 logo left), title + print date, content, footer (our logo + page number).
 *                 The header/footer repeat on every printed page.
 *   printDocument Renders a document into an off-screen #print-root, waits for logos to decode,
 *                 prints, and cleans up. While printing, everything else on the page is hidden.
 *   PrintTable / PrintFields / PrintSection / PrintAmount / PrintSignatures — document blocks.
 */
import { type ReactElement, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import QRCode from 'qrcode'
import { fmtDate, type Settings } from '@/lib'
import './print.css'

export type PrintBrand = Pick<
  Settings,
  | 'projectName'
  | 'companyName'
  | 'companyAddress'
  | 'companyPhone'
  | 'companyLogo'
  | 'ourLogo'
  | 'showCompanyLogo'
  | 'showOurLogo'
  | 'developerUrl'
>

const companyLogoOf = (s: PrintBrand) => (s.showCompanyLogo && s.companyLogo ? s.companyLogo : '')
const ourLogoOf = (s: PrintBrand) => (s.showOurLogo && s.ourLogo ? s.ourLogo : '')

const DEFAULT_QR_URL = 'https://example.com'

/** Inline SVG QR (no network, prints crisply). */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  let d = ''
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`
  return (
    <svg className={className} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label="رمز QR لصفحة الشركة المطورة" shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#111827" />
    </svg>
  )
}

/** Short strings holding digits (amounts, dates, counts) that must stay on one line. */
const isNumeric = (text: string) => text.length <= 24 && /\d/.test(text) && !/[\u0600-\u06FF]{4,}/.test(text.replace(/ج\.م/g, ''))

const printStamp = (d: Date) => `${fmtDate(d)} — ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`

/* ==================================================================
   Header / layout
   ================================================================== */

export function PrintHeader({ settings }: { settings: PrintBrand }) {
  const company = companyLogoOf(settings)
  const ours = ourLogoOf(settings)
  return (
    <div className="pl-head">
      <div className="pl-head-logo pl-head-logo-start">
        {company && <img src={company} alt={`شعار ${settings.companyName || 'الشركة'}`} />}
      </div>
      <div className="pl-head-text">
        <strong className="pl-head-name">{settings.companyName || 'اسم الشركة'}</strong>
        {settings.projectName && <span>المشروع: {settings.projectName}</span>}
        {settings.companyAddress && <span>{settings.companyAddress}</span>}
        {settings.companyPhone && (
          <span>
            هاتف: <bdi dir="ltr">{settings.companyPhone}</bdi>
          </span>
        )}
      </div>
      <div className="pl-head-logo pl-head-logo-end">{ours && <img src={ours} alt="شعار المشروع" />}</div>
    </div>
  )
}

export type PrintLayoutProps = {
  settings: PrintBrand
  title: string
  /** Line under the title, e.g. a document number or the filtered period. */
  subtitle?: ReactNode
  printedAt?: Date
  children?: ReactNode
  /** Render as an on-screen A4 preview (sheet chrome only; no effect on print). */
  preview?: boolean
  className?: string
}

export function PrintLayout({ settings, title, subtitle, printedAt = new Date(), children, preview, className }: PrintLayoutProps) {
  const ours = ourLogoOf(settings)
  return (
    <div className={['pl-doc', preview && 'pl-preview', className].filter(Boolean).join(' ')} dir="rtl" lang="ar">
      {/* The table frame repeats thead/tfoot on every printed page. */}
      <table className="pl-frame" role="presentation">
        <thead>
          <tr>
            <td>
              <PrintHeader settings={settings} />
            </td>
          </tr>
        </thead>
        <tfoot>
          <tr>
            <td>
              <div className="pl-foot">
                <span className="pl-foot-text">
                  {[settings.companyName, settings.projectName].filter(Boolean).join(' · ')} · طُبع في{' '}
                  <bdi dir="ltr">{printStamp(printedAt)}</bdi>
                  <span className="pl-page">صفحة 1</span>
                </span>
                <span className="pl-foot-brand">
                  <QrCode value={settings.developerUrl?.trim() || DEFAULT_QR_URL} className="pl-foot-qr" />
                  {ours && <img src={ours} alt="شعار المشروع" className="pl-foot-logo" />}
                </span>
              </div>
            </td>
          </tr>
        </tfoot>
        <tbody>
          <tr>
            <td>
              <div className="pl-title">
                <h1>{title}</h1>
                {subtitle && <p className="pl-subtitle">{subtitle}</p>}
                <p className="pl-date">
                  تاريخ الطباعة: <bdi dir="ltr">{printStamp(printedAt)}</bdi>
                </p>
              </div>
              <div className="pl-body">{children}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/* ==================================================================
   Building blocks
   ================================================================== */

export type PrintCell = string | number | null | undefined

export function PrintTable({
  headers,
  rows,
  empty = 'لا توجد بيانات.',
}: {
  headers: readonly string[]
  rows: readonly (readonly PrintCell[])[]
  empty?: string
}) {
  if (!rows.length) return <p className="pl-empty">{empty}</p>
  return (
    <table className={headers.length > 8 ? 'pl-table pl-table-dense' : 'pl-table'}>
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => {
              const text =
                cell == null || cell === ''
                  ? '—'
                  : typeof cell === 'number'
                    ? cell.toLocaleString('en-US')
                    : /^\d{4}-\d{2}-\d{2}$/.test(cell)
                      ? fmtDate(cell)
                      : cell
              return (
                <td key={c} className={isNumeric(text) ? 'pl-num' : undefined}>
                  {text}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PrintSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pl-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

type FieldItem = readonly [string, ReactNode]

/** Two-column label/value grid. Falsy entries are skipped. */
export function PrintFields({ items }: { items: readonly (FieldItem | false | null | undefined)[] }) {
  return (
    <dl className="pl-fields">
      {items
        .filter((x): x is FieldItem => Boolean(x))
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v === '' || v == null ? '—' : v}</dd>
          </div>
        ))}
    </dl>
  )
}

export function PrintAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="pl-amount">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function PrintSignatures({ labels }: { labels: readonly string[] }) {
  return (
    <div className="pl-signs">
      {labels.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  )
}

/* ==================================================================
   Printing
   ================================================================== */

let cleanupActive: (() => void) | null = null

/** Prints `content` (normally a <PrintLayout>) in place. `title` becomes the suggested PDF name. */
export async function printDocument(content: ReactElement, title?: string): Promise<void> {
  cleanupActive?.()
  const host = document.createElement('div')
  host.id = 'print-root'
  document.body.appendChild(host)
  const root = createRoot(host)
  flushSync(() => root.render(content))

  // Wide tables are unreadable in portrait: switch the page to landscape for this print only.
  const wide = Array.from(host.querySelectorAll('table.pl-table')).some((t) => (t as HTMLTableElement).rows[0]?.cells.length > 7)
  let pageStyle: HTMLStyleElement | null = null
  if (wide) {
    pageStyle = document.createElement('style')
    pageStyle.textContent = '@page { size: A4 landscape; }'
    document.head.appendChild(pageStyle)
  }

  const html = document.documentElement
  const previousTitle = document.title
  const printMedia = window.matchMedia('print')
  let done = false
  const onMedia = (event: MediaQueryListEvent) => {
    if (!event.matches) cleanup()
  }
  function cleanup() {
    if (done) return
    done = true
    cleanupActive = null
    window.removeEventListener('afterprint', cleanup)
    printMedia.removeEventListener('change', onMedia)
    html.classList.remove('is-printing')
    if (title) document.title = previousTitle
    root.unmount()
    host.remove()
    pageStyle?.remove()
  }
  cleanupActive = cleanup

  // Logos are data URLs; decoding first guarantees they render on the printed page.
  await Promise.all(Array.from(host.getElementsByTagName('img'), (img) => img.decode().catch(() => undefined)))
  if (done) return

  html.classList.add('is-printing')
  if (title) document.title = title
  window.addEventListener('afterprint', cleanup)
  printMedia.addEventListener('change', onMedia)
  window.print()
}
