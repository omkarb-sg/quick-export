/**
 * Shared config for the install/uninstall scripts and the startup launcher.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(here, '..', '..')

/** Windows service display name (node-windows derives the service id from this). */
export const SERVICE_NAME = 'QuickExport Aras Export Service'
export const SERVICE_DESCRIPTION =
  'Local host service for quick-export: exports the open Aras item to native-identical XML.'

/** The built server entry the service/launcher runs (see `npm run build`). */
export const ENTRY = join(REPO_ROOT, 'dist', 'service', 'index.js')

/** Loopback port (matches the extension + service default). */
export const PORT = Number(process.env.QUICK_EXPORT_PORT ?? 8737)

/** HKCU "Run" value name — shows up in Task Manager > Startup. */
export const RUN_KEY_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
export const RUN_KEY_NAME = 'QuickExportAras'

/** Hidden VBS launcher (run at login by the Run key) + the node launcher it calls. */
export const VBS_PATH = join(here, 'qe-startup.vbs')
export const LAUNCHER = join(here, 'qe-launcher.mjs')
