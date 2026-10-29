/**
 * Minimal client for the Laravel API (`backend/`), used where the prototype has to talk to the server
 * (currently: the buildings page).
 *
 * The token is read from localStorage, or from `?token=` on first load (the URL is cleaned afterwards),
 * or obtained from the login card via `login()`. Without a token the buildings page shows the login card
 * instead of the table.
 */
import type { Building, BuildingActivity, BuildingKind } from '@/lib'

// In dev the Vite server proxies `/api` to Laravel (see `vite.config.ts`), so requests are
// same-origin: no CORS preflight and no hard-coded host. A build still points at the API directly
// unless `VITE_API_URL` says otherwise.
const DEFAULT_BASE_URL = import.meta.env.DEV ? '/api/v1' : 'http://localhost:8000/api/v1'
const TOKEN_KEY = 'aqar.api.token'

export const API_BASE_URL = ((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_BASE_URL).replace(/\/+$/, '')

/** Building shape returned by `GET/POST /api/v1/admin/buildings`. */
export interface ApiBuilding {
  id: number
  name: string
  number: string | null
  type: string | null
  type_label: string | null
  city: string | null
  district: string | null
  activities: string[] | null
  floors_count: number
  total_units: number
  units_count: number
  has_basement: boolean
  created_at?: string
  updated_at?: string
}

/** A Laravel error response (422) or a transport failure (status 0). */
export class ApiError extends Error {
  readonly status: number
  /** Field name (as sent to the API) → messages. */
  readonly errors: Record<string, string[]>

  constructor(message: string, status: number, errors: Record<string, string[]> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errors = errors
  }
}

const KIND_TO_API: Record<BuildingKind, string> = {
  'عمارة': 'building',
  'برج': 'tower',
  'بيت': 'house',
  'مبنى مكاتب': 'office_building',
}
const KIND_FROM_API: Record<string, BuildingKind> = Object.fromEntries(
  Object.entries(KIND_TO_API).map(([kind, api]) => [api, kind as BuildingKind]),
) as Record<string, BuildingKind>

const ACTIVITY_TO_API: Record<BuildingActivity, string> = {
  'سكني': 'residential',
  'إداري': 'administrative',
  'تجاري': 'commercial',
  'طبي': 'medical',
  'فندقي': 'hotel',
}
const ACTIVITY_FROM_API: Record<string, BuildingActivity> = Object.fromEntries(
  Object.entries(ACTIVITY_TO_API).map(([activity, api]) => [api, activity as BuildingActivity]),
) as Record<string, BuildingActivity>

export const kindFromApi = (value: string | null | undefined): BuildingKind => (value && KIND_FROM_API[value]) || 'عمارة'
export const activityFromApi = (value: string): BuildingActivity | null => ACTIVITY_FROM_API[value] ?? null

/** The eight fields the add-building form collects (`type`/`activities` renamed for the API). */
export type BuildingInput = Pick<Building, 'name' | 'city' | 'district' | 'totalFloors' | 'totalUnits'> & {
  kind: BuildingKind
  activities: BuildingActivity[]
  hasBasement: boolean
}

/** API field name → form/draft field, for mapping 422 errors back onto the form. */
export const API_FIELD_TO_FORM: Record<string, string> = {
  name: 'name',
  city: 'city',
  district: 'district',
  type: 'kind',
  activities: 'activities',
  floors_count: 'totalFloors',
  total_units: 'totalUnits',
  has_basement: 'hasBasement',
}

/** Laravel paginator metadata (`meta` of a resource collection). */
export interface PageMeta {
  current_page: number
  last_page: number
  per_page: number
  total: number
  from: number | null
  to: number | null
  /** Contracts list only: row counts per type before the `type` filter (for the filter chips). */
  counts?: { all: number; sale: number; rent: number }
}

export interface BuildingPage {
  items: ApiBuilding[]
  meta: PageMeta
}

let cachedToken: string | null | undefined

/** Bearer token from `?token=` (consumed and removed from the URL) or localStorage. */
export function getToken(): string | null {
  if (cachedToken !== undefined) return cachedToken
  cachedToken = null
  try {
    const url = new URL(window.location.href)
    const fromQuery = url.searchParams.get('token')
    if (fromQuery) {
      cachedToken = fromQuery
      localStorage.setItem(TOKEN_KEY, fromQuery)
      url.searchParams.delete('token')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      return cachedToken
    }
    cachedToken = localStorage.getItem(TOKEN_KEY)
  } catch {
    // Storage or URL unavailable: stay in local-only mode.
  }
  return cachedToken
}

export const hasToken = () => getToken() !== null

/** Stores a token (from a login response) so the next requests are authenticated. */
export function setToken(token: string) {
  cachedToken = token
  // Requests in flight belong to the previous session; don't let them answer the new one.
  inFlightGets.clear()
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // ignore
  }
  announceTokenChange()
}

export function clearToken() {
  cachedToken = null
  inFlightGets.clear()
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
  announceTokenChange()
}

/** Lets the header bell (and anything else outside a screen) react to a sign-in/out in place. */
function announceTokenChange() {
  try {
    window.dispatchEvent(new Event('aqar:token-changed'))
  } catch {
    // Not in a browser context.
  }
}

/**
 * GET requests currently in flight, keyed by method + path.
 *
 * React StrictMode re-runs mount effects twice in dev, and two screens can ask for the same
 * picker list at the same moment. Without sharing the promise, the browser sends the same GET
 * twice and Laravel boots twice — which is exactly what made every page feel slow.
 */
const inFlightGets = new Map<string, Promise<unknown>>()

function request<T, M = PageMeta>(path: string, init: RequestInit = {}): Promise<{ data: T; meta?: M }> {
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') return send<T, M>(path, init)

  const key = `GET ${path}`
  const pending = inFlightGets.get(key)
  if (pending) return pending as Promise<{ data: T; meta?: M }>

  const promise = send<T, M>(path, init)
  inFlightGets.set(key, promise)
  const forget = () => {
    inFlightGets.delete(key)
  }
  void promise.then(forget, forget)
  return promise
}

async function send<T, M = PageMeta>(path: string, init: RequestInit = {}): Promise<{ data: T; meta?: M }> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  // The API picks its locale from this header; the app is Arabic-first (the browser sends en-* by default).
  headers.set('Accept-Language', 'ar')
  if (init.body) headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  } catch {
    throw new ApiError('تعذّر الاتصال بالخادم. تأكد أن الـ API يعمل.', 0)
  }

  const body = (await response.json().catch(() => null)) as
    | { data?: T; meta?: M; message?: string; errors?: Record<string, string[]> }
    | null

  if (!response.ok) {
    const errors = body?.errors ?? {}
    const first = Object.values(errors)[0]?.[0]
    throw new ApiError(body?.message || first || `فشل الطلب (${response.status})`, response.status, errors)
  }
  return { data: body?.data as T, meta: body?.meta }
}

/** The authenticated user, as returned by `POST /auth/login`. */
export interface ApiUser {
  id: number
  name: string
  username: string
  email: string | null
  role: string | null
}

/**
 * `POST /auth/login` — `login` accepts the username or the email. The token is stored automatically,
 * so every later request is authenticated.
 */
export async function login(login: string, password: string): Promise<ApiUser> {
  const res = await request<{ token: string; user: ApiUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  })
  setToken(res.data.token)
  return res.data.user
}

const payload = (input: BuildingInput) => ({
  name: input.name.trim(),
  city: input.city.trim(),
  district: input.district.trim(),
  type: KIND_TO_API[input.kind],
  activities: input.activities.map((a) => ACTIVITY_TO_API[a]),
  floors_count: input.totalFloors,
  total_units: input.totalUnits,
  has_basement: input.hasBasement,
})

/** Maps an API building onto the prototype's `Building` shape. */
export function buildingFromApi(item: ApiBuilding): Building {
  return {
    id: `b-${item.id}`,
    apiId: item.id,
    name: item.name,
    // The API has no street address; city + district are what it stores.
    address: '',
    city: item.city ?? '',
    district: item.district ?? '',
    kind: kindFromApi(item.type),
    activities: (item.activities ?? []).map(activityFromApi).filter((a): a is BuildingActivity => a !== null),
    // Seed-only screens read `types`; the API screens read `kind`/`activities`.
    types: [],
    totalFloors: item.floors_count,
    totalUnits: item.total_units,
    unitsCount: item.units_count,
    hasBasement: item.has_basement,
    ownerShares: [],
    status: 'نشط',
  }
}

