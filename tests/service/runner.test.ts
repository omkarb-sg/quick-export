import { describe, it, expect } from 'vitest'
import { runExport, classifyFailure, type ScriptRunner } from '../../src/service/runner.js'
import { ErrorCode, type ExportRequest } from '../../src/core/types.js'

const REQ: ExportRequest = {
  reqId: 'r1',
  conn: { url: 'http://localhost/12sp9', database: '12sp9', token: 'Bearer SECRET_TOKEN_VALUE' },
  item: {
    itemType: 'Method',
    itemId: '08BE5CE05D8D45F5A11EFFE699A9C65D',
    keyedName: 'CheckFavoriteOwner',
    package: 'com.aras.innovator.favorites'
  },
  options: { exportReferenced: true }
}

const FAKE_OUT = process.platform === 'win32' ? 'C:\\tmp\\qe-fake' : '/tmp/qe-fake'
const XML = '﻿<AML>\n <Item type="Method" id="08BE" action="add"><name>CheckFavoriteOwner</name></Item>\n</AML>\n'

/** A runner that pretends the host child ran successfully and wrote one file. */
function okRunner(captured?: { args?: string[]; env?: Record<string, string> }): ScriptRunner {
  return async (_script, args, env) => {
    if (captured) {
      captured.args = args
      captured.env = env
    }
    const outDir = args[args.indexOf('-OutDir') + 1]!
    const xmlPath = `${outDir}/com/aras/innovator/favorites/Method/CheckFavoriteOwner.xml`
    return {
      exitCode: 0,
      stdout: ['QE_ENGINE_ERRORS: 0', `QE_XML: ${xmlPath}`, 'QE_OK'].join('\n'),
      stderr: ''
    }
  }
}

const baseDeps = {
  platform: 'win32' as const,
  makeTempDir: () => FAKE_OUT,
  cleanup: false,
  readXml: () => XML
}

describe('runExport', () => {
  it('returns the item XML on success', async () => {
    const res = await runExport(REQ, { ...baseDeps, runner: okRunner() })
    expect(res.ok).toBe(true)
    expect(res.filename).toBe('CheckFavoriteOwner.xml')
    expect(res.xml).toBe(XML)
    expect(res.engineErrors).toBe(0)
    expect(res.reqId).toBe('r1')
  })

  it('passes the token via env, never via argv', async () => {
    const cap: { args?: string[]; env?: Record<string, string> } = {}
    await runExport(REQ, { ...baseDeps, runner: okRunner(cap) })
    expect(cap.env?.ARAS_TOKEN).toBe('Bearer SECRET_TOKEN_VALUE')
    expect(cap.args?.join(' ')).not.toContain('SECRET_TOKEN_VALUE')
  })

  it('sends the grouped items JSON to the child', async () => {
    const cap: { args?: string[] } = {}
    await runExport(REQ, { ...baseDeps, runner: okRunner(cap) })
    const groupsJson = cap.args![cap.args!.indexOf('-GroupsJson') + 1]!
    expect(JSON.parse(groupsJson)).toEqual({
      'com.aras.innovator.favorites': [
        { itemType: 'Method', itemId: '08BE5CE05D8D45F5A11EFFE699A9C65D', keyedName: 'CheckFavoriteOwner' }
      ]
    })
  })

  it('maps an auth failure to code AUTH', async () => {
    const runner: ScriptRunner = async () => ({
      exitCode: 1,
      stdout: 'QE_FAIL: Aras connection/auth failed: Not logged in',
      stderr: ''
    })
    const res = await runExport(REQ, { ...baseDeps, runner })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(ErrorCode.AUTH)
  })

  it('maps engine errors to code FAULT (partial result)', async () => {
    const runner: ScriptRunner = async (_s, args) => {
      const outDir = args[args.indexOf('-OutDir') + 1]!
      return { exitCode: 0, stdout: `QE_ENGINE_ERRORS: 2\nQE_XML: ${outDir}/Method/X.xml\nQE_OK`, stderr: '' }
    }
    const res = await runExport(REQ, { ...baseDeps, runner })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(ErrorCode.FAULT)
    expect(res.engineErrors).toBe(2)
  })

  it('maps no output to code NO_OUTPUT', async () => {
    const runner: ScriptRunner = async () => ({ exitCode: 0, stdout: 'QE_ENGINE_ERRORS: 0\nQE_OK', stderr: '' })
    const res = await runExport(REQ, { ...baseDeps, runner })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(ErrorCode.NO_OUTPUT)
  })

  it('refuses to run on a non-Windows platform', async () => {
    const res = await runExport(REQ, { ...baseDeps, platform: 'linux', runner: okRunner() })
    expect(res.ok).toBe(false)
    expect(res.code).toBe(ErrorCode.SERVICE)
    expect(res.error).toMatch(/Windows-only/)
  })
})

describe('classifyFailure', () => {
  it.each([
    ['Not logged in', ErrorCode.AUTH],
    ['401 Unauthorized', ErrorCode.AUTH],
    ['bad token', ErrorCode.AUTH],
    ['Export produced no .xml files', ErrorCode.NO_OUTPUT],
    ['something else exploded', ErrorCode.SERVICE],
    [undefined, ErrorCode.SERVICE]
  ])('classifies %s', (reason, code) => {
    expect(classifyFailure(reason as string | undefined)).toBe(code)
  })
})
