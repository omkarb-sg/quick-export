import { defineConfig } from 'vitest/config'

// Default test run: pure unit tests only. Live-Aras tests (*.live.test.ts) are
// excluded here because they require a reachable Aras instance + credentials;
// run them with `npm run test:live` (see vitest.live.config.ts).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.live.test.ts', 'tests/e2e/**'],
    environment: 'node'
  }
})
