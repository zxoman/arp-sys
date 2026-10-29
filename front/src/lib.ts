import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react'
import { createSeedData, TODAY_ISO } from './data'
import {
  installmentStatus,
  lastIdNumber,
  formatId,
  nextReceiptNumber,
  pad,
  parseISO,
  type ISODate,
} from './lib/domain'
import { applyTheme, getTheme } from './lib/theme'

export type { ISODate } from './lib/domain'
export { installmentStatus, newId } from './lib/domain'

/* ==================================================================
   Types
   ================================================================== */

export type BuildingType = 'سكني' | 'تجاري' | 'إداري' | 'مخزني' | 'طبي' | 'فندقي'
export const BUILDING_TYPES: readonly BuildingType[] = ['سكني', 'تجاري', 'إداري', 'مخزني', 'طبي', 'فندقي']
export type BuildingStatus = 'نشط' | 'موقوف'

/**
 * نوع المبنى — the API's `type` enum (`building | tower | house | office_building`). Only the
 * server-driven buildings page uses it; the seed-only screens use `types` below.
 */
export type BuildingKind = 'عمارة' | 'برج' | 'بيت' | 'مبنى مكاتب'
export const BUILDING_KINDS: readonly BuildingKind[] = ['عمارة', 'برج', 'بيت', 'مبنى مكاتب']

/** نشاط المبنى — the API's `activities` enum (`residential | administrative | commercial | medical | hotel`). */
export type BuildingActivity = 'سكني' | 'إداري' | 'تجاري' | 'طبي' | 'فندقي'
export const BUILDING_ACTIVITIES: readonly BuildingActivity[] = ['سكني', 'إداري', 'تجاري', 'طبي', 'فندقي']

/** An owner client's (type مالك) share of a building. */
export interface OwnerShare {
  clientId: string
  /** Percent, 0–100; a building's shares add up to at most 100. */
  share: number
}

export interface Building {
  id: string
  name: string
  address: string
  district: string
  city: string
  totalFloors: number
  totalUnits: number
  /** One or more; at least one. */
  types: BuildingType[]
  ownerShares: OwnerShare[]
  status: BuildingStatus

  /* Fields of the server-driven buildings page; absent on seed-only rows. */
  /** Server-side id once the building exists in the API. */
  apiId?: number
  /** API `type`. */
  kind?: BuildingKind
  /** API `activities`. */
  activities?: BuildingActivity[]
  /** The API records whether the building has a basement floor. */
  hasBasement?: boolean
  /** Registered units, as counted by the API. */
  unitsCount?: number
}

export type UnitType = 'شقة' | 'محل' | 'مكتب' | 'مستودع' | 'استوديو' | 'ميزانين' | 'روف' | 'بدروم'
export const UNIT_TYPES: readonly UnitType[] = ['شقة', 'استوديو', 'روف', 'محل', 'مكتب', 'ميزانين', 'مستودع', 'بدروم']

export type UnitStatus = 'متاحة' | 'محجوزة' | 'مباعة' | 'مؤجرة' | 'مرتجعة' | 'غير قابلة للبيع'
export const UNIT_STATUSES: readonly UnitStatus[] = ['متاحة', 'محجوزة', 'مباعة', 'مؤجرة', 'مرتجعة', 'غير قابلة للبيع']

export type UnitPurpose = 'بيع' | 'إيجار' | 'بيع وإيجار'
export const UNIT_PURPOSES: readonly UnitPurpose[] = ['بيع', 'إيجار', 'بيع وإيجار']
export const offersSale = (purpose: UnitPurpose) => purpose !== 'إيجار'
export const offersRent = (purpose: UnitPurpose) => purpose !== 'بيع'

/** Units a new reservation or contract can be made on. */
export const isOpenUnit = (u: Pick<Unit, 'status'>) => u.status === 'متاحة' || u.status === 'مرتجعة'

