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
  ' buildInPackageQuery, parseInPackageResult, isFrameVisible, collectItemFrames, isItemFrame };'

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

/**
 * Mirrors the live 12.x tab strip: every tab is an iframe that stays laid out; inactive tabs are
 * only `opacity: 0; z-index: -1`, and `top.arasTabs.selectedTab` names the active tab's frame.
 * The Form / Life Cycle Map / Workflow Map editors expose an AML item node, not `thisItem`.
 */
async function mountArasTabs(page: import('@playwright/test').Page, selected: string | null) {
  await page.evaluate((selected) => {
    function tab(id: string, active: boolean) {
      const f = document.createElement('iframe')
      f.id = id
      f.name = id
      f.style.cssText = 'width:300px;height:200px;position:absolute;left:0;top:0;' + (active ? 'opacity:1' : 'opacity:0;z-index:-1')
      document.body.appendChild(f)
      return f.contentWindow as any
    }
    const method = tab('innovator_M1', selected === 'innovator_M1')
    method.thisItem = { getID: () => 'M1', getType: () => 'Method', getProperty: (n: string, d = '') => (n === 'keyed_name' ? 'MyMethod' : d) }
    const form = tab('innovator_F1', selected === 'innovator_F1')
    form.item = new DOMParser().parseFromString(
      '<Item type="Form" id="F1"><keyed_name>MyForm</keyed_name><config_id>F1</config_id></Item>',
      'text/xml'
    ).documentElement
    tab('search_X', selected === 'search_X')
    ;(window as any).arasTabs = { selectedTab: selected }
  }, selected)
}

test('resolves the ACTIVE tab among laid-out opacity-0 tabs, incl. a Form editor (real DOM) @stub', async ({ page }) => {
  await mountArasTabs(page, 'innovator_F1')
  const item = await page.evaluate(() => {
    const lib = (window as any).__qeLib
    return lib.readItemFromFrame(lib.resolveCurrentItemFrame(window))
  })
  expect(item).toEqual({ itemType: 'Form', itemId: 'F1', configId: 'F1', keyedName: 'MyForm' })
})

test('an active non-item tab resolves to no item, not a background item tab (real DOM) @stub', async ({ page }) => {
  await mountArasTabs(page, 'search_X')
  const got = await page.evaluate(() => (window as any).__qeLib.resolveCurrentItemFrame(window))
  expect(got).toBeNull()
})

test('without a tab strip, an opacity-0 frame counts as hidden (real DOM) @stub', async ({ page }) => {
  await mountArasTabs(page, 'innovator_M1')
  const res = await page.evaluate(() => {
    delete (window as any).arasTabs
    const lib = (window as any).__qeLib
    const f = (id: string) => (document.getElementById(id) as HTMLIFrameElement).contentWindow
    return {
      methodVisible: lib.isFrameVisible(f('innovator_M1')),
      formVisible: lib.isFrameVisible(f('innovator_F1')),
      formIsItem: lib.isItemFrame(f('innovator_F1')),
      current: lib.readItemFromFrame(lib.resolveCurrentItemFrame(window)).itemId
    }
  })
  expect(res).toEqual({ methodVisible: true, formVisible: false, formIsItem: true, current: 'M1' })
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
    const pe = mk({ type: 'PackageElement', name: 'MyForm', element_type: 'Form' }, { source_id: grp })
    const res = { isError: () => false, getItemCount: () => 1, getItemByIndex: () => pe }
    return (window as any).__qeLib.parseInPackageResult(res)
  })
  expect(parsed).toEqual({ inPackage: true, packageName: 'com.acme.pkg', elementName: 'MyForm', elementType: 'Form' })
})

test('parseInPackageResult treats "no items" as not-in-package @stub', async ({ page }) => {
  const parsed = await page.evaluate(() => {
    const res = { isError: () => true, getErrorString: () => 'No items of type PackageElement found.', getItemCount: () => 0 }
    return (window as any).__qeLib.parseInPackageResult(res)
  })
  expect(parsed).toEqual({ inPackage: false })
})
