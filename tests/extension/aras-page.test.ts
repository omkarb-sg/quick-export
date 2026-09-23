import { describe, it, expect } from 'vitest'
import {
  deriveBaseUrl,
  getConnContext,
  isItemFrame,
  collectItemFrames,
  resolveCurrentItemFrame,
  selectedTabWindow,
  readItemFromFrame,
  buildInPackageQuery,
  isNoItemsError,
  parseInPackageResult,
  resolvePackaging,
  buildExportRequest
} from '../../src/extension/lib/aras-page.js'

// --- Fakes modelled on the objects verified live in the 12sp9 client ---

function fakeAras(over: Record<string, unknown> = {}) {
  return {
    getServerURL: () => 'http://localhost/12sp9/Server/InnovatorServer.aspx',
    getDatabase: () => '12sp9',
    OAuthClient: { getAuthorizationHeader: () => ({ Authorization: 'Bearer JWT.abc.def' }) },
    ...over
  }
}

function fakeItem(props: Record<string, string>, related: Record<string, any> = {}) {
  return {
    getID: () => props.id ?? '',
    getType: () => props.type ?? '',
    getProperty: (n: string, dflt = '') => props[n] ?? dflt,
    getPropertyItem: (n: string) => related[n] ?? null
  }
}

/** An AML `<Item>` DOM node, as the Form / Life Cycle Map / Workflow Map editors expose it. */
function fakeItemNode(attrs: Record<string, string>, props: Record<string, string> = {}) {
  return {
    nodeType: 1,
    nodeName: 'Item',
    getAttribute: (n: string) => attrs[n] ?? null,
    childNodes: Object.entries(props).map(([k, v]) => ({ nodeType: 1, nodeName: k, textContent: v }))
  }
}

/** A top window with the 12.x tab strip: `arasTabs.selectedTab` names the active tab's frame. */
function fakeTabbedTop(tabs: Record<string, any>, selectedTab: string | null) {
  const wins = Object.values(tabs)
  const frames: Record<string | number, any> = { length: wins.length }
  wins.forEach((w, i) => (frames[i] = w))
  return {
    arasTabs: { selectedTab },
    document: { getElementById: (id: string) => (tabs[id] ? { contentWindow: tabs[id] } : null) },
    frames
  }
}

function fakeResult(opts: { error?: string; items?: any[] }) {
  const items = opts.items ?? []
  return {
    isError: () => !!opts.error,
    getErrorString: () => opts.error ?? '',
    getItemCount: () => items.length,
    getItemByIndex: (i: number) => items[i]
  }
}

describe('deriveBaseUrl', () => {
  it('strips the InnovatorServer.aspx suffix', () => {
    expect(deriveBaseUrl('http://localhost/12sp9/Server/InnovatorServer.aspx')).toBe('http://localhost/12sp9')
  })
  it('handles query strings and trailing slashes', () => {
    expect(deriveBaseUrl('https://plm/db/Server/InnovatorServer.aspx?x=1')).toBe('https://plm/db')
    expect(deriveBaseUrl('http://h/db/')).toBe('http://h/db')
  })
  it('is empty for empty input', () => {
    expect(deriveBaseUrl('')).toBe('')
  })
})

describe('getConnContext', () => {
  it('reads url, database and token from aras', () => {
    expect(getConnContext(fakeAras())).toEqual({
      url: 'http://localhost/12sp9',
      database: '12sp9',
      token: 'Bearer JWT.abc.def'
    })
  })
  it('throws when aras is missing', () => {
    expect(() => getConnContext(null)).toThrow(/aras object/)
  })
  it('throws when the token is unavailable', () => {
    const aras = fakeAras({ OAuthClient: { getAuthorizationHeader: () => ({}) } })
    expect(() => getConnContext(aras)).toThrow(/auth token/)
  })
  it('throws when the database is unavailable', () => {
    const aras = fakeAras({ getDatabase: () => '' })
    expect(() => getConnContext(aras)).toThrow(/database/)
  })
})

