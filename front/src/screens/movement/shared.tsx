import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { CLIENT_TYPES, newId, storageKey, useData, type Client, type ClientType, type ContractType, type Unit } from '@/lib'
import { Btn, Combobox, IconBuilding, IconPlus, IconUsers, Modal, Select, TextInput, useField, useToast } from '@/kit'
import { type BadgeTone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useShortcutAction } from '@/kit/shortcuts'

export type Errors<K extends string> = Partial<Record<K, string>>

export const fmtNum = (n: number) => n.toLocaleString('ar-EG')
export const fmtMoney = (n: number) => `${n.toLocaleString('ar-EG')} ج.م`

/** Record code shown in tables, e.g. `b-07` → `B-07`. */
export const codeOf = (id: string) => id.toUpperCase()

/** `-1` → البدروم, `0` → الأرضي, `3` → الدور 3 */
export const floorLabel = (floor: number) => (floor < 0 ? 'البدروم' : floor === 0 ? 'الأرضي' : `الدور ${fmtNum(floor)}`)

export const REQUIRED = 'هذا الحقل مطلوب'

export const CLIENT_TONE: Record<ClientType, BadgeTone> = { مشتري: 'indigo', مستأجر: 'sky', مالك: 'yellow' }
export const CONTRACT_TYPE_TONE: Record<ContractType, BadgeTone> = { بيع: 'indigo', إيجار: 'sky' }
/** `عقد بيع` / `عقد إيجار` */
export const contractTypeLabel = (type: ContractType) => `عقد ${type}`
export const PHONE_RE = /^01\d[-\s]?\d{8}$/
export const NATIONAL_ID_RE = /^[23]\d{13}$/

/**
 * Phone and national id are optional on a client (empty = unknown) but must be valid when given;
 * national ids are unique across clients.
 */
export function contactErrors(
  f: { phone: string; phone2?: string; nationalId: string },
  clients: readonly Client[],
  selfId?: string,
): Errors<'phone' | 'phone2' | 'nationalId'> {
  const e: Errors<'phone' | 'phone2' | 'nationalId'> = {}
  const phone = f.phone.trim()
  const phone2 = f.phone2?.trim() ?? ''
  const nationalId = f.nationalId.trim()
  if (phone && !PHONE_RE.test(phone)) e.phone = 'رقم الهاتف غير صحيح (01x-xxxxxxxx)'
  if (phone2 && !PHONE_RE.test(phone2)) e.phone2 = 'رقم الهاتف غير صحيح (01x-xxxxxxxx)'
  if (nationalId && !NATIONAL_ID_RE.test(nationalId)) e.nationalId = 'رقم الهوية 14 رقمًا ويبدأ بـ 2 أو 3'
  else if (nationalId && clients.some((c) => c.nationalId === nationalId && c.id !== selfId))
    e.nationalId = 'يوجد عميل بنفس رقم الهوية'
  return e
}

/** Return details (date, reason, fee, refund) kept per returned contract; the model has no fields for them. */
export const RETURNS_KEY = storageKey('returns')

/**
 * Ctrl/⌘+N and the header's primary button open this screen's new-record form (dispatched by the
 * shell's global shortcut handler).
 */
export function useNewShortcut(onNew: () => void) {
  useShortcutAction('new', onNew)
}

/** Horizontal shake on the referenced element; call when validation fails. */
export function useShake<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const shake = useCallback(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    el.animate(
      [0, -10, 10, -8, 8, -4, 4, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 420, easing: 'ease-in-out' },
    )
    // Focus the first invalid control once React has rendered the error state.
    requestAnimationFrame(() => el.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
  }, [])
  return [ref, shake] as const
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="t-label col-span-full mt-2 border-b border-hairline pb-2 text-fg">{children}</h3>
}

/** Installment handed from «تسجيل دفع» (الأقساط المستحقة) to the receipts form; read once. */
export const RECEIPT_PREFILL_KEY = 'receipts:prefill'

/** Reservation handed from «تحويل لعقد» to the contract form; read once. */
export const CONTRACT_PREFILL_KEY = 'contracts:prefill'
export type ContractPrefill = { reservationId: string }

/** Contract handed from the details page to the returns screen («إرجاع» / «إنهاء»); read once. */
export const RETURN_PREFILL_KEY = 'returns:prefill'

