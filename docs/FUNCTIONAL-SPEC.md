# quick-export — Functional Specification

**Status:** v0.2 DRAFT · 2026-07-22
**Owner:** omkarb
**Reference project:** `aras-import-transaction` (the import counterpart; architectural template)
**Reference codetree:** `C:\Program Files (x86)\Aras12\Innovator`

> Working draft for collaborative review. **⟨DECIDE⟩** = open decision needing your input.
> **⚠ RISK** = technical unknown to validate. **✔ DECIDED** = settled (see Decisions log).

## Decisions log

| # | Decision | Choice |
|---|---|---|
| **D-01** | Unpackaged item behavior | **Block export; offer "add to package" only** (§6.2). |
| **D-02** | Connection design | **Token forwarding** — service connects directly with the session's OAuth token; **must not fail on consecutive/near-simultaneous exports to different instances** (§4.2, §11 NFR-7). |
| **D-03** | Libs.dll version | **Bundle v14** from the sibling; accept format drift for v1 (§10). |
| **D-04** | Export artifact | **Single `.xml` only** — surface the item's XML; discard the DLL's package folder (§1.2, §6.3). |
| **D-05** | Multi-instance isolation strategy | **One fresh host process per export** (OS-level isolation) — derived from D-02's constraint (§4.4). |

---

## 1. Purpose & vision

`quick-export` is a **developer tool** that lets an Aras developer grab the export XML of a
single item **directly from the Aras web client**, with one action, on **any Aras 12+
instance**, with **no instance-specific deployment** (no server-side method, no package installed
into the target Innovator).

It behaves like a browser devtool: point at the item you have open, click, and get the exact XML
that a native Aras package export would have produced for that item — displayed, copyable, and
downloadable.

### 1.1 Goals

- **G1 — Native-identical AML.** The XML for an item is byte-for-byte what native Aras export
  produces for it (property ordering, `action="add"`, retained `keyed_name`, CDATA-wrapped code,
  stripped runtime properties, UTF-8 BOM).
- **G2 — Zero instance deployment.** Works against any reachable Aras 12+ instance the developer
  is already logged into, without importing anything into that instance.
- **G3 — One item → one XML.** Each export produces a single item's XML, surfaced in the UI:
  displayed, copy-to-clipboard, download-as-`.xml`, filename = the export's own output filename.
- **G4 — Instance-agnostic, stateless service.** A single local service serves every Aras the
  developer touches. It stores nothing about any instance between requests; each request is
  self-contained (`{serverUrl, database, token, item}`).
- **G5 — Reuse the developer's existing session.** No re-login. The extension lends the tab's
  live OAuth token to the service for the duration of one export; nothing is persisted.

### 1.2 Non-goals (v1)

- Multi-item / bulk export in one action (single item is the unit). *(Batch may come later.)*
- Emitting the full package tree (`imports.mf` + folder) as an artifact. **D-04:** we surface the
  **single item's `.xml`** only; the package folder the DLL creates is an internal temp we read
  from and delete.
