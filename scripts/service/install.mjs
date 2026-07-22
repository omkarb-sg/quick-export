/**
 * install — set up quick-export to run in the background automatically.
 *
 *   1. builds the server (dist/) if needed,
 *   2. installs + starts a Windows SERVICE (auto-start at boot), and
 *   3. adds a per-user STARTUP APP (HKCU Run key -> hidden launcher) that starts the server at
 *      login only if it isn't already up (so it never conflicts with the service).
 *
 * Requires administrator rights (creating a service). Run via install.cmd (which elevates) or
 * from an elevated terminal: `node scripts/service/install.mjs`.
 */
import { execFileSync, execSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import nodeWindows from 'node-windows'
import {
  SERVICE_NAME,
  SERVICE_DESCRIPTION,
  ENTRY,
  PORT,
  REPO_ROOT,
  RUN_KEY_PATH,
  RUN_KEY_NAME,
  VBS_PATH,
  LAUNCHER
} from './config.mjs'

const { Service } = nodeWindows

function fail(msg) {
  console.error('install: ' + msg)
  process.exit(1)
}

if (process.platform !== 'win32') fail('Windows only.')

function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!isAdmin()) {
  fail('administrator rights required. Run install.cmd (it elevates) or use an elevated terminal.')
}

// 1. Build if the server entry is missing.
if (!existsSync(ENTRY)) {
  console.log('install: building the server (npm run build)…')
  try {
    execSync('npm run build', { cwd: REPO_ROOT, stdio: 'inherit' })
  } catch {
    fail('build failed. Run `npm install` then `npm run build` and retry.')
  }
  if (!existsSync(ENTRY)) fail(`build did not produce ${ENTRY}`)
}

// 3 (helper). Add the per-user startup app: a Run key that launches a hidden VBS, which runs the
// node launcher (health-check-then-start). Node path is baked in so wscript needn't resolve PATH.
function addStartupApp() {
  const vbs =
    'Set sh = CreateObject("WScript.Shell")\r\n' +
    `sh.Run """${process.execPath}"" ""${LAUNCHER}""", 0, False\r\n`
  writeFileSync(VBS_PATH, vbs, 'utf8')
  execFileSync('reg', [
    'add',
    RUN_KEY_PATH,
    '/v',
    RUN_KEY_NAME,
    '/t',
    'REG_SZ',
    '/d',
    `wscript.exe "${VBS_PATH}"`,
    '/f'
  ])
  console.log('install: added startup app (HKCU Run > ' + RUN_KEY_NAME + ')')
}

// 2. Install + start the Windows service.
const svc = new Service({
  name: SERVICE_NAME,
  description: SERVICE_DESCRIPTION,
  script: ENTRY
})

svc.on('alreadyinstalled', () => {
  console.log('install: service already installed; ensuring it is started.')
  try {
    addStartupApp()
  } catch (e) {
    console.error('install: could not add startup app: ' + e.message)
  }
  svc.start()
})

svc.on('install', () => {
  console.log('install: Windows service "' + SERVICE_NAME + '" installed.')
  try {
    addStartupApp()
  } catch (e) {
    console.error('install: could not add startup app: ' + e.message)
  }
  svc.start()
})

svc.on('start', () => {
  console.log('install: service started on http://127.0.0.1:' + PORT)
  console.log('install: done. Load the extension (chrome://extensions -> Load unpacked -> src/extension).')
  process.exit(0)
})

svc.on('error', (e) => fail('service error: ' + (e && e.message ? e.message : e)))

console.log('install: installing Windows service "' + SERVICE_NAME + '"…')
svc.install()
