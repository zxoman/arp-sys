import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/** Loading placeholder; size it with utilities, e.g. `className="h-4 w-32"`. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('skeleton', className)} aria-hidden="true" {...props} />
}
