// Text helpers shared by the kit's search, numeric and date inputs.

const DIGITS: Record<string, string> = {}
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (DIGITS[d] = String(i)))
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => (DIGITS[d] = String(i)))

/** Converts Arabic-Indic / Persian digits and separators to ASCII (`١٢٫٥` → `12.5`). */
export function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]).replace(/٫/g, '.').replace(/٬/g, ',')
}

/**
 * Folds text for forgiving Arabic search: strips diacritics and tatweel, unifies alef/yaa/taa
 * marbuta forms, converts digits and lowercases Latin. `أحمد` matches `احمد`, `فاطمة` matches `فاطمه`.
 */
export function normalizeSearch(value: string): string {
  return toLatinDigits(value)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when every whitespace-separated term of `query` occurs in `haystack` (both pre-normalized). */
export function matchesAll(haystack: string, query: string): boolean {
  if (!query) return true
  return query.split(' ').every((term) => haystack.includes(term))
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function isRtl(el: Element | null): boolean {
  return !!el && getComputedStyle(el).direction === 'rtl'
}
