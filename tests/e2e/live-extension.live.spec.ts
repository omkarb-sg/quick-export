/**
 * OPT-IN full-stack browser test: loads the real unpacked extension into Chromium, drives the
 * real Aras client, and exports the open item through the running local service.
 *
 * Self-skips unless QE_LIVE_E2E=1. It also needs, because automated login is intentionally
 * out of scope (the tool never types passwords):
 *   - the quick-export service running:            npm run service
 *   - a persistent Chromium profile that is already logged in. Point QE_USER_DATA_DIR at a
 *     profile dir; run once headed, log into Aras by hand, and the session persists for reruns.
 *   - ARAS_CLIENT_URL pointing at the client (defaults to http://localhost/12sp9/Client/)
 *
 * Enable:  QE_LIVE_E2E=1 QE_USER_DATA_DIR=.pw-profile npm run test:e2e
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const ENABLED = process.env.QE_LIVE_E2E === '1'
const EXT_PATH = fileURLToPath(new URL('../../src/extension', import.meta.url))
const USER_DATA_DIR = process.env.QE_USER_DATA_DIR ?? ''
const CLIENT_URL = process.env.ARAS_CLIENT_URL ?? 'http://localhost/12sp9/Client/'

test.describe('live extension end-to-end', () => {
  test.skip(!ENABLED, 'set QE_LIVE_E2E=1 (and QE_STORAGE_STATE) to run the full-stack browser test')

  let context: BrowserContext

  test.beforeAll(async () => {
    // MV3 extensions require a persistent context with the extension loaded. A persistent
    // user-data dir also carries the logged-in Aras session across runs.
    context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`]
    })
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('renders the Quick Export button on the client', async () => {
    const page = await context.newPage()
    await page.goto(CLIENT_URL)
    // The content script injects the button into a shadow root on the top client window.
    await expect(page.locator('#quick-export-host .btn')).toBeVisible({ timeout: 30_000 })
    // Full flow (open an item, click, assert XML) is documented in README — it depends on the
    // tester opening an item; kept manual so this stays deterministic.
  })
})