- Editing, diffing, or re-importing the exported XML.
- Any server-side Innovator customization.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Native export** | The XML the Aras "Package Import/Export Utilities" tool writes for an item, produced by `Libs.dll`. |
| **AML** | Aras Markup Language — `<AML><Item…>…</Item></AML>`. |
| **Libs.dll** | Aras assembly with the export engine (`Aras.Tools.SolutionUpgrade`). Bundled with the tool (v14). |
| **IOM.dll** | Aras Innovator Object Model — connection objects (`Innovator`, `HttpServerConnection`, `IomFactory`). |
| **Host service** | The stateless local backend on the developer's OS that runs the DLL export. |
| **Host child** | A short-lived process the service spawns to run one export in isolation (D-05). |
| **Extension** | Browser extension injected into the Aras web client: triggers export, lends the token, shows the result. |
| **`top.aras`** | The Aras web client's global, already-authenticated JS object. |
| **CallAction** | `HttpServerConnection.CallAction(action, inDom, outDom)` — the seam every server round-trip passes through. |
| **PackageElement** | Relationship row marking an item as belonging to a `PackageDefinition` (keyed by the item's `config_id`). |

---

## 3. Users & primary use cases

**User:** an Aras solution developer / implementer working in the Aras web client, comfortable
with AML and packages.

- **UC1 — Export the open item.** Item is open (or selected in a grid); trigger quick-export; see
  / copy / download that item's native export XML.
- **UC2 — Unpackaged item.** The item is not in any package ⇒ the tool offers "add to a package"
  instead of exporting (§6.2, D-01).
- **UC3 — Copy for a diff/PR.** Copy the XML into a package file, a diff, or a review — the reason
  native-identical output matters.
- **UC4 — Two instances at once.** Developer exports from instance A and instance B back-to-back
  (or near-simultaneously across two tabs); both succeed independently (D-02/D-05).

---

## 4. System architecture

Two OS parts (extension in the browser, service on the host) plus the bundled DLLs. With
**token forwarding (D-02)** the service talks to the Aras server **directly**, using the token the
extension lends it — no per-call round-trip back through the browser.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Aras web client (browser tab, logged in)                                     │
│                                                                               │
│   ┌───────────────────────┐                                                   │
│   │  Extension            │   reads from top.aras:                            │
│   │  - detect open item   │     • serverUrl (…/InnovatorServer.aspx)          │
│   │  - read session ctx   │     • database                                    │
│   │  - result UI          │     • OAuth bearer token                          │
│   └───────────┬───────────┘                                                   │
└───────────────┼───────────────────────────────────────────────────────────────┘
                │  loopback HTTP/WS ws://127.0.0.1:<port>
                │  ① export request { reqId, conn:{url,db,token}, item, options }
                │  ④ result        { reqId, ok, filename, xml }
┌───────────────┴───────────────────────────────────────────────────────────────┐
│  Host service (stateless dispatcher on 127.0.0.1)                             │
│        │ spawns ONE host child per export (D-05, isolation)                   │
│        ▼                                                                       │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │  Host child  (.NET Framework: PowerShell + Add-Type + CodeDom)         │   │
│   │                                                                        │   │
│   │   conn = IomFactory.CreateHttpServerConnection(url, db, <token>)  ─────┼──►  Aras server
│   │   CItemHelper ci = new CItemHelper(conn); ci.Login()             ◄─────┼───  (direct, with
│   │   new CExportItems(ci).Export(ExportItem(name,id,type),               │     bearer token)
│   │                               pkgName, level, excludedRefs)            │   │
│   │        └─ writes native <name>.xml into a temp Folder                  │   │
│   │   read back the .xml  →  return { filename, xml }                      │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│   bundled per child: IOM.dll, Libs.dll (v14, from aras-import-transaction)    │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Components

**C-A. Browser extension** (net-new; no equivalent in the import sibling)
- Detects the current item's identity (`id`, `type`, `config_id`, `keyed_name`) from the open
  item view / selected grid row.
- Extracts the **session connection context** from `top.aras`: server URL
  (`top.aras.getServerURL()`), database, and the OAuth bearer token
  (`top.aras.OAuthClient.getAuthorizationHeader()`).
- Renders the trigger (toolbar button / context menu) and the result panel (XML view, Copy,
  Download).
- Runs the "in a package?" check and the "add to package" action (§6.2).
- Talks to the host service over a loopback channel. **The extension does NOT proxy per-call
  AML** in the primary design — it only lends the connection context once per export.

**C-B. Host service** (stateless local dispatcher; reuses the sibling's spine)
- Long-running local process listening on `127.0.0.1:<port>`.
- Per export request, **spawns a fresh host child** (D-05) carrying only that request's
  `{url, db, token, item, options}`; collects `{filename, xml}` or an error; returns it; the
  child exits. Holds no instance state itself.

**C-C. Host child** (one per export — the isolation unit)
- The sibling's proven DLL-hosting mechanism: `powershell.exe` + `Add-Type -Path IOM.dll,Libs.dll`
  + `Add-Type -TypeDefinition` (CodeDom) to compile the small C# wrapper, then call a static entry
  point. **⟨DECIDE⟩ (D1)** keep PowerShell/CodeDom, or ship a compiled `.exe`.
- Builds a **direct** IOM connection from the forwarded token, runs the export, reads back the
  `.xml`, prints the result on the sibling's stdout line-contract, exits. Fresh process ⇒ no
  shared IOM/static state with any other export.

**C-D. Bundled assemblies:** `IOM.dll` + `Libs.dll` (v14) from `aras-import-transaction/native/`,
shared read-only by every child. See §10 for version-parity risk.

### 4.2 Connection design — token forwarding (D-02)

The export engine (`CExportItems` / `ImportExportManager`) must issue AML `get`s to fetch the item
and its business-logic-included children. Those go through a real IOM connection. With token
forwarding:

1. The extension reads `{serverUrl, database, bearerToken}` from the already-authenticated
   `top.aras` and sends them with the export request.
2. The host child builds a **direct** connection with that token — IOM exposes token-provider
   connection overloads (`IomFactory.CreateHttpServerConnection(url, db, …)` + token overload;
   confirmed present by reflection). No `RecordingConnection`/proxy subclass needed.
3. `CItemHelper(conn).Login()` then `CExportItems.Export(...)` run against the instance directly.

**Why not the session-proxy design.** An earlier draft (v0.1) had the service subclass
`HttpServerConnection.CallAction` and proxy every round-trip back through the browser. That is more
"stateless/secure" but adds a browser hop per server call and — critically — required proving that
`Login()` and all bootstrap traffic could be driven through a URL-less proxy connection (an
unproven, high-risk seam). Token forwarding has **fewer failure modes** (your stated preference),
so it is the primary design. The proxy design is retained only as a **fallback** if direct
token connections prove infeasible on some instance (§4.5).

**Token-forwarding risks (to handle):**
- **⚠ Token expiry mid-export.** A single-item export is seconds; the token is freshly read at
  request time, so risk is low. If the server returns 401, the host child fails cleanly and the
  extension re-reads a fresh token from `top.aras` and retries once (§6.4).
- **⚠ Header/cookie sufficiency.** The direct call authenticates with the bearer token; some
  deployments may also expect a `DATABASE` header or session cookie. IOM's connection builder
  forms the standard headers — we rely on IOM rather than hand-building. Validate against a real
  instance early (M1).
- **⚠ Reachability.** The service makes direct HTTP(S) to the instance URL. The dev machine can
  already reach it (the browser does), so normally fine; note for locked-down networks.
- **Security.** The token transits the loopback channel and lives in the host child's memory for
  the export only. It is **never persisted** (NFR, §9). Loopback is bound to `127.0.0.1` with an
  origin/nonce handshake (§9).

### 4.3 What the extension must extract from `top.aras`

| Needs | Source (Aras 12 client) |
|---|---|
| Server URL | `top.aras.getServerURL()` → `…/InnovatorServer.aspx` (`aras_object.js:378`) |
| Database | client session / `top.aras` database property |
| OAuth bearer token | `top.aras.OAuthClient.getAuthorizationHeader()` → `{ Authorization: "<type> <token>" }` (`OAuthClient.PasswordGrant.js:131`) |
| Item identity | open item view / selected grid row → `id`, `type`, `config_id`, `keyed_name` |

### 4.4 Multi-instance isolation (D-05) — satisfies D-02's constraint

**Requirement:** exporting from two different instances consecutively or near-simultaneously must
not fail or cross-contaminate.

**Design:** **one fresh host child process per export.** Each child receives only its own request's
connection context and runs in its own .NET AppDomain/process, so there is no shared `Innovator`
instance, static field, `HttpContext`, or connection pool that a second instance's export could
corrupt. This mirrors the sibling, which spawned one PowerShell child per run. The dispatcher
(C-B) itself keeps no connection state — it only routes `reqId`s.

- **⚠ RISK — IOM/Libs static state.** IOM/Libs may hold process-static or thread-static state
  (auth caches, singletons). Process-per-export removes this risk by construction. A future
  optimization (child pooling / AppDomain reuse) must **not** reuse a child across two different
  `{url, db}` targets.
- **Trade-off:** per-export process startup cost (Add-Type + CodeDom compile). Acceptable for a
  dev tool; can be mitigated later by caching the compiled assembly, keeping a warm pool keyed by
  target, or moving to a compiled host (D1).

### 4.5 Fallback: session-proxy design (only if D-02 fails)

If direct token connections cannot be made to work on a target instance, fall back to: service
subclasses `HttpServerConnection`, overrides `CallAction(action, inDom, outDom)`, and proxies each
AML over the loopback channel to the extension, which replays it via `top.aras.applyAML` (or a
direct XHR reusing the token/cookies) and returns the response into `outDom`. **We must subclass
`HttpServerConnection`, not implement `IServerConnection`** (IOM casts the connection to the
concrete type — proven by the sibling). Documented here as a contingency; not built for v1 unless
needed.

---

## 5. The export mechanism (DLL contract)

Confirmed by reflection on `Libs.dll` (v14, `Aras.Tools.SolutionUpgrade`) and by working
call-sites in `t255-aras-rabbit`.

### 5.1 The call

- **Item descriptor:** `new ExportItem(string strName, string idName, string typeName)` —
  (export filename / keyed-name, item id, ItemType name).
- **Single-item export (low-level):**
  `new CExportItems(ICItemHelper helper).Export(ExportItem item, string packageName, string level, Hashtable excludedRefs)` → `void`
  (equivalently `helper.PackageItem(item, packageName, level, excludedReferences)` → `void`).
- **Or high-level (rabbit's proven path):**
  `ImportExportManager.ExportSolutions(SUExportContext ctx, Hashtable selItemsTable)` → `void`,
  where `selItemsTable[packageName][itemId] = new ExportItem(name, id, type)` — a one-package,
  one-item Hashtable (rabbit's `BuildSingleItemExportTable(packageName, itemId, itemType, filename)`).
- **The helper:** `new CItemHelper(IServerConnection connection)`; `Login()` before export;
  `CItemHelper.Folder` = the temp output directory.
- **Recommendation:** start from rabbit's `BuildSingleItemExportTable` + `ExportSolutions` path
  (a single call-site proven end-to-end) or the lower-level `CExportItems.Export`; pick whichever
  yields the cleanest single-file output in M1.

### 5.2 The output

- Export methods **return `void`**; they **write files into `CItemHelper.Folder`** (a native
  package folder tree; per-item `.xml` under `<path>\<ItemType>\<name>.xml`). **No API returns the
  XML as a string.**
- Flow: export into a fresh temp folder → read back the single item `.xml` → return
  `{ filename, xml (raw bytes) }` → delete the temp folder (D-04: we keep only the one `.xml`).
- Native fidelity (G1) is intrinsic: byte-exact formatting comes from `CExportItems`' private
  transforms (`ReplaceIdWithConfigId`, `RemoveAutoGeneratedRelationships`,
  `RemoveSystemRelationshipsFromXTree`, `ProcessForm/RelationshipType/Sequence/XProperties`,
  `CdataFilterXml`, …). **This is why we call the DLL instead of re-serializing AML ourselves.**

### 5.3 Export options — ⟨DECIDE⟩ (defaults to confirm)

- `level` / `SUExportContext.sLevel`: rabbit uses `"1"`.
- `SUExportContext.bExportReferencedItems`: rabbit passes `true`. Per your Q3 answer, the DLL's own
  business logic decides file contents; we call with the **native default** and surface whatever it
  emits.
- `excludedRefs` / `RefToUnknownPacks`: rabbit uses `DoNotRemove`.
- **Confirm these three match native single-item export defaults during M1.**

---

## 6. Functional requirements

### 6.1 Export flow (UC1) — happy path

| ID | Requirement |
|---|---|
| **FR-1** | The extension SHALL expose a trigger on/near an open item and on a selected grid row. |
| **FR-2** | On trigger, the extension SHALL resolve the item's `id`, `type`, `config_id`, `keyed_name` from the client (no server round-trip where possible). |
| **FR-3** | The extension SHALL run the "in a package?" check (§6.2) and branch: packaged ⇒ export; unpackaged ⇒ add-to-package offer. |
| **FR-4** | For a packaged item, the extension SHALL extract `{serverUrl, database, bearerToken}` from `top.aras` and send them with the export request over the loopback channel. |
| **FR-5** | The host service SHALL spawn a fresh host child (D-05) that builds a direct IOM connection from the forwarded token and runs `Libs.dll`'s single-item export into a temp folder. |
| **FR-6** | The host child SHALL read back the item's `.xml` and return `{ filename, xml }`; the service SHALL relay it to the extension; the temp folder SHALL be deleted. |
| **FR-7** | The extension SHALL display the returned XML and offer **Copy** (clipboard) and **Download** (`.xml`, filename = the export's own filename). |
| **FR-8** | The flow SHALL require no login prompt and no manual entry of URL/DB/credentials. |
| **FR-9** | The service SHALL retain no instance data after returning the result; the host child SHALL exit after one export. |
| **FR-10** | Concurrent/consecutive exports targeting **different** instances SHALL each run in their own host child and SHALL NOT interfere (D-02/D-05). |

### 6.2 Unpackaged item flow (UC2) — D-01 (block + offer add)

**"In a package?" test (from client code):** the item is packaged iff a `PackageElement` exists
whose `element_id` equals the item's **`config_id`** (not its `id`). Optionally walk `source_id` →
`PackageGroup` → `PackageDefinition` to name the package(s).

| ID | Requirement |
|---|---|
| **FR-11** | If the item is **not** packaged, the tool SHALL NOT export. It SHALL offer a quick "Add to package" action. |
| **FR-12** | "Add to package" SHALL reuse the client's existing `Aras.prototype.addItemToPackageDef(ids, itemTypeName)` (`item_methods.js:309`) and the package-picker dialog (`selectPackageDefinition.js`), so behavior matches native Add-to-Package exactly. |
| **FR-13** | After a successful add, the tool SHALL re-run the "in a package?" check. **⟨DECIDE⟩** then auto-export, or just confirm the add and stop. *(Draft: confirm + re-offer export button, no auto-export.)* |

*(Note: the DLL could export an unpackaged item under a synthetic package name; D-01 is a
deliberate product choice to block that path and steer the developer to package first.)*

### 6.3 Result handling (D-04: single `.xml`)

| ID | Requirement |
|---|---|
| **FR-14** | The tool SHALL surface only the single item's `.xml`. The package folder the DLL emits SHALL be treated as internal temp and deleted. |
| **FR-15** | The XML SHALL preserve exact bytes (incl. UTF-8 BOM, line endings). **⚠ RISK:** clipboard/textarea round-trips can strip the BOM and normalize newlines — **Download MUST write the raw bytes** the child returned, not a re-encoded DOM string. |
| **FR-16** | Download filename SHALL equal the `.xml` filename the engine produced (e.g. `CheckFavoriteOwner.xml`). |
| **FR-17** | Copy SHALL place the raw XML text on the clipboard. **⟨DECIDE⟩** include the BOM in the copied text or not. |

### 6.4 Errors & edges

| ID | Requirement |
|---|---|
| **FR-18** | On a `401`/expired token, the host child SHALL fail cleanly; the extension SHALL re-read a fresh token from `top.aras` and retry once, then surface a clear "session expired" error. |
| **FR-19** | A server fault during export SHALL surface with the fault text; distinguish "no items found" from real faults (mirror the sibling's fault parsing). |
| **FR-20** | If the host service is not running/reachable, the extension SHALL show an actionable "start the quick-export service" message. |
| **FR-21** | Export SHALL be read-only against the instance (only AML reads). The host child MUST NOT issue writes. |

---

## 7. Interfaces & contracts

### 7.1 Extension ⇄ Host service (loopback)

Transport: `127.0.0.1:<port>` (WebSocket or HTTP long-poll). Handshake returns service
version/capabilities. **⟨DECIDE⟩** fixed port vs. discovery; origin allow-list + handshake nonce
(§9).

```jsonc
// ① extension → service : start an export
{ "kind":"export", "reqId":"…",
  "conn":{ "url":"https://host/InnovatorServer.aspx", "database":"InnovatorSolutions",
           "authorization":"Bearer eyJ…" },
  "item":{ "id":"…", "type":"Method", "configId":"…", "name":"CheckFavoriteOwner" },
  "options":{ "level":"1", "exportReferenced":true } }

// ④ service → extension : final result
{ "kind":"result", "reqId":"…", "ok":true, "filename":"CheckFavoriteOwner.xml", "xml":"<AML>…" }
// failure: { "kind":"result", "reqId":"…", "ok":false, "error":"…", "code":"AUTH|FAULT|SERVICE|…", "log":"…" }
```

| ID | Requirement |
|---|---|
| **IF-1** | Each request SHALL be self-contained (`reqId` + full `conn` + `item`); the service SHALL NOT reuse a prior request's connection context. |
| **IF-2** | The service SHALL route each `reqId` to its own host child and never share a child across two `{url,db}` targets (D-05). |
| **IF-3** | The channel SHALL support concurrent exports from multiple tabs/instances without cross-talk (`reqId` scoping). |
| **IF-4** | The service SHALL enforce a per-export timeout and return a clean error if the child hangs or the token is rejected. |

*(No `soap-request`/`soap-response` proxy messages in the primary design — those exist only in the
§4.5 fallback.)*

### 7.2 Host child ⇄ DLL (in-process .NET)

| ID | Requirement |
|---|---|
| **IF-5** | The child SHALL build a direct IOM connection from `{url, db, authorization}` (token overload), call `CItemHelper.Login()`, run the single-item export into a temp `Folder`, read the emitted `.xml`, and emit `{ filename, xml }` on the sibling's stdout line-contract. |
| **IF-6** | The child SHALL pass the token to IOM without logging it; the token SHALL NOT appear in any log or transcript. |
| **IF-7** | The child SHALL clean up its temp `Folder` on success and failure, and exit after one export. |

---

## 8. Native-parity requirements

| ID | Requirement |
|---|---|
| **NP-1** | Output SHALL be produced solely by `Libs.dll`; the tool SHALL NOT hand-serialize AML. |
| **NP-2** | The tool SHALL preserve the engine's bytes exactly: property order, `action="add"`, `keyed_name`/`type` attrs on foreign props, CDATA code blocks, UTF-8 BOM, line endings. |
| **NP-3** | A test SHALL compare tool output vs. a real native export of the same item (same instance, same Libs version) and assert byte-equality. **⚠ RISK:** parity holds only when bundled Libs matches the instance's export engine version (§10). |

---

## 9. Authentication, session & security

- The tool performs **no authentication of its own**; it relies on the tab being logged in (Aras
  12 = OAuth Bearer; WinAuth/SSO variants ultimately yield a usable token/session).
- **Token forwarding (D-02):** the extension lends the tab's current bearer token (+ url + db) to
  the service per export. The host child uses it for that one export and exits.
- **No persistence:** neither the service nor any child writes the token, url, or db to disk. The
  token lives in loopback traffic and child memory for the export only (IF-6).
- **Loopback hardening (IF-8):** the service SHALL bind to `127.0.0.1` only and SHOULD validate
  the connecting origin and require a handshake nonce, so arbitrary local pages cannot drive
  exports or harvest tokens. **⟨DECIDE⟩** exact scheme (origin allow-list of Aras hosts + per-
  session nonce is the working proposal).
- **⚠ RISK — token exposure surface.** Token forwarding necessarily lets the service see the
  token (the trade for "fewer failure modes"). Mitigate with loopback-only binding, no logging,
  short child lifetime, and no persistence.

---

## 10. Aras version support

- **Target:** Aras **12+**.
- **v1 (D-03):** bundle `IOM.dll` + `Libs.dll` (v14) from `aras-import-transaction/native`.
- **⚠ RISK — export-format drift.** Native export bytes are produced by whichever Libs version
  runs; a bundled v14 engine may differ subtly from a 12.x instance's own engine, which could
  break G1/NP-3 against those instances. For v1 we document parity as "matches Libs v14 output"
  and measure real drift against a 12 SP* instance (M5). Later options: detect instance version and
  select a matching bundled Libs.

---

## 11. Non-functional requirements

| ID | Requirement |
|---|---|
| **NFR-1 — Statelessness** | The service holds no per-instance state across requests; restart-safe; serves any instance. |
| **NFR-2 — Performance** | A single-item export SHALL feel interactive. Token forwarding avoids per-call browser hops; the main cost is host-child startup (Add-Type + CodeDom) — measure; mitigate with compiled-assembly caching / warm pool if needed (D-05 trade-off). |
| **NFR-3 — Portability** | Runs on the developer's Windows OS (matches Aras/.NET Framework). **⟨DECIDE⟩** non-Windows out of scope. |
| **NFR-4 — Observability** | Per-export log (engine log + line-contract transcript), reusing the sibling's JSONL/stdout patterns — **excluding the token** (IF-6). |
| **NFR-5 — Isolation (temp)** | Each export uses a fresh temp folder, cleaned up on completion/failure. |
| **NFR-6 — No side effects** | Export is read-only against the instance. Add-to-package (§6.2) writes, but via native client code in the browser, not the service. |
| **NFR-7 — Multi-instance isolation** | Consecutive/near-simultaneous exports to different instances SHALL be fully isolated (process-per-export, D-05); no shared connection/static state; no cross-instance failure. **This is the load-bearing constraint behind D-02.** |

---

## 12. Build / hosting decisions — ⟨DECIDE⟩

- **D1 — Host-child runtime.** Reuse the sibling's **PowerShell + `Add-Type` + CodeDom** in-process
  host (proven, fast to stand up), or ship a **compiled .NET Framework host `.exe`** (no PowerShell
  dependency, easier to debug, cheaper per-export startup — helps NFR-2). *Recommendation:* start
  with PowerShell/CodeDom to de-risk the DLL wiring; harden into a compiled host if startup cost
  hurts.
- **D2 — Service lifecycle.** Standing background service (installed once, always listening) —
  matches "run service like backend on host OS." Confirm form: Windows service, tray app, or the
  sibling's Electron shell reused headless.
- **D3 — Extension packaging.** Chrome/Edge MV3; content script injected into Aras client pages;
  background/service-worker holds the loopback connection. Confirm target browser(s).
- **D4 — Token connection API (⚠ prove first, M1).** Confirm the exact IOM overload that builds a
  working `HttpServerConnection` from a bearer token (+ url + db) on a 12+ instance, such that
  `CItemHelper.Login()` and the export `get`s succeed. This replaces v0.1's login-through-proxy as
  the primary technical unknown — but it is a **much lower** risk (IOM exposes token overloads and
  the pattern is standard).

---

## 13. Milestones (proposed)

1. **M1 — Token-connection + single-item export spike (highest risk).** Given a hand-supplied
   `{url, db, token, item}`, build the IOM connection, run `CExportItems.Export`/`ExportSolutions`,
   read back the `.xml`, and assert byte-parity vs. a native export of the same item. Proves D-04,
   D-04-parity, and the D2/D4 token seam at once.
2. **M2 — Host service + process-per-export.** Loopback dispatcher spawning one child per request;
   two-instance isolation test (UC4/NFR-7).
3. **M3 — Extension MVP.** Item detection + token extraction + trigger + result panel
   (view/copy/download, raw-byte download).
4. **M4 — Unpackaged flow.** "In a package?" check + reuse `addItemToPackageDef` (D-01).
5. **M5 — Hardening.** Token-expiry retry, faults, timeouts, loopback origin/nonce security, logs
   (token-free), cleanup.
6. **M6 — Version-parity study.** Measure Libs v14 output vs. target 12.x instances (D-03 risk).

---

## 14. Open questions (remaining)

1. **Export option defaults (§5.3):** confirm `level`, `exportReferenced`, `RefToUnknownPacks`
   match native single-item export.
2. **Auto-export after add-to-package (FR-13)?** *(Draft: no — confirm add, re-offer export.)*
3. **BOM in clipboard copy (FR-17)?**
4. **Loopback security scheme (§9 IF-8):** origin allow-list + nonce acceptable?
5. **Host-child runtime (D1)** and **service lifecycle/browsers (D2/D3).**
6. **Token connection overload (D4):** to be nailed down empirically in M1.

---

*End of v0.2 draft. Reply with the remaining ⟨DECIDE⟩ answers and I'll fold them in.*
