import type { ComponentProps, ElementType, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type TextVariant = 'page' | 'section' | 'body' | 'label' | 'caption' | 'kpi'

const variantClass: Record<TextVariant, string> = {
  page: 't-page',
  section: 't-section',
  body: 't-body',
  label: 't-label',
  caption: 't-caption',
  kpi: 't-kpi',
}

const defaultElement: Record<TextVariant, ElementType> = {
  page: 'h1',
  section: 'h2',
  body: 'p',
  label: 'span',
  caption: 'p',
  kpi: 'span',
}

export type TextProps = Omit<ComponentProps<'p'>, 'ref'> & {
  variant?: TextVariant
  /** Override the rendered element, e.g. `as="h3"` for a section title. */
  as?: ElementType
  children?: ReactNode
}

/** Applies the global type scale: page 28/800 · section 18/700 · body 14/400 · label 13/600 · caption 12/400 · kpi 26/800. */
export function Text({ variant = 'body', as, className, ...props }: TextProps) {
  const Component = as ?? defaultElement[variant]
  return <Component className={cn(variantClass[variant], className)} {...props} />
}
