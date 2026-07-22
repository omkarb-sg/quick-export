import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import {
  createQuickExportServer,
  startServer,
  startServiceTolerant,
  isServiceHealthy
} from '../../src/service/server.js'
import type { ExportRequest, ExportResult } from '../../src/core/types.js'
import { ErrorCode } from '../../src/core/types.js'

const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnop'

const goodBody = {
  reqId: 'r1',
  conn: { url: 'http://localhost/12sp9', database: '12sp9', token: 'Bearer abc' },
  item: {
    itemType: 'Method',
    itemId: '08BE',
    keyedName: 'CheckFavoriteOwner',
    package: 'com.aras.innovator.favorites'
  }
}

let server: Server
let base: string
let lastRequest: ExportRequest | undefined

beforeAll(async () => {
  const fakeExport = async (req: ExportRequest): Promise<ExportResult> => {
    lastRequest = req
    return { reqId: req.reqId, ok: true, filename: 'CheckFavoriteOwner.xml', xml: '<AML/>', engineErrors: 0 }
  }
  server = createQuickExportServer({ version: '9.9.9', exportFn: fakeExport })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  base = `http://127.0.0.1:${port}`
})

afterAll(() => {
  server.close()
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-quick-export': '1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })

describe('GET /health', () => {
  it('reports name and version', async () => {
    const r = await fetch(`${base}/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, name: 'quick-export', version: '9.9.9' })
  })
})

describe('POST /export', () => {
  it('runs a valid request and returns the result', async () => {
    const r = await post(goodBody)
    expect(r.status).toBe(200)
    const body = (await r.json()) as ExportResult
    expect(body.ok).toBe(true)
    expect(body.filename).toBe('CheckFavoriteOwner.xml')
    expect(lastRequest?.item.keyedName).toBe('CheckFavoriteOwner')
  })

  it('rejects a request missing the x-quick-export header (403)', async () => {
    const r = await fetch(`${base}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(goodBody)
    })
    expect(r.status).toBe(403)
  })

  it('rejects invalid JSON (400)', async () => {
    const r = await post('{not json')
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe(ErrorCode.BAD_REQUEST)
  })

  it('rejects an unpackaged item with UNPACKAGED (400)', async () => {
    const { package: _pkg, ...item } = goodBody.item
    const r = await post({ ...goodBody, item })
    expect(r.status).toBe(400)
    const body = (await r.json()) as ExportResult
    expect(body.code).toBe(ErrorCode.UNPACKAGED)
  })

  it('echoes reqId on a validation failure', async () => {
    const { package: _pkg, ...item } = goodBody.item
    const r = await post({ ...goodBody, reqId: 'zz', item })
    const body = (await r.json()) as ExportResult
    expect(body.reqId).toBe('zz')
  })
})

describe('CORS', () => {
  it('grants CORS to an extension origin on preflight', async () => {
    const r = await fetch(`${base}/export`, {
      method: 'OPTIONS',
      headers: { origin: EXT_ORIGIN, 'access-control-request-method': 'POST' }
    })
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-origin')).toBe(EXT_ORIGIN)
  })

  it('does NOT grant CORS to a random web origin', async () => {
    const r = await fetch(`${base}/export`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' }
    })
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('unknown routes', () => {
  it('404s', async () => {
    const r = await fetch(`${base}/nope`)
    expect(r.status).toBe(404)
  })
})

describe('isServiceHealthy', () => {
  it('true against a running quick-export server', async () => {
    const { server: s, port } = await startServer({ version: '9.9.9' }, 0)
    try {
      expect(await isServiceHealthy(port)).toBe(true)
    } finally {
      s.close()
    }
  })

  it('false against a closed port', async () => {
    // Bind then close to get a very-likely-free port, then probe it.
    const { server: s, port } = await startServer({ version: '9.9.9' }, 0)
    await new Promise<void>((r) => s.close(() => r()))
    expect(await isServiceHealthy(port, '127.0.0.1', 500)).toBe(false)
  })
})

describe('startServiceTolerant (collision-tolerant startup)', () => {
  it('binds a free port -> listening', async () => {
    const outcome = await startServiceTolerant({ version: '9.9.9' }, 0)
    expect(outcome.status).toBe('listening')
    expect(outcome.server).toBeDefined()
    expect(outcome.port).toBeGreaterThan(0)
    outcome.server?.close()
  })

  it('defers when the port is already served by a quick-export instance', async () => {
    // First instance grabs an ephemeral port; a second start on it must defer, not crash.
    const first = await startServer({ version: '9.9.9' }, 0)
    try {
      const outcome = await startServiceTolerant({ version: '9.9.9' }, first.port)
      expect(outcome.status).toBe('deferred')
      expect(outcome.server).toBeUndefined()
    } finally {
      first.server.close()
    }
  })

  it('errors when the port is held by a non-quick-export program', async () => {
    // A plain server whose /health does NOT identify as quick-export.
    const intruder = createServer((_req, res) => {
      res.writeHead(200)
      res.end('not me')
    })
    await new Promise<void>((r) => intruder.listen(0, '127.0.0.1', r))
    const addr = intruder.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    try {
      const outcome = await startServiceTolerant({ version: '9.9.9' }, port)
      expect(outcome.status).toBe('error')
      expect(outcome.message).toMatch(/held by another program/)
    } finally {
      intruder.close()
    }
  })
})
