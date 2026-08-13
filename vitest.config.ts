import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Mirror tsconfig's "@/*" -> "./*" alias so tests import the same way app code does.
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    include: ['tests/**/*.test.ts'],
    // db-invariants hits Neon; it self-skips when DATABASE_URL is absent (unit tests always run).
    testTimeout: 30000,
  },
})