export interface Unit {
  id: string
  buildingId: string
  number: string
  floor: number
  type: UnitType
  /** m² */
  area: number
  rooms: number
  bathrooms: number
  purpose: UnitPurpose
  /** Sale price per m², EGP; 0 when the unit is rent-only. */
  pricePerMeter: number
  /** Sale price, EGP: `area × pricePerMeter` unless `priceManual`; 0 when rent-only. */
  price: number
  /** The sale price was typed in instead of derived from the area. */
  priceManual: boolean
  /** Asking rent per month, EGP; 0 when sale-only. */
  monthlyRent: number
  status: UnitStatus
  /** Why the unit can't be sold or rented; empty string unless status is غير قابلة للبيع. */
  nonSellableReason: string
  description: string
}

export type ClientType = 'مشتري' | 'مستأجر' | 'مالك'
export const CLIENT_TYPES: readonly ClientType[] = ['مشتري', 'مستأجر', 'مالك']

export interface Client {
  id: string
  fullName: string
  type: ClientType
  /** `01x-xxxxxxxx`; empty string when unknown. */
  phone: string
  /** Empty string when none. */
  phone2: string
  /** 14 digits, starts with 2 or 3; empty string when unknown. */
  nationalId: string
  address: string
  notes: string
}

export type ContractType = 'بيع' | 'إيجار'
export type ContractStatus = 'مسودة' | 'نشط' | 'مكتمل' | 'منتهي' | 'مجدد' | 'مرتجع' | 'ملغي'

interface ContractBase {
  id: string
  /** `S-2025-061` for sales, `L-2025-014` for leases. */
  number: string
  /** The converted (محوّل لعقد) reservation the contract came from; client and unit are copied from it. */
  reservationId: string
  unitId: string
  clientId: string
  /** Signing date. */
  date: ISODate
  status: ContractStatus
  notes: string
}

export interface SaleTerms {
  /** Agreed sale price after any discount, EGP; the base of every schedule and balance. */
  unitPrice: number
  /** Company discount already taken off the price (`unitPrice` is the net), EGP; absent or 0 for none. */
  discount?: number
  /** Why the discount was given (large or cash payment, family tie ...). */
  discountReason?: string
  downPayment: number
}

export interface RentalTerms {
  /** Rent of the first year, EGP. */
  monthlyRent: number
  durationMonths: number
  startDate: ISODate
  /** Last day of the term. */
  endDate: ISODate
  /** Refundable insurance (تأمين), collected at signing. */
  securityDeposit: number
  /** Months of rent due at signing. */
  advanceMonths: number
  /** Yearly rent increase in percent; 0 for none. */
  annualIncreasePct: number
  /** Contract year (1-based) the first increase applies to, usually 2. */
  increaseFromYear: number
}

export type Contract = (ContractBase & { type: 'بيع' } & SaleTerms) | (ContractBase & { type: 'إيجار' } & RentalTerms)
export type SaleContractTerms = Extract<Contract, { type: 'بيع' }>
export type RentalContractTerms = Extract<Contract, { type: 'إيجار' }>

export type InstallmentStatus = 'مدفوع' | 'جزئي' | 'معلق' | 'متأخر'

/**
 * One row of a contract's schedule: a sale installment, or one month's rent for a lease. Each row
 * has its own date and amount.
 */
export interface Installment {
  id: string
  contractId: string
  /** 1-based position in the contract's schedule. */
  seq: number
  dueDate: ISODate
  amount: number
  paidAmount: number
  /** Always `amount - paidAmount`. */
  remaining: number
  status: InstallmentStatus
}

export type PaymentMethod = 'نقدي' | 'تحويل بنكي' | 'شيك' | 'فودافون كاش' | 'إنستاباي'

/** A receipt. */
export interface Payment {
  id: string
  contractId: string
  /** null = the contract's upfront amount: the down payment of a sale, the security deposit of a lease. */
  installmentId: string | null
  date: ISODate
  amount: number
  method: PaymentMethod
  /** e.g. `R-2025-00412` */
  receiptNumber: string
  notes: string
}

export type MaintenanceType = 'سباكة' | 'كهرباء' | 'تكييف' | 'دهانات' | 'نجارة' | 'مصاعد' | 'عام'
export type MaintenanceStatus = 'جديد' | 'جاري' | 'منتهي'

