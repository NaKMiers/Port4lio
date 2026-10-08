/**
 * What Google thinks of one post, as a badge on `/admin/blog`.
 *
 * ```
 *   Post.indexStatus (stored by index-status-service)  +  indexing.configured
 *            │
 *            ▼
 *   badgeFor()  ── first match wins ──▶ { label, tone, tooltip[] }
 *     not configured                    Not configured     muted
 *     never checked                     Not checked        muted
 *     first check failed                Check failed       rose
 *     PASS / PARTIAL                    Indexed            green
 *     FAIL                              <short reason>     rose
 *     NEUTRAL / VERDICT_UNSPECIFIED     <short reason>     amber
 *     anything else                     Unknown result     muted
 * ```
 *
 * ## Why this file has no imports
 *
 * The board is a client component and the service that writes `indexStatus` is server-only
 * (mongoose, the service-account key). The rules that turn the stored shape into a badge are
 * needed by the board and by the unit tests, and neither should pull in a database driver to
 * get them - the same reason `image-placeholders.ts` is import-free.
 *
 * ## Why `coverageState` is shortened by lookup, not by slicing
 *
 * Google's strings are long ("Crawled - currently not indexed") and the row has room for a
 * few words. A lookup keeps the label meaningful; an unseen or reworded string still renders,
 * cut at a fixed length, with the full text in the tooltip so nothing Google said is lost.
 */

/** Dates arrive as `Date` on the server and as ISO strings in the board's JSON. */
type DateLike = Date | string | null | undefined

export type IndexStatus = {
  verdict?: string | null
  coverageState?: string | null
  indexingState?: string | null
  robotsTxtState?: string | null
  pageFetchState?: string | null
  lastCrawlTime?: DateLike
  googleCanonical?: string | null
  userCanonical?: string | null
  inspectionResultLink?: string | null
  checkedAt?: DateLike
  lastError?: string | null
  lastErrorAt?: DateLike
}

export type IndexingSummary = {
  configured: boolean
  problem: string | null
}

export type BadgeTone = 'green' | 'amber' | 'rose' | 'muted'

export type IndexBadge = {
  label: string
  tone: BadgeTone
  /** A newer re-check failed while an older result is still shown. */
  staleError: boolean
  /** Tooltip lines, most important first. */
  details: string[]
  /** Only a Search Console URL - never whatever string came back in the field. */
  link: string | null
}

const SHORT_LABELS: Record<string, string> = {
  'Submitted and indexed': 'Indexed',
  'Indexed, not submitted in sitemap': 'Indexed',
  'Crawled - currently not indexed': 'Crawled - not indexed',
  'Discovered - currently not indexed': 'Discovered - not indexed',
  'URL is unknown to Google': 'Unknown to Google',
  'Duplicate, Google chose different canonical than user':
    'Duplicate canonical',
  'Duplicate without user-selected canonical': 'Duplicate',
  'Alternate page with proper canonical tag': 'Alternate page',
  'Excluded by ‘noindex’ tag': 'noindex',
  "Excluded by 'noindex' tag": 'noindex',
  'Blocked by robots.txt': 'Blocked by robots.txt',
  'Page with redirect': 'Redirect',
  'Not found (404)': '404',
  'Soft 404': 'Soft 404',
  'Server error (5xx)': 'Server error',
}

export const SHORT_LABEL_MAX = 28

export function shortCoverageLabel(
  coverageState: string | null | undefined
): string {
  const raw = (coverageState ?? '').trim()
  if (!raw) return 'Not indexed'
  const known = SHORT_LABELS[raw]
  if (known) return known
  return raw.length > SHORT_LABEL_MAX
    ? `${raw.slice(0, SHORT_LABEL_MAX - 1).trimEnd()}…`
    : raw
}

function time(value: DateLike): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function day(value: DateLike): string | null {
  const ms = time(value)
  return ms === null ? null : new Date(ms).toLocaleDateString('en-GB')
}

const SEARCH_CONSOLE_LINK = /^https:\/\/search\.google\.com\//

/** The diagnostic lines that say WHY, beyond the badge label. */
export function warningLines(status: IndexStatus): string[] {
  const lines: string[] = []
  if (status.indexingState && status.indexingState !== 'INDEXING_ALLOWED')
    lines.push(`Indexing: ${status.indexingState}`)
  if (status.robotsTxtState && status.robotsTxtState !== 'ALLOWED')
    lines.push(`robots.txt: ${status.robotsTxtState}`)
  if (status.pageFetchState && status.pageFetchState !== 'SUCCESSFUL')
    lines.push(`Fetch: ${status.pageFetchState}`)
  if (
    status.googleCanonical &&
    status.userCanonical &&
    status.googleCanonical !== status.userCanonical
  )
    lines.push(`Google chose ${status.googleCanonical}`)
  return lines
}

export function badgeFor(
  status: IndexStatus | null | undefined,
  indexing: IndexingSummary
): IndexBadge {
  const none = { staleError: false, link: null }

  if (!indexing.configured)
    return {
      ...none,
      label: 'Not configured',
      tone: 'muted',
      details: [indexing.problem ?? 'Search Console is not set up.'],
    }

  const checkedAt = time(status?.checkedAt)
  const lastErrorAt = time(status?.lastErrorAt)

  if (checkedAt === null) {
    if (status?.lastError)
      return {
        ...none,
        label: 'Check failed',
        tone: 'rose',
        details: [status.lastError],
      }
    return {
      ...none,
      label: 'Not checked',
      tone: 'muted',
      details: ['Not checked yet.'],
    }
  }

  const current = status as IndexStatus
  const details: string[] = []
  if (current.coverageState) details.push(current.coverageState)
  details.push(...warningLines(current))
  details.push(`Checked ${day(current.checkedAt)}`)
  const crawled = day(current.lastCrawlTime)
  details.push(crawled ? `Crawled ${crawled}` : 'Never crawled')

  const staleError =
    Boolean(current.lastError) &&
    lastErrorAt !== null &&
    lastErrorAt > checkedAt
  if (staleError) details.unshift(`Last re-check failed: ${current.lastError}`)

  const link =
    current.inspectionResultLink &&
    SEARCH_CONSOLE_LINK.test(current.inspectionResultLink)
      ? current.inspectionResultLink
      : null
  const base = { staleError, details, link }

  switch (current.verdict) {
    case 'PASS':
      return { ...base, label: 'Indexed', tone: 'green' }
    case 'PARTIAL':
      return { ...base, label: 'Indexed, warnings', tone: 'green' }
    case 'FAIL':
      return {
        ...base,
        label: shortCoverageLabel(current.coverageState),
        tone: 'rose',
      }
    case 'NEUTRAL':
    case 'VERDICT_UNSPECIFIED':
      return {
        ...base,
        label: shortCoverageLabel(current.coverageState),
        tone: 'amber',
      }
    default:
      return { ...base, label: 'Unknown result', tone: 'muted' }
  }
}
