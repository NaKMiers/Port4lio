import path from 'node:path'

import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'

/**
 * ## Why `dotenv.config()` is called HERE, at the top of the config
 *
 * The token the e2e suite signs itself with is minted in **global setup**, which runs inside
 * the Playwright runner process - not inside the dev server. `webServer.env` sets variables
 * on the server it spawns and never touches the runner, so forwarding `AUTH_SECRET` that way
 * cannot work: global setup would still see `undefined` and `makeAuthToken` would throw
 * before a single test ran.
 *
 * Loading the file here fixes both halves at once. The runner gets the value directly, and
 * `webServer.env` below can forward the same loaded value to the server, so both sides sign
 * and verify with one secret.
 *
 * The file is `.env`, not `.env.local`. Next loads both; this config loads the one that
 * exists in this repo, and `path.resolve` rather than a bare relative path so the config
 * behaves the same whatever directory the runner was started from.
 */
dotenv.config({ path: path.resolve(__dirname, '.env') })

const PORT = 3100
const baseURL = `http://127.0.0.1:${PORT}`
const useExistingServer = process.env.PLAYWRIGHT_USE_EXISTING_SERVER === '1'

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  },

  /**
   * ## `next build && next start`, not `next dev`
   *
   * This is the whole reason the suite exists. Route-segment `revalidate` and `ISR` do not
   * behave like production under `next dev` - the dev server re-renders on every request, so
   * a test asserting "the published post is immediately readable" would pass under dev
   * whether or not `revalidatePath` did anything at all. The falsification test would
   * falsify nothing.
   *
   * Port 3100 rather than 3000 so a dev server someone already has running does not get
   * silently reused and turn this back into a dev-mode run.
   */
  webServer: useExistingServer
    ? undefined
    : {
        command: `npm run build && npx next start --hostname 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 300_000,
        env: {
          // Forwarded from the values dotenv loaded above, so the server verifies tokens
          // signed by the same secret global setup uses. Filtered to defined values because
          // Playwright's `env` is `Record<string, string>` and `process.env` admits
          // undefined - the cast people reach for here would hide a genuinely missing var.
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => entry[1] !== undefined
            )
          ),
        },
      },
})