/** `GET /admin/buildings` — one page (server-side search, sort and pagination). */
export async function fetchBuildings(
  params: { search?: string; page?: number; sort?: string; dir?: 'asc' | 'desc'; perPage?: number } = {},
): Promise<BuildingPage> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.page) query.set('page', String(params.page))
  if (params.sort) query.set('sort', params.sort)
  if (params.dir) query.set('dir', params.dir)
  if (params.perPage) query.set('per_page', String(params.perPage))

  const res = await request<ApiBuilding[]>(`/admin/buildings${query.size ? `?${query}` : ''}`)
  const items = res.data ?? []
  return {
    items,
    meta: res.meta ?? {
      current_page: 1,
      last_page: 1,
      per_page: items.length,
      total: items.length,
      from: items.length ? 1 : null,
      to: items.length ? items.length : null,
    },
  }
}

/** `POST /admin/buildings` — permission `buildings.create`. */
export async function createBuilding(input: BuildingInput): Promise<ApiBuilding> {
  return (await request<ApiBuilding>('/admin/buildings', { method: 'POST', body: JSON.stringify(payload(input)) })).data
}

/** `PUT /admin/buildings/{id}` — permission `buildings.update`. */
export async function updateBuilding(apiId: number, input: BuildingInput): Promise<ApiBuilding> {
  return (await request<ApiBuilding>(`/admin/buildings/${apiId}`, { method: 'PUT', body: JSON.stringify(payload(input)) })).data
}

/** `DELETE /admin/buildings/{id}` — permission `buildings.delete`. */
export async function deleteBuilding(apiId: number): Promise<void> {
  await request<{ message: string }>(`/admin/buildings/${apiId}`, { method: 'DELETE' })
}

/* ------------------------------------------------------------------ *
 * Units
 * ------------------------------------------------------------------ */

/** Floors generated by the API for a building (`GET /admin/buildings/{id}`). */
export interface ApiFloor {
  id: number
  /** 0 = basement, 1..N above ground (the prototype shows the basement as -1). */
  floor_number: number
  display_name: string
  units_count: number
}

/** Unit shape returned by `GET /admin/units` (money fields are decimal strings). */
export interface ApiUnit {
  id: number
  building_id: number
  building_name: string | null
  floor_id: number
  floor_number: number | null
  floor_display_name: string | null
  name: string
  type: string
  type_label: string | null
  activity: string | null
  purpose: string
  purpose_label: string | null
  area: string
  price_per_meter: string | null
  sale_price: string | null
  total_price: string | null
  is_sellable: boolean
  non_sellable_reason: string | null
  rooms: number | null
  bathrooms: number | null
  status: string
  status_label: string | null
}

/** Fixed unit types accepted by the API (`app/Enums/UnitType.php`); the keys are the UI labels. */
export const UNIT_TYPE_TO_API: Record<string, string> = {
  'شقة': 'apartment',
  'محل': 'shop',
  'مستودع': 'warehouse',
  'استوديو': 'studio',
}

/** Purpose enum `sale | rent | both` ↔ the prototype's Arabic labels. */
export const PURPOSE_TO_API: Record<string, string> = {
  'بيع': 'sale',
  'إيجار': 'rent',
  'بيع وإيجار': 'both',
}
export const PURPOSE_FROM_API: Record<string, string> = Object.fromEntries(
  Object.entries(PURPOSE_TO_API).map(([label, api]) => [api, label]),
)

/** Arabic label of an API purpose (`sale` → بيع); `both` when unknown. */
export const purposeLabel = (value: string | null | undefined): string =>
  (value && PURPOSE_FROM_API[value]) || 'بيع وإيجار'

/** Arabic label of an API unit type (`apartment` → شقة); the raw value when unknown. */
export const unitTypeLabel = (value: string | null | undefined): string => {
  if (!value) return '—'
  const label = Object.keys(UNIT_TYPE_TO_API).find((key) => UNIT_TYPE_TO_API[key] === value)
  return label ?? value
}

/** API field name → form/draft field, for mapping a unit's 422 errors back onto the form. */
export const API_UNIT_FIELD_TO_FORM: Record<string, string> = {
  building_id: 'buildingId',
  floor_id: 'floorId',
  name: 'name',
  type: 'type',
  activity: 'activity',
  purpose: 'purpose',
  area: 'area',
  price_per_meter: 'pricePerMeter',
  sale_price: 'price',
  is_sellable: 'sellable',
  non_sellable_reason: 'nonSellableReason',
  rooms: 'rooms',
  bathrooms: 'bathrooms',
}

/** What the unit form sends (`type` / `purpose` / `activity` already in API enum form). */
export interface UnitInput {
  buildingId: number
  floorId: number
  name: string
  type: string
  activity: string
  purpose: string
  area: number
  rooms: number | null
  bathrooms: number | null
  /** Required for sale/both, `null` for rent-only. */
  pricePerMeter: number | null
  /** Explicit sale price; `null` lets the API compute `area × price_per_meter`. */
  salePrice: number | null
  isSellable: boolean
  nonSellableReason: string
}

export interface UnitPage {
  items: ApiUnit[]
  meta: PageMeta
}

const unitPayload = (input: UnitInput, withBuilding: boolean) => ({
  ...(withBuilding ? { building_id: input.buildingId } : {}),
  floor_id: input.floorId,
  name: input.name.trim(),
  type: input.type,
  activity: input.activity,
  purpose: input.purpose,
  area: input.area,
  rooms: input.rooms,
  bathrooms: input.bathrooms,
  price_per_meter: input.pricePerMeter,
  sale_price: input.salePrice,
  is_sellable: input.isSellable,
  non_sellable_reason: input.isSellable ? null : input.nonSellableReason.trim(),
})

/** `GET /admin/units` — one page (server-side search, filters, sort and pagination). */
export async function fetchUnits(
  params: {
    search?: string
    page?: number
    sort?: string
    dir?: 'asc' | 'desc'
    perPage?: number
    buildingId?: number | null
    floorId?: number | null
    type?: string | null
    purpose?: string | null
    status?: string | null
    sellable?: boolean | null
  } = {},
): Promise<UnitPage> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.page) query.set('page', String(params.page))
  if (params.sort) query.set('sort', params.sort)
  if (params.dir) query.set('dir', params.dir)
  if (params.perPage) query.set('per_page', String(params.perPage))
  if (params.buildingId) query.set('building_id', String(params.buildingId))
  if (params.floorId) query.set('floor_id', String(params.floorId))
  if (params.type) query.set('type', params.type)
  if (params.purpose) query.set('purpose', params.purpose)
  if (params.status) query.set('status', params.status)
  if (params.sellable != null) query.set('sellable', params.sellable ? '1' : '0')

  const res = await request<ApiUnit[]>(`/admin/units${query.size ? `?${query}` : ''}`)
  const items = res.data ?? []
  return {
    items,
    meta: res.meta ?? {
      current_page: 1,
      last_page: 1,
      per_page: items.length,
      total: items.length,
      from: items.length ? 1 : null,
      to: items.length ? items.length : null,
    },
  }
}

/** `POST /admin/units` — permission `units.create`. */
export async function createUnit(input: UnitInput): Promise<ApiUnit> {
  return (await request<ApiUnit>('/admin/units', { method: 'POST', body: JSON.stringify(unitPayload(input, true)) })).data
}

/** `PUT /admin/units/{id}` — permission `units.update`. `building_id` is immutable, so it isn't sent. */
export async function updateUnit(apiId: number, input: UnitInput): Promise<ApiUnit> {
  return (await request<ApiUnit>(`/admin/units/${apiId}`, { method: 'PUT', body: JSON.stringify(unitPayload(input, false)) })).data
}

/** `GET /admin/buildings/{id}` — the generated floors (for the floor pickers). */
export async function fetchBuildingFloors(buildingId: number): Promise<ApiFloor[]> {
  const res = await request<ApiBuilding & { floors?: ApiFloor[] }>(`/admin/buildings/${buildingId}`)
  return res.data?.floors ?? []
}

/** Safety stop for the `fetchAll*` helpers below (100 rows per page → 2000 rows). */
const MAX_ALL_PAGES = 20

