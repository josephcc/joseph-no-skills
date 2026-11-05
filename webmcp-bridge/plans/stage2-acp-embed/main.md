**Status:** superseded
**Update 2026-11-04:** superseded for review by the [combined plan](../combined/main.md); kept as the Stage 2 investigation record (ids are reused there).
**Date:** 2026-11-04
**Scope:** Stage 2 of the project: can a local Claude Code chat be embedded *inside* a web page through ACP, what it costs, and what it changes about Stage 1's architecture. Ends with a proposed revision list for the Stage 1 plan.
**Inputs:** [plans/main.md](../main.md) (Stage 2 section, verbatim below) · [Stage 1 plan](../stage1-webmcp-bridge/main.md) · ACP spec v1 + remote-transport RFD · source of `@agentclientprotocol/sdk` 2.4.0 and `@agentclientprotocol/claude-agent-acp` 0.100.0 (scratch clones at `/tmp/acp-src/`) · Claude Agent SDK docs · acp-ui and acp-chat (browser ACP clients) · `causal-graph-viewer` chat code
**Related plans:** [Project goals and plan index](../main.md) · [Stage 1 — WebMCP bridge](../stage1-webmcp-bridge/main.md)

---

# Stage 2 — Embed a local Claude Code chat inside the website (ACP)

## 0. Brief (verbatim)

Chat message, 2026-11-04:

> Playwright MCP / chrome devtools is definitely out of the picture. I don't want claude doing screenshots because its expensive and slow.
>
> Why don't we keep this open. The goal is both science-kg and hopefully some reusable infrastructure. But it is a little bit of an annoyance to have users install a chrome extension and then a bdige.
>
> Before we commit, why don't we continue to plan out stage 2 in [@main.md](../main.md) and see if that changes the picture.

The Stage 2 section of [plans/main.md](../main.md), quoted verbatim from the file:

> ## Stage 2
> - Study ACP (agent context protocol), can we embed claude code chat **inside** the website?
> - Architecture: Website - chrome extension - ACP - local claude code

