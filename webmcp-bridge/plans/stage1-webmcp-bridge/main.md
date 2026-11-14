**Status:** superseded
**Update 2026-11-04:** superseded for review by the [combined plan](../combined/main.md); kept as the Stage 1 investigation record (ids are reused there).
**Date:** 2026-11-04
**Scope:** Stage 1 of the project: is "Website ⇄ WebMCP ⇄ Chrome extension ⇄ MCP ⇄ local Claude Code" feasible, which hacks it needs, and a proof-of-concept spec where Claude Code reads a page's state (background colour + sentence) and changes it.
**Inputs:** [plans/main.md](../main.md) (project goals, verbatim brief below) · [spike 2026-11-04](../../spikes/2026-11-04-webmcp-isolated-world/README.md) (live evidence on this machine) · WebMCP draft spec, Chrome docs, Google's inspector extension source, MCP TypeScript SDK 1.32.2 docs, Claude Code MCP docs (links in §1.6)
**Related plans:** [Project goals and plan index](../main.md)

---

# Stage 1 — WebMCP ⇄ Chrome extension ⇄ MCP ⇄ Claude Code

> **Reading this on GitHub?** This plan is written in the interactive-plan format, a markdown dialect with tags for questions, decisions, findings and checklists. GitHub drops the tags, so the titles, statuses, severities, dates and chosen answers are missing here, and what remains reads as loose prose. Open the raw file to see them, or ask Joseph for a PDF export of the full plan.

## 0. Brief (verbatim)

Chat message, 2026-11-04:

> Review [@main.md](../main.md) carefully, investigate and create an implementation plan for stage 1, pause and let me review.

The Stage 1 section of [plans/main.md](../main.md) that this plan answers, quoted verbatim from the file:

> ## Stage 1
> - Study the WebMCP protocol, and figure out whether a chrome extension can discover them.
> - Figure out whether a chrome extension can start a local mcp server that allows Claude code to connect to it.
> - A proof-of-concept implementation where claude can see a context from a webmcp website (e.g., the current random color of the background and a sentence), and change the website via webmcp (e.g., change the background color and text)
> - Architecture: Website - WebMCP - chrome extension - MCP - local claude code

And the standing instruction from the same file:

> Below are tentative plans, I'm doing the best I can without knowing all the technical details. Your job is to investigate if these are feasible, and document trade-offs, and hacks that are required to make them feasible. Or tell me it is infeasible.

---

## 1. Investigation: verdicts, trade-offs, hacks

### 1.1 Verdict table