/**
 * Collects every page of a paginated admin list. The first page reports `last_page`, so the rest
 * are requested in parallel — paging one after another turns a 4-page list into 4 round trips.
 */
async function fetchAllPages<T>(fetchPage: (page: number) => Promise<{ items: T[]; meta: PageMeta }>): Promise<T[]> {
  const first = await fetchPage(1)
  const all = [...first.items]
  const lastPage = Math.min(first.meta.last_page, MAX_ALL_PAGES)
  if (lastPage > 1) {
    const rest = await Promise.all(Array.from({ length: lastPage - 1 }, (_, i) => fetchPage(i + 2)))
    for (const result of rest) all.push(...result.items)
  }
  return all
}

/**
 * Every building (pages through `GET /admin/buildings`, 100 per page) — used to fill the
 * building/activity pickers on the units page.
 */
export async function fetchAllBuildings(): Promise<ApiBuilding[]> {
  return fetchAllPages((page) => fetchBuildings({ page, perPage: 100 }))
}

/* ------------------------------------------------------------------ *
 * Clients
 * ------------------------------------------------------------------ */

/**
 * Client shape returned by `GET /admin/clients`. The API has no email and no client type
 * (buyer / tenant / owner): there are only two phone numbers plus the national id and notes.
 */
export interface ApiClient {
  id: number
  name: string
  phone: string | null
  phone_2: string | null
  national_id: string | null
  notes: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** What the client form sends; empty strings are sent as `null`. */
export interface ClientInput {
  name: string
  phone: string
  phone2: string
  nationalId: string
  notes: string
}

/** API field name → form/draft field, for mapping a client's 422 errors back onto the drawer. */
export const API_CLIENT_FIELD_TO_FORM: Record<string, string> = {
  name: 'name',
  phone: 'phone',
  phone_2: 'phone2',
  national_id: 'nationalId',
  notes: 'notes',
}

/** Extra `meta` after a write: a number another client already has only warns (BRIEF 2.4). */
export interface ClientSaveMeta {
  duplicate_phone?: boolean
  duplicate_client_id?: number | null
}

export interface ClientPage {
  items: ApiClient[]
  meta: PageMeta
}

export interface ClientSaveResult {
  client: ApiClient
  /** Code/id of the other client holding one of the numbers, or `null` when clean. */
  duplicateId: number | null
}

const clientPayload = (input: ClientInput) => ({
  name: input.name.trim(),
  phone: input.phone.trim() || null,
  phone_2: input.phone2.trim() || null,
  national_id: input.nationalId.trim() || null,
  notes: input.notes.trim() || null,
})

const clientResult = (res: { data: ApiClient; meta?: ClientSaveMeta }): ClientSaveResult => ({
  client: res.data,
  duplicateId: res.meta?.duplicate_phone ? (res.meta.duplicate_client_id ?? null) : null,
})

/** `GET /admin/clients` — one page (server-side search, sort and pagination). */
export async function fetchClients(
  params: { search?: string; page?: number; sort?: string; dir?: 'asc' | 'desc'; perPage?: number } = {},
): Promise<ClientPage> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.page) query.set('page', String(params.page))
  if (params.sort) query.set('sort', params.sort)
  if (params.dir) query.set('dir', params.dir)
  if (params.perPage) query.set('per_page', String(params.perPage))

  const res = await request<ApiClient[]>(`/admin/clients${query.size ? `?${query}` : ''}`)
  const items = res.data ?? []
  return {
    items,
    meta: res.meta ?? {
      current_page: 1,
      last_page: 1,
      per_page: items.length,
      total: items.length,
      from: items.length ? 1 : null,
      to: items.length ? items.length : null,
    },
  }
}

/** `POST /admin/clients` — permission `clients.create`. A duplicate number only warns. */
export async function createClient(input: ClientInput): Promise<ClientSaveResult> {
  return clientResult(
    await request<ApiClient, ClientSaveMeta>('/admin/clients', {
      method: 'POST',
      body: JSON.stringify(clientPayload(input)),
    }),
  )
}

/** `PUT /admin/clients/{id}` — permission `clients.update`. */
export async function updateClient(apiId: number, input: ClientInput): Promise<ClientSaveResult> {
  return clientResult(
    await request<ApiClient, ClientSaveMeta>(`/admin/clients/${apiId}`, {
      method: 'PUT',
      body: JSON.stringify(clientPayload(input)),
    }),
  )
}

/**
 * `DELETE /admin/clients/{id}` — permission `clients.delete`. The API refuses (422) when the client
 * has an active reservation or any contract, even a cancelled one.
 */
export async function deleteClient(apiId: number): Promise<void> {
  await request<{ message: string }>(`/admin/clients/${apiId}`, { method: 'DELETE' })
}

/* ------------------------------------------------------------------ *
 * Reservations
 * ------------------------------------------------------------------ */

/** Reservation status as stored by the API (`status_label` carries the Arabic label). */
export const RESERVATION_STATUS_TO_API: Record<string, string> = {
  'نشط': 'active',
  'محوّل لعقد': 'converted',
  'ملغي': 'cancelled',
}

/**
 * `GET /admin/reservations` row. A reservation carries no price: `deposit_paid` is the sum of its
 * valid payments and the agreed price is entered on the contract.
 */
export interface ApiReservation {
  id: number
  client_id: number
  client_name?: string | null
  building_id: number | null
  building_name?: string | null
  unit_id: number | null
  unit_name?: string | null
  unit_type: string | null
  unit_activity: string | null
  reservation_date: string
  deposit_paid: string
  status: 'active' | 'converted' | 'cancelled'
  status_label: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  payments?: ApiReservationPayment[]
  created_at?: string
  updated_at?: string
}

/** `GET|POST /admin/reservations/{id}/payments`. Money is sent as a decimal string. */
export interface ApiReservationPayment {
  id: number
  reservation_id: number
  amount: string
  paid_at: string
  payment_method: string | null
  notes: string | null
  status: string
  status_label: string | null
  cancel_reason: string | null
  cancelled_at: string | null
  created_by: number | null
}

export interface ReservationPage {
  items: ApiReservation[]
  meta: PageMeta
}

/** What the new-reservation drawer sends. `unitId`/`buildingId` are exclusive in practice. */
export interface ReservationInput {
  clientId: number
  unitId: number | null
  buildingId: number | null
  /** ISO `YYYY-MM-DD`. */
  date: string
  /** Optional first deposit, created with the reservation. */
  firstPayment: number | null
}

/** `GET /admin/reservations` — one page (server-side search, filter, sort, pagination). */
export async function fetchReservations(
  params: {
    search?: string
    status?: string
    clientId?: number
    buildingId?: number
    page?: number
    sort?: string
    dir?: 'asc' | 'desc'
    perPage?: number
  } = {},
): Promise<ReservationPage> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.status) query.set('status', params.status)
  if (params.clientId) query.set('client_id', String(params.clientId))
  if (params.buildingId) query.set('building_id', String(params.buildingId))
  if (params.page) query.set('page', String(params.page))
  if (params.sort) query.set('sort', params.sort)
  if (params.dir) query.set('dir', params.dir)
  if (params.perPage) query.set('per_page', String(params.perPage))

  const res = await request<ApiReservation[]>(`/admin/reservations${query.size ? `?${query}` : ''}`)
  const items = res.data ?? []
  return {
    items,
    meta: res.meta ?? {
      current_page: 1,
      last_page: 1,
      per_page: items.length,
      total: items.length,
      from: items.length ? 1 : null,
      to: items.length ? items.length : null,
    },
  }
}

/** `GET /admin/reservations/{id}` — includes the payments. */
export async function fetchReservation(apiId: number): Promise<ApiReservation> {
  const res = await request<ApiReservation>(`/admin/reservations/${apiId}`)
  return res.data
}