export function takeReturnPrefill(): string | null {
  try {
    const raw = sessionStorage.getItem(RETURN_PREFILL_KEY)
    sessionStorage.removeItem(RETURN_PREFILL_KEY)
    const parsed = raw ? (JSON.parse(raw) as { contractId?: string }) : null
    return typeof parsed?.contractId === 'string' ? parsed.contractId : null
  } catch {
    return null
  }
}

/** Opens the receipts screen with a contract (and optionally one installment) selected. */
export function goToReceipt(contractId: string, installmentId?: string) {
  sessionStorage.setItem(RECEIPT_PREFILL_KEY, JSON.stringify({ contractId, installmentId }))
  location.hash = '#/receipts'
}

/** Reads and clears the reservation handed over by «تحويل لعقد». */
export function takeContractPrefill(): string | null {
  try {
    const raw = sessionStorage.getItem(CONTRACT_PREFILL_KEY)
    sessionStorage.removeItem(CONTRACT_PREFILL_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<ContractPrefill>) : null
    return typeof parsed?.reservationId === 'string' ? parsed.reservationId : null
  } catch {
    return null
  }
}

/** Read-only project name chip for forms and the header; `غير محدد` until one is configured. */
export function ProjectBadge({ className }: { className?: string }) {
  const { settings } = useData()
  const name = settings.projectName.trim()
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline bg-neutral-soft px-2.5 py-1 text-[12px] font-semibold text-fg-2',
        className,
      )}
    >
      <IconBuilding size={14} aria-hidden="true" className="shrink-0 text-fg-3" />
      <span className="shrink-0 text-fg-3">المشروع:</span>
      <span className={cn('min-w-0 truncate', name ? 'text-fg' : 'font-normal text-fg-3')}>{name || 'غير محدد'}</span>
    </span>
  )
}

/**
 * Client combobox with an inline «جديد» button. `types` limits the list (e.g. owners only);
 * `newType` presets the quick-add type. Clients of `preferType` are listed first.
 */
export function ClientPicker({
  label = 'العميل',
  value,
  onChange,
  error,
  required,
  types,
  preferType,
  newType = 'مشتري',
  lockType = false,
  exclude,
  containerClassName,
  disabled,
  typeFilter = false,
  compact = false,
}: {
  label?: string
  value: string | null
  onChange: (id: string | null) => void
  error?: string
  required?: boolean
  types?: readonly ClientType[]
  preferType?: ClientType
  newType?: ClientType
  lockType?: boolean
  exclude?: readonly string[]
  containerClassName?: string
  disabled?: boolean
  /** Shows الكل | مشتري | مستأجر | مالك chips above the list, starting on `preferType`. */
  typeFilter?: boolean
  /** Hides phone and national id from the list and the quick-add dialog. */
  compact?: boolean
}) {
  const { clients } = useData()
  const [adding, setAdding] = useState(false)
  const initial: TypeFilter = typeFilter ? (preferType ?? 'الكل') : 'الكل'
  const [chip, setChip] = useState<TypeFilter>(initial)
  const [lastInitial, setLastInitial] = useState(initial)
  if (lastInitial !== initial) {
    // The default follows the contract/reservation type; reset it when that changes.
    setLastInitial(initial)
    setChip(initial)
  }
  const options = useMemo(
    () =>
      clients
        .filter(
          (c) =>
            (!types || types.includes(c.type)) &&
            (c.id === value || ((chip === 'الكل' || c.type === chip) && !exclude?.includes(c.id))),
        )
        .sort((a, b) => Number(b.type === preferType) - Number(a.type === preferType))
        .map((c) => ({
          value: c.id,
          label: c.fullName,
          description: (compact ? [c.type] : [c.type, c.phone, c.nationalId]).filter(Boolean).join(' · '),
          keywords: [c.phone, c.phone2, c.nationalId, codeOf(c.id)].filter(Boolean).join(' '),
        })),
    [clients, types, preferType, exclude, value, chip, compact],
  )
  return (
    <div className={cn('grid gap-2', containerClassName)}>
      {typeFilter && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-caption">نوع العميل</span>
          <Segmented size="sm" label="تصفية العملاء حسب النوع" options={['الكل', ...CLIENT_TYPES] as TypeFilter[]} value={chip} onChange={setChip} />
        </div>
      )}
      <div className="flex items-start gap-2">
        <Combobox
          containerClassName="min-w-0 flex-1"
          label={label}
          required={required}
          placeholder={compact ? 'ابحث بالاسم…' : 'ابحث بالاسم أو الهاتف أو رقم الهوية…'}
          options={options}
          value={value}
          error={error}
          clearable
          disabled={disabled}
          emptyText="لا يوجد عميل مطابق — أضفه بزر «عميل جديد»"
          onChange={(v) => onChange(v)}
        />
        {!disabled && (
          <Btn variant="glass" className="mt-[26px] shrink-0" iconStart={<IconPlus size={16} />} onClick={() => setAdding(true)}>
            عميل جديد
          </Btn>
        )}
      </div>
      <ClientQuickAdd
        open={adding}
        type={newType}
        lockType={lockType}
        compact={compact}
        onClose={() => setAdding(false)}
        onCreated={(c) => {
          setAdding(false)
          onChange(c.id)
        }}
      />
    </div>
  )
}

