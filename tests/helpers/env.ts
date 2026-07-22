/**
 * Test configuration loader. Reads config/test.env (KEY=VALUE, # comments) if present,
 * overlaid by real process.env, and exposes a typed view. Live tests skip themselves when
 * the config is absent, so `npm test` stays green on a machine with no Aras.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

let cached: Record<string, string> | undefined
function raw(): Record<string, string> {
  if (cached) return cached
  const file = join(repoRoot(), 'config', 'test.env')
  const fromFile = existsSync(file) ? parseEnvFile(readFileSync(file, 'utf8')) : {}
  // Real env wins over the file.
  cached = { ...fromFile, ...(process.env as Record<string, string>) }
  return cached
}

export interface LiveInstance {
  url: string
  database: string
  username: string
  password: string
}

export interface LiveConfig {
  primary: LiveInstance
  second: LiveInstance
  item: { itemType: string; itemId: string; keyedName: string; package: string }
  clientUrl: string
}

function inst(e: Record<string, string>, suffix = ''): LiveInstance | null {
  const url = e[`ARAS_URL${suffix}`]
  const database = e[`ARAS_DATABASE${suffix}`]
  const username = e[`ARAS_USER${suffix}`]
  const password = e[`ARAS_PASSWORD${suffix}`]
  if (!url || !database || !username || !password) return null
  return { url, database, username, password }
}

/** Returns the live config, or null if the primary instance is not fully configured. */
export function loadLiveConfig(): LiveConfig | null {
  const e = raw()
  const primary = inst(e)
  if (!primary) return null
  const second = inst(e, '_2') ?? primary
  return {
    primary,
    second,
    item: {
      itemType: e.ARAS_TEST_ITEM_TYPE ?? 'Method',
      itemId: e.ARAS_TEST_ITEM_ID ?? '08BE5CE05D8D45F5A11EFFE699A9C65D',
      keyedName: e.ARAS_TEST_ITEM_KEYEDNAME ?? 'CheckFavoriteOwner',
      package: e.ARAS_TEST_ITEM_PACKAGE ?? 'com.aras.innovator.favorites'
    },
    clientUrl: e.ARAS_CLIENT_URL ?? 'http://localhost/12sp9/Client/'
  }
}

/** True when live tests can run: config present and on Windows (DLLs are .NET Framework). */
export function canRunLive(): boolean {
  return loadLiveConfig() !== null && process.platform === 'win32'
}

/** The default dev item (CheckFavoriteOwner) has a committed golden fixture for byte-parity. */
export function isDefaultItem(cfg: LiveConfig): boolean {
  return cfg.item.itemId === '08BE5CE05D8D45F5A11EFFE699A9C65D'
}
