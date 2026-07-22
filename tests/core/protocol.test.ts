import { describe, it, expect } from 'vitest'
import { validateExportRequest } from '../../src/core/protocol.js'
import { ErrorCode } from '../../src/core/types.js'

const good = {
  reqId: 'r1',
  conn: { url: 'http://localhost/12sp9', database: '12sp9', token: 'Bearer abc' },
  item: {
    itemType: 'Method',
    itemId: '08BE5CE05D8D45F5A11EFFE699A9C65D',
    keyedName: 'CheckFavoriteOwner',
    package: 'com.aras.innovator.favorites'
  }
}

describe('validateExportRequest', () => {
  it('accepts a well-formed request and defaults exportReferenced to true', () => {
    const res = validateExportRequest(good)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.item.keyedName).toBe('CheckFavoriteOwner')
      expect(res.value.options?.exportReferenced).toBe(true)
    }
  })

  it('trims whitespace on all string fields', () => {
    const res = validateExportRequest({
      ...good,
      reqId: '  r1  ',
      item: { ...good.item, keyedName: '  CheckFavoriteOwner  ' }
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.reqId).toBe('r1')
      expect(res.value.item.keyedName).toBe('CheckFavoriteOwner')
    }
  })

  it('respects an explicit exportReferenced=false', () => {
    const res = validateExportRequest({ ...good, options: { exportReferenced: false } })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.options?.exportReferenced).toBe(false)
  })

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['a number', 5],
    ['an array', []]
  ])('rejects non-object input: %s', (_label, input) => {
    const res = validateExportRequest(input)
    expect(res.ok).toBe(false)
  })

  it.each(['reqId', 'conn', 'item'])('rejects missing top-level field: %s', (field) => {
    const clone: Record<string, unknown> = structuredClone(good)
    delete clone[field]
    const res = validateExportRequest(clone)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe(ErrorCode.BAD_REQUEST)
  })

  it.each(['url', 'database', 'token'])('rejects missing conn.%s', (field) => {
    const clone = structuredClone(good)
    delete (clone.conn as Record<string, unknown>)[field]
    const res = validateExportRequest(clone)
    expect(res.ok).toBe(false)
  })

  it.each(['itemType', 'itemId', 'keyedName'])('rejects missing item.%s', (field) => {
    const clone = structuredClone(good)
    delete (clone.item as Record<string, unknown>)[field]
    const res = validateExportRequest(clone)
    expect(res.ok).toBe(false)
  })

  it('rejects an unpackaged item with the UNPACKAGED code (D-01)', () => {
    const clone = structuredClone(good)
    delete (clone.item as Record<string, unknown>).package
    const res = validateExportRequest(clone)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe(ErrorCode.UNPACKAGED)
  })

  it('rejects an empty-string package with the UNPACKAGED code', () => {
    const res = validateExportRequest({ ...good, item: { ...good.item, package: '   ' } })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe(ErrorCode.UNPACKAGED)
  })

  it('rejects a non-boolean exportReferenced', () => {
    const res = validateExportRequest({ ...good, options: { exportReferenced: 'yes' } })
    expect(res.ok).toBe(false)
  })
})
