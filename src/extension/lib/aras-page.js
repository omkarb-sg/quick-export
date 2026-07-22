/**
 * Pure page-world logic for reading the Aras web client (`top.aras`) and building the
 * quick-export request. Every function here takes its Aras/window/result objects as explicit
 * arguments (no direct globals), so it is unit-testable in Node with fakes — this is the
 * "browser-side injected code" under test.
 *
 * All calls mirror what was verified live against the 12.0 SP9 client:
 *   - aras.IomInnovator.applyAML(aml)      (per project directive; NOT aras.applyAML)
 *   - aras.getServerURL() / aras.getDatabase() / aras.OAuthClient.getAuthorizationHeader()
 *   - the open item = the visible frame's `thisItem`
 *   - PackageElement select 'source_id(source_id(name))' for the in-package check
 *
 * @typedef {Object} ConnContext
 * @property {string} url       base instance URL (…/12sp9), the service resolves the .aspx
 * @property {string} database
 * @property {string} token     e.g. "Bearer eyJ…"
 *
 * @typedef {Object} ItemIdentity
 * @property {string} itemType
 * @property {string} itemId
 * @property {string} configId
 * @property {string} keyedName
 */

/** Strip the …/Server/InnovatorServer.aspx suffix to get the base URL the service expects. */
export function deriveBaseUrl(serverUrl) {
  return String(serverUrl || '')
    .replace(/\/Server\/InnovatorServer\.aspx.*$/i, '')
    .replace(/\/+$/, '')
}

/**
 * Read the connection context the extension lends the service (token forwarding).
 * @param {any} aras  the top.aras object
 * @returns {ConnContext}
 */
export function getConnContext(aras) {
  if (!aras) throw new Error('aras object not available (is the Aras client loaded?)')
  const url = deriveBaseUrl(typeof aras.getServerURL === 'function' ? aras.getServerURL() : '')
  const database = typeof aras.getDatabase === 'function' ? aras.getDatabase() : ''
  let token = ''
  try {
    const h = aras.OAuthClient && aras.OAuthClient.getAuthorizationHeader()
    token = (h && h.Authorization) || ''
  } catch {
    /* fall through to the empty-token error below */
  }
  if (!url) throw new Error('could not resolve server URL from aras.getServerURL()')
  if (!database) throw new Error('could not resolve database from aras.getDatabase()')
  if (!token) throw new Error('could not resolve auth token (not logged in?)')
  return { url, database, token }
}

/** True if a frame window is an Aras item view (exposes a usable `thisItem`). */
export function isItemFrame(w) {
  try {
    return !!(w && w.thisItem && typeof w.thisItem.getID === 'function')
  } catch {
    return false
  }
}

/** Collect every item-view frame under `win` (depth-first, robust to cross-origin throws). */
export function collectItemFrames(win) {
  const found = []
  const seen = new Set()
  function scan(w) {
    if (!w || seen.has(w)) return
    seen.add(w)
    if (isItemFrame(w)) found.push(w)
    let n = 0
    try {
      n = w.frames ? w.frames.length : 0
    } catch {
      n = 0
    }
    for (let i = 0; i < n; i++) {
      try {
        scan(w.frames[i])
      } catch {
        /* cross-origin / detached — skip */
      }
    }
  }
  scan(win)
  return found
}

/** Whether an item frame is the visible (active-tab) one. Inactive tabs are display:none. */
export function isFrameVisible(w) {
  try {
    const fe = w.frameElement
    if (!fe) return true // a top-level item window with no frame element counts as visible
    if (fe.offsetParent === null) return false
    const view = fe.ownerDocument && fe.ownerDocument.defaultView
    const cs = view && view.getComputedStyle ? view.getComputedStyle(fe) : null
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false
    const r = typeof fe.getBoundingClientRect === 'function' ? fe.getBoundingClientRect() : { width: 1, height: 1 }
    return r.width > 0 && r.height > 0
  } catch {
    return false
  }
}

/**
 * Resolve the currently active item frame: the single visible item view. Returns null when
 * no item is open. When multiple are visible (unusual), returns the first.
 * @param {any} win  top window
 * @param {(w:any)=>boolean} [visiblePredicate]
 */
export function resolveCurrentItemFrame(win, visiblePredicate = isFrameVisible) {
  const frames = collectItemFrames(win)
  if (frames.length === 0) return null
  const visible = frames.filter(visiblePredicate)
  if (visible.length >= 1) return visible[0]
  return frames.length === 1 ? frames[0] : null
}

/** Read the item identity from an item frame's `thisItem`. @returns {ItemIdentity} */
export function readItemFromFrame(frameWin) {
  const it = frameWin && frameWin.thisItem
  if (!it || typeof it.getID !== 'function') throw new Error('no open item found')
  const itemId = it.getID()
  const itemType = it.getType()
  const getP = (n) => (typeof it.getProperty === 'function' ? it.getProperty(n, '') || '' : '')
  const configId = getP('config_id') || itemId
  const keyedName = getP('keyed_name') || getP('name') || itemId
  return { itemType, itemId, configId, keyedName }
}

/** AML for the in-package check: PackageElement by element_id, nested to the PackageDefinition name. */
export function buildInPackageQuery(configId) {
  return (
    "<AML><Item type='PackageElement' action='get' select='source_id(source_id(name))'>" +
    '<element_id>' +
    String(configId) +
    '</element_id></Item></AML>'
  )
}

/** True when an applyAML result is the benign "no items found" (not a real error). */
export function isNoItemsError(res) {
  try {
    if (!res || typeof res.isError !== 'function' || !res.isError()) return false
    const s = (typeof res.getErrorString === 'function' ? res.getErrorString() : '') || ''
    return /no items of type/i.test(s)
  } catch {
    return false
  }
}

/**
 * Parse the in-package query result into { inPackage, packageName }.
 * @returns {{ inPackage: boolean, packageName?: string }}
 */
export function parseInPackageResult(res) {
  if (!res) return { inPackage: false }
  if (typeof res.isError === 'function' && res.isError()) {
    if (isNoItemsError(res)) return { inPackage: false }
    const msg = (typeof res.getErrorString === 'function' ? res.getErrorString() : '') || 'query failed'
    throw new Error('in-package query error: ' + msg)
  }
  const count = typeof res.getItemCount === 'function' ? res.getItemCount() : 0
  if (!count) return { inPackage: false }
  const pe = res.getItemByIndex(0)
  let packageName = ''
  try {
    const grp = pe.getPropertyItem('source_id')
    const pkg = grp && grp.getPropertyItem('source_id')
    packageName = (pkg && pkg.getProperty('name')) || ''
  } catch {
    /* leave packageName empty; caller treats missing name as an error */
  }
  return { inPackage: true, packageName }
}

/** Build the ExportRequest body posted to the local service. */
export function buildExportRequest(reqId, conn, item, packageName) {
  return {
    reqId,
    conn,
    item: { itemType: item.itemType, itemId: item.itemId, keyedName: item.keyedName, package: packageName },
    options: { exportReferenced: true }
  }
}
