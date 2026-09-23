import type { Metadata } from 'next'

import { t, UI } from '@/lib/ccaf/copy'
import type { Locale } from '@/lib/i18n'

/**
 * Metadata for `/admin/certificates/ccaf`.
 *
 * ## Why there is so little of it
 *
 * This used to be a public page, and carried what a public page carries: a description, a
 * canonical URL, the `vi`/`en`/`x-default` hreflang triple, an OpenGraph article and a
 * Twitter card. Every one of those exists to help something find or render a link to the
 * page. It is owner-only now, so they have nothing left to do - and `robots: noindex` next
 * to an OpenGraph card is a page arguing with itself about whether it wants to be found.
 *
 * `noindex` is belt to `robots.ts`'s braces: a `Disallow` stops the fetch, `noindex` keeps
 * anything that fetched anyway out of the index. `robots.ts` explains why both are wanted.
 */
export function buildCcafMetadata(locale: Locale): Metadata {
  return {
    title: t(UI.pageTitle, locale),
    robots: { index: false, follow: false },
  }
}