/** `POST /admin/reservations` — permission `reservations.create`. The unit becomes `reserved`. */
export async function createReservation(input: ReservationInput): Promise<ApiReservation> {
  const body: Record<string, unknown> = {
    client_id: input.clientId,
    reservation_date: input.date,
  }
  if (input.unitId != null) body.unit_id = input.unitId
  if (input.buildingId != null) body.building_id = input.buildingId
  if (input.firstPayment != null) {
    body.first_payment = { amount: input.firstPayment, paid_at: input.date }
  }

  const res = await request<ApiReservation>('/admin/reservations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.data
}

/** `POST /admin/reservations/{id}/cancel` — the reason is required; the unit returns to `available`. */
export async function cancelReservation(apiId: number, reason: string): Promise<ApiReservation> {
  const res = await request<ApiReservation>(`/admin/reservations/${apiId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancellation_reason: reason }),
  })
  return res.data
}

/** `GET /admin/reservations/{id}/payments` — `depositPaid` is the sum of the valid payments. */
export async function fetchReservationPayments(
  apiId: number,
): Promise<{ items: ApiReservationPayment[]; depositPaid: string }> {
  const res = await request<ApiReservationPayment[], { deposit_paid: string }>(
    `/admin/reservations/${apiId}/payments`,
  )
  return { items: res.data ?? [], depositPaid: res.meta?.deposit_paid ?? '0.00' }
}

/** `POST /admin/reservations/{id}/payments` — permission `payments.create`. No price ceiling. */
export async function createReservationPayment(
  apiId: number,
  input: { amount: number; paidAt?: string },
): Promise<ApiReservationPayment> {
  const res = await request<ApiReservationPayment>(`/admin/reservations/${apiId}/payments`, {
    method: 'POST',
    body: JSON.stringify({ amount: input.amount, paid_at: input.paidAt }),
  })
  return res.data
}

/** `POST /admin/reservations/{id}/payments/{payment}/cancel` — the reason is required. */
export async function cancelReservationPayment(
  apiId: number,
  paymentId: number,
  reason: string,
): Promise<ApiReservationPayment> {
  const res = await request<ApiReservationPayment>(
    `/admin/reservations/${apiId}/payments/${paymentId}/cancel`,
    { method: 'POST', body: JSON.stringify({ cancel_reason: reason }) },
  )
  return res.data
}

/**
 * Every client (pages through `GET /admin/clients`, 100 per page) for the reservation picker.
 * The API caps `per_page` at 100.
 */
export async function fetchAllClients(): Promise<ApiClient[]> {
  return fetchAllPages((page) => fetchClients({ page, perPage: 100 }))
}

/**
 * Units that can take a new reservation: `available` and sellable. A unit with an active
 * reservation is `reserved`, and «غير قابلة للبيع» units are off the market.
 */
export async function fetchReservableUnits(): Promise<ApiUnit[]> {
  return fetchAllPages((page) => fetchUnits({ page, perPage: 100, status: 'available', sellable: true }))
}

/* ------------------------------------------------------------------
 * Contracts
 * ------------------------------------------------------------------ */

/** Contract status as stored by the API (`status_label` carries the Arabic label). */
export const CONTRACT_STATUS_TO_API: Record<string, string> = {
  'مسودة': 'draft',
  'نشط': 'active',
  'ملغي': 'cancelled',
}

export const CONTRACT_STATUS_FROM_API: Record<string, string> = {
  draft: 'مسودة',
  active: 'نشط',
  cancelled: 'ملغي',
}

/** A row of the contract's schedule (`GET /admin/contracts/{id}`). */
export interface ApiContractInstallment {
  id: number
  contract_id?: number
  sequence_number: number
  due_date: string
  amount: string
  paid_amount: string
  remaining: string
  status: string
  status_label: string | null
  /** Computed by the API at read time from the due date and the remaining amount. */
  is_overdue?: boolean
}

/** One row the contracts screen sends when posting a contract. */
export interface ContractScheduleInput {
  due_date: string
  amount: number
  /** A down-payment row: kept in the printed schedule, not an installment. */
  is_down_payment?: boolean
  /** Collected at signing; becomes a payment dated on the contract date. */
  paid_amount?: number
}

/** `GET /admin/contracts` row. Money arrives as decimal strings. */
export interface ApiContract {
  id: number
  number: string
  type: 'sale' | 'rent'
  type_label: string | null
  reservation_id: number | null
  client_id: number
  client_name?: string | null
  client_phone?: string | null
  unit_id: number
  unit_name?: string | null
  unit_type?: string | null
  unit_type_label?: string | null
  unit_area?: string | null
  building_id?: number | null
  building_name?: string | null
  contract_date: string
  total_price: string
  discount: string
  discount_reason: string | null
  agreed_down_payment: string
  paid_down_payment: string
  remaining_down_payment: string
  installments_count: number
  first_installment_date: string | null
  interval_months: number | null
  monthly_rent: string | null
  duration_months: number | null
  start_date: string | null
  end_date: string | null
  security_deposit: string
  advance_months: number
  annual_increase_pct: string | null
  increase_from_year: number | null
  draft_schedule: ContractScheduleInput[] | null
  contract_value: number
  paid_total: number
  remaining_total: number
  total_collected: number
  notes: string | null
  status: 'draft' | 'active' | 'cancelled'
  status_label: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  installments?: ApiContractInstallment[]
  created_at?: string
  updated_at?: string
}

export interface ContractPage {
  items: ApiContract[]
  meta: PageMeta
}

/** What the contract form sends. Only the fields of the chosen type are filled in. */
export interface ContractInput {
  type: 'sale' | 'rent'
  status?: 'draft' | 'active'
  reservationId: number | null
  clientId: number
  unitId: number
  /** ISO `YYYY-MM-DD`. */
  date: string
  /** Sale: the net price after the discount. Rent: the schedule total (optional). */
  totalPrice?: number | null
  discount?: number | null
  discountReason?: string
  agreedDownPayment?: number | null
  monthlyRent?: number | null
  durationMonths?: number | null
  startDate?: string | null
  endDate?: string | null
  securityDeposit?: number | null
  advanceMonths?: number | null
  annualIncreasePct?: number | null
  increaseFromYear?: number | null
  schedule?: ContractScheduleInput[]
  notes?: string
}

const contractBody = (input: ContractInput): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    type: input.type,
    client_id: input.clientId,
    unit_id: input.unitId,
    contract_date: input.date,
    status: input.status ?? 'active',
    notes: input.notes ?? null,
  }
  if (input.reservationId != null) body.reservation_id = input.reservationId
  if (input.totalPrice != null) body.total_price = input.totalPrice
  if (input.discount != null && input.discount > 0) {
    body.discount = input.discount
    body.discount_reason = input.discountReason || null
  }
  if (input.agreedDownPayment != null) body.agreed_down_payment = input.agreedDownPayment
  if (input.type === 'rent') {
    if (input.monthlyRent != null) body.monthly_rent = input.monthlyRent
    if (input.durationMonths != null) body.duration_months = input.durationMonths
    if (input.startDate) body.start_date = input.startDate
    if (input.endDate) body.end_date = input.endDate
    if (input.securityDeposit != null) body.security_deposit = input.securityDeposit
    if (input.advanceMonths != null) body.advance_months = input.advanceMonths
    if (input.annualIncreasePct != null) body.annual_increase_pct = input.annualIncreasePct
    if (input.increaseFromYear != null) body.increase_from_year = input.increaseFromYear
  }
  if (input.schedule) body.schedule = input.schedule
  return body
}

/** `GET /admin/contracts` — one page (server-side search, type filter, sort, pagination). */
export async function fetchContracts(
  params: {
    search?: string
    status?: string
    type?: 'sale' | 'rent'
    clientId?: number
    buildingId?: number
    page?: number
    sort?: string
    dir?: 'asc' | 'desc'
    perPage?: number
  } = {},
): Promise<ContractPage> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.status) query.set('status', params.status)
  if (params.type) query.set('type', params.type)
  if (params.clientId) query.set('client_id', String(params.clientId))
  if (params.buildingId) query.set('building_id', String(params.buildingId))
  if (params.page) query.set('page', String(params.page))
  if (params.sort) query.set('sort', params.sort)
  if (params.dir) query.set('dir', params.dir)
  if (params.perPage) query.set('per_page', String(params.perPage))

  const res = await request<ApiContract[]>(`/admin/contracts${query.size ? `?${query}` : ''}`)
  const items = res.data ?? []
  return {
    items,
    meta: res.meta ?? {
      current_page: 1,
      last_page: 1,
      per_page: items.length,
      total: items.length,
      from: items.length ? 1 : null,
      to: items.length ? items.length : null,
    },
  }
}

/** `GET /admin/contracts/{id}` — with the installments. */
export async function fetchContract(apiId: number): Promise<ApiContract> {
  const res = await request<ApiContract>(`/admin/contracts/${apiId}`)
  return res.data
}

/** `POST /admin/contracts` — `status: 'draft'` saves it without installments or unit changes. */
export async function createContract(input: ContractInput): Promise<ApiContract> {
  const res = await request<ApiContract>('/admin/contracts', {
    method: 'POST',
    body: JSON.stringify(contractBody(input)),
  })
  return res.data
}

/** `POST /admin/contracts/{id}/post` — turns a draft into an active contract and writes its schedule. */
export async function postContract(
  apiId: number,
  schedule?: ContractScheduleInput[],
): Promise<ApiContract> {
  const res = await request<ApiContract>(`/admin/contracts/${apiId}/post`, {
    method: 'POST',
    body: JSON.stringify(schedule ? { schedule } : {}),
  })
  return res.data
}

/** `POST /admin/contracts/{id}/cancel` — the reason is required; an active contract frees its unit. */
export async function cancelContract(apiId: number, reason: string): Promise<ApiContract> {
  const res = await request<ApiContract>(`/admin/contracts/${apiId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancellation_reason: reason }),
  })
  return res.data
}

