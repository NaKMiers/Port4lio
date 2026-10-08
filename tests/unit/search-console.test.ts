import crypto from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getAccessToken,
  inspectUrl,
  parseServiceAccount,
  SEARCH_CONSOLE_SCOPE,
  SearchConsoleError,
  signServiceAccountJwt,
  submitSitemap,
  toInspectionFields,
  type ServiceAccount,
} from '@/lib/search-console'

/**
 * `lib/search-console.ts` - the hand-rolled service-account client.
 *
 * `fetch` is stubbed, as in `blog-llm.test.ts`: the assertions are about what we send and how
 * each Google answer becomes an error code, because those codes drive the board's Check all -
 * a 403 mapped to `upstream` would keep the loop spending quota on calls that cannot succeed.
 */

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

let seq = 0
/** A fresh email per test, because the token cache is keyed by it and lives for the module. */
function account(): ServiceAccount {
  seq += 1
  return { clientEmail: `sa-${seq}@proj.iam.gserviceaccount.com`, privateKey }
}

const encode = (value: unknown) =>
  Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value)
  ).toString('base64')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const TOKEN = 'https://oauth2.googleapis.com/token'
const ORIGINAL_FETCH = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) =>
    url === TOKEN
      ? json({ access_token: 'tok', expires_in: 3600 })
      : json({ inspectionResult: {} })
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

/** Route the non-token call to a chosen answer. */
function answerWith(make: () => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (url: string) =>
    url === TOKEN ? json({ access_token: 'tok', expires_in: 3600 }) : make()
  )
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(SearchConsoleError)
  return error as SearchConsoleError
}

describe('parseServiceAccount', () => {
  it('accepts base64 of a downloaded key', () => {
    const parsed = parseServiceAccount(
      encode({ client_email: 'a@b.iam', private_key: privateKey })
    )
    expect(parsed).toEqual({
      ok: true,
      account: { clientEmail: 'a@b.iam', privateKey },
    })
  })

  it.each([
    ['not base64 of anything useful', '%%%not-base64%%%'],
    ['base64 of plain text', encode('hello')],
    ['base64 of broken JSON', encode('{"client_email":')],
    ['no client_email', encode({ private_key: privateKey })],
    ['no private_key', encode({ client_email: 'a@b.iam' })],
  ])('refuses %s and names the env var', (_, raw) => {
    const parsed = parseServiceAccount(raw)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.problem).toContain('GSC_SERVICE_ACCOUNT_JSON')
  })
})

describe('the JWT', () => {
  it('is signed by the key and asks for the read-write webmasters scope', () => {
    const sa = account()
    const now = Date.UTC(2026, 9, 6)
    const jwt = signServiceAccountJwt(sa, now)
    const [header, claims, signature] = jwt.split('.')

    const verified = crypto
      .createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, 'base64url'))
    expect(verified).toBe(true)

    const body = JSON.parse(Buffer.from(claims, 'base64url').toString())
    // One scope for inspect AND sitemap submit; a readonly token would 403 the submit.
    expect(body).toMatchObject({
      iss: sa.clientEmail,
      scope: SEARCH_CONSOLE_SCOPE,
      aud: TOKEN,
      iat: now / 1000,
      exp: now / 1000 + 3600,
    })
    expect(SEARCH_CONSOLE_SCOPE).toBe(
      'https://www.googleapis.com/auth/webmasters'
    )
  })
})

describe('the token cache', () => {
  it('reuses a token, and refreshes it inside the last minute', async () => {
    const sa = account()
    const now = 1_000_000_000_000

    expect(await getAccessToken(sa, now)).toBe('tok')
    expect(await getAccessToken(sa, now + 3_000_000)).toBe('tok')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await getAccessToken(sa, now + 3_600_000 - 59_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a rejected key is `auth`, a broken token service is `upstream`', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'invalid_grant', error_description: 'Invalid JWT' }, 400)
    )
    const rejected = await codeOf(getAccessToken(account()))
    expect(rejected.code).toBe('auth')
    expect(rejected.message).toContain('Invalid JWT')

    fetchMock.mockResolvedValueOnce(json({}, 503))
    expect((await codeOf(getAccessToken(account()))).code).toBe('upstream')
  })
})

