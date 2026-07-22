/**
 * @stub — runs in real Chromium, no Aras/service needed. Exercises the injected page-world
 * lib (src/extension/lib/aras-page.js) against REAL DOM iframes, covering the DOM-dependent
 * paths (isFrameVisible / collectItemFrames over real frames) that the Node unit tests fake.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const LIB = readFileSync(REPO + 'src/extension/lib/aras-page.js', 'utf8')
// Expose the module's bindings on window so page.evaluate can call them.
const EXPOSE =
  '\nwindow.__qeLib = { deriveBaseUrl, getConnContext, resolveCurrentItemFrame, readItemFromFrame,' +
  ' buildInPackageQuery, parseInPackageResult, isFrameVisible, collectItemFrames };'

test.beforeEach(async ({ page }) => {
  await page.setContent('<!doctype html><meta charset="utf-8"><title>aras-stub</title><body></body>')
  await page.addScriptTag({ type: 'module', content: LIB + EXPOSE })
})

test('resolves the current item from the VISIBLE frame (real DOM) @stub', async ({ page }) => {
  const result = await page.evaluate(() => {
    function mkItem(id: string) {
      const props: Record<string, string> = { config_id: 'CFG' + id, keyed_name: 'K' + id, name: 'K' + id }
      return {
        getID: () => id,
        getType: () => 'Method',
        getProperty: (n: string, d = '') => props[n] ?? d
      }
    }
    function mkFrame(visible: boolean, id: string) {
      const f = document.createElement('iframe')
      if (!visible) f.style.display = 'none'
      f.style.width = '300px'
      f.style.height = '200px'
      document.body.appendChild(f)
      const w = f.contentWindow as any
      w.thisItem = mkItem(id)
      w.__tag = id
      return f
    }
    mkFrame(false, 'HID')
    mkFrame(true, 'VIS')
    const lib = (window as any).__qeLib
    const frame = lib.resolveCurrentItemFrame(window)
    return { tag: frame.__tag, item: lib.readItemFromFrame(frame) }
  })
  expect(result.tag).toBe('VIS')
  expect(result.item).toEqual({ itemType: 'Method', itemId: 'VIS', configId: 'CFGVIS', keyedName: 'KVIS' })
})

test('getConnContext reads url/database/token from a live aras object @stub', async ({ page }) => {
  const conn = await page.evaluate(() => {
    const aras = {
      getServerURL: () => 'http://localhost/12sp9/Server/InnovatorServer.aspx',
      getDatabase: () => '12sp9',
      OAuthClient: { getAuthorizationHeader: () => ({ Authorization: 'Bearer TOK' }) }
    }
    return (window as any).__qeLib.getConnContext(aras)
  })
  expect(conn).toEqual({ url: 'http://localhost/12sp9', database: '12sp9', token: 'Bearer TOK' })
})

test('parseInPackageResult traverses PackageElement->PackageDefinition @stub', async ({ page }) => {
  const parsed = await page.evaluate(() => {
    const mk = (props: Record<string, string>, related: Record<string, any> = {}) => ({
      getType: () => props.type,
      getProperty: (n: string, d = '') => props[n] ?? d,
      getPropertyItem: (n: string) => related[n] ?? null
    })
    const pkgDef = mk({ type: 'PackageDefinition', name: 'com.acme.pkg' })
    const grp = mk({ type: 'PackageGroup' }, { source_id: pkgDef })
    const pe = mk({ type: 'PackageElement' }, { source_id: grp })
    const res = { isError: () => false, getItemCount: () => 1, getItemByIndex: () => pe }
    return (window as any).__qeLib.parseInPackageResult(res)
  })
  expect(parsed).toEqual({ inPackage: true, packageName: 'com.acme.pkg' })
})

test('parseInPackageResult treats "no items" as not-in-package @stub', async ({ page }) => {
  const parsed = await page.evaluate(() => {
    const res = { isError: () => true, getErrorString: () => 'No items of type PackageElement found.', getItemCount: () => 0 }
    return (window as any).__qeLib.parseInPackageResult(res)
  })
  expect(parsed).toEqual({ inPackage: false })
})
