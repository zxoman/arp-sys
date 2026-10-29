import type { ReactNode, SVGProps } from 'react'
import { cn } from '@/lib/cn'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** 24×24 stroke icons (Lucide geometry). Decorative by default; label the control, not the icon. */
function icon(name: string, paths: ReactNode, rtlFlip = false) {
  function Icon({ size = 18, className, ...props }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={cn('shrink-0', rtlFlip && 'rtl:-scale-x-100', className)}
        {...props}
      >
        {paths}
      </svg>
    )
  }
  Icon.displayName = name
  return Icon
}

export const IconChevronDown = icon('IconChevronDown', <path d="m6 9 6 6 6-6" />)
/** Points toward the reading start (right in RTL). */
export const IconChevronPrev = icon('IconChevronPrev', <path d="m15 18-6-6 6-6" />, true)
/** Points toward the reading end (left in RTL). */
export const IconChevronNext = icon('IconChevronNext', <path d="m9 18 6-6-6-6" />, true)
export const IconX = icon('IconX', <path d="M18 6 6 18M6 6l12 12" />)
export const IconImage = icon(
  'IconImage',
  <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>,
)
export const IconSearch = icon('IconSearch', <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>)
export const IconCalendar = icon(
  'IconCalendar',
  <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
)
export const IconCheck = icon('IconCheck', <path d="M20 6 9 17l-5-5" />)
export const IconPlus = icon('IconPlus', <path d="M5 12h14M12 5v14" />)
export const IconMinus = icon('IconMinus', <path d="M5 12h14" />)
export const IconArrowUp = icon('IconArrowUp', <path d="m5 12 7-7 7 7M12 19V5" />)
export const IconDownload = icon(
  'IconDownload',
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
)
export const IconInfo = icon('IconInfo', <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>)
export const IconAlert = icon(
  'IconAlert',
  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01" />,
)
export const IconCheckCircle = icon('IconCheckCircle', <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>)
export const IconXCircle = icon('IconXCircle', <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>)
export const IconPencil = icon(
  'IconPencil',
  <path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4" />,
)
export const IconTrash = icon(
  'IconTrash',
  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
)
export const IconEye = icon(
  'IconEye',
  <><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" /><circle cx="12" cy="12" r="3" /></>,
)
export const IconMore = icon(
  'IconMore',
  <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>,
)
export const IconBuilding = icon(
  'IconBuilding',
  <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" /></>,
)
export const IconUsers = icon(
  'IconUsers',
  <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><circle cx="9" cy="7" r="4" /></>,
)
export const IconWallet = icon(
  'IconWallet',
  <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />,
)
export const IconWrench = icon(
  'IconWrench',
  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
)
export const IconFile = icon(
  'IconFile',
  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M16 13H8M16 17H8M10 9H8" />,
)
export const IconSave = icon(
  'IconSave',
  <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7" />,
)
export const IconTrendUp = icon('IconTrendUp', <path d="M22 7 13.5 15.5l-5-5L2 17M16 7h6v6" />)
export const IconTrendDown = icon('IconTrendDown', <path d="M22 17 13.5 8.5l-5 5L2 7M16 17h6v-6" />)
export const IconRefresh = icon(
  'IconRefresh',
  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5" />,
)
export const IconSun = icon(
  'IconSun',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </>,
)
export const IconMoon = icon('IconMoon', <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />)
export const IconLayers = icon(
  'IconLayers',
  <>
    <path d="m12 2 10 5-10 5L2 7Z" />
    <path d="m2 17 10 5 10-5M2 12l10 5 10-5" />
  </>,
)
export const IconPhone = icon(
  'IconPhone',
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />,
)
