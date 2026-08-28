import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
  },
})
