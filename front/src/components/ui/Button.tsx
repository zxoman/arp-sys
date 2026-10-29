import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'danger' | 'success' | 'glass' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Rendered before the label (the right side in RTL). */
  iconStart?: ReactNode
  /** Rendered after the label (the left side in RTL). */
  iconEnd?: ReactNode
  block?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconStart,
  iconEnd,
  block = false,
  type = 'button',
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const iconOnly = children == null || children === false

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'btn',
        `btn-${variant}`,
        size !== 'md' && `btn-${size}`,
        iconOnly && 'btn-icon',
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : iconStart}
      {children}
      {!loading || !iconOnly ? iconEnd : null}
    </button>
  )
}
