import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

type FieldMeta = {
  label?: ReactNode
  hint?: ReactNode
  /** Error message; also switches the field into the `.err` state. */
  error?: ReactNode
  /** Classes for the outer wrapper (label + field + message). */
  containerClassName?: string
}

type FieldShellProps = FieldMeta & {
  id: string
  required?: boolean
  shellClassName?: string
  leading?: ReactNode
  trailing?: ReactNode
  children: ReactNode
}

function describedBy(id: string, { error, hint }: FieldMeta) {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}

/** Label + `.field` shell + hint/error message. Wraps a single control. */
export function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  leading,
  trailing,
  shellClassName,
  containerClassName,
  children,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label != null && (
        <label htmlFor={id} className="t-label text-fg-2">
          {label}
          {required && (
            <span className="ms-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      <div className={cn('field', error != null && error !== false && 'err', shellClassName)}>
        {leading != null && <span className="field-adornment">{leading}</span>}
        {children}
        {trailing != null && <span className="field-adornment">{trailing}</span>}
      </div>
      {error ? (
        <p id={`${id}-error`} className="t-caption text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="t-caption">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export type InputProps = ComponentProps<'input'> &
  FieldMeta & {
    leading?: ReactNode
    trailing?: ReactNode
  }

export function Input({
  id,
  label,
  hint,
  error,
  leading,
  trailing,
  containerClassName,
  className,
  required,
  ...props
}: InputProps) {
  const autoId = useId()
  const fieldId = id ?? autoId

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      leading={leading}
      trailing={trailing}
      containerClassName={containerClassName}
    >
      <input
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, { error, hint })}
        className={cn('field-control', className)}
        {...props}
      />
    </FieldShell>
  )
}

export type SelectProps = ComponentProps<'select'> & FieldMeta

export function Select({
  id,
  label,
  hint,
  error,
  containerClassName,
  className,
  required,
  children,
  ...props
}: SelectProps) {
  const autoId = useId()
  const fieldId = id ?? autoId

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      shellClassName="field-select"
      containerClassName={containerClassName}
    >
      <select
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, { error, hint })}
        className={cn('field-control', className)}
        {...props}
      >
        {children}
      </select>
      <svg
        className="field-chevron"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </FieldShell>
  )
}

export type TextareaProps = ComponentProps<'textarea'> & FieldMeta

export function Textarea({
  id,
  label,
  hint,
  error,
  containerClassName,
  className,
  required,
  ...props
}: TextareaProps) {
  const autoId = useId()
  const fieldId = id ?? autoId

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      shellClassName="field-multiline"
      containerClassName={containerClassName}
    >
      <textarea
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, { error, hint })}
        className={cn('field-control', className)}
        {...props}
      />
    </FieldShell>
  )
}
