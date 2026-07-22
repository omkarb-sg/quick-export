/**
 * OPT-IN full-stack browser test: loads the real unpacked extension into Chromium, drives the
 * real Aras client, and exports the open item through the running local service.
 *
 * Self-skips unless QE_LIVE_E2E=1. It also needs, because automated login is intentionally
 * out of scope (the tool never types passwords):
 *   - the quick-export service running:            npm run service
 *   - a logged-in session saved as storageState:   QE_STORAGE_STATE=path/to/state.json
 *     (create once: `npx playwright open --save-storage=state.json http://localhost/12sp9/Client/`,
 *      log in by hand, then close)
 *   - ARAS_CLIENT_URL pointing at the client (defaults to http://localhost/12sp9/Client/)
 *
 * Enable:  QE_LIVE_E2E=1 QE_STORAGE_STATE=state.json npm run test:e2e
 */
import { test, expect, chromium, type BrowserContext } from '@playwright/test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ENABLED = process.env.QE_LIVE_E2E === '1'
const EXT_PATH = fileURLToPath(new URL('../../src/extension', import.meta.url))
const STORAGE = process.env.QE_STORAGE_STATE
const CLIENT_URL = process.env.ARAS_CLIENT_URL ?? 'http://localhost/12sp9/Client/'

test.describe('live extension end-to-end', () => {
  test.skip(!ENABLED, 'set QE_LIVE_E2E=1 (and QE_STORAGE_STATE) to run the full-stack browser test')

  let context: BrowserContext

  test.beforeAll(async () => {
    // MV3 extensions require a persistent context with the extension loaded.
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
      storageState: STORAGE && existsSync(STORAGE) ? STORAGE : undefined
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
