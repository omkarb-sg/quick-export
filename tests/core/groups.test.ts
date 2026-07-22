import { describe, it, expect } from 'vitest'
import { buildGroups, buildSingleGroup } from '../../src/core/groups.js'
import type { ItemRef } from '../../src/core/types.js'

const method: ItemRef = {
  itemType: 'Method',
  itemId: '08BE5CE05D8D45F5A11EFFE699A9C65D',
  keyedName: 'CheckFavoriteOwner',
  package: 'com.aras.innovator.favorites'
}

describe('buildGroups', () => {
  it('maps a single item to a one-package one-item group', () => {
    const g = buildSingleGroup(method)
    expect(Object.keys(g)).toEqual(['com.aras.innovator.favorites'])
    expect(g['com.aras.innovator.favorites']).toEqual([
      { itemType: 'Method', itemId: '08BE5CE05D8D45F5A11EFFE699A9C65D', keyedName: 'CheckFavoriteOwner' }
    ])
  })

  it('does not leak the package field into the group items', () => {
    const g = buildSingleGroup(method)
    const item = g['com.aras.innovator.favorites']![0]!
    expect(item).not.toHaveProperty('package')
  })

  it('groups multiple items across packages', () => {
    const other: ItemRef = { itemType: 'Part', itemId: 'ID2', keyedName: 'P-1', package: 'com.acme.parts' }
    const same: ItemRef = { itemType: 'Method', itemId: 'ID3', keyedName: 'M2', package: 'com.aras.innovator.favorites' }
    const g = buildGroups([method, other, same])
    expect(Object.keys(g).sort()).toEqual(['com.acme.parts', 'com.aras.innovator.favorites'])
    expect(g['com.aras.innovator.favorites']).toHaveLength(2)
    expect(g['com.acme.parts']).toHaveLength(1)
  })

  it('throws on an empty list', () => {
    expect(() => buildGroups([])).toThrow(/no items/)
  })

  it('throws on an item with no package', () => {
    expect(() => buildGroups([{ ...method, package: '' }])).toThrow(/no package/)
  })
})
