import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Badge, Button, getStatusTone, type BadgeTone, type ButtonProps } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isRtl, prefersReducedMotion } from './utils'

/* ==================================================================
   GlassSurface
   ================================================================== */

export type SurfaceVariant = 'glass' | 'strong' | 'float'

const surfaceClass: Record<SurfaceVariant, string> = {
  glass: 'glass',
  strong: 'glass-strong',
  float: 'glass-float',
}

const surfacePadding = { none: '', sm: 'p-3', md: 'p-5', lg: 'p-7' } as const

export type GlassSurfaceProps = ComponentProps<'div'> & {
  /** glass: blur 14 · strong: blur 18 · float: blur 20 + lifted shadow */
  variant?: SurfaceVariant
  padding?: keyof typeof surfacePadding
  /** Render as another element, e.g. `section` or `article`. */
  as?: ElementType
}

export function GlassSurface({ variant = 'glass', padding = 'md', as: Comp = 'div', className, ...props }: GlassSurfaceProps) {
  return <Comp className={cn(surfaceClass[variant], surfacePadding[padding], className)} {...props} />
}

/* ==================================================================
   Btn / IconBtn
   ================================================================== */

export type BtnProps = ButtonProps

/** The design-system button: `primary | danger | success | glass | ghost`, `sm | md | lg`, `loading`, `iconStart`/`iconEnd`. */
export function Btn(props: BtnProps) {
  return <Button {...props} />
}

export type IconBtnProps = Omit<ButtonProps, 'children' | 'iconStart' | 'iconEnd' | 'block'> & {
  icon: ReactNode
  /** Accessible name; also shown as the tooltip. */
  label: string
}

/** Square icon-only button. Defaults to the `ghost` variant. */
export function IconBtn({ icon, label, variant = 'ghost', title, ...props }: IconBtnProps) {
  return <Button variant={variant} aria-label={label} title={title ?? label} iconStart={icon} {...props} />
}

/* ==================================================================
   StatusChip
   ================================================================== */

export type StatusChipProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** Arabic status label; its tone comes from the shared STATUS_TONE map (نشط → green, متأخر → red ...). */
  status: string
  tone?: BadgeTone
  count?: number
  size?: 'sm' | 'md'
}

export function StatusChip({ status, tone, count, size = 'md', className, ...props }: StatusChipProps) {
  return (
    <Badge tone={tone ?? getStatusTone(status)} className={cn(size === 'sm' && 'kit-chip-sm', className)} {...props}>
      {status}
      {count != null && <span className="kit-chip-count">{count}</span>}
    </Badge>
  )
}

/* ==================================================================
   LiquidTabs
   ================================================================== */

export type TabItem<V extends string = string> = {
  value: V
  label: ReactNode
  icon?: ReactNode
  count?: number
  disabled?: boolean
}

export type LiquidTabsProps<V extends string> = {
  items: readonly TabItem<V>[]
  value: V
  onChange: (value: V) => void
  /** aria-label for the tab list. */
  label?: string
  /** Shared with <TabPanel idBase>; defaults to a generated id. */
  idBase?: string
  className?: string
}

export const tabId = (idBase: string, value: string) => `${idBase}-tab-${value}`
export const tabPanelId = (idBase: string, value: string) => `${idBase}-panel-${value}`

/**
 * Tabs with a spring-animated underline and soft pill that glide to the active tab
 * (transform-only). Arrow keys follow the reading direction; Home/End jump to the ends.
 */
export function LiquidTabs<V extends string>({ items, value, onChange, label, idBase, className }: LiquidTabsProps<V>) {
  const autoId = useId()
  const base = idBase ?? autoId
  const listRef = useRef<HTMLDivElement>(null)
  const [ink, setInk] = useState<{ x: number; w: number } | null>(null)
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const measure = () => {
      const tab = list.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)
      if (tab) setInk({ x: tab.offsetLeft, w: tab.offsetWidth })
    }
    measure()
    // Re-measure when tab widths change (web font swap, count updates, container resize).
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    list.querySelectorAll('[role="tab"]').forEach((tab) => observer.observe(tab))
    return () => observer.disconnect()
  }, [value, items])

  // Enable transitions only after the first placement so the ink doesn't fly in from 0.
  useEffect(() => {
    if (!ink || ready) return
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [ink, ready])

  const enabled = items.filter((item) => !item.disabled)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = enabled.findIndex((item) => item.value === value)
    const forward = isRtl(listRef.current) ? 'ArrowLeft' : 'ArrowRight'
    const backward = forward === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft'
    let next: number | null = null
    if (event.key === forward) next = (index + 1) % enabled.length
    else if (event.key === backward) next = (index - 1 + enabled.length) % enabled.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = enabled.length - 1
    if (next === null) return
    event.preventDefault()
    const target = enabled[next]
    onChange(target.value)
    listRef.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(target.value)}"]`)?.focus()
  }

  const transform = ink ? `translateX(${ink.x}px) scaleX(${ink.w / 100})` : undefined

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cn('kit-tabs', className)}
      data-ready={ready || undefined}
      onKeyDown={onKeyDown}
    >
      <span className="kit-tabs-pill" style={{ transform }} aria-hidden="true" />
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={tabId(base, item.value)}
            aria-selected={selected}
            aria-controls={tabPanelId(base, item.value)}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            data-value={item.value}
            className="kit-tab"
            onClick={() => onChange(item.value)}
          >
            {item.icon}
            {item.label}
            {item.count != null && <span className="kit-tab-count">{item.count}</span>}
          </button>
        )
      })}
      <span className="kit-tabs-ink" style={{ transform }} aria-hidden="true" />
    </div>
  )
}

export type TabPanelProps = ComponentProps<'div'> & { idBase: string; value: string }

/** The panel for the active tab; pair with <LiquidTabs idBase>. */
export function TabPanel({ idBase, value, className, ...props }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idBase, value)}
      aria-labelledby={tabId(idBase, value)}
      tabIndex={0}
      className={cn('fade outline-none', className)}
      {...props}
    />
  )
}

/* ==================================================================
   AnimatedNumber
   ================================================================== */

const numberFormatters = new Map<number, Intl.NumberFormat>()
function defaultFormat(n: number, decimals: number) {
  let formatter = numberFormatters.get(decimals)
  if (!formatter) {
    formatter = new Intl.NumberFormat('ar-EG-u-nu-latn', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    numberFormatters.set(decimals, formatter)
  }
  return formatter.format(n)
}

export type AnimatedNumberProps = Omit<ComponentProps<'span'>, 'children'> & {
  value: number
  /** e.g. `egp`; defaults to grouped Latin digits. */
  format?: (n: number) => string
  /** ms */
  duration?: number
  decimals?: number
}

/**
 * Counts up to `value` (ease-out) and replays a short opacity/transform entrance on each change.
 * Screen readers get the final value only; reduced motion shows it immediately.
 */
export function AnimatedNumber({ value, format, duration = 900, decimals = 0, className, ...props }: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0)
  const current = useRef(0)

  useEffect(() => {
    const from = current.current
    if (prefersReducedMotion() || from === value) {
      current.current = value
      setDisplay(value)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const next = from + (value - from) * (1 - Math.pow(1 - t, 3))
      current.current = next
      setDisplay(next)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  const factor = 10 ** decimals
  const render = (n: number) => (format ? format(Math.round(n * factor) / factor) : defaultFormat(n, decimals))

  return (
    <span className={cn('kit-num', className)} {...props}>
      <span key={value} className="kit-num-in" aria-hidden="true">
        {render(display)}
      </span>
      <span className="sr-only">{render(value)}</span>
    </span>
  )
}