Context from the same thread (my paraphrase, not the user's words): the Chrome App idea was dropped as deprecated; packaging the bridge as a Claude Code *plugin* (skill + MCP server) was found feasible; the open worry is install friction (extension + bridge) and whether WebMCP and the extension are needed at all.

---

## 1. Verdicts

**Naming first.** The protocol that embeds coding agents into editors and other clients is the **Agent Client Protocol** (ACP, by Zed, agentclientprotocol.com), JSON-RPC 2.0, v1 stable and a v2 draft. It is not IBM's "Agent Communication Protocol" (BeeAI), which has the same acronym. This plan uses ACP = Agent Client Protocol throughout.

| Question | Verdict | Evidence |
|---|---|---|
| Can Claude Code be driven over ACP? | **Yes, with an official adapter.** `@agentclientprotocol/claude-agent-acp` 0.100.0 wraps the Claude Agent SDK (0.3.316) around the `claude` binary. It streams text and thoughts, reports tool calls, asks permission with the four ACP option kinds, supports terminals, slash commands, @-mentions, images, `loadSession`, and client-supplied MCP servers over stdio, HTTP, and SSE. v2 (resume/fork/plans/config) is experimental. | §2.1, adapter source |
| Can a web page be the ACP client, with no extension in between? | **Yes.** ACP has an Active remote-transport RFD (Streamable HTTP + WebSocket, 2026-07-02), and the TypeScript SDK 2.4.0 already ships it: `experimental/ws-client` (`createWebSocketStream`, defaults to the browser's `WebSocket`) and `experimental/server` (`AcpServer` + Node adapter). Browser ACP clients exist (acp-ui, acp-chat, AgentWebUI), all behind a local relay. | §2.2, SDK source and examples |
| Can the embedded Claude use the page's WebMCP tools? | **Yes.** `session/new` carries `mcpServers`; the adapter advertises `mcpCapabilities: { http: true, sse: true }` and maps them straight into the Agent SDK. The bridge's MCP endpoint from Stage 1 is that server. "MCP over ACP" (the client serving MCP through the ACP connection itself) exists in the SDK as unstable, but the Claude adapter does not advertise it yet. | §2.3 |
| Is a Chrome extension needed? | **No.** The page connects to the local bridge directly. The extension stays useful only for third-party WebMCP sites you do not control (Stage 1's original scope). | §3 |
| Is a local process needed? | **Yes, unavoidably.** Claude Code runs on the user's machine and a browser cannot spawn it. One daemon (the Stage 1 bridge, extended) serves both stages. | §3 |
| Whose Claude account? | **Yours, locally: fine. Other people's subscriptions in a product you ship: not without approval.** The adapter inherits Claude Code's credentials (OAuth login, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, Bedrock/Vertex/Foundry). Anthropic's Agent SDK docs say: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." API keys are the sanctioned route for distribution; Zed is an approved partner. | [F2-1](#F2-1) |

**Does Stage 2 change the Stage 1 picture? Yes, in five ways** (details in §7): the bridge daemon becomes the load-bearing piece and the extension becomes optional; Stage 1's process-model question resolves to "daemon"; the install story shrinks to "run one local daemon" (or nothing extra when your own dev server starts it); the security bar rises because the daemon now exposes Claude Code itself to the browser; and a terms-of-service constraint appears for distributing the embedded chat.

### 1.1 Why not the alternatives

| Alternative | Why not (or when) |
|---|---|
| Bridge uses the Claude Agent SDK directly with a home-made chat protocol over WebSocket | Reinvents what ACP already standardises (streaming chunks, tool-call cards, permission prompts, plans, modes, slash commands, session resume), loses agent-agnosticism (Gemini CLI, Codex, Goose, Copilot CLI speak ACP), and the browser-side client code already exists in the SDK. Keep as fallback only if the adapter blocks something. |
| The web app's own backend embeds the Agent SDK (science-kg's Express server spawns Claude) | Only works where the backend runs on the user's machine (local dev); a hosted backend has no local Claude. Couples the app to Claude. Reasonable as a *dev-mode variant* of the bridge, not as the design. |
| Relay Claude Code's raw headless protocol (`claude -p --input-format stream-json`) to the browser | It is the private wire format under the Agent SDK; no standard client, same policy constraints, no swap-ability. |
| The brief's "Website – chrome extension – ACP – local claude code" | An extension cannot spawn processes either (short of native messaging), so it would be a pure hop between page and bridge. Dropped. |
| Generic browser automation / screenshots | Out per the brief. |

---

## 2. What the pieces actually provide (verified in source, 2026-11-04)

### 2.1 `@agentclientprotocol/claude-agent-acp` 0.100.0

- Runs as a stdio ACP agent (`serve.ts`: `ndJsonStream` over stdin/stdout; `CLAUDE_AGENT_ACP_PROTOCOL=v1|v2|auto`). Uses the installed CLI when `CLAUDE_CODE_EXECUTABLE` points at it; otherwise the SDK's bundled binary.
- `initialize` → `protocolVersion: 1`, `promptCapabilities: { image: true, embeddedContext: true }`, `mcpCapabilities: { http: true, sse: true }`, `loadSession: true`, `auth.logout`, `providers` (client-managed LLM routing), plus `authMethods` (terminal login, optional gateway/Bedrock).
- `session/new` → converts each `mcpServers` entry: `{type:'http'|'sse', name, url, headers[]}` → SDK `{type, url, headers}`; stdio entries → `{type:'stdio', command, args, env}`. System prompt = Claude Code preset; settings read from the session `cwd` (so `.claude/settings.json` and `CLAUDE.md` in the workspace apply).
- Permissions: `canUseTool` is turned into `session/request_permission` with per-tool option sets (`permissions/options.ts`: Bash, Edit, WebFetch, Skill, plan-mode transitions…), kinds `allow_once`, `allow_always` ("allow with updates"), `reject_once`, `reject_always`. Plan mode is tracked; `bypassPermissions` can be removed from a session.
- Auth status is pushed to the client (`_auth/status_update`), distinguishing API-key sources from OAuth login; `/login` errors from the CLI are recognised and surfaced.

### 2.2 `@agentclientprotocol/sdk` 2.4.0

- Stable: `import * as acp from '@agentclientprotocol/sdk'` → `acp.client({name}).onRequest(...).onNotification(...).connectWith(stream, async ctx => …)`, `ctx.request(acp.methods.agent.session.new, …)`, `acp.ndJsonStream(writable, readable)`.
- Experimental exports: `./experimental/ws-client` (`createWebSocketStream(url, { protocols?, headers?, WebSocket?, cookies? })`, one JSON-RPC message per text frame), `./experimental/http-client`, `./experimental/server` (`new AcpServer({ createAgent: () => AgentConnector, …limits })` with `handleRequest(req)` and `prepareWebSocketUpgrade()`), `./experimental/node` (`createNodeHttpHandler`, `createNodeWebSocketUpgradeHandler` for Node `http` + `ws`), `./experimental/mcp-http` (MCP-over-ACP HTTP adapter). Examples: `http-server.ts`, `ws-client.ts`, `mcp-over-acp-*.ts`.
- `AgentConnector = { connect(stream) → { closed?: Promise } }`: the server hands each accepted browser connection a `Stream`; our connector pumps it into a spawned adapter process (§4.2).

### 2.3 ACP v1 surface the chat UI must handle

Client → agent: `initialize`, `session/new {cwd, mcpServers}`, `session/load`, `session/prompt {sessionId, prompt: ContentBlock[]}` (text, image, embedded `resource` since the adapter has `embeddedContext`), `session/cancel`, `session/set_mode`. Agent → client: `session/update` with `agent_message_chunk`, `agent_thought_chunk`, `user_message_chunk` (replay), `tool_call {toolCallId, title, kind, status, content[], locations[], rawInput}`, `tool_call_update`, `plan {entries[]}`, `available_commands_update`, `current_mode_update`, `usage_update`, `notice`, compaction updates; `session/request_permission {toolCall, options[]}` → `{outcome: {outcome:'selected', optionId} | {outcome:'cancelled'}}`; optional `fs/*` and `terminal/*` (a browser client declines these: no `fs`/`terminal` capabilities). Prompt ends with `stopReason` ∈ `end_turn | max_tokens | max_turn_requests | refusal | cancelled`.

### 2.4 The existing science-kg chat (what Stage 2 would sit next to)

`causal-graph-viewer` already has a 5k-line chat subsystem: `useChatSession.ts` wraps Vercel AI SDK `useChat` → `POST /api/chat` (`chatRoute.ts`, `streamText` with `@ai-sdk/anthropic`); `server/agent/serverTools.ts` declares tools, of which only `ask_paper` executes server-side; the rest stream to the browser and `clientToolHandlers.ts` (2.8k lines: `handleSearchSuggestedTriples`, `handleExpandAroundNode`, `handleFindPathsBetween`, `handleProposeAddTriples`, `handleGetFindingDetails`, `handleProposeRemove`, …) runs them against live React state, with proposal cards rendered in the transcript. Two consequences: the browser-executed handlers are already WebMCP-shaped (name + schema + function over page state), so registering them as WebMCP tools is a thin adapter; and the embedded ACP chat can start as a second tab beside the existing API chat rather than replacing it.

---

## 3. Unified architecture

```
┌───────────────── browser (your Chrome; flag optional for your own apps) ─────────────────┐
│  Tab: demo page / science-kg                                                             │
│   page code ── registerTool() ──▶ document.modelContext (native) or connector shim       │
│   connector lib: (a) mirrors tools ──▶ /ws      (b) ACP client ──▶ /acp   (c) <AgentChat> │
│   [optional] extension content script: same mirror code for third-party WebMCP sites     │
└───────────────┬──────────────────────────────┬───────────────────────────────────────────┘
                │ ws://127.0.0.1:8717/ws       │ ws://127.0.0.1:8717/acp   (pure ACP, 1 msg/frame)
┌───────────────▼──────────────────────────────▼───────────────────────────────────────────┐
│  bridge daemon (Node/TS)                                                                 │
│   registry: pages/tabs → tools            AcpServer (SDK): per connection spawn           │
│   MCP  /mcp               ← terminal Claude Code (Stage 1)      claude-agent-acp (stdio)  │
│   MCP  /mcp/by-page/<id>  ← embedded sessions (tools of that page only)        │          │
│   origin allow-list + pairing token; per-origin workspace dir with CLAUDE.md   ▼          │
└──────────────────────────────────────────────────────────────── claude (your login) ─────┘
```

Flows:

1. **Page announces itself** on `/ws` (`hello` → `{ pageId, workspaceDir, mcpUrl }`), then mirrors its WebMCP tools exactly as Stage 1's content script does. This channel is unchanged from Stage 1; only the sender differs (page connector instead of extension).
2. **Chat session**: the page opens `/acp`, the bridge spawns `claude-agent-acp` for that connection and pumps frames both ways untouched. The page calls `session/new { cwd: workspaceDir, mcpServers: [{ type: 'http', name: 'page', url: mcpUrl }] }`. From then on the embedded Claude sees the page's tools as `mcp__page__<tool>` and calls them through bridge → `/ws` → page, the same path terminal Claude uses.
3. **Context per turn**: the page may attach its read-only state (the `get_state` result, or science-kg's `canvasSummary`) as an embedded `resource` block in each `session/prompt`, mirroring what science-kg does today; the model then has both a snapshot and live tools.
4. **Permissions** arrive as `session/request_permission`; the chat UI renders the adapter's option set; "allow always" persists for the session. Page tools marked `readOnlyHint` can be auto-allowed by policy ([Q2-3](#Q2-3)).
5. **Reconnect**: the page keeps `sessionId`; on reconnect it calls `session/load` and the adapter replays history.

Install story: **one local daemon**, no extension, for your own apps. Start it from the app's dev server (`concurrently` in science-kg already runs three processes), or once per machine via launchd / `npx webmcp-bridge`, or through the Claude Code plugin's SessionStart hook. Third-party WebMCP sites with terminal Claude still need the extension; that path is unchanged.

---

## 4. Components

### 4.1 Repository layout (delta on Stage 1's)

```
bridge/src/acp.ts            # AcpServer wiring, per-connection adapter spawn, workspace prep, idle reaping
bridge/src/security.ts       # Origin allow-list, pairing token, per-page MCP scoping
packages/connector/          # browser lib: WebMCP mirror (shared with extension), connectAgent(), modelContext shim
packages/agent-chat/         # React <AgentChat> component (ACP session → UI), framework-agnostic core + React bindings
demo-site/                   # gains an embedded chat panel
extension/                   # unchanged; now optional
```

### 4.2 Bridge: ACP relay (sketch, against SDK 2.4.0 APIs seen in source)

```ts
// bridge/src/acp.ts
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { WebSocketServer } from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import { AcpServer } from '@agentclientprotocol/sdk/experimental/server';
import { createNodeHttpHandler, createNodeWebSocketUpgradeHandler } from '@agentclientprotocol/sdk/experimental/node';

const acpServer = new AcpServer({
  createAgent: () => ({
    connect(clientStream) {                                   // one adapter process per browser connection
      const child = spawn(adapterBin, [], {
        cwd: workspaceDir, stdio: ['pipe', 'pipe', 'inherit'],
        env: { ...process.env, CLAUDE_CODE_EXECUTABLE: claudePath, CLAUDE_AGENT_ACP_PROTOCOL: 'v1' },
      });
      const agentStream = acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);
      pump(clientStream, agentStream);                       // frames ⇄ ndjson lines, both directions
      return { closed: new Promise<void>(res => child.once('exit', () => res())) };
    },
  }),
});
const wss = new WebSocketServer({ noServer: true });
httpServer.on('request', (req, res) => req.url?.startsWith('/acp') ? acpHttp(req, res) : rest(req, res));
httpServer.on('upgrade', (req, sock, head) => {
  if (!originAllowed(req) || !tokenOk(req)) return sock.destroy();
  (req.url?.startsWith('/acp') ? acpUpgrade : toolChannelUpgrade)(req, sock, head);
});
const acpHttp = createNodeHttpHandler(acpServer);
const acpUpgrade = createNodeWebSocketUpgradeHandler(acpServer, wss);
```

Workspace prep: `~/.webmcp-bridge/workspaces/<origin-slug>/` with a generated `CLAUDE.md` ("You are embedded in *<title>* at *<origin>*. The `page` MCP server exposes its tools; prefer them over guessing.") and a `.claude/settings.json` implementing the tool policy from [Q2-3](#Q2-3). Idle adapters are killed after N minutes; sessions survive on disk and come back through `session/load`.

### 4.3 Page connector (sketch)

```ts
// packages/connector/src/agent.ts
import * as acp from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';

export async function connectAgent(bridge: BridgeInfo, ui: ChatSink) {
  const stream = createWebSocketStream(`${bridge.wsBase}/acp`, { protocols: [`webmcp.token.${bridge.token}`] });
  return acp.client({ name: 'page' })
    .onRequest(acp.methods.client.session.requestPermission, ctx => ui.askPermission(ctx.params))
    .onNotification(acp.methods.client.session.update, ctx => ui.applyUpdate(ctx.params))
    .connectWith(stream, async ctx => {
      await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
      const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
        cwd: bridge.workspaceDir,
        mcpServers: [{ type: 'http', name: 'page', url: bridge.mcpUrl }],
      });
      return { sessionId, prompt: (text: string, context?: string) => ctx.request(acp.methods.agent.session.prompt, {
        sessionId, prompt: [{ type: 'text', text }, ...(context ? [{ type: 'resource', resource: { uri: 'page://state', mimeType: 'application/json', text: context } }] : [])],
      }), cancel: () => ctx.notify(acp.methods.agent.session.cancel, { sessionId }) };
    });
}
```

The same package exports the WebMCP mirror used by the extension's content script, and a `document.modelContext` shim (`registerTool/getTools/executeTool/toolchange` only) that installs itself when the native API is absent, so your own apps need neither the Chrome flag nor the extension.

### 4.4 `<AgentChat>` component

Framework-agnostic core (`SessionModel`: turns, messages built from chunks by `messageId`, tool calls keyed by `toolCallId`, plan, pending permission, mode, commands, usage) plus React bindings. MVP renders: streaming markdown, collapsible thoughts, tool-call cards (kind icon, status, `content` text/diff/terminal, raw input on expand), permission prompt with the adapter's options, plan list, mode picker (`session/set_mode`), slash-command menu from `available_commands_update`, cancel, "allow page tools automatically" toggle, and reconnect via `session/load`. Deliberately *not* implementing `fs/*` and `terminal/*` client capabilities (a browser is not an editor).

---

## 5. Work breakdown

| # | Milestone | Deliverable | Done when |
|---|---|---|---|
| M2-0 | **Spike** (first, ≈1 day) | `AcpServer` + spawned `claude-agent-acp` + the SDK `ws-client` from a plain HTML page | A browser page sends "hello", streams the reply, approves one permission, and the adapter authenticates with your existing Claude Code login. Then: `session/new` with the Stage 1 bridge's `/mcp` as an http server → embedded Claude calls `get_state`. Also check `ws://127.0.0.1` from an `https://` page in Chrome ([F2-8](#F2-8)). |
| M2-1 | Bridge: ACP relay | §4.2 incl. origin allow-list, pairing token, per-page MCP endpoints, workspace prep, idle reaping | demo page chats through the bridge; a second origin is refused |
| M2-2 | Connector lib | §4.3 + WebMCP mirror shared with the extension + shim | demo page works with the Chrome flag off and no extension |
| M2-3 | `<AgentChat>` | §4.4 | all ACP update kinds render; permission flow; cancel; resume after reload |
| M2-4 | Demo | colour/sentence page with the chat embedded | "make the background blue" from inside the page → Claude calls the page tool → page updates; call log shows it |
| M2-5 | science-kg integration **plan** (separate) | WebMCP adapter over existing client tools; `<AgentChat>` as a second tab; `canvasSummary` as per-turn resource | plan written, not code |

---

## 6. Acceptance checklist (Stage 2 PoC)

<check id="s2k1" status="todo">`bun run bridge` starts one daemon; `/mcp`, `/ws`, `/acp` all answer on 127.0.0.1:8717.</check>
<check id="s2k2" status="todo">Demo page opened with the Chrome flag OFF and no extension: tools list shows 4 tools (shim active), bridge logs the page.</check>
<check id="s2k3" status="todo">Embedded chat: "hi" streams a reply; auth status shows your login, no API key configured.</check>
<check id="s2k4" status="todo">"What colour is the background?" → embedded Claude calls `mcp__page__get_state`; the call appears as a tool card and in the page's call log.</check>
<check id="s2k5" status="todo">"Make it #0066cc and change the sentence" → page updates; a permission prompt appears only for non-read-only tools when the auto-allow toggle is off.</check>
<check id="s2k6" status="todo">Cancel mid-turn → `stopReason: cancelled`, pending permission closed.</check>
<check id="s2k7" status="todo">Reload the page → chat history returns via `session/load`.</check>
<check id="s2k8" status="todo">A page on a non-allow-listed origin (e.g. a local file:// test page) cannot open `/acp` or `/ws`.</check>
<check id="s2k9" status="todo">Terminal Claude Code (Stage 1 path) still works concurrently against the same daemon.</check>
<check id="s2k10" status="todo">Two tabs → two adapter processes; closing a tab reaps its process after the idle timeout.</check>

---

## 7. What this changes in the Stage 1 plan (proposed revisions, not yet applied)

<user-highlight comment="s2c1">I have not edited the Stage 1 plan</user-highlight>; these are the edits I would make once you confirm, so both plans stay consistent:

1. **[Q-1 (process model)](../stage1-webmcp-bridge/main.md#Q-1) resolves to the daemon.** The ACP host must outlive any terminal session, so the stdio variant is only a convenience mode. Packaging: `npx webmcp-bridge` / launchd, plus the Claude Code plugin whose SessionStart hook ensures the daemon is up.
2. **New Q-0 "ingress path"**: page connector first, extension optional. Stage 1's milestone M2 (extension) moves after the connector; the content-script code is literally the connector's mirror module running in the isolated world.
3. **[Q-4 (polyfill)](../stage1-webmcp-bridge/main.md#Q-4)**: the connector ships a `document.modelContext` shim, so the Chrome flag becomes optional for your own apps (native API still preferred when present).
4. **[Q-2 (tool exposure)](../stage1-webmcp-bridge/main.md#Q-2)**: add per-page scoped MCP endpoints (`/mcp/by-page/<id>`) beside the terminal-facing selected-tab endpoint.
5. **[F-4 (security)](../stage1-webmcp-bridge/main.md#F-4) becomes p1**: origin allow-list and pairing token from day one, because the same daemon will expose Claude Code itself.
6. **Demo site**: the same page gains the embedded chat in Stage 2; Stage 1 keeps it chat-less.
7. **"Reusable infrastructure" becomes explicit**: `webmcp-bridge` (daemon), `webmcp-connector` (page lib), `agent-chat` (React), `webmcp-extension` (optional), plus the plugin packaging for the terminal path.

<comment id="s2c1" status="open" kind="question">
  <note by="agent" at="2026-11-04T13:10">Do you want these folded into the Stage 1 plan now (I would add Q-0, update Q-1/Q-2/Q-4/F-4, and reorder milestones), or keep Stage 1 as the "extension-first" variant and let Q2-1 below decide?</note>
</comment>

---

## 8. Open questions

<open-question id="Q2-1" title="Unify now or later?" status="answered">
Stage 2 wants one daemon with three faces (§3). Build it that way from the start, or finish Stage 1 as specced (extension + bridge) and bolt ACP on afterwards?

<options select="single">
  <option id="unify-now">**Unify now** (recommended): revise the Stage 1 plan per §7, build the daemon once with `/mcp`, `/ws`, `/acp`; the extension becomes an optional milestone. Less rework, and the security model is designed once.
  </option>
  <option id="stage1-first">**Finish Stage 1 as specced first**, then extend. Keeps the original exploration ("can an extension do it") intact; costs a refactor of the bridge's connection model later.
  </option>
</options>

<answer by="user" at="2026-11-04T20:57" chose="unify-now">

</answer>
</open-question>

<open-question id="Q2-2" title="How the page reaches the bridge" status="open">
<options select="single">
  <option id="connector-first">**Page connector first, extension optional** (recommended). Your apps embed `webmcp-connector`; third-party WebMCP sites need the extension; the mirror code is shared.</option>
  <option id="extension-only">**Extension only**, pages never talk to the bridge directly. Simplest security story (only the extension can connect) but every user installs the extension, and Stage 2's ACP traffic has to hop through it.</option>
  <option id="connector-only">**Connector only**, drop the extension entirely. Smallest project; gives up third-party sites.</option>
</options>
</open-question>

<open-question id="Q2-3" title="What the embedded Claude is allowed to do" status="open">
Besides the page's MCP tools, Claude Code brings Read/Write/Edit/Bash/WebSearch/WebFetch. The workspace's `.claude/settings.json` (read by the adapter from `cwd`) sets the policy.

<options select="single">
  <option id="page-tools-plus-web">**Page tools + WebSearch/WebFetch; no file or shell tools** (recommended for end users). Read-only page tools auto-allowed; consequential page tools prompt once per session.</option>
  <option id="scratch-workspace">**Full Claude Code in a per-origin scratch workspace**, every non-read tool prompts. Lets Claude write notes/exports to disk; more permission noise.</option>
  <option id="developer-mode">**Full Claude Code in the app's own repo** (developer toggle). Claude edits science-kg while you use it, with the page's live state as context. Fun and risky; worth a toggle, not a default.</option>
</options>
</open-question>

<open-question id="Q2-4" title="Chat UI strategy" status="open">
<options select="single">
  <option id="reusable-react">**Reusable `<AgentChat>` React component** (recommended): framework-agnostic session model + React bindings; used by the demo first, then dropped into science-kg as a second tab beside the existing API chat.</option>
  <option id="adapt-existing">**Adapt science-kg's ChatPanel** by writing an ACP transport that emits its `UIMessage` parts. Keeps one chat UI in science-kg, but ties the reusable piece to the Vercel AI SDK message model and science-kg's 5k-line stack.</option>
  <option id="reuse-acp-ui">**Reuse acp-ui** (Vue, MIT) as-is in an iframe. Fastest demo; not reusable inside React apps, and its web build expects its own relay conventions.</option>
</options>
</open-question>

<open-question id="Q2-5" title="Whose credentials, and for whom" status="open">
Anthropic's Agent SDK docs prohibit offering claude.ai login or subscription rate limits in third-party products without approval. This affects science-kg if the embedded chat ships to other scientists.

<options select="single">
  <option id="personal-now">**Personal/dev use now** (recommended): your own Claude Code login on your machine; design nothing for distribution yet, but keep the bridge's auth pluggable (`ANTHROPIC_API_KEY` env → the adapter already honours it).</option>
  <option id="api-key-first">**Design for API-key users from the start**: the bridge takes a key (or the adapter's gateway `authenticate`), the page shows which auth is active, docs tell users to use an API key. More work now; compliant for distribution.</option>
</options>
</open-question>

<open-question id="Q2-6" title="ACP protocol version" status="open">
<options select="single">
  <option id="v1">**v1 stable** (recommended): everything the PoC needs; `CLAUDE_AGENT_ACP_PROTOCOL=v1`.</option>
  <option id="v2">**v2 experimental**: resume with replay, fork, config options, structured plans; both SDK and adapter mark it unstable.</option>
</options>
</open-question>

<open-question id="Q2-7" title="Extras" status="open">
<options select="multi">
  <option id="per-turn-context">Attach the page's read-only snapshot as an embedded `resource` block on every prompt (science-kg's `canvasSummary` pattern).</option>
  <option id="generated-claude-md">Generate a per-origin `CLAUDE.md` in the workspace describing the page and its tools.</option>
  <option id="mcp-over-acp">Track MCP-over-ACP in the adapter; switch to it when `mcpCapabilities.acp` appears (removes the per-page HTTP MCP endpoints).</option>
  <option id="agent-picker">Agent picker: the bridge can spawn any ACP agent (Gemini CLI, Codex, Goose) with the same page tools, for comparison.</option>
  <option id="plugin-packaging">Package bridge + skill as a Claude Code plugin (SessionStart hook ensures the daemon; `.mcp.json` points terminal Claude at it).</option>
</options>
</open-question>

---

## 9. Decisions (proposed)

<decision id="D2-1" title="Use ACP (Agent Client Protocol) v1 through claude-agent-acp, not the Agent SDK directly" status="proposed" date="2026-11-04">
The bridge is an ACP relay; the browser is a real ACP client via the SDK's WebSocket stream.
<rationale>Standard message model for streaming, tool calls, permissions, plans, modes, resume; existing browser clients prove the pattern; agent-agnostic for free. The adapter is Anthropic-sanctioned for Zed and open source.</rationale>
</decision>

<decision id="D2-2" title="One local daemon serves both stages" status="proposed" date="2026-11-04">
`/mcp` (terminal Claude), `/ws` (tool providers: page connector or extension), `/acp` (embedded chat). The daemon is the reusable infrastructure; everything else plugs into it.
<rationale>A local process is unavoidable for Stage 2; sharing it with Stage 1 removes the "extension and a bridge" double install for your own apps.</rationale>
</decision>

<decision id="D2-3" title="The bridge relays ACP untouched; page-specific wiring happens client-side" status="proposed" date="2026-11-04">
No message rewriting in the relay. The page learns `workspaceDir` and `mcpUrl` from the `/ws` hello and passes them in `session/new` itself.
<rationale>Keeps the relay trivially correct and version-agnostic; the SDK's `AcpServer` already handles connection and session routing.</rationale>
</decision>

<decision id="D2-4" title="Page tools reach the embedded agent through a per-page HTTP MCP endpoint" status="proposed" date="2026-11-04">
`/mcp/by-page/<id>` exposes only that page's tools, passed as `{type:'http'}` in `session/new`. Revisit when the adapter supports MCP-over-ACP.
</decision>

<decision id="D2-5" title="Browser client declares no fs/terminal capabilities" status="proposed" date="2026-11-04">
The page is not an editor; file and terminal requests are declined. Claude Code's own file tools still work inside the workspace policy of [Q2-3](#Q2-3).
</decision>

---

## 10. Risks and hacks (findings)

<finding id="F2-1" title="Subscription login cannot be offered to other users without Anthropic approval" severity="p1" status="open" effort="design">
Agent SDK docs: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Your own machine with your own login is your own tooling; shipping science-kg-with-embedded-chat to other scientists on their subscriptions is not. API keys (the adapter honours `ANTHROPIC_API_KEY`, `apiKeyHelper`, gateway auth) are the sanctioned path. Terminal Claude Code driving the page via MCP (Stage 1) has no such issue: each user runs their own Claude Code. See [Q2-5](#Q2-5).
</finding>

<finding id="F2-2" title="A local ACP endpoint hands Claude Code to whatever can reach it" severity="p1" status="open" effort="small">
Any web page can open `ws://127.0.0.1:8717/acp` (browsers do not block loopback WebSockets), and through it run Claude Code with your credentials and, depending on [Q2-3](#Q2-3), your filesystem. Mitigations in M2-1: check the WebSocket `Origin` header against an allow-list (browser-enforced, unforgeable from page JS), require a pairing token passed as a WebSocket subprotocol (browsers cannot set headers; acp-ui uses the same trick), bind to 127.0.0.1 only, least-privilege workspace policy, and log every session start with its origin.
</finding>

<finding id="F2-3" title="Remote transport is experimental in the SDK" severity="p2" status="open" effort="small">
`experimental/server`, `experimental/ws-client`, `experimental/node` may change incompatibly in any SDK release (their own warning); the RFD is Active, not final; Goose's reference implementation is in progress. Pin `@agentclientprotocol/sdk` and `claude-agent-acp` versions; keep the relay thin so a transport change is a local fix.
</finding>

<finding id="F2-4" title="One claude process per browser connection" severity="p2" status="open" effort="small">
Each adapter spawns the Claude Code binary. Fine for a few tabs; reap idle processes, cap concurrent sessions, and rely on `session/load` to resume after reaping.
</finding>

<finding id="F2-5" title="Permission prompts become in-page modals" severity="p2" status="open" effort="medium">
Claude Code asks before many tool uses; long tasks can flood the chat with prompts. The adapter's `allow_always` ("allow with updates") persists per session; the UI needs a visible policy toggle and a queue, not a stack of modals.
</finding>

<finding id="F2-6" title="The adapter reads settings and CLAUDE.md from the session cwd" severity="p3" status="open" effort="small">
If `cwd` were the user's home or an unrelated repo, that project's settings, hooks, and CLAUDE.md would apply to the embedded chat. The bridge prepares a dedicated per-origin workspace with explicit settings ([Q2-3](#Q2-3), [Q2-7](#Q2-7)).
</finding>

<finding id="F2-7" title="Fast-moving dependencies" severity="p3" status="open" effort="small">
`claude-agent-acp` is at 0.100.0 and was renamed from `@zed-industries/claude-code-acp` this year; ACP v2 is a draft; `document.modelContext` is in an origin trial. Record exact versions in the plan's acceptance runs; expect to bump deliberately.
</finding>

<finding id="F2-8" title="Loopback WebSocket from an https page: verify, don't assume" severity="p2" status="open" effort="small">
Chrome treats `127.0.0.1`/`localhost` as potentially trustworthy, so `ws://127.0.0.1` from an `https://` page should not count as mixed content; acp-ui's README warns about `ws://` from hosted pages for non-loopback hosts. The deployed science-kg is https. M2-0 checks Chrome explicitly; Safari and Firefox behaviour is noted, not promised.
</finding>

---

## 11. Out of scope

- science-kg integration itself (gets its own plan after the PoC; §2.4 records what we already know).
- Editor-grade features: file diffs applied to a repo from the page, terminals in the page, multi-agent orchestration.
- Distribution/packaging beyond the plugin note in [Q2-7](#Q2-7).
