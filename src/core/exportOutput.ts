/**
 * Pure helpers for turning the host child's output into the single item XML we surface.
 * The child writes a native package folder (possibly many .xml files when referenced items
 * are included); quick-export surfaces exactly the requested item's file (D-04).
 */

/** Structured view of the host child's stdout contract (see scripts/export.ps1). */
export interface HostChildOutput {
  ok: boolean
  engineErrors: number
  xmlFiles: string[]
  failReason?: string
}

/** Parse the QE_* line contract the host child prints. Pure — operates on captured stdout. */
export function parseExportStdout(stdout: string): HostChildOutput {
  const lines = stdout.split(/\r?\n/)
  let ok = false
  let engineErrors = 0
  let failReason: string | undefined
  const xmlFiles: string[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === 'QE_OK') ok = true
    else if (line.startsWith('QE_FAIL:')) failReason = line.slice('QE_FAIL:'.length).trim()
    else if (line.startsWith('QE_ENGINE_ERRORS:')) {
      const n = Number(line.slice('QE_ENGINE_ERRORS:'.length).trim())
      if (Number.isFinite(n)) engineErrors = n
    } else if (line.startsWith('QE_XML:')) {
      const p = line.slice('QE_XML:'.length).trim()
      if (p) xmlFiles.push(p)
    }
  }
  return { ok, engineErrors, xmlFiles, failReason }
}

/** Last path segment, tolerant of both `/` and `\` separators. */
export function basename(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = norm.lastIndexOf('/')
  return idx >= 0 ? norm.slice(idx + 1) : norm
}

/** Second-to-last path segment (the ItemType folder in a native export tree). */
function parentSegment(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = norm.split('/')
  return parts.length >= 2 ? parts[parts.length - 2]! : ''
}

function stripXml(name: string): string {
  return name.replace(/\.xml$/i, '')
}

export interface PickTarget {
  itemType: string
  keyedName: string
}

/**
 * Choose the one .xml file that is the requested item's export. A native export tree lays
 * each element out as `<...>/<ItemType>/<keyedName>.xml`, so we match on the ItemType folder
 * and the file name. Referenced items (other types / names) are ignored.
 *
 * Resolution order:
 *   1. exact match: parent folder == itemType AND file == keyedName.xml
 *   2. single file under the itemType folder
 *   3. single file overall
 * Otherwise throws with the candidate list (ambiguous — caller should surface it).
 */
export function pickItemXml(xmlFiles: string[], target: PickTarget): string {
  if (xmlFiles.length === 0) throw new Error('pickItemXml: no xml files produced')

  const typeLc = target.itemType.toLowerCase()
  const nameLc = target.keyedName.toLowerCase()

  const exact = xmlFiles.find(
    (f) => parentSegment(f).toLowerCase() === typeLc && stripXml(basename(f)).toLowerCase() === nameLc
  )
  if (exact) return exact

  const underType = xmlFiles.filter((f) => parentSegment(f).toLowerCase() === typeLc)
  if (underType.length === 1) return underType[0]!

  const byName = xmlFiles.filter((f) => stripXml(basename(f)).toLowerCase() === nameLc)
  if (byName.length === 1) return byName[0]!

  if (xmlFiles.length === 1) return xmlFiles[0]!

  throw new Error(
    `pickItemXml: ambiguous — ${xmlFiles.length} files, none uniquely match ${target.itemType}/${target.keyedName}: ${xmlFiles
      .map(basename)
      .join(', ')}`
  )
}