export interface Maintenance {
  id: string
  /** null for building-wide work (elevators, roof, tanks). */
  unitId: string | null
  buildingId: string
  type: MaintenanceType
  description: string
  requestDate: ISODate
  /** Empty string while unassigned. */
  assignedTo: string
  estimatedCost: number
  actualCost: number | null
  status: MaintenanceStatus
  completionDate: ISODate | null
}

export type ReservationStatus = 'نشط' | 'منتهي' | 'ملغي' | 'محوّل لعقد'
export const RESERVATION_CONVERTED: ReservationStatus = 'محوّل لعقد'

export interface Reservation {
  id: string
  /** Always an existing client. */
  clientId: string
  unitId: string
  purpose: ContractType
  date: ISODate
  /** Empty string when the reservation has no expiry date. */
  expiryDate: ISODate | ''
  /** Deposit (عربون) paid on reserving, EGP. */
  deposit: number
  status: ReservationStatus
}

export interface OwnerUnion {
  id: string
  name: string
  buildingId: string
  /** Owner clients (type مالك). */
  memberIds: string[]
  monthlyFee: number
  meetingSchedule: string
  notes: string
}

export interface Settings {
  /** Shown read-only in the sidebar, header, forms and every printout; empty until set. */
  projectName: string
  companyName: string
  companyAddress: string
  companyPhone: string
  /** Base64 data URL; empty string when unset. */
  companyLogo: string
  /** Base64 data URL; empty string when unset. */
  ourLogo: string
  showCompanyLogo: boolean
  showOurLogo: boolean
  /** Link encoded in the printed QR code (the company's developer page). */
  developerUrl?: string
}

export interface DataState {
  buildings: Building[]
  units: Unit[]
  clients: Client[]
  contracts: Contract[]
  installments: Installment[]
  payments: Payment[]
  maintenance: Maintenance[]
  reservations: Reservation[]
  ownerUnions: OwnerUnion[]
  settings: Settings
}

/** DataState keys that hold id-keyed arrays. */
export type Collection = Exclude<keyof DataState, 'settings'>

/* ==================================================================
   Formatters
   ================================================================== */

const moneyFormatter = new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })

/** `egp(12500)` → `"12,500 ج.م"` */
export function egp(n: number): string {
  return `${moneyFormatter.format(n)} ج.م`
}