describe('item frame resolution', () => {
  const item = fakeItem({
    id: '08BE',
    type: 'Method',
    config_id: 'CFG08BE',
    keyed_name: 'CheckFavoriteOwner',
    name: 'CheckFavoriteOwner'
  })

  it('detects item frames by a usable thisItem', () => {
    expect(isItemFrame({ thisItem: item })).toBe(true)
    expect(isItemFrame({})).toBe(false)
    expect(isItemFrame({ thisItem: {} })).toBe(false)
  })

  it('detects Form / Life Cycle Map / Workflow Map editors by their item node (no thisItem)', () => {
    expect(isItemFrame({ item: fakeItemNode({ type: 'Form', id: 'F1' }) })).toBe(true)
    expect(isItemFrame({ item: fakeItemNode({ type: 'Form' }) })).toBe(false)
    expect(isItemFrame({ item: { nodeType: 3 } })).toBe(false)
    expect(isItemFrame({ item: 'not a node' })).toBe(false)
  })

  it('resolves the ACTIVE tab, not an earlier tab that is still laid out (opacity 0)', () => {
    const method = { thisItem: fakeItem({ id: 'M1', type: 'Method' }), frames: { length: 0 } }
    const identity = { thisItem: fakeItem({ id: 'I1', type: 'Identity' }), frames: { length: 0 } }
    const top = fakeTabbedTop({ tab_M1: method, tab_I1: identity }, 'tab_I1')
    // Every frame "looks" visible, as live inactive tabs do — the tab strip must decide.
    expect(resolveCurrentItemFrame(top, () => true)).toBe(identity)
  })

  it('resolves an active Form editor tab over an earlier item tab', () => {
    const method = { thisItem: fakeItem({ id: 'M1', type: 'Method' }), frames: { length: 0 } }
    const form = { item: fakeItemNode({ type: 'Form', id: 'F1' }), frames: { length: 0 } }
    const top = fakeTabbedTop({ tab_M1: method, tab_F1: form }, 'tab_F1')
    expect(resolveCurrentItemFrame(top, () => true)).toBe(form)
  })

  it('returns null when the active tab is not an item (never falls back to a background tab)', () => {
    const method = { thisItem: fakeItem({ id: 'M1', type: 'Method' }), frames: { length: 0 } }
    const search = { frames: { length: 0 } }
    expect(resolveCurrentItemFrame(fakeTabbedTop({ tab_M1: method, search_1: search }, 'search_1'), () => true)).toBeNull()
    expect(resolveCurrentItemFrame(fakeTabbedTop({ tab_M1: method }, null), () => true)).toBeNull()
  })

  it('selectedTabWindow is undefined without a tab strip, and finds the tab by frame name as a fallback', () => {
    expect(selectedTabWindow({ frames: { length: 0 } })).toBeUndefined()
    const w = { thisItem: item }
    const top = { arasTabs: { selectedTab: 'tab_X' }, frames: { tab_X: w, length: 1 } }
    expect(selectedTabWindow(top)).toBe(w)
  })

  it('collects nested item frames', () => {
    const leaf = { thisItem: item, frames: { length: 0 } }
    const mid = { frames: { 0: leaf, length: 1 } }
    const top = { frames: { 0: mid, length: 1 } }
    expect(collectItemFrames(top)).toEqual([leaf])
  })

  it('resolves the visible item frame among several', () => {
    const hidden = { thisItem: item, _vis: false, frames: { length: 0 } }
    const shown = { thisItem: item, _vis: true, frames: { length: 0 } }
    const top = { frames: { 0: hidden, 1: shown, length: 2 } }
    const got = resolveCurrentItemFrame(top, (w: any) => w._vis)
    expect(got).toBe(shown)
  })

  it('returns null when no item is open', () => {
    expect(resolveCurrentItemFrame({ frames: { length: 0 } }, () => true)).toBeNull()
  })

  it('reads identity from thisItem', () => {
    expect(readItemFromFrame({ thisItem: item })).toEqual({
      itemType: 'Method',
      itemId: '08BE',
      configId: 'CFG08BE',
      keyedName: 'CheckFavoriteOwner'
    })
  })

  it('falls back config_id->id and keyed_name->name->id', () => {
    const bare = fakeItem({ id: 'X1', type: 'Part' })
    expect(readItemFromFrame({ thisItem: bare })).toEqual({
      itemType: 'Part',
      itemId: 'X1',
      configId: 'X1',
      keyedName: 'X1'
    })
  })

  it('reads identity from an editor frame item node', () => {
    const node = fakeItemNode(
      { type: 'Life Cycle Map', id: 'LC1' },
      { keyed_name: 'sg_candidate_L_C', name: 'sg_candidate_L_C', config_id: 'LC1' }
    )
    expect(readItemFromFrame({ item: node, itemTypeName: 'Life Cycle Map' })).toEqual({
      itemType: 'Life Cycle Map',
      itemId: 'LC1',
      configId: 'LC1',
      keyedName: 'sg_candidate_L_C'
    })
  })

  it('item node falls back config_id->id and keyed_name->name->id', () => {
    expect(readItemFromFrame({ item: fakeItemNode({ type: 'Workflow Map', id: 'W1' }, { name: 'wf' }) })).toEqual({
      itemType: 'Workflow Map',
      itemId: 'W1',
      configId: 'W1',
      keyedName: 'wf'
    })
  })

  it('throws when no item present', () => {
    expect(() => readItemFromFrame({})).toThrow(/no open item/)
  })
})

