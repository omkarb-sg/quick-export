# quick-export

Export the **currently open Aras item** to **native-identical XML** — one click, from the Aras
web client, on **any Aras 12+ instance you're logged into**, with **no instance-specific
deployment**. A developer tool: like a browser devtool for grabbing an item's package XML.

- **Native-identical.** The XML is produced by Aras's own `Libs.dll` export engine, so it is
  byte-for-byte what a native package export writes (property order, `action="add"`,
  `keyed_name`, CDATA, UTF-8 BOM). Verified byte-identical against a native export.
- **Zero deployment.** Nothing is installed into the target Innovator. The tool rides your
  existing logged-in session (OAuth token forwarding).
- **Stateless & instance-agnostic.** One local service serves every Aras you touch; it stores
  nothing between requests and never sees your password.

See [docs/FUNCTIONAL-SPEC.md](docs/FUNCTIONAL-SPEC.md) for the full functional spec and design
decisions (D-01 … D-05).

---

## How it works

```
Aras web client (browser)                 Local host service (127.0.0.1)
┌───────────────────────────┐             ┌──────────────────────────────────────┐
│ extension                 │  POST        │ POST /export                         │
│  • reads open item        │  /export     │   ├─ spawn ONE PowerShell child      │
│  • reads session token    │─────────────►│   │   (per export → instance-isolated)│
│    (aras.OAuthClient)     │  {url,db,    │   ├─ export.ps1: IOM.dll+Libs.dll    │
│  • in-package check       │   token,     │   │   RawTokenProvider(token) →       │
│  • panel: view/copy/dl    │◄─────────────│   │   ExportSolutions → temp folder   │
└───────────────────────────┘  {filename,  │   └─ read back the item's .xml       │
                                xml}        └──────────────────────────────────────┘
                                                        │ direct AML, bearer token
                                                        ▼
                                              Aras server (InnovatorServer.aspx)
```

1. The **extension** reads the open item (`type`, `id`, `config_id`, `keyed_name`) from
   `top.aras`, checks it belongs to a package, and grabs the session's OAuth bearer token.
2. It POSTs an export request (with the token) to the **local service**.
3. The service spawns a fresh **PowerShell host child** that loads Aras's `IOM.dll` + `Libs.dll`,
   connects **directly** using the forwarded token (`ITokenProvider`), runs
   `ImportExportManager.ExportSolutions`, and reads back the single item's `.xml`.
4. The extension shows the XML — **view / copy / download** (filename = the export's own name).

If the item is **not in a package**, the tool doesn't export — it offers Aras's native
"Add to Package Definition" instead (decision D-01).

---

## Requirements

- **Windows** — the Aras export engine is a .NET Framework DLL run via Windows PowerShell 5.1.
- **Node.js 20+** and **npm** (developed on Node 24).
- An **Aras Innovator 12+** instance you can log into.
- Bundled `native/IOM.dll` + `native/Libs.dll` (copied from a 12+ install; Libs v14 works
  against 12.x — see *Version parity* below).

## Install & run the service

```bash
npm install
npm run service          # listens on http://127.0.0.1:8737
```

Keep it running while you use the extension. Change the port with `QUICK_EXPORT_PORT=…`.

## Load the extension

1. Chrome/Edge → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select `src/extension/`.
3. The content script targets `http://localhost/*` by default. For a different host, add your
   instance to `matches`, `web_accessible_resources[].matches`, and `host_permissions` in
   `src/extension/manifest.json`, then reload.

## Use it

1. Log into the Aras client and open an item.
2. Click the round **⤓** button (bottom-right).
3. The panel shows the item's native-identical XML → **Copy** or **Download .xml**.
   - Unpackaged item → the panel offers **Add to a package…** instead.

---

## Testing

Three layers. Pure logic and browser-injected logic run anywhere; live-Aras and full-stack
tests are opt-in and configured via `config/test.env`.

```bash
npm test            # unit tests (pure core + service + extension logic) — 81 tests
npm run test:e2e    # Playwright: injected lib on real DOM + panel UI — 6 tests (+1 opt-in)
npm run test:live   # live-Aras integration: real export, byte-parity, isolation — needs config
npm run typecheck   # tsc --noEmit
```

### Configure live tests

```bash
cp config/test.env.example config/test.env   # gitignored (holds a password)
```

Edit `config/test.env` (defaults target the dev `12sp9` instance). Then:

```bash
npm run test:live   # spawns the real host child, mints a token, exports a real item,
                    # and asserts the output is byte-identical to the native golden export
```

`test:live` covers: token-forwarding export end-to-end, byte-parity vs
`tests/fixtures/CheckFavoriteOwner.golden.xml`, **multi-instance isolation** (two concurrent
exports don't interfere), a clean **AUTH** failure on a bad token, and the full HTTP path.

### Full-stack browser test (opt-in)

`tests/e2e/live-extension.live.spec.ts` loads the real extension into Chromium and drives the
real client. It self-skips unless enabled and needs an already-logged-in Chromium profile (the
tool never types passwords):

```bash
# 1) run the service in another terminal:  npm run service
# 2) run headed once, log into Aras by hand in the opened window — the profile persists:
QE_LIVE_E2E=1 QE_USER_DATA_DIR=.pw-profile npm run test:e2e
```

---

## Security

- The service binds **127.0.0.1 only**.
- CORS is granted **only to browser-extension origins**; a custom `x-quick-export` header is
  required (forces a preflight a plain web page can't satisfy).
- The OAuth token is used for one export and **never persisted or logged**; it travels to the
  host child via an environment variable, never the command line.
- Export is **read-only** against the instance. The only write path is native Add-to-Package,
  which runs in the browser via the client's own code.

## Version parity

`native/Libs.dll` is bundled (v14). Native export bytes are produced by whichever Libs version
runs, so output is "identical to Libs v14 output" — verified against 12.0 SP9. Exotic drift on
other 12.x builds is possible; the live parity test is how you measure it. Future option: select
a bundled Libs matching the instance version.

## Layout

```
native/            IOM.dll + Libs.dll (bundled Aras assemblies)
scripts/export.ps1 host child: token/password → ExportSolutions → native XML
src/core/          pure protocol/validation/grouping/output logic (TS)
src/service/       loopback HTTP service + process-per-export runner (TS)
src/aras/          OAuth token minter (test/CLI helper)
src/extension/     MV3 extension: manifest, background, content, injected, lib/aras-page.js
tests/             unit (core/service/extension), live (live-Aras), e2e (Playwright)
docs/              functional spec
```
