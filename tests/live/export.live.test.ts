/**
 * Live-Aras integration test (no mocking). Spawns the real PowerShell host child, connects
 * to a real Aras with a real OAuth token, and exports a real item. Asserts native-identical
 * output. Skips itself when config/test.env is absent or off-Windows.
 *
 * Run with: npm run test:live
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canRunLive, loadLiveConfig, isDefaultItem, type LiveConfig, type LiveInstance } from '../helpers/env.js'
import { mintToken } from '../../src/aras/oauth.js'
import { runExport } from '../../src/service/runner.js'
import { ErrorCode, type ExportRequest } from '../../src/core/types.js'

const cfg = loadLiveConfig()
const suite = canRunLive() && cfg ? describe : describe.skip

function fixturesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
}

async function requestFor(c: LiveConfig, inst: LiveInstance, reqId: string): Promise<ExportRequest> {
  const tok = await mintToken({
    url: inst.url,
    database: inst.database,
    username: inst.username,
    password: inst.password
  })
  return {
    reqId,
    conn: { url: inst.url, database: inst.database, token: `${tok.tokenType} ${tok.accessToken}` },
    item: c.item,
    options: { exportReferenced: true }
  }
}

suite('live export against a real Aras instance', () => {
  let config: LiveConfig

  beforeAll(() => {
    config = cfg!
  })

  it('exports the item and returns its XML', async () => {
    const req = await requestFor(config, config.primary, 'live-1')
    const res = await runExport(req)
    expect(res.ok, res.error).toBe(true)
    expect(res.filename).toBe(`${config.item.keyedName}.xml`)
    expect(res.engineErrors).toBe(0)
    expect(res.xml, 'xml should be non-empty').toBeTruthy()
    // Native export always starts with a UTF-8 BOM + <AML> root.
    expect(res.xml!.startsWith('﻿<AML>')).toBe(true)
    expect(res.xml).toContain(`type="${config.item.itemType}"`)
  })

  it('is byte-identical to the native golden export (default dev item)', async () => {
    if (!isDefaultItem(config)) {
      // Only the default CheckFavoriteOwner item has a committed golden fixture.
      return
    }
    const golden = readFileSync(join(fixturesDir(), 'CheckFavoriteOwner.golden.xml'), 'utf8')
    const req = await requestFor(config, config.primary, 'live-parity')
    const res = await runExport(req)
    expect(res.ok, res.error).toBe(true)
    expect(res.xml).toBe(golden)
  })

  it('runs two exports concurrently across instances without interference (NFR-7)', async () => {
    const [a, b] = await Promise.all([
      requestFor(config, config.primary, 'iso-A'),
      requestFor(config, config.second, 'iso-B')
    ])
    const [ra, rb] = await Promise.all([runExport(a), runExport(b)])
    expect(ra.ok, ra.error).toBe(true)
    expect(rb.ok, rb.error).toBe(true)
    expect(ra.reqId).toBe('iso-A')
    expect(rb.reqId).toBe('iso-B')
    expect(ra.filename).toBe(`${config.item.keyedName}.xml`)
    expect(rb.filename).toBe(`${config.item.keyedName}.xml`)
    // Same item exported twice concurrently -> identical bytes (no cross-talk).
    expect(ra.xml).toBe(rb.xml)
  })

  it('fails cleanly with AUTH on a bad token', async () => {
    const req: ExportRequest = {
      reqId: 'bad-tok',
      conn: { url: config.primary.url, database: config.primary.database, token: 'Bearer not-a-real-token' },
      item: config.item
    }
    const res = await runExport(req)
    expect(res.ok).toBe(false)
    expect(res.code).toBe(ErrorCode.AUTH)
  })
})
