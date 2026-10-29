/**
 * Dependency-free SVG charts. Colours come from the theme's CSS variables, so they follow dark mode.
 * Time series read right-to-left (first point at the right edge), matching the RTL layout.
 *
 *   BarChart    vertical bars with a gradient fill, grow-in (scaleY) and a hover tooltip
 *   DonutChart  ring segments with a centre total and a legend
 *   AreaChart   filled trend line (e.g. cumulative totals) with a hover tooltip
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { prefersReducedMotion } from './utils'

export type ChartDatum = { label: string; value: number; /** Tooltip heading; defaults to label. */ title?: string }

const compact = new Intl.NumberFormat('ar-EG-u-nu-latn', { notation: 'compact', maximumFractionDigits: 1 })
const plain = new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 2 })
const defaultFormat = (n: number) => plain.format(n)

/** Rounds the axis maximum up to a tidy number (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(value: number): number {
  if (value <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(value))
  const f = value / exp
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
}

/** False on first paint, true on the next frame — drives CSS grow-in transitions. */
function useEntered(deps: unknown): boolean {
  const [entered, setEntered] = useState(() => prefersReducedMotion())
  useEffect(() => {
    if (prefersReducedMotion()) return setEntered(true)
    setEntered(false)
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
    return () => cancelAnimationFrame(id)
  }, [deps])
  return entered
}

const TICKS = 4

/** Horizontal gridlines with compact value labels; children render inside the plot area. */
function Plot({ max, height, children, footer }: { max: number; height: number; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-2">
      <div className="relative w-10" style={{ height }} aria-hidden>
        {Array.from({ length: TICKS + 1 }, (_, i) => (
          <span key={i} className="t-caption absolute end-0 -translate-y-1/2 tabular-nums" style={{ top: `${(i / TICKS) * 100}%` }}>
            {compact.format(max * (1 - i / TICKS))}
          </span>
        ))}
      </div>
      <div className="relative" style={{ height }}>
        {Array.from({ length: TICKS + 1 }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className={cn('absolute inset-x-0 border-t', i === TICKS ? 'border-[var(--hairline)]' : 'border-dashed border-[var(--hairline)]')}
            style={{ top: `${(i / TICKS) * 100}%` }}
          />
        ))}
        {children}
      </div>
      {footer && (
        <>
          <span />
          {footer}
        </>
      )}
    </div>
  )
}

function Tooltip({ leftPct, topPct, title, value }: { leftPct: number; topPct: number; title: string; value: string }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-ctl border border-[var(--menu-border)] bg-[var(--tooltip-bg)] px-3 py-2 text-center text-[var(--tooltip-text)] shadow-[var(--shadow-lift)]"
      style={{ left: `${Math.min(92, Math.max(8, leftPct))}%`, top: `${topPct}%` }}
    >
      <div className="t-caption !text-[var(--tooltip-text)] opacity-80">{title}</div>
      <div className="t-label font-bold tabular-nums">{value}</div>
    </div>
  )
}

/* ==================================================================
   BarChart
   ================================================================== */

export type BarChartProps = {
  data: readonly ChartDatum[]
  format?: (n: number) => string
  height?: number
  /** Accessible summary of what the chart shows. */
  label: string
  className?: string
}

export function BarChart({ data, format = defaultFormat, height = 220, label, className }: BarChartProps) {
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data])
  const entered = useEntered(data)
  const n = Math.max(1, data.length)
  const slot = 100 / n
  const barW = slot * 0.56
  // RTL: index 0 sits at the right edge.
  const xOf = (i: number) => (n - 1 - i) * slot

  return (
    <figure className={cn('m-0', className)} aria-label={label}>
      <Plot
        max={max}
        height={height}
        footer={
          <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden>
            {data.map((d, i) => (
              <span key={i} className={cn('t-caption truncate text-center', hover === i && 'font-bold text-fg')}>
                {d.label}
              </span>
            ))}
          </div>
        }
      >
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={`${gid}-bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary-2)" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.75" />
            </linearGradient>
          </defs>
          {data.map((d, i) => {
            const h = (Math.max(0, d.value) / max) * height
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.title ?? d.label}: ${format(d.value)}`} className="outline-none">
                {/* full-height hit area */}
                <rect x={xOf(i)} y={0} width={slot} height={height} fill="transparent" />
                <rect
                  x={xOf(i) + (slot - barW) / 2}
                  y={height - h}
                  width={barW}
                  height={h}
                  rx={0.8}
                  fill={`url(#${gid}-bar)`}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  style={{
                    transformBox: 'fill-box',
                    transformOrigin: 'bottom',
                    transform: `scaleY(${entered ? 1 : 0})`,
                    transition: `transform 700ms var(--spring) ${i * 40}ms, opacity 160ms ease`,
                  }}
                />
              </g>
            )
          })}
        </svg>
        {hover !== null && data[hover] && (
          <Tooltip
            leftPct={xOf(hover) + slot / 2}
            topPct={100 - (Math.max(0, data[hover].value) / max) * 100}
            title={data[hover].title ?? data[hover].label}
            value={format(data[hover].value)}
          />
        )}
      </Plot>
    </figure>
  )
}

/* ==================================================================
   AreaChart
   ================================================================== */

export type AreaChartProps = BarChartProps & { tone?: 'primary' | 'success' }

