import { NextResponse, type NextRequest } from 'next/server'

import { LOCALES, negotiateLocale } from '@/lib/i18n'

/**
 * Adds the locale to bare `/mbti` URLs (Next 16 `proxy` convention, formerly `middleware`).
 *
 * ```
 *   GET /mbti          ──▶ Accept-Language ──▶ 307 /vi/mbti  (or /en/mbti)
 *   GET /mbti/enfj     ──▶ Accept-Language ──▶ 307 /vi/mbti/enfj
 *   GET /vi/mbti       ──▶ pass through
 *   GET /  or  /cv     ──▶ never reaches here (see `matcher`)
 * ```
 *
 * Browser language decides the default, but the answer is written into the URL rather
 * than varying the response at one address. This product's entire growth mechanic is one
 * person sending another a link; a URL that renders differently per visitor is a link
 * nobody can reason about, and search engines would index exactly one of the two versions
 * while `hreflang` claimed both existed.
 *
 * 307 and not 308: the locale a visitor is sent to depends on their headers, so this
 * redirect is per-request rather than permanent. A cached 308 in someone's browser would
 * pin them to whichever language they happened to be sent to first, forever.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const locale = negotiateLocale(request.headers.get('accept-language'))
  const url = request.nextUrl.clone()
  url.pathname = `/${locale}${pathname}`

  return NextResponse.redirect(url, 307)
}

export const config = {
  /**
   * Only unprefixed `/mbti` paths. Everything else - the portfolio at `/`, `/cv`,
   * `/api/*`, `/_next/*`, files with extensions, and already-prefixed `/vi|/en` paths -
   * skips this proxy entirely, so the portfolio's static rendering is untouched.
   *
   * Kept as an explicit list rather than a negative lookahead: the failure mode of a
   * too-broad matcher here is redirecting the portfolio into a locale that does not
   * exist, and an allowlist cannot do that.
   */
  matcher: ['/mbti', '/mbti/:path*'],
}

/** Exported for the proxy test; not used at runtime. */
export const SUPPORTED_LOCALES = LOCALES
