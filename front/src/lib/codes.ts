/**
 * Document codes and serial numbers for printed papers.
 *
 *   كود …   the record's identifier (client CL-048, contract S-2025-061, receipt R-2025-00412 ...).
 *   رقم …   a running serial number (the numeric part of the record's sequence) used only to put
 *           printed papers in order.
 */
export type DocKind = 'client' | 'reservation' | 'contract' | 'receipt' | 'return'

export const CODE_LABEL: Record<DocKind, string> = {
  client: 'كود العملاء',
  reservation: 'كود الحجوزات',
  contract: 'كود العقود',
  receipt: 'كود إيصالات القبض',
  return: 'كود المرتجعات',
}

export const SERIAL_LABEL: Record<DocKind, string> = {
  client: 'رقم العملاء',
  reservation: 'رقم الحجوزات',
  contract: 'رقم العقود',
  receipt: 'رقم إيصالات القبض',
  return: 'رقم المرتجعات',
}

/** `cl-048` → 48, `R-2025-00412` → 412; 0 when there are no digits. */
export function serialOf(identifier: string | null | undefined): number {
  const match = /(\d+)\D*$/.exec(identifier ?? '')
  return match ? Number(match[1]) : 0
}

/** `printFields('contract', 'S-2025-061', 'c-061')` → the two label/value pairs shown on a printed paper. */
export function codeFields(kind: DocKind, code: string, serialSource: string = code): [string, string][] {
  return [
    [CODE_LABEL[kind], code],
    [SERIAL_LABEL[kind], String(serialOf(serialSource))],
  ]
}

/** One-line header for a printed paper: `كود العقود: S-2025-061 · رقم العقود: 61`. */
export const codeLine = (kind: DocKind, code: string, serialSource: string = code) =>
  `${CODE_LABEL[kind]}: ${code} · ${SERIAL_LABEL[kind]}: ${serialOf(serialSource)}`
