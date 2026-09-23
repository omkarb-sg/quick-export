/**
 * Pure page-world logic for reading the Aras web client (`top.aras`) and building the
 * quick-export request. Every function here takes its Aras/window/result objects as explicit
 * arguments (no direct globals), so it is unit-testable in Node with fakes — this is the
 * "browser-side injected code" under test.
 *
 * All calls mirror what was verified live against the 12.0 SP9 client:
 *   - aras.IomInnovator.applyAML(aml)      (per project directive; NOT aras.applyAML)
 *   - aras.getServerURL() / aras.getDatabase() / aras.OAuthClient.getAuthorizationHeader()
 *   - the open item = the ACTIVE tab (`top.arasTabs.selectedTab`) — inactive tabs stay laid
 *     out (opacity 0, z-index -1), so visibility alone cannot tell them apart
 *   - an item frame exposes `thisItem` (cuiTabItemView) or, for the Form / Life Cycle Map /
 *     Workflow Map editors (formView / lifecycleView / workflowView), only the `item` node
 *   - PackageElement select 'name,element_type,source_id(source_id(name))' for the in-package
 *     check; the element's `name` is the file name a native export writes
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

/** The frame's IOM `thisItem`, or null. */
function frameThisItem(w) {
  const it = w && w.thisItem
  return it && typeof it.getID === 'function' ? it : null
}

/**
 * The frame's item node (an AML `<Item type id>` DOM element), or null. The Form, Life Cycle
 * Map and Workflow Map editors expose only this — they have no `thisItem`.
 */
function frameItemNode(w) {
  const n = w && w.item
  if (!n || n.nodeType !== 1 || typeof n.getAttribute !== 'function') return null
  return n.getAttribute('type') && n.getAttribute('id') ? n : null
}

/** True if a frame window is an Aras item view (exposes `thisItem` or an item node). */
export function isItemFrame(w) {
  try {
    return !!(frameThisItem(w) || frameItemNode(w))
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

/**
 * Whether an item frame is visible. Fallback only — the 12.x tab strip keeps inactive tabs
 * laid out and merely transparent (opacity 0), so prefer resolveCurrentItemFrame's tab lookup.
 */
export function isFrameVisible(w) {
  try {
    const fe = w.frameElement
    if (!fe) return true // a top-level item window with no frame element counts as visible
    if (fe.offsetParent === null) return false
    const view = fe.ownerDocument && fe.ownerDocument.defaultView
    const cs = view && view.getComputedStyle ? view.getComputedStyle(fe) : null
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)) return false
    const r = typeof fe.getBoundingClientRect === 'function' ? fe.getBoundingClientRect() : { width: 1, height: 1 }
    return r.width > 0 && r.height > 0
  } catch {
    return false
  }
}

/**
 * The window of the client's active tab, per `win.arasTabs.selectedTab` (the tab's frame id).
 * Returns undefined when the client has no tab strip (e.g. a torn-off item window), and null
 * when it has one but no tab frame is selected.
 */
export function selectedTabWindow(win) {
  let tabs
  try {
    tabs = win && win.arasTabs
  } catch {
    return undefined
  }
  if (!tabs || !('selectedTab' in tabs)) return undefined
  const id = tabs.selectedTab
  if (!id) return null
  try {
    const fe = win.document && win.document.getElementById(id)
    if (fe && fe.contentWindow) return fe.contentWindow
  } catch {
    /* fall through to the named-frame lookup */
  }
  try {
    return (win.frames && win.frames[id]) || null
  } catch {
    return null
  }
}

/**
 * Resolve the currently open item frame. With a tab strip, that is the ACTIVE tab — or null
 * when the active tab is not an item (a search grid, a home page…); never a background tab.
 * Without one, it is the single visible item view (first of several). Null when none is open.
 * @param {any} win  top window
 * @param {(w:any)=>boolean} [visiblePredicate]
 */
export function resolveCurrentItemFrame(win, visiblePredicate = isFrameVisible) {
  const tab = selectedTabWindow(win)
  if (tab !== undefined) return tab && isItemFrame(tab) ? tab : null

  const frames = collectItemFrames(win)
  if (frames.length === 0) return null
  const visible = frames.filter(visiblePredicate)
  if (visible.length >= 1) return visible[0]
  return frames.length === 1 ? frames[0] : null
}

/** Text of an item node's direct child property element (e.g. <keyed_name>), or ''. */
function nodeProperty(node, name) {
  const kids = node.childNodes || []
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]
    if (k && k.nodeType === 1 && k.nodeName === name) return k.textContent || ''
  }
  return ''
}

/**
 * Read the item identity from an item frame: its `thisItem`, or else its item node (the Form /
 * Life Cycle Map / Workflow Map editors). @returns {ItemIdentity}
 */
export function readItemFromFrame(frameWin) {
  const it = frameThisItem(frameWin)
  let itemId, itemType, getP
  if (it) {
    itemId = it.getID()
    itemType = it.getType()
    getP = (n) => (typeof it.getProperty === 'function' ? it.getProperty(n, '') || '' : '')
  } else {
    const node = frameItemNode(frameWin)
    if (!node) throw new Error('no open item found')
    itemId = node.getAttribute('id')
    itemType = node.getAttribute('type')
    getP = (n) => nodeProperty(node, n)
  }
  const configId = getP('config_id') || itemId
  const keyedName = getP('keyed_name') || getP('name') || itemId
  return { itemType, itemId, configId, keyedName }
}

/**
 * AML for the in-package check: PackageElement by element_id, with the element's own name and
 * type (what a native export files it under) and the owning PackageDefinition name.
 */
export function buildInPackageQuery(configId) {
  return (
    "<AML><Item type='PackageElement' action='get' select='name,element_type,source_id(source_id(name))'>" +
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
 * Parse the in-package query result. `elementName` / `elementType` are the PackageElement's
 * own name and type — a native export names the item's file after `elementName`, which can
 * differ from the item's current keyed_name (e.g. the item was renamed after packaging).
 * @returns {{ inPackage: boolean, packageName?: string, elementName?: string, elementType?: string }}
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
  const getP = (n) => {
    try {
      return pe.getProperty(n, '') || ''
    } catch {
      return ''
    }
  }
  return { inPackage: true, packageName, elementName: getP('name'), elementType: getP('element_type') }
}

/**
 * Resolve the package element that exports the open item. `target` is what the export engine
 * is asked for: the element's type and name (the native file name), falling back to the item's.
 * @param {(aml: string) => any} applyAML  e.g. aml => aras.IomInnovator.applyAML(aml)
 * @param {ItemIdentity} item
 * @returns {{ inPackage: boolean, packageName: string,
 *   target?: { itemType: string, itemId: string, keyedName: string } }}
 */
export function resolvePackaging(applyAML, item) {
  const pkg = parseInPackageResult(applyAML(buildInPackageQuery(item.configId)))
  if (!pkg.inPackage) return { inPackage: false, packageName: '' }
  return {
    inPackage: true,
    packageName: pkg.packageName || '',
    target: {
      itemType: pkg.elementType || item.itemType,
      itemId: item.itemId,
      keyedName: pkg.elementName || item.keyedName
    }
  }
}

/** Build the ExportRequest body posted to the local service (`item` = resolvePackaging's target). */
export function buildExportRequest(reqId, conn, item, packageName) {
  return {
    reqId,
    conn,
    item: { itemType: item.itemType, itemId: item.itemId, keyedName: item.keyedName, package: packageName },
    options: { exportReferenced: true }
  }
}
