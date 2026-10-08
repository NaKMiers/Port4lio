import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `lib/blog/sitemap-resubmit.ts` - the publish hook itself.
 *
 * `after` is mocked in THIS file only; every other test mocks this whole module instead (the
 * `revalidate.ts` pattern). What matters here: an unconfigured site makes no call at all, and
 * nothing the hook does can throw into a publish.
 */

const after = vi.hoisted(() => vi.fn())
const config = vi.hoisted(() => vi.fn())
const resubmit = vi.hoisted(() => vi.fn())

vi.mock('next/server', () => ({ after }))
vi.mock('@/lib/blog/index-status-service', () => ({
  getIndexingConfig: config,
  resubmitSitemap: resubmit,
}))

const { scheduleSitemapResubmit } = await import('@/lib/blog/sitemap-resubmit')

afterEach(() => {
  vi.clearAllMocks()
})

describe('scheduleSitemapResubmit', () => {
  it('does nothing when Search Console is not configured', () => {
    config.mockReturnValue({ configured: false, problem: 'unset' })
    scheduleSitemapResubmit()
    expect(after).not.toHaveBeenCalled()
  })

  it('queues one publish-triggered resubmit after the response', async () => {
    config.mockReturnValue({ configured: true })
    resubmit.mockResolvedValue({ ok: true, value: null })

    scheduleSitemapResubmit()

    expect(after).toHaveBeenCalledTimes(1)
    await (after.mock.calls[0][0] as () => Promise<void>)()
    expect(resubmit).toHaveBeenCalledWith('publish')
  })

  it('swallows every failure: a throwing after(), a failed or throwing resubmit', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    config.mockReturnValue({ configured: true })

    after.mockImplementationOnce(() => {
      throw new Error('after() was called outside a request scope')
    })
    expect(() => scheduleSitemapResubmit()).not.toThrow()

    after.mockImplementation((callback: () => Promise<void>) => callback())
    resubmit.mockResolvedValueOnce({ ok: false, error: 'quota' })
    expect(() => scheduleSitemapResubmit()).not.toThrow()
    resubmit.mockRejectedValueOnce(new Error('db down'))
    expect(() => scheduleSitemapResubmit()).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(log).toHaveBeenCalledTimes(3)
  })
})