/** API field name → form field, for mapping 422 errors back onto the contract form. */
export const API_CONTRACT_FIELD_TO_FORM: Record<string, string> = {
  type: 'type',
  reservation_id: 'reservationId',
  contract_date: 'date',
  total_price: 'unitPrice',
  discount: 'discount',
  discount_reason: 'discountReason',
  agreed_down_payment: 'downPayment',
  monthly_rent: 'monthlyRent',
  duration_months: 'durationMonths',
  start_date: 'startDate',
  security_deposit: 'securityDeposit',
  advance_months: 'advanceMonths',
  annual_increase_pct: 'annualIncreasePct',
  increase_from_year: 'increaseFromYear',
  schedule: 'schedule',
  notes: 'notes',
}

/** `GET /admin/units/{id}` — for the price hint on the contract form. */
export async function fetchUnit(apiId: number): Promise<ApiUnit> {
  const res = await request<ApiUnit>(`/admin/units/${apiId}`)
  return res.data
}

/** Every active contract (pages through `GET /admin/contracts?status=active`) — the receipts picker. */
export async function fetchActiveContracts(): Promise<ApiContract[]> {
  return fetchAllPages((page) => fetchContracts({ status: 'active', page, perPage: 100, sort: 'created_at', dir: 'desc' }))
}

/* ------------------------------------------------------------------
 * Receipts (إيصالات القبض)
 * ------------------------------------------------------------------ */

export const PAYMENT_METHOD_FROM_API: Record<string, string> = {
  cash: 'نقدي',
  bank_transfer: 'تحويل بنكي',
  cheque: 'شيك',
  vodafone_cash: 'فودافون كاش',
  instapay: 'إنستاباي',
  other: 'أخرى',
}

export const PAYMENT_METHOD_TO_API: Record<string, string> = {
  نقدي: 'cash',
  'تحويل بنكي': 'bank_transfer',
  شيك: 'cheque',
  'فودافون كاش': 'vodafone_cash',
  إنستاباي: 'instapay',
  أخرى: 'other',
}

/** The Arabic labels, in the API's order. */
export const PAYMENT_METHODS: string[] = Object.values(PAYMENT_METHOD_FROM_API)

/** One payment line of a receipt (`GET /admin/receipts`). */
export interface ApiReceiptInstallment {
  payment_id: number
  installment_id: number
  sequence_number: number | null
  due_date: string | null
  amount: string
  status: string | null
  cancel_reason: string | null
}

export interface ApiReceipt {
  id: number
  number: string
  contract_id: number
  contract_number?: string | null
  contract_type?: 'sale' | 'rent'
  contract_type_label?: string | null
  client_id?: number | null
  client_name?: string | null
  client_phone?: string | null
  unit_id?: number | null
  unit_name?: string | null
  unit_type_label?: string | null
  building_name?: string | null
  paid_at: string
  payment_method: string | null
  payment_method_label: string | null
  reference: string | null
  notes: string | null
  total_amount: string
  status: 'valid' | 'cancelled'
  status_label: string | null
  cancel_reason: string | null
  cancelled_at: string | null
  created_by_name?: string | null
  installments?: ApiReceiptInstallment[]
  down_payment?: { payment_id: number; amount: string; status: string | null; cancel_reason: string | null } | null
  created_at?: string
}

/** What the receipts page sends: one receipt covering several installments and/or the down payment. */
export interface ReceiptInput {
  contractId: number
  /** ISO `YYYY-MM-DD`. */
  paidAt: string
  /** API value (`cash`, `instapay`, …). */
  method?: string | null
  reference?: string
  notes?: string
  installments?: { installmentId: number; amount: number }[]
  /** Part of the contract's agreed down payment (مقدم / تأمين). */
  downPayment?: number | null
}

const receiptBody = (input: ReceiptInput): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    contract_id: input.contractId,
    paid_at: input.paidAt,
  }
  if (input.method) body.payment_method = input.method
  if (input.reference?.trim()) body.reference = input.reference.trim()
  if (input.notes?.trim()) body.notes = input.notes.trim()
  if (input.installments?.length) {
    body.installments = input.installments.map((line) => ({
      installment_id: line.installmentId,
      amount: line.amount,
    }))
  }
  if (input.downPayment != null && input.downPayment > 0) body.down_payment = input.downPayment
  return body
}

/** `GET /admin/receipts` — one page (server-side search, method/status/date filters, sort, paging). */
export async function fetchReceipts(
  params: {
    search?: string
    contractId?: number
    clientId?: number
    status?: 'valid' | 'cancelled'
    paymentMethod?: string
    from?: string
    to?: string
    page?: number
    sort?: string
    dir?: 'asc' | 'desc'
    perPage?: number
  } = {},
): Promise<{ items: ApiReceipt[]; meta: PageMeta }> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.contractId) query.set('contract_id', String(params.contractId))
  if (params.clientId) query.set('client_id', String(params.clientId))
  if (params.status) query.set('status', params.status)
  if (params.paymentMethod) query.set('payment_method', params.paymentMethod)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.page) query.set('page', String(params.page))
  if (params.sort) query.set('sort', params.sort)
  if (params.dir) query.set('dir', params.dir)
  if (params.perPage) query.set('per_page', String(params.perPage))

  const res = await request<ApiReceipt[]>(`/admin/receipts${query.size ? `?${query}` : ''}`)
  const items = res.data ?? []
  return {
    items,
    meta: res.meta ?? {
      current_page: 1,
      last_page: 1,
      per_page: items.length,
      total: items.length,
      from: items.length ? 1 : null,
      to: items.length ? items.length : null,
    },
  }
}

/** `GET /admin/receipts/{id}` — with its payment lines. */
export async function fetchReceipt(apiId: number): Promise<ApiReceipt> {
  const res = await request<ApiReceipt>(`/admin/receipts/${apiId}`)
  return res.data
}

/** `POST /admin/receipts` — creates one payment per line, all under one receipt number. */
export async function createReceipt(input: ReceiptInput): Promise<ApiReceipt> {
  const res = await request<ApiReceipt>('/admin/receipts', {
    method: 'POST',
    body: JSON.stringify(receiptBody(input)),
  })
  return res.data
}