describe('inspectUrl', () => {
  it('posts the URL and property with a bearer token, and maps the result', async () => {
    answerWith(() =>
      json({
        inspectionResult: {
          inspectionResultLink:
            'https://search.google.com/search-console/inspect?x=1',
          indexStatusResult: {
            verdict: 'NEUTRAL',
            coverageState: 'Crawled - currently not indexed',
            indexingState: 'INDEXING_ALLOWED',
            robotsTxtState: 'ALLOWED',
            pageFetchState: 'SUCCESSFUL',
            lastCrawlTime: '2026-10-01T10:00:00Z',
            googleCanonical: 'https://example.com/blog/a',
            userCanonical: 'https://example.com/blog/a',
          },
        },
      })
    )

    const fields = await inspectUrl(
      account(),
      'sc-domain:example.com',
      'https://example.com/blog/a'
    )

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe(
      'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
    )
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer tok'
    )
    expect(JSON.parse(init.body as string)).toMatchObject({
      inspectionUrl: 'https://example.com/blog/a',
      siteUrl: 'sc-domain:example.com',
    })
    expect(fields).toMatchObject({
      verdict: 'NEUTRAL',
      coverageState: 'Crawled - currently not indexed',
      lastCrawlTime: new Date('2026-10-01T10:00:00Z'),
    })
  })

  it('403 is `forbidden` and says which account to add as a Full user', async () => {
    answerWith(() =>
      json(
        { error: { message: 'User does not have sufficient permission' } },
        403
      )
    )
    const sa = account()
    const error = await codeOf(
      inspectUrl(sa, 'sc-domain:example.com', 'https://example.com/blog/a')
    )
    expect(error.code).toBe('forbidden')
    expect(error.status).toBe(502)
    expect(error.message).toContain(sa.clientEmail)
    expect(error.message).toContain('Full user')
  })

  it.each([
    [429, 'quota', 429],
    [500, 'upstream', 502],
    [400, 'upstream', 502],
  ])('HTTP %i is `%s` (%i)', async (status, code, routeStatus) => {
    answerWith(() => json({ error: { message: 'nope' } }, status))
    const error = await codeOf(
      inspectUrl(account(), 'sc-domain:example.com', 'https://example.com/a')
    )
    expect(error.code).toBe(code)
    expect(error.status).toBe(routeStatus)
  })

  it('a timeout is `upstream`, not a crash', async () => {
    answerWith(() => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      throw error
    })
    const error = await codeOf(
      inspectUrl(account(), 'sc-domain:example.com', 'https://example.com/a')
    )
    expect(error.code).toBe('upstream')
    expect(error.message).toContain('15s')
  })

  it('401 is `auth` and drops the cached token, so the next call mints a new one', async () => {
    const sa = account()
    answerWith(() => json({ error: { message: 'expired' } }, 401))
    expect(
      (
        await codeOf(
          inspectUrl(sa, 'sc-domain:example.com', 'https://example.com/a')
        )
      ).code
    ).toBe('auth')

    answerWith(() => json({ inspectionResult: {} }))
    await inspectUrl(sa, 'sc-domain:example.com', 'https://example.com/a')
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => url === TOKEN)
    expect(tokenCalls).toHaveLength(2)
  })
})

describe('toInspectionFields', () => {
  it('writes every field as null when Google left it out', () => {
    // A missing field must clear the previous check's value, not leave a stale crawl date.
    expect(toInspectionFields({ inspectionResult: {} })).toEqual({
      verdict: null,
      coverageState: null,
      indexingState: null,
      robotsTxtState: null,
      pageFetchState: null,
      lastCrawlTime: null,
      googleCanonical: null,
      userCanonical: null,
      inspectionResultLink: null,
    })
    expect(toInspectionFields(null).verdict).toBeNull()
  })

  it('drops an unparseable crawl time instead of storing Invalid Date', () => {
    expect(
      toInspectionFields({
        inspectionResult: { indexStatusResult: { lastCrawlTime: 'soon' } },
      }).lastCrawlTime
    ).toBeNull()
  })
})

describe('submitSitemap', () => {
  it('PUTs to the sitemap resource with both ids URL-encoded', async () => {
    answerWith(() => new Response(null, { status: 204 }))
    await submitSitemap(
      account(),
      'sc-domain:example.com',
      'https://example.com/sitemap.xml'
    )
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(init.method).toBe('PUT')
    expect(url).toBe(
      'https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/sitemaps/https%3A%2F%2Fexample.com%2Fsitemap.xml'
    )
  })
})
