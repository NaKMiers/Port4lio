import { revalidatePath } from 'next/cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { revalidatePublishedPost } from '@/lib/blog/revalidate'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

/**
 * The four cache surfaces a post appears on, and the one call shape that actually clears them.
 *
 * ## Why a test exists for four lines of function body
 *
 * Because the correct version looks wrong and the wrong version looks correct. Next's own
 * documentation points at the pattern form for a dynamic segment:
 *
 * ```js
 *   revalidatePath('/blog/[blog-slug]', 'page')   // measured as a complete no-op on 16.2.6
 * ```
 *
 * and `src/lib/blog/revalidate.ts` carries a long comment saying that form invalidated nothing
 * against this repo's exact `node_modules`. A future reader who trusts the docs over the
 * comment will "fix" it, every existing test will still pass, and publishing will break with no
 * error anywhere - the symptom is a post that is invisible for up to `revalidate` seconds and a
 * sitemap that keeps serving the old date.
 *
 * That is what this file is for. It is not testing Next; it is making the measurement the
 * comment describes into something that fails a build when it is undone.
 *
 * ## What it deliberately does not test
 *
 * Whether the invalidation worked. `revalidatePath` needs a static-generation store that only
 * exists inside a real request, so the falsification run is Playwright against a production
 * server. This file asserts the call, which is the part a refactor can break.
 */

const mockedRevalidatePath = vi.mocked(revalidatePath)

beforeEach(() => {
  mockedRevalidatePath.mockReset()
})

describe('every surface a post can appear on', () => {
  it('clears the index, the post, the sitemap and the feed', () => {
    revalidatePublishedPost('measuring-revalidatepath')

    const paths = mockedRevalidatePath.mock.calls.map(([path]) => path)

    expect(paths).toEqual([
      '/blog',
      '/blog/measuring-revalidatepath',
      '/sitemap.xml',
      '/blog/rss.xml',
    ])
  })

  it('clears nothing else', () => {
    // A fifth path here would be a page being invalidated on every publish for no reason, which
    // is invisible until it is a cost.
    revalidatePublishedPost('a-post')

    expect(mockedRevalidatePath).toHaveBeenCalledTimes(4)
  })
})

describe('the literal path, which is the whole point', () => {
  it('expands the slug instead of passing the route pattern', () => {
    revalidatePublishedPost('a-post')

    expect(mockedRevalidatePath).toHaveBeenCalledWith('/blog/a-post')
    expect(mockedRevalidatePath).not.toHaveBeenCalledWith(
      '/blog/[blog-slug]',
      'page'
    )
  })

  it('never passes the second "page" argument to any call', () => {
    // The type argument is what the documented pattern form needs. Nothing here should have
    // one, so its appearance is the signature of exactly the regression this file guards.
    revalidatePublishedPost('a-post')

    for (const call of mockedRevalidatePath.mock.calls)
      expect(call).toHaveLength(1)
  })

  it('builds the post path from the slug it was given', () => {
    revalidatePublishedPost('another-slug-entirely')

    expect(mockedRevalidatePath).toHaveBeenCalledWith(
      '/blog/another-slug-entirely'
    )
  })
})

describe('failure is not swallowed', () => {
  it('lets a revalidatePath throw reach the caller', () => {
    /*
      The tempting change is a try/catch, because `revalidatePath` throws
      "Invariant: static generation store missing" outside a request context. Catching here
      would convert "invalidation failed" into "invalidation appeared to succeed" - the exact
      failure `lib/ccaf/progress-data.ts` already recorded once on this site: stale data behind
      a green response, expensive to debug because every layer reported success.

      A throw surfaces as a 500 on a mutating admin request, which the owner sees and can retry.
    */
    mockedRevalidatePath.mockImplementationOnce(() => {
      throw new Error('Invariant: static generation store missing')
    })

    expect(() => revalidatePublishedPost('a-post')).toThrow('Invariant')
  })

  it('does not fall back to revalidating fewer paths when one throws', () => {
    // Half-invalidated is a state nobody can reason about. The first throw stops the sequence,
    // and the log line written before the calls is what says which slug was mid-flight.
    mockedRevalidatePath.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    expect(() => revalidatePublishedPost('a-post')).toThrow()
    expect(mockedRevalidatePath).toHaveBeenCalledTimes(1)
  })
})
