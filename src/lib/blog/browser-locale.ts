import { isLocale, type Locale } from '@/lib/i18n'

/**
 * The first of the browser's preferred languages the blog has chrome for, or null.
 *
 * `navigator.languages` is already in preference order, so this is the client-side twin of
 * `negotiateLocale` (which ranks an `Accept-Language` header) - minus its `vi` fallback,
 * which suits the test products and not the blog. `vi-VN` and `vi` both mean Vietnamese.
 *
 * In its own module rather than next to `BlogLocaleProvider`: a component file that also
 * exports a plain function makes Fast Refresh fall back to a full reload.
 */
export function browserLocale(): Locale | null {
  const preferred =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language]
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return null
}
