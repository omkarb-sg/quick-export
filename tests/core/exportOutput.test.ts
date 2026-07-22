import { describe, it, expect } from 'vitest'
import { parseExportStdout, pickItemXml, basename } from '../../src/core/exportOutput.js'

const OK_STDOUT = [
  'INFO: connected to http://localhost/12sp9 (db=12sp9, auth=token)',
  '  [PKG] Exporting package com.aras.innovator.favorites',
  '  [INFO] Item 1 of 1: Method - CheckFavoriteOwner',
  'QE_ENGINE_ERRORS: 0',
  'QE_XML: C:\\out\\com\\aras\\innovator\\favorites\\Method\\CheckFavoriteOwner.xml',
  'INFO: exported 1 xml file(s) from 1 requested item(s)',
  'QE_OK'
].join('\r\n')

describe('parseExportStdout', () => {
  it('parses a successful run', () => {
    const r = parseExportStdout(OK_STDOUT)
    expect(r.ok).toBe(true)
    expect(r.engineErrors).toBe(0)
    expect(r.xmlFiles).toEqual(['C:\\out\\com\\aras\\innovator\\favorites\\Method\\CheckFavoriteOwner.xml'])
    expect(r.failReason).toBeUndefined()
  })

  it('parses a failure with reason', () => {
    const r = parseExportStdout('QE_FAIL: Aras connection/auth failed: bad token')
    expect(r.ok).toBe(false)
    expect(r.failReason).toBe('Aras connection/auth failed: bad token')
  })

  it('captures a non-zero engine error count', () => {
    const r = parseExportStdout('QE_ENGINE_ERRORS: 3\nQE_OK')
    expect(r.engineErrors).toBe(3)
    expect(r.ok).toBe(true)
  })

  it('collects multiple xml files', () => {
    const r = parseExportStdout('QE_XML: /a/Method/M.xml\nQE_XML: /a/Part/P.xml\nQE_OK')
    expect(r.xmlFiles).toHaveLength(2)
  })
})

describe('basename', () => {
  it('handles windows and posix separators and trailing slashes', () => {
    expect(basename('C:\\out\\Method\\CheckFavoriteOwner.xml')).toBe('CheckFavoriteOwner.xml')
    expect(basename('/a/b/c.xml')).toBe('c.xml')
    expect(basename('/a/b/')).toBe('b')
  })
})

describe('pickItemXml', () => {
  const target = { itemType: 'Method', keyedName: 'CheckFavoriteOwner' }

  it('picks the exact ItemType/keyedName file among referenced items', () => {
    const files = [
      'C:\\out\\com\\aras\\favorites\\Identity\\World.xml',
      'C:\\out\\com\\aras\\favorites\\Method\\CheckFavoriteOwner.xml',
      'C:\\out\\com\\aras\\favorites\\Method\\OtherMethod.xml'
    ]
    expect(pickItemXml(files, target)).toBe('C:\\out\\com\\aras\\favorites\\Method\\CheckFavoriteOwner.xml')
  })

  it('is case-insensitive on type folder and file name', () => {
    const files = ['/o/method/checkfavoriteowner.xml']
    expect(pickItemXml(files, target)).toBe('/o/method/checkfavoriteowner.xml')
  })

  it('falls back to the single file under the ItemType folder', () => {
    const files = ['/o/Identity/World.xml', '/o/Method/DifferentName.xml']
    expect(pickItemXml(files, target)).toBe('/o/Method/DifferentName.xml')
  })

  it('falls back to the only file when there is exactly one', () => {
    const files = ['/o/Whatever/Single.xml']
    expect(pickItemXml(files, target)).toBe('/o/Whatever/Single.xml')
  })

  it('throws when ambiguous', () => {
    const files = ['/o/Identity/A.xml', '/o/Identity/B.xml']
    expect(() => pickItemXml(files, target)).toThrow(/ambiguous/)
  })

  it('throws on empty input', () => {
    expect(() => pickItemXml([], target)).toThrow(/no xml/)
  })
})
