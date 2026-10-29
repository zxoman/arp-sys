import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Text } from '@/components/ui'
import { cn } from '@/lib/cn'
import { Btn, IconBtn } from './core'
import { IconAlert, IconCheckCircle, IconInfo, IconX, IconXCircle } from './icons'
import { prefersReducedMotion } from './utils'

/* ==================================================================
   Shared overlay behaviour
   ================================================================== */

/** Matches the longest exit animation in kit.css (drawer: 0.24s). */
const EXIT_MS = 240

/** Open overlays, oldest first. Escape closes only the last one. */
const overlayStack: object[] = []

let scrollLocks = 0
let savedOverflow = ''
let savedPadding = ''

function lockScroll() {
  if (scrollLocks++ > 0) return
  const { body, documentElement } = document
  const scrollbar = window.innerWidth - documentElement.clientWidth
  savedOverflow = body.style.overflow
  savedPadding = body.style.paddingInlineEnd
  body.style.overflow = 'hidden'
  // Keep the layout from shifting when the scrollbar disappears.
  if (scrollbar > 0) body.style.paddingInlineEnd = `${scrollbar}px`
}

function unlockScroll() {
  if (--scrollLocks > 0) return
  document.body.style.overflow = savedOverflow
  document.body.style.paddingInlineEnd = savedPadding
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Delays unmounting so the exit animation can play, makes the panel the top of the Escape stack,
 * locks page scroll, moves focus into the panel (an element with `data-autofocus`, else the
 * panel itself) and restores it to the opener on close.
 */
function useOverlay(open: boolean, onClose: () => void) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (prefersReducedMotion()) {
      setMounted(false)
      return
    }
    setClosing(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const token = {}
    overlayStack.push(token)
    lockScroll()
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel || panel.contains(document.activeElement)) return // an autoFocus field won
      ;(panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel).focus({ preventScroll: true })
    })
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (overlayStack[overlayStack.length - 1] !== token) return
      event.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      overlayStack.splice(overlayStack.indexOf(token), 1)
      unlockScroll()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open])

  /** Keeps Tab / Shift+Tab cycling inside the panel. */
  const trapFocus = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return
    const panel = panelRef.current
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const current = document.activeElement
    if (event.shiftKey && (current === first || current === panel)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && current === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  return { mounted, closing, panelRef, trapFocus }
}

type OverlayTone = 'primary' | 'danger' | 'warning' | 'success'

const toneChip: Record<OverlayTone, string> = {
  primary: 'bg-primary-soft text-primary',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
}

type OverlayBaseProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  /** Icon in a tinted tile before the title. */
  icon?: ReactNode
  tone?: OverlayTone
  children?: ReactNode
  /** Action row; buttons are end-aligned (left in RTL). */
  footer?: ReactNode
  /** Click on the dimmed backdrop closes (default true). */
  closeOnBackdrop?: boolean
  className?: string
}