describe('buildInPackageQuery', () => {
  it('queries PackageElement by element_id with nested package-name select', () => {
    const aml = buildInPackageQuery('CFG08BE')
    expect(aml).toContain("type='PackageElement'")
    expect(aml).toContain("select='name,element_type,source_id(source_id(name))'")
    expect(aml).toContain('<element_id>CFG08BE</element_id>')
  })
})

describe('parseInPackageResult', () => {
  it('returns the package name and the element name/type when the item is packaged', () => {
    const pkgDef = fakeItem({ type: 'PackageDefinition', name: 'com.aras.innovator.favorites' })
    const grp = fakeItem({ type: 'PackageGroup' }, { source_id: pkgDef })
    const pe = fakeItem({ type: 'PackageElement', name: 'CheckFavoriteOwner', element_type: 'Method' }, { source_id: grp })
    const res = fakeResult({ items: [pe] })
    expect(parseInPackageResult(res)).toEqual({
      inPackage: true,
      packageName: 'com.aras.innovator.favorites',
      elementName: 'CheckFavoriteOwner',
      elementType: 'Method'
    })
  })

  it('treats "No items of type PackageElement found" as not-in-package', () => {
    const res = fakeResult({ error: 'No items of type PackageElement found.' })
    expect(isNoItemsError(res)).toBe(true)
    expect(parseInPackageResult(res)).toEqual({ inPackage: false })
  })

  it('treats an empty result as not-in-package', () => {
    expect(parseInPackageResult(fakeResult({ items: [] }))).toEqual({ inPackage: false })
  })

  it('throws on a real (non "no items") error', () => {
    expect(() => parseInPackageResult(fakeResult({ error: 'Permission denied' }))).toThrow(/in-package query error/)
  })
})

describe('resolvePackaging', () => {
  /** A fake applyAML answering PackageElement lookups by element_id. */
  function fakeApply(
    elements: Record<string, { pkg: string; name: string; type: string }>,
  ) {
    const noItems = (t: string) => fakeResult({ error: `No items of type ${t} found.` })
    return (aml: string) => {
      const el = /<element_id>(\w+)<\/element_id>/.exec(aml)
      if (el) {
        const e = elements[el[1]!]
        if (!e) return noItems('PackageElement')
        const pkgDef = fakeItem({ type: 'PackageDefinition', name: e.pkg })
        const grp = fakeItem({ type: 'PackageGroup' }, { source_id: pkgDef })
        return fakeResult({ items: [fakeItem({ name: e.name, element_type: e.type }, { source_id: grp })] })
      }
      throw new Error('unexpected AML ' + aml)
    }
  }

  it('targets the element name (the native file name), not a drifted keyed_name', () => {
    // Live dev-olm: Form keyed_name "sg_goal_management" is packaged as element "sg_goal_manage".
    const apply = fakeApply({ F1: { pkg: 'com.steepgraph.olm', name: 'sg_goal_manage', type: 'Form' } })
    const item = { itemType: 'Form', itemId: 'F1', configId: 'F1', keyedName: 'sg_goal_management' }
    expect(resolvePackaging(apply, item)).toEqual({
      inPackage: true,
      packageName: 'com.steepgraph.olm',
      target: { itemType: 'Form', itemId: 'F1', keyedName: 'sg_goal_manage' }
    })
  })

  it('checks packaging by config_id but exports the open generation id', () => {
    const apply = fakeApply({ CFG: { pkg: 'p', name: 'M', type: 'Method' } })
    const item = { itemType: 'Method', itemId: 'GEN2', configId: 'CFG', keyedName: 'M' }
    expect(resolvePackaging(apply, item).target).toEqual({ itemType: 'Method', itemId: 'GEN2', keyedName: 'M' })
  })

  it('reports not-in-package for an unpackaged item', () => {
    const apply = fakeApply({})
    expect(resolvePackaging(apply, { itemType: 'Part', itemId: 'P1', configId: 'P1', keyedName: 'p' })).toEqual({
      inPackage: false,
      packageName: ''
    })
  })
})

describe('buildExportRequest', () => {
  it('assembles the service request body with the resolved package', () => {
    const conn = { url: 'http://localhost/12sp9', database: '12sp9', token: 'Bearer x' }
    const item = { itemType: 'Method', itemId: '08BE', configId: 'CFG', keyedName: 'CheckFavoriteOwner' }
    expect(buildExportRequest('r1', conn, item, 'com.aras.innovator.favorites')).toEqual({
      reqId: 'r1',
      conn,
      item: {
        itemType: 'Method',
        itemId: '08BE',
        keyedName: 'CheckFavoriteOwner',
        package: 'com.aras.innovator.favorites'
      },
      options: { exportReferenced: true }
    })
  })
})
