import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from '@playwright/test'

import { STORAGE_STATE } from './global-setup'

/**
 * Share links end to end: the owner's Share menu, then `/whiteboard/<slug>` in a browser
 * with NO owner cookie - which is the whole point of a share link, and the one thing the
 * API suite (tests/api/whiteboard-share.test.ts) cannot show: that the page a visitor gets
 * is the owner's canvas, read-only or editable, and nothing else.
 *
 * ```
 *   owner: new board + a card ──▶ Share menu: Can view, link name ──▶ visitor sees it, can't edit
 *   owner: edit (API)          ──▶ visitor adds a card             ──▶ owner's stream has it
 *   owner: off (API)           ──▶ visitor gets a 404
 * ```
 *
 * It makes its own board and deletes it at the end, so the owner's first board - the one
 * `whiteboard.spec.ts` clears before every test - is never touched.
 */

test.use({ storageState: STORAGE_STATE })
test.describe.configure({ mode: 'serial' })

const API = '/api/admin/whiteboard'
let BOARD = ''
const SLUG = `share-e2e-${Date.now().toString(36)}`

function objectId() {
  const hex = (n: number, len: number) => n.toString(16).padStart(len, '0')
  return (
    hex(Math.floor(Date.now() / 1000), 8) +
    Array.from({ length: 16 }, () =>
      hex(Math.floor(Math.random() * 16), 1)
    ).join('')
  )
}

async function visitor(browser: Browser) {
  // A fresh context: no owner cookie, nothing in storage.
  return browser.newContext({ storageState: { cookies: [], origins: [] } })
}

async function patchBoard(
  request: APIRequestContext,
  body: Record<string, unknown>
) {
  const res = await request.patch(`${API}/boards/${BOARD}`, { data: body })
  expect(res.ok()).toBe(true)
}

async function titles(request: APIRequestContext) {
  const text = await (await request.get(`${API}?board=${BOARD}`)).text()
  return text
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(line => line.t === 'item')
    .map(line => line.item.title as string)
}

test.beforeAll(async ({ request }) => {
  // List first: on a fresh database that is what creates the default "Whiteboard" board
  // (ensureBoards). Creating ours first made IT the first board - the one
  // `whiteboard.spec.ts` treats as its own and clears before every test, running in
  // another worker at the same time - and both specs failed on each other's writes.
  expect((await request.get(`${API}/boards`)).ok()).toBe(true)
  const res = await request.post(`${API}/boards`, {
    data: { title: 'Shared e2e board' },
  })
  expect(res.status()).toBe(201)
  BOARD = (await res.json()).board._id
  const card = await request.post(`${API}/items?board=${BOARD}`, {
    data: { _id: objectId(), form: 'text', title: 'Card the visitor sees' },
  })
  expect(card.ok()).toBe(true)
})

test.afterAll(async ({ request }) => {
  if (BOARD) await request.delete(`${API}/boards/${BOARD}`)
})

