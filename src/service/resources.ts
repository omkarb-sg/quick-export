/**
 * Locate the bundled resources (scripts/export.ps1 + native DLLs) relative to this module,
 * so the service works both from src/ (tsx/vitest) and a built dist/.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Resources {
  exportScript: string
  iomDll: string
  libsDll: string
}

/** Walk up from `startDir` to the first ancestor containing `scripts/export.ps1`. */
export function findResourceRoot(startDir = dirname(fileURLToPath(import.meta.url))): string {
  let dir = startDir
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'scripts', 'export.ps1'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Could not locate quick-export resource root (no scripts/export.ps1) above ${startDir}`)
}

export function resolveResources(root = findResourceRoot()): Resources {
  return {
    exportScript: join(root, 'scripts', 'export.ps1'),
    iomDll: join(root, 'native', 'IOM.dll'),
    libsDll: join(root, 'native', 'Libs.dll')
  }
}
