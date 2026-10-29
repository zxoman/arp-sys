import logo from '@/assets/codex-logo.jpg'
import { cn } from '@/lib/cn'

/** The developer company's name, shown in capitals wherever the product is branded. */
export const BRAND_NAME = 'CODEX CONTROL'

/** Codex logo on its own black tile; the artwork has built-in padding, so it is scaled up to fill the tile. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden rounded-ctl bg-black shadow-[0_8px_18px_-6px_rgba(220,38,38,0.55)] ring-1 ring-red-500/30', className)}
    >
      <img src={logo} alt="شعار Codex Control" draggable={false} className="size-full scale-[1.4] object-cover" />
    </span>
  )
}