type TypeFilter = 'الكل' | ClientType

/** Single-choice pill group (radio semantics). */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  disabled,
}: {
  options: readonly V[]
  value: V
  onChange: (v: V) => void
  label: string
  size?: 'sm' | 'md'
  disabled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-full border border-hairline bg-neutral-soft p-0.5', disabled && 'opacity-60')}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          disabled={disabled}
          onClick={() => onChange(o)}
          className={cn(
            'rounded-full font-semibold transition',
            size === 'sm' ? 'px-3 py-1 text-[13px]' : 'px-5 py-1.5 text-sm',
            value === o ? 'bg-primary text-white shadow-raised' : 'text-fg-2 hover:text-fg',
          )}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

/**
 * Screen-local records persisted in localStorage, for data the shared DataCtx model can't hold yet
 * (it has no action for them). Keyed by `key`; survives reloads.
 */
export function usePersistentList<T extends { id: string }>(key: string) {
  const [items, setItems] = useState<T[]>(() => {
    try {
      const raw = localStorage.getItem(key)
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
      return []
    }
  })
  const save = useCallback(
    (next: T[]) => {
      setItems(next)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // storage full/disabled: keep in memory
      }
    },
    [key],
  )
  const upsert = useCallback((item: T) => save([...items.filter((x) => x.id !== item.id), item]), [items, save])
  const remove = useCallback((id: string) => save(items.filter((x) => x.id !== id)), [items, save])
  return { items, upsert, remove }
}

/* ==================================================================
   Client quick-add
   ================================================================== */

type QuickClient = { fullName: string; type: ClientType; phone: string; nationalId: string; address: string }
const emptyQuickClient = (type: ClientType): QuickClient => ({ fullName: '', type, phone: '', nationalId: '', address: '' })

/**
 * Adds a client without leaving the current form and hands it back selected. `type` presets the
 * client type; `lockType` keeps it fixed (e.g. owners picked on a building).
 */