/** `fmtDate('2025-06-18')` → `"18/06/2025"`; returns `—` for empty values. */
export function fmtDate(d: Date | ISODate | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? parseISO(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

/* ==================================================================
   Selectors
   ================================================================== */

export const installmentRemaining = (i: Pick<Installment, 'amount' | 'paidAmount'>) =>
  Math.max(0, i.amount - i.paidAmount)

/** Label of a receipt's target: the upfront amount (`installmentId` null) or a schedule row. */
export function paymentLabel(type: ContractType, seq: number | null): string {
  if (seq === null || seq === 0) return type === 'إيجار' ? 'التأمين' : 'المقدم'
  return type === 'إيجار' ? `قسط الإيجار ${seq}` : `القسط ${seq}`
}

/** What the upfront amount (`installmentId` null) is called for a contract type. */
export const upfrontLabel = (type: ContractType) => (type === 'إيجار' ? 'التأمين' : 'المقدم')

export interface ContractSummary {
  type: ContractType
  /** Sale: agreed price. Lease: total rent over the term (the whole schedule). */
  contractValue: number
  /** Sale price; 0 for a lease. */
  unitPrice: number
  /** Lease: first-year monthly rent; 0 for a sale. */
  monthlyRent: number
  totalInstallments: number
  paidInstallmentsCount: number
  /** Everything collected against the schedule (installments or rent), partial payments included. */
  paidInstallmentsTotal: number
  lastPaidInstallment: Installment | null
  /** First row (by seq) with a balance left. */
  nextDueInstallment: Installment | null
  currentInstallmentRemaining: number
  /** Sale only; always 0 for a lease. */
  downPayment: number
  downPaymentPaid: number
  downPaymentRemaining: number
  /** Lease only; always 0 for a sale. Refundable, so not part of `totalPaid`/`totalRemaining`. */
  securityDeposit: number
  securityDepositPaid: number
  securityDepositRemaining: number
  /** Collected towards `contractValue`: down payment + installments, or rent. */
  totalPaid: number
  /** Left of `contractValue`: down-payment balance + installment balances, or unpaid rent. */
  totalRemaining: number
}

export function contractSummary(
  state: Pick<DataState, 'contracts' | 'installments' | 'payments'>,
  contractId: string,
): ContractSummary | null {
  const contract = state.contracts.find((c) => c.id === contractId)
  if (!contract) return null
  const rows = state.installments.filter((i) => i.contractId === contractId).sort((a, b) => a.seq - b.seq)
  const paid = rows.filter((i) => i.status === 'مدفوع')
  const nextDue = rows.find((i) => installmentRemaining(i) > 0) ?? null
  const upfrontPaid = state.payments
    .filter((p) => p.contractId === contractId && p.installmentId === null)
    .reduce((sum, p) => sum + p.amount, 0)
  const paidInstallmentsTotal = rows.reduce((sum, i) => sum + i.paidAmount, 0)
  const scheduleRemaining = rows.reduce((sum, i) => sum + installmentRemaining(i), 0)
  const common = {
    type: contract.type,
    totalInstallments: rows.length,
    paidInstallmentsCount: paid.length,
    paidInstallmentsTotal,
    lastPaidInstallment: paid.at(-1) ?? null,
    nextDueInstallment: nextDue,
    currentInstallmentRemaining: nextDue ? installmentRemaining(nextDue) : 0,
  }
  if (contract.type === 'إيجار') {
    return {
      ...common,
      contractValue: rows.reduce((sum, i) => sum + i.amount, 0),
      unitPrice: 0,
      monthlyRent: contract.monthlyRent,
      downPayment: 0,
      downPaymentPaid: 0,
      downPaymentRemaining: 0,
      securityDeposit: contract.securityDeposit,
      securityDepositPaid: upfrontPaid,
      securityDepositRemaining: Math.max(0, contract.securityDeposit - upfrontPaid),
      totalPaid: paidInstallmentsTotal,
      totalRemaining: scheduleRemaining,
    }
  }
  const downPaymentRemaining = Math.max(0, contract.downPayment - upfrontPaid)
  return {
    ...common,
    contractValue: contract.unitPrice,
    unitPrice: contract.unitPrice,
    monthlyRent: 0,
    downPayment: contract.downPayment,
    downPaymentPaid: upfrontPaid,
    downPaymentRemaining,
    securityDeposit: 0,
    securityDepositPaid: 0,
    securityDepositRemaining: 0,
    totalPaid: upfrontPaid + paidInstallmentsTotal,
    totalRemaining: downPaymentRemaining + scheduleRemaining,
  }
}

/** Upfront balance still open: the down payment of a sale or the deposit of a lease. */
export const upfrontRemaining = (s: ContractSummary) =>
  s.type === 'إيجار' ? s.securityDepositRemaining : s.downPaymentRemaining

/* ==================================================================
   Reducer
   ================================================================== */

type Patch<T extends { id: string }> = Pick<T, 'id'> & Partial<Omit<T, 'id'>>

/** One entry of a free schedule. */
export interface ScheduleItem {
  dueDate: ISODate
  amount: number
  /** Down-payment row: excluded from installment numbering (stored with seq 0). */
  isDownPayment?: boolean
  /** Collected at signing; creates a receipt when the contract is posted. */
  paidAmount?: number
}

export type DataAction =
  | { type: 'ADD_BUILDING'; payload: Building }
  | { type: 'UPDATE_BUILDING'; payload: Patch<Building> }
  /** Cascades: removes the building's units, their contracts/installments/payments/reservations, maintenance and unions. */
  | { type: 'DELETE_BUILDING'; payload: { id: string } }
  | { type: 'ADD_UNIT'; payload: Unit }
  | { type: 'UPDATE_UNIT'; payload: Patch<Unit> }
  | { type: 'ADD_CLIENT'; payload: Client }
  | { type: 'UPDATE_CLIENT'; payload: Patch<Client> }
  /**
   * Needs an active (نشط) reservation of the same client, unit and purpose, which becomes محوّل لعقد.
   * An active contract also sells or rents the unit and creates the schedule.
   */
  | { type: 'ADD_CONTRACT'; payload: { contract: Contract; schedule: ScheduleItem[] } }
  /** Posts a مسودة contract: it becomes نشط, sells or rents its (still محجوزة) unit and creates the schedule. */
  | { type: 'POST_CONTRACT'; payload: { id: string; schedule: ScheduleItem[] } }
  /** Marks the contract مرتجع, the unit مرتجعة, and drops schedule rows nothing was paid on. */
  | { type: 'RETURN_CONTRACT'; payload: { id: string } }
  /** Ends an active lease on `date`: contract منتهي, unit متاحة, unpaid rows due after `date` are cancelled. */
  | { type: 'END_LEASE'; payload: { id: string; date: ISODate } }
  /** Renews an active lease: the old contract becomes مجدد and `contract` (نشط, same unit and client) takes over with its own schedule. */
  | { type: 'RENEW_LEASE'; payload: { oldId: string; contract: Contract; schedule: ScheduleItem[] } }
  /** Records a receipt; with an installmentId it also pays that row, otherwise the down payment / deposit. */
  | {
      type: 'RECORD_PAYMENT'
      payload: {
        contractId: string
        installmentId: string | null
        amount: number
        method: PaymentMethod
        date?: ISODate
        receiptNumber?: string
        notes?: string
      }
    }
  | { type: 'ADD_MAINTENANCE'; payload: Maintenance }
  /** Needs an existing client; an active reservation also marks the unit محجوزة. */
  | { type: 'ADD_RESERVATION'; payload: Reservation }
  | { type: 'ADD_OWNER_UNION'; payload: OwnerUnion }
  | { type: 'UPDATE_OWNER_UNION'; payload: Patch<OwnerUnion> }
  | { type: 'DELETE_OWNER_UNION'; payload: { id: string } }
  | { type: 'CANCEL_PAYMENTS'; payload: { contractId: string; installmentId: string | null } }
  | { type: 'UPDATE_INSTALLMENT_AMOUNT'; payload: { id: string; amount: number } }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> }
  /** Restores the seed data. */
  | { type: 'RESET_DATA' }

function patchById<T extends { id: string }>(items: T[], patch: Patch<T>): T[] {
  return items.map((item) => (item.id === patch.id ? { ...item, ...patch } : item))
}

function withUnitStatus(units: Unit[], unitId: string, status: UnitStatus): Unit[] {
  return units.map((unit) => (unit.id === unitId ? { ...unit, status, nonSellableReason: '' } : unit))
}

function scheduleFor(contractId: string, schedule: ScheduleItem[], existing: Installment[]): Installment[] {
  let n = lastIdNumber('installments', existing)
  let seq = 0
  return [...schedule]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map(({ dueDate, amount, isDownPayment, paidAmount }) => {
      const paid = Math.min(amount, Math.max(0, paidAmount ?? 0))
      return {
        id: formatId('installments', ++n),
        contractId,
        seq: isDownPayment ? 0 : ++seq,
        dueDate,
        amount,
        paidAmount: paid,
        remaining: amount - paid,
        status: installmentStatus(amount, paid, dueDate, TODAY_ISO),
      }
    })
}

/** New installments plus a receipt for every amount already collected at signing. */
function withSchedule(state: DataState, contractId: string, schedule: ScheduleItem[], date: ISODate) {
  const rows = scheduleFor(contractId, schedule, state.installments)
  let payments = state.payments
  for (const r of rows) {
    if (r.paidAmount <= 0) continue
    payments = [
      ...payments,
      {
        id: formatId('payments', lastIdNumber('payments', payments) + 1),
        contractId,
        installmentId: r.id,
        date,
        amount: r.paidAmount,
        method: 'نقدي',
        receiptNumber: nextReceiptNumber(payments, date),
        notes: 'محصّل عند التوقيع',
      },
    ]
  }
  return { installments: [...state.installments, ...rows], payments }
}

export function dataReducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case 'ADD_BUILDING':
      return { ...state, buildings: [...state.buildings, action.payload] }

    case 'UPDATE_BUILDING':
      return { ...state, buildings: patchById(state.buildings, action.payload) }

    case 'DELETE_BUILDING': {
      const { id } = action.payload
      const unitIds = new Set(state.units.filter((u) => u.buildingId === id).map((u) => u.id))
      const contractIds = new Set(state.contracts.filter((c) => unitIds.has(c.unitId)).map((c) => c.id))
      return {
        ...state,
        buildings: state.buildings.filter((b) => b.id !== id),
        units: state.units.filter((u) => !unitIds.has(u.id)),
        contracts: state.contracts.filter((c) => !contractIds.has(c.id)),
        installments: state.installments.filter((i) => !contractIds.has(i.contractId)),
        payments: state.payments.filter((p) => !contractIds.has(p.contractId)),
        maintenance: state.maintenance.filter((m) => m.buildingId !== id),
        reservations: state.reservations.filter((r) => !unitIds.has(r.unitId)),
        ownerUnions: state.ownerUnions.filter((u) => u.buildingId !== id),
      }
    }

    case 'ADD_UNIT':
      return { ...state, units: [...state.units, action.payload] }

    case 'UPDATE_UNIT':
      return { ...state, units: patchById(state.units, action.payload) }

    case 'ADD_CLIENT':
      return { ...state, clients: [...state.clients, action.payload] }

    case 'UPDATE_CLIENT':
      return { ...state, clients: patchById(state.clients, action.payload) }

    case 'ADD_CONTRACT': {
      const { contract, schedule } = action.payload
      const reservation = state.reservations.find((r) => r.id === contract.reservationId)
      if (
        !reservation ||
        reservation.status !== 'نشط' ||
        reservation.clientId !== contract.clientId ||
        reservation.unitId !== contract.unitId ||
        reservation.purpose !== contract.type ||
        !state.clients.some((c) => c.id === contract.clientId)
      )
        return state
      const next = {
        ...state,
        contracts: [...state.contracts, contract],
        reservations: patchById(state.reservations, { id: reservation.id, status: RESERVATION_CONVERTED }),
      }
      if (contract.status !== 'نشط') return next
      return {
        ...next,
        units: withUnitStatus(state.units, contract.unitId, contract.type === 'إيجار' ? 'مؤجرة' : 'مباعة'),
        ...withSchedule(state, contract.id, schedule, contract.date),
      }
    }

    case 'POST_CONTRACT': {
      const { id, schedule } = action.payload
      const contract = state.contracts.find((c) => c.id === id)
      const unit = contract && state.units.find((u) => u.id === contract.unitId)
      if (!contract || contract.status !== 'مسودة' || unit?.status !== 'محجوزة') return state
      return {
        ...state,
        contracts: patchById(state.contracts, { id, status: 'نشط' }),
        units: withUnitStatus(state.units, contract.unitId, contract.type === 'إيجار' ? 'مؤجرة' : 'مباعة'),
        ...withSchedule(state, id, schedule, contract.date),
      }
    }

    case 'RETURN_CONTRACT': {
      const { id } = action.payload
      const contract = state.contracts.find((c) => c.id === id)
      if (!contract || (contract.status !== 'نشط' && contract.status !== 'مكتمل')) return state
      return {
        ...state,
        contracts: patchById(state.contracts, { id, status: 'مرتجع' }),
        units: withUnitStatus(state.units, contract.unitId, 'مرتجعة'),
        installments: state.installments.filter((i) => !(i.contractId === id && i.paidAmount === 0)),
      }
    }

    case 'END_LEASE': {
      const { id, date } = action.payload
      const contract = state.contracts.find((c) => c.id === id)
      if (!contract || contract.type !== 'إيجار' || contract.status !== 'نشط') return state
      return {
        ...state,
        contracts: patchById(state.contracts, { id, status: 'منتهي' }),
        units: withUnitStatus(state.units, contract.unitId, 'متاحة'),
        installments: state.installments.filter((i) => !(i.contractId === id && i.paidAmount === 0 && i.dueDate > date)),
      }
    }

    case 'RENEW_LEASE': {
      const { oldId, contract, schedule } = action.payload
      const old = state.contracts.find((c) => c.id === oldId)
      if (!old || old.type !== 'إيجار' || old.status !== 'نشط' || contract.type !== 'إيجار') return state
      if (contract.unitId !== old.unitId || contract.clientId !== old.clientId) return state
      return {
        ...state,
        contracts: [...patchById(state.contracts, { id: oldId, status: 'مجدد' }), { ...contract, status: 'نشط' }],
        installments: [...state.installments, ...scheduleFor(contract.id, schedule, state.installments)],
      }
    }

    case 'RECORD_PAYMENT': {
      const { contractId, installmentId, amount, method, date = TODAY_ISO, notes = '' } = action.payload
      const contract = state.contracts.find((c) => c.id === contractId)
      if (!contract || contract.status !== 'نشط' || !(amount > 0)) return state

      let installments = state.installments
      if (installmentId === null) {
        const summary = contractSummary(state, contractId)
        if (!summary || amount > upfrontRemaining(summary)) return state
      } else {
        const target = state.installments.find((i) => i.id === installmentId)
        if (!target || target.contractId !== contractId || amount > installmentRemaining(target)) return state
        const paidAmount = target.paidAmount + amount
        installments = patchById(state.installments, {
          id: installmentId,
          paidAmount,
          remaining: target.amount - paidAmount,
          status: installmentStatus(target.amount, paidAmount, target.dueDate, TODAY_ISO),
        })
      }

      const payment: Payment = {
        id: formatId('payments', lastIdNumber('payments', state.payments) + 1),
        contractId,
        installmentId,
        date,
        amount,
        method,
        receiptNumber: action.payload.receiptNumber ?? nextReceiptNumber(state.payments, date),
        notes,
      }
      const next = { ...state, installments, payments: [...state.payments, payment] }
      // A fully paid sale is complete; a lease stays active until its term ends.
      const done = contract.type === 'بيع' && contractSummary(next, contractId)?.totalRemaining === 0
      return done ? { ...next, contracts: patchById(next.contracts, { id: contractId, status: 'مكتمل' }) } : next
    }

    case 'CANCEL_PAYMENTS': {
      const { contractId, installmentId } = action.payload
      const payments = state.payments.filter((p) => !(p.contractId === contractId && p.installmentId === installmentId))
      if (payments.length === state.payments.length) return state
      let installments = state.installments
      const i = installmentId ? state.installments.find((x) => x.id === installmentId) : null
      if (i) installments = patchById(installments, { id: i.id, paidAmount: 0, remaining: i.amount, status: installmentStatus(i.amount, 0, i.dueDate, TODAY_ISO) })
      const contracts = state.contracts.map((c) => (c.id === contractId && c.status === 'مكتمل' ? { ...c, status: 'نشط' as const } : c))
      return { ...state, installments, payments, contracts }
    }

    case 'UPDATE_INSTALLMENT_AMOUNT': {
      const { id, amount } = action.payload
      const i = state.installments.find((x) => x.id === id)
      if (!i || !(amount >= i.paidAmount)) return state
      return {
        ...state,
        installments: patchById(state.installments, { id, amount, remaining: amount - i.paidAmount, status: installmentStatus(amount, i.paidAmount, i.dueDate, TODAY_ISO) }),
      }
    }

    case 'ADD_MAINTENANCE':
      return { ...state, maintenance: [...state.maintenance, action.payload] }

    case 'ADD_RESERVATION': {
      const reservation = action.payload
      if (!state.clients.some((c) => c.id === reservation.clientId)) return state
      return {
        ...state,
        reservations: [...state.reservations, reservation],
        units:
          reservation.status === 'نشط'
            ? withUnitStatus(state.units, reservation.unitId, 'محجوزة')
            : state.units,
      }
    }

    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } }

    case 'ADD_OWNER_UNION':
      return { ...state, ownerUnions: [...state.ownerUnions, action.payload] }

    case 'UPDATE_OWNER_UNION':
      return { ...state, ownerUnions: patchById(state.ownerUnions, action.payload) }

    case 'DELETE_OWNER_UNION':
      return { ...state, ownerUnions: state.ownerUnions.filter((u) => u.id !== action.payload.id) }

    case 'RESET_DATA':
      return createSeedData()

    default:
      return state
  }
}

