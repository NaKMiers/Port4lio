import 'server-only'

import crypto from 'node:crypto'

import { base64url } from '@/lib/base64url'
import type { IndexStatus } from '@/lib/blog/index-status-badge'

/**
 * Google Search Console, through a service account - URL Inspection and sitemap submit.
 *
 * ```
 *   GSC_SERVICE_ACCOUNT_JSON (base64 of the downloaded key)
 *        │ parseServiceAccount
 *        ▼
 *   RS256 JWT { iss, scope: webmasters, aud: token endpoint }
 *        │ POST oauth2.googleapis.com/token          one token per account, cached
 *        ▼                                            until ~60s before it expires
 *   Bearer access token
 *        ├─▶ POST searchconsole.googleapis.com/v1/urlInspection/index:inspect
 *        └─▶ PUT  www.googleapis.com/webmasters/v3/sites/{site}/sitemaps/{feed}
 * ```
 *
 * ## What this cannot do, and why nothing here pretends to
 *
 * There is no API for Search Console's "Request indexing" button. Google's Indexing API
 * accepts only JobPosting and BroadcastEvent pages, and using it for blog posts risks the
 * account. So this module READS index status and RESUBMITS the sitemap - the two things a
 * blog can legitimately automate - and the board links to Search Console for the rest.
 *
 * ## Why no Google SDK
 *
 * The documented server-to-server flow is one signed JWT and one form POST, which `node:crypto`
 * and `base64url.ts` already cover. `googleapis` would add a large dependency for two calls.
 *
 * ## Why one scope for both calls
 *
 * Inspection needs `webmasters.readonly` and sitemap submit needs `webmasters`. The read-write
 * scope covers both, so a single cached token serves both calls. Two scopes would mean two
 * caches, and a readonly token used for a submit fails as a 403 that reads exactly like a
 * missing permission - sending the owner to fix Search Console users that are already right.
 *
 * ## Why the key is stored base64-encoded
 *
 * The key's `private_key` is a PEM with real newlines. Pasted raw into an env var it tends to
 * arrive with `\n` escapes or folded lines, and `createSign` then fails with an opaque decoder
 * error. Base64 of the whole JSON survives every dashboard and shell unchanged.
 */

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const INSPECT_URL =
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
const SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites'

const REQUEST_TIMEOUT_MS = 15_000
/** Refresh a little early, so a token never expires between the check and the call. */
const TOKEN_REFRESH_MARGIN_MS = 60_000

export type ServiceAccount = { clientEmail: string; privateKey: string }

export type SearchConsoleErrorCode = 'auth' | 'forbidden' | 'quota' | 'upstream'

const STATUS_FOR: Record<SearchConsoleErrorCode, number> = {
  auth: 502,
  forbidden: 502,
  quota: 429,
  upstream: 502,
}

/** A Google failure, already in the words and status the owner's board shows. */
export class SearchConsoleError extends Error {
  readonly code: SearchConsoleErrorCode
  readonly status: number

  constructor(code: SearchConsoleErrorCode, message: string) {
    super(message)
    this.name = 'SearchConsoleError'
    this.code = code
    this.status = STATUS_FOR[code]
  }
}

export function parseServiceAccount(
  raw: string
): { ok: true; account: ServiceAccount } | { ok: false; problem: string } {
  const bad = (why: string) => ({
    ok: false as const,
    problem: `GSC_SERVICE_ACCOUNT_JSON ${why}. Base64-encode the whole downloaded key file, for example \`base64 -w0 key.json\`.`,
  })

  let json: unknown
  try {
    const decoded = Buffer.from(raw.trim(), 'base64').toString('utf8')
    if (!decoded.trimStart().startsWith('{'))
      return bad('is not base64 of a JSON key')
    json = JSON.parse(decoded)
  } catch {
    return bad('is not base64 of a JSON key')
  }

  const record = json as { client_email?: unknown; private_key?: unknown }
  if (
    typeof record.client_email !== 'string' ||
    !record.client_email.includes('@')
  )
    return bad('has no client_email')
  if (
    typeof record.private_key !== 'string' ||
    !record.private_key.includes('PRIVATE KEY')
  )
    return bad('has no private_key')

  return {
    ok: true,
    account: {
      clientEmail: record.client_email,
      privateKey: record.private_key,
    },
  }
}

