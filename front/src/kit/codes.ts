import { serialOf, SERIAL_LABEL, type DocKind } from '@/lib/codes'
import type { Column } from './table'

/**
 * Serial-number column («رقم العقود» …) that appears only in print and export, so printed papers
 * can be put in order. `source` returns the identifier whose numeric part is the serial.
 */
export function serialColumn<T>(kind: DocKind, source: (row: T) => string): Column<T> {
  return {
    key: `serial-${kind}`,
    header: SERIAL_LABEL[kind],
    printOnly: true,
    sortable: false,
    searchable: false,
    align: 'center',
    value: (row) => serialOf(source(row)),
  }
}
