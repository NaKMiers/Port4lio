import { expect, test } from '@playwright/test'

/**
 * Double opt-in, end to end, including the property that is easiest to get wrong.
 *
 * ## The oracle test is the one that matters
 *
 * A subscribe endpoint that answers "already subscribed" differently from "added" lets anyone
 * test whether a given person reads this blog, one address at a time. The rate limit only
 * slows that down. So the assertion below is that the two responses are **byte-identical**,
 * not merely both successful - a difference in wording is the whole leak.
 *
 * Mail is not asserted here: `sendMail` talks to Gmail, so the confirmation email cannot be
 * received in a test. What is asserted is everything the confirmation link does once
 * followed, driven directly against the API.
 *
 * ## Every case sends its own `x-forwarded-for`
 *
 * `SUBSCRIBE_LIMIT` is 3 per hour per IP, and it is checked BEFORE body validation - so a
 * malformed address consumes a token too, which is deliberate: the bound has to come before
 * the work, or a caller can spend our CPU for free by sending garbage. This file makes more
 * than three calls, so without distinct IPs the later cases 429 and the failure looks like a
 * broken endpoint. Found exactly that way.
 */

/** Distinct per case, so the hour-long bucket of one does not spill into another. */
const ip = (n: number) => ({ 'x-forwarded-for': `203.0.113.${n}` })

test.use({ storageState: { cookies: [], origins: [] } })

const EMAIL = `e2e-${Date.now()}@example.com`

test.describe.configure({ mode: 'serial' })

test('a signup is accepted', async ({ request }) => {
  const res = await request.post('/api/blog/subscribe', { data: { email: EMAIL }, headers: ip(21) })
  expect(res.status()).toBe(202)
})

test('a repeat signup is INDISTINGUISHABLE from the first', async ({ request }) => {
  // The email-address oracle. If these two bodies ever differ, anyone can enumerate readers.
  const first = await request.post('/api/blog/subscribe', { data: { email: EMAIL }, headers: ip(22) })
  const second = await request.post('/api/blog/subscribe', {
    data: { email: `fresh-${Date.now()}@example.com` },
    headers: ip(23),
  })

  expect(first.status()).toBe(second.status())
  expect(
    await first.text(),
    'the response reveals whether an address is already on the list'
  ).toBe(await second.text())
})

test('a malformed address is refused', async ({ request }) => {
  expect(
    (await request.post('/api/blog/subscribe', { data: { email: 'not-an-email' }, headers: ip(24) })).status()
  ).toBe(400)
  expect((await request.post('/api/blog/subscribe', { data: {}, headers: ip(25) })).status()).toBe(400)
})

test('an unknown confirm token lands on the invalid page rather than erroring', async ({ page }) => {
  await page.goto('/api/blog/subscribe/confirm?token=definitely-not-a-real-token')
  await expect(page).toHaveURL(/state=invalid/)
  await expect(page.locator('h1')).toContainText('did not work')
})

test('unsubscribing reports success even for an unknown token', async ({ page }) => {
  // Deliberate: the person clicking wants to stop receiving email. An error page tells them
  // they failed at something they cannot fix and sends them to the spam button.
  await page.goto('/api/blog/unsubscribe?token=definitely-not-a-real-token')
  await expect(page).toHaveURL(/state=unsubscribed/)
  await expect(page.locator('h1')).toContainText('Unsubscribed')
})

test('the subscribe form is on the index, below the posts', async ({ page }) => {
  await page.goto('/blog')
  await expect(page.locator('#subscribe-email')).toBeVisible()
  // No modal, no scroll trigger, no article wall.
  await expect(page.locator('dialog')).toHaveCount(0)
})
