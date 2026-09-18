import { expect, test } from '@playwright/test'

/**
 * The CSP is present on BOTH blog paths, and the page still hydrates under it.
 *
 * ## The hydration half is the point
 *
 * `script-src 'self'` alone rejects Next's own unnonced inline bootstrap:
 *
 *     <script>(self.__next_f=self.__next_f||[]).push([0])</script>
 *
 * The page then renders perfectly, passes every server-side assertion anybody would write,
 * and never hydrates. It is a browser-only failure, which is why this test needs a real
 * browser and cannot be a `request.get` asserting on a header.
 *
 * ## Both paths, because `/blog/:path*` does not match `/blog`
 *
 * A config listing only the wildcard leaves the index - the page linked from `/`, `/cv` and
 * both test products - with no CSP at all, and every spot check of a post page looks fine.
 */

test('CSP is on /blog itself, not only on its children', async ({ request }) => {
  const index = await request.get('/blog')
  expect(
    index.headers()['content-security-policy'],
    '/blog has no CSP - the config probably only lists /blog/:path*'
  ).toContain("frame-ancestors 'none'")

  const child = await request.get('/blog/privacy')
  expect(child.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
})

test('the CSP names the directives that do not fall back to default-src', async ({ request }) => {
  const csp = (await request.get('/blog')).headers()['content-security-policy'] ?? ''

  // These four are the header's actual value - none of them inherits from default-src, so
  // each is absent unless named.
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("base-uri 'self'")
  expect(csp).toContain("form-action 'self'")
  expect(csp).toContain('img-src')
  // data: bypasses the image-host visitor's reasoning entirely - there is no host to check.
  expect(csp).not.toContain('data:')
})

test('the page HYDRATES under that CSP', async ({ page }) => {
  const violations: string[] = []
  page.on('console', message => {
    const text = message.text()
    if (/Content Security Policy|Refused to execute/i.test(text)) violations.push(text)
  })

  await page.goto('/blog')

  // The real assertion: React actually took over. If the CSP blocked the bootstrap the
  // markup is still there and this root never appears.
  await expect(page.locator('body')).toBeVisible()
  await page.waitForFunction(() => document.querySelector('body')?.innerHTML.length ?? 0 > 0)

  expect(violations, `CSP blocked something in a real browser:\n${violations.join('\n')}`).toEqual([])
})
