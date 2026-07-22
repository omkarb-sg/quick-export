/**
 * Page-world (MAIN) script. Runs inside the Aras client page so it can read `top.aras`.
 * It exposes a tiny message API to the content script (which cannot see page globals).
 *
 * Injected by content.js as a module <script>. All Aras access goes through the verified,
 * unit-tested helpers in lib/aras-page.js. Per project directive it uses
 * aras.IomInnovator.applyAML (not aras.applyAML).
 */
import {
  getConnContext,
  resolveCurrentItemFrame,
  readItemFromFrame,
  buildInPackageQuery,
  parseInPackageResult,
  buildExportRequest
} from './lib/aras-page.js'

function arasObj() {
  return window.aras || (window.top && window.top.aras) || null
}

function newReqId() {
  try {
    return 'qe-' + crypto.randomUUID()
  } catch {
    return 'qe-' + Date.now() + '-' + Math.floor(Math.random() * 1e9)
  }
}

/** Resolve everything the panel needs about the current item. */
function getContext() {
  const aras = arasObj()
  if (!aras) throw new Error('Aras client not detected (top.aras missing).')
  const conn = getConnContext(aras)
  const frame = resolveCurrentItemFrame(window.top || window)
  if (!frame) throw new Error('No item is open. Open an item in a tab, then export.')
  const item = readItemFromFrame(frame)
  const res = aras.IomInnovator.applyAML(buildInPackageQuery(item.configId))
  const pkg = parseInPackageResult(res)
  const out = { item, inPackage: pkg.inPackage, packageName: pkg.packageName || '' }
  if (pkg.inPackage) {
    if (!out.packageName) throw new Error('Item is packaged but its PackageDefinition name could not be resolved.')
    out.request = buildExportRequest(newReqId(), conn, item, out.packageName)
  }
  return out
}

/** Reuse the client's native "Add to Package Definition" flow (opens Aras's own dialog). */
function addToPackage(item) {
  const aras = arasObj()
  if (!aras) throw new Error('Aras client not detected.')
  if (typeof aras.addItemToPackageDef !== 'function') throw new Error('addItemToPackageDef not available on this client.')
  aras.addItemToPackageDef([item.itemId], item.itemType)
  return { added: true }
}

window.addEventListener('message', (ev) => {
  const d = ev.data
  if (!d || d.__qe !== 'req') return
  let ok = true
  let result
  let error
  try {
    if (d.action === 'hasAras') result = { hasAras: !!arasObj() }
    else if (d.action === 'getContext') result = getContext()
    else if (d.action === 'addToPackage') result = addToPackage(d.payload)
    else throw new Error('unknown action: ' + d.action)
  } catch (e) {
    ok = false
    error = (e && e.message) || String(e)
  }
  window.postMessage({ __qe: 'res', id: d.id, ok, result, error }, '*')
})

// Announce readiness so the content script knows the bridge is live.
window.postMessage({ __qe: 'ready' }, '*')
