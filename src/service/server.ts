/**
 * The stateless local host service: a loopback HTTP server the browser extension calls.
 *
 *   GET  /health   -> { ok, name, version }
 *   POST /export   -> ExportResult   (body = ExportRequest)
 *
 * Security posture (see spec §9): binds 127.0.0.1 only; CORS is granted ONLY to browser-
 * extension origins (chrome-/moz-extension://); a custom `x-quick-export` request header is
 * required, which forces a CORS preflight that a plain cross-origin web page cannot satisfy.
 * The service is stateless — every request carries its own {url, database, token}.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import type { ExportRequest, ExportResult } from '../core/types.js'
import { ErrorCode } from '../core/types.js'
import { validateExportRequest } from '../core/protocol.js'
import { runExport, type RunnerDeps } from './runner.js'

export const SERVICE_NAME = 'quick-export'
export const DEFAULT_PORT = 8737
const MAX_BODY_BYTES = 1_000_000
const REQUIRED_HEADER = 'x-quick-export'

export interface ServerDeps {
  version?: string
  runnerDeps?: RunnerDeps
  /** Override the export implementation (tests inject a fake). */
  exportFn?: (req: ExportRequest) => Promise<ExportResult>
}

function extensionOrigin(origin: string | undefined): string | null {
  if (origin && /^(chrome|moz)-extension:\/\//.test(origin)) return origin
  return null
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const allow = extensionOrigin(req.headers.origin as string | undefined)
  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', allow)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-quick-export')
    res.setHeader('Access-Control-Max-Age', '600')
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function createQuickExportServer(deps: ServerDeps = {}): Server {
  const version = deps.version ?? '0.1.0'
  const exportFn = deps.exportFn ?? ((req: ExportRequest) => runExport(req, deps.runnerDeps))

  return createServer(async (req, res) => {
    setCors(req, res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = req.url ?? '/'

    if (req.method === 'GET' && url === '/health') {
      sendJson(res, 200, { ok: true, name: SERVICE_NAME, version })
      return
    }

    if (req.method === 'POST' && url === '/export') {
      // Defense in depth: require the custom header (forces a preflight cross-origin).
      if (!req.headers[REQUIRED_HEADER]) {
        sendJson(res, 403, { ok: false, code: ErrorCode.BAD_REQUEST, error: `missing ${REQUIRED_HEADER} header` })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(await readBody(req))
      } catch (e) {
        sendJson(res, 400, { ok: false, code: ErrorCode.BAD_REQUEST, error: `invalid JSON: ${(e as Error).message}` })
        return
      }
      const v = validateExportRequest(parsed)
      if (!v.ok) {
        const reqId = (parsed as { reqId?: string })?.reqId ?? ''
        sendJson(res, 400, { reqId, ok: false, code: v.code, error: v.error } satisfies ExportResult)
        return
      }
      const result = await exportFn(v.value)
      // A well-formed request that fails to export is still HTTP 200 — the failure is in the
      // body (ok:false + code). Reserve non-2xx for transport/shape problems.
      sendJson(res, 200, result)
      return
    }

    sendJson(res, 404, { ok: false, code: ErrorCode.BAD_REQUEST, error: `not found: ${req.method} ${url}` })
  })
}

/** Start the server on 127.0.0.1. Resolves with the actual bound port. */
export function startServer(deps: ServerDeps = {}, port: number = DEFAULT_PORT, host = '127.0.0.1'): Promise<{ server: Server; port: number }> {
  const server = createQuickExportServer(deps)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const addr = server.address()
      const boundPort = typeof addr === 'object' && addr ? addr.port : port
      resolve({ server, port: boundPort })
    })
  })
}

/**
 * Probe GET /health on a loopback port. Resolves true iff a *quick-export* service answers —
 * used to tell "our own instance already holds the port" from "some other program grabbed it".
 */
export async function isServiceHealthy(port: number, host = '127.0.0.1', timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return false
    const body = (await res.json()) as { name?: string }
    return body?.name === SERVICE_NAME
  } catch {
    return false
  }
}

export type StartStatus = 'listening' | 'deferred' | 'error'

export interface StartOutcome {
  status: StartStatus
  port: number
  /** Present only when status === 'listening'. */
  server?: Server
  message: string
}

/**
 * Start the service, tolerating the fixed port already being held:
 *   free port                       -> 'listening' (we bound it)
 *   held by a healthy quick-export  -> 'deferred'  (another instance already serves; no-op)
 *   held by something else / error  -> 'error'
 *
 * Makes startup idempotent so the boot Windows service and the login launcher can race the port
 * without one crashing the other. The port is FIXED because the extension's host_permissions pin
 * it — see DEFAULT_PORT here and host_permissions in src/extension/manifest.json.
 */
export async function startServiceTolerant(
  deps: ServerDeps = {},
  port: number = DEFAULT_PORT,
  host = '127.0.0.1'
): Promise<StartOutcome> {
  try {
    const { server, port: bound } = await startServer(deps, port, host)
    return { status: 'listening', port: bound, server, message: `listening on http://${host}:${bound}` }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'EADDRINUSE') {
      if (await isServiceHealthy(port, host)) {
        return { status: 'deferred', port, message: `port ${port} already served by another quick-export instance — nothing to do` }
      }
      return { status: 'error', port, message: `port ${port} is held by another program (not quick-export). Free it and retry.` }
    }
    return { status: 'error', port, message: `failed to start: ${err.message}` }
  }
}
