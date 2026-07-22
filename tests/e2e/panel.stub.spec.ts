/**
 * @stub — runs the real content-script UI (src/extension/content.js) in Chromium with a
 * stubbed `chrome` runtime and a stubbed page-world bridge. Proves the panel flow:
 * click -> getContext -> export -> render XML -> Copy / Download. No Aras/service needed.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const CONTENT = readFileSync(REPO + 'src/extension/content.js', 'utf8')
const XML = '﻿<AML>\n <Item type="Method" id="08BE" action="add"><name>CheckFavoriteOwner</name></Item>\n</AML>\n'

async function setup(page: import('@playwright/test').Page, opts: { inPackage: boolean }) {
  await page.setContent('<!doctype html><meta charset="utf-8"><title>aras stub</title><body></body>')
  await page.evaluate((inPackage) => {
    ;(window as any).__sent = null
    // about:blank is not a secure context, so navigator.clipboard is undefined — stub it
    // to capture what content.js copies.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (t: string) => {
          ;(window as any).__copied = t
        },
        readText: async () => (window as any).__copied
      }
    })
    ;(window as any).chrome = {
      runtime: {
        getURL: () => 'data:text/javascript,void%200',
        sendMessage: async (msg: any) => {
          ;(window as any).__sent = msg
          return { reqId: msg.body.reqId, ok: true, filename: 'CheckFavoriteOwner.xml', xml: (window as any).__XML, engineErrors: 0 }
        }
      }
    }
    // Stubbed page-world bridge (stands in for injected.js).
    window.addEventListener('message', (ev: any) => {
      const d = ev.data
      if (!d || d.__qe !== 'req') return
      if (d.action === 'getContext') {
        const item = { itemType: 'Method', itemId: '08BE', configId: 'CFG', keyedName: 'CheckFavoriteOwner' }
        const result = inPackage
          ? { item, inPackage: true, packageName: 'com.aras.innovator.favorites', request: { reqId: 'qe-x', conn: {}, item: {}, options: {} } }
          : { item, inPackage: false, packageName: '' }
        window.postMessage({ __qe: 'res', id: d.id, ok: true, result }, '*')
      }
    })
  }, opts.inPackage)
  await page.evaluate((xml) => ((window as any).__XML = xml), XML)
  await page.addScriptTag({ content: CONTENT })
}

test('exports the open item and renders the XML with Copy/Download @stub', async ({ page }) => {
  await setup(page, { inPackage: true })

  await page.locator('.btn').click()

  const ta = page.locator('#quick-export-host textarea')
  await expect(ta).toBeVisible()
  await expect(ta).toHaveValue(XML)
  await expect(page.locator('#quick-export-host .status')).toContainText('Exported CheckFavoriteOwner.xml')

  // Copy writes the exact bytes (incl. BOM) to the clipboard.
  await page.locator('#quick-export-host .copy').click()
  const clip = await page.evaluate(() => (window as any).__copied)
  expect(clip).toBe(XML)

  // Download yields a file named after the export.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#quick-export-host .download').click()
  ])
  expect(download.suggestedFilename()).toBe('CheckFavoriteOwner.xml')
})

test('unpackaged item offers Add-to-package instead of exporting (D-01) @stub', async ({ page }) => {
  await setup(page, { inPackage: false })
  await page.locator('.btn').click()

  await expect(page.locator('#quick-export-host .status')).toContainText('not in any package')
  await expect(page.locator('#quick-export-host .addpkg')).toBeVisible()
  // It must NOT have called the export service.
  const sent = await page.evaluate(() => (window as any).__sent)
  expect(sent).toBeNull()
})