export function signServiceAccountJwt(
  account: ServiceAccount,
  nowMs: number
): string {
  const iat = Math.floor(nowMs / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SEARCH_CONSOLE_SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    })
  )
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(account.privateKey)
  return `${header}.${claims}.${base64url(signature)}`
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function googleFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new SearchConsoleError(
      'upstream',
      timedOut
        ? `Google did not answer within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : 'Could not reach Google.'
    )
  }
}

/** Google's own error sentence, when it sent one. Short, and never echoes our request. */
async function googleReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: unknown } | string
      error_description?: unknown
    }
    const reason =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.error === 'object' &&
            typeof body.error?.message === 'string'
          ? body.error.message
          : typeof body.error === 'string'
            ? body.error
            : ''
    return reason.slice(0, 200) || `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

export async function getAccessToken(
  account: ServiceAccount,
  nowMs: number = Date.now()
): Promise<string> {
  const cached = tokenCache.get(account.clientEmail)
  if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > nowMs)
    return cached.token

  let assertion: string
  try {
    assertion = signServiceAccountJwt(account, nowMs)
  } catch {
    throw new SearchConsoleError(
      'auth',
      'The service-account private_key could not sign a token. Re-download the key and update GSC_SERVICE_ACCOUNT_JSON.'
    )
  }

  const response = await googleFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  })

  if (!response.ok) {
    const reason = await googleReason(response)
    if (response.status >= 500)
      throw new SearchConsoleError(
        'upstream',
        `Google's token service failed (${reason}).`
      )
    throw new SearchConsoleError(
      'auth',
      `Google rejected the service-account key (${reason}). Re-download the key and update GSC_SERVICE_ACCOUNT_JSON.`
    )
  }

  const body = (await response.json()) as {
    access_token?: unknown
    expires_in?: unknown
  }
  if (typeof body.access_token !== 'string')
    throw new SearchConsoleError(
      'upstream',
      'Google answered the token request without a token.'
    )

  const lifetime = typeof body.expires_in === 'number' ? body.expires_in : 3600
  tokenCache.set(account.clientEmail, {
    token: body.access_token,
    expiresAt: nowMs + lifetime * 1000,
  })
  return body.access_token
}

async function failureFrom(
  response: Response,
  account: ServiceAccount,
  siteUrl: string
): Promise<SearchConsoleError> {
  const reason = await googleReason(response)
  if (response.status === 401) {
    tokenCache.delete(account.clientEmail)
    return new SearchConsoleError(
      'auth',
      `Google rejected the access token (${reason}).`
    )
  }
  if (response.status === 403)
    return new SearchConsoleError(
      'forbidden',
      `Google refused access (${reason}). Add ${account.clientEmail} as a Full user on ${siteUrl} in Search Console.`
    )
  if (response.status === 429)
    return new SearchConsoleError(
      'quota',
      'Search Console quota reached (2,000 inspections a day per property). Try again later.'
    )
  return new SearchConsoleError(
    'upstream',
    `Search Console failed (${reason}).`
  )
}

/** The result fields `Post.indexStatus` stores, with `null` for anything Google left out. */
export type InspectionFields = Required<
  Pick<
    IndexStatus,
    | 'verdict'
    | 'coverageState'
    | 'indexingState'
    | 'robotsTxtState'
    | 'pageFetchState'
    | 'googleCanonical'
    | 'userCanonical'
    | 'inspectionResultLink'
  >
> & { lastCrawlTime: Date | null }

/**
 * Every field written explicitly, `null` when absent. Google omits `lastCrawlTime` and the
 * canonicals when they do not apply, and a missing field must clear the previous check's
 * value rather than leave a stale crawl date or a resolved canonical warning behind.
 */
export function toInspectionFields(response: unknown): InspectionFields {
  const result =
    (response as { inspectionResult?: Record<string, unknown> } | null)
      ?.inspectionResult ?? {}
  const index = (result.indexStatusResult ?? {}) as Record<string, unknown>
  const text = (value: unknown) =>
    typeof value === 'string' && value ? value : null
  const crawl = text(index.lastCrawlTime)
  const crawlDate = crawl ? new Date(crawl) : null

  return {
    verdict: text(index.verdict),
    coverageState: text(index.coverageState),
    indexingState: text(index.indexingState),
    robotsTxtState: text(index.robotsTxtState),
    pageFetchState: text(index.pageFetchState),
    lastCrawlTime:
      crawlDate && !Number.isNaN(crawlDate.getTime()) ? crawlDate : null,
    googleCanonical: text(index.googleCanonical),
    userCanonical: text(index.userCanonical),
    inspectionResultLink: text(result.inspectionResultLink),
  }
}

export async function inspectUrl(
  account: ServiceAccount,
  siteUrl: string,
  inspectionUrl: string
): Promise<InspectionFields> {
  const token = await getAccessToken(account)
  const response = await googleFetch(INSPECT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: 'en-US' }),
  })
  if (!response.ok) throw await failureFrom(response, account, siteUrl)
  return toInspectionFields(await response.json())
}

export async function submitSitemap(
  account: ServiceAccount,
  siteUrl: string,
  feedUrl: string
): Promise<void> {
  const token = await getAccessToken(account)
  const url = `${SITES_URL}/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedUrl)}`
  const response = await googleFetch(url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw await failureFrom(response, account, siteUrl)
}
