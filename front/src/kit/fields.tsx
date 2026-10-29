import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { addDays, addMonths, pad, parseISO, toISO, type ISODate } from '@/lib/domain'
import { Btn } from './core'
import {
  IconAlert,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronNext,
  IconChevronPrev,
  IconImage,
  IconMinus,
  IconPlus,
  IconTrash,
  IconX,
} from './icons'
import { isRtl, matchesAll, normalizeSearch, toLatinDigits } from './utils'

/* ==================================================================
   Field
   ================================================================== */

/** Props every kit control accepts to render its own <Field>. */
export type FieldMeta = {
  label?: ReactNode
  required?: boolean
  /** Error message; also switches the control into its error state. */
  error?: ReactNode
  hint?: ReactNode
  /** Classes for the outer wrapper (label + control + message). */
  containerClassName?: string
}

type FieldContextValue = { id: string; labelId: string; describedBy?: string; invalid: boolean; required: boolean }

const FieldContext = createContext<FieldContextValue | null>(null)

/** Ids and state of the enclosing <Field>, for custom controls. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext)
}

const present = (node: ReactNode) => node != null && node !== false && node !== ''

function describedBy(id: string, error: ReactNode, hint: ReactNode) {
  if (present(error)) return `${id}-error`
  if (present(hint)) return `${id}-hint`
  return undefined
}

export type FieldProps = Omit<FieldMeta, 'containerClassName'> & {
  /** Id of the control; the label points at it. Generated when omitted. */
  id?: string
  /** Rendered at the end of the label row, e.g. a counter or link-style action. */
  aside?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * Label (with a required star) + control + hint or error message. Wrap any control; non-labelable
 * controls (button groups) should use `role="group" aria-labelledby={useField().labelId}`.
 */
