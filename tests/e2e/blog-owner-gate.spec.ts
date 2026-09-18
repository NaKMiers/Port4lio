import { expect, test } from '@playwright/test'

/**
 * All six owner handlers refuse an anonymous caller.
 *
 * ## Why six tests and not one loop over a pattern
 *
 * The thing being asserted is that each handler individually calls `requireOwner`. A test
 * that proves "the pattern is applied" proves nothing about the handler somebody adds next
 * month and forgets, which is the entire failure mode - and a loop over a list maintained in
 * the test file is a list that drifts from the routes it claims to cover.
 *
 * `POST /api/admin/blog/preview` is the one that matters most and reads like it matters
 * least. It writes nothing, so "it is read-only, why gate it" is the reasonable-sounding
 * question. Ungated it is a free stored-XSS harness aimed at our own sanitizer: post
 * arbitrary markdown, read back exactly what the pipeline produced, repeat with no rate
 * limit and no trace in any post until a bypass is found.
 *
 * No storageState here, deliberately. These run in a fresh context - a test asserting that a
 * handler refuses anonymous callers, which accidentally carries an owner cookie, asserts
 * nothing and passes forever.
 */
test.use({ storageState: { cookies: [], origins: [] } })

const FAKE_ID = '000000000000000000000000'

test('GET /api/admin/blog is 401', async ({ request }) => {
  expect((await request.get('/api/admin/blog')).status()).toBe(401)
})

test('POST /api/admin/blog is 401', async ({ request }) => {
  const res = await request.post('/api/admin/blog', { data: { slug: 'x', title: 'x' } })
  expect(res.status()).toBe(401)
})

test(`GET /api/admin/blog/[id] is 401`, async ({ request }) => {
  expect((await request.get(`/api/admin/blog/${FAKE_ID}`)).status()).toBe(401)
})

test(`PATCH /api/admin/blog/[id] is 401`, async ({ request }) => {
  const res = await request.patch(`/api/admin/blog/${FAKE_ID}`, { data: { title: 'x' } })
  expect(res.status()).toBe(401)
})

test(`DELETE /api/admin/blog/[id] is 401`, async ({ request }) => {
  expect((await request.delete(`/api/admin/blog/${FAKE_ID}`)).status()).toBe(401)
})

test('POST /api/admin/blog/preview is 401 - the stored-XSS harness', async ({ request }) => {
  const res = await request.post('/api/admin/blog/preview', {
    data: { markdown: '<script>alert(1)</script>' },
  })
  expect(
    res.status(),
    'the preview endpoint is ungated - anyone can probe the sanitizer for free'
  ).toBe(401)
})

test('the admin board itself is not readable anonymously', async ({ page }) => {
  await page.goto('/admin/blog')
  // OwnerAuthGate renders the login card rather than the board. The API is the real control;
  // this asserts the UI does not flash post titles before the gate resolves.
  await expect(page.locator('body')).not.toContainText('Create draft')
})
