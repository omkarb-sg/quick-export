/**
 * Login-time launcher for the "startup app" entry. It starts the quick-export server ONLY if
 * it is not already up — so it coexists with the Windows service (which starts at boot) without
 * ever double-binding the port. Started hidden by qe-startup.vbs from the HKCU Run key.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ENTRY, PORT } from './config.mjs'

async function alreadyRunning() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false
    const j = await res.json()
    return j && j.name === 'quick-export'
  } catch {
    return false
  }
}

async function main() {
  if (await alreadyRunning()) {
    process.exit(0) // the Windows service (or a prior launch) already has it — nothing to do.
  }
  if (!existsSync(ENTRY)) {
    // Not built. Nothing we can do silently at login; exit quietly.
    process.exit(0)
  }
  const child = spawn(process.execPath, [ENTRY], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.unref()
  process.exit(0)
}

void main()