| Stage 1 question | Verdict | Evidence |
|---|---|---|
| Can a Chrome extension discover WebMCP tools? | **Yes, directly.** A plain content script (default isolated world) sees the page's registry through `document.modelContext.getTools()`, can call `executeTool()`, and gets `toolchange` events. | Spike on this machine's Chrome 156 (§1.3); Google's own inspector extension uses exactly this (§1.4). |
| Can a Chrome extension start a local MCP server for Claude Code? | **Not literally; yes with one hack.** MV3 extensions cannot listen on a TCP port. A small local helper process ("bridge") owns the port; the extension connects *out* to it over WebSocket. Claude Code talks MCP to the bridge. | Platform constraint (§1.5). Three variants compared in [Q-1](#Q-1). |
| PoC: Claude sees page context and changes the page | **Feasible.** The spike already read state and changed colour + sentence from the isolated world; the remaining work is plumbing (extension ⇄ bridge ⇄ MCP). | §1.3 `callGet`, `callSet`, `callSentence`. |
| Architecture Website – WebMCP – extension – MCP – Claude Code | **Feasible with one extra hop**: Website – WebMCP – extension – *bridge process* – MCP – Claude Code. | §2. |

### 1.2 What WebMCP is today (and what older write-ups get wrong)

- WebMCP is a W3C Web Machine Learning Community Group draft ("Web Model Context API"). It is **tools only**: a page registers named JavaScript functions with a description and a JSON-Schema `inputSchema`. There are no resources, prompts, or a separate "context" primitive. "Context" in the brief's sense (current colour + sentence) is a **read-only tool** (`annotations.readOnlyHint: true`).
- Current API (verified in Chrome 156): `document.modelContext.registerTool({ name, description, inputSchema, execute, annotations }, { exposedTo?, signal? })`, `getTools({ fromOrigins? })`, `executeTool(tool, args, { signal? })`, events `toolchange`, `toolactivated`, `toolcancel`. Unregistering is done by aborting the `AbortSignal` passed at registration.
- **Stale surface you will see in blog posts and the MCP-B polyfill docs:** `navigator.modelContext` (deprecated in Chrome 150, absent in 156), `provideContext()` / `clearContext()` (removed for a security reason: a third-party script could replace tools), `unregisterTool()`. The declarative `<form toolname=…>` API exists in Chrome but is "future exploration" in the spec; this plan uses only the imperative API.
- `execute` may return any JSON-serialisable value; `executeTool` resolves with the **stringified** result (a `DOMString`), or `null` if the tool triggered a navigation. Passing JSON-string arguments is deprecated since Chrome 155; we pass objects.
- The API is `[SecureContext]`: works on `https://` and `http://localhost`, not on a LAN IP over plain http.
- Chrome availability: dev trial since 146; origin trial Chrome 149 → 156, extended to 162; local flag `chrome://flags/#enable-webmcp-testing` ("WebMCP for testing"); command-line `--enable-features=WebMCP`. Edge 150 OT. Firefox has prefs behind a flag; Safari no signal. The feature is under TAG/security review and will keep changing (see [F-1](#F-1)).
- Your machine: Google Chrome 156.0.8078.81 (has the API), Chromium 143 (too old). Your **real profile does not have the flag enabled yet** (checked `Local State`): one-time setup step in §8.

### 1.3 Spike result (this machine, 2026-11-04)

Full write-up and re-run instructions: [spike README](../../spikes/2026-11-04-webmcp-isolated-world/README.md). In short, driving Chrome 156 over CDP with an isolated world standing in for a content script:

| Probe | Result |
|---|---|
| `typeof document.modelContext` in the isolated world | `object` (page globals are *not* visible, so the registry is browser-owned) |
| `getTools()` from the isolated world | the three page tools, with `inputSchema` as objects, `annotations`, `origin`, `window` |
| `executeTool(set_background_color, {color:'teal'})` | resolves with the string `{"ok":true,"backgroundColor":"teal"}`; page background changed |
| `executeTool(get_state, {})` | string `{"backgroundColor":"teal","sentence":"…"}` (the "see the context" path) |
| `toolchange` listener in the isolated world | fired once when the page registered a 4th tool |

### 1.4 Prior art (what to borrow, what not to depend on)

- **Google "Model Context Tool Inspector" extension** (Chrome Web Store; source mirrored at `github.com/mario-oliver/model-context-tool-inspector`, Apache-2.0, also in `GoogleChromeLabs/webmcp-tools`). Manifest: permissions `sidePanel, activeTab, scripting, webNavigation`; host permissions `<all_urls>`; content script on `<all_urls>`, `all_frames`, `document_start`, default world; `minimum_chrome_version` `150.0.7861.0`. Its `content.js` is the reference for discovery (`getTools`, `ontoolchange`) and execution (`executeTool`, with a fallback for the deprecated JSON-string arguments). It stops at the side panel: no MCP, no external agent.
- **MCP-B / WebMCP-org** (`@mcp-b/global` v6 polyfill, transports, "local relay"). The polyfill implements `navigator.modelContext` in page JS (main world), so an extension that only looks in the isolated world will **not** see polyfilled tools. Their MCP-client extension is closed source. We borrow the idea, not the code.
- **Playwright 1.64** has `page.webmcp.tools()` / `callTool()` with Chromium launched via `--enable-features=WebMCP`: a ready-made way to test the demo site's tools without the extension.
- **Chrome DevTools → Application → WebMCP** pane: lists registered tools and lets you run them by hand. Useful when debugging "is the page registering what I think it is".

### 1.5 Why the extension cannot host the MCP server, and the three hacks

MV3 extensions have no listening-socket API (`chrome.sockets.*` existed only for Chrome Apps). A service worker can open outbound WebSocket/HTTP connections and can spawn a native-messaging host, but nothing can `listen()`. Therefore some local process outside the extension must own the port Claude Code connects to. The candidates, compared in [Q-1](#Q-1):

| Variant | Who starts it | Claude Code transport | Extension link | Trade-offs |
|---|---|---|---|---|
| **(a) Bridge daemon** | you (`bun run bridge`), later launchd | Streamable HTTP `http://127.0.0.1:8717/mcp` | WS client → daemon | Simplest, multi-session, survives Claude restarts; needs to be running; Stage 2 (ACP) wants a daemon anyway |
| (b) Bridge spawned by Claude Code (stdio) | Claude Code | stdio | WS client → the spawned process | Zero manual start; one Claude session at a time (port clash); extension reconnects on every session |
| (c) Native-messaging host | Chrome, when the extension calls `connectNative` | Streamable HTTP (host also runs it) | stdio pipe Chrome↔host | Auto-start bound to browser lifetime; needs a host manifest in `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`, a pinned extension id (`"key"` in manifest), and the host's stdout is the pipe (no `console.log`). This is (a) plus auto-launch; can be added later. |

Service-worker lifetime hacks that come with (a)/(b): an MV3 worker is killed after 30 s idle; **WebSocket traffic resets the timer since Chrome 116**, so the worker pings the bridge every ~20 s and reconnects with backoff in `onclose`; a `chrome.alarms` tick (every 30 s) re-checks the connection after the worker is restarted. Native-messaging ports also keep a worker alive (Chrome 105+).

### 1.6 Claude Code side (version 2.1.318 on this machine)

- Transports: `stdio`, `http` (Streamable HTTP, recommended), `sse` (legacy). Project config `.mcp.json` (`{"mcpServers": {"webmcp": {"type": "http", "url": "…"}}}`), approved once per project in interactive sessions; `claude mcp add --transport http webmcp http://127.0.0.1:8717/mcp` for user scope.
- Tool names surface as `mcp__webmcp__<tool>`; characters outside `[A-Za-z0-9_-]` become `_` (WebMCP allows `.` in names, so `graph.select` → `graph_select`).
- Dynamic tools: the docs say an interactive session re-fetches the tool list on `notifications/tools/list_changed` without reconnecting. A regression report (anthropics/claude-code#78208, HTTP transport, 2.1.211) was closed as "not planned", so this must be **tested, not assumed** ([F-2](#F-2)). The plan therefore has a static baseline (meta-tools) that works even if the notification is ignored, plus dynamic mirroring as the nicer layer.
- Limits worth knowing: tool output over 10k tokens warns, 25k truncates (`MAX_MCP_OUTPUT_TOKENS`); `MCP_TOOL_TIMEOUT` caps a call; `/mcp` shows status and offers Reconnect.

Sources: [WebMCP draft spec](https://webmachinelearning.github.io/webmcp/) · [webmachinelearning/webmcp implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) · [Chrome WebMCP docs](https://developer.chrome.com/docs/ai/webmcp) and [imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) · [Chrome Status 5117755740913664](https://chromestatus.com/feature/5117755740913664) · [inspector extension source](https://github.com/mario-oliver/model-context-tool-inspector) · [DevTools WebMCP pane](https://developer.chrome.com/docs/devtools/application/webmcp) · [Playwright WebMCP class](https://playwright.dev/docs/api/class-webmcp) · [MV3 WebSockets in service workers](https://developer.chrome.com/docs/extensions/mv3/tut_websockets) · [service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) · [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) · [claude-code#78208](https://github.com/anthropics/claude-code/issues/78208) · [MCP TS SDK](https://github.com/modelcontextprotocol/typescript-sdk) · [MCP-B docs](https://docs.mcp-b.ai/)

---

## 2. Architecture

```
┌────────────────────────── Google Chrome 156 (flag: WebMCP for testing) ──────────────────────────┐
│  Tab: demo site (later: science-kg causal-graph-viewer)                                          │
│    page JS ── registerTool() ──▶  document.modelContext  (browser-owned per-document registry)   │
│                                        ▲ getTools() / executeTool() / 'toolchange'               │
│    content.ts (isolated world) ────────┘                                                         │
│         │ chrome.runtime messages (tools list ↑, call requests ↓)                                 │
│    background.ts (service worker): TabRegistry, WebSocket client, 20 s keepalive, popup state     │
└─────────────────────────────────────────────────────┬────────────────────────────────────────────┘
                                                      │ ws://127.0.0.1:8717/ws   (JSON frames, §4)
┌─────────────────────────────────────────────────────▼────────────────────────────────────────────┐
│  bridge (Node + TypeScript daemon, one port)                                                      │
│    registry.ts  {tabId → url, title, tools[]} + "selected tab"                                    │
│    mcp.ts       MCP Server: meta-tools (static) + mirrored tools of the selected tab (dynamic)    │
│    http.ts      Streamable HTTP /mcp (one Server per session, list_changed fan-out)               │
│    (optional)   --stdio mode: same bridge, spawned by Claude Code                                 │
└─────────────────────────────────────────────────────▲────────────────────────────────────────────┘
                                                      │ http://127.0.0.1:8717/mcp
                                      Claude Code (`claude` in this repo; .mcp.json → "webmcp")
```

Data flow for "what colour is the page?": Claude Code → `tools/call get_state` → bridge looks up the selected tab → WS `call` frame → service worker → `chrome.tabs.sendMessage(tabId)` → content script `executeTool(get_state, {})` → page `execute` runs → string result back along the same path → bridge normalises it into an MCP result (§5.3) → Claude answers.

Data flow for discovery: page registers tools → `toolchange` in the content script → debounced `getTools()` → `tools` message to the service worker → `tab/tools` frame to the bridge → registry updates → if the tab is the selected one, every connected MCP session gets `notifications/tools/list_changed` → Claude Code re-fetches `tools/list`.

**Stage 2 note.** The bridge is the natural place to also host an ACP connection to Claude Code later (the website would talk to the bridge through the extension, and the bridge to Claude Code over ACP). That is why [Q-1](#Q-1) recommends the daemon variant now.

---

## 3. Components and repository layout

```
webmcp-bridge/
  package.json                 # bun workspaces: extension, bridge, demo-site, shared
  .mcp.json                    # Claude Code project-scope config → http://127.0.0.1:8717/mcp
  README.md                    # quickstart (§8)
  shared/
    protocol.ts                # WS frame types shared by extension + bridge (§4)
    webmcp.d.ts                # local ambient types for document.modelContext (verified shape)
  extension/
    manifest.json              # MV3, minimum_chrome_version 150.0.7861.0
    src/content.ts             # isolated world: getTools / executeTool / toolchange → runtime messages
    src/background.ts          # service worker: TabRegistry, WS client, keepalive, programmatic injection
    src/popup.html, popup.ts   # bridge status, tabs with tool counts, "use this tab", reconnect
    build.ts                   # `bun build` → dist/ (+ copies manifest, popup.html, icons)
  bridge/
    src/index.ts               # CLI: --port 8717 (default), --stdio, --token
    src/ws-server.ts           # extension side: accepts one extension connection, routes frames
    src/registry.ts            # tabs/tools state, selected-tab rule, change events
    src/mcp.ts                 # low-level MCP Server: meta-tools + mirrored tools + result normalisation
    src/http.ts                # express + StreamableHTTPServerTransport, sessions, list_changed fan-out
    test/                      # vitest: registry selection, name sanitising, result normalisation
  demo-site/
    index.html, src/main.ts    # Vite vanilla-ts; registers the four tools (§6)
  spikes/2026-11-04-webmcp-isolated-world/   # evidence; kept as a regression smoke test
  plans/
```

Toolchain: TypeScript everywhere; bun as package manager and bundler; the bridge runs on Node 23 (the MCP SDK's Streamable HTTP transport targets Node `http` request/response types, and this matches how `causal-graph-viewer` runs its server with `tsx`). See [D-3](#D-3).

---

## 4. Extension ⇄ bridge protocol (JSON frames over WebSocket)

Extension → bridge:

| frame | payload | when |
|---|---|---|
| `hello` | `{ extensionVersion, chromeVersion, token? }` | on connect |
| `tabs/snapshot` | `{ tabs: TabInfo[] }` | right after `hello` (full resync) and after the worker restarts |
| `tab/tools` | `TabInfo = { tabId, url, title, active, tools: ToolInfo[] }` | content script reported a (debounced) change |
| `tab/removed` | `{ tabId }` | `chrome.tabs.onRemoved` |
| `tab/activated` | `{ tabId }` | `chrome.tabs.onActivated` (feeds the selected-tab default) |
| `call/result` | `{ callId, ok: true, result: string \| null }` or `{ callId, ok: false, error: { name, message } }` | after `executeTool` settles |
| `pong` | `{}` | reply to `ping` |

Bridge → extension:

| frame | payload |
|---|---|
| `call` | `{ callId, tabId, name, args, timeoutMs }` |
| `cancel` | `{ callId }` (Claude Code cancelled the request; content script aborts the `AbortSignal`) |
| `ping` | `{}` (every 20 s; keeps the service worker alive) |

`ToolInfo = { name, description, inputSchema?: object, annotations?: { readOnlyHint?, consequentialHint?, untrustedContentHint?, debugging? } }` — a verbatim copy of what `getTools()` returned, schema parsed to an object if Chrome hands back a string.

Inside the extension, the content script and the service worker exchange `chrome.runtime` messages `{ type: 'tools', tools }`, `{ type: 'call', callId, name, args, timeoutMs }`, `{ type: 'cancel', callId }`, `{ type: 'result', … }`. The service worker adds `tabId` from `sender.tab.id`.

---

## 5. MCP surface exposed to Claude Code

### 5.1 Meta-tools (always registered; work even if `list_changed` is ignored)

| tool | input | returns |
|---|---|---|
| `webmcp_list_tabs` | — | tabs that have ≥1 tool: `{ tabId, title, url, toolCount, selected }[]`, plus bridge/extension status |
| `webmcp_use_tab` | `{ tab_id }` | makes that tab the selected tab (mirrored tools switch; emits `list_changed`) |
| `webmcp_list_tools` | `{ tab_id? }` | the tab's tools with full `inputSchema` and annotations (default: selected tab) |
| `webmcp_call_tool` | `{ name, args?, tab_id? }` | forwards to the page; returns the normalised result (§5.3) |

### 5.2 Mirrored tools (dynamic layer)

Every tool of the **selected tab** is also registered under its own name, so Claude sees `get_state` and `set_background_color` as first-class tools with the page's own description and schema. Rules:

- Name sanitising: `[^A-Za-z0-9_-]` → `_`; if the result collides with a meta-tool or another mirrored name, append `_2`, `_3`, …
- Description: page description + `  (WebMCP tool on <origin>, tab "<title>")`. If `untrustedContentHint` is set, prefix the description with `[returns untrusted page content] `.
- Annotation mapping: `readOnlyHint → readOnlyHint`; `consequentialHint → destructiveHint`; `openWorldHint: false`.
- Selected tab default: the most recently activated tab that has tools; `webmcp_use_tab` pins one until it closes. When the selected tab closes, fall back to the default and emit `list_changed`.
- Every registry change affecting the selected tab → `server.sendToolListChanged()` on **every** connected MCP session.

### 5.3 Result normalisation (bridge, applies to meta and mirrored calls)

```
raw = string | null                       # what executeTool resolved with
null                                       → text "tool triggered a navigation; no result"
JSON.parse(raw) fails                      → content: [{ type: 'text', text: raw }]
parsed is an object with a `content` array → returned as-is (page chose to speak MCP)
parsed is an object/array                  → content: [{ type:'text', text: JSON.stringify(parsed, null, 2) }], structuredContent: parsed
parsed is a string/number/boolean          → content: [{ type:'text', text: String(parsed) }]
error (NotFoundError, DataError, OperationError, AbortError, timeout, tab closed, extension offline)
                                           → isError: true, content: [{ type:'text', text: `${name}: ${error.name}: ${error.message}` }]
```

Per-call timeout: 60 s default (`timeoutMs` in the `call` frame); the content script passes an `AbortSignal` to `executeTool` so a cancelled call stops the page-side `execute` too.

### 5.4 Code sketches (verified against SDK 1.32.2 docs and the spike)

Content script (isolated world):

```ts
// extension/src/content.ts
const mc = document.modelContext;                       // undefined ⇒ flag off; report once, do nothing
const inflight = new Map<string, AbortController>();

async function listTools() {
  const tools = await mc.getTools();
  return tools.map(t => ({
    name: t.name, description: t.description,
    inputSchema: typeof t.inputSchema === 'string' ? JSON.parse(t.inputSchema) : t.inputSchema,
    annotations: t.annotations,
  }));
}
const report = debounce(async () => chrome.runtime.sendMessage({ type: 'tools', tools: await listTools() }), 100);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'list') { listTools().then(tools => reply({ tools })); return true; }
  if (msg.type === 'cancel') { inflight.get(msg.callId)?.abort(); return; }
  if (msg.type === 'call') {
    const ac = new AbortController(); inflight.set(msg.callId, ac);
    const timer = setTimeout(() => ac.abort(), msg.timeoutMs);
    (async () => {
      const tool = (await mc.getTools()).find(t => t.name === msg.name);
      if (!tool) throw Object.assign(new Error(`no tool named ${msg.name}`), { name: 'NotFoundError' });
      return await mc.executeTool(tool, msg.args ?? {}, { signal: ac.signal });   // string | null
    })()
      .then(result => reply({ ok: true, result }))
      .catch(e => reply({ ok: false, error: { name: e.name, message: e.message } }))
      .finally(() => { clearTimeout(timer); inflight.delete(msg.callId); });
    return true;                                          // async reply
  }
});
mc?.addEventListener('toolchange', report);
if (mc) report();
```

Bridge MCP server (low-level `Server`, so the tool list is served from the live registry with the page's JSON Schema, no Zod conversion):

```ts
// bridge/src/mcp.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function makeServer(registry: Registry, ext: ExtensionLink) {
  const server = new Server({ name: 'webmcp-bridge', version: '0.1.0' },
                            { capabilities: { tools: { listChanged: true } } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...metaTools(), ...registry.mirroredTools()],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args = {} } = req.params;
    if (isMetaTool(name)) return runMetaTool(name, args, registry, ext);
    const target = registry.resolveMirrored(name);          // { tabId, pageToolName }
    return normalise(await ext.call(target.tabId, target.pageToolName, args, { signal: extra.signal }));
  });
  registry.on('change', () => void server.sendToolListChanged());
  return server;
}
```

Streamable HTTP with sessions (one `Server` per Claude Code session so notifications reach each GET stream):

```ts
// bridge/src/http.ts (sketch)
app.post('/mcp', async (req, res) => {
  const sid = req.header('mcp-session-id');
  let session = sid ? sessions.get(sid) : undefined;
  if (!session) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: id => sessions.set(id, { server, transport }),
    });
    const server = makeServer(registry, ext);
    await server.connect(transport);
    session = { server, transport };
  }
  await session.transport.handleRequest(req, res, req.body);
});
app.get('/mcp', (req, res) => sessions.get(req.header('mcp-session-id')!)?.transport.handleRequest(req, res));
app.delete('/mcp', …);                                        // session teardown
const httpServer = http.createServer(app);
new WebSocketServer({ server: httpServer, path: '/ws' });     // the extension side, same port
httpServer.listen(8717, '127.0.0.1');
```

Service worker connection loop:

```ts
// extension/src/background.ts (sketch)
function connect() {
  ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.onopen = async () => { backoff = 1000; send('hello', …); send('tabs/snapshot', await snapshotAllTabs()); };
  ws.onmessage = e => route(JSON.parse(e.data));              // call → chrome.tabs.sendMessage(tabId, …)
  ws.onclose = () => { ws = undefined; setTimeout(connect, backoff = Math.min(backoff * 2, 15000)); };
}
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });  // worker may have been killed meanwhile
chrome.alarms.onAlarm.addListener(() => { if (!ws) connect(); });
chrome.runtime.onInstalled.addListener(injectContentScriptIntoOpenTabs);   // tabs opened before install
```

---

## 6. Demo site (the PoC website)

Vite vanilla-ts app on `http://localhost:5173`. On load it picks a random background colour and a random sentence (per the brief) and registers:

| tool | annotations | behaviour |
|---|---|---|
| `get_state` | `readOnlyHint` | returns `{ backgroundColor, sentence, toolCallCount }` |
| `set_background_color { color }` | — | validates as a CSS colour, applies it, returns the new state |
| `set_sentence { text }` | — | replaces the headline, returns the new state |
| `randomize` | — | new random colour + sentence, returns the new state |

Page UI: the sentence, a swatch with the colour value, a **live list of registered tools** (via its own `getTools()`), a **call log** (what the agent did, with arguments), a "Register bonus tool" button (adds `shout { text }` at runtime to exercise `toolchange` → `list_changed`), and a red banner if `document.modelContext` is missing ("enable chrome://flags/#enable-webmcp-testing").

The page keeps the abort controller per tool so the bonus tool can also be unregistered (tests removal).

---

## 7. Work breakdown

| # | Milestone | Deliverable | Done when |
|---|---|---|---|
| M0 | Scaffold | bun workspaces, tsconfig, `shared/`, `.mcp.json`, README | `bun install && bun run build` passes |
| M1 | Demo site | §6 page | DevTools → Application → WebMCP shows 4 tools; `randomize` works from the DevTools pane |
| M2 | Extension | content script + service worker + popup | badge shows tool count on the demo tab; popup lists tools; worker reconnect loop logs |
| M3 | Bridge, static | WS server + registry + meta-tools over Streamable HTTP | `claude mcp list` → `webmcp ✔ Connected`; `webmcp_call_tool get_state` returns the page state |
| M4 | Mirroring | mirrored tools + `list_changed` fan-out | Claude calls `set_background_color` directly; bonus-tool registration appears (or [F-2](#F-2) is documented with evidence) |
| M5 | Acceptance | §9 checklist run end-to-end, README quickstart verified, findings updated | all checks ticked or explained |
| M6 | Stretch (per [Q-5](#Q-5) / [Q-6](#Q-6)) | science-kg tools, `webmcp_snapshot`, screenshot tool, token auth | — |

Rough size: bridge ≈ 300 lines, extension ≈ 300 lines, demo ≈ 120 lines, plus tests and README.

---

## 8. Developer quickstart (target experience)

```bash
bun install
bun run build:extension            # → extension/dist
# one-time, in your normal Chrome profile:
#   chrome://flags/#enable-webmcp-testing → Enabled → Relaunch
#   chrome://extensions → Developer mode → Load unpacked → extension/dist
bun run demo                       # http://localhost:5173 (Vite)
bun run bridge                     # ws + MCP on 127.0.0.1:8717
claude                             # approve the project-scoped "webmcp" server on first run
```

Hacks baked into this flow: `--load-extension` no longer works in branded Chrome (removed in 137), hence "Load unpacked"; after editing the extension, click its reload button and reload open tabs (content scripts don't re-inject into already-open pages, so `onInstalled` injects programmatically too).

---

## 9. Acceptance checklist (tick in the viewer as you go)

**Setup**
<check id="k1" status="todo">Chrome flag enabled; the demo page shows no red banner and lists 4 tools.</check>
<check id="k2" status="todo">Extension loaded unpacked; its badge reads `4` on the demo tab.</check>
<check id="k3" status="todo">`bun run bridge` logs `extension connected` and `tab … 4 tools`.</check>
<check id="k4" status="todo">`claude mcp list` shows `webmcp ✔ Connected`; `/mcp` lists the 4 meta-tools (and the 4 mirrored ones once M4 lands).</check>

**See the context**
<check id="k5" status="todo">Ask Claude Code "What is the current background colour and sentence on the demo page?" → it calls `get_state` and answers with the values shown on screen.</check>

**Change the page**
<check id="k6" status="todo">Ask "Make the background #0066cc and set the sentence to 'Hello from Claude Code'" → the page updates within a second and the call log shows both calls.</check>
<check id="k7" status="todo">Ask for a random colour via `randomize` and have Claude report the new values (round-trip of a tool that returns an object).</check>

**Dynamics and failure modes**
<check id="k8" status="todo">Click "Register bonus tool" → Claude can call `shout` without `/mcp` reconnect (otherwise record the outcome under F-2).</check>
<check id="k9" status="todo">Close the demo tab → a call returns an `isError` result that says the tab is gone; reopen → `webmcp_list_tabs` shows it again.</check>
<check id="k10" status="todo">Kill and restart the bridge → the extension reconnects within 15 s without touching Chrome.</check>
<check id="k11" status="todo">Leave Chrome idle for 3 minutes → a tool call still works (service-worker keepalive holds).</check>
<check id="k12" status="todo">Open the demo in two tabs → `webmcp_use_tab` switches which one the mirrored tools hit.</check>

---

## 10. Open questions

<open-question id="Q-1" title="Bridge process model" status="open">
Which of the three hacks from §1.5 should Stage 1 implement first? The bridge code is the same in all three; this only decides who starts it and which Claude Code transport is the default.

<options select="single">
  <option id="daemon">**(a) Standalone daemon, Streamable HTTP** (recommended). `bun run bridge` in a terminal; `.mcp.json` points Claude Code at `http://127.0.0.1:8717/mcp`. Multiple Claude sessions share one browser link; survives Claude restarts; the natural host for Stage 2's ACP connection. Cost: one more process to start (a launchd agent can automate it later).</option>
  <option id="stdio">**(b) stdio bridge spawned by Claude Code.** `claude mcp add webmcp -- node bridge/dist/index.js --stdio`. Zero manual start. Only one Claude session at a time (the WS port is taken), the extension reconnects every time Claude restarts, and logs must go to stderr.</option>
  <option id="native">**(c) Native-messaging host.** The extension auto-launches the bridge via `connectNative`; the bridge still serves Streamable HTTP for Claude Code. Needs a host manifest install step and a pinned extension id. Best as an add-on to (a) once (a) works.</option>
  <option id="both">**(a) now, plus a `--stdio` flag** since it is ~15 lines on top of (a). Lets us compare `list_changed` behaviour across both transports in M4.</option>
</options>
</open-question>

<open-question id="Q-2" title="How tools appear to Claude Code" status="open">
§5 proposes static meta-tools plus mirrored tools of one selected tab. Alternatives:

<options select="single">
  <option id="meta-plus-mirror">**Meta-tools + mirrored tools of the selected tab** (recommended). Robust baseline and the nicest demo (Claude calls `set_background_color` by name).</option>
  <option id="meta-only">**Meta-tools only.** Smallest, immune to the `list_changed` question; Claude must always go through `webmcp_call_tool`, which reads worse in transcripts and costs an extra `webmcp_list_tools` call to learn schemas.</option>
  <option id="mirror-all">**Mirror every tab, namespaced** (`demo_5173__get_state`, `scikg__select_node`). No tab selection step, but names churn whenever tabs open/close and Claude has to parse prefixes.</option>
</options>
</open-question>

<open-question id="Q-3" title="Which pages the content script runs on" status="open">
The content script is cheap (one `getTools()` per page and per change), but `<all_urls>` means a host-permission warning at install and a tool-count badge on every site.

<options select="single">
  <option id="all-urls">**`<all_urls>`** (recommended for an exploration project): any site that adopts WebMCP shows up automatically, which is also how we will notice real-world adopters.</option>
  <option id="allowlist">**Allow-list**: `http://localhost/*`, `http://127.0.0.1/*`, and the science-kg dev/prod origins; extend via `optional_host_permissions` from the popup when needed.</option>
</options>
</open-question>

<open-question id="Q-4" title="Support polyfilled pages (no Chrome flag)?" status="open">
Pages using `@mcp-b/global` (or any main-world polyfill) register tools in page JS, invisible to the isolated world. Supporting them means injecting a `world: "MAIN"` script that relays `getTools`/`executeTool` over `window.postMessage`, trusting page JS more.

<options select="single">
  <option id="native-only">**Native API only in Stage 1** (recommended). The flag is a one-time toggle on this machine, the spike proves the path, and the polyfill's API is older than Chrome's.</option>
  <option id="main-world-fallback">**Add the MAIN-world fallback now**, so the demo also works in an un-flagged Chrome or in Chromium 143.</option>
</options>
</open-question>

<open-question id="Q-5" title="Where does science-kg come in?" status="open">
The brief names `causal-graph-viewer` as the real target. It has no WebMCP code yet (grep confirmed). Registering tools there is page-side work: a `useWebMcpTools()` hook that registers e.g. `get_selection`, `select_node { id }`, `search_nodes { query }`, `add_annotation { … }` from existing hooks, behind a feature flag so production is unaffected.

<options select="single">
  <option id="stage-1-5">**After the PoC, as its own plan ("Stage 1.5")** (recommended): keep Stage 1 small and get the bridge right on the toy page first; the science-kg plan then focuses on which operations are worth exposing.</option>
  <option id="in-stage-1">**Include 2–3 science-kg tools in Stage 1** as M6, to validate the bridge against a real React app (hook lifecycle, re-registration on re-render, many tools).</option>
</options>
</open-question>

<open-question id="Q-6" title="Extras worth adding to the PoC" status="open">
Each is small and independent. Pick any.

<options select="multi">
  <option id="snapshot">`webmcp_snapshot { tab_id? }`: calls every zero-argument `readOnlyHint` tool of the tab and returns one combined object. This is the closest thing to "Claude sees the page's context" in one call.</option>
  <option id="screenshot">`webmcp_screenshot { tab_id? }`: `chrome.tabs.captureVisibleTab` → MCP image content, so Claude can literally see the page (needs the tab to be visible).</option>
  <option id="token">Shared secret between extension and bridge (`--token`, stored in `chrome.storage.local` via the popup) so another local process cannot drive your tabs through the bridge. See [F-4](#F-4).</option>
  <option id="resources">Also expose zero-argument read-only tools as MCP **resources** (`webmcp://<tabId>/<tool>`), so `@webmcp:…` mentions work in Claude Code.</option>
  <option id="calllog">Tool-call log in the popup (last 50 calls with args/results), mirroring the demo page's log for sites that have none.</option>
</options>
</open-question>

---

## 11. Decisions

<decision id="D-1" title="Discover and call tools from an isolated-world content script via document.modelContext" status="locked" date="2026-11-04">
The extension uses the native API from a plain content script (default world): `getTools()`, `executeTool()`, `toolchange`. No `chrome.debugger`, no main-world injection in Stage 1.
<rationale>Verified on this machine's Chrome 156 (spike, §1.3) and it is the mechanism Google's own inspector extension uses. `chrome.debugger` would show the "is being debugged" infobar and conflict with DevTools; main-world injection trusts page JS more than needed.</rationale>
</decision>

<decision id="D-2" title="The extension never listens; a local bridge process owns the port" status="locked" date="2026-11-04">
Claude Code connects to a bridge process, never to the extension. The extension connects out to the bridge over WebSocket.
<rationale>MV3 extensions have no server-socket API (§1.5). Which process model starts the bridge is [Q-1](#Q-1).</rationale>
</decision>

<decision id="D-3" title="TypeScript monorepo (bun workspaces), bridge on Node 23" status="proposed" date="2026-11-04">
`extension/`, `bridge/`, `demo-site/`, `shared/` as bun workspaces; `bun build` for the extension; `tsx`/Node for the bridge; `@modelcontextprotocol/sdk` 1.32.2 (latest on npm; the 2.x line lives under a different package and is not needed).
<rationale>Matches the stack of `causal-graph-viewer` (bun + Vite + tsx), and the SDK's Streamable HTTP transport is written against Node's `http` types.</rationale>
</decision>

<decision id="D-4" title="Low-level MCP `Server` with raw JSON Schema, not `McpServer` + Zod" status="proposed" date="2026-11-04">
`tools/list` is answered from the live registry with the page's `inputSchema` verbatim; `tools/call` is a forwarder. `capabilities.tools.listChanged = true` and `sendToolListChanged()` on changes.
<rationale>The schemas come from the page as JSON Schema; converting them to Zod and back would be lossy and pointless. The low-level handlers are the natural shape for a proxy.</rationale>
</decision>

<decision id="D-5" title="Stage 1 targets top-frame tools; iframes deferred" status="proposed" date="2026-11-04">
`getTools()` from the top document already includes same-origin descendant tools (each carries its `window`); cross-origin iframes need `allow="tools"` + `exposedTo`/`fromOrigins` and a frame-id handshake like the inspector's. Not needed for the demo or for science-kg.
</decision>

<decision id="D-6" title="Static meta-tools are the guaranteed path; mirroring is layered on top" status="proposed" date="2026-11-04">
Whatever [Q-2](#Q-2) decides, `webmcp_list_tabs / use_tab / list_tools / call_tool` exist so the PoC works even if Claude Code ignores `list_changed` ([F-2](#F-2)).
</decision>

---

## 12. Risks and hacks (findings)

<finding id="F-1" title="WebMCP is experimental and still changing" severity="p1" status="open" effort="small">
Origin trial until Chrome 162, TAG/security reviews pending, API renamed twice already (`navigator`→`document`, `provideContext` removed). Mitigation: all `document.modelContext` calls live in one adapter (`extension/src/content.ts`); `minimum_chrome_version` pinned; record the Chrome version each acceptance run used; keep the spike as a smoke test to re-run after Chrome updates.
</finding>

<finding id="F-2" title="Claude Code may ignore notifications/tools/list_changed over HTTP" severity="p1" status="open" effort="small">
Docs say interactive sessions refresh on the notification; issue #78208 (2.1.211, Streamable HTTP) says otherwise and was closed "not planned". We are on 2.1.318. M4 tests it explicitly on HTTP (and stdio if [Q-1](#Q-1) picks "both"); if it fails, the mirrored layer still works after `/mcp` → Reconnect, and the meta-tools work regardless. Outcome gets recorded here.
</finding>

<finding id="F-3" title="MV3 service worker gets killed after 30 s idle" severity="p2" status="open" effort="small">
WebSocket ping every 20 s (Chrome ≥116 resets the idle timer on WS traffic), reconnect with backoff, `chrome.alarms` safety tick, and the tab registry re-snapshotted from `chrome.tabs.query` + content-script `list` on every (re)connect rather than trusted from worker memory.
</finding>

<finding id="F-4" title="Any local process can drive your tabs through the bridge" severity="p2" status="open" effort="small">
The bridge binds `127.0.0.1` only, but the WS and MCP endpoints are unauthenticated: <user-highlight comment="c1">a malicious local process (or a page that can reach localhost through a CSRF-style WebSocket) could call page tools</user-highlight>. Also, tool descriptions and results are page-authored text that flows into Claude's context (prompt-injection surface); `untrustedContentHint` is surfaced in the description. Token option in [Q-6](#Q-6).
</finding>

<comment id="c1" status="open" kind="question">
  <note by="agent" at="2026-11-04T11:40">Acceptable for a dev-machine PoC, or do you want the shared token in Stage 1 (Q-6 "token")? Browsers do not block `ws://127.0.0.1` from web pages, so a page you visit could in principle talk to the bridge; a token closes that.</note>
</comment>

<finding id="F-5" title="Secure-context requirement" severity="p2" status="open" effort="small">
`document.modelContext` exists only on `https://` and `http://localhost` / `127.0.0.1`. The demo and the science-kg dev server are on localhost; the deployed science-kg is https; anything on a LAN IP would need https or a port-forward.
</finding>

<finding id="F-6" title="No --load-extension in branded Chrome; extension dev loop is manual" severity="p3" status="open" effort="small">
Load unpacked once; reload from `chrome://extensions` after builds; already-open tabs need a reload (or the `onInstalled` programmatic injection). For automation later: Chrome for Testing via `npx @puppeteer/browsers install chrome@stable` honours `--load-extension` and `--enable-features=WebMCP`; Playwright 1.64 can drive the demo tools directly.
</finding>

<finding id="F-7" title="Results arrive as JSON strings; argument encoding changed in Chrome 155" severity="p3" status="open" effort="small">
`executeTool` resolves with a `DOMString`, `null` on navigation; the bridge normalises (§5.3). Arguments are passed as objects (string form deprecated). Old examples that `JSON.stringify` arguments will break on future Chrome.
</finding>

<finding id="F-8" title="Tool names must be sanitised and de-duplicated" severity="p3" status="open" effort="small">
WebMCP allows `.` in names; Claude Code maps everything outside `[A-Za-z0-9_-]` to `_`. Two tabs can register the same name; mirrored names are per selected tab, meta-tool names are reserved (§5.2).
</finding>

<finding id="F-9" title="Multiple extension connections / Chrome profiles" severity="p3" status="open" effort="small">
Each Chrome profile runs its own copy of the extension; `tabId`s are per profile. Stage 1: the bridge accepts one extension connection; a second one replaces it with a warning in the log. Proper multi-browser support (browser id in frames) is a later change.
</finding>

---

## 13. Out of scope for Stage 1

- Stage 2 (ACP, embedding Claude Code chat inside the website): see [plans/main.md](../main.md). The daemon in [Q-1](#Q-1) is designed so that Stage 2 extends it rather than replacing it.
- Declarative `<form toolname>` tools, cross-origin iframe tools, Edge/Firefox.
- Publishing the extension; it stays unpacked.
