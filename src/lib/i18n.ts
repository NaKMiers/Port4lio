/**
 * Locale handling for the `(choice)` route group only.
 *
 * The portfolio in `(me)` stays English and is NOT localized - the audience there is
 * recruiters and clients reading English, and its content comes from a single-copy Mongo
 * document. Only `/[lang]/mbti/*` is bilingual, which is why `lang` lives on the
 * `(choice)` layout rather than on the root layout.
 *
 * URLs carry the locale (`/vi/mbti`, `/en/mbti`) instead of varying content at one URL.
 * The whole growth loop is people sending each other links: a link that renders a
 * different language depending on who opens it is a link you cannot reason about, and
 * search engines would index exactly one of the two versions.
 */

export const LOCALES = ['vi', 'en'] as const

export type Locale = (typeof LOCALES)[number]

/**
 * Vietnamese, not English. `Accept-Language` decides for real visitors; this only covers
 * requests that express no preference (crawlers, curl, stripped proxies), and the product
 * is aimed at a Vietnamese audience.
 */
export const DEFAULT_LOCALE: Locale = 'vi'

export function isLocale(value: string | undefined): value is Locale {
  return (
    typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
  )
}

/** Human-readable name for the language switcher, written in the language itself. */
export const LOCALE_LABELS: Record<Locale, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
}

/**
 * Rewrites a `(choice)` path to the same page in another locale.
 *
 * Every URL in the group is `/<locale>/mbti/...`, so switching language is a segment
 * swap rather than a table of route pairs. This matters most on the result page:
 * `/vi/mbti/result/<token>` → `/en/mbti/result/<token>` keeps the token, so changing
 * language does not throw away the result someone just earned.
 *
 * Lives here rather than next to the switcher component so it can be tested as the pure
 * string function it is, without pulling the Next router into a unit test.
 */
export function swapLocale(pathname: string, target: Locale): string {
  const segments = pathname.split('/')
  // Index 1, because a leading slash puts an empty string at index 0.
  if (isLocale(segments[1])) {
    segments[1] = target
    return segments.join('/')
  }
  // No locale prefix. Shouldn't happen inside `(choice)`, but a wrong guess should still
  // land on a real page rather than build `/en//mbti` or double-prefix the path.
  //
  // The product is read from the path rather than hardcoded: this used to always return
  // `/mbti`, which would have sent an IQ visitor to the MBTI landing page on a language
  // switch. The happy path above never needed changing - it is a segment swap and has
  // always been product-agnostic - so only this fallback carried the assumption.
  const product =
    PRODUCTS.find(candidate => segments[1] === candidate) ?? DEFAULT_PRODUCT
  return `/${target}/${product}`
}

/** Test products under `(choice)`. Order matters only for `DEFAULT_PRODUCT`. */
const PRODUCTS = ['mbti', 'iq'] as const
const DEFAULT_PRODUCT = PRODUCTS[0]

/**
 * Picks a locale from an `Accept-Language` header.
 *
 * Deliberately small rather than pulling in a full BCP-47 negotiator: we support exactly
 * two languages, so the entire decision is "does the ordered preference list mention `vi`
 * or `en` first". Quality values are honoured because browsers do send them
 * (`en-US,en;q=0.9,vi;q=0.8`), and ignoring them picks the wrong language for anyone whose
 * second choice is listed first alphabetically.
 */
export function negotiateLocale(
  acceptLanguage: string | null | undefined
): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE

  const ranked = acceptLanguage
    .split(',')
    .map(part => {
      const [tag, ...params] = part.trim().split(';')
      const qParam = params.find(p => p.trim().startsWith('q='))
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1
      return {
        // `en-US` and `en` both mean English here.
        base: tag.trim().toLowerCase().split('-')[0],
        q: Number.isFinite(q) ? q : 0,
      }
    })
    .filter(entry => entry.q > 0)
    .sort((a, b) => b.q - a.q)

  for (const entry of ranked) if (isLocale(entry.base)) return entry.base

  return DEFAULT_LOCALE
}
