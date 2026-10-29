import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'green' | 'yellow' | 'red' | 'indigo' | 'sky' | 'neutral'

/** Canonical status → tone mapping used across every screen. */
export const STATUS_TONE = {
  نشط: 'green',
  مدفوع: 'green',
  مكتمل: 'green',
  متاحة: 'green',
  مسودة: 'yellow',
  محجوزة: 'yellow',
  جزئي: 'yellow',
  ملغي: 'red',
  متأخر: 'red',
  'غير قابلة للبيع': 'red',
  مباعة: 'indigo',
  مرحل: 'indigo',
  'محوّل لعقد': 'indigo',
  مؤجرة: 'sky',
  مجدد: 'sky',
  منتهي: 'neutral',
  معلق: 'neutral',
  مرتجع: 'neutral',
  مرتجعة: 'neutral',
} as const satisfies Record<string, BadgeTone>

export type KnownStatus = keyof typeof STATUS_TONE

export function getStatusTone(status: string): BadgeTone {
  return (STATUS_TONE as Record<string, BadgeTone>)[status.trim()] ?? 'neutral'
}

export type BadgeProps = ComponentProps<'span'> & {
  tone?: BadgeTone
}

/** Pill badge with a leading status dot. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return <span className={cn('badge', `badge-${tone}`, className)} {...props} />
}

export type StatusBadgeProps = Omit<BadgeProps, 'children'> & {
  // `string & {}` keeps autocomplete for known statuses while accepting any label.
  status: KnownStatus | (string & {})
}

/** Renders a status label with its mapped tone; pass `tone` to override. */
export function StatusBadge({ status, tone, ...props }: StatusBadgeProps) {
  return (
    <Badge tone={tone ?? getStatusTone(status)} {...props}>
      {status}
    </Badge>
  )
}
