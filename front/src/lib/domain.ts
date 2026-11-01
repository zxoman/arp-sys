// Pure, dependency-free helpers shared by the reducer (src/lib.ts) and the screens.
import type { Collection, Contract, ContractType, InstallmentStatus, Payment, RentalTerms } from '../lib'

/** Calendar date as `YYYY-MM-DD` — no time or time zone, safe to persist as JSON. */
export type ISODate = string

const DAY_MS = 86_400_000

export const pad = (n: number, width = 2) => String(n).padStart(width, '0')

function parts(value: ISODate): [number, number, number] {
  const [y, m, d] = value.split('-').map(Number)
  return [y, m, d]
}

const utc = (value: ISODate) => {
  const [y, m, d] = parts(value)
  return Date.UTC(y, m - 1, d)
}

const fromUTC = (ms: number): ISODate => {
  const d = new Date(ms)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function toISO(date: Date): ISODate {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Parses an ISO date as local midnight. */
export function parseISO(value: ISODate): Date {
  const [y, m, d] = parts(value)
  return new Date(y, m - 1, d)
}

export function addDays(value: ISODate, days: number): ISODate {
  return fromUTC(utc(value) + days * DAY_MS)
}

/** Adds calendar months, clamping to the last day of the target month. */
export function addMonths(value: ISODate, months: number): ISODate {
  const [y, m, d] = parts(value)
  const total = y * 12 + (m - 1) + months
  const year = Math.floor(total / 12)
  const month = total - year * 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(Math.min(d, lastDay))}`
}

/** Whole days from `b` to `a` (positive when `a` is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((utc(a) - utc(b)) / DAY_MS)
}

export const roundTo = (value: number, step: number) => Math.round(value / step) * step

// ---------------------------------------------------------------- Installments

/** Status of an installment from its amount, what has been paid, and its due date relative to `today`. */
export function installmentStatus(
  amount: number,
  paidAmount: number,
  dueDate: ISODate,
  today: ISODate,
): InstallmentStatus {
  if (paidAmount >= amount) return 'مدفوع'
  if (paidAmount > 0) return 'جزئي'
  return dueDate < today ? 'متأخر' : 'معلق'
}

// ---------------------------------------------------------------- IDs & reference numbers

export const ID_FORMAT: Record<Collection, readonly [prefix: string, width: number]> = {
  buildings: ['b', 2],
  units: ['u', 3],
  clients: ['cl', 3],
  contracts: ['c', 3],
  installments: ['i', 5],
  payments: ['p', 5],
  maintenance: ['m', 3],
  reservations: ['r', 3],
  ownerUnions: ['ou', 2],
}

export function formatId(collection: Collection, n: number): string {
  const [prefix, width] = ID_FORMAT[collection]
  return `${prefix}-${pad(n, width)}`
}

function maxSuffix(values: Iterable<string | null>, prefix: string): number {
  let max = 0
  for (const value of values) {
    if (!value?.startsWith(prefix)) continue
    const n = Number(value.slice(value.lastIndexOf('-') + 1))
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/** Highest numeric suffix used in a collection, e.g. 48 for `cl-048`. */
export function lastIdNumber(collection: Collection, items: ReadonlyArray<{ id: string }>): number {
  return maxSuffix(
    items.map((item) => item.id),
    `${ID_FORMAT[collection][0]}-`,
  )
}

/** Next free id for a collection, e.g. `newId('units', units)` → `u-081`. */
export function newId(collection: Collection, items: ReadonlyArray<{ id: string }>): string {
  return formatId(collection, lastIdNumber(collection, items) + 1)
}

/** Number prefix per contract type: `S-2025-061` for sales, `L-2025-014` for leases. */
export const CONTRACT_PREFIX: Record<ContractType, string> = { بيع: 'S', إيجار: 'L' }

/** Next contract number for `type`; each prefix has its own global sequence, the year is the signing year. */
export function nextContractNumber(
  contracts: ReadonlyArray<Pick<Contract, 'number'>>,
  type: ContractType,
  date: ISODate,
) {
  const prefix = CONTRACT_PREFIX[type]
  const seq = maxSuffix(
    contracts.map((c) => c.number),
    `${prefix}-`,
  )
  return `${prefix}-${date.slice(0, 4)}-${pad(seq + 1, 3)}`
}

/** Receipt numbers look like `R-2025-00412`; the sequence is global, the year is the payment year. */
export function nextReceiptNumber(payments: ReadonlyArray<Pick<Payment, 'receiptNumber'>>, paidDate: ISODate) {
  const seq = maxSuffix(
    payments.map((p) => p.receiptNumber),
    'R-',
  )
  return `R-${paidDate.slice(0, 4)}-${pad(seq + 1, 5)}`
}

// ---------------------------------------------------------------- Leases

/** Last day of a lease of `months` starting on `start`. */
export function leaseEndDate(start: ISODate, months: number): ISODate {
  return addDays(addMonths(start, months), -1)
}

/** Rent for a 1-based contract `year`: increases compound yearly from `increaseFromYear`, rounded to 50. */
export function rentForYear(
  terms: Pick<RentalTerms, 'monthlyRent' | 'annualIncreasePct' | 'increaseFromYear'>,
  year: number,
): number {
  const steps = terms.annualIncreasePct > 0 ? Math.max(0, year - Math.max(1, terms.increaseFromYear) + 1) : 0
  if (steps === 0) return terms.monthlyRent
  return roundTo(terms.monthlyRent * (1 + terms.annualIncreasePct / 100) ** steps, 50)
}

/**
 * Monthly rent rows of a lease: one per month from `startDate`. The first `advanceMonths` rows are
 * due on the signing date (`signDate`).
 */
export function rentSchedule(
  terms: Pick<
    RentalTerms,
    'monthlyRent' | 'durationMonths' | 'startDate' | 'advanceMonths' | 'annualIncreasePct' | 'increaseFromYear'
  >,
  signDate: ISODate,
): { dueDate: ISODate; amount: number }[] {
  const months = Math.max(0, Math.floor(terms.durationMonths))
  return Array.from({ length: months }, (_, i) => ({
    dueDate: i < terms.advanceMonths ? signDate : addMonths(terms.startDate, i),
    amount: rentForYear(terms, Math.floor(i / 12) + 1),
  }))
}

/**
 * The app's "today". Due/late calculations use the real date: there is no seeded date any more,
 * so nothing may depend on a fixed one.
 */
export const TODAY = new Date()
export const TODAY_ISO: ISODate = toISO(TODAY)
