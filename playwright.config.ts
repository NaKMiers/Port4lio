import { defineConfig } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://127.0.0.1:${PORT}`;
const useExistingServer = process.env.PLAYWRIGHT_USE_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    // Playwright's bundled Chromium has no build for newer Ubuntu releases, so drive the
    // system Google Chrome instead. Override with PLAYWRIGHT_CHANNEL= (empty) to fall
    // back to the bundled browser on platforms where it does install.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
  },
  webServer: useExistingServer
    ? undefined
    : {
        command: `npm run dev -- --hostname 127.0.0.1 --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
