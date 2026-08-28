import {
  collapseWhitespace,
  excerptText,
  sanitizeSocialLinks,
  trimText,
} from '@/lib/profile-copy'
import type { PublicProfile } from '@/lib/profile-public'
import type { SocialLink } from '@/types/profile'

import type { ManualField, RenderContext } from './types'

/**
 * Socials safe to publish outward.
 *
 * `sanitizeSocialLinks` permits `mailto:` and `tel:` (they are legitimate on the site's
 * own contact row). Publishing is different: an email or phone number here would ride
 * into the README badge row and the LinkedIn about text. Strip them.
 */
export function publishableSocials(socials: SocialLink[]): SocialLink[] {
  return sanitizeSocialLinks(socials).filter(social => /^https:\/\//i.test(trimText(social.link)))
}

/** The first published social matching a host hint, if any. */
export function findSocialByHost(socials: SocialLink[], host: string): SocialLink | undefined {
  return publishableSocials(socials).find(social => {
    try {
      return new URL(social.link).hostname.replace(/^www\./, '').includes(host)
    } catch {
      return false
    }
  })
}

/** Builds a paste-safe field that also reports how much was cut. */
export function manualField(
  key: string,
  label: string,
  limit: number,
  raw: string,
  hint?: string
): ManualField {
  const source = collapseWhitespace(raw)
  const value = excerptText(source, limit)
  return {
    key,
    label,
    limit,
    value,
    sourceLength: source.length,
    overflow: source.length > limit,
    ...(hint ? { hint } : {}),
  }
}

/** Multi-line field (skills lists, about text) - newlines preserved, still capped. */
export function manualBlockField(
  key: string,
  label: string,
  limit: number,
  raw: string,
  hint?: string
): ManualField {
  const source = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const value = source.length <= limit ? source : `${source.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
  return {
    key,
    label,
    limit,
    value,
    sourceLength: source.length,
    overflow: source.length > limit,
    ...(hint ? { hint } : {}),
  }
}

const PERIOD_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function utcDate(iso: string): Date | null {
  const raw = trimText(iso)
  if (!raw) return null
  const d = new Date(raw)
  return Number.isFinite(d.getTime()) ? d : null
}

/**
 * Readable date range for published artifacts.
 *
 * A pure sibling of `formatPortfolioPeriod`, which calls `Date.now()` internally. Taking
 * `now` from {@link RenderContext} keeps artifacts - and therefore version hashes -
 * stable across calls.
 */
export function formatPublishPeriod(start: string, end: string, now: Date): string {
  const s = utcDate(start)
  const e = utcDate(end)
  const endRaw = trimText(end).toLowerCase()
  const ongoing =
    !endRaw ||
    endRaw === 'present' ||
    endRaw === 'now' ||
    endRaw === 'current' ||
    (e !== null && e.getTime() > now.getTime())

  const startLabel = s ? PERIOD_FORMATTER.format(s) : trimText(start)
  const endLabel = ongoing ? 'Present' : e ? PERIOD_FORMATTER.format(e) : trimText(end)

  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`
  return startLabel || endLabel || ''
}

/** Display name used across every artifact. */
export function displayName(profile: PublicProfile): string {
  return collapseWhitespace(profile.fullName) || collapseWhitespace(profile.username) || ''
}

/** The site URL a platform's "website" field should point at. */
export function siteUrl(ctx: RenderContext): string {
  return ctx.siteOrigin.replace(/\/+$/, '')
}
