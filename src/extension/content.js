/**
 * Content script (isolated world), injected on every http/https page. It:
 *   1. activates only on an Aras web client (path contains /Client) and only once it confirms
 *      the page really exposes `top.aras` — so it stays invisible everywhere else,
 *   2. injects injected.js into the page (MAIN world) and talks to it via window.postMessage,
 *   3. renders the Quick Export button + result panel (shadow root, CSS-isolated),
 *   4. relays the export to the background service worker, which calls the local service.
 *
 * Works on ANY Aras 12+ instance (any host) — nothing is hardcoded to a specific server.
 */
;(function () {
  if (window.__quickExportLoaded) return

  // Cheap gate: the Aras web client is always served under `.../Client/`. Everything else is
  // ignored so the button never appears on non-Aras pages. `__quickExportForce` is a test hook.
  const looksLikeAras = /\/Client(\/|$)/i.test(location.pathname) || window.__quickExportForce === true
  if (!looksLikeAras) return

  window.__quickExportLoaded = true

  // --- Inject the page-world bridge ---
  const s = document.createElement('script')
  s.type = 'module'
  s.src = chrome.runtime.getURL('injected.js')
  s.onload = () => s.remove()
  ;(document.head || document.documentElement).appendChild(s)

  // --- Page bridge (content <-> injected via postMessage) ---
  const pending = new Map()
  let seq = 0
  window.addEventListener('message', (ev) => {
    const d = ev.data
    if (!d || d.__qe !== 'res') return
    const p = pending.get(d.id)
    if (!p) return
    pending.delete(d.id)
    d.ok ? p.resolve(d.result) : p.reject(new Error(d.error || 'unknown page error'))
  })
  function callInjected(action, payload, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = 'c' + ++seq
      pending.set(id, { resolve, reject })
      window.postMessage({ __qe: 'req', id, action, payload }, '*')
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error('page bridge timed out (is the Aras client fully loaded?)'))
        }
      }, timeoutMs)
    })
  }

  // Poll the page for `top.aras` (it loads asynchronously). Mount the UI once confirmed; give
  // up quietly on pages that turn out not to be an Aras client.
  async function waitForAras() {
    for (let i = 0; i < 25; i++) {
      try {
        const r = await callInjected('hasAras', undefined, 1200)
        if (r && r.hasAras) return true
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    return false
  }

  waitForAras().then((ok) => {
    if (ok) mountUI()
  })

  // --- UI (shadow DOM), mounted only after Aras is confirmed ---
  function mountUI() {
    const host = document.createElement('div')
    host.id = 'quick-export-host'
    document.documentElement.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `
    <style>
      :host { all: initial; }
      .btn {
        position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
        width: 46px; height: 46px; border-radius: 50%; border: none; cursor: pointer;
        background: #2a55e5; color: #fff; font: 600 18px/1 system-ui, sans-serif;
        box-shadow: 0 3px 10px rgba(0,0,0,.3);
      }
      .btn:hover { background: #1e42c4; }
      .panel {
        position: fixed; right: 18px; bottom: 74px; z-index: 2147483000;
        width: 460px; max-width: 92vw; max-height: 74vh; display: none; flex-direction: column;
        background: #fff; color: #1a1a1a; border: 1px solid #cbd2e0; border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,.28); font: 13px/1.45 system-ui, sans-serif; overflow: hidden;
      }
      .panel.open { display: flex; }
      header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f4f6fb; border-bottom: 1px solid #e2e7f0; }
      header .title { font-weight: 700; flex: 1; }
      header .x { cursor: pointer; border: none; background: none; font-size: 16px; color: #667; }
      .body { padding: 12px; overflow: auto; }
      .meta { color: #556; margin-bottom: 8px; word-break: break-all; }
      .meta b { color: #223; }
      .status { margin-bottom: 8px; }
      .status.err { color: #b00020; white-space: pre-wrap; }
      textarea { width: 100%; height: 240px; box-sizing: border-box; font: 12px/1.4 ui-monospace, Consolas, monospace;
        border: 1px solid #cbd2e0; border-radius: 6px; padding: 8px; resize: vertical; background: #fbfcfe; }
      .actions { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #e2e7f0; flex-wrap: wrap; }
      button.act { border: 1px solid #cbd2e0; background: #fff; border-radius: 6px; padding: 6px 12px; cursor: pointer; font: 13px system-ui; }
      button.act.primary { background: #2a55e5; color: #fff; border-color: #2a55e5; }
      button.act:disabled { opacity: .5; cursor: default; }
      .spacer { flex: 1; }
    </style>
    <button class="btn" title="Quick Export the open item">⤓</button>
    <section class="panel">
      <header><span class="title">Quick Export</span><button class="x" title="Close">✕</button></header>
      <div class="body">
        <div class="meta"></div>
        <div class="status"></div>
        <textarea spellcheck="false" readonly hidden></textarea>
      </div>
      <div class="actions">
        <button class="act addpkg" hidden>Add to a package…</button>
        <div class="spacer"></div>
        <button class="act copy" hidden>Copy</button>
        <button class="act primary download" hidden>Download .xml</button>
      </div>
    </section>`

    const $ = (sel) => root.querySelector(sel)
    const panel = $('.panel')
    const metaEl = $('.meta')
    const statusEl = $('.status')
    const ta = $('textarea')
    const addBtn = $('.addpkg')
    const copyBtn = $('.copy')
    const dlBtn = $('.download')
    let current = null // { filename, xml }
    // Each click starts a new run; a slower, superseded run (e.g. the user switched items and
    // clicked again mid-export) must not overwrite the panel with its stale item.
    let runSeq = 0

    const openPanel = () => panel.classList.add('open')
    const closePanel = () => panel.classList.remove('open')
    function setStatus(msg, isErr) {
      statusEl.textContent = msg
      statusEl.className = 'status' + (isErr ? ' err' : '')
    }
    function resetView() {
      metaEl.innerHTML = ''
      ta.hidden = true
      ta.value = ''
      addBtn.hidden = true
      copyBtn.hidden = true
      dlBtn.hidden = true
      current = null
    }
    function showItemMeta(item, pkg) {
      metaEl.innerHTML =
        `<b>${escapeHtml(item.keyedName)}</b> · ${escapeHtml(item.itemType)}` +
        (pkg ? ` · <span title="package">${escapeHtml(pkg)}</span>` : '')
    }
    function showXml(filename, xml, pkg, item) {
      showItemMeta(item, pkg)
      setStatus(`Exported ${filename}`)
      ta.hidden = false
      ta.value = xml
      copyBtn.hidden = false
      dlBtn.hidden = false
      current = { filename, xml }
    }

    async function run() {
      const seq = ++runSeq
      const stale = () => seq !== runSeq
      openPanel()
      resetView()
      setStatus('Reading the open item…')
      let ctx
      try {
        ctx = await callInjected('getContext')
      } catch (e) {
        if (!stale()) setStatus(e.message, true)
        return
      }
      if (stale()) return
      if (!ctx.inPackage) {
        showItemMeta(ctx.item, '')
        setStatus('This item is not in any package, so it cannot be exported. Add it to a package first, then export again.')
        addBtn.hidden = false
        addBtn.onclick = async () => {
          try {
            await callInjected('addToPackage', ctx.item)
            setStatus("Opened Aras's Add-to-Package dialog. After you finish, click Export again.")
            addBtn.hidden = true
          } catch (e) {
            setStatus(e.message, true)
          }
        }
        return
      }
      setStatus(`Exporting ${ctx.item.keyedName}…`)
      let result
      try {
        result = await chrome.runtime.sendMessage({ type: 'qe:export', body: ctx.request })
      } catch (e) {
        if (!stale()) setStatus('Extension messaging error: ' + e.message, true)
        return
      }
      if (stale()) return
      if (!result || !result.ok) {
        setStatus((result && result.error) || 'Export failed.', true)
        showItemMeta(ctx.item, ctx.packageName)
        return
      }
      showXml(result.filename, result.xml, ctx.packageName, ctx.item)
    }

    copyBtn.onclick = async () => {
      if (!current) return
      try {
        await navigator.clipboard.writeText(current.xml)
        const t = copyBtn.textContent
        copyBtn.textContent = 'Copied ✓'
        setTimeout(() => (copyBtn.textContent = t), 1200)
      } catch {
        ta.focus()
        ta.select()
      }
    }
    dlBtn.onclick = () => {
      if (!current) return
      // Blob from the string preserves the UTF-8 BOM (leading U+FEFF) and CRLFs — byte-fidelity.
      const blob = new Blob([current.xml], { type: 'application/xml' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = current.filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    }
    $('.btn').onclick = run
    $('.x').onclick = closePanel
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  }
})()
