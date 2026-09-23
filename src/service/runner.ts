/**
 * Runs one export by spawning the PowerShell host child (scripts/export.ps1), parsing its
 * output, selecting the requested item's XML, and reading it back. One child per export ⇒
 * every export is isolated in its own process (multi-instance safety, NFR-7).
 *
 * The spawn is injectable (ScriptRunner) so the parse/select/read-back logic is unit-tested
 * without a real PowerShell or Aras; the live integration test uses the default runner.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExportRequest, ExportResult } from '../core/types.js'
import { ErrorCode } from '../core/types.js'
import { buildSingleGroup } from '../core/groups.js'
import { parseExportStdout, pickItemXml, basename } from '../core/exportOutput.js'
import { resolveResources, type Resources } from './resources.js'

export interface ScriptRun {
  exitCode: number
  stdout: string
  stderr: string
}

export type ScriptRunner = (
  scriptPath: string,
  args: string[],
  env: Record<string, string>
) => Promise<ScriptRun>

/** Default runner: Windows PowerShell 5.1 (.NET Framework — required for the DLLs). */
export const defaultScriptRunner: ScriptRunner = (scriptPath, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      { env: { ...process.env, ...env }, windowsHide: true }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ exitCode: code ?? -1, stdout, stderr }))
  })

export interface RunnerDeps {
  resources?: Resources
  runner?: ScriptRunner
  /** Fresh empty dir for this export's output. Overridable in tests. */
  makeTempDir?: () => string
  /** Read the produced xml file. Overridable in tests. */
  readXml?: (path: string) => string
  platform?: NodeJS.Platform
  /** If false, keep the temp dir (debugging). Default true. */
  cleanup?: boolean
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'quick-export-'))
}

function fail(reqId: string, code: ErrorCode, error: string, engineErrors?: number): ExportResult {
  return { reqId, ok: false, code, error, engineErrors }
}

/** Map a host-child failure reason to a stable error code. */
export function classifyFailure(reason: string | undefined): ErrorCode {
  const r = (reason ?? '').toLowerCase()
  if (/auth|not logged in|token|401|unauthor/.test(r)) return ErrorCode.AUTH
  if (/no \.xml|no output|produced no/.test(r)) return ErrorCode.NO_OUTPUT
  return ErrorCode.SERVICE
}

/**
 * Execute a validated export request. Returns an ExportResult (never throws for expected
 * failures — auth, faults, no output — which are encoded as ok:false + code).
 */
export async function runExport(req: ExportRequest, deps: RunnerDeps = {}): Promise<ExportResult> {
  const platform = deps.platform ?? process.platform
  if (platform !== 'win32') {
    return fail(
      req.reqId,
      ErrorCode.SERVICE,
      `quick-export is Windows-only: the Aras export engine is a .NET Framework DLL run via ` +
        `Windows PowerShell, unavailable on ${platform}.`
    )
  }

  const res = deps.resources ?? resolveResources()
  const runner = deps.runner ?? defaultScriptRunner
  const readXml = deps.readXml ?? ((p: string) => readFileSync(p, 'utf8'))
  const cleanup = deps.cleanup ?? true

  const outDir = (deps.makeTempDir ?? tempDir)()
  const logFile = join(outDir, 'export.log')
  const groups = buildSingleGroup(req.item)

  try {
    const args = [
      '-ArasUrl', req.conn.url,
      '-ArasDatabase', req.conn.database,
      '-OutDir', outDir,
      '-LogFile', logFile,
      '-IomDll', res.iomDll,
      '-LibsDll', res.libsDll,
      '-GroupsJson', JSON.stringify(groups),
      '-ExportReferenced', req.options?.exportReferenced === false ? 'false' : 'true'
    ]
    // Token travels via env, never argv — keeps it out of the process table / any log.
    const run = await runner(res.exportScript, args, { ARAS_TOKEN: req.conn.token })
    const parsed = parseExportStdout(run.stdout)

    if (!parsed.ok || run.exitCode !== 0) {
      const reason = parsed.failReason || run.stderr.trim() || `host child exited ${run.exitCode}`
      return fail(req.reqId, classifyFailure(reason), reason, parsed.engineErrors)
    }
    if (parsed.engineErrors > 0) {
      return fail(
        req.reqId,
        ErrorCode.FAULT,
        `export engine reported ${parsed.engineErrors} error(s) — result is partial`,
        parsed.engineErrors
      )
    }
    if (parsed.xmlFiles.length === 0) {
      return fail(req.reqId, ErrorCode.NO_OUTPUT, 'export produced no .xml files')
    }

    const picked = pickItemXml(parsed.xmlFiles, { itemType: req.item.itemType, keyedName: req.item.keyedName })
    const xml = readXml(picked)
    return { reqId: req.reqId, ok: true, filename: basename(picked), xml, engineErrors: 0 }
  } catch (e) {
    return fail(req.reqId, ErrorCode.SERVICE, (e as Error).message)
  } finally {
    if (cleanup) {
      try {
        rmSync(outDir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
  }
}
