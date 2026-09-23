import { expect, test } from '@playwright/test'

/**
 * Every whiteboard owner handler refuses an anonymous caller.
 *
 * Same shape as `blog-owner-gate.spec.ts`, and for the same reason: the thing asserted is
 * that EACH handler calls `requireOwner`, so each gets its own line. A loop over a list in
 * this file proves the list, not the handler somebody adds next month. This board holds the
 * most private data in the database, so a forgotten gate here is the worst one to forget.
 *
 * No storageState, deliberately - a fresh context with no owner cookie.
 */
test.use({ storageState: { cookies: [], origins: [] } })

const FAKE_ID = '000000000000000000000000'
const API = '/api/admin/whiteboard'

const expect401 = async (res: {
  status(): number
  headers(): Record<string, string>
}) => {
  expect(res.status()).toBe(401)
  expect(res.headers()['cache-control']).toBe('no-store, private')
}

test('GET /api/admin/whiteboard is 401', async ({ request }) => {
  await expect401(await request.get(API))
})

test('POST /items is 401', async ({ request }) => {
  await expect401(
    await request.post(`${API}/items`, {
      data: { _id: FAKE_ID, form: 'text' },
    })
  )
})

test('PATCH /items is 401', async ({ request }) => {
  await expect401(
    await request.patch(`${API}/items`, {
      data: { updates: [{ id: FAKE_ID, x: 0, y: 0, parentId: null }] },
    })
  )
})

test('PATCH /items/[id] is 401', async ({ request }) => {
  await expect401(
    await request.patch(`${API}/items/${FAKE_ID}`, { data: { title: 'x' } })
  )
})

test('DELETE /items/[id] is 401', async ({ request }) => {
  await expect401(await request.delete(`${API}/items/${FAKE_ID}`))
})

test('POST /links is 401', async ({ request }) => {
  await expect401(
    await request.post(`${API}/links`, {
      data: { _id: FAKE_ID, from: FAKE_ID, to: FAKE_ID, label: '' },
    })
  )
})

test('PATCH /links/[id] is 401', async ({ request }) => {
  await expect401(
    await request.patch(`${API}/links/${FAKE_ID}`, { data: { label: 'x' } })
  )
})

test('DELETE /links/[id] is 401', async ({ request }) => {
  await expect401(await request.delete(`${API}/links/${FAKE_ID}`))
})

test('POST /context is 401 - it renders the private board', async ({
  request,
}) => {
  await expect401(
    await request.post(`${API}/context`, { data: { scope: { kind: 'all' } } })
  )
})

test('GET /backup is 401 - it includes hidden items', async ({ request }) => {
  await expect401(await request.get(`${API}/backup`))
})

test('POST /restore is 401', async ({ request }) => {
  await expect401(
    await request.post(`${API}/restore`, {
      data: { dryRun: true, overwrite: false, items: [], links: [] },
    })
  )
})
