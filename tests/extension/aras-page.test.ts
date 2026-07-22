import { describe, it, expect } from 'vitest'
import {
  deriveBaseUrl,
  getConnContext,
  isItemFrame,
  collectItemFrames,
  resolveCurrentItemFrame,
  readItemFromFrame,
  buildInPackageQuery,
  isNoItemsError,
  parseInPackageResult,
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

  it('throws when no item present', () => {
    expect(() => readItemFromFrame({})).toThrow(/no open item/)
  })
})

describe('buildInPackageQuery', () => {
  it('queries PackageElement by element_id with nested package-name select', () => {
    const aml = buildInPackageQuery('CFG08BE')
    expect(aml).toContain("type='PackageElement'")
    expect(aml).toContain("select='source_id(source_id(name))'")
    expect(aml).toContain('<element_id>CFG08BE</element_id>')
  })
})

describe('parseInPackageResult', () => {
  it('returns the package name when the item is packaged', () => {
    const pkgDef = fakeItem({ type: 'PackageDefinition', name: 'com.aras.innovator.favorites' })
    const grp = fakeItem({ type: 'PackageGroup' }, { source_id: pkgDef })
    const pe = fakeItem({ type: 'PackageElement' }, { source_id: grp })
    const res = fakeResult({ items: [pe] })
    expect(parseInPackageResult(res)).toEqual({ inPackage: true, packageName: 'com.aras.innovator.favorites' })
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