export function ClientQuickAdd({
  open,
  onClose,
  onCreated,
  type = 'مشتري',
  lockType = false,
  compact = false,
}: {
  open: boolean
  onClose: () => void
  onCreated: (client: Client) => void
  type?: ClientType
  lockType?: boolean
  compact?: boolean
}) {
  const { clients, dispatch } = useData()
  const toast = useToast()
  const [f, setF] = useState<QuickClient>(() => emptyQuickClient(type))
  const [err, setErr] = useState<Errors<keyof QuickClient>>({})
  const [ref, shake] = useShake<HTMLFormElement>()
  const [lastOpen, setLastOpen] = useState(false)
  if (open !== lastOpen) {
    // Start clean, with the requested type, every time the dialog opens.
    setLastOpen(open)
    if (open) {
      setF(emptyQuickClient(type))
      setErr({})
    }
  }

  const set = <K extends keyof QuickClient>(k: K, v: QuickClient[K]) => {
    setF((x) => ({ ...x, [k]: v }))
    setErr((e) => ({ ...e, [k]: undefined }))
  }

  const save = () => {
    const e: Errors<keyof QuickClient> = { ...contactErrors(f, clients) }
    if (!f.fullName.trim()) e.fullName = REQUIRED
    setErr(e)
    if (Object.values(e).some(Boolean)) return shake()
    const client: Client = {
      id: newId('clients', clients),
      fullName: f.fullName.trim(),
      type: f.type,
      phone: f.phone.trim(),
      phone2: '',
      nationalId: f.nationalId.trim(),
      address: f.address.trim(),
      notes: '',
    }
    dispatch({ type: 'ADD_CLIENT', payload: client })
    toast.success('تمت إضافة العميل', `${client.fullName} — ${client.type}`)
    onCreated(client)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<IconUsers size={20} />}
      title={lockType && type === 'مالك' ? 'مالك جديد' : 'عميل جديد'}
      description={compact ? 'إضافة سريعة؛ يمكن استكمال باقي البيانات لاحقًا من شاشة العملاء.' : 'إضافة سريعة؛ الهاتف ورقم الهوية اختياريان ويمكن استكمالهما لاحقًا من شاشة العملاء.'}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            إلغاء
          </Btn>
          <Btn type="submit" form="quick-client-form">
            إضافة واختيار
          </Btn>
        </>
      }
    >
      <form
        id="quick-client-form"
        ref={ref}
        noValidate
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          // The modal is portalled, but React still bubbles submit to an enclosing form's handler.
          e.stopPropagation()
          e.preventDefault()
          save()
        }}
      >
        <TextInput containerClassName="sm:col-span-2" label="الاسم الكامل" required value={f.fullName} error={err.fullName} onChange={(e) => set('fullName', e.target.value)} />
        <Select label="نوع العميل" required options={CLIENT_TYPES} value={f.type} disabled={lockType} onChange={(e) => set('type', e.target.value as ClientType)} />
        {!compact && (
          <>
            <TextInput label="الهاتف" dir="ltr" inputMode="tel" placeholder="01x-xxxxxxxx" value={f.phone} error={err.phone} onChange={(e) => set('phone', e.target.value)} />
            <TextInput label="رقم الهوية" dir="ltr" inputMode="numeric" maxLength={14} value={f.nationalId} error={err.nationalId} onChange={(e) => set('nationalId', e.target.value)} />
          </>
        )}
        <TextInput containerClassName={compact ? 'sm:col-span-2' : undefined} label="العنوان" value={f.address} onChange={(e) => set('address', e.target.value)} />
      </form>
    </Modal>
  )
}

/** Status filter chips with counts. */
export function FilterChips<V extends string>({
  options,
  value,
  onChange,
  counts,
  label,
}: {
  options: readonly V[]
  value: V
  onChange: (v: V) => void
  counts?: Partial<Record<V, number>>
  label: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm ${
            value === o ? 'border-primary bg-primary text-white shadow-raised' : 'border-hairline bg-neutral-soft text-fg-2 hover:text-fg'
          }`}
        >
          {o}
          {counts?.[o] != null && <span className={`text-xs tabular-nums ${value === o ? 'text-white/80' : 'text-fg-3'}`}>{counts[o]}</span>}
        </button>
      ))}
    </div>
  )
}

/** Label/value pair for read-only info cards. */
export function InfoPair({ label, value, strong, ltr, tone }: { label: string; value: ReactNode; strong?: boolean; ltr?: boolean; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="t-caption">{label}</span>
      <span dir={ltr ? 'ltr' : undefined} className={`${tone ?? 'text-fg'} ${strong ? 'font-semibold' : 'tabular-nums'}`}>
        {value}
      </span>
    </div>
  )
}

/**
 * Multi-select as toggle buttons. Put it inside a kit <Field> so the group is labelled and
 * described by the field's label and error.
 */
export function ToggleChips<V extends string>({
  items,
  selected,
  onToggle,
  disabled,
}: {
  items: readonly { value: V; label: string }[]
  selected: readonly V[]
  onToggle: (value: V) => void
  disabled?: boolean
}) {
  const field = useField()
  return (
    <div role="group" aria-labelledby={field?.labelId} aria-describedby={field?.describedBy} className="flex flex-wrap gap-2">
      {items.map((o) => {
        const on = selected.includes(o.value)
        return (
          <Btn key={o.value} size="sm" variant={on ? 'primary' : 'glass'} aria-pressed={on} disabled={disabled} onClick={() => onToggle(o.value)}>
            {o.label}
          </Btn>
        )
      })}
    </div>
  )
}

/** `شقة رقم 12 — الدور 3` */
export const unitLabelOf = (u: Pick<Unit, 'type' | 'number' | 'floor'> | undefined) =>
  u ? `${u.type} رقم ${u.number} — ${floorLabel(u.floor)}` : '—'
