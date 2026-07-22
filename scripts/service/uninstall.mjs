/**
 * uninstall — remove everything install set up:
 *   1. the per-user STARTUP APP (HKCU Run key + the VBS launcher), and
 *   2. the Windows SERVICE (stopped + deleted).
 *
 * Requires administrator rights (deleting a service). Run via uninstall.cmd (which elevates) or
 * from an elevated terminal: `node scripts/service/uninstall.mjs`.
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import nodeWindows from 'node-windows'
import { SERVICE_NAME, ENTRY, RUN_KEY_PATH, RUN_KEY_NAME, VBS_PATH } from './config.mjs'

const { Service } = nodeWindows

if (process.platform !== 'win32') {
  console.error('uninstall: Windows only.')
  process.exit(1)
}

function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!isAdmin()) {
  console.error('uninstall: administrator rights required. Run uninstall.cmd (it elevates) or use an elevated terminal.')
  process.exit(1)
}

// 1. Remove the startup app (best-effort — fine if it was never added).
try {
  execFileSync('reg', ['delete', RUN_KEY_PATH, '/v', RUN_KEY_NAME, '/f'], { stdio: 'ignore' })
  console.log('uninstall: removed startup app (HKCU Run > ' + RUN_KEY_NAME + ')')
} catch {
  console.log('uninstall: no startup app entry to remove.')
}
try {
  if (existsSync(VBS_PATH)) rmSync(VBS_PATH, { force: true })
} catch {
  /* best-effort */
}

// 2. Stop + delete the Windows service.
const svc = new Service({ name: SERVICE_NAME, script: ENTRY })

svc.on('uninstall', () => {
  console.log('uninstall: Windows service "' + SERVICE_NAME + '" removed.')
  console.log('uninstall: done.')
  process.exit(0)
})

svc.on('error', (e) => {
  console.error('uninstall: service error: ' + (e && e.message ? e.message : e))
  process.exit(1)
})

if (!svc.exists) {
  console.log('uninstall: service not installed; nothing to remove.')
  process.exit(0)
}

console.log('uninstall: removing Windows service "' + SERVICE_NAME + '"…')
svc.uninstall()