export function Field({ id, label, required = false, error, hint, aside, className, children }: FieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const invalid = present(error)
  const context = useMemo<FieldContextValue>(
    () => ({
      id: fieldId,
      labelId: `${fieldId}-label`,
      describedBy: describedBy(fieldId, error, hint),
      invalid,
      required,
    }),
    [fieldId, error, hint, invalid, required],
  )

  return (
    <FieldContext.Provider value={context}>
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        {(label != null || aside != null) && (
          <div className="flex items-center justify-between gap-2">
            {label != null && (
              <label htmlFor={fieldId} id={context.labelId} className="t-label text-fg-2">
                {label}
                {required && (
                  <span className="ms-0.5 text-danger" aria-hidden="true">
                    *
                  </span>
                )}
              </label>
            )}
            {aside}
          </div>
        )}
        {children}
        {invalid ? (
          <p id={`${fieldId}-error`} className="fade t-caption flex items-center gap-1 text-danger" role="alert">
            <IconAlert size={13} />
            {error}
          </p>
        ) : present(hint) ? (
          <p id={`${fieldId}-hint`} className="t-caption">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

type ShellProps = {
  invalid?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  className?: string
  children: ReactNode
  ref?: Ref<HTMLDivElement>
}

/** The `.field` box: border, focus ring, error state, adornments. */
function Shell({ invalid, leading, trailing, className, children, ref }: ShellProps) {
  return (
    <div ref={ref} className={cn('field', invalid && 'err', className)}>
      {leading != null && <span className="field-adornment">{leading}</span>}
      {children}
      {trailing != null && <span className="field-adornment gap-1">{trailing}</span>}
    </div>
  )
}

function useFieldId(id: string | undefined) {
  const autoId = useId()
  return id ?? autoId
}

/* ==================================================================
   TextInput / Textarea
   ================================================================== */

export type TextInputProps = ComponentProps<'input'> & FieldMeta & { leading?: ReactNode; trailing?: ReactNode }

export function TextInput({
  id,
  label,
  required,
  error,
  hint,
  containerClassName,
  leading,
  trailing,
  className,
  ...props
}: TextInputProps) {
  const fieldId = useFieldId(id)
  return (
    <Field id={fieldId} label={label} required={required} error={error} hint={hint} className={containerClassName}>
      <Shell invalid={present(error)} leading={leading} trailing={trailing}>
        <input
          id={fieldId}
          required={required}
          aria-invalid={present(error) || undefined}
          aria-describedby={describedBy(fieldId, error, hint)}
          className={cn('field-control', className)}
          {...props}
        />
      </Shell>
    </Field>
  )
}

export type TextareaProps = ComponentProps<'textarea'> & FieldMeta & { showCount?: boolean }

/** Multiline text; shows a live `n/max` counter when `maxLength` is set. */
export function Textarea({
  id,
  label,
  required,
  error,
  hint,
  containerClassName,
  className,
  maxLength,
  showCount = maxLength != null,
  value,
  defaultValue,
  onChange,
  ...props
}: TextareaProps) {
  const fieldId = useFieldId(id)
  const [typed, setTyped] = useState(() => String(defaultValue ?? '').length)
  const length = value != null ? String(value).length : typed

  return (
    <Field id={fieldId} label={label} required={required} error={error} hint={hint} className={containerClassName}>
      <Shell invalid={present(error)} className="field-multiline">
        <textarea
          id={fieldId}
          required={required}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          aria-invalid={present(error) || undefined}
          aria-describedby={describedBy(fieldId, error, hint)}
          className={cn('field-control', showCount && 'pb-4', className)}
          onChange={(event) => {
            setTyped(event.target.value.length)
            onChange?.(event)
          }}
          {...props}
        />
        {showCount && maxLength != null && (
          <span className="kit-count" data-over={length >= maxLength || undefined} aria-hidden="true">
            {length}/{maxLength}
          </span>
        )}
      </Shell>
    </Field>
  )
}

/* ==================================================================
   NumericInput
   ================================================================== */

export type NumericInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'inputMode'
> &
  FieldMeta & {
    value: number | null
    onChange: (value: number | null) => void
    min?: number
    max?: number
    step?: number
    /** Allowed fraction digits (0 = integers only). */
    decimals?: number
    /** Unit shown after the number, e.g. `ج.م` or `م²`. */
    suffix?: ReactNode
    leading?: ReactNode
    /** −/+ buttons (ArrowUp/ArrowDown always step). */
    stepper?: boolean
  }

/**
 * Number field: accepts Arabic-Indic digits, shows thousands separators when not focused,
 * clamps to min/max on blur. Exposed to assistive tech as a spinbutton.
 */
export function NumericInput({
  id,
  label,
  required,
  error,
  hint,
  containerClassName,
  value,
  onChange,
  min,
  max,
  step = 1,
  decimals = 0,
  suffix,
  leading,
  stepper = true,
  disabled,
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: NumericInputProps) {
  const fieldId = useFieldId(id)
  const [draft, setDraft] = useState<string | null>(null)
  const formatter = useMemo(() => new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }), [decimals])

  const allowNegative = min == null || min < 0
  const clamp = (n: number) => {
    const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
    const factor = 10 ** decimals
    return Math.round(bounded * factor) / factor
  }

  function handleChange(text: string) {
    const raw = toLatinDigits(text).replace(/[,\s]/g, '')
    const shape = decimals > 0 ? /^-?\d*\.?\d*$/ : /^-?\d*$/
    if (!shape.test(raw) || (!allowNegative && raw.startsWith('-'))) return
    if (decimals > 0 && (raw.split('.')[1]?.length ?? 0) > decimals) return
    setDraft(raw)
    const n = raw === '' || raw === '-' || raw === '.' || raw === '-.' ? null : Number(raw)
    onChange(n != null && Number.isFinite(n) ? n : null)
  }

  function stepBy(direction: 1 | -1) {
    const next = clamp((value ?? min ?? 0) + (value == null ? 0 : direction * step))
    onChange(next)
    if (draft != null) setDraft(String(next))
  }

  const shown = draft ?? (value == null ? '' : formatter.format(value))
  const atMin = min != null && value != null && value <= min
  const atMax = max != null && value != null && value >= max

  return (
    <Field id={fieldId} label={label} required={required} error={error} hint={hint} className={containerClassName}>
      <Shell invalid={present(error)} leading={leading}>
        <input
          id={fieldId}
          type="text"
          inputMode={decimals > 0 ? 'decimal' : 'numeric'}
          role="spinbutton"
          aria-valuenow={value ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          required={required}
          disabled={disabled}
          aria-invalid={present(error) || undefined}
          aria-describedby={describedBy(fieldId, error, hint)}
          autoComplete="off"
          className={cn('field-control kit-tabular', className)}
          value={shown}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={(event) => {
            setDraft(value == null ? '' : String(value))
            onFocus?.(event)
          }}
          onBlur={(event) => {
            if (value != null && clamp(value) !== value) onChange(clamp(value))
            setDraft(null)
            onBlur?.(event)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              stepBy(event.key === 'ArrowUp' ? 1 : -1)
            }
            onKeyDown?.(event)
          }}
          {...props}
        />
        {suffix != null && <span className="field-adornment t-label">{suffix}</span>}
        {stepper && (
          <span className="flex items-center gap-0.5">
            <span className="kit-field-sep me-1" aria-hidden="true" />
            <button
              type="button"
              tabIndex={-1}
              className="kit-field-btn"
              aria-label="إنقاص"
              disabled={disabled || atMin}
              onClick={() => stepBy(-1)}
            >
              <IconMinus size={15} />
            </button>
            <button
              type="button"
              tabIndex={-1}
              className="kit-field-btn"
              aria-label="زيادة"
              disabled={disabled || atMax}
              onClick={() => stepBy(1)}
            >
              <IconPlus size={15} />
            </button>
          </span>
        )}
      </Shell>
    </Field>
  )
}

/* ==================================================================
   Select
   ================================================================== */

export type SelectOption = { value: string; label: string; disabled?: boolean }

export type SelectProps = Omit<ComponentProps<'select'>, 'children'> &
  FieldMeta & {
    options: readonly (SelectOption | string)[]
    /** Empty first option; selectable unless the field is required. */
    placeholder?: string
  }

/** Native select in the kit field shell; `options` may be plain strings. */
export function Select({
  id,
  label,
  required,
  error,
  hint,
  containerClassName,
  options,
  placeholder,
  className,
  ...props
}: SelectProps) {
  const fieldId = useFieldId(id)
  return (
    <Field id={fieldId} label={label} required={required} error={error} hint={hint} className={containerClassName}>
      <Shell invalid={present(error)} className="field-select">
        <select
          id={fieldId}
          required={required}
          aria-invalid={present(error) || undefined}
          aria-describedby={describedBy(fieldId, error, hint)}
          className={cn('field-control', className)}
          {...props}
        >
          {placeholder != null && (
            <option value="" disabled={required}>
              {placeholder}
            </option>
          )}
          {options.map((option) => {
            const o = typeof option === 'string' ? { value: option, label: option } : option
            return (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            )
          })}
        </select>
        <IconChevronDown size={16} className="field-chevron" />
      </Shell>
    </Field>
  )
}

/* ==================================================================
   Popover positioning (shared by Combobox and DatePicker)
   ================================================================== */

type PopoverPosition = { side: 'top' | 'bottom'; style: CSSProperties }

/**
 * Fixed-position coordinates under (or, without room, above) the anchor, aligned to its
 * inline-start edge. Popovers are portaled to <body>, so glass `contain`, transformed ancestors
 * and scrolling modals can't clip them.
 */
function useAnchoredPopover(
  anchor: RefObject<HTMLElement | null>,
  open: boolean,
  preferredHeight: number,
  fixedWidth?: number,
): PopoverPosition | null {
  const [position, setPosition] = useState<PopoverPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const update = () => {
      const el = anchor.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const gap = 6
      const margin = 8
      const width = fixedWidth ?? rect.width
      const preferredLeft = isRtl(el) ? rect.right - width : rect.left
      const left = Math.min(Math.max(margin, preferredLeft), window.innerWidth - width - margin)
      const below = window.innerHeight - rect.bottom - gap - margin
      const above = rect.top - gap - margin
      const side = below < Math.min(preferredHeight, 260) && above > below ? 'top' : 'bottom'
      const maxHeight = Math.max(180, Math.min(preferredHeight, side === 'bottom' ? below : above))
      const next: PopoverPosition = {
        side,
        style:
          side === 'bottom'
            ? { left, width, maxHeight, top: rect.bottom + gap }
            : { left, width, maxHeight, bottom: window.innerHeight - rect.top + gap },
      }
      // Scrolling inside the popover also fires this; skip the re-render when nothing moved.
      setPosition((prev) =>
        prev &&
        prev.side === next.side &&
        (['left', 'top', 'bottom', 'width', 'maxHeight'] as const).every((k) => prev.style[k] === next.style[k])
          ? prev
          : next,
      )
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchor, preferredHeight, fixedWidth])

  return position
}

/* ==================================================================
   Combobox
   ================================================================== */

export type ComboOption = {
  value: string
  label: string
  /** Secondary line, e.g. a phone number. Searchable. */
  description?: string
  /** Extra searchable text that isn't displayed (ids, aliases). */
  keywords?: string
  disabled?: boolean
}

export type ComboboxProps = FieldMeta & {
  id?: string
  options: readonly ComboOption[]
  value: string | null
  onChange: (value: string | null, option: ComboOption | null) => void
  placeholder?: string
  emptyText?: string
  clearable?: boolean
  disabled?: boolean
  leading?: ReactNode
  /** Submits the selected value with a native form. */
  name?: string
  /** Cap on rendered matches; typing narrows further. */
  maxResults?: number
}

function highlight(label: string, query: string) {
  const term = query.trim()
  const at = term ? label.indexOf(term) : -1
  if (at < 0) return label
  return (
    <>
      {label.slice(0, at)}
      <mark>{label.slice(at, at + term.length)}</mark>
      {label.slice(at + term.length)}
    </>
  )
}

/**
 * Searchable single-select (WAI-ARIA combobox + listbox). Matching ignores Arabic diacritics and
 * alef/yaa/taa-marbuta variants and also searches `description` and `keywords`.
 */
export function Combobox({
  id,
  label,
  required,
  error,
  hint,
  containerClassName,
  options,
  value,
  onChange,
  placeholder = 'ابحث واختر…',
  emptyText = 'لا توجد نتائج مطابقة',
  clearable = true,
  disabled,
  leading,
  name,
  maxResults = 100,
}: ComboboxProps) {
  const fieldId = useFieldId(id)
  const listId = `${fieldId}-listbox`
  const shellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  /** Auto-scroll to the active option on open/typing/arrow keys, but not on mouse hover. */
  const followActive = useRef(true)

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value])
  const index = useMemo(
    () => options.map((option) => ({ option, text: normalizeSearch(`${option.label} ${option.description ?? ''} ${option.keywords ?? ''}`) })),
    [options],
  )
  const results = useMemo(() => {
    const q = normalizeSearch(query)
    const out: ComboOption[] = []
    for (const entry of index) {
      if (!matchesAll(entry.text, q)) continue
      out.push(entry.option)
      if (out.length >= maxResults) break
    }
    return out
  }, [index, query, maxResults])

  const position = useAnchoredPopover(shellRef, open, 320)
  const shown = position !== null

  useEffect(() => {
    if (open && shown && followActive.current) {
      listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
    }
  }, [active, open, shown, query])

  function openList() {
    if (disabled || open) return
    followActive.current = true
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  function close() {
    setOpen(false)
    setQuery('')
  }

  function choose(option: ComboOption) {
    if (option.disabled) return
    onChange(option.value, option)
    close()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const last = results.length - 1
    followActive.current = true
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) openList()
        else setActive((i) => Math.min(last, i + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        if (open) setActive((i) => Math.max(0, i - 1))
        break
      case 'Home':
      case 'End':
        if (open && results.length) {
          event.preventDefault()
          setActive(event.key === 'Home' ? 0 : last)
        }
        break
      case 'Enter':
        if (open && results[active]) {
          event.preventDefault()
          choose(results[active])
        }
        break
      case 'Escape':
        // Close only the list; keep an enclosing Modal open.
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
        break
      case 'Tab':
        if (open) close()
        break
    }
  }

  const activeId = open && results[active] ? `${fieldId}-opt-${active}` : undefined

  return (
    <Field id={fieldId} label={label} required={required} error={error} hint={hint} className={containerClassName}>
      <Shell
        ref={shellRef}
        invalid={present(error)}
        leading={leading}
        trailing={
          <>
            {clearable && value != null && !disabled && (
              <button
                type="button"
                tabIndex={-1}
                className="kit-field-btn"
                aria-label="مسح الاختيار"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(null, null)
                  inputRef.current?.focus()
                }}
              >
                <IconX size={14} />
              </button>
            )}
            <IconChevronDown
              size={16}
              className={cn('transition-transform duration-300 ease-spring', open && 'rotate-180')}
            />
          </>
        }
      >
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={present(error) || undefined}
          aria-describedby={describedBy(fieldId, error, hint)}
          aria-required={required || undefined}
          autoComplete="off"
          disabled={disabled}
          className="field-control"
          placeholder={open && selected ? selected.label : placeholder}
          value={open ? query : (selected?.label ?? '')}
          onChange={(event) => {
            followActive.current = true
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onClick={openList}
          onKeyDown={onKeyDown}
          onBlur={close}
        />
        {name && <input type="hidden" name={name} value={value ?? ''} />}
      </Shell>
      {open &&
        position &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={typeof label === 'string' ? label : undefined}
            className="glass-float kit-popover rounded-2xl p-1.5"
            data-side={position.side}
            style={position.style}
            // Keep focus in the input while clicking options.
            onMouseDown={(event) => event.preventDefault()}
          >
            {results.length === 0 ? (
              <p className="t-caption px-3 py-5 text-center">{emptyText}</p>
            ) : (
              results.map((option, i) => {
                const isSelected = option.value === value
                return (
                  <div
                    key={option.value}
                    id={`${fieldId}-opt-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    data-active={i === active || undefined}
                    className="kit-option"
                    onMouseEnter={() => {
                      followActive.current = false
                      setActive(i)
                    }}
                    onClick={() => choose(option)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{highlight(option.label, query)}</span>
                      {option.description && <span className="t-caption block truncate">{option.description}</span>}
                    </span>
                    {isSelected && <IconCheck size={16} />}
                  </div>
                )
              })
            )}
            {results.length >= maxResults && (
              <p className="t-caption border-t border-hairline px-3 pb-1 pt-2">اكتب لتضييق النتائج…</p>
            )}
          </div>,
          document.body,
        )}
    </Field>
  )
}

/* ==================================================================
   DatePicker
   ================================================================== */

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
/** Egyptian week: Saturday first. */
const WEEKDAYS = ['سبت', 'أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة']

/** `2025-06-18` → `18/06/2025` */
export function formatDMY(value: ISODate | null | undefined): string {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  return `${d}/${m}/${y}`
}

/** `18/6/2025` → `2025-06-18`; null when not a real calendar date. Accepts Arabic-Indic digits. */
export function parseDMY(text: string): ISODate | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(toLatinDigits(text.trim()))
  if (!match) return null
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

function maskDMY(digits: string) {
  const d = digits.slice(0, 8)
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/')
}

function longDate(value: ISODate) {
  const [y, m, d] = value.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export type DatePickerProps = FieldMeta & {
  id?: string
  /** ISO `YYYY-MM-DD`, displayed as DD/MM/YYYY. */
  value: ISODate | null
  onChange: (value: ISODate | null) => void
  min?: ISODate
  max?: ISODate
  /** Highlighted "today"; defaults to the device date. */
  today?: ISODate
  placeholder?: string
  disabled?: boolean
  clearable?: boolean
  name?: string
}

/**
 * Typed DD/MM/YYYY entry (slashes auto-inserted) plus a Saturday-first month calendar.
 * With the calendar open: arrows move by day/week (following the reading direction),
 * PageUp/PageDown by month, Enter picks, Escape closes.
 */
export function DatePicker({
  id,
  label,
  required,
  error,
  hint,
  containerClassName,
  value,
  onChange,
  min,
  max,
  today = toISO(new Date()),
  placeholder = 'DD/MM/YYYY',
  disabled,
  clearable = true,
  name,
}: DatePickerProps) {
  const fieldId = useFieldId(id)
  const calendarId = `${fieldId}-calendar`
  const shellRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<'format' | 'range' | null>(null)
  const [cursor, setCursor] = useState<ISODate>(value ?? today)
  const position = useAnchoredPopover(shellRef, open, 380, 300)

  // An external value change (or our own commit) replaces any in-progress text.
  useEffect(() => {
    setDraft(null)
    setProblem(null)
  }, [value])

  const inRange = (iso: ISODate) => (!min || iso >= min) && (!max || iso <= max)

  function openCalendar() {
    if (disabled || open) return
    setCursor(value ?? (inRange(today) ? today : (min ?? max ?? today)))
    setOpen(true)
  }

  function pick(iso: ISODate) {
    if (!inRange(iso)) return
    onChange(iso)
    setDraft(null)
    setProblem(null)
    setOpen(false)
  }

  function commit(text: string) {
    if (text.trim() === '') {
      setProblem(null)
      setDraft(null)
      if (value !== null) onChange(null)
      return
    }
    const iso = parseDMY(text)
    if (!iso) return setProblem('format')
    if (!inRange(iso)) return setProblem('range')
    setProblem(null)
    setDraft(null)
    if (iso !== value) onChange(iso)
  }

  function onInput(text: string) {
    const masked = maskDMY(toLatinDigits(text).replace(/\D/g, ''))
    setDraft(masked)
    setProblem(null)
    const iso = masked.length === 10 ? parseDMY(masked) : null
    if (iso) {
      setCursor(iso)
      if (inRange(iso)) onChange(iso)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const forward = isRtl(inputRef.current) ? 'ArrowLeft' : 'ArrowRight'
    if (!open) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        openCalendar()
      } else if (event.key === 'Enter' && draft != null) {
        commit(draft)
      }
      return
    }
    const moves: Record<string, () => ISODate> = {
      ArrowDown: () => addDays(cursor, 7),
      ArrowUp: () => addDays(cursor, -7),
      [forward]: () => addDays(cursor, 1),
      [forward === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft']: () => addDays(cursor, -1),
      PageDown: () => addMonths(cursor, event.shiftKey ? 12 : 1),
      PageUp: () => addMonths(cursor, event.shiftKey ? -12 : -1),
    }
    if (moves[event.key]) {
      event.preventDefault()
      setCursor(moves[event.key]())
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(cursor)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const year = Number(cursor.slice(0, 4))
  const month = Number(cursor.slice(5, 7))
  const first = `${pad(year, 4)}-${pad(month)}-01`
  const gridStart = addDays(first, -((parseISO(first).getDay() + 1) % 7))
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  const ownError =
    problem === 'format'
      ? 'أدخل تاريخًا صحيحًا بالصيغة يوم/شهر/سنة'
      : problem === 'range'
        ? `اختر تاريخًا ${min ? `من ${formatDMY(min)}` : ''} ${max ? `حتى ${formatDMY(max)}` : ''}`.trim()
        : null
  const shownError = present(error) ? error : ownError

  return (
    <Field id={fieldId} label={label} required={required} error={shownError} hint={hint} className={containerClassName}>
      <Shell
        ref={shellRef}
        invalid={present(shownError)}
        trailing={
          <>
            {clearable && value != null && !disabled && (
              <button
                type="button"
                tabIndex={-1}
                className="kit-field-btn"
                aria-label="مسح التاريخ"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(null)
                  inputRef.current?.focus()
                }}
              >
                <IconX size={14} />
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              className="kit-field-btn"
              aria-label={open ? 'إغلاق التقويم' : 'فتح التقويم'}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                inputRef.current?.focus()
                if (open) setOpen(false)
                else openCalendar()
              }}
            >
              <IconCalendar size={16} />
            </button>
          </>
        }
      >
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? calendarId : undefined}
          aria-invalid={present(shownError) || undefined}
          aria-describedby={describedBy(fieldId, shownError, hint)}
          aria-required={required || undefined}
          disabled={disabled}
          maxLength={10}
          placeholder={placeholder}
          className="field-control kit-tabular"
          value={draft ?? formatDMY(value)}
          onChange={(event) => onInput(event.target.value)}
          onClick={openCalendar}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft != null) commit(draft)
            setOpen(false)
          }}
        />
        {name && <input type="hidden" name={name} value={value ?? ''} />}
      </Shell>
      {open &&
        position &&
        createPortal(
          <div
            id={calendarId}
            role="dialog"
            aria-label="اختيار التاريخ"
            className="glass-float kit-popover kit-cal rounded-2xl"
            data-side={position.side}
            style={position.style}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                tabIndex={-1}
                className="kit-field-btn"
                aria-label="الشهر السابق"
                onClick={() => setCursor(addMonths(cursor, -1))}
              >
                <IconChevronPrev size={16} />
              </button>
              <p className="t-label" aria-live="polite">
                {MONTHS[month - 1]} {year}
              </p>
              <button
                type="button"
                tabIndex={-1}
                className="kit-field-btn"
                aria-label="الشهر التالي"
                onClick={() => setCursor(addMonths(cursor, 1))}
              >
                <IconChevronNext size={16} />
              </button>
            </div>
            <div className="kit-cal-grid" role="grid" aria-label={`${MONTHS[month - 1]} ${year}`}>
              {WEEKDAYS.map((day) => (
                <span key={day} role="columnheader" className="t-caption py-1 text-center">
                  {day}
                </span>
              ))}
              {cells.map((iso) => (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  tabIndex={-1}
                  className="kit-cal-day"
                  aria-label={longDate(iso)}
                  aria-selected={iso === value}
                  data-today={iso === today || undefined}
                  data-outside={iso.slice(5, 7) !== pad(month) || undefined}
                  data-active={iso === cursor || undefined}
                  disabled={!inRange(iso)}
                  onClick={() => pick(iso)}
                >
                  {Number(iso.slice(8))}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-hairline pt-2">
              <Btn variant="ghost" size="sm" tabIndex={-1} disabled={!inRange(today)} onClick={() => pick(today)}>
                اليوم
              </Btn>
              {clearable && value != null && (
                <Btn
                  variant="ghost"
                  size="sm"
                  tabIndex={-1}
                  onClick={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  مسح
                </Btn>
              )}
            </div>
          </div>,
          document.body,
        )}
    </Field>
  )
}

/* ==================================================================
   ImageUpload
   ================================================================== */

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
}
const IMAGE_EXTENSIONS = /\.(png|jpe?g|svg)$/i

export type ImageUploadProps = FieldMeta & {
  id?: string
  /** Base64 data URL; empty string when there is no image. */
  value: string
  /** Receives the new data URL, or '' when removed. */
  onChange: (value: string) => void
  /** Default 500 KB. */
  maxBytes?: number
  disabled?: boolean
  /** Accessible name of the preview image. */
  previewAlt?: string
  className?: string
}

const formatKB = (bytes: number) => `${Math.round(bytes / 1024)} كيلوبايت`

/**
 * PNG / JPG / SVG picker that stores the image as a base64 data URL. Click or drop a file; shows a
 * preview with change/remove actions and an Arabic error for wrong types or files over `maxBytes`.
 */
export function ImageUpload({
  id,
  value,
  onChange,
  maxBytes = 500 * 1024,
  disabled = false,
  previewAlt = 'معاينة الصورة',
  label,
  required,
  error,
  hint,
  containerClassName,
  className,
}: ImageUploadProps) {
  const fieldId = useFieldId(id)
  const inputRef = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState(false)
  const shownError = localError ?? error

  const accept = (file: File | undefined) => {
    if (!file || disabled) return
    if (!(file.type in IMAGE_TYPES) && !IMAGE_EXTENSIONS.test(file.name)) {
      setLocalError('صيغة الملف غير مدعومة. اختر صورة PNG أو JPG أو SVG.')
      return
    }
    if (file.size > maxBytes) {
      setLocalError(`حجم الصورة (${formatKB(file.size)}) يتجاوز الحد الأقصى ${formatKB(maxBytes)}.`)
      return
    }
    setLocalError(null)
    setReading(true)
    const reader = new FileReader()
    reader.onload = () => {
      setReading(false)
      if (typeof reader.result === 'string') onChange(reader.result)
    }
    reader.onerror = () => {
      setReading(false)
      setLocalError('تعذرت قراءة الملف. حاول مرة أخرى.')
    }
    reader.readAsDataURL(file)
  }

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    accept(event.target.files?.[0])
    event.target.value = '' // allow re-selecting the same file
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files[0])
  }

  const pick = () => inputRef.current?.click()
  const remove = () => {
    setLocalError(null)
    onChange('')
    inputRef.current?.focus()
  }

  return (
    <Field
      id={fieldId}
      label={label}
      required={required}
      error={shownError}
      hint={hint ?? `PNG أو JPG أو SVG · حتى ${formatKB(maxBytes)}`}
      className={containerClassName}
    >
      <div
        onDragOver={(event) => {
          if (disabled) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex items-center gap-4 rounded-ctl border border-dashed p-3',
          shownError ? 'border-danger bg-danger-soft/40' : dragging ? 'border-primary bg-primary-soft' : 'border-hairline bg-fg/[0.03]',
          disabled && 'pointer-events-none opacity-60',
          className,
        )}
      >
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-ctl bg-white ring-1 ring-hairline dark:bg-white/90">
          {value ? (
            <img src={value} alt={previewAlt} className="size-full object-contain p-1.5" />
          ) : (
            <IconImage size={26} className="text-neutral-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-label text-fg">{value ? 'تم رفع الصورة' : 'اسحب الصورة هنا أو اختر ملفًا'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Btn variant="glass" size="sm" onClick={pick} loading={reading} disabled={disabled}>
              {value ? 'تغيير الصورة' : 'اختيار صورة'}
            </Btn>
            {value && (
              <Btn variant="ghost" size="sm" onClick={remove} disabled={disabled} iconStart={<IconTrash size={15} />} className="text-danger">
                إزالة
              </Btn>
            )}
          </div>
        </div>
        <input
          ref={inputRef}
          id={fieldId}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg"
          onChange={onInput}
          disabled={disabled}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy(fieldId, shownError, hint ?? true)}
          className="sr-only"
        />
      </div>
    </Field>
  )
}
