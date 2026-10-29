import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export type GlassVariant = 'default' | 'strong' | 'float'

const variantClass: Record<GlassVariant, string> = {
  default: 'glass',
  strong: 'glass-strong',
  float: 'glass-float',
}

export type GlassCardProps = ComponentProps<'div'> & {
  /** default: blur 14px · strong: blur 18px · float: blur 20px + lifted shadow */
  variant?: GlassVariant
}

export function GlassCard({ variant = 'default', className, ...props }: GlassCardProps) {
  return <div className={cn(variantClass[variant], className)} {...props} />
}