function PanelChrome({
  titleId,
  descriptionId,
  title,
  description,
  icon,
  tone = 'primary',
  onClose,
  footer,
  children,
}: Pick<OverlayBaseProps, 'title' | 'description' | 'icon' | 'tone' | 'onClose' | 'footer' | 'children'> & {
  titleId: string
  descriptionId: string
}) {
  return (
    <>
      <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-6 pb-4 pt-5">
        {icon && (
          <span className={cn('grid size-10 shrink-0 place-items-center rounded-ctl', toneChip[tone])}>{icon}</span>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          <Text variant="section" id={titleId}>
            {title}
          </Text>
          {description && (
            <Text variant="caption" id={descriptionId} className="mt-1">
              {description}
            </Text>
          )}
        </div>
        <IconBtn icon={<IconX size={18} />} label="إغلاق" size="sm" onClick={onClose} className="-me-2 -mt-1" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>
      {footer && (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-hairline px-6 py-4">
          {footer}
        </footer>
      )}
    </>
  )
}

/* ==================================================================
   Modal
   ================================================================== */

export type ModalProps = OverlayBaseProps & { size?: 'sm' | 'md' | 'lg' | 'xl' }

const modalWidth = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const

/** Centered dialog: portaled, focus-trapped, Escape closes it only when it's the top layer. */
export function Modal({ open, onClose, size = 'md', closeOnBackdrop = true, className, ...chrome }: ModalProps) {
  const { mounted, closing, panelRef, trapFocus } = useOverlay(open, onClose)
  const titleId = useId()
  const descriptionId = useId()
  if (!mounted) return null

  return createPortal(
    <div className="kit-layer kit-modal-layer" data-state={closing ? 'closing' : 'open'}>
      <div className="backdrop" aria-hidden="true" onClick={closeOnBackdrop ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={chrome.description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={cn('glass-float kit-modal outline-none', modalWidth[size], className)}
      >
        <PanelChrome {...chrome} onClose={onClose} titleId={titleId} descriptionId={descriptionId} />
      </div>
    </div>,
    document.body,
  )
}

/* ==================================================================
   Drawer
   ================================================================== */

export type DrawerProps = OverlayBaseProps & { size?: 'sm' | 'md' | 'lg' }

/** Full-height side panel on the inline-end edge (left in RTL), sliding in with a spring. */
export function Drawer({ open, onClose, size = 'md', closeOnBackdrop = true, className, ...chrome }: DrawerProps) {
  const { mounted, closing, panelRef, trapFocus } = useOverlay(open, onClose)
  const titleId = useId()
  const descriptionId = useId()
  if (!mounted) return null

  return createPortal(
    <div className="kit-layer" data-state={closing ? 'closing' : 'open'}>
      <div className="backdrop" aria-hidden="true" onClick={closeOnBackdrop ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={chrome.description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapFocus}
        className={cn('glass-float kit-drawer outline-none', size !== 'md' && `kit-drawer-${size}`, className)}
      >
        <PanelChrome {...chrome} onClose={onClose} titleId={titleId} descriptionId={descriptionId} />
      </div>
    </div>,
    document.body,
  )
}

/* ==================================================================
   Toasts
   ================================================================== */

export type ToastTone = 'success' | 'danger' | 'warning' | 'info'

export type ToastOptions = {
  title: ReactNode
  description?: ReactNode
  tone?: ToastTone
  /** Milliseconds before auto-dismiss; 0 keeps it until closed. Default 5000. */
  duration?: number
  action?: { label: string; onClick: () => void }
}

export type ToastApi = {
  show: (options: ToastOptions) => string
  success: (title: ReactNode, description?: ReactNode) => string
  error: (title: ReactNode, description?: ReactNode) => string
  warning: (title: ReactNode, description?: ReactNode) => string
  info: (title: ReactNode, description?: ReactNode) => string
  dismiss: (id: string) => void
}

type ToastRecord = ToastOptions & { id: string; closing: boolean }

const ToastContext = createContext<ToastApi | null>(null)

/** Hosts the toast stack (bottom inline-end corner). Wrap the app once. */
export function ToastProvider({ children, max = 4 }: { children: ReactNode; max?: number }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const sequence = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, closing: true } : t)))
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), prefersReducedMotion() ? 0 : 200)
  }, [])

  const show = useCallback(
    (options: ToastOptions) => {
      const id = `kit-toast-${++sequence.current}`
      setToasts((list) => [...list, { ...options, id, closing: false }].slice(-max))
      return id
    },
    [max],
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, description) => show({ title, description, tone: 'success' }),
      error: (title, description) => show({ title, description, tone: 'danger', duration: 8000 }),
      warning: (title, description) => show({ title, description, tone: 'warning' }),
      info: (title, description) => show({ title, description, tone: 'info' }),
    }),
    [show, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="kit-toasts" role="region" aria-label="الإشعارات" aria-live="polite" aria-relevant="additions">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

const toneIcon = { success: IconCheckCircle, danger: IconXCircle, warning: IconAlert, info: IconInfo } as const

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const { id, title, description, tone = 'info', duration = 5000, action, closing } = toast
  const timed = duration > 0 && !closing
  const remaining = useRef(duration)
  const startedAt = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  /** Hover and focus pause independently, mirroring the CSS `:hover` / `:focus-within` pause. */
  const held = useRef({ hover: false, focus: false })
  const dismissRef = useRef(onDismiss)

  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  /** Runs the countdown only while the toast is neither hovered nor focused; keeps the time left. */
  const sync = useCallback(() => {
    const run = timed && !held.current.hover && !held.current.focus
    if (!run && timer.current !== undefined) {
      window.clearTimeout(timer.current)
      timer.current = undefined
      remaining.current -= Date.now() - startedAt.current
    } else if (run && timer.current === undefined) {
      startedAt.current = Date.now()
      timer.current = window.setTimeout(() => {
        timer.current = undefined
        dismissRef.current(id)
      }, Math.max(0, remaining.current))
    }
  }, [timed, id])

  useEffect(() => {
    sync()
    return () => {
      window.clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [sync])

  const Icon = toneIcon[tone]

  return (
    <div
      className="glass-float kit-toast toast-in rounded-2xl"
      data-tone={tone}
      data-state={closing ? 'closing' : 'open'}
      style={duration > 0 ? ({ '--kit-toast-ms': `${duration}ms` } as CSSProperties) : undefined}
      onMouseEnter={() => {
        held.current.hover = true
        sync()
      }}
      onMouseLeave={() => {
        held.current.hover = false
        sync()
      }}
      onFocus={() => {
        held.current.focus = true
        sync()
      }}
      onBlur={(event) => {
        // Moving focus between the toast's own buttons keeps it paused.
        if (event.currentTarget.contains(event.relatedTarget)) return
        held.current.focus = false
        sync()
      }}
    >
      <span className="kit-toast-icon">
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <Text variant="label" as="p" className="text-fg">
          {title}
        </Text>
        {description && (
          <Text variant="caption" className="mt-0.5">
            {description}
          </Text>
        )}
        {action && (
          <Btn
            variant="ghost"
            size="sm"
            className="-ms-3 mt-1"
            onClick={() => {
              action.onClick()
              onDismiss(id)
            }}
          >
            {action.label}
          </Btn>
        )}
      </div>
      <IconBtn icon={<IconX size={16} />} label="إغلاق الإشعار" size="sm" onClick={() => onDismiss(id)} />
      {duration > 0 && <span className="kit-toast-progress" aria-hidden="true" />}
    </div>
  )
}

/** `toast.success('تم الحفظ')`, `toast.show({ … })`. Requires <ToastProvider>. */
export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast() must be used inside <ToastProvider>')
  return context
}
