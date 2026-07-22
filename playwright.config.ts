import { defineConfig, devices } from '@playwright/test'

// Browser-side tests for the extension's injected code. Two flavours live under
// tests/e2e:
//   *.stub.spec.ts  — run against a local stub page that mimics `top.aras`; no
//                     Aras needed, so these run anywhere with a browser.
//   *.live.spec.ts  — drive the real Aras web client at ARAS_CLIENT_URL; require
//                     a running Aras + a logged-in session, so they are opt-in.
// Run all: `npm run test:e2e`. Run only stub: `npx playwright test --grep @stub`.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    baseURL: process.env.ARAS_CLIENT_URL ?? 'http://localhost/12sp9/Client/'
  }
})
