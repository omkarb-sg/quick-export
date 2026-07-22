/**
 * Build the package-grouped items table the host child (export.ps1) expects.
 * The SolutionUpgrade engine only accepts a package -> items shape, so a single-item
 * export is expressed as a one-package, one-item group.
 */
import type { ItemRef, PackageGroups } from './types.js'

/**
 * Group items by their package. Throws on an item with no package — callers must have
 * already resolved packaging (unpackaged items are blocked upstream, D-01).
 */
export function buildGroups(items: ItemRef[]): PackageGroups {
  if (items.length === 0) throw new Error('buildGroups: no items given')
  const groups: PackageGroups = {}
  for (const it of items) {
    if (!it.package || it.package.trim() === '') {
      throw new Error(`buildGroups: item ${it.itemType}/${it.itemId} has no package`)
    }
    const key = it.package
    ;(groups[key] ??= []).push({ itemType: it.itemType, itemId: it.itemId, keyedName: it.keyedName })
  }
  return groups
}

/** Convenience for the common single-item case. */
export function buildSingleGroup(item: ItemRef): PackageGroups {
  return buildGroups([item])
}
