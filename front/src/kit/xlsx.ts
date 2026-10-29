/** Styled Excel export: title band, numbered rows, distinct header, frozen header, auto widths, late-row highlight. */
import type { CellValue } from './table'

export type XlsxOptions = {
  title?: string
  subtitle?: string
  sheetName?: string
  /** Row indexes (0-based, in `rows`) rendered with a red background and border. */
  lateRows?: ReadonlySet<number>
}

const NAVY = 'FF1F3A5F'
const GRID = 'FFCBD5E1'
const ZEBRA = 'FFF8FAFC'
const LATE_BG = 'FFFEE2E2'
const LATE_FG = 'FF991B1B'
const LATE_BORDER = 'FFDC2626'
const FONT = 'Cairo'

export async function exportXlsx(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly CellValue[])[],
  { title, subtitle, sheetName = 'البيانات', lateRows }: XlsxOptions = {},
): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 0, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const cols = headers.length + 1
  const thin = { style: 'thin' as const, color: { argb: GRID } }
  let r = 1

  if (title) {
    ws.mergeCells(r, 1, r, cols)
    const c = ws.getCell(r, 1)
    c.value = title
    c.font = { name: FONT, size: 18, bold: true, color: { argb: NAVY } }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getRow(r).height = 34
    r++
    if (subtitle) {
      ws.mergeCells(r, 1, r, cols)
      const s = ws.getCell(r, 1)
      s.value = subtitle
      s.font = { name: FONT, size: 12, color: { argb: 'FF475569' } }
      s.alignment = { horizontal: 'center', vertical: 'middle' }
      ws.getRow(r).height = 22
      r++
    }
    r++
  }

  const headRow = r
  ;['#', ...headers].forEach((h, i) => {
    const c = ws.getCell(r, i + 1)
    c.value = h
    c.font = { name: FONT, size: 13, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    c.border = { top: thin, bottom: { style: 'medium', color: { argb: NAVY } }, left: thin, right: thin }
  })
  ws.getRow(r).height = 30
  r++

  const widths = ['#', ...headers].map((h) => String(h).length)
  rows.forEach((row, ri) => {
    const late = lateRows?.has(ri)
    const red = { style: 'medium' as const, color: { argb: LATE_BORDER } }
    ;[ri + 1 as CellValue, ...row].forEach((v, i) => {
      const c = ws.getCell(r, i + 1)
      const isNum = typeof v === 'number'
      c.value = v == null ? '' : v
      c.font = { name: FONT, size: 12, bold: late || i === 0, color: { argb: late ? LATE_FG : 'FF111827' } }
      c.alignment = { horizontal: i === 0 || isNum ? 'center' : 'right', vertical: 'middle', wrapText: true }
      if (isNum && i > 0) c.numFmt = Number.isInteger(v) ? '#,##0' : '#,##0.00'
      const fill = late ? LATE_BG : ri % 2 ? ZEBRA : null
      if (fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      c.border = late
        ? { top: red, bottom: red, left: i === cols - 1 ? red : thin, right: i === 0 ? red : thin }
        : { top: thin, bottom: thin, left: thin, right: thin }
      widths[i] = Math.max(widths[i] ?? 0, String(v ?? '').length)
    })
    ws.getRow(r).height = 24
    r++
  })

  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = i === 0 ? 7 : Math.min(42, Math.max(14, Math.ceil(w * 1.35) + 4))
  })
  ws.views = [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: headRow, showGridLines: false }]
  ws.autoFilter = { from: { row: headRow, column: 1 }, to: { row: headRow, column: cols } }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