test('(1) the owner shares view-only from the menu; a visitor sees the board and cannot edit it', async ({
  page,
  browser,
}) => {
  await page.goto(`/admin/whiteboard/${BOARD}`)
  await expect(page.getByTestId('wb-save-pill')).toHaveText(/Saved/, {
    timeout: 30_000,
  })

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const panel = page.getByTestId('wb-share-panel')
  await expect(panel.getByTestId('wb-share-copy')).toBeDisabled()
  await panel.getByRole('radio', { name: /Can view/ }).click()
  await expect(panel.getByRole('radio', { name: /Can view/ })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await panel.getByLabel('Link name').fill(SLUG)
  await panel.getByRole('button', { name: 'Save' }).click()
  await expect(panel.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(panel.getByTestId('wb-share-copy')).toBeEnabled()

  const context = await visitor(browser)
  const guest = await context.newPage()
  const page_ = await guest.goto(`/whiteboard/${SLUG}`)
  // No other site may frame a share link (next.config.js).
  expect(page_?.headers()['x-frame-options']).toBe('DENY')
  expect(page_?.headers()['content-security-policy']).toContain(
    "frame-ancestors 'none'"
  )
  await expect(guest.getByTestId('wb-view-only')).toBeVisible({
    timeout: 30_000,
  })
  await expect(guest.getByText('Card the visitor sees')).toBeVisible()
  // Hovering a card offers no connection points: nothing can be linked here.
  await guest.getByText('Card the visitor sees').hover()
  const handles = guest.locator('.wb-handle')
  await expect(handles).toHaveCount(4)
  for (const handle of await handles.all()) await expect(handle).toBeHidden()
  await expect(
    guest.getByRole('heading', { name: 'Shared e2e board' })
  ).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Copy link' })).toBeVisible()
  // None of the owner's chrome, and no tools.
  await expect(guest.getByRole('link', { name: 'All boards' })).toHaveCount(0)
  await expect(guest.getByRole('button', { name: 'Backup' })).toHaveCount(0)
  await expect(guest.getByRole('button', { name: 'Export to AI' })).toHaveCount(
    0
  )
  await expect(guest.getByRole('button', { name: 'Text card, T' })).toHaveCount(
    0
  )

  // And the server agrees, whatever the page offers.
  const write = await guest.request.post(
    `/api/whiteboard/shared/${SLUG}/items`,
    {
      data: { _id: objectId(), form: 'text', title: 'Sneaky' },
    }
  )
  expect(write.status()).toBe(403)
  await context.close()
})

test("(2) an edit link lets a visitor add a card, and it lands on the owner's board", async ({
  request,
  browser,
}) => {
  await patchBoard(request, { share: 'edit' })

  const context = await visitor(browser)
  const guest = await context.newPage()
  await guest.goto(`/whiteboard/${SLUG}`)
  await expect(guest.getByTestId('wb-save-pill')).toHaveText(/Saved/, {
    timeout: 30_000,
  })
  await guest.getByRole('button', { name: 'Text card, T' }).click()
  await guest.locator('.wb-flow').click({ position: { x: 420, y: 320 } })
  const title = guest.getByRole('textbox', { name: 'Title' }).first()
  await expect(title).toBeFocused()
  await guest.keyboard.type('Written by a visitor')
  await guest.keyboard.press('Escape')
  await expect(guest.getByTestId('wb-save-pill')).toHaveText(/Saved/)
  // No AI switch for a visitor, even with the card selected.
  await guest.getByText('Written by a visitor').click()
  await expect(guest.getByText('Include in AI export')).toHaveCount(0)
  await context.close()

  await expect.poll(() => titles(request)).toContain('Written by a visitor')
})

test('(3) turning sharing off makes the link a 404', async ({
  request,
  browser,
}) => {
  await patchBoard(request, { share: 'off' })
  const context = await visitor(browser)
  const guest = await context.newPage()
  const res = await guest.goto(`/whiteboard/${SLUG}`)
  expect(res?.status()).toBe(404)
  await expect(guest.getByText('Card the visitor sees')).toHaveCount(0)
  await context.close()
})

test('(4) the page itself is rate-limited per caller, like the API behind it', async ({
  request,
}) => {
  await patchBoard(request, { share: 'view' })
  // One made-up address, so this test's bucket is nobody else's.
  const headers = { 'x-forwarded-for': '198.51.100.77' }
  let body = ''
  for (let i = 0; i < 125 && !body.includes('Too many requests'); i++)
    body = await (await request.get(`/whiteboard/${SLUG}`, { headers })).text()
  expect(body).toContain('Too many requests')
  expect(body).not.toContain('Card the visitor sees')
  // Another caller is unaffected.
  const other = await request.get(`/whiteboard/${SLUG}`, {
    headers: { 'x-forwarded-for': '198.51.100.78' },
  })
  expect(other.status()).toBe(200)
  expect(await other.text()).not.toContain('Too many requests')
})
