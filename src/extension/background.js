/**
 * MV3 service worker. The only component allowed to reach the loopback host service
 * (extensions bypass CORS for hosts in host_permissions). Relays export requests from the
 * content script and returns the ExportResult.
 */
const DEFAULT_PORT = 8737

async function servicePort() {
  try {
    const s = await chrome.storage?.local?.get?.('port')
    const p = Number(s?.port)
    return Number.isFinite(p) && p > 0 ? p : DEFAULT_PORT
  } catch {
    return DEFAULT_PORT
  }
}

async function postExport(body) {
  const port = await servicePort()
  const res = await fetch(`http://127.0.0.1:${port}/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-quick-export': '1' },
    body: JSON.stringify(body)
  })
  return res.json()
}

async function health() {
  const port = await servicePort()
  const res = await fetch(`http://127.0.0.1:${port}/health`)
  return res.json()
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return
  if (msg.type === 'qe:export') {
    postExport(msg.body)
      .then(sendResponse)
      .catch((e) =>
        sendResponse({
          reqId: msg.body?.reqId,
          ok: false,
          code: 'SERVICE',
          error:
            `Could not reach the quick-export service (${e.message}). ` +
            `Start it with "npm run service" and keep it running.`
        })
      )
    return true // async response
  }
  if (msg.type === 'qe:health') {
    health()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
    return true
  }
  return undefined
})