/* ==================================================================
   Persistence
   ================================================================== */

/**
 * Prefix of every persisted key. Bump the version when the shape of the stored data changes: data
 * under older prefixes is cleared on load and the seed takes its place.
 */
export const STORAGE_PREFIX = 'aqar.sales.v3'
export const storageKey = (name: string) => `${STORAGE_PREFIX}.${name}`

const STORAGE_KEY = storageKey('data')
const STORAGE_VERSION = 3
/** Keys of earlier, incompatible builds; cleared on load. */
const LEGACY_KEYS = ['aqar.data', 'aqar.sales.data', 'aqar.sales.ownerUnions', 'aqar.sales.returns']
const COLLECTIONS: Collection[] = [
  'buildings',
  'units',
  'clients',
  'contracts',
  'installments',
  'payments',
  'maintenance',
  'reservations',
  'ownerUnions',
]

function hydrate(): DataState {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as { version?: number; data?: Record<string, unknown> }
      const data = saved?.data
      const valid =
        saved?.version === STORAGE_VERSION &&
        data &&
        COLLECTIONS.every((k) => Array.isArray(data[k])) &&
        typeof data.settings === 'object' &&
        data.settings !== null
      if (valid) return data as unknown as DataState
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Corrupt or inaccessible storage: fall back to the seed.
  }
  return createSeedData()
}

