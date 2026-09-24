import { expect, test } from '@playwright/test'

import { STORAGE_STATE } from './global-setup'

/**
 * A kind relabel refreshes `/blog` on the next load, under `next start` (mcp-plan.md C8).
 *
 * ```
 *   kind (eyebrow on, label A) ──▶ a published post of that kind ──▶ /blog shows A
 *   PATCH the kind's label to B ──▶ taxonomy-service: save ──▶ revalidatePath('/blog')
 *   /blog, no wait ──▶ shows B, not A
 * ```
 *
 * The plan asked for this through the MCP's `save_taxonomy`; that tool was cut from the
 * registry (acceptance.md D1), so it runs through the admin route, which calls the same
 * `taxonomy-service` - the revalidation under test lives there, not in either front door.
 *
 * Runs only against a disposable database (global-setup refuses anything else).
 */
test.use({ storageState: STORAGE_STATE })
test.describe.configure({ mode: 'serial' })

const RUN = Date.now()

test('a kind relabel is on /blog at the next load', async ({ request }) => {
  const before = `Field note ${RUN}`
  const after = `Quick take ${RUN}`

  const kind = await request.post('/api/admin/blog/kinds', {
    data: { slug: `e2e-kind-${RUN}`, label: before, eyebrow: true },
  })
  expect(kind.ok()).toBe(true)
  const kindId = (await kind.json()).kind.id

  const created = await request.post('/api/admin/blog', {
    data: { slug: `e2e-taxonomy-${RUN}`, title: `Taxonomy post ${RUN}` },
  })
  expect(created.status()).toBe(201)
  const postId = (await created.json()).id
  const published = await request.patch(`/api/admin/blog/${postId}`, {
    data: {
      kind: `e2e-kind-${RUN}`,
      status: 'published',
      bodyMarkdown: '## Section\n\nA post for the taxonomy check.',
    },
  })
  expect(published.ok()).toBe(true)

  expect(await (await request.get('/blog')).text()).toContain(before)

  const relabelled = await request.patch(`/api/admin/blog/kinds/${kindId}`, {
    data: { label: after },
  })
  expect(relabelled.ok()).toBe(true)

  // No wait, no retry: the point is that /blog is fresh NOW.
  const html = await (await request.get('/blog')).text()
  expect(html).toContain(after)
  expect(html).not.toContain(before)

  // Leave the disposable database tidy enough for the next run.
  await request.patch(`/api/admin/blog/${postId}`, {
    data: { status: 'archived' },
  })
})
