import { useCallback, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Text } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AnimatedNumber, Btn, GlassSurface, type SurfaceVariant } from './core'
import { IconAlert, IconCheck, IconSave, IconTrendDown, IconTrendUp } from './icons'
import { Modal } from './overlay'

type Tone = 'primary' | 'success' | 'danger' | 'warning' | 'neutral'

const toneTile: Record<Tone, string> = {
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  neutral: 'bg-neutral-soft text-neutral',
}

/* ==================================================================
   SectionCard
   ================================================================== */

export type SectionCardProps = Omit<ComponentProps<'section'>, 'title' | 'ref'> & {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  /** Controls at the end of the header row. */
  actions?: ReactNode
  /** Responsive grid for the body: 1, 2 (md+) or 3 (xl+) columns. */
  columns?: 1 | 2 | 3
  variant?: SurfaceVariant
  bodyClassName?: string
}

const gridColumns = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
} as const

/** Titled glass section; the body is a field grid. Use `md:col-span-2` on children to span. */
export function SectionCard({
  title,
  description,
  icon,
  actions,
  columns = 1,
  variant = 'glass',
  className,
  bodyClassName,
  children,
  ...props
}: SectionCardProps) {
  const headingId = useId()
  return (
    <GlassSurface as="section" variant={variant} padding="none" aria-labelledby={headingId} className={className} {...props}>
      <header className="flex flex-wrap items-start gap-3 border-b border-hairline px-5 py-4">
        {icon && <span className={cn('grid size-10 shrink-0 place-items-center rounded-ctl', toneTile.primary)}>{icon}</span>}
        <div className="min-w-0 flex-1 pt-0.5">
          <Text variant="section" id={headingId}>
            {title}
          </Text>
          {description && (
            <Text variant="caption" className="mt-0.5">
              {description}
            </Text>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={cn('grid gap-4 p-5', gridColumns[columns], bodyClassName)}>{children}</div>
    </GlassSurface>
  )
}

/* ==================================================================
   FormFooter
   ================================================================== */

export type FormFooterProps = {
  dirty?: boolean
  saving?: boolean
  /** Shown briefly after a save, e.g. "تم الحفظ قبل لحظات". Overrides the dirty/clean text. */
  status?: ReactNode
  onSave?: () => void
  onCancel?: () => void
  saveLabel?: string
  cancelLabel?: string
  saveDisabled?: boolean
  /** Render the save button as `type="submit"` (handle saving in the form's onSubmit). */
  submit?: boolean
  /** Extra buttons placed before cancel/save. */
  children?: ReactNode
  className?: string
}

/** Sticky glass action bar at the bottom of a form with an unsaved-changes indicator. */
export function FormFooter({
  dirty = false,
  saving = false,
  status,
  onSave,
  onCancel,
  saveLabel = 'حفظ التغييرات',
  cancelLabel = 'إلغاء',
  saveDisabled,
  submit = false,
  children,
  className,
}: FormFooterProps) {
  return (
    <div
      role="region"
      aria-label="إجراءات النموذج"
      className={cn('glass-strong sticky bottom-4 z-20 flex flex-wrap items-center gap-3 px-5 py-3', className)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2" aria-live="polite">
        {status ??
          (dirty ? (
            <>
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-warning" aria-hidden="true" />
              <Text variant="label" className="text-warning">
                لديك تغييرات غير محفوظة
              </Text>
            </>
          ) : (
            <>
              <IconCheck size={15} className="shrink-0 text-success" />
              <Text variant="caption">كل التغييرات محفوظة</Text>
            </>
          ))}
      </div>
      {children}
      {onCancel && (
        <Btn variant="ghost" disabled={saving} onClick={onCancel}>
          {cancelLabel}
        </Btn>
      )}
      <Btn
        variant="primary"
        type={submit ? 'submit' : 'button'}
        loading={saving}
        disabled={saveDisabled ?? !dirty}
        iconStart={<IconSave size={16} />}
        onClick={submit ? undefined : onSave}
      >
        {saveLabel}
      </Btn>
    </div>
  )
}

/* ==================================================================
   SummaryCard
   ================================================================== */

export type SummaryCardProps = Omit<ComponentProps<'div'>, 'children'> & {
  label: ReactNode
  value: number
  format?: (value: number) => string
  decimals?: number
  icon?: ReactNode
  tone?: Tone
  /** Percent change; green when it moves in the `goodWhen` direction (default up). */
  trend?: { value: number; label?: ReactNode; goodWhen?: 'up' | 'down' }
  hint?: ReactNode
}

/** KPI tile with a count-up number and an optional trend pill. */
export function SummaryCard({ label, value, format, decimals, icon, tone = 'primary', trend, hint, className, ...props }: SummaryCardProps) {
  const up = trend ? trend.value >= 0 : false
  const good = trend ? (trend.goodWhen === 'down' ? !up : up) : false
  const note = trend?.label ?? hint
  return (
    <GlassSurface padding="md" className={cn('rise-in flex flex-col gap-3', className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <Text variant="label" className="pt-1 text-fg-2">
          {label}
        </Text>
        {icon && <span className={cn('grid size-10 shrink-0 place-items-center rounded-ctl', toneTile[tone])}>{icon}</span>}
      </div>
      <AnimatedNumber value={value} format={format} decimals={decimals} className="t-kpi" />
      {(trend || note) && (
        <div className="flex flex-wrap items-center gap-2">
          {trend && (
            <span
              className={cn(
                't-caption inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold',
                good ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
              )}
            >
              {up ? <IconTrendUp size={14} /> : <IconTrendDown size={14} />}
              <bdi dir="ltr">
                {up ? '+' : ''}
                {trend.value}%
              </bdi>
            </span>
          )}
          {note && <Text variant="caption">{note}</Text>}
        </div>
      )}
    </GlassSurface>
  )
}

/* ==================================================================
   useUnsaved
   ================================================================== */

export type UnsavedOptions = {
  title?: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
}

/**
 * While `dirty`: the browser asks before reload/close, and clicks on same-window links are held
 * behind a confirmation dialog. Call `guard(fn)` for in-app navigation (tab switches, closing a
 * drawer) and render `prompt` once.
 *
 *   const { guard, prompt } = useUnsaved(dirty)
 *   <Btn onClick={() => guard(() => setTab('units'))}>…</Btn>
 *   {prompt}
 */
export function useUnsaved(dirty: boolean, options: UnsavedOptions = {}) {
  const {
    title = 'تغييرات غير محفوظة',
    message = 'لديك تغييرات لم تُحفظ بعد. إذا غادرت الآن فستفقدها.',
    confirmLabel = 'المغادرة دون حفظ',
    cancelLabel = 'متابعة التحرير',
  } = options
  const dirtyRef = useRef(dirty)
  /** Set once the user confirmed leaving, so the browser's own prompt doesn't ask again. */
  const leavingRef = useRef(false)
  const [pending, setPending] = useState<(() => void) | null>(null)

  useEffect(() => {
    dirtyRef.current = dirty
    leavingRef.current = false
    if (!dirty) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return
      event.preventDefault()
      event.returnValue = '' // required by older Chromium/Safari
    }
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return
      const url = new URL(link.href, window.location.href)
      const samePage = url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search
      if (samePage && url.hash) return // in-page anchor
      event.preventDefault()
      setPending(() => () => {
        leavingRef.current = true
        window.location.assign(url.href)
      })
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])

  /** Runs `proceed` now when clean, otherwise after the user confirms. */
  const guard = useCallback((proceed: () => void) => {
    if (dirtyRef.current) setPending(() => proceed)
    else proceed()
  }, [])

  const prompt = (
    <Modal
      open={pending !== null}
      onClose={() => setPending(null)}
      size="sm"
      tone="warning"
      icon={<IconAlert size={20} />}
      title={title}
      footer={
        <>
          <Btn variant="glass" data-autofocus onClick={() => setPending(null)}>
            {cancelLabel}
          </Btn>
          <Btn
            variant="danger"
            onClick={() => {
              const proceed = pending
              setPending(null)
              proceed?.()
            }}
          >
            {confirmLabel}
          </Btn>
        </>
      }
    >
      <Text variant="body" className="text-fg-2">
        {message}
      </Text>
    </Modal>
  )

  return { guard, prompt, dirty }
}