export function AreaChart({ data, format = defaultFormat, height = 220, label, tone = 'success', className }: AreaChartProps) {
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)
  const entered = useEntered(data)
  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data])
  const n = data.length
  const color = tone === 'success' ? 'var(--success)' : 'var(--primary)'
  // Points sit in the middle of equal slots so labels line up under them; RTL order.
  const xOf = (i: number) => ((n - 1 - i + 0.5) / Math.max(1, n)) * 100
  const yOf = (v: number) => height - (Math.max(0, v) / max) * height
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${xOf(i)},${yOf(d.value)}`).join(' ')
  const area = n ? `${line} L${xOf(n - 1)},${height} L${xOf(0)},${height} Z` : ''

  return (
    <figure className={cn('m-0', className)} aria-label={label}>
      <Plot
        max={max}
        height={height}
        footer={
          <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` }} aria-hidden>
            {data.map((d, i) => (
              <span key={i} className={cn('t-caption truncate text-center', hover === i && 'font-bold text-fg')}>
                {d.label}
              </span>
            ))}
          </div>
        }
      >
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          onMouseLeave={() => setHover(null)}
          style={{
            // Transform/opacity-only entrance: the area rises from the baseline.
            opacity: entered ? 1 : 0,
            transform: entered ? 'scaleY(1)' : 'scaleY(0.4)',
            transformOrigin: '50% 100%',
            transition: 'transform 800ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms ease',
          }}
        >
          <defs>
            <linearGradient id={`${gid}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid}-area)`} />
          <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hover !== null && <line x1={xOf(hover)} x2={xOf(hover)} y1={0} y2={height} stroke="var(--hairline)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {data.map((d, i) => (
            <rect
              key={i}
              x={xOf(i) - 50 / Math.max(1, n)}
              y={0}
              width={100 / Math.max(1, n)}
              height={height}
              fill="transparent"
              tabIndex={0}
              className="outline-none"
              aria-label={`${d.title ?? d.label}: ${format(d.value)}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            />
          ))}
        </svg>
        {/* Dots in HTML so they stay round despite the stretched viewBox. */}
        {data.map((d, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[var(--glass-solid)] transition-transform"
            style={{
              left: `${xOf(i)}%`,
              top: `${(yOf(d.value) / height) * 100}%`,
              borderColor: color,
              transform: `translate(-50%, -50%) scale(${hover === i ? 1.5 : entered ? 1 : 0})`,
            }}
          />
        ))}
        {hover !== null && data[hover] && (
          <Tooltip leftPct={xOf(hover)} topPct={(yOf(data[hover].value) / height) * 100} title={data[hover].title ?? data[hover].label} value={format(data[hover].value)} />
        )}
      </Plot>
    </figure>
  )
}

/* ==================================================================
   DonutChart
   ================================================================== */

export type DonutTone = 'primary' | 'primary-2' | 'success' | 'warning' | 'danger' | 'neutral'
export type DonutDatum = { label: string; value: number; tone?: DonutTone }

const DONUT_ORDER: DonutTone[] = ['primary', 'success', 'warning', 'danger', 'primary-2', 'neutral']

export type DonutChartProps = {
  data: readonly DonutDatum[]
  format?: (n: number) => string
  /** Caption under the centre total. */
  centerLabel?: string
  label: string
  size?: number
  className?: string
}

export function DonutChart({ data, format = defaultFormat, centerLabel, label, size = 180, className }: DonutChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const entered = useEntered(data)
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0)
  const r = 40
  const c = 2 * Math.PI * r
  const gap = data.filter((d) => d.value > 0).length > 1 ? 1.2 : 0
  let offset = 0
  const shown = hover !== null ? data[hover] : null

  return (
    <figure className={cn('m-0 flex flex-wrap items-center justify-center gap-6', className)} aria-label={label}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          viewBox="0 0 100 100"
          className="size-full"
          onMouseLeave={() => setHover(null)}
          style={{
            // Transform/opacity-only entrance (segments start at 12 o'clock).
            opacity: entered ? 1 : 0,
            transform: entered ? 'rotate(-90deg) scale(1)' : 'rotate(-150deg) scale(0.86)',
            transition: 'transform 800ms cubic-bezier(0.22, 1, 0.36, 1), opacity 400ms ease',
          }}
        >
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--hairline)" strokeWidth="12" />
          {total > 0 &&
            data.map((d, i) => {
              const len = (Math.max(0, d.value) / total) * c
              const seg = (
                <circle
                  key={i}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={`var(--${d.tone ?? DONUT_ORDER[i % DONUT_ORDER.length]})`}
                  strokeWidth={hover === i ? 15 : 12}
                  strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                  strokeDashoffset={-offset}
                  tabIndex={0}
                  aria-label={`${d.label}: ${format(d.value)}`}
                  className="cursor-pointer outline-none"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  style={{ transition: 'opacity 160ms ease' }}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              )
              offset += len
              return seg
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="t-label font-bold tabular-nums text-fg">{format(shown ? shown.value : total)}</span>
          <span className="t-caption">{shown ? shown.label : (centerLabel ?? 'الإجمالي')}</span>
        </div>
      </div>
      <ul className="m-0 grid min-w-[12rem] list-none gap-2 p-0">
        {data.map((d, i) => (
          <li
            key={i}
            className={cn('flex items-center gap-3 rounded-ctl px-2 py-1', hover === i && 'bg-[var(--primary-soft)]')}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="size-3 shrink-0 rounded-full" style={{ background: `var(--${d.tone ?? DONUT_ORDER[i % DONUT_ORDER.length]})` }} />
            <span className="t-label flex-1 text-fg-2">{d.label}</span>
            <span className="t-label tabular-nums text-fg">{format(d.value)}</span>
            <span className="t-caption w-10 text-end tabular-nums">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
