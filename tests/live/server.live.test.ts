/**
 * Live end-to-end test through the HTTP service: start the real server, POST a real export
 * request with a real OAuth token, assert native-identical XML comes back. Skips itself when
 * unconfigured / off-Windows. Run with: npm run test:live
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canRunLive, loadLiveConfig, isDefaultItem, type LiveConfig } from '../helpers/env.js'
import { mintToken } from '../../src/aras/oauth.js'
import { startServer } from '../../src/service/server.js'
import type { ExportResult } from '../../src/core/types.js'

const cfg = loadLiveConfig()
const suite = canRunLive() && cfg ? describe : describe.skip

suite('live export through the HTTP service', () => {
  let server: Server
  let base: string
  let config: LiveConfig

  beforeAll(async () => {
    config = cfg!
    const started = await startServer({ version: 'live' }, 0)
    server = started.server
    base = `http://127.0.0.1:${started.port}`
  })

  afterAll(() => {
    server?.close()
  })

  it('POST /export returns the item XML end-to-end', async () => {
    const tok = await mintToken({
      url: config.primary.url,
      database: config.primary.database,
      username: config.primary.username,
      password: config.primary.password
    })
    const body = {
      reqId: 'http-1',
      conn: { url: config.primary.url, database: config.primary.database, token: `${tok.tokenType} ${tok.accessToken}` },
      item: config.item,
      options: { exportReferenced: true }
    }
    const r = await fetch(`${base}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-quick-export': '1' },
      body: JSON.stringify(body)
    })
    expect(r.status).toBe(200)
    const result = (await r.json()) as ExportResult
    expect(result.ok, result.error).toBe(true)
    expect(result.filename).toBe(`${config.item.keyedName}.xml`)

    if (isDefaultItem(config)) {
      const golden = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'CheckFavoriteOwner.golden.xml'),
        'utf8'
      )
      expect(result.xml).toBe(golden)
    }
  })
})
