import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // S-7: `import 'server-only'` throws by design under any non-react-server
      // condition, so the blog pipeline cannot be imported by a test without this.
      // See tests/stubs/server-only.ts for why an empty module is the right stub.
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
  },
})