function persist(state: DataState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data: state }))
  } catch {
    // Quota exceeded (large logos) or storage disabled; the in-memory state stays authoritative.
  }
}

/* ==================================================================
   Contexts
   ================================================================== */

export type DataContextValue = DataState & {
  dispatch: Dispatch<DataAction>
  /** `contractSummary(state, id)` bound to the current state. */
  contractSummary: (contractId: string) => ContractSummary | null
}

export const DataCtx = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children?: ReactNode }) {
  const [state, dispatch] = useReducer(dataReducer, null, hydrate)

  useEffect(() => persist(state), [state])

  const value = useMemo<DataContextValue>(
    () => ({ ...state, dispatch, contractSummary: (id: string) => contractSummary(state, id) }),
    [state],
  )
  return createElement(DataCtx.Provider, { value }, children)
}

export function useData(): DataContextValue {
  const ctx = useContext(DataCtx)
  if (!ctx) throw new Error('useData must be used inside <DataProvider>')
  return ctx
}

export interface AppContextValue {
  dark: boolean
  setDark: (dark: boolean) => void
}

export const AppCtx = createContext<AppContextValue | null>(null)

/** Theme state; persists through `applyTheme` (localStorage + `<html class="dark">`). */
export function AppProvider({ children }: { children?: ReactNode }) {
  const [dark, setDarkState] = useState(() => getTheme() === 'dark')

  const setDark = useCallback((next: boolean) => {
    applyTheme(next ? 'dark' : 'light')
    setDarkState(next)
  }, [])

  const value = useMemo<AppContextValue>(() => ({ dark, setDark }), [dark, setDark])
  return createElement(AppCtx.Provider, { value }, children)
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}

/** Both providers, for the app root. */
export function Providers({ children }: { children?: ReactNode }) {
  return createElement(AppProvider, null, createElement(DataProvider, null, children))
}
