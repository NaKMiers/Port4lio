import { describe, expect, it } from 'vitest'

import {
  badgeFor,
  SHORT_LABEL_MAX,
  shortCoverageLabel,
  warningLines,
  type IndexStatus,
} from '@/lib/blog/index-status-badge'

/**
 * `lib/blog/index-status-badge.ts` - stored status to badge, the table in
 * `docs/designs/blog-index/blog-index-status.md` ("Badge mapping").
 */

const on = { configured: true, problem: null }
const checked = (over: IndexStatus = {}): IndexStatus => ({
  checkedAt: '2026-10-05T00:00:00.000Z',
  ...over,
})

describe('badgeFor', () => {
  it.each<[string, IndexStatus | null, string, string]>([
    ['never checked', null, 'Not checked', 'muted'],
    [
      'first check failed',
      { lastError: 'quota', lastErrorAt: '2026-10-05T00:00:00Z' },
      'Check failed',
      'rose',
    ],
    ['PASS', checked({ verdict: 'PASS' }), 'Indexed', 'green'],
    ['PARTIAL', checked({ verdict: 'PARTIAL' }), 'Indexed, warnings', 'green'],
    [
      'FAIL',
      checked({ verdict: 'FAIL', coverageState: 'Blocked by robots.txt' }),
      'Blocked by robots.txt',
      'rose',
    ],
    [
      'NEUTRAL',
      checked({
        verdict: 'NEUTRAL',
        coverageState: 'Crawled - currently not indexed',
      }),
      'Crawled - not indexed',
      'amber',
    ],
    [
      'VERDICT_UNSPECIFIED',
      checked({
        verdict: 'VERDICT_UNSPECIFIED',
        coverageState: 'URL is unknown to Google',
      }),
      'Unknown to Google',
      'amber',
    ],
    ['a checked result with no verdict', checked(), 'Unknown result', 'muted'],
    [
      'an unrecognised verdict',
      checked({ verdict: 'SOMETHING_NEW' }),
      'Unknown result',
      'muted',
    ],
  ])('%s', (_, status, label, tone) => {
    expect(badgeFor(status, on)).toMatchObject({ label, tone })
  })

  it('not configured wins over any stored result, and shows the problem', () => {
    const badge = badgeFor(checked({ verdict: 'PASS' }), {
      configured: false,
      problem: 'Set GSC_SITE_URL',
    })
    expect(badge).toMatchObject({ label: 'Not configured', tone: 'muted' })
    expect(badge.details).toEqual(['Set GSC_SITE_URL'])
  })

  it('a newer failed re-check keeps the old badge and marks it', () => {
    const badge = badgeFor(
      checked({
        verdict: 'PASS',
        lastError: 'Google did not answer',
        lastErrorAt: '2026-10-06T00:00:00Z',
      }),
      on
    )
    expect(badge).toMatchObject({ label: 'Indexed', staleError: true })
    expect(badge.details[0]).toContain('Google did not answer')
  })

  it('an error OLDER than the result is not shown', () => {
    expect(
      badgeFor(
        checked({
          verdict: 'PASS',
          lastError: 'old',
          lastErrorAt: '2026-10-01T00:00:00Z',
        }),
        on
      ).staleError
    ).toBe(false)
  })

  it('links only to Search Console', () => {
    expect(
      badgeFor(
        checked({
          verdict: 'PASS',
          inspectionResultLink:
            'https://search.google.com/search-console/inspect?resource_id=x',
        }),
        on
      ).link
    ).toContain('https://search.google.com/')
    expect(
      badgeFor(
        checked({
          verdict: 'PASS',
          inspectionResultLink: 'javascript:alert(1)',
        }),
        on
      ).link
    ).toBeNull()
  })
})

describe('shortCoverageLabel', () => {
  it('shortens the strings it knows', () => {
    expect(shortCoverageLabel('Discovered - currently not indexed')).toBe(
      'Discovered - not indexed'
    )
  })

  it('cuts an unknown string to a fixed length rather than hiding it', () => {
    const label = shortCoverageLabel(
      'Some brand new reason Google started sending this year'
    )
    expect(label.length).toBe(SHORT_LABEL_MAX)
    expect(label.endsWith('…')).toBe(true)
    expect(shortCoverageLabel('Short new reason')).toBe('Short new reason')
    expect(shortCoverageLabel(null)).toBe('Not indexed')
  })
})

describe('warningLines', () => {
  it('names a noindex, a robots block, a failed fetch and a canonical Google overrode', () => {
    expect(
      warningLines({
        indexingState: 'BLOCKED_BY_META_TAG',
        robotsTxtState: 'DISALLOWED',
        pageFetchState: 'NOT_FOUND',
        googleCanonical: 'https://example.com/b',
        userCanonical: 'https://example.com/a',
      })
    ).toEqual([
      'Indexing: BLOCKED_BY_META_TAG',
      'robots.txt: DISALLOWED',
      'Fetch: NOT_FOUND',
      'Google chose https://example.com/b',
    ])
    expect(
      warningLines({
        indexingState: 'INDEXING_ALLOWED',
        robotsTxtState: 'ALLOWED',
        pageFetchState: 'SUCCESSFUL',
      })
    ).toEqual([])
  })
})
