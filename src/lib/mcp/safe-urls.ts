import 'server-only'

import { isAllowedImageUrl } from '@/lib/blog/rehype-restrict-image-hosts'

/**
 * The URL rule for anything an agent writes that the public site renders: a profile section
 * (`update_profile`) and a CV (`update_cv`). One rule, two callers - `profile-service.ts`
 * and `cv/cv-service.ts` - so the two front doors cannot drift (multi-cv-plan.md IT10).
 *
 * ```
 *   unsafeUrls(next, current)
 *     urlsIn(next)     every non-empty string under an image key or a link key, any depth
 *       image keys     avatar · backgroundImage · image · photo (the CV masthead)
 *       link keys      link · href · cv
 *     minus urlsIn(current)                    already stored ──▶ passes, never re-judged
 *     image  not this site's Cloudinary        ──▶ unsafe   (the blog pipeline's own rule)
 *     link   not http: / https: / mailto:      ──▶ unsafe   (javascript:, data:, relative)
 * ```
 *
 * ## Why a URL already stored passes
 *
 * An agent re-sending a whole section or CV with a typo fixed must not be refused over an
 * avatar the owner uploaded years ago, from a host the rule would now reject. Only a URL the
 * agent INTRODUCES is judged: a third-party tracking pixel, or a `javascript:` href.
 *
 * ## Why the keys are a fixed list
 *
 * The shapes are ours (`types/profile.ts`), and every image or link they render sits under
 * one of these names. Judging every string that parses as a URL would refuse plain text
 * ("see example.com") the page prints as text, never as a link.
 */

const IMAGE_KEYS = new Set(['avatar', 'backgroundImage', 'image', 'photo'])
const LINK_KEYS = new Set(['link', 'href', 'cv'])
const MAX_DEPTH = 12

export type FoundUrls = { images: Set<string>; links: Set<string> }

/** Every string under an image or link key, anywhere in `value`. */
export function urlsIn(
  value: unknown,
  into: FoundUrls = { images: new Set(), links: new Set() },
  depth = 0
): FoundUrls {
  if (depth > MAX_DEPTH || !value || typeof value !== 'object') return into
  for (const [key, entry] of Object.entries(value))
    if (typeof entry === 'string' && entry) {
      if (IMAGE_KEYS.has(key)) into.images.add(entry)
      else if (LINK_KEYS.has(key)) into.links.add(entry)
    } else urlsIn(entry, into, depth + 1)

  return into
}

export function isSafeLink(value: string): boolean {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** The URLs `next` introduces over `current` that the public site must not render. */
export function unsafeUrls(next: unknown, current: unknown): string[] {
  const before = urlsIn(current)
  const after = urlsIn(next)
  return [
    ...[...after.images].filter(
      url => !before.images.has(url) && !isAllowedImageUrl(url)
    ),
    ...[...after.links].filter(
      url => !before.links.has(url) && !isSafeLink(url)
    ),
  ]
}

/** The refused URLs as the refusal prints them: quoted, each cut to 120 characters. */
export function listUnsafe(urls: readonly string[]): string {
  return urls.map(url => JSON.stringify(url.slice(0, 120))).join(', ')
}
