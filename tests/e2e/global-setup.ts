import path from 'node:path'

import dotenv from 'dotenv'

import { getAuthCookieName, makeAuthToken } from '../../src/lib/auth'

/**
 * Mint an owner cookie once, and prove the server actually accepts it.
 *
 * ```
 *   dotenv → AUTH_SECRET → makeAuthToken → storageState.json
 *                                │
 *                                ▼
 *                    GET /api/auth/me  ── 200? ──▶ write the state
 *                                       ── else ─▶ THROW, loudly
 * ```
 *
 * ## Why the verification round trip is not optional
 *
 * Signing a token proves this process can sign a token. It does not prove the server under
 * test verifies it, and there are two ordinary ways for those to diverge:
 *
 * The server may have been started with a different `AUTH_SECRET` - or none - in which case
 * every authenticated test 401s and the failure surfaces as thirty confusing assertion
 * errors about missing page content rather than one about auth.
 *
 * And `PLAYWRIGHT_USE_EXISTING_SERVER=1` makes `webServer` undefined entirely, so the suite
 * runs against whatever is already listening on the port, whose env nothing here controls.
 * That is the case the round trip exists for: it is the only check that can catch it.
 *
 * ## Why the token is written as storageState rather than set per test
 *
 * Every authenticated test needs it, and a `beforeEach` that sets a cookie is a line each of
 * them can forget. The 401 tests deliberately do NOT use this state - they run in a fresh
 * context, because a test asserting "this handler refuses an anonymous caller" that
 * accidentally carries an owner cookie asserts nothing.
 */

dotenv.config({ path: path.resolve(__dirname, '../../.env') })

export const STORAGE_STATE = path.resolve(__dirname, '.auth/owner.json')

export default async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100'

  if (!process.env.AUTH_SECRET)
    throw new Error(
      'AUTH_SECRET is not set. tests/e2e signs its own owner cookie, so it cannot run without it. Check .env exists and playwright.config.ts loaded it.'
    )

  /**
   * REFUSE TO RUN AGAINST A DATABASE THAT IS NOT DISPOSABLE.
   *
   * This suite is destructive in a way that is easy to miss, because none of it looks
   * destructive. It creates posts, publishes them, and soft-deletes them - and soft delete
   * RETAINS THE SLUG FOREVER by design, so that a new post cannot inherit a deleted post's
   * contact attributions. Every run therefore leaves a permanent document in whatever
   * database it found, and the slug it holds can never be reused.
   *
   * It also calls `revalidatePath` on the real `/blog`, `/sitemap.xml` and `/blog/rss.xml`.
   *
   * The first version of this file had no guard, and `.env` on a developer machine points at
   * the production Atlas cluster - so the first run wrote to production. Nothing about that
   * was visible in the output: 19 tests passed.
   *
   * The check is on the database NAME rather than the host, because a staging database on
   * the same cluster is fine and a production database on localhost is not. Set
   * `E2E_ALLOW_DB=<name>` to state out loud which database is disposable.
   */
  // `?` optional: an Atlas URI carries query options, the local one in `test:e2e:local`
  // (`mongodb://127.0.0.1:27017/port4lio_e2e`) does not, and used to read as "no name".
  const dbName =
    (process.env.MONGODB_URI ?? '').match(/\/([^/?]+)(?:\?|$)/)?.[1] ?? ''
  const allowed = process.env.E2E_ALLOW_DB

  if (!dbName)
    throw new Error(
      'Could not read a database name out of MONGODB_URI. Refusing to run.'
    )

  if (dbName !== allowed)
    throw new Error(
      [
        `tests/e2e refuses to run against the "${dbName}" database.`,
        '',
        'This suite creates and soft-deletes posts, and a soft delete retains its slug',
        'permanently - so every run leaves a document behind that cannot be cleaned up',
        'without undermining the behaviour being tested. It also revalidates the real',
        '/blog, /sitemap.xml and /blog/rss.xml.',
        '',
        `To run it, point MONGODB_URI at a disposable database and set E2E_ALLOW_DB=${dbName === allowed ? dbName : '<that database name>'}.`,
        '',
        'Example:',
        '  MONGODB_URI=mongodb://127.0.0.1:27017/port4lio_e2e E2E_ALLOW_DB=port4lio_e2e npm run test:e2e',
      ].join('\n')
    )

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  const token = makeAuthToken(Date.now() + THIRTY_DAYS_MS)

  // The round trip. See the header - this is what catches a server signing with a different
  // secret, which is otherwise indistinguishable from the whole app being broken.
  const res = await fetch(`${baseURL}/api/auth/me`, {
    headers: { cookie: `${getAuthCookieName()}=${token}` },
  })

  if (!res.ok)
    throw new Error(
      `Minted an owner token but ${baseURL}/api/auth/me rejected it (${res.status}). The server under test is verifying with a different AUTH_SECRET than this process signed with - likely PLAYWRIGHT_USE_EXISTING_SERVER against a server started from a different env.`
    )

  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(path.dirname(STORAGE_STATE), { recursive: true })
  await writeFile(
    STORAGE_STATE,
    JSON.stringify({
      cookies: [
        {
          name: getAuthCookieName(),
          value: token,
          domain: '127.0.0.1',
          path: '/',
          expires: Math.floor((Date.now() + THIRTY_DAYS_MS) / 1000),
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
    'utf8'
  )
}