/** `POST /admin/receipts/{id}/cancel` — cancels every payment the receipt created. */
export async function cancelReceipt(apiId: number, reason: string): Promise<ApiReceipt> {
  const res = await request<ApiReceipt>(`/admin/receipts/${apiId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancel_reason: reason }),
  })
  return res.data
}

/* ==================================================================
   Collection (الأقساط والإيجارات المستحقة) + notifications
   ================================================================== */

/** Display state recomputed by the API against today; `overdue` wins over `partially_paid`. */
export type CollectionStatus = 'due' | 'overdue' | 'partially_paid' | 'paid'

/** One row of `GET /admin/installments` or `GET /admin/down-payments`. */
export interface ApiCollectionRow {
  id: number
  kind: 'installment' | 'down_payment'
  contract_id: number
  contract_number: string
  contract_type: 'sale' | 'rent' | null
  client_id: number | null
  client_name: string | null
  unit_id: number | null
  unit_name: string | null
  building_name: string | null
  /** 0 for a down payment. */
  sequence_number: number
  due_date: string
  amount: string
  paid_amount: string
  remaining: string
  status: CollectionStatus
  status_label: string
  is_overdue: boolean
  days_overdue: number
}

export interface CollectionMeta {
  current_page: number
  last_page: number
  per_page: number
  total: number
  from: number | null
  to: number | null
  counts: { all: number; due: number; overdue: number; partially_paid: number; paid: number }
  /** Counted before the `type` filter, like the contracts page. */
  type_counts: { all: number; sale: number; rent: number }
  totals: { amount: string; paid: string; remaining: string; overdue: string }
}

export const EMPTY_COLLECTION_META: CollectionMeta = {
  current_page: 1,
  last_page: 1,
  per_page: 15,
  total: 0,
  from: null,
  to: null,
  counts: { all: 0, due: 0, overdue: 0, partially_paid: 0, paid: 0 },
  type_counts: { all: 0, sale: 0, rent: 0 },
  totals: { amount: '0', paid: '0', remaining: '0', overdue: '0' },
}

export interface ApiCalendarDay {
  date: string
  total: number
  overdue: number
  due: number
  paid: number
}

export interface ApiCollectionCalendar {
  kind: 'installment' | 'down_payment'
  month: string
  days: ApiCalendarDay[]
}

type CollectionKind = 'installments' | 'down-payments'

/**
 * `GET /admin/installments` / `GET /admin/down-payments` — one page with server-side search, type,
 * status, single-day and date-range filters, sort, paging, plus the chip counts and money totals.
 */
export async function fetchCollections(
  kind: CollectionKind,
  params: {
    search?: string
    type?: 'sale' | 'rent'
    status?: CollectionStatus
    dueOn?: string
    from?: string
    to?: string
    page?: number
    sort?: string
    dir?: 'asc' | 'desc'
    perPage?: number
  } = {},
): Promise<{ items: ApiCollectionRow[]; meta: CollectionMeta }> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.type) query.set('type', params.type)
  if (params.status) query.set('status', params.status)
  if (params.dueOn) query.set('due_on', params.dueOn)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.page) query.set('page', String(params.page))
  if (params.sort) query.set('sort', params.sort)
  if (params.dir) query.set('dir', params.dir)
  if (params.perPage) query.set('per_page', String(params.perPage))

  const res = await request<ApiCollectionRow[], CollectionMeta>(`/admin/${kind}${query.size ? `?${query}` : ''}`)
  const items = res.data ?? []
  return {
    items,
    meta: res.meta ?? {
      ...EMPTY_COLLECTION_META,
      total: items.length,
      from: items.length ? 1 : null,
      to: items.length ? items.length : null,
    },
  }
}

/** `GET /admin/installments/calendar` / `GET /admin/down-payments/calendar` — per-day rollup. */
export async function fetchCollectionCalendar(
  kind: CollectionKind,
  params: { month: string; type?: 'sale' | 'rent' },
): Promise<ApiCollectionCalendar> {
  const query = new URLSearchParams({ month: params.month.slice(0, 7) })
  if (params.type) query.set('type', params.type)
  const res = await request<ApiCollectionCalendar>(`/admin/${kind}/calendar?${query}`)
  return res.data
}

export interface ApiNotificationItem {
  key: string
  installment_id: number
  contract_id: number
  contract_number: string
  contract_type: 'sale' | 'rent' | null
  client_id: number | null
  client_name: string | null
  unit_name: string | null
  building_name: string | null
  sequence_number: number
  due_date: string
  amount: string
  paid_amount: string
  remaining: string
  is_overdue: boolean
  days_overdue: number
}

export interface ApiNotificationGroup {
  id: 'overdue' | 'due-today'
  label: string
  tone: 'danger' | 'warning' | 'primary'
  screen: string
  total: number
  items: ApiNotificationItem[]
}

/** `GET /admin/notifications` — overdue installments/rents and the ones due today. */
export async function fetchNotifications(): Promise<{ groups: ApiNotificationGroup[]; total: number }> {
  const res = await request<ApiNotificationGroup[], { total: number }>('/admin/notifications')
  const groups = res.data ?? []
  return { groups, total: res.meta?.total ?? groups.reduce((sum, group) => sum + group.total, 0) }
}

/* ==================================================================
   «ملخص الأقساط والعقود» (contract + schedule summary report)
   ================================================================== */

/** A schedule row as the report prints it: its number and due date only. */
export interface ApiInstallmentRef {
  sequence_number: number
  due_date: string
}

/** One contract of `GET /admin/reports/installments-summary`. */
export interface ApiInstallmentsSummaryRow {
  id: number
  number: string
  type: 'sale' | 'rent'
  status: 'active' | 'cancelled'
  status_label: string
  client_id: number | null
  client_name: string | null
  building_id: number | null
  building_name: string | null
  unit_name: string | null
  contract_date: string | null
  /** Sale only; 0 for a lease. */
  unit_price: number
  monthly_rent: number
  security_deposit: number
  start_date: string | null
  end_date: string | null
  down_payment: number
  down_payment_remaining: number
  deposit_remaining: number
  /** Sale: down payment left; lease: deposit left. */
  upfront_remaining: number
  total_installments: number
  paid_installments: number
  installments_total: number
  installments_paid: number
  installments_remaining: number
  /** Sale: the agreed price; lease: the whole schedule. */
  contract_value: number
  total_paid: number
  total_remaining: number
  current_installment_remaining: number
  last_paid_installment: ApiInstallmentRef | null
  next_due_installment: ApiInstallmentRef | null
}

export interface InstallmentsSummaryCounts {
  all: number
  sale: number
  rent: number
}

/**
 * `GET /admin/reports/installments-summary` — every non-draft contract with its schedule rollup.
 * Drafts are never listed; counts describe both types before the `type` filter.
 */
export async function fetchInstallmentsSummary(params: {
  type?: 'sale' | 'rent'
  buildingId?: string
  clientId?: string
  status?: 'active' | 'cancelled'
} = {}): Promise<{ rows: ApiInstallmentsSummaryRow[]; counts: InstallmentsSummaryCounts }> {
  const query = new URLSearchParams()
  if (params.type) query.set('type', params.type)
  if (params.buildingId) query.set('building_id', params.buildingId)
  if (params.clientId) query.set('client_id', params.clientId)
  if (params.status) query.set('status', params.status)

  const res = await request<ApiInstallmentsSummaryRow[], { total: number; counts: InstallmentsSummaryCounts }>(
    `/admin/reports/installments-summary${query.size ? `?${query}` : ''}`,
  )
  const rows = res.data ?? []
  return {
    rows,
    counts: res.meta?.counts ?? { all: rows.length, sale: rows.filter((r) => r.type === 'sale').length, rent: rows.filter((r) => r.type === 'rent').length },
  }
}

/* ==================================================================
   «الأقساط المستحقة والمتأخرة» (aging / due & overdue report)
   ================================================================== */

/** Delay buckets the report groups rows into; `all` is the whole scope. */
export type DueOverdueBucket = '0-30' | '31-60' | '61-90' | '90+'

/** One late installment of `GET /admin/reports/due-overdue`. */
export interface ApiDueOverdueRow {
  id: number
  contract_id: number
  contract_number: string
  contract_type: 'sale' | 'rent' | null
  client_id: number | null
  client_name: string | null
  unit_name: string | null
  building_name: string | null
  sequence_number: number
  due_date: string
  amount: number
  paid_amount: number
  remaining: number
  /** Days past the due date; 0 means it falls due today. */
  days_overdue: number
  bucket: DueOverdueBucket
}

export interface DueOverdueRollup {
  count: number
  total: number
}

export interface DueOverdueMeta {
  /** Rows returned (after the bucket filter). */
  total: number
  /** Counted over the whole scope, so a chip never rewrites its own numbers. */
  buckets: Record<'all' | DueOverdueBucket, DueOverdueRollup>
  /** Not part of the aging table: what falls due in the next 7 days. */
  due_within_7_days: DueOverdueRollup
}

export const EMPTY_DUE_OVERDUE_META: DueOverdueMeta = {
  total: 0,
  buckets: {
    all: { count: 0, total: 0 },
    '0-30': { count: 0, total: 0 },
    '31-60': { count: 0, total: 0 },
    '61-90': { count: 0, total: 0 },
    '90+': { count: 0, total: 0 },
  },
  due_within_7_days: { count: 0, total: 0 },
}

/**
 * `GET /admin/reports/due-overdue` — unpaid installments of active contracts that are due today or
 * already late. Every row is returned (the report is searched/sorted/exported client-side).
 */
export async function fetchDueOverdueReport(params: {
  type?: 'sale' | 'rent'
  buildingId?: string
  clientId?: string
  bucket?: DueOverdueBucket
} = {}): Promise<{ rows: ApiDueOverdueRow[]; meta: DueOverdueMeta }> {
  const query = new URLSearchParams()
  if (params.type) query.set('type', params.type)
  if (params.buildingId) query.set('building_id', params.buildingId)
  if (params.clientId) query.set('client_id', params.clientId)
  if (params.bucket) query.set('bucket', params.bucket)

  const res = await request<ApiDueOverdueRow[], DueOverdueMeta>(`/admin/reports/due-overdue${query.size ? `?${query}` : ''}`)
  const rows = res.data ?? []
  return { rows, meta: res.meta ?? EMPTY_DUE_OVERDUE_META }
}

/* ==================================================================
   «كشف حساب عميل» (customer statement)
   ================================================================== */

export interface ApiCustomerStatementClient {
  id: number
  name: string
  phone: string | null
}

export interface ApiCustomerStatementReservation {
  id: number
  reservation_date: string | null
  building: string | null
  unit: string | null
  unit_type: string | null
  unit_activity: string | null
  deposit_paid: string
  status: 'active' | 'converted' | 'cancelled' | null
  is_cancelled: boolean
}

export interface ApiCustomerStatementInstallment {
  id: number
  sequence_number: number
  due_date: string | null
  amount: string
  paid_amount: string
  remaining: string
  status: string | null
  is_overdue: boolean
}

export interface ApiCustomerStatementContract {
  id: number
  number: string
  type: 'sale' | 'rent' | null
  contract_date: string | null
  unit: string | null
  total_price: string
  agreed_down_payment: string
  down_payment_paid: string
  down_payment_remaining: string
  total_collected: string
  total_remaining: string
  status: 'draft' | 'active' | 'cancelled' | null
  is_cancelled: boolean
  installments: ApiCustomerStatementInstallment[]
  installment_totals: {
    required: string
    paid: string
    remaining: string
    overdue: string
  }
}

export interface ApiCustomerStatementPayment {
  id: number
  paid_at: string | null
  /** A reservation (no contract yet), the contract's down payment, or one installment. */
  payment_type: 'reservation' | 'down_payment' | 'installment'
  entity_id: number | null
  amount: string
  payment_method: string | null
  status: 'valid' | 'cancelled' | null
  client_name: string | null
  /** Null for a reservation payment: the contract is created on conversion. */
  contract_id: number | null
  contract_number: string | null
  cancel_reason?: string | null
  is_cancelled?: boolean
}

export interface ApiCustomerStatement {
  client: ApiCustomerStatementClient
  period: { from: string; to: string }
  reservations: ApiCustomerStatementReservation[]
  contracts: ApiCustomerStatementContract[]
  payments: ApiCustomerStatementPayment[]
  totals: {
    required: string
    paid: string
    remaining: string
    overdue: string
    cancelled_payments: string
  }
  reservation_totals: { paid: string }
  contract_totals: { value: string; down_payment_agreed: string; paid: string; remaining: string }
}

/**
 * The statement keeps a running balance, so the screen asks for the client's whole history and
 * filters the period locally; asking the API for a period would start every balance from zero.
 */
export const STATEMENT_ALL_TIME_FROM = '1900-01-01'
export const STATEMENT_ALL_TIME_TO = '2100-12-31'

/** `GET /admin/reports/customer-statement` — one client: contracts, schedules, payments, totals. */
export async function fetchCustomerStatement(params: { clientId: string; from: string; to: string }): Promise<ApiCustomerStatement> {
  const query = new URLSearchParams({ client_id: params.clientId, from_date: params.from, to_date: params.to })
  const res = await request<ApiCustomerStatement>(`/admin/reports/customer-statement?${query}`)
  return res.data
}

/* ------------------------------------------------------------------ *
 * Building & unit statements («كشف عقار» / «كشف وحدة»)
 * ------------------------------------------------------------------ */

/** A unit of the building statement; `is_sellable` false means «غير قابلة للبيع» while available. */
export interface ApiStatementUnit {
  id: number
  name: string
  type: string
  type_label: string | null
  status: string
  status_label: string | null
  is_sellable: boolean
  purpose: string | null
  floor: number
  floor_display_name: string | null
  area: number
  rooms: number | null
  bathrooms: number | null
  total_price: number
}

/** One floor's money rollup: only active contracts, collected = the period's payments. */
export interface ApiStatementFloor {
  floor: number
  floor_display_name: string | null
  units: number
  sales: number
  remaining: number
  due: number
  monthly_rent: number
  overdue: number
  collected: number
}

/** A contract row as the building statement lists it (drafts never appear). */
export interface ApiBuildingStatementContract {
  id: number
  number: string
  type: 'sale' | 'rent'
  type_label: string | null
  status: string
  status_label: string | null
  contract_date: string | null
  unit_id: number | null
  unit_name: string | null
  unit_floor: number | null
  unit_floor_display_name: string | null
  client_id: number | null
  client_name: string | null
  client_phone: string | null
  monthly_rent: number
  security_deposit: number
  start_date: string | null
  end_date: string | null
  value: number
  paid: number
  remaining: number
  overdue: number
  due: number
  installments_total: number
  installments_paid: number
  installments_remaining: number
  down_payment: number
  down_payment_paid: number
  down_payment_remaining: number
  installments_count: number
  paid_installments: number
  is_active: boolean
}

export interface ApiStatementReservation {
  id: number
  client_id: number | null
  client_name: string | null
  client_phone: string | null
  unit_id: number | null
  unit_name: string | null
  reservation_date: string | null
  status: string | null
  status_label: string | null
  deposit_paid: number
  /** A building-level reservation has no unit and belongs to the building alone. */
  is_building_level: boolean
  /** Only on the unit statement's rows. */
  cancelled_at?: string | null
  cancellation_reason?: string | null
}

export interface ApiStatementTotals {
  sales: number
  remaining: number
  due: number
  monthly_rent: number
  overdue: number
  collected: number
  cancelled: number
  contracts: number
  active_contracts: number
}

export interface ApiBuildingStatement {
  building: {
    id: number
    name: string
    number: string | null
    city: string | null
    district: string | null
    floors_count: number
    units_count: number
  }
  period: { from: string; to: string }
  counts: { total: number; available: number; reserved: number; sold: number; rented: number; closed: number }
  units: ApiStatementUnit[]
  floors: ApiStatementFloor[]
  contracts: ApiBuildingStatementContract[]
  reservations: ApiStatementReservation[]
  totals: ApiStatementTotals
}

export interface ApiStatementInstallment {
  id: number
  sequence_number: number
  due_date: string | null
  amount: number
  paid_amount: number
  remaining: number
  status: string | null
  is_cancelled: boolean
  is_overdue: boolean
  /** The day it was last collected (cancelled receipts do not count). */
  paid_at: string | null
}

export interface ApiUnitStatementContract {
  id: number
  number: string
  type: 'sale' | 'rent'
  type_label: string | null
  status: string
  status_label: string | null
  is_active: boolean
  is_cancelled: boolean
  contract_date: string | null
  client_id: number | null
  client_name: string | null
  client_phone: string | null
  reservation_id: number | null
  unit_price: number
  discount: number
  down_payment: number
  down_payment_paid: number
  down_payment_remaining: number
  monthly_rent: number
  security_deposit: number
  duration_months: number | null
  start_date: string | null
  end_date: string | null
  value: number
  paid: number
  remaining: number
  overdue: number
  due: number
  installments_total: number
  installments_paid: number
  installments_remaining: number
  installments_count: number
  paid_installments: number
  installments: ApiStatementInstallment[]
}

export interface ApiUnitStatement {
  unit: {
    id: number
    name: string
    type: string
    type_label: string | null
    status: string
    status_label: string | null
    is_sellable: boolean
    non_sellable_reason: string | null
    purpose: string | null
    purpose_label: string | null
    area: number
    price_per_meter: number | null
    sale_price: number | null
    total_price: number | null
    rooms: number | null
    bathrooms: number | null
    floor: number | null
    floor_display_name: string | null
    building_id: number
    building_name: string | null
    building_city: string | null
    building_district: string | null
  }
  period: { from: string; to: string }
  client: { id: number; name: string; phone: string | null; phone_2: string | null; national_id: string | null } | null
  current_contract: ApiUnitStatementContract | null
  current_reservation: ApiStatementReservation | null
  reservations: ApiStatementReservation[]
  contracts: ApiUnitStatementContract[]
  totals: {
    sales: number
    paid: number
    remaining: number
    due: number
    overdue: number
    monthly_rent: number
    deposit_paid: number
  }
}

/** `GET /admin/units` — every unit of one building (for the unit statement's figure). */
export async function fetchAllUnits(buildingId: number): Promise<ApiUnit[]> {
  return fetchAllPages((page) => fetchUnits({ page, perPage: 100, buildingId }))
}

/**
 * `GET /admin/reports/building-statement` — one building. The screen has no period of its own, so
 * it asks for the whole history and lets the server roll the money up.
 */
export async function fetchBuildingStatement(buildingId: string): Promise<ApiBuildingStatement> {
  const query = new URLSearchParams({
    building_id: buildingId,
    from_date: STATEMENT_ALL_TIME_FROM,
    to_date: STATEMENT_ALL_TIME_TO,
  })
  const res = await request<ApiBuildingStatement>(`/admin/reports/building-statement?${query}`)
  return res.data
}

/** `GET /admin/reports/unit-statement` — one unit: history, current contract schedule, totals. */
export async function fetchUnitStatement(unitId: string): Promise<ApiUnitStatement> {
  const query = new URLSearchParams({
    unit_id: unitId,
    from_date: STATEMENT_ALL_TIME_FROM,
    to_date: STATEMENT_ALL_TIME_TO,
  })
  const res = await request<ApiUnitStatement>(`/admin/reports/unit-statement?${query}`)
  return res.data
}

/* ==================================================================
   «الإيرادات الشهرية» + «التحصيل اليومي» (collected money)
   ================================================================== */

/** One month of `GET /admin/reports/monthly-revenue`; money is what was collected, not contract values. */
export interface ApiMonthlyRevenueMonth {
  /** `YYYY-MM`. */
  month: string
  /** Payment lines of the month. */
  payments: number
  /** Distinct receipt numbers; a deposit or a directly recorded payment has none. */
  receipts: number
  reservations: number
  down_payments: number
  installments: number
  total: number
  /** Cancelled lines, keyed by their cancellation month. Never part of `total`. */
  cancelled: number
  /** Restarts at the report period. */
  cumulative: number
}

export interface ApiMonthlyRevenue {
  period: { from: string; to: string }
  months: ApiMonthlyRevenueMonth[]
  totals: {
    payments: number
    receipts: number
    reservations: number
    down_payments: number
    installments: number
    total: number
    cancelled: number
  }
}

/** How a collected line is called: a reservation deposit, a contract down payment / deposit, or a schedule row. */
export type ApiPaymentKind = 'reservation' | 'down_payment' | 'installment'

export interface ApiCollectionPayment {
  id: number
  payment_type: ApiPaymentKind
  paid_at: string | null
  amount: number
  method: string
  /** Null for a reservation deposit or a payment recorded straight on an installment. */
  receipt_number: string | null
  contract_id: number | null
  contract_number: string | null
  contract_type: 'sale' | 'rent' | null
  sequence_number: number | null
  client_id: number | null
  client_name: string | null
  unit_name: string | null
  building_id: number | null
  building_name: string | null
}

export interface ApiCancelledCollectionPayment {
  id: number
  payment_type: ApiPaymentKind
  paid_at: string | null
  cancelled_at: string | null
  amount: number
  method: string
  receipt_number: string | null
  contract_number: string | null
  contract_type: 'sale' | 'rent' | null
  sequence_number: number | null
  client_name: string | null
  unit_name: string | null
  cancel_reason: string | null
}

export interface ApiCollectionRollup {
  amount: number
  lines: number
}

export interface ApiDailyCollection {
  period: { from: string; to: string }
  summary: {
    collected: number
    cancelled: number
    net: number
    lines: number
    /** Distinct receipt numbers; lines recorded without a receipt are not counted here. */
    receipts: number
    days: number
  }
  by_type: (ApiCollectionRollup & { type: ApiPaymentKind })[]
  /** Present methods only. */
  by_method: (ApiCollectionRollup & { method: string })[]
  by_day: (ApiCollectionRollup & { date: string })[]
  payments: ApiCollectionPayment[]
  cancelled_payments: ApiCancelledCollectionPayment[]
}

/** `GET /admin/reports/monthly-revenue` — money collected per month within the period. */
export async function fetchMonthlyRevenue(params: { from: string; to: string; buildingId?: string }): Promise<ApiMonthlyRevenue> {
  const query = new URLSearchParams({ from_date: params.from, to_date: params.to })
  if (params.buildingId) query.set('building_id', params.buildingId)
  const res = await request<ApiMonthlyRevenue>(`/admin/reports/monthly-revenue?${query}`)
  return res.data
}

/** `GET /admin/reports/daily-collection` — every payment line of the period, with its rollups. */
export async function fetchDailyCollection(params: { from: string; to: string; buildingId?: string }): Promise<ApiDailyCollection> {
  const query = new URLSearchParams({ from_date: params.from, to_date: params.to })
  if (params.buildingId) query.set('building_id', params.buildingId)
  const res = await request<ApiDailyCollection>(`/admin/reports/daily-collection?${query}`)
  return res.data
}

/* ==================================================================
   «حالة الوحدات» (unit status report)
   ================================================================== */

/** The five state buckets the report groups units into; `closed` = available but unsellable. */
export type ApiUnitState = 'available' | 'reserved' | 'sold' | 'rented' | 'closed'

export interface ApiUnitStatusCounts {
  total: number
  available: number
  reserved: number
  sold: number
  rented: number
  closed: number
}

/** One unit of `GET /admin/reports/unit-status`. */
export interface ApiUnitStatusRow {
  id: number
  name: string
  building_id: number
  building_name: string | null
  floor: number | null
  floor_display_name: string | null
  type: string
  type_label: string | null
  purpose: string | null
  purpose_label: string | null
  area: number
  rooms: number | null
  bathrooms: number | null
  price_per_meter: number | null
  /** Listed price, or the contract's net price once the unit is sold; null for rent-only units. */
  sale_price: number | null
  status: string
  status_label: string | null
  is_sellable: boolean
  non_sellable_reason: string | null
  /** Available but «غير قابلة للبيع». */
  is_closed: boolean
  client_id: number | null
  client_name: string | null
  contract_id: number | null
  contract_number: string | null
  contract_type: 'sale' | 'rent' | null
  /** Live lease only. */
  monthly_rent: number | null
  contract_end_date: string | null
  reservation_date: string | null
  deposit_paid: number
}

export interface ApiUnitStatusBuilding extends ApiUnitStatusCounts {
  id: number
  name: string | null
  number: string | null
  area: number
  sale_value: number
  monthly_rent: number
}

export interface ApiUnitStatus {
  filters: { building_id?: number; floor_id?: number; type?: string; purpose?: string }
  counts: ApiUnitStatusCounts
  totals: { units: number; area: number; sale_area: number; sale_value: number; monthly_rent: number }
  by_building: ApiUnitStatusBuilding[]
  units: ApiUnitStatusRow[]
}

/** `GET /admin/reports/unit-status` — every unit with its state, grouped per state and per building. */
export async function fetchUnitStatus(params: { buildingId?: string; type?: string; purpose?: string } = {}): Promise<ApiUnitStatus> {
  const query = new URLSearchParams()
  if (params.buildingId) query.set('building_id', params.buildingId)
  if (params.type) query.set('type', params.type)
  if (params.purpose) query.set('purpose', params.purpose)
  const res = await request<ApiUnitStatus>(`/admin/reports/unit-status${query.size ? `?${query}` : ''}`)
  return res.data
}
