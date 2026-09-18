import { expect, test } from '@playwright/test'

import { STORAGE_STATE } from './global-setup'

/**
 * THE FALSIFICATION TEST, plus the state machine it depends on.
 *
 * ## What is actually being falsified
 *
 * D3 claims `revalidatePath('/blog/<slug>')` with a LITERAL path invalidates the ISR shell -
 * including clearing a cached 404 for a slug that 404'd before it was published. That claim
 * is the load-bearing one for the whole publish flow, and if it is false the symptom is not
 * an error: it is a post the author published being invisible for up to 300 seconds, with a
 * green response and nothing in any log.
 *
 * The documented pattern form `revalidatePath('/blog/[blog-slug]', 'page')` was measured as a
 * complete no-op on this exact Next version. So this test is here to catch the day somebody
 * "corrects" the literal form to the documented one.
 *
 * ## Why this cannot be a vitest test
 *
 * Two reasons, and the second is the one that forces Playwright specifically.
 *
 * `revalidatePath` throws `Invariant: static generation store missing` outside a Next request
 * context, so any handler containing it cannot be invoked directly from a unit test at all.
 *
 * And `next dev` re-renders every request, so ISR does not behave like production: under dev
 * this test passes whether or not `revalidatePath` does anything. `playwright.config.ts`
 * therefore runs `next build && next start` - that is what makes the assertion mean
 * something.
 */
test.use({ storageState: STORAGE_STATE })

const SLUG = `e2e-falsification-${Date.now()}`
let postId = ''

test.describe.configure({ mode: 'serial' })

test('the slug 404s before it exists, and the 404 gets cached', async ({ request }) => {
  const res = await request.get(`/blog/${SLUG}`)
  expect(res.status()).toBe(404)
})

test('create a draft', async ({ request }) => {
  const res = await request.post('/api/admin/blog', {
    data: { slug: SLUG, title: 'Falsification test post' },
  })
  expect(res.status()).toBe(201)
  postId = (await res.json()).id
  expect(postId).toBeTruthy()
})

test('a draft is still 404 publicly', async ({ request }) => {
  expect((await request.get(`/blog/${SLUG}`)).status()).toBe(404)
})

test('THE FALSIFICATION: publishing makes the post immediately readable', async ({ request }) => {
  const patch = await request.patch(`/api/admin/blog/${postId}`, {
    data: {
      status: 'published',
      bodyMarkdown: '# Heading\n\n```ts\nconst x: number = 1\n```\n',
      excerpt: 'A post created by the e2e suite.',
    },
  })
  expect(patch.status()).toBe(200)

  // No wait, no retry, no polling. The point is that it is readable NOW - if this needs a
  // sleep to pass, revalidatePath did not do its job and the 300s window did.
  const res = await request.get(`/blog/${SLUG}`)
  expect(
    res.status(),
    'revalidatePath did not clear the cached 404. If the literal path was "corrected" to the pattern form, that is why - it is a measured no-op.'
  ).toBe(200)

  const html = await res.text()
  expect(html).toContain('Falsification test post')
  // Rendered at save time by the real pipeline, Shiki included.
  expect(html, 'bodyHtml was not rendered through the pipeline').toContain('shiki')
})

test('the published post appears in the sitemap and the feed', async ({ request }) => {
  expect(await (await request.get('/sitemap.xml')).text()).toContain(`/blog/${SLUG}`)
  expect(await (await request.get('/blog/rss.xml')).text()).toContain(`/blog/${SLUG}`)
})

test('the slug is frozen once published (409)', async ({ request }) => {
  const res = await request.patch(`/api/admin/blog/${postId}`, { data: { slug: `${SLUG}-renamed` } })
  expect(res.status()).toBe(409)
  expect((await res.json()).error).toContain('frozen')
})

test('archived then back to draft is refused (409)', async ({ request }) => {
  expect((await request.patch(`/api/admin/blog/${postId}`, { data: { status: 'archived' } })).status()).toBe(200)

  const res = await request.patch(`/api/admin/blog/${postId}`, { data: { status: 'draft' } })
  expect(
    res.status(),
    'archived → draft unlocks the slug of a URL that was public and is indexed'
  ).toBe(409)
})

test('re-publishing does not reset publishedAt', async ({ request }) => {
  const before = (await (await request.get(`/api/admin/blog/${postId}`)).json()).post.publishedAt
  expect(before).toBeTruthy()

  await request.patch(`/api/admin/blog/${postId}`, { data: { status: 'published' } })

  const after = (await (await request.get(`/api/admin/blog/${postId}`)).json()).post.publishedAt
  expect(after, 'publishedAt moved - every feed reader is told a months-old post is new').toBe(before)
})

test('delete is soft, 404s the page, and clears it from the sitemap', async ({ request }) => {
  expect((await request.delete(`/api/admin/blog/${postId}`)).status()).toBe(200)

  // S-17 / F12: a control run proved that without revalidatePublishedPost on DELETE, the
  // deleted post still served and the sitemap still listed it.
  expect((await request.get(`/blog/${SLUG}`)).status()).toBe(404)
  expect(await (await request.get('/sitemap.xml')).text()).not.toContain(`/blog/${SLUG}`)

  // Soft: the slug is retained, so a new post cannot inherit its contact attributions.
  const retry = await request.post('/api/admin/blog', { data: { slug: SLUG, title: 'Reuse' } })
  expect(retry.status(), 'the slug was freed - a new post can inherit old attributions').toBe(409)
  expect((await retry.json()).error).toContain('deleted post still holds this slug')
})
