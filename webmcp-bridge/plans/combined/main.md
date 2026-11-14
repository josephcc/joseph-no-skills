**Status:** implemented (PoC verified 2026-11-05); review results in §14
**Date:** 2026-11-04
**Update 2026-11-05 (rev 6, threads + auto mode):** the embedded chat gained threads (list, switch, delete over one ACP connection) and an auto-mode default in a separate plan, [threads-and-auto-mode](../threads-and-auto-mode/main.md); its D-33/D-37 supersede the every-non-read-tool-prompts *default* of [D-24](#D-24) for new threads (the rest of D-24 stands).
**Update 2026-11-05 (rev 5.1, menu bar icon):** the menu bar item now shows the icon as a template image instead of an SF Symbol ([D-30](#D-30)); the helper protocol gained `image`/`template`; a pink non-template version and the menu bar's drop shadow were tried and dropped.
**Update 2026-11-05 (rev 5, setup flow + menu bar):** [D-29](#D-29) streamlined setup (browser chat is the primary surface; terminal is a one-time installer; plugin option to keep terminal sessions clean; one state dir `~/.webmcp-daemon`); [D-30](#D-30) "webmcp-bridge" menu bar item owned by the daemon and shipped in the plugin; chat panel setup-flow empty state; demo chat as a left sidebar; findings [F-17](#F-17)–[F-18](#F-18).
**Update 2026-11-05 (rev 4.1, gaps closed):** approval page verified in a real browser (c2 now earned), cancel mid-turn (c13), agent picker end to end with a fake ACP agent (c28), publishable package build with type declarations, LICENSE, marketplace manifest (validated), fresh-checkout script, hook refresh of the login-item copy, slash-command menu and auto-allow toggle in the chat UI. Remaining by design: real login-item registration (c27) and the Local Network Access prompt (F-16).
**Update 2026-11-05 (rev 4, implementation):** M0–M6 built and verified; results, final names and new findings in §14; checks ticked where a scripted or real-Claude run proved them.
**Update 2026-11-05 (rev 3):** review pass on the user's answers: Q-2, Q-3, Q-5, Q-7, Q-9, Q-10 converted to decisions [D-23](#D-23)–[D-28](#D-28); consequences of "replace the preset" and "full Claude Code in a scratch workspace" propagated into §5.6, §6, M2/M5/M6 and the checklist; launchd consent and fallback added to [D-16](#D-16); measured science-kg prompt sizes recorded in [F-10](#F-10); "resource" glossary line added to §6. Status set to ready-to-implement, awaiting the user's go.
**Update 2026-11-04 (rev 2.3):** Q-7 options rewritten as plain descriptions with suggested picks.
**Update 2026-11-04 (rev 2.2):** science-kg is not modified in this project ([D-22](#D-22)); the chat UI ships inside the npm package as `webmcp-connector/react`, borrowing science-kg components by copy ([D-21](#D-21)); Q-4 and Q-6 converted to decisions; M7 moved to future work.
**Update 2026-11-04 (rev 2.1):** steering and UI-state requirements confirmed by the user and locked ([D-17](#D-17), [D-18](#D-18)); "meta-tools" defined in §5.2.
**Update 2026-11-04 (rev 2):** scope fixed to three deliverables (npm package, demo page, Claude Code plugin with the daemon); extension moved to future work; added the startup walkthrough, the cross-origin facts, and §6 on behaviour steering and UI state, answering the two questions in the brief.
**Scope:** One plan for both exploration stages on one shared local daemon: terminal Claude Code operating a web page through the page's WebMCP tools (Stage 1), and a local Claude Code chat embedded inside the page through ACP (Stage 2). Supersedes the two stage plans for review; they stay as the investigation record.
**Inputs:** [plans/main.md](../main.md) · [Stage 1 plan](../stage1-webmcp-bridge/main.md) · [Stage 2 plan](../stage2-acp-embed/main.md) · [spike 2026-11-04](../../spikes/2026-11-04-webmcp-isolated-world/README.md) · source of `@agentclientprotocol/sdk` 2.4.0 and `claude-agent-acp` 0.100.0 (scratch clones at `/tmp/acp-src/`) · Claude Code hooks, plugins and MCP docs · `causal-graph-viewer` chat code
**Related plans:** [Project goals and plan index](../main.md) · [Stage 1](../stage1-webmcp-bridge/main.md) · [Stage 2](../stage2-acp-embed/main.md)

---

# Combined plan — WebMCP ⇄ local daemon ⇄ Claude Code (Stages 1 + 2)

> **Reading this on GitHub?** This plan is written in the interactive-plan format, a markdown dialect with tags for questions, decisions, findings and checklists. GitHub drops the tags, so the titles, statuses, severities, dates and chosen answers are missing here, and what remains reads as loose prose. Open the raw file to see them, or ask Joseph for a PDF export of the full plan.

## 0. Brief (verbatim)

From [plans/main.md](../main.md), the goal and both stages as written:

> # Goal
>
> This is an exploration project, the goal is to connect web applications with a local Claude code using a combination of - The WebMCP protocol, a custom chrome extension, and local Claude.
>
> The idea is that the website will implement tools and context management using the WebMCP protocol. This protocol is originally designed so that in-browser LLM agents can interact with the webpage, via tools that are executed within the browser. For example, pushing a button on the webpage for the user.
>
> We do not care about in-browser LLM agents, we want a local claude (or other coding agents) to be interacting with this webpage that lives inside the browser.
>
> The trick we are trying to explore is a custom google chrome extension, that [A] discover the tools and context implemented via the WebMCP protocol, and [B] start its own MCP server on a local port in which a coding agent in a terminal can connect to to 'see' and 'operate' the webpage inside the browser.
>
> An example of an interactive webpage would be the science-kg project (/Users/josephc/git/s2/science-kg/causal-graph-viewer).
>
> ## Stage 1
> - Study the WebMCP protocol, and figure out whether a chrome extension can discover them.
> - Figure out whether a chrome extension can start a local mcp server that allows Claude code to connect to it.
> - A proof-of-concept implementation where claude can see a context from a webmcp website (e.g., the current random color of the background and a sentence), and change the website via webmcp (e.g., change the background color and text)
> - Architecture: Website - WebMCP - chrome extension - MCP - local claude code
>
> ## Stage 2
> - Study ACP (agent context protocol), can we embed claude code chat **inside** the website?
> - Architecture: Website - chrome extension - ACP - local claude code

Chat messages, 2026-11-04, in order:

> Review [@main.md](../main.md) carefully, investigate and create an implementation plan for stage 1, pause and let me review.

> Playwright MCP / chrome devtools is definitely out of the picture. I don't want claude doing screenshots because its expensive and slow.
>
> Why don't we keep this open. The goal is both science-kg and hopefully some reusable infrastructure. But it is a little bit of an annoyance to have users install a chrome extension and then a bdige.
>
> Before we commit, why don't we continue to plan out stage 2 in [@main.md](../main.md) and see if that changes the picture.

> can you make a combined plan so i can review them together and holistically

> ok, so if i want this to be generalizable, i can [A] ship the daemon in a claude code plugin / skill combo; and [B] implement the tools in WebMCP standard (but no system prompt no context steering???); and [C] a tiny npm package that looks for the daemon that's managed by claude code with the plugin, is this correct

> this plan is good, update the plan file with relevant decisions. The thing to ship are three:
>
> - A npm package for web developers
> - A demo webpage that imports the above npm, and implements a small set of WebMCPs
> - The Claude plugin that ships and runs the daemon
>
>
> My open questions:
>
> 1. How does behavior steering work from the webMCP site, when i build the agent within the web app, i have a very long system prompt, how would that fit in this setup?
> 2. In the long system prompt, i also include description of the UI state, eg what the user is looking at, deterministically, i guess in this setup this needs to be a read only tool that we ask claude to call often? something like, always check the UI state with this tool before you respond. But is there a better way to do this

> That is great new, update the plan with these two requirements if needed.
>
> Explain what 'meta-tools' mean in the plan

> We're not modifying science-kg yet, again, we're shipping the three things i've mentioned:
>
> - A npm package for web developers
> - A demo webpage that imports the above npm, and implements a small set of WebMCPs
> - The Claude plugin that ships and runs the daemon
>
>
> I guess you should reuse react component on the Chat UI from science-kg when beneficial. But we're not changing science-kg at this stage.
>
> Question: Should the chat UI also ship with the npm package? I think so, right?

> The `webmcp-bridge install-launchd` question, this is still managed by the claude plugin right? and fall back to per session trigger if the user did not allow it? i assume this needs user permission

> Ok ive answer all the questions, review and revise the plan if needed, let me know if this is ready to implment (without actually starting without my say so)

Context from the same thread (my paraphrase, not the user's words): "MV3" was explained (Manifest V3, the current Chrome extension platform); a Chrome App hosting the server was dropped as deprecated; the questions "do we still need WebMCP and an extension", "how do tools reach the daemon without an extension", "cross-origin restrictions on 127.0.0.1", "does ACP need an extension", and "how does the daemon get started" were answered in chat and are folded into §2.2–§2.4.

---

## 1. Summary

### 1.1 What ships

| Deliverable | Contents | Who uses it |
|---|---|---|
| **`webmcp-connector`** (npm, name placeholder) | tiny framework-free core: finds the daemon, mirrors the page's WebMCP tools, carries instructions and a UI-state snapshot function, `connectAgent()` for the embedded chat; `webmcp-connector/react` subpath: the `<AgentChat>` component | web developers |
| **Demo page** | Vite vanilla-ts page importing the package; four WebMCP tools (colour + sentence), live tool list, call log, bonus tool, chat panel | you, and the plugin's smoke test |
| **`webmcp-bridge` Claude Code plugin** (name placeholder) | the daemon as one bundled JS file; hooks (SessionStart ensures the daemon and injects page instructions, UserPromptSubmit injects the UI-state snapshot); `.mcp.json` pointing terminal Claude at the daemon; a skill teaching Claude how to use page tools | anyone with Claude Code |

The daemon's macOS menu bar item "webmcp-bridge" ships inside the plugin ([D-30](#D-30)). Not shipped: the Chrome extension (future work, §13), browser automation, screenshots, a separate menu bar app. **science-kg is not modified in this project**; its chat components may be copied into the package where they help ([D-21](#D-21)), and its integration is a later, separate plan ([D-22](#D-22)).

### 1.2 Verdicts

| Question from the brief | Verdict | Evidence |
|---|---|---|
| Can a Chrome extension discover WebMCP tools? | **Yes** (content script in the isolated world). Verified, then **dropped from scope** because every page that embeds the npm package can do the same thing itself. | §3.2 |
| Can a Chrome extension start a local MCP server for Claude Code? | **No.** MV3 extensions cannot listen on a port. A local daemon owns the port; pages connect out to it. | §3.3 |
| Stage 1 PoC (Claude sees page state, changes colour and sentence) | **Feasible; the spike already did the page half.** | §3.2 |
| Can Claude Code chat be embedded inside the website? | **Yes, over ACP = Agent Client Protocol** (Zed's protocol, not "agent context protocol"). Official adapter `claude-agent-acp` 0.100.0; the ACP TypeScript SDK ships the browser WebSocket client and the server side. | §3.5 |
| Can the embedded Claude use the page's WebMCP tools? | **Yes.** `session/new` takes HTTP MCP servers; the daemon's per-page MCP endpoint is that server. | §3.5 |
| Can the page steer behaviour (system prompt) and supply UI state? | **Yes, deterministically on both paths**, through channels outside the WebMCP standard: per-session system prompt and tool policy on the embedded path; plugin hooks on the terminal path. | §6 |
| Is a local process needed? | **Yes, unavoidably.** One daemon serves both stages; the plugin starts it. | §2.4 |
| Whose Claude account? | **Yours, locally: fine.** Offering other people's claude.ai subscriptions inside a product you ship needs Anthropic approval; API keys are the sanctioned route. Terminal Claude driving the page over MCP has no such issue. | [F2-1](#F2-1) |

### 1.3 What changed from the original idea

- **The daemon, not the extension, is the load-bearing piece.** Both of the brief's architectures become *Website – WebMCP tools – local daemon – {MCP → terminal Claude Code | ACP → embedded Claude Code}*.
- **WebMCP stays as the page-side contract**: registering tools once through `document.modelContext` costs nothing extra, in-browser agents (Gemini in Chrome, Edge Copilot) get the same tools for free, and a small shim covers browsers without the native API, so pages need neither the Chrome flag nor an extension.
- **WebMCP is tools-only**; behaviour steering and UI state travel through the connector and the plugin, not the standard (§6).
- **Two serious constraints came with Stage 2**: the daemon exposes Claude Code itself to the browser, so origin approval is mandatory from day one ([F-4](#F-4)); and the subscription-login restriction for distributed products ([F2-1](#F2-1)).

---

## 2. Target architecture

```
┌──────────────────────────── browser ───────────────────────────────────────────┐
│  Tab: demo page / science-kg (imports webmcp-connector)                        │
│   app code ── registerTool() ──▶ document.modelContext (native) or connector shim
│   connector: mirror tools + instructions + context() ──▶ /ws                   │
│              ACP client ──▶ /acp        <AgentChat> (webmcp-connector/react)   │
└──────────────┬──────────────────────────────┬──────────────────────────────────┘
               │ ws://127.0.0.1:8717/ws        │ ws://127.0.0.1:8717/acp (pure ACP)
┌──────────────▼──────────────────────────────▼──────────────────────────────────┐
│  webmcp-bridge daemon (Node, started detached by the plugin's SessionStart hook)│
│   registry: page → tools, instructions, cached context snapshot                 │
│   MCP  /mcp               ◀── terminal Claude Code (.mcp.json from the plugin)   │
│   MCP  /mcp/by-page/<id>  ◀── embedded sessions           AcpServer: per page   │
│   GET  /state, /instructions ◀── plugin hooks (curl)       spawn claude-agent-acp│
│   GET  /approve?origin=…  (first-contact approval page)            │            │
└────────────────────────────────────────────────────────────────────▼───────────┘
                                                                claude (your login)
```

### 2.1 Flows

1. **Tools in.** The page's connector opens `/ws`, says `hello` (origin, title, instructions), receives `{ pageId, workspaceDir, mcpUrl }`, and mirrors the page's tools on load and on every `toolchange`. Tool calls come back down the same socket and run through `executeTool()` in the page. The daemon can also ask the page for its current UI-state snapshot (`context/request`).
2. **Terminal Claude.** The plugin's `.mcp.json` points Claude Code at `/mcp`: static meta-tools (the daemon's own fixed tools for finding and calling page tools, defined in §5.2) plus the selected page's tools mirrored by name. The plugin's hooks inject the page's instructions at session start and its UI-state snapshot on every prompt (§6.3).
3. **Embedded chat.** The page opens `/acp`; the daemon spawns one `claude-agent-acp` process for that connection and relays ACP frames untouched. The page's `session/new` carries its workspace, its MCP URL, its system prompt and its tool policy (§6.2). The embedded Claude calls page tools through the same `/ws` path as terminal Claude.
4. **Reconnect.** Pages keep their `sessionId`; `session/load` replays history after a reload. Idle adapter processes are reaped; sessions live on disk.

### 2.2 How tools reach the daemon without an extension

`document.modelContext` is a registry that exists only inside the page's own tab; the browser forwards it nowhere. Some code in that tab has to read it and send it over a socket. An extension content script can do that from outside; the npm package does it from inside, with the same two calls (`getTools()`, `executeTool()`) and `new WebSocket("ws://127.0.0.1:8717/ws")`, which any page may open. WebMCP is the registration format, never the transport. Keeping the standard still buys compatibility with in-browser agents and DevTools and avoids inventing a tool format; the cost is that the page must know the daemon's port, which is fine for pages that import the package and impossible for third-party sites (hence the future extension, §13).

### 2.3 Cross-origin facts for `127.0.0.1` (verified against Chrome's docs)

| Rule | Effect on this design |
|---|---|
| CORS | Does not apply to WebSockets. The browser sends `Origin` and lets the handshake proceed; the daemon must check it itself (§5.5). Had we used the ACP HTTP transport from the page, CORS would apply; we use WebSocket for `/ws` and `/acp`. |
| Mixed content | An `https://` page may open `ws://127.0.0.1`: loopback is a potentially trustworthy origin in Chrome. Safari has been stricter; verified in the spike. |
| Local Network Access (Chrome ≥138 behind a flag, shipping since 139–142) | A **public** site connecting to loopback triggers a one-time per-site permission prompt; Chrome's current guide says WebSocket URLs to loopback are gated. Pages served from `localhost` are in the same address space and see no prompt. The page must be https; a public http page gets no access. The connector therefore connects behind a visible user action and handles denial. |

### 2.4 Startup, step by step (the plugin route)

1. One-time: `claude plugin marketplace add <repo>` and `claude plugin install webmcp-bridge@<marketplace>`.
2. Every `claude` start fires `SessionStart`; the plugin's hook runs `scripts/ensure-daemon.sh`: if `http://127.0.0.1:8717/health` answers, exit; otherwise launch the bundled daemon detached (`setsid`/`nohup`, log under `${CLAUDE_PLUGIN_DATA}`), wait for health, exit. The same hook prints the connected page's instructions (§6.3).
3. Claude Code reads the plugin's `.mcp.json` and connects to `/mcp`. Whether this races the hook is verified in M2; HTTP first-connection retries and `/mcp reconnect` are the fallbacks.
4. The daemon now outlives the session. Later `claude` sessions find it running; the hook can also register a launchd agent once so it starts at login.
5. A page loads any time after step 2: tools register, the connector connects to `/ws`. If nothing listens, the connection is refused instantly; the connector retries every few seconds and the page shows "start Claude Code once, or run `npx webmcp-bridge`".
6. First contact from a new origin: the daemon opens its approval page in your browser; you allow or deny; the decision is stored.
7. For the chat, the user clicks "connect to local Claude" in the page; the connector opens `/acp`; the daemon spawns the adapter with your existing login.

A page can never start the daemon; the ways to have it running are the hook (any `claude` start), the launchd agent, `npx webmcp-bridge` by hand, or your own dev server (science-kg's `concurrently` can simply add it).

---

## 3. Evidence in brief

Full detail lives in the two stage plans; this section keeps only what the design depends on.

### 3.1 WebMCP today (verified 2026-11-04)

- API: `document.modelContext.registerTool({ name, description, inputSchema, execute, annotations }, { exposedTo?, signal? })`, `getTools({ fromOrigins? })`, `executeTool(tool, args, { signal? })`, events `toolchange` / `toolactivated` / `toolcancel`. Unregister by aborting the signal. **Tools only**: no resources, prompts, instructions, or context primitive.
- Stale in blog posts and the MCP-B polyfill: `navigator.modelContext` (deprecated Chrome 150, absent in 156), `provideContext` / `clearContext` (removed), `unregisterTool`.
- `executeTool` resolves with the **stringified** result, `null` if the tool navigated; JSON-string arguments deprecated since Chrome 155. `[SecureContext]`: `https://` or `http://localhost` only.
- Chrome: dev trial since 146, origin trial 149 → 156 extended to 162, flag `chrome://flags/#enable-webmcp-testing`, switch `--enable-features=WebMCP`. Your Chrome 156.0.8078.81 has it; your profile's flag is off (the shim makes that irrelevant for pages using the package). DevTools → Application → WebMCP pane lists and runs tools.

### 3.2 Spike on this machine ([README](../../spikes/2026-11-04-webmcp-isolated-world/README.md))

| Probe (CDP isolated world = content script) | Result |
|---|---|
| `typeof document.modelContext` | `object`; page globals invisible, so the registry is browser-owned |
| `getTools()` | the page's 3 tools with `inputSchema` objects, `annotations`, `origin`, `window` |
| `executeTool(set_background_color, {color:'teal'})` | string `{"ok":true,"backgroundColor":"teal"}`; DOM changed |
| `executeTool(get_state, {})` | string `{"backgroundColor":"teal","sentence":"…"}` |
| `toolchange` listener | fired when the page registered a 4th tool |

### 3.3 Chrome platform facts

- MV3 = Manifest V3: background code is a service worker killed after 30 s idle; no extension generation ever had server sockets; Chrome Apps (which had `chrome.sockets`) are gone. `--load-extension` no longer works in branded Chrome. (Relevant only to the future extension.)
- Loopback and permissions: §2.3.

### 3.4 Claude Code (terminal) facts, version 2.1.318

- Transports `stdio` / `http` (recommended) / `sse`; project or plugin `.mcp.json` `{"mcpServers": {"webmcp": {"type": "http", "url": "…"}}}`; tool names `mcp__webmcp__<tool>` with `[^A-Za-z0-9_-]` → `_`.
- Docs say interactive sessions refresh tools on `notifications/tools/list_changed`; a closed regression report over HTTP (anthropics/claude-code#78208) says otherwise → test, don't assume ([F-2](#F-2)). Hence static meta-tools as the guaranteed path.
- **Hooks**: shell commands run on lifecycle events. For `SessionStart` and `UserPromptSubmit`, plain stdout (or JSON `hookSpecificOutput.additionalContext`) is **added to Claude's context**, capped at 10,000 characters (longer output is saved to a file and replaced by a path plus a 2,000-character preview). `SessionStart` runs on startup, resume, clear, compact and fork, before MCP servers are available; `UserPromptSubmit` has a 30 s default timeout and can also block a prompt; `PostToolUse` supports `additionalContext` next to the tool result. Hooks for one event run in parallel.
- **MCP `instructions`** (server hint at `initialize`): delivered to Claude Code as a first-turn reminder and, per a third-party test, truncated around 2,048 characters → a pointer, not a system prompt. MCP **prompts** appear as slash commands; **resources** as `@server:` mentions.
- **Plugins** bundle MCP servers, hooks (`hooks/hooks.json`), skills, and scripts; `${CLAUDE_PLUGIN_ROOT}` moves on update, `${CLAUDE_PLUGIN_DATA}` persists; `claude --plugin-dir ./plugin` for local use; marketplaces are git repos.
- MCP TypeScript SDK 1.32.2: low-level `Server` with raw JSON Schema, `StreamableHTTPServerTransport` with sessions, `sendToolListChanged()`.

### 3.5 ACP, the Claude adapter, and the SDK (verified in source)

- **ACP v1** (stable; v2 draft): JSON-RPC 2.0. Client → agent: `initialize`, `session/new {cwd, mcpServers, _meta}`, `session/load`, `session/prompt {ContentBlock[]}`, `session/cancel`, `session/set_mode`. Agent → client: `session/update` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call {toolCallId,title,kind,status,content[],locations[],rawInput}`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `usage_update`, `notice`, compaction), `session/request_permission {toolCall, options[{optionId,name,kind}]}` → `{outcome: selected|cancelled}`, optional `fs/*`, `terminal/*`. `stopReason` ∈ `end_turn | max_tokens | max_turn_requests | refusal | cancelled`. `_meta` is the sanctioned extension slot.
- **Remote transport**: RFD "Streamable HTTP & WebSocket" Active since 2026-07-02; one JSON-RPC message per WebSocket text frame.
- **`@agentclientprotocol/sdk` 2.4.0**: stable `client({name}).onRequest().onNotification().connectWith(stream, …)`, `ndJsonStream`; experimental exports `./experimental/ws-client` (`createWebSocketStream`, defaults to the browser `WebSocket`), `./experimental/server` (`AcpServer({ createAgent })`), `./experimental/node` (`createNodeHttpHandler`, `createNodeWebSocketUpgradeHandler`), `./experimental/mcp-http`. Examples `http-server.ts`, `ws-client.ts`, `mcp-over-acp-*.ts`.
- **`@agentclientprotocol/claude-agent-acp` 0.100.0**: stdio agent on the Claude Agent SDK 0.3.316; uses the installed CLI via `CLAUDE_CODE_EXECUTABLE`. `initialize` advertises `promptCapabilities {image, embeddedContext}`, `mcpCapabilities {http, sse}`, `loadSession`. `session/new` maps `{type:'http'|'sse'}` and stdio MCP servers into the SDK; reads settings and `CLAUDE.md` from `cwd` (`settingSources: user, project, local`); **system prompt**: `_meta.systemPrompt` as a string replaces Claude Code's preset, as an object it is forwarded as preset options (`append`, `excludeDynamicSections`, …) with the preset locked; a spec-level `systemPrompt` on `session/new` (newer drafts) takes precedence; the JetBrains AIR `_meta.air.customInstructions` appends. **Per-session Claude options**: `_meta.claudeCode.options` forwards Agent SDK `Options` such as `disallowedTools` (merged), `tools`, `hooks`, `mcpServers`, `effort`, `allowDangerouslySkipPermissions: false`; `cwd`, `permissionMode`, `canUseTool` are ACP-managed. Permission options per tool with kinds `allow_once`, `allow_always`, `reject_once`, `reject_always`. Auth inherits Claude Code's credentials (OAuth login, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, Bedrock/Vertex/Foundry). MCP-over-ACP is in the SDK (unstable) but not in the adapter.
- **Policy** (Agent SDK docs): "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."
- **Prior art**: acp-ui (Vue, MIT; browser build behind a stdio-to-WebSocket relay, bearer token as WebSocket subprotocol, `session/load` on reconnect), acp-chat, AgentWebUI; MCP-B (`@mcp-b/global` polyfill, closed-source relay); Playwright 1.64 `page.webmcp` for testing page tools.

### 3.6 science-kg's existing chat (reference only; not modified in this project)

`useChatSession.ts` wraps Vercel AI SDK `useChat` → `POST /api/chat` (`chatRoute.ts`, `streamText` with `@ai-sdk/anthropic`): a **long cache-controlled system prompt**, plus a per-turn **`canvasSummary`** (deterministic description of what the user sees, budget-fitted by `fitCanvasContextToBudget`) prepended as a text block on the latest user message; `server/agent/serverTools.ts` declares tools of which `ask_paper` runs server-side (needs the Python sidecar) and the rest run in the browser via `clientToolHandlers.ts` (2.8k lines of `handle*` functions over live React state), with proposal cards in the transcript. These handlers are already WebMCP-shaped; §6.4 maps each element of this setup to its new home.

Sources: [WebMCP spec](https://webmachinelearning.github.io/webmcp/) · [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md) · [Chrome WebMCP docs](https://developer.chrome.com/docs/ai/webmcp) · [Chrome Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access) · [inspector extension source](https://github.com/mario-oliver/model-context-tool-inspector) · [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) · [hooks](https://code.claude.com/docs/en/hooks) · [plugins reference](https://code.claude.com/docs/en/plugins-reference) · [claude-code#78208](https://github.com/anthropics/claude-code/issues/78208) · [ACP docs](https://agentclientprotocol.com/) · [transport RFD](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport) · [ACP TS SDK](https://github.com/agentclientprotocol/typescript-sdk) · [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) · [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) · [acp-ui](https://github.com/formulahendry/acp-ui)

---

## 4. Components and repository layout

```
webmcp-bridge/
  package.json                  # bun workspaces
  packages/
    protocol/                   # shared types: /ws frames, tool shapes, hello payload; webmcp.d.ts
    connector/                  # npm "webmcp-connector": index (core), ./react (AgentChat)
      src/discover.ts           #   find the daemon, retry, status events, user-gesture connect
      src/mirror.ts             #   document.modelContext → /ws (tools, toolchange, executeTool)
      src/shim.ts               #   minimal modelContext when the native API is absent
      src/context.ts            #   instructions + context() snapshot plumbing
      src/agent.ts              #   connectAgent(): ACP client over /acp (system prompt, tool policy, per-turn resource)
      src/session-model.ts      #   framework-agnostic ACP session state (core; no React)
      src/react/                #   <AgentChat> + parts (react as optional peer dependency; self-contained CSS, no Tailwind required)
  plugin/                       # Claude Code plugin "webmcp-bridge"
    .claude-plugin/plugin.json
    .mcp.json                   #   terminal Claude → http://127.0.0.1:8717/mcp
    hooks/hooks.json            #   SessionStart: ensure daemon + inject page instructions; UserPromptSubmit: inject UI state
    scripts/ensure-daemon.sh, inject-instructions.sh, inject-state.sh
    skills/webmcp/SKILL.md      #   how to work with a connected page
    daemon/webmcp-bridge.js     #   the daemon, bundled single file (built from bridge/)
  bridge/                       # daemon source
    src/index.ts                #   CLI: --port 8717, --state-dir, --allow-origin, install-launchd, stop
    src/registry.ts             #   pages → tools, instructions, cached context; selected page
    src/ws-server.ts            #   /ws tool channel
    src/mcp.ts, src/http.ts     #   MCP surface (/mcp, /mcp/by-page/<id>), sessions, list_changed fan-out
    src/acp.ts                  #   AcpServer relay: spawn claude-agent-acp per connection, workspaces, reaping
    src/security.ts             #   origin approval (/approve), allow-list store, loopback bind
    src/hooks-api.ts            #   GET /health, /state, /instructions for the plugin's hooks
    test/
  demo-site/                    # Vite vanilla-ts
  spikes/, plans/
```

Toolchain: TypeScript everywhere, bun as package manager and bundler, Node 23 runtime for the daemon, `@modelcontextprotocol/sdk` 1.32.2, `@agentclientprotocol/sdk` 2.4.0 and `claude-agent-acp` 0.100.0 pinned.

---

## 5. Surfaces and protocols

### 5.1 Tool channel `/ws`

Page → daemon: `hello { origin, title, instructions?, hasContext }` → reply `{ pageId, workspaceDir, mcpUrl, stateUrl }`; `tools { tools: ToolInfo[] }` (debounced on `toolchange`); `instructions { text }` when the page changes them; `context/result { requestId, text }`; `call/result { callId, ok, result: string|null }` or `{ callId, ok: false, error: { name, message } }`; `pong`. Daemon → page: `call { callId, name, args, timeoutMs }`, `cancel { callId }`, `context/request { requestId }`, `ping` (20 s). `ToolInfo = { name, description, inputSchema?, annotations? }`, verbatim from `getTools()`.

### 5.2 MCP surface for terminal Claude Code (`/mcp`)

**Meta-tools** are the daemon's own tools, always present whatever page is connected: they are *about* pages and their tools (list, select, inspect, call) rather than being page tools themselves. Claude sees them as `mcp__webmcp__webmcp_list_pages` and so on. **Mirrored tools** are the selected page's WebMCP tools re-registered under their own names (`mcp__webmcp__set_background_color`); they change as pages come and go and therefore depend on Claude Code honouring `list_changed` ([F-2](#F-2)). The meta-tools exist so that the terminal path works even when mirroring does not: `webmcp_call_tool { name: 'set_background_color', args: { color: 'blue' } }` reaches the same page function through one extra level of indirection.

| tool | input | returns |
|---|---|---|
| `webmcp_list_pages` | — | pages with ≥1 tool: `{ pageId, title, origin, toolCount, selected }[]` + daemon status |
| `webmcp_use_page` | `{ page_id }` | selects the page whose tools are mirrored (emits `list_changed`) |
| `webmcp_list_tools` | `{ page_id? }` | tools with full `inputSchema` and annotations |
| `webmcp_call_tool` | `{ name, args?, page_id? }` | forwards; normalised result (§5.3) |
| `webmcp_get_context` | `{ page_id? }` | the page's current UI-state snapshot (on-demand refresh mid-turn) |

Mirrored tools of the selected page are registered under their own sanitised names with the page's description and schema; annotations map `readOnlyHint → readOnlyHint`, `consequentialHint → destructiveHint`, `openWorldHint: false`; `untrustedContentHint` prefixes the description. `/mcp/by-page/<id>` serves one page's tools only. The MCP `instructions` field carries a short pointer ("pages expose tools and a context snapshot; the plugin injects both"), not the page's prompt.

### 5.3 Result normalisation

```
raw = string | null                       # executeTool's DOMString
null                                       → text "tool triggered a navigation; no result"
JSON.parse fails                           → content: [{ type:'text', text: raw }]
object with a `content` array              → returned as-is (page chose to speak MCP)
object/array                               → text JSON + structuredContent
string/number/boolean                      → text
DOMException (NotFoundError, DataError, OperationError, AbortError), timeout (60 s), page gone, provider offline
                                           → isError: true, text `${name}: ${error.name}: ${error.message}`
```

### 5.4 ACP relay `/acp`

`AcpServer({ createAgent })` from the SDK; per browser connection the daemon spawns `claude-agent-acp` (stdio, `CLAUDE_CODE_EXECUTABLE` = your `claude`, `CLAUDE_AGENT_ACP_PROTOCOL=v1`, `cwd` = the page's workspace) and pumps frames both ways, rewriting nothing. The page passes `cwd`, `mcpServers`, `_meta.systemPrompt` and `_meta.claudeCode.options` itself (§6.2). Workspaces: `~/.webmcp-bridge/workspaces/<origin-slug>/` with a generated `CLAUDE.md` mirror of the instructions and a `.claude/settings.json` baseline. Idle adapters are killed after N minutes; `session/load` brings sessions back.

### 5.5 Security baseline

Bind 127.0.0.1 only. Check the WebSocket `Origin` header (browser-enforced, unforgeable from page JavaScript) against a stored allow-list; on first contact from an unknown origin, hold the handshake, open `http://127.0.0.1:8717/approve?origin=…` in the default browser, store the decision. Log every `/acp` session start with its origin. Least-privilege tool policy per session (§6.2). A malicious local process could forge `Origin`, but such a process could already run Claude Code directly, so that threat is out of scope.

### 5.6 Code sketches (verified against SDK sources; longer versions in the stage plans)

```ts
// packages/connector/src/mirror.ts — runs in the page
const mc = document.modelContext ?? installShim();
async function listTools() {
  return (await mc.getTools()).map(t => ({ name: t.name, description: t.description,
    inputSchema: typeof t.inputSchema === 'string' ? JSON.parse(t.inputSchema) : t.inputSchema, annotations: t.annotations }));
}
async function call(name: string, args: object, signal: AbortSignal) {
  const tool = (await mc.getTools()).find(t => t.name === name);
  if (!tool) throw Object.assign(new Error(`no tool named ${name}`), { name: 'NotFoundError' });
  return mc.executeTool(tool, args, { signal });            // string | null
}
mc.addEventListener('toolchange', debounce(async () => link.send({ type: 'tools', tools: await listTools() }), 100));
```

```ts
// packages/connector/src/index.ts — what a web developer writes
import { connect } from 'webmcp-connector';
const page = connect({
  instructions: preamble() + SYSTEM_PROMPT,         // full text for the embedded chat; replaces Claude Code's preset (D-27)
  instructionsSummary: SHORT_PROMPT,                // optional, ≤ 9k chars, injected into terminal sessions by the plugin hook
  context: () => describeUiState(),                 // deterministic snapshot, ≤ 10k chars
  // toolPolicy: { disallowedTools: ['Bash', 'Write', 'Edit'] },   // optional; default is full Claude Code with per-call prompts (D-24)
  onStatus: s => render(s),                         // 'searching' | 'needs-approval' | 'connected' | 'absent'
});
```

```ts
// packages/connector/src/agent.ts — the page as an ACP client (embedded chat)
const stream = createWebSocketStream(`${bridge.wsBase}/acp`);
await acp.client({ name: 'page' })
  .onRequest(acp.methods.client.session.requestPermission, ctx => ui.askPermission(ctx.params))
  .onNotification(acp.methods.client.session.update, ctx => ui.applyUpdate(ctx.params))
  .connectWith(stream, async ctx => {
    await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
    const { sessionId } = await ctx.request(acp.methods.agent.session.new, {
      cwd: bridge.workspaceDir,
      mcpServers: [{ type: 'http', name: 'page', url: bridge.mcpUrl }],
      _meta: {
        systemPrompt: opts.systemPromptMode === 'append' ? { append: opts.instructions, excludeDynamicSections: true } : opts.instructions,   // string = replace (default, D-27)
        claudeCode: { options: { ...(opts.toolPolicy?.disallowedTools && { disallowedTools: opts.toolPolicy.disallowedTools }), allowDangerouslySkipPermissions: false } },
      },
    });
    const prompt = (text: string) => ctx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [
      { type: 'text', text },
      { type: 'resource', resource: { uri: 'page://ui-state', mimeType: 'text/plain', text: opts.context() } },   // fresh every turn
    ]});
    …
  });
```

```ts
// bridge/src/acp.ts — ACP relay, one adapter process per browser connection
const acpServer = new AcpServer({ createAgent: () => ({
  connect(clientStream) {
    const child = spawn(adapterBin, [], { cwd: workspaceDir, stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, CLAUDE_CODE_EXECUTABLE: claudePath, CLAUDE_AGENT_ACP_PROTOCOL: 'v1' } });
    const agentStream = acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);
    pump(clientStream, agentStream);
    return { closed: new Promise<void>(res => child.once('exit', () => res())) };
  } }) });
```

```json
// plugin/hooks/hooks.json
{ "hooks": {
  "SessionStart":     [ { "hooks": [ { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/ensure-daemon.sh" },
                                     { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/inject-instructions.sh" } ] } ],
  "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}\"/scripts/inject-state.sh" } ] } ]
} }
```

```bash
# plugin/scripts/inject-state.sh — stdout becomes context for this prompt (≤ 10k chars)
curl -sf --max-time 2 http://127.0.0.1:8717/state?page=selected || exit 0
```

---

## 6. Behaviour steering and UI state (answers to the two questions in the brief)

**Requirements (confirmed by the user, 2026-11-04):**

1. A page's long system prompt must reach Claude verbatim on both paths, through documented mechanisms, without depending on the model choosing to call a tool. → [D-17](#D-17)
2. A deterministic description of the UI state must reach Claude on every turn on both paths, with no "check the state tool before you respond" instruction required. → [D-18](#D-18)

**Two meanings of "resource" in this plan.** An *MCP resource* is a document an MCP server publishes under a URI; in Claude Code a human pulls it in with an `@server:` mention (not used for either requirement). An *ACP `resource` content block* is inline text the page attaches to a `session/prompt`, like an editor attaching a file; it is how the embedded path delivers the UI state every turn. ACP borrowed the block shape from MCP, hence the shared word.

**The standard gives you tools and nothing else.** WebMCP has no system prompt, instructions, or context field. The connector and the plugin add those channels; a page using them still works unchanged with any other WebMCP agent, which simply never sees the extras.

### 6.1 Q1: where the long system prompt goes

| Path | Channel | Semantics | Verified |
|---|---|---|---|
| Embedded chat | `session/new._meta.systemPrompt` as a **string replaces** Claude Code's preset entirely (chosen, [D-27](#D-27)); an object such as `{ append: PROMPT, excludeDynamicSections: true }` appends instead and stays available as an opt-in flag | a real system prompt, per session, any length (science-kg's 62k-character variant fits) | adapter source (`acp-agent.ts`) |
| Embedded chat, workspace copy | the daemon also writes the prompt into the workspace `CLAUDE.md` (and `AGENTS.md`); with a replaced system prompt the Agent SDK is not expected to load `CLAUDE.md` (verified in M3), so this copy serves other ACP agents ([D-26](#D-26) agent picker) and inspection | memory file, read at session start by agents that use it | adapter uses `settingSources: user, project, local` |
| Terminal Claude | plugin `SessionStart` hook prints the page's `instructionsSummary` (or the first ~9k characters of `instructions` plus a pointer) from `GET /instructions` → added to Claude's context before the first prompt; runs again on resume/clear/compact. The full text is one slash command away as the MCP prompt `/webmcp:page-instructions` ([D-26](#D-26)) and on disk for `Read` | first-turn context, ≤ 10k characters per hook ([F-10](#F-10): science-kg's prompts are 5–6× that) | Claude Code hooks docs |
| Terminal Claude, pointer | MCP `instructions` field: one paragraph telling Claude the page's instructions and context are injected by the plugin and refreshable via `webmcp_get_context` | hint only (short, first turn) | reported truncation ≈ 2k chars |
| Both | tool descriptions and annotations | always in context, the standard's own channel | spec |

The connector takes `instructions` (full text, for the embedded chat) and an optional `instructionsSummary` (≤ 9k characters, for the terminal hook), plus `instructions { text }` frames when they change; the daemon fans them out to all sinks. Because the preset is replaced ([D-27](#D-27)), the page's prompt must itself explain the environment: the package ships a short `preamble()` template (what `mcp__page__*` tools are, that mutating tools return state, how permissions appear) that developers prepend to their own prompt. A terminal session is a general coding session, so for an app like science-kg the summary, not the 62k-character assistant prompt, is what the hook should inject.

### 6.2 Tool policy for the embedded Claude

`session/new._meta.claudeCode.options` forwards Agent SDK options per session: `disallowedTools` (merged with the adapter's own), `tools`, `effort`, `hooks`, `allowDangerouslySkipPermissions: false`. **Default ([D-24](#D-24)):** full Claude Code in the per-origin scratch workspace with every non-read tool prompting, so `connect()` sends no `disallowedTools` unless the page sets `toolPolicy`; the daemon's workspace `.claude/settings.json` sets the permission default to ask. Consequences: the `<AgentChat>` permission queue with "allow always" is core, not optional (M5); and an approved origin can, through the user's per-call approvals, drive Claude Code's file and shell tools (the workspace is a scratch directory, but Bash is not confined to it), which is why origin approval ([D-8](#D-8)) and the per-call prompts are the safety boundary.

### 6.3 Q2: deterministic UI state, without "call this tool often"

Your current pattern (a deterministic `canvasSummary` attached to every request) carries over directly; no tool call and no model discretion is needed on either path:

| Path | Mechanism | Cadence |
|---|---|---|
| Embedded chat | the page attaches `context()` as an embedded `resource` block on **every** `session/prompt` (the adapter advertises `embeddedContext`) | every turn, page-controlled |
| Terminal Claude | plugin `UserPromptSubmit` hook: `curl http://127.0.0.1:8717/state?page=selected` → the daemon asks the page (`context/request`) or serves a fresh cache → stdout is added alongside the prompt | every prompt, ≤ 10k chars, 30 s hook budget |
| Both, within a turn | **mutating tools return the resulting state** (the demo's `set_*` tools already do), so Claude sees the effect of its own actions in the tool result; `webmcp_get_context` / `mcp__page__get_state` exist for an explicit refresh | per tool call |
| Optional | `PostToolUse` hook `additionalContext` after any `mcp__webmcp__*` call, for pages whose tools cannot return state | per page tool call |

Two consequences: keep the snapshot compact and deterministic (science-kg's `fitCanvasContextToBudget` logic transfers as-is), and give `context()` a stable layout so prompt caching holds for the prefix. The "always check the UI state before you respond" instruction becomes unnecessary; it may stay as a fallback line in the instructions.

### 6.4 Mapping science-kg's current chat onto this setup

| Today in `causal-graph-viewer` | Embedded chat | Terminal Claude |
|---|---|---|
| long system prompt (`systemPromptFor`) | `_meta.systemPrompt.append` (+ `CLAUDE.md` mirror) | SessionStart hook injection + MCP pointer |
| `canvasSummary` per turn | `resource` block per prompt | UserPromptSubmit hook injection |
| browser-executed tools (`handle*` over React state) | WebMCP tools (thin adapter over the handlers), called via `mcp__page__*` | same tools, mirrored as `mcp__webmcp__*` |
| `ask_paper` (server-side, sidecar) | a WebMCP tool whose `execute` calls the app's own backend with `fetch` | same |
| proposal cards in the transcript | `<AgentChat>` renders tool-call `content` keyed by tool name | n/a (terminal) |
| model choice, cost accounting | Claude Code's (your login, your settings) | Claude Code's |

---

## 7. Answered questions (converted to decisions)

No open questions remain. Each block below records the user's answer as a locked decision linked to the question it resolved; the remaining `proposed` decisions in §8 stand unless contested.

<decision id="D-23" title="Terminal Claude sees meta-tools plus the selected page's tools mirrored by name" status="locked" date="2026-11-05" from="Q-2">
As specified in §5.2: the five meta-tools are always present; the selected page's tools are mirrored under their own sanitised names and refreshed through `tools/list_changed`.
<rationale>User's answer to Q-2 (2026-11-05): "Meta-tools + mirrored tools of the selected page". Robust baseline plus readable transcripts.</rationale>
</decision>

<decision id="D-24" title="Default policy for the embedded Claude: full Claude Code in a per-origin scratch workspace; every non-read tool prompts" status="locked" date="2026-11-05" from="Q-3">
`connect()` sends no `disallowedTools` by default; the workspace `.claude/settings.json` sets permission mode to ask; `allowDangerouslySkipPermissions: false` always. Pages that want less ship a `toolPolicy`. Consequences in §6.2: the permission queue with "allow always" in `<AgentChat>` becomes core (M5), and origin approval plus the per-call prompts are the safety boundary, since Bash is not confined to the scratch directory.
<rationale>User's answer to Q-3 (2026-11-05): "Full Claude Code in the per-origin scratch workspace, every non-read tool prompts". Lets Claude write notes and exports at the cost of more prompts.</rationale>
</decision>

<decision id="D-21" title="The chat UI ships inside the npm package as `webmcp-connector/react`, borrowing science-kg components by copy" status="locked" date="2026-11-04" from="Q-4">
One package for web developers: the core entry has no React dependency (pages that only expose tools pay nothing); the `./react` subpath exports `<AgentChat>` with `react` as an optional peer dependency and self-contained styles (no Tailwind requirement on the host app). The framework-agnostic `SessionModel` lives in core so other frameworks can build on it later. Where science-kg's `ChatPanel` pieces help (message list, markdown rendering with `react-markdown` + `remark-gfm`, streaming text, collapsible tool cards), they are **copied and adapted** to the ACP session model; science-kg itself is not changed.
<rationale>The chat UI must speak exactly the `/acp` protocol and session model the core implements, so versioning them together avoids drift; a subpath keeps the install story at one package. Confirmed by the user on 2026-11-04.</rationale>
</decision>

<decision id="D-25" title="Personal/dev use now; auth stays pluggable; distribution decided later" status="locked" date="2026-11-05" from="Q-5">
The embedded chat runs on your own Claude Code login on your machine. `ANTHROPIC_API_KEY` in the daemon's environment already reaches the adapter, so an API-key mode needs no design now. [F2-1](#F2-1) stays open as the reminder for any future distribution.
<rationale>User's answer to Q-5 (2026-11-05): "Personal/dev use now".</rationale>
</decision>

<decision id="D-22" title="science-kg is not modified in this project; its integration is a separate later plan" status="locked" date="2026-11-04" from="Q-6">
The three deliverables are built and validated on the demo page only. §3.6 and §6.4 stay as the reference for the later science-kg plan (which handlers become WebMCP tools, proposal cards as ACP tool-call content, `<AgentChat>` as a second tab).
<rationale>Stated by the user on 2026-11-04.</rationale>
</decision>

<decision id="D-26" title="Extras in scope: agent picker, MCP prompt for full instructions, opt-in launchd; not: snapshot meta-tool, MCP resources" status="locked" date="2026-11-05" from="Q-7">
- **MCP prompt** `page-instructions` (M2): the daemon publishes the selected page's full `instructions` as an MCP prompt, so `/webmcp:page-instructions` loads the whole text into a terminal session when the hook's 10k-character injection is not enough ([F-10](#F-10)).
- **launchd, opt-in** (M6): `webmcp-bridge install-launchd` writes a per-user LaunchAgent (no administrator password, no blocking dialog; macOS posts a "background items added" notice and lists it under Login Items). It is never run by a hook: the user triggers it through `/webmcp-bridge:setup` (Claude Code's normal permission prompt captures the consent when Claude runs it) or a "start at login" checkbox on the approval page. The plist points at a copy of the daemon under the plugin data directory, refreshed by the SessionStart hook after plugin updates, and is removed by `uninstall-launchd` / plugin uninstall. Fallback is unchanged: the SessionStart hook always runs `ensure-daemon`, so without the login item (or with it switched off) the daemon starts at the first `claude` of the login session. Linux/Windows equivalents later.
- **Agent picker** (M6): the daemon can spawn another ACP agent (Gemini CLI, Codex CLI, Goose) per connection with the same page tools; `<AgentChat>` gets a selector. Each agent brings its own login; `_meta.systemPrompt` is Claude-specific ([F-12](#F-12)), so for other agents the workspace `CLAUDE.md` / `AGENTS.md` copy is the steering channel and `_meta.claudeCode.options` does not apply.
- Not built: `webmcp_snapshot` (the per-prompt snapshot covers it) and MCP resources (human-pull only).
<rationale>User's answer to Q-7 (2026-11-05): agent-picker, mcp-prompt, launchd; consent and fallback for launchd confirmed in chat the same day.</rationale>
</decision>

<decision id="D-27" title="The page's prompt replaces Claude Code's preset on the embedded path" status="locked" date="2026-11-05" from="Q-9">
`_meta.systemPrompt` is sent as a string (the connector's `instructions`); `systemPromptMode: 'append'` remains as an opt-in flag. Consequences: the page owns all guidance about tools and permissions, so the package ships a `preamble()` template to prepend; the Agent SDK is not expected to load the workspace `CLAUDE.md` under a custom prompt (verified in M3); Claude Code's built-in file and shell tools are still available under [D-24](#D-24) but without the preset's guidance about them, which the preamble covers in a paragraph.
<rationale>User's answer to Q-9 (2026-11-05): "Replace the preset with your prompt": closest to the current in-app agent; the measured science-kg prompts (62k / 47k characters) fit without any cap.</rationale>
</decision>

<decision id="D-28" title="Terminal Claude receives the UI-state snapshot on every prompt via the UserPromptSubmit hook" status="locked" date="2026-11-05" from="Q-10">
`inject-state.sh` fetches `/state?page=selected` on each prompt (daemon asks the page or serves a fresh cache); the snapshot is budget-fitted on the page to stay under 10k characters; `webmcp_get_context` remains for explicit mid-turn refresh; PostToolUse injection is not enabled.
<rationale>User's answer to Q-10 (2026-11-05): "Every prompt via the UserPromptSubmit hook": deterministic, mirrors `canvasSummary`.</rationale>
</decision>

---

## 8. Decisions

<decision id="D-1" title="One local daemon with three faces; no extension in scope" status="locked" date="2026-11-05">
`/mcp` (terminal Claude), `/ws` (pages via the npm package), `/acp` (embedded chat), on 127.0.0.1:8717, plus `/state`, `/instructions`, `/health`, `/approve` for the plugin's hooks and first-contact approval. This daemon *is* the reusable infrastructure.
<rationale>
A local process is unavoidable for Stage 2; sharing it with Stage 1 removes the "extension and a bridge" double install; every page that imports the package can mirror its own tools, so the extension only serves third-party sites (§13).
</rationale>
</decision>

<decision id="D-2" title="Tool discovery uses the native document.modelContext API; a shim fills in when it is absent" status="locked" date="2026-11-04">
From the page itself (and, in future, from an extension's isolated world): `getTools()`, `executeTool()`, `toolchange`. The connector installs a minimal shim (`registerTool/getTools/executeTool/toolchange`) only when the native API is missing.
<rationale>Verified on your Chrome 156 (§3.2) and the mechanism Google's own inspector uses. The shim keeps apps free of the Chrome flag without diverging from the standard API.</rationale>
</decision>

<decision id="D-3" title="Nothing in the browser listens; the daemon owns the port" status="locked" date="2026-11-04">
<rationale>MV3 extensions have no server-socket API; Chrome Apps are gone; pages cannot listen at all.</rationale>
</decision>

<decision id="D-4" title="Embedded chat uses ACP v1 through claude-agent-acp; the browser is a real ACP client; the relay rewrites nothing" status="proposed" date="2026-11-04">
`@agentclientprotocol/sdk` `experimental/ws-client` in the page, `experimental/server` in the daemon, `CLAUDE_AGENT_ACP_PROTOCOL=v1`. The page passes `cwd`, `mcpServers`, `_meta.systemPrompt` and `_meta.claudeCode.options` itself from the `/ws` hello and its `connect()` options.
<rationale>Standard message model (streaming, tool calls, permissions, plans, modes, resume); existing browser clients prove the pattern; agent-agnostic for free; the relay stays trivially correct. v2 is a draft in both SDK and adapter.</rationale>
</decision>

<decision id="D-5" title="Page tools reach the embedded agent through a per-page HTTP MCP endpoint" status="proposed" date="2026-11-04">
`/mcp/by-page/<id>`, passed as `{ type: 'http' }` in `session/new`. Switch to MCP-over-ACP when the adapter advertises `mcpCapabilities.acp`.
</decision>

<decision id="D-6" title="Static meta-tools are the guaranteed path for terminal Claude; mirroring is layered on top" status="proposed" date="2026-11-04">
Whatever [D-23](#D-23) decides, `webmcp_list_pages / use_page / list_tools / call_tool / get_context` exist, so the terminal path works even if Claude Code ignores `list_changed` ([F-2](#F-2)).
</decision>

<decision id="D-7" title="TypeScript monorepo (bun workspaces), Node 23 daemon, pinned SDKs" status="proposed" date="2026-11-04">
`@modelcontextprotocol/sdk` 1.32.2 (low-level `Server`, raw JSON Schema from the page), `@agentclientprotocol/sdk` 2.4.0 and `claude-agent-acp` 0.100.0 pinned; bun as package manager and bundler; the daemon ships inside the plugin as one bundled file.
<rationale>Matches science-kg's stack; the MCP SDK's HTTP transport targets Node `http`; the ACP transports and the adapter's `_meta` extensions are not yet stable, so pin and keep the relay thin.</rationale>
</decision>

<decision id="D-8" title="Origin approval on first contact replaces a pasted token" status="proposed" date="2026-11-04">
Loopback bind; `Origin` allow-list persisted by the daemon; unknown origins trigger the approval page; every `/acp` session start is logged (§5.5).
<rationale>The `Origin` header cannot be forged by page JavaScript, so approval-by-origin protects against the web-page threat without asking users to copy tokens; a forged header needs a local process that could already run Claude Code. Reaffirmed by the user on 2026-11-05 after the Codex audit: a malicious same-user process is inside the OS trust boundary and is not something this project guards against; the token-file, Unix-socket and process-identity hardening discussed then is deliberately not planned.</rationale>
</decision>

<decision id="D-9" title="The browser ACP client declares no fs or terminal capabilities" status="proposed" date="2026-11-04">
A page is not an editor; `fs/*` and `terminal/*` requests are declined. Claude Code's own file tools still work inside the policy of [D-24](#D-24).
</decision>

<decision id="D-10" title="Top-frame tools only; cross-origin iframes deferred" status="proposed" date="2026-11-04">
`getTools()` from the top document already includes same-origin descendants; cross-origin iframes need `allow="tools"` plus `exposedTo`/`fromOrigins`. Not needed for the demo or science-kg.
</decision>

<decision id="D-11" title="Demo page: Vite vanilla-ts importing the package, four tools, chat panel added in M5" status="proposed" date="2026-11-04">
`get_state` (read-only), `set_background_color { color }`, `set_sentence { text }`, `randomize`; mutating tools return the resulting state; random colour and sentence on load; live tool list; call log; "register bonus tool" button; a connection status badge with the "start the daemon" hint; `instructions` and `context()` wired, so the demo exercises §6 too.
</decision>

<decision id="D-12" title="Build order: daemon + package + terminal path first, with the ACP spike pulled forward as a risk check" status="proposed" date="2026-11-04">
See §9. The terminal path is the smaller half and exercises the tool channel the embedded chat reuses; the one-day ACP spike retires the auth/transport risk before the chat UI is built.
</decision>


<decision id="D-29" title="The browser chat is the primary surface; a terminal session is a one-time installer" status="locked" date="2026-11-05">
Requested by the user on 2026-11-05 after trying the demo: starting `claude` only to get the daemon left two chats. Now: (1) the chat panel's empty state is a setup flow (install the plugin, run `claude` once, say yes to "start at login", close the terminal); (2) the plugin's SessionStart hook injects a notice that the page has its own chat in the browser and, until `~/.webmcp-daemon/setup-done` exists or a login item is present, nudges Claude to offer `/webmcp-daemon:setup`; (3) the login item is the expected state; (4) a plugin setting `inject_page_context` (default on) lets browser-only users keep terminal sessions free of page instructions and state. The daemon, plugin, login item and menu bar item share one state directory, `~/.webmcp-daemon`.
<rationale>Claude Code honours a hook's `initialUserMessage` only in `-p` mode, where it would hijack scripted runs, so the first-session nudge is a context notice, not an auto-submitted prompt ([F-17](#F-17)).</rationale>
</decision>

<decision id="D-30" title="The daemon owns a macOS menu bar item, \"webmcp-bridge\", shipped inside the plugin" status="locked" date="2026-11-05">
No Node library can create a status item in-process without Electron (`systray2` is unmaintained since 2022 and ships only an x86_64 helper), so the daemon spawns a 150 KB Objective-C status-bar helper (`plugin/daemon/tray/webmcp-bridge-tray`, universal binary, `bun run build:tray`) and drives it over JSON lines on stdin/stdout; the helper exits with the daemon. Menu: status, Start at login (launchd), open log, show state folder, copy MCP URL, stop. The plugin hook and the login item pass `--tray`; tests and `bun run daemon` do not. There is no separate app to install. **Icon (2026-11-05):** the menu bar shows the icon, `plugin/daemon/tray/webmcp-bridge-icon.png`: the icon lifted from the company logo by `scripts/make-tray-icon.py` as a macOS **template image** (black shape with alpha, 72×72 px, drawn at 18×18 pt). That is the menu bar convention: the system colours it itself, white on a dark menu bar and black on a light one, and handles the highlight state and legibility shadow. A first version in brand pink was tried on 2026-11-05 and rejected by the user as not pretty. The daemon passes the PNG's path to the helper (`"image"`, with an optional `"template"` flag); the helper falls back to an SF Symbol when the PNG is missing, and the login item and the plugin hook copy the PNG next to the helper. In dark mode the menu bar draws a legibility drop shadow behind every status item (a Core Animation shadow on the private `NSStatusBarContentView`, `hasCAShadow`), which showed as a dark halo around the pink version; while a non-template image is shown the helper switches that flag off (template images keep it, like every other menu bar glyph) (guarded, best-effort private API; verified by capturing the status item window offscreen: 302 shadow pixels before, 0 after, and the flag survives image, tooltip and appearance changes).
<rationale>User's choice on 2026-11-05: ship it inside the plugin and prefer registering from the daemon over a separate Swift app. The helper is Objective-C because this machine's Command Line Tools Swift toolchain has a duplicate `SwiftBridging` module-map defect ([F-18](#F-18)); clang with Cocoa compiles without it.</rationale>
</decision>

<user-highlight comment="cm1"></user-highlight>

<comment id="cm1" status="open" kind="question">
  <note by="agent" at="2026-11-04T13:40">If you would rather see the embedded chat working before anything else, say so and I will flip the order: M3 (ACP spike) first, then M4/M5, then the terminal path. The daemon core is shared either way.</note>
  <note by="agent" at="2026-11-05T01:30">Review pass: no change requested, so the order in D-12 stands (terminal path first, ACP spike pulled forward). Suggest resolving this thread unless you want it flipped.</note>
</comment>

<decision id="D-13" title="Three deliverables: npm package, demo page, Claude Code plugin with the daemon" status="locked" date="2026-11-04">
Exactly the list in the brief (2026-11-04): `webmcp-connector` (core + `/react`), the demo page importing it, and the `webmcp-bridge` plugin that ships and runs the daemon. Names are placeholders.
<rationale>Stated by the user as the things to ship; everything else in this plan is in service of these three.</rationale>
</decision>

<decision id="D-14" title="Pages reach the daemon through the npm package only; the extension is future work" status="locked" date="2026-11-04" from="Q-1">
Resolves the former Q-1 (connector-first vs extension-only vs connector-only) as connector-only for this project; the extension's design stays recorded in the Stage 1 plan for a later "third-party sites" effort.
<rationale>Follows from D-13: none of the three deliverables is an extension, and every target page imports the package.</rationale>
</decision>

<decision id="D-15" title="Extension content-script scope" status="wontfix" date="2026-11-04" from="Q-8">
Moot while the extension is out of scope; revisit with §13.
</decision>

<decision id="D-16" title="The plugin starts the daemon from a SessionStart hook, detached; it outlives the session" status="proposed" date="2026-11-04">
`ensure-daemon.sh` is idempotent (health check first), launches with `setsid`/`nohup`, waits for health, and exits; state lives in `${CLAUDE_PLUGIN_DATA}` / `~/.webmcp-bridge/`, never under `${CLAUDE_PLUGIN_ROOT}`. The daemon is **not** the plugin's stdio MCP server, because that would die with the session while the embedded chat needs it running.
<rationale>Hooks are the only plugin component that can run arbitrary shell at session start; the `.mcp.json` entry then connects to the already-running daemon over HTTP. The opt-in launchd login item ([D-26](#D-26)) only changes *when* the daemon is first started; the hook remains the fallback in every case.</rationale>
</decision>

<decision id="D-17" title="Steering channels: connector `instructions` fan out to the embedded system prompt, the workspace CLAUDE.md, and the terminal SessionStart hook" status="locked" date="2026-11-04">
Exactly the table in §6.1. The MCP `instructions` field carries only a pointer. WebMCP itself is not extended.
<rationale>Each sink is a documented mechanism of its consumer (Agent SDK preset options via the adapter's `_meta`, Claude Code memory files, hook context injection); none depends on the model choosing to call a tool. Confirmed as a requirement by the user on 2026-11-04. With [D-27](#D-27) the embedded Claude receives the prompt directly; the workspace `CLAUDE.md` copy remains for other agents and inspection.</rationale>
</decision>

<decision id="D-18" title="UI state is injected deterministically: per-prompt resource on the embedded path, UserPromptSubmit hook on the terminal path, and mutating tools return state" status="locked" date="2026-11-04">
Exactly §6.3; `webmcp_get_context` / `get_state` remain for explicit refresh. Snapshots are capped at 10,000 characters to fit the hook limit and are budget-fitted on the page side.
<rationale>Reproduces science-kg's `canvasSummary` behaviour without relying on "call this tool often". Confirmed as a requirement by the user on 2026-11-04.</rationale>
</decision>

<decision id="D-19" title="Per-session tool policy travels in session/new `_meta.claudeCode.options`, with the workspace settings as the baseline" status="proposed" date="2026-11-04">
`disallowedTools` (and `allowDangerouslySkipPermissions: false`) from `connect({ toolPolicy })`; the daemon still writes a conservative `.claude/settings.json` into each workspace.
<rationale>The adapter forwards these options per session (source verified); settings files cover sessions created by other clients against the same workspace.</rationale>
</decision>

<decision id="D-20" title="The connector connects behind a visible user action on public https pages and reports status instead of failing silently" status="proposed" date="2026-11-04">
On `localhost` it may auto-connect; on public origins it waits for a click so Chrome's Local Network Access prompt is expected; statuses `searching | needs-approval | connected | absent` drive the page's hint UI.
<rationale>§2.3: a silent background prompt is confusing, and a refused connection must not look like a bug.</rationale>
</decision>

---

## 9. Build order and milestones

| # | Milestone | Deliverable | Done when |
|---|---|---|---|
| M0 | Scaffold | workspaces, shared protocol types, lint/test wiring; final package and plugin names (npm availability checked); license (MIT proposed) | `bun install && bun run build && bun test` pass |
| M1 | Package core + demo + daemon core | `webmcp-connector` (discover, mirror, shim, instructions, context); demo page (D-11); daemon `/ws` registry with origin approval | daemon logs the page, its 4 tools, its instructions and a context snapshot; flag off; approval page appears once |
| M2 | Terminal path + plugin | `/mcp` meta-tools + mirroring + `/mcp/by-page`; MCP prompt `page-instructions` ([D-26](#D-26)); plugin with `ensure-daemon`, `inject-instructions` (summary + pointer), `inject-state`, `.mcp.json`, skill | **Stage 1 goal**: a fresh `claude` session starts the daemon, sees the page's instructions and state, reads the colour/sentence and changes them (checks c4–c9, c21–c23) |
| M3 | ACP spike (≈1 day; can run right after M0) | `AcpServer` + spawned adapter + SDK `ws-client` from a plain page | "hello" streams with your login; one permission approved; `session/new` with `_meta.systemPrompt`, `_meta.claudeCode.options` and an http MCP server → embedded Claude follows the prompt and calls `get_state`; loopback WebSocket from an `https://` page checked ([F2-8](#F2-8)) |
| M4 | ACP relay | `bridge/src/acp.ts`, workspaces, reaping, security on `/acp`; `connectAgent()` in the package | demo page chats through the daemon; a foreign origin is refused |
| M5 | Chat UI | `webmcp-connector/react` `<AgentChat>` (science-kg pieces copied where useful, [D-21](#D-21)) with the permission queue and "allow always" ([D-24](#D-24)) + chat panel in the demo | **Stage 2 goal**: "make the background blue" typed inside the page → tool card → page updates; a Bash request shows a queued permission prompt (checks c10–c17, c24–c25, c29) |
| M6 | Packaging and hardening | marketplace entry; `/webmcp-bridge:setup` with opt-in `install-launchd` and `uninstall-launchd` ([D-26](#D-26)); agent picker (daemon config + `<AgentChat>` selector); README; tests; fresh-machine run | quickstart works as written on a clean profile; login item appears under Login Items only after opting in (checks c26–c28) |

Target developer experience:

```bash
# app developer
bun add webmcp-connector            # in the web app; connect({ instructions, context, toolPolicy })
# user with Claude Code
claude plugin install webmcp-bridge@<marketplace>
claude                              # SessionStart hook starts the daemon; .mcp.json connects; skill explains page tools
# then open the app; approve the origin once; optional "connect to local Claude" in the page for the chat
```

---

## 10. Acceptance checklist

**Daemon and page**
<check id="c1" status="done">The daemon starts (from the plugin hook or `npx webmcp-bridge`); `/health`, `/mcp`, `/ws`, `/acp` answer on 127.0.0.1:8717.</check>
<check id="c2" status="done">Demo page with the Chrome flag OFF: tool list shows 4 tools (shim active); first contact opens the approval page; after Allow the daemon logs the page.</check>
<check id="c3" status="done">Demo page with the flag ON: native API used, shim not installed, same 4 tools.</check>

**Terminal Claude Code (Stage 1 goal)**
<check id="c4" status="done">`claude mcp list` shows `webmcp ✔ Connected`; `/mcp` lists the 5 meta-tools and the 4 mirrored tools.</check>
<check id="c5" status="done">"What is the current background colour and sentence?" → Claude answers from the injected snapshot or `get_state`, matching the screen.</check>
<check id="c6" status="done">"Make the background #0066cc and set the sentence to 'Hello from Claude Code'" → page updates within a second; the call log shows both calls; the tool results carry the new state.</check>
<check id="c7" status="done">"Register bonus tool" on the page → Claude can call `shout` without `/mcp` reconnect (else record the outcome under F-2).</check>
<check id="c8" status="done">Close the demo tab → a call returns an `isError` result naming the gone page; reopen → `webmcp_list_pages` shows it again.</check>
<check id="c9" status="done">Restart the daemon → the page reconnects within 15 s without a reload.</check>
<check id="c21" status="done">A fresh `claude` session with the daemon not running: the SessionStart hook starts it, and `.mcp.json` connects (or `/mcp reconnect` is documented as needed).</check>
<check id="c22" status="done">The page's `instructions` appear in Claude's context at session start (verify by asking Claude to quote a distinctive line).</check>
<check id="c23" status="done">Change the page state, send any prompt → the UserPromptSubmit hook injects the fresh snapshot (Claude reports the new colour without calling a tool).</check>
<check id="c26" status="done">`/webmcp:page-instructions` loads the page's full instructions into a terminal session (test with a 60k-character sample).</check>
<check id="c27" status="todo">`/webmcp-bridge:setup` offers the login item; after opting in it appears under Login Items and the daemon is up after a re-login; declining leaves only the SessionStart fallback, which still works.</check>
<check id="c28" status="done">Agent picker: switching the demo chat to another installed ACP agent (if any) starts that agent with the same page tools; absence of other agents is reported, not an error.</check>

**Embedded chat (Stage 2 goal)**
<check id="c10" status="done">Embedded chat: "hi" streams a reply; auth status shows your Claude login, no API key configured.</check>
<check id="c11" status="done">"What colour is the background?" inside the page → answered from the per-turn resource; `mcp__page__get_state` available and shown as a tool card when used.</check>
<check id="c12" status="done">"Make it #0066cc and change the sentence" → page updates; a permission prompt appears only for non-read-only tools when auto-allow is off.</check>
<check id="c13" status="done">Cancel mid-turn → `stopReason: cancelled`; pending permission closed.</check>
<check id="c14" status="done">Reload the page → history returns via `session/load`.</check>
<check id="c15" status="done">A page on a non-approved origin cannot open `/acp` or `/ws`.</check>
<check id="c16" status="done">Terminal Claude and the embedded chat work concurrently against the same daemon and the same page.</check>
<check id="c17" status="done">Two tabs → two adapter processes; closing a tab reaps its process after the idle timeout.</check>
<check id="c24" status="done">The long `instructions` text steers the embedded chat (distinctive rule followed; `_meta.systemPrompt` confirmed in the adapter's SDK message log).</check>
<check id="c25" status="done">With `toolPolicy.disallowedTools` set, the embedded Claude cannot run Bash/Write/Edit; with it unset (the default), it asks permission.</check>
<check id="c29" status="done">Ask the embedded Claude to write a note to a file: a permission prompt queues in `<AgentChat>`; "allow always" suppresses the next one for the same tool in that session.</check>
<check id="c30" status="done">With the preset replaced (D-27), the embedded Claude still uses page tools correctly from the `preamble()` guidance alone, and a distinctive line of the page prompt is followed.</check>

---

## 11. Risks and hacks

Ids are kept from the stage plans so their cross-references still resolve.

<finding id="F-1" title="WebMCP is experimental and still changing" severity="p1" status="open" effort="small">
Origin trial until Chrome 162, TAG/security reviews pending, API renamed twice already. All `document.modelContext` calls live in the package's mirror module; record the Chrome version per acceptance run; the spike doubles as a smoke test after Chrome updates.
</finding>

<finding id="F-2" title="Claude Code may ignore notifications/tools/list_changed over HTTP" severity="p1" status="open" effort="small">
Docs say it refreshes; issue #78208 says it did not in 2.1.211; we are on 2.1.318. M2 tests it; meta-tools work regardless; `/mcp` → Reconnect is the fallback.
</finding>

<finding id="F-3" title="MV3 service worker dies after 30 s idle (extension only)" severity="p2" status="deferred" effort="small">
Deferred with the extension (§13): WebSocket ping every 20 s, reconnect with backoff, `chrome.alarms` safety tick.
</finding>

<finding id="F-4" title="The daemon's browser-facing endpoints hand page tools and, via /acp, Claude Code itself to whatever can reach loopback" severity="p1" status="open" effort="small">
Any page can open `ws://127.0.0.1:8717/…`; through `/acp` that means running Claude Code with your credentials and, depending on [D-24](#D-24), your filesystem. Baseline in §5.5 and [D-8](#D-8): origin approval, loopback bind, per-session logging, least-privilege tool policy. Page-authored tool descriptions and results are also a prompt-injection surface; `untrustedContentHint` is surfaced.
</finding>

<finding id="F-5" title="Secure-context requirement" severity="p2" status="open" effort="small">
`document.modelContext` exists only on `https://` and `http://localhost`; the shim has no such limit but is not the native API. Demo and science-kg dev are on localhost; deployed science-kg is https.
</finding>

<finding id="F-6" title="No --load-extension in branded Chrome; extension dev loop is manual" severity="p3" status="deferred" effort="small">
Deferred with the extension. Playwright 1.64 `page.webmcp` tests page tools without any extension.
</finding>

<finding id="F-7" title="Results are JSON strings; argument encoding changed in Chrome 155" severity="p3" status="open" effort="small">
Normalisation in §5.3; arguments passed as objects.
</finding>

<finding id="F-8" title="Tool names must be sanitised and de-duplicated" severity="p3" status="open" effort="small">
WebMCP allows `.`; Claude Code maps other characters to `_`; two pages can register the same name; meta-tool names are reserved.
</finding>

<finding id="F-9" title="Multiple providers and Chrome profiles" severity="p3" status="deferred" effort="small">
Relevant once an extension exists; pages already connect individually.
</finding>

<finding id="F-10" title="Hook context injection is capped at 10,000 characters" severity="p2" status="open" effort="small">
`SessionStart` and `UserPromptSubmit` output above the cap is written to a file and replaced by a path and a 2,000-character preview, which Claude is not asked to read. Measured 2026-11-04: science-kg's system prompt is 61,862 characters (pathway variant, ~9.8k words) and 46,528 characters (native variant), i.e. 5–6× the cap, so the terminal hook injects `instructionsSummary` (or a ~9k-character head plus pointer) and the full text travels as the MCP prompt `/webmcp:page-instructions` ([D-26](#D-26)) and a file Claude can `Read`. The context snapshot is budget-fitted on the page. The embedded path has no cap ([D-27](#D-27)).
</finding>

<finding id="F-11" title="MCP `instructions` is a short, first-turn hint in Claude Code" severity="p3" status="open" effort="small">
A third-party test reports delivery as a first-turn reminder truncated around 2,048 characters. Treated as a pointer only; not verified by us.
</finding>

<finding id="F-12" title="The adapter's `_meta.systemPrompt` and `_meta.claudeCode.options` are adapter extensions, not ACP standard" severity="p2" status="open" effort="small">
They are documented in `claude-agent-acp`'s source and `NewSessionMeta` type, and newer ACP drafts add a spec-level `systemPrompt`, but other ACP agents will ignore them. The workspace `CLAUDE.md` and settings remain the portable fallback. Pin the adapter version.
</finding>

<finding id="F-13" title="CLAUDE.md and settings are read at session start" severity="p3" status="open" effort="small">
Changing a page's instructions mid-session reaches terminal Claude via the next SessionStart (resume/clear/compact) and the embedded chat via the next session; the daemon rewrites the workspace files immediately so new sessions are right.
</finding>

<finding id="F-17" title="Hook `initialUserMessage` applies only to -p mode" severity="p3" status="open" effort="small">
Claude Code's docs: it "becomes the first turn" in non-interactive `-p` runs; interactive behaviour is undocumented. Using it from a plugin hook would hijack every scripted run, so the first-session setup nudge is delivered as `additionalContext` and relies on Claude offering the setup (verified: Claude quoted the notice and offered `/webmcp-daemon:setup`).
</finding>

<finding id="F-18" title="Command Line Tools' Swift cannot build AppKit apps here (duplicate SwiftBridging module map)" severity="p3" status="open" effort="small">
`swiftc` from Command Line Tools 16-era (Swift 6.1.2, macOS 15.8.1) fails on any AppKit import with "redefinition of module 'SwiftBridging'", even under a clean environment; a full Xcode would avoid it. The status-bar helper is therefore Objective-C compiled by clang, which works with Command Line Tools alone.
</finding>

<finding id="F2-1" title="Subscription login cannot be offered to other users without Anthropic approval" severity="p1" status="open" effort="design">
Agent SDK docs: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Your own machine with your own login is your own tooling; shipping science-kg-with-embedded-chat to other scientists on their subscriptions is not. API keys (`ANTHROPIC_API_KEY`, `apiKeyHelper`, the adapter's gateway auth) are the sanctioned path. The terminal path has no such issue. See [D-25](#D-25).
</finding>

<finding id="F2-3" title="ACP remote transport is experimental in the SDK" severity="p2" status="open" effort="small">
`experimental/server`, `experimental/ws-client`, `experimental/node` may change incompatibly in any release; the RFD is Active, not final. Pin versions; keep the relay thin.
</finding>

<finding id="F2-4" title="One claude process per browser connection" severity="p2" status="open" effort="small">
Reap idle adapters, cap concurrent sessions, rely on `session/load` to resume.
</finding>

<finding id="F2-5" title="Permission prompts become in-page UI" severity="p2" status="open" effort="medium">
Long tasks can flood the chat with prompts; `allow_always` persists per session; the UI needs a visible policy toggle and a queue rather than stacked modals. With [D-24](#D-24) this is the default experience, so the queue is part of M5, not a later polish item.
</finding>

<finding id="F2-6" title="The adapter reads settings and CLAUDE.md from the session cwd" severity="p3" status="open" effort="small">
Dedicated per-origin workspaces with explicit settings, never the home directory or an unrelated repo.
</finding>

<finding id="F2-7" title="Fast-moving dependencies" severity="p3" status="open" effort="small">
`claude-agent-acp` 0.100.0 renamed this year; ACP v2 draft; WebMCP origin trial; Local Network Access still rolling out. Record exact versions per acceptance run; bump deliberately.
</finding>

<finding id="F-14" title="The Claude adapter ignores `_meta.claudeCode.options.model`; the session runs on your Claude Code default model" severity="p2" status="open" effort="small">
Observed 2026-11-05: `set-model … claude-fable-5-1` in the adapter log despite `model: 'sonnet'`. The adapter manages models itself (settings `availableModels`, ACP model selection in newer drafts). For now the embedded chat uses whatever your Claude Code default is; a model picker needs the ACP model methods once the SDK's stable surface exposes them. Mind the cost: each e2e chat run cost roughly a dollar on the default model.
</finding>

<finding id="F-15" title="Claude Code's default permission mode runs read-only shell commands without prompting" severity="p3" status="open" effort="small">
With [D-24](#D-24) (no `disallowedTools`), `ls` ran without a prompt while `echo hi > note.txt` prompted. That is Claude Code's own read-only classifier, not a bug here; pages that want no shell at all pass `toolPolicy.disallowedTools: ['Bash']`.
</finding>

<finding id="F-16" title="Local Network Access prompt not testable locally" severity="p3" status="open" effort="small">
A page served from `https://127.0.0.1:5174` connected to `ws://127.0.0.1:8717` without any mixed-content block (verified 2026-11-05). Chrome's Local Network Access prompt applies only to pages on public addresses, so it stays unverified until a deployed page exists.
</finding>

<finding id="F2-8" title="Loopback WebSocket from an https page: mixed content is fine, Local Network Access prompts once" severity="p2" status="open" effort="small">
Chrome treats loopback as potentially trustworthy (no mixed-content block) but gates public-site → loopback connections, WebSockets included per the current guide, behind a one-time permission. M3 verifies both on Chrome; Safari/Firefox noted, not promised. The connector's user-gesture connect ([D-20](#D-20)) makes the prompt expected.
</finding>

---

## 14. Implementation status (2026-11-05)

Built in this repo following §9's order; everything below was run on this machine (Chrome 156, Claude Code 2.1.318, Node 23.7, bun 1.2.23). Names settled at M0: npm package **`webmcp-connector`** (free on npm), daemon and plugin **`webmcp-daemon`** (`webmcp-bridge` was taken).

| Milestone | Result | Evidence |
|---|---|---|
| M0 scaffold | bun workspaces, flat tsconfig, Node runs the daemon's TypeScript directly (type stripping); 20 unit tests | `bun run typecheck && bun test` |
| M1 package + demo + daemon core | page ⇄ `/ws`, origin approval page, `/state`, `/instructions`, `/call`; native API and shim both verified; dynamic register/unregister mirrored | `scripts/e2e/m1.mjs` (both modes) |
| M2 terminal path + plugin | `/mcp` meta-tools + mirrored tools + `list_changed` (2 notifications received), `/mcp/by-page`, MCP prompt; plugin hooks start the daemon from nothing (**the MCP server connected in that same session**), inject instructions at start and UI state on every prompt (Claude answered from context with no tool call); real Claude Code read and changed the page | `scripts/e2e/m2.mjs`; `claude -p --plugin-dir ./plugin` runs 1–5 |
| M3 ACP spike | SDK `AcpServer` + spawned adapter + SDK WebSocket client: system prompt **replaced** (rule followed), `disallowedTools` honoured (no shell), page tool through HTTP MCP, permission request round trip | `scripts/e2e/m3-acp.mjs` |
| M4 relay | daemon `/acp` with origin refusal (403), per-connection adapter, read-only page tools pre-allowed via `allowedTools`, mutating tool prompts, adapter stopped 5 s after the browser leaves | `scripts/e2e/m4-relay.mjs` |
| M5 chat | `<AgentChat>` in the demo through the real browser: connect button, prompt, streamed markdown, tool cards, permission prompt with allow/reject, shell write rejected, **resume after reload with 4 replayed turns** | `scripts/e2e/m5-chat.mjs` |
| M6 packaging | daemon and adapter bundled into two files under `plugin/daemon/` (0.9 MB + 3.5 MB), handshake verified through the bundles; `claude plugin validate` passes; opt-in `install-launchd` implemented and previewed with `--dry-run` only (nothing registered on this machine); `/webmcp-daemon:setup` command; README + PRIVACY | `scripts/e2e/m6-bundle.mjs` |

**Gap-closing pass (later on 2026-11-05).**

| Gap | Now | Evidence |
|---|---|---|
| Origin approval page never exercised in a browser (c2 had been ticked on the strength of unit tests only) | A daemon in `--approval log` mode holds the unknown origin; the test opens the printed approval URL in a second tab, clicks Deny (not persisted, page shows `denied`), retries, clicks Allow with "remember" (persisted in `origins.json`, page connects), reloads (connects without a prompt) | `scripts/e2e/m7-approval.mjs` |
| c13 cancel mid-turn | Stop button → `session/cancel` → `stopReason: cancelled` | `m5-chat.mjs` step "cancel mid-turn" |
| c28 agent picker | daemon `--agent id=<command>`, `/agents`, `?agent=` on `/acp`, agent list in the welcome frame, `<select>` in the chat; verified with a fake echo ACP agent (`scripts/e2e/fake-agent.mjs`): "hello picker" → "echo: hello picker" | `m5-chat.mjs` step "agent picker (echo)" |
| Chat UI extras | slash-command menu from `available_commands_update` (type `/`, Tab completes), auto-allow read-only toggle wired to the live handle | implemented; rendered when commands exist, not separately scripted |
| npm package build | `bun run build` in `packages/connector`: ESM for core, `./react`, `./webmcp` (globals), declarations with `.js` extensions, `declare global` WebMCP types emitted, React/markdown/ACP SDK external, production JSX runtime; the wire protocol now lives in the package (`webmcp-protocol` re-exports it); `source` export condition keeps dev on TypeScript source | build output inspected; `import('./dist/index.js')` smoke |
| LICENSE, marketplace manifest | `LICENSE` (MIT); `.claude-plugin/marketplace.json` passes `claude plugin validate` | validator output |
| Fresh-machine quickstart | `scripts/fresh-check.sh` copies the repo without `node_modules`, installs, typechecks, tests, builds plugin bundles and the package, runs the bundled daemon and the page-link check on spare ports | passed |
| Login-item copy refresh | `ensure-daemon.sh` refreshes `$STATE/bin/*.js` from the plugin bundles when they differ and restarts the login item if loaded | implemented; launchd itself not exercised here |
| Replayed history cosmetics | the adapter folds the attached ui-state resource into replayed user text; the session model strips it | unit test |

Still open by design or unverifiable here: c27 (registering the login item needs your consent; `install-launchd --dry-run` was checked), the Local Network Access prompt ([F-16](#F-16)), and the launchd plist carrying the installing shell's full PATH. The extension remains future work (§13). Nothing is committed to git yet.

Where things are: `packages/connector` (npm package, `./react` subpath), `demo-site`, `plugin` (manifest, `.mcp.json`, hooks, scripts, skill, `commands/setup.md`, bundles), `bridge` (daemon source), `scripts/e2e` (the checks above, token-free except M3–M5), `README.md`, `PRIVACY.md`.

## 12. Where the earlier questions and decisions went

| Earlier item | In this plan |
|---|---|
| Stage 1 Q-1 process model | [D-1](#D-1), [D-16](#D-16): daemon started by the plugin hook |
| Stage 1 Q-2 tool exposure | [D-23](#D-23) |
| Stage 1 Q-3 content-script scope | [D-15](#D-15) (wontfix, extension out of scope) |
| Stage 1 Q-4 polyfill | [D-2](#D-2): shim in the package |
| Stage 1 Q-5 science-kg | [D-22](#D-22) (from the combined plan's Q-6) |
| Stage 1 Q-6 extras | [D-26](#D-26); screenshot dropped; token replaced by origin approval ([D-8](#D-8)) |
| Stage 1 D-1…D-6 | [D-2](#D-2), [D-3](#D-3), [D-7](#D-7), [D-7](#D-7), [D-10](#D-10), [D-6](#D-6) |
| Stage 2 Q2-1 unify | [D-1](#D-1) |
| Stage 2 Q2-2 ingress | [D-14](#D-14) (from the combined plan's Q-1) |
| Stage 2 Q2-3 permissions | [D-24](#D-24) + [D-19](#D-19) |
| Stage 2 Q2-4 chat UI | [D-21](#D-21) (from the combined plan's Q-4) |
| Stage 2 Q2-5 credentials | [D-25](#D-25) |
| Stage 2 Q2-6 protocol version | [D-4](#D-4) |
| Stage 2 Q2-7 extras | [D-26](#D-26); per-turn context and `CLAUDE.md` moved into §6 |
| Stage 2 D2-1…D2-5 | [D-4](#D-4), [D-1](#D-1), [D-4](#D-4), [D-5](#D-5), [D-9](#D-9) |
| Stage 2 F2-2 (ACP endpoint security) | merged into [F-4](#F-4) |
| Combined rev 1 Q-1, Q-8 | [D-14](#D-14), [D-15](#D-15) |
| Combined rev 2 Q-4, Q-6 | [D-21](#D-21), [D-22](#D-22) |
| Combined rev 2 Q-2, Q-3, Q-5, Q-7, Q-9, Q-10 | [D-23](#D-23), [D-24](#D-24), [D-25](#D-25), [D-26](#D-26), [D-27](#D-27), [D-28](#D-28) |
| Placeholder names `webmcp-bridge` | `webmcp-daemon` (daemon, plugin); `webmcp-connector` kept (§14) |
| Combined rev 1 checks c18–c20 (extension) | removed with the extension; see §13 |
| Brief questions 1 and 2 (steering, UI state) | §6, [D-17](#D-17), [D-18](#D-18), [D-27](#D-27), [D-28](#D-28) |

---

**Addendum (2026-11-05):** the fixed port in §5 is now the first of an ordered candidate list, with one daemon per state directory and a stdio relay for Claude Code's MCP config: [daemon-port-discovery/main.md](../daemon-port-discovery/main.md).

## 13. Future work (not in scope)

- **Chrome extension for third-party WebMCP sites**: content script = the package's mirror module in the isolated world, service worker as the `/ws` client, popup for approval; design and hacks recorded in the [Stage 1 plan](../stage1-webmcp-bridge/main.md) (its §5.4, F-3, F-6, F-9). Also the only way to put a Claude chat *beside* a site you do not control (extension side panel).
- **MCP-over-ACP** once the Claude adapter advertises it (removes the per-page HTTP MCP endpoints).
- **science-kg integration** as its own plan once the three deliverables exist ([D-22](#D-22)); cross-origin iframe tools; editor-grade ACP features in the page; publishing beyond a marketplace entry.
- **In-chat widgets** (page-provided cards for tool calls in the embedded chat, a form for agent-asked questions, a floating panel for terminal Claude's calls): built under its own plan, [in-chat-widgets](../in-chat-widgets/main.md) (2026-11-05).

## Codex audit — 2026-11-05

**Codex verdict (initial, on `e4904af`):** The core architecture is present, but the daemon currently has browser-reachable security bypasses around the intended origin approval boundary. There are also concrete robustness and lifecycle issues in launchd setup, ACP process handling, MCP name dispatch, and the React/demo UI that should be fixed before considering the patch correct.
**Issue counts (Codex's):** P0:0 P1:2 P2:5 P3:0 (Codex omitted the `ISSUES:` line; counted from its findings)
**Follow-up verdict (on the fix diff):** The source-level fixes do not reach the plugin runtime because the checked-in daemon bundle that the plugin installs/runs was not regenerated. The React cleanup also still leaks an ACP handle when unmount races with connection startup. (P1:1 P2:1, both fixed below.)

**Changes made in response** (commit `b9f96e0` and the follow-up commit):
- `bridge/src/http.ts` — `/call` and `/approve` require `content-type: application/json` and, when a browser `Origin` is present, the daemon's own origin (`/approve`) or an approved page origin (`/call`); closes the `no-cors` POST bypass (finding 1).
- `bridge/src/security.ts` — `isSiteOrigin()`: only normalised `http(s)` origins can be approved; `"null"`, `file:`, `data:`, `blob:` and extension origins are rejected before any approval page opens (finding 2).
- `plugin/commands/setup.md` — `install-launchd --state-dir "${CLAUDE_PLUGIN_DATA}/state"`, the same directory the hooks use, so the SessionStart hook can refresh the login item (finding 3).
- `bridge/src/mcp.ts` — meta-tools dispatched by an exact-name set, so a page tool named `webmcp_*` is mirrored and callable; and on per-page endpoints `webmcp_get_context` resolves that page rather than the globally selected one (finding 4, plus an adjacent bug found while fixing it).
- `bridge/src/acp.ts` — `child.once('error')` fails the ACP connection and keeps the daemon alive when an agent command cannot be spawned (finding 5).
- `packages/connector/src/react/index.tsx` — one model subscription per handle, the live handle closed on unmount, and a mounted flag so a connection that completes after unmount is closed instead of published (finding 6 and follow-up finding 2).
- `demo-site/src/main.ts` — tool list and call log render page-controlled strings as text (finding 7).
- `plugin/daemon/*.js` — bundles rebuilt from the fixed sources (follow-up finding 1); `bun run check:bundles` now fails when the committed bundle is stale.

**Deferred / not actioned:**
- None: all seven initial findings and both follow-up findings were verified against the code and fixed. A local process that forges `Origin` or sends header-less POSTs remains out of scope by design (D-8, §5.5), reaffirmed by the user on 2026-11-05. Suggested but not decided: a configuration-only origin allow-list with the approval prompt disabled as the deployment default.

Codex's full final messages saved at `/tmp/codex-audit-20261104-190456-report.md` (initial) and `/tmp/codex-audit-20261104-191431-report.md` (follow-up).
