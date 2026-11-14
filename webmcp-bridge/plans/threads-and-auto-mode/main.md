**Status:** implemented and verified 2026-11-05 (36 unit tests, token-free browser run `m8-threads.mjs`, one paid run `m5-chat.mjs`); results in §11
**Update 2026-11-05 (rev 3, implemented):** T1–T5 built and committed (four commits plus docs); every check ticked with its evidence; §11 records the two browser runs, including what auto mode did with a shell write.
**Update 2026-11-05 (rev 2):** the user answered all four questions in the viewer; decisions D-36–D-39 record them; T3 and [F-25](#F-25) updated for the workspace-settings part of Q-12.
**Date:** 2026-11-04
**Scope:** The embedded chat in the `webmcp-connector` npm package gets real *threads*: one ACP connection per chat panel can hold many sessions, the panel lists every stored thread of the page and switches between them, and new threads start in Claude Code's **auto** permission mode. The daemon, the plugin and the wire protocol do not change.
**Inputs:** [plans/main.md](../main.md) · [Combined plan](../combined/main.md) (§4.3 `connectAgent`, §6.2 tool policy, [D-24](../combined/main.md#D-24), [D-27](../combined/main.md#D-27), [F-14](../combined/main.md#F-14)) · `packages/connector/src/agent.ts`, `session-model.ts`, `react/index.tsx` · `node_modules/@agentclientprotocol/sdk` 2.4.0 (`dist/v1/stable/acp.js`, `dist/v1/schema/types.gen.d.ts`) · `node_modules/@agentclientprotocol/claude-agent-acp` 0.100.0 (`dist/acp-agent.js`, `dist/session-mode.js`, `dist/session-titles.js`, `dist/session-index/connection.js`) · the page's stored transcript under `~/.claude/projects/-Users-josephc--webmcp-daemon-workspaces-127-0-0-1-5173/`
**Related plans:** [Project goals and plan index](../main.md) · [Combined plan (implemented)](../combined/main.md)

---

# Chat threads in the npm package: list, switch, and auto mode by default

> **Reading this on GitHub?** This plan is written in the interactive-plan format, a markdown dialect with tags for questions, decisions, findings and checklists. GitHub drops the tags, so the titles, statuses, severities, dates and chosen answers are missing here, and what remains reads as loose prose. Open the raw file to see them, or ask Joseph for a PDF export of the full plan.

## 0. Brief (verbatim)

Chat message, 2026-11-04:

> I see we can create new threads, but can we improve the npm package to list all threads and allow switching
>
> Set the permission at auto by default

My reading (not the user's words): "threads" are the embedded chat's ACP sessions (the **New** button already creates one, but the previous one disappears from the panel); "list all threads" means every stored session of *this page*; "switching" means opening an older thread with its history and continuing it; "the permission" is the permission-mode dropdown in the chat header, which today starts in **Manual** (`default`) and which the user has been switching to **Auto** by hand (§2.3).

---

## 1. Summary

### 1.1 What changes

| Where | Today | After this plan |
|---|---|---|
| `webmcp-connector` core (`agent.ts`) | `connectAgent()` = one WebSocket to `/acp` = one adapter process = **one** session; "new" means throw the socket away and open another | one **`AgentConnection`** per chat panel holding many threads; `listThreads()`, `openThread(id?)`, `closeThread()`, `deleteThread()`; per-thread `AgentHandle`s with their own `SessionModel`; `connectAgent()` kept as a one-call convenience (§4.1) |
| `webmcp-connector/react` `<AgentChat>` | **New** button; last session id remembered in `localStorage` | a **Threads** button and panel: every stored thread of the page with title, age and state; click to switch; **New thread**; delete (Q-13); last-opened thread still resumes after a reload (§4.4) |
| Permission mode | starts in `default` ("Manual"): every non-read tool asks | new threads start in **`auto`** when the agent offers it; the dropdown still lets the user change it; resumed threads keep their own mode (Q-12) (§4.3) |
| Tests | `session-model.test.ts`; `m5-chat.mjs` (paid); echo agent for the picker | token-free unit tests of the connection against an in-process fake agent; the echo agent learns sessions so a browser-driven thread test (`m8-threads.mjs`) costs nothing; `m5` learns the auto-mode expectations (§7) |

### 1.2 What does not change

The daemon (`bridge/`), the plugin, the `/ws` protocol, the demo page's tools, the terminal path. Listing and switching are entirely between the page and the Claude adapter over ACP, which already implements everything needed (§3). No plugin bundle rebuild is required unless Q-12's third option is chosen.

### 1.3 Facts the design rests on (details in §3)

- The ACP SDK's **stable** v1 `methods.agent.session` table has `list`, `load`, `close`, `delete`, `setMode`; the Claude adapter implements all of them and advertises `loadSession: true` plus `sessionCapabilities { list, close, delete, resume, fork }`.
- `session/list { cwd }` returns the sessions stored for exactly that directory, newest first, with a title (user-set, else Claude Code's AI-generated title, else the first prompt) and `updatedAt`. The page's workspace directory is per origin, so "all threads of this page" is one call.
- `session/close` frees a thread's Claude process without deleting anything; `session/load` later replays its history.
- The adapter **ignores** `_meta.claudeCode.options.permissionMode`; the initial mode is the resumed transcript's last mode, else the workspace settings' `defaultMode`. The documented way for a client to pick a mode is `session/set_mode`. The catalogue is `default` (Manual), `acceptEdits`, `plan`, `auto` (plus `bypassPermissions` only when allowed, which we never allow).
- **Auto mode is available on this account**: the page's one stored transcript carries `"permissionMode":"auto"` records next to `"default"` ones, i.e. the user has already been selecting it from the dropdown.

---

## 2. What exists today

### 2.1 Package core

`packages/connector/src/agent.ts:43` `connectAgent(page, opts)` opens `createWebSocketStream(acpUrl)`, runs `initialize`, then either `session/load { sessionId, cwd, mcpServers, _meta }` (when `resumeSessionId` is given and the agent advertises `loadSession`) or `session/new`. One `SessionModel` receives every `session/update`, whatever its `sessionId` (`agent.ts:75`), and every permission request lands in that same model (`agent.ts:64`). `handle.close()` closes the socket; the daemon then stops the adapter process five seconds later (`bridge/src/acp.ts:93`).

### 2.2 React panel

`packages/connector/src/react/index.tsx:62` `connect()` reads `localStorage["webmcp-connector:session:<origin>"]` and passes it as `resumeSessionId`; `newSession()` (`index.tsx:75`) closes the handle, forgets the stored id and connects again. There is no way to get back to the previous session except the stored id after a reload. The header already has the permission-mode `<select>` fed by `snap.modes` (`index.tsx:100`).

### 2.3 Permission mode

The daemon writes `permissions.defaultMode: "default"` into each workspace's `.claude/settings.json` once (`bridge/src/workspace.ts:18`); the adapter reads it as the starting mode. The page's stored transcript shows the user switching: `grep -o '"permissionMode":"[a-z]*"' ~/.claude/projects/-Users-josephc--webmcp-daemon-workspaces-127-0-0-1-5173/*.jsonl | sort | uniq -c` → `2 "auto"`, `10 "default"`.

---

## 3. Evidence (verified in source, 2026-11-04)

### 3.1 ACP SDK 2.4.0 (stable v1 surface)

| Item | Where | What it says |
|---|---|---|
| Methods | `node_modules/@agentclientprotocol/sdk/dist/v1/stable/acp.js:100` | `session: { new, load, list, delete, resume, close, setMode, setConfigOption, prompt, cancel }` — all stable, no `unstable` import needed |
| `ListSessionsRequest` / `Response` | `dist/v1/schema/types.gen.d.ts` | `{ cwd?, cursor? }` → `{ sessions: SessionInfo[], nextCursor? }`; `SessionInfo = { sessionId, cwd, title?, updatedAt?, additionalDirectories? }` |
| `SessionNotification` | same | `{ sessionId, update }`: every `session/update` names its session, so routing to per-thread models is a lookup |
| `NewSessionResponse` / `LoadSessionResponse` | same | both carry `modes: { currentModeId, availableModes[] }` |
| `SessionCapabilities` | same | `{ list?, delete?, close?, resume?, additionalDirectories? }` on `agentCapabilities.sessionCapabilities` |
| `Stream` | `dist/core/stream.d.ts:13` | `{ readable, writable }` of JSON-RPC messages: an in-memory pair of `TransformStream`s connects a client and an agent in one process (used by the unit tests, §7.1) |

### 3.2 claude-agent-acp 0.100.0

| Item | Where | What it does |
|---|---|---|
| Capabilities | `dist/acp-agent.js:1432` | `sessionCapabilities = { additionalDirectories, close, delete, fork, list, resume, systemPrompt }`; `loadSession: true` |
| `listSessions` | `dist/acp-agent.js:1638` | `cwd` must be absolute; calls the Agent SDK's `listSessions({ dir: cwd, includeWorktrees: false, limit: 1001, offset })`; returns `{ sessionId, cwd, title: sanitizeTitle(session.summary), updatedAt: ISO(lastModified) }`, newest first; a cursor only after 1,000 sessions |
| What `summary` is | `@anthropic-ai/claude-agent-sdk/sdk.d.ts:6146` | "custom title, auto-generated summary, or first prompt" |
| Titles | `dist/session-titles.js:1` | Claude Code titles a session from its first prompt with a small model a few seconds in (stored as an `ai-title` record); the adapter publishes it as `session_info_update { title }`, which `SessionModel` already stores (`session-model.ts:99`). The page's transcript has `"aiTitle":"Page UI state snapshot"` |
| `loadSession` | `dist/acp-agent.js:1614` | loads from disk and **replays history**; if the session is already loaded on this connection it still replays again → a thread must always be loaded into a fresh `SessionModel`, or not re-loaded at all |
| `closeSession` | `dist/acp-agent.js:6964` | idempotent; cancels a running turn as `session/cancel` would, then tears down the session's Claude process; the transcript stays on disk |
| `deleteSession` | `dist/session-index/connection.js:259` | tears the session down if loaded, then deletes the stored transcript |
| Mode catalogue | `dist/session-mode.js:230` | `default` "Manual", `acceptEdits` "Accept edits", `plan` "Plan", `auto` "Auto — Claude handles permission decisions"; `bypassPermissions` only when allowed (we send `allowDangerouslySkipPermissions: false`, so never) |
| Initial mode | `dist/session-mode.js:22`, `dist/acp-agent.js:9102` | explicit (internal, used by forks) → the resumed transcript's last mode → settings `permissions.defaultMode`; `auto` falls back to `acceptEdits` with a warning notice when the current model has `supportsAutoMode !== true` |
| `permissionMode` in `_meta.claudeCode.options` | `dist/acp-agent.js:453` | listed under "Managed or ignored by the adapter": **not** forwarded; so the client selects a mode with `session/set_mode` |
| `setSessionMode` | `dist/session-mode.js:149` | validates against `availableModes`, calls `query.setPermissionMode`, publishes `current_mode_update` and the `mode` config option |
| Load timing | `~/.webmcp-daemon/daemon.log` | `[session/load] … phase=session-ready durationMs=919` and `1646` on this machine |

### 3.3 Process model (unchanged, but it shapes the switch policy)

Each ACP connection is one adapter process (`bridge/src/acp.ts:76`); inside it, each *loaded* session is one Claude Code CLI process owned by the Agent SDK `query`. A connection that keeps five threads loaded runs five CLIs. `session/close` is how a client gives one back. The daemon's idle reaper (10 minutes without traffic on the connection, `bridge/src/config.ts:37`) and the 5-second grace after the browser leaves are unchanged.

---

## 4. Design

### 4.1 Core: one connection, many threads

```ts
// packages/connector/src/agent.ts  (public surface; implementation moves to src/agent-connection.ts)
export type PermissionModeId = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions' | 'dontAsk' | (string & {});

export interface AgentOptions {
  // unchanged: instructions, systemPromptMode, toolPolicy, autoAllowReadOnly, context, claudeOptions, agent, model
  /** Thread to open first (session/load); omitted → a new thread. Unchanged name. */
  resumeSessionId?: string;
  /** Mode for NEW threads, applied with session/set_mode when the agent offers it. Default 'auto'; null = leave the agent's own default. */
  defaultMode?: PermissionModeId | null;
  /** What happens to the thread you switch away from. Default per Q-11. */
  switchPolicy?: 'keep-while-prompting' | 'close';
}

export interface ThreadInfo {
  id: string;
  /** Claude Code's title (user-set > AI-generated > first prompt). Undefined until the first prompt is stored. */
  title?: string;
  /** ISO time from session/list; for a live thread, the last local activity. */
  updatedAt?: string;
  /** 'stored' = known from session/list only; the rest are live on this connection. */
  state: 'stored' | 'ready' | 'prompting' | 'needs-permission';
  active: boolean;
}

export interface AgentConnection {
  readonly agentId: string;
  readonly agentName?: string;
  /** false when the agent lacks loadSession or sessionCapabilities.list (the echo test agent today): the UI hides the thread list. */
  readonly supportsThreads: boolean;
  readonly supportsDelete: boolean;
  readonly threads: ThreadInfo[];
  readonly active: AgentHandle | undefined;
  listThreads(): Promise<ThreadInfo[]>;            // session/list { cwd: workspaceDir }, merged with live state; notifies
  openThread(id?: string): Promise<AgentHandle>;   // id → session/load into a fresh SessionModel; none → session/new (+ defaultMode); becomes active
  closeThread(id: string): Promise<void>;          // session/close; keeps the stored entry
  deleteThread(id: string): Promise<void>;         // session/delete (closes first if live); removes the entry
  onThreadsChange(l: (threads: ThreadInfo[]) => void): () => void;
  onActiveChange(l: (handle: AgentHandle | undefined) => void): () => void;
  close(): void;                                   // closes the socket; the daemon stops the adapter 5 s later (unchanged)
}

export interface AgentHandle {                     // one thread; model and sessionId never change
  readonly connection: AgentConnection;
  readonly model: SessionModel;
  readonly sessionId: string;
  readonly agentId: string;
  prompt(text: string): Promise<{ stopReason: string }>;
  cancel(): Promise<void>;
  setMode(modeId: string): Promise<void>;
  setAutoAllowReadOnly(on: boolean): void;
  readonly autoAllowReadOnly: boolean;
  /** session/close of this thread. A handle returned by connectAgent() also closes the connection it opened (compat). */
  close(): void;
}

export function openAgent(page: PageConnection, opts?: AgentOptions): Promise<AgentConnection>;   // connection, no thread yet
export function connectAgent(page: PageConnection, opts?: AgentOptions): Promise<AgentHandle>;    // openAgent() + openThread(opts.resumeSessionId)
```

Behaviour:

| Operation | What happens |
|---|---|
| `openAgent` | `initialize`; reads `agentCapabilities.loadSession` and `sessionCapabilities.{list,close,delete}` into `supportsThreads` / `supportsDelete`; builds `cwd`, `mcpServers`, `_meta` once (same values as today, `agent.ts:82`–`91`); registers the `session/update` and `requestPermission` handlers, which route by `params.sessionId` to that thread's `SessionModel` (unknown id → ignored, logged once). `autoAllowReadOnly` stays one setting per connection |
| `openThread()` (new) | `session/new` → fresh `SessionModel`; then, if `defaultMode` is set, offered in `modes.availableModes` and differs from `currentModeId`, `session/set_mode` (§4.3). Appears in `threads` at the top as a live entry without a title until its first prompt is stored |
| `openThread(id)` | already active → returns the active handle; live but not active (only under `keep-while-prompting`) → just makes it active, no replay; otherwise `session/load` into a fresh model (history replays as today, `session-model.test.ts:23`). A failing load (deleted transcript) rejects; `connectAgent()` keeps today's fallback of opening a new thread instead (`agent.ts:95`) |
| switching away | per `switchPolicy` (Q-11): `keep-while-prompting` closes an idle previous thread, keeps a prompting one live until its turn ends and then closes it if it is still not active; `close` always closes (cancelling a running turn) |
| `listThreads()` | `session/list { cwd }`; result merged with live threads (live state wins; a live thread missing from the list, i.e. no prompt stored yet, is kept); sorted newest first by `updatedAt`, live-and-unstored first; agents without `list` → the live threads only |
| refresh triggers | after `openAgent`, after every `openThread`, when any thread's turn ends (titles and `updatedAt` change), on `session_info_update { title }` (patch the entry, no round trip), when the UI opens the panel, and on an explicit call. No polling |
| `deleteThread(id)` | `session/delete`; the active thread cannot be deleted while prompting; deleting the active idle thread leaves `active` undefined and the UI opens a new thread |
| connection loss | the stream's `connectWith` promise settles → every live model gets `state: 'error'`, `active` becomes undefined, `onActiveChange` fires; the React panel shows the error and the Connect button as it does today |

Internals: the testable core is `openAgentConnection({ stream, cwd, mcpUrl, meta, agentId, defaultMode, switchPolicy, autoAllowReadOnly, readOnlyTools })` in `src/agent-connection.ts`, taking an ACP `Stream`; `openAgent(page, opts)` only derives those values from the page and creates the WebSocket stream, so unit tests use an in-memory stream pair (§7.1).

### 4.2 What a thread list shows

Per entry: the title (or "New thread" when none yet), relative age from `updatedAt` ("2 min ago"), a state mark (`prompting` spinner, `needs-permission` badge), and `active`. Threads belong to a page's workspace directory, so the list is per origin: two tabs of the same page see the same stored threads (see [F-22](#F-22) for the one caveat). Threads of other pages are not shown; they belong to other workspaces and other tools.

### 4.3 Default permission mode: `auto`

- `AgentOptions.defaultMode` defaults to `'auto'`; `<AgentChat agentOptions={{ defaultMode: 'default' }}>` or `null` opts out. No daemon change: the adapter ignores a mode in `_meta` (§3.2), and the workspace `settings.json` stays at `default` as the baseline for any other client.
- Applied with `session/set_mode { modeId: 'auto' }` right after `session/new`, only if `auto` is in `availableModes`; the model's `modes.current` is updated from the response path exactly as `handle.setMode()` does today (`agent.ts:125`). Agents without modes (the echo agent, other ACP agents) are untouched.
- Resumed threads keep the mode stored in their transcript (the adapter's rule); Q-12 asks whether to override that.
- If the model does not support auto, the adapter switches to `acceptEdits` and sends a warning notice, which our client (no `notice` capability) receives as transcript text in the log: visible, not fatal.
- The read-only pre-allow (`autoAllowReadOnly`, `allowedTools: mcp__page__get_state`) stays as is; it is independent of the mode.
- `preamble()` line 4 ("Some actions require the user's permission; a prompt appears in the page…") stays true in auto mode, since auto still escalates what its classifier will not decide; the README's "every non-read tool prompts" comment (`README.md:40`) is corrected to "auto mode by default; pages can pin a mode or a `toolPolicy`".

Consequence to be clear about ([F-19](#F-19)): under [D-24](../combined/main.md#D-24) the per-call prompt was the second safety boundary after origin approval. In auto mode Claude Code's own classifier decides most calls, including shell and file tools in the scratch workspace, and the page sees a prompt only for what it escalates. The user asked for this default; the origin approval, `toolPolicy.disallowedTools`, `allowDangerouslySkipPermissions: false` (bypass never offered) and the mode dropdown remain.

### 4.4 React `<AgentChat>`

- Header gains **Threads ▾** (with the count) next to **New**; hidden when `!connection.supportsThreads`. **New** becomes `openThread()` on the existing connection (no reconnect).
- Clicking Threads toggles a panel between the header and the log: entries from §4.2, **New thread** at the top, a refresh control, and per entry a delete affordance (Q-13) with an inline two-step confirm (no `window.confirm`, which some embedding contexts block). Esc closes the panel. Clicking an entry calls `openThread(id)`; while loading, the entry shows "loading…" and the input stays disabled.
- The component holds `connection` and the active `handle`; its model subscription follows the active handle (one subscription per handle, as today, `index.tsx:59`). `onHandle` fires on every switch (the demo's `window.__demo.agent` keeps working). Unmount closes the connection.
- `rememberSession` (default true) now means "reopen the last active thread after a reload": the same `localStorage` key stores the active thread id on every switch.
- Footer: `session abc123` becomes the thread title when one exists.
- Styles: `.wmc-threads`, `.wmc-thread[data-active][data-state]` added to `react/styles.ts`; no new dependency.
- New props: `threads?: boolean` (default true; false hides the button even when supported). Existing props unchanged.

### 4.5 Compatibility

- `connectAgent(page, opts)` keeps its signature and return type; `handle.model`, `sessionId`, `prompt`, `cancel`, `setMode`, `close` behave as before for a single thread. `close()` on a handle from `connectAgent()` also closes the connection (so the demo's and `m5-chat.mjs`'s expectations hold); on a handle from `openThread()` it closes only that thread.
- Exports added to `index.ts` and `react/index.tsx`: `openAgent`, `AgentConnection`, `ThreadInfo`, `PermissionModeId`.
- Package version 0.0.1 → 0.0.2; the `client: 'webmcp-connector/0.0.1'` hello string (`index.ts:71`) reads the version from one constant.

---

## 5. Open questions

<open-question id="Q-11" title="What happens to the thread you switch away from?" status="answered">
Each loaded thread is one Claude Code process inside the adapter (§3.3). Switching has to decide whether the previous thread stays loaded.

<options select="single">
  <option id="keep-while-prompting">**Keep it only while it is mid-turn (suggested).** An idle thread is closed with `session/close` when you switch away (reopening replays its history in about a second). A thread that is still answering keeps running in the background; the list shows it as *prompting* (or *needs permission* if it is waiting on you), and it is closed once its turn ends if you have not come back. At most one idle process per panel; long tasks are never cut off by a switch.
  </option>
  <option id="close">**Always close.** Switching always ends the previous thread's process; a running turn is cancelled. Simplest state machine; the UI disables switching while a turn is running ("Stop first"). Nothing ever runs in the background.
  </option>
  <option id="keep-all">**Keep everything loaded** until the panel disconnects. Instant switching back, no replay, but N threads = N Claude processes until the daemon's idle reaper (10 min) kills the adapter. Not suggested.
  </option>
</options>

<answer by="user" at="2026-11-05T04:44" chose="keep-while-prompting">

</answer>
</open-question>

<open-question id="Q-12" title="Where does the auto default apply?" status="answered">
`auto` is applied with `session/set_mode` after `session/new` (§4.3). The question is what to do for threads that are resumed, including the one existing thread of the demo page.

<options select="single">
  <option id="new-only">**New threads only (suggested).** A resumed thread keeps the mode stored in its transcript, which is how Claude Code itself resumes. Your existing demo thread was last used in `auto`, so it comes back in `auto` anyway. The dropdown always lets you change it.
  </option>
  <option id="every-open">**Every open.** Resumed threads are also set to `auto` unless the page opted out, so the dropdown always starts at Auto. Overrides a mode the user set on purpose in an older thread.
  </option>
  <option id="also-settings">**New threads only, and the daemon also writes `defaultMode: "auto"`** into new workspaces' `.claude/settings.json` so other ACP clients of the same workspace start in auto too. Needs a daemon change and a plugin bundle rebuild; existing workspaces keep their file (it is written once).
  </option>
</options>

<answer by="user" at="2026-11-05T04:44" chose="also-settings">

</answer>
</open-question>

<open-question id="Q-13" title="Delete threads from the panel?" status="answered">
The adapter's `session/delete` removes the stored transcript (§3.2). Not in the brief, but a list without it fills up with one-line experiments.

<options select="single">
  <option id="delete-yes">**Yes, with an inline confirm (suggested).** A small × per entry; the entry turns into "Delete? yes / no"; the active thread cannot be deleted while it is prompting.
  </option>
  <option id="delete-no">**No.** List and switch only; threads accumulate on disk under `~/.claude/projects/…`. Could be added later.
  </option>
</options>

<answer by="user" at="2026-11-05T04:44" chose="delete-yes">

</answer>
</open-question>

<open-question id="Q-14" title="Run the paid end-to-end check?" status="answered">
The unit tests and `m8-threads.mjs` cost nothing (fake agent). Only a real Claude run proves two things: that your account's model starts in `auto` (rather than falling back to `acceptEdits`), and that Claude Code's generated titles show up in the list. `m5-chat.mjs` already spends roughly a dollar per run ([F-14](../combined/main.md#F-14)); the added steps cost a few cents more.

<options select="single">
  <option id="paid-yes">**Yes, run the extended `m5-chat.mjs` once (suggested)** and record the result in this plan's checklist.
  </option>
  <option id="paid-no">**No.** Rely on the token-free tests and on a manual check in the demo page; tick c38 and c39 by hand.
  </option>
</options>

<answer by="user" at="2026-11-05T04:44" chose="paid-yes">

</answer>
</open-question>

---

## 6. Decisions

<decision id="D-31" title="One ACP connection per chat panel holds many threads; switching uses session/load and session/close on that connection" status="proposed" date="2026-11-04">
`openAgent()` returns an `AgentConnection`; threads are sessions on it; `session/update` and permission requests are routed by `sessionId` to per-thread `SessionModel`s (§4.1).
<rationale>ACP connections are multi-session by design and the adapter keeps sessions in a map keyed by id. The alternative, one WebSocket per thread as today, would spawn a new adapter process per switch (daemon `acp.ts:76`) and pay its start-up on top of the load; it would also make listing awkward, since `session/list` needs a connection. Measured `session/load` is about a second; an adapter spawn adds another.</rationale>
</decision>

<decision id="D-32" title="The thread list is session/list filtered by the page's workspace directory, merged with the connection's live state" status="proposed" date="2026-11-04">
No daemon endpoint and no reading of `~/.claude/projects` by hand: the adapter already lists sessions per `cwd`, with titles and timestamps, from Claude Code's own storage (§3.2). Titles arrive asynchronously via `session_info_update` and patch the list without a round trip.
<rationale>Keeps the daemon out of a feature that is purely between the page and its agent, and keeps the package agent-agnostic: any ACP agent that advertises `sessionCapabilities.list` gets the same panel; one that does not (the echo agent) hides it.</rationale>
</decision>

<decision id="D-33" title="New threads start in Claude Code's auto permission mode, selected by the connector with session/set_mode" status="proposed" date="2026-11-04">
`AgentOptions.defaultMode = 'auto'` by default; applied only when the agent offers that mode; pages opt out per option or per `toolPolicy`. Supersedes the "every non-read tool prompts" *default* of [D-24](../combined/main.md#D-24) for new threads; the rest of D-24 (full Claude Code in the scratch workspace, bypass never offered) stands.
<rationale>The user's instruction (§0) and their observed behaviour (switching to auto by hand, §2.3). `set_mode` is the only client-side channel the adapter honours for the mode (§3.2); it is a documented ACP method and agent-neutral.</rationale>
</decision>

<decision id="D-34" title="The daemon, plugin and wire protocol are not touched" status="proposed" date="2026-11-04">
Nothing under `bridge/` or `plugin/` changes except the one-line workspace settings default of [D-37](#D-37) (Q-12's third option), after which the bundles are rebuilt and committed (`bun run check:bundles` passes).
<rationale>Everything needed is already in the adapter; keeping the daemon out keeps the change reviewable and avoids a bundle rebuild.</rationale>
</decision>

<decision id="D-35" title="The echo test agent learns sessions so thread tests stay token-free" status="proposed" date="2026-11-04">
`scripts/e2e/fake-agent.mjs` gains `loadSession: true`, `sessionCapabilities { list, close, delete }`, an in-memory store with titles, replay on load, and a `default`/`auto` mode catalogue; the unit tests use the same fake in-process through an in-memory `Stream` pair.
<rationale>Every behaviour in §4.1 (routing, switch policy, list merge, default mode) is agent-independent and can be proven without spending tokens; a single paid run (Q-14) covers what only Claude can show.</rationale>
</decision>

<decision id="D-36" title="Switch policy: keep a thread loaded only while it is mid-turn" status="locked" date="2026-11-05" from="Q-11">
`switchPolicy` defaults to `keep-while-prompting`: an idle thread is closed with `session/close` when the user switches away; a thread still answering keeps running in the background, is shown as *prompting* or *needs permission* in the list, and is closed once its turn ends if it is no longer active. `close` remains as an option.
<rationale>User's answer to Q-11 (2026-11-05). At most one idle Claude process per panel; long tasks are never cut off by a switch.</rationale>
</decision>

<decision id="D-37" title="Auto applies to new threads via session/set_mode, and the daemon writes defaultMode: auto into new workspaces" status="locked" date="2026-11-05" from="Q-12">
Resumed threads keep the mode stored in their transcript. In addition `bridge/src/workspace.ts` writes `permissions.defaultMode: "auto"` (still with `disableBypassPermissionsMode: "disable"`) when it creates a workspace's `.claude/settings.json`, so other ACP clients of the same workspace start in auto too. Existing workspaces keep their file (it is written once). This is the one daemon change of this plan; the plugin bundles are rebuilt and committed ([D-34](#D-34) amended).
<rationale>User's answer to Q-12 (2026-11-05): "also-settings". The adapter reads the workspace settings itself and passes the mode to the CLI explicitly (§3.2), so the CLI's project-tier filter for escalating modes does not apply.</rationale>
</decision>

<decision id="D-38" title="Threads can be deleted from the panel, with an inline confirm" status="locked" date="2026-11-05" from="Q-13">
A × per entry turns into "Delete? yes / no"; `session/delete` removes the stored transcript; the active thread cannot be deleted while prompting; deleting the active idle thread opens a new one.
<rationale>User's answer to Q-13 (2026-11-05).</rationale>
</decision>

<decision id="D-39" title="One paid end-to-end run of the extended m5-chat.mjs" status="locked" date="2026-11-05" from="Q-14">
Run once after the token-free tests pass; record the auto-mode outcome, the generated titles and the switch in the checklist (c38, c39, c41).
<rationale>User's answer to Q-14 (2026-11-05).</rationale>
</decision>

---

## 7. Work breakdown

| # | Step | Files | Done when |
|---|---|---|---|
| T1 | Core connection: `openAgentConnection()`, routing by `sessionId`, `openThread/closeThread/deleteThread/listThreads`, switch policy, default mode, `connectAgent()` compat wrapper | `packages/connector/src/agent-connection.ts` (new), `agent.ts`, `index.ts` | `bun run typecheck` passes; unit tests in T4 pass |
| T2 | Thread panel in `<AgentChat>`: Threads button and list, New on the same connection, delete (Q-13), localStorage of the active thread, footer title | `packages/connector/src/react/index.tsx`, `react/styles.ts` | panel works in the demo against the echo agent and against Claude |
| T3 | Auto default: `defaultMode` option, `set_mode` after `session/new`; the daemon writes `defaultMode: "auto"` into new workspaces ([D-37](#D-37)) and the plugin bundles are rebuilt; docs for the opt-out | `agent-connection.ts`, `bridge/src/workspace.ts`, `plugin/daemon/*.js`, `README.md`, `preamble.ts` (wording check only) | a new thread shows **Auto** in the dropdown; a fresh workspace's `settings.json` says `auto` |
| T4 | Tests: in-process fake agent + `agent-connection.test.ts`; `fake-agent.mjs` sessions; `m8-threads.mjs` (browser, echo agent); `m5-chat.mjs` auto-mode expectations and a thread switch with real Claude (Q-14) | `packages/connector/test/`, `scripts/e2e/` | `bun test` green; `node scripts/e2e/m8-threads.mjs` green; m5 result recorded |
| T5 | Docs and bookkeeping: README (React chat, developer snippet, permissions sentence), package version 0.0.2, `plans/main.md` index line, a dated pointer line at the top of the combined plan, this plan's status | `README.md`, `packages/connector/package.json`, `plans/` | `bun run build:connector` succeeds; `scripts/fresh-check.sh` still passes |

Order: T1 → T4 (unit part) → T2 → T3 → T4 (browser part) → T5. Each step is one commit.

### 7.1 Test design

**Unit (`bun test`, no tokens).** A fake agent built with `acp.agent()` and connected to the connection under test through two `TransformStream`s: `initialize` (capabilities configurable per test), `session/new` (modes `default` + `auto`), `session/load` (replays stored chunks), `session/list` (store, newest first, titles), `session/close`, `session/delete`, `session/set_mode`, `session/prompt` (echoes; a prompt containing `slow` stays open until the test releases it; one containing `ask` sends `session/request_permission`). Cases:

1. new thread → `set_mode('auto')` sent once; `modes.current === 'auto'`; agent without `auto` → no call, no error; `defaultMode: null` → no call
2. `listThreads()` newest first with titles; a live unstored thread stays on top as "New thread"; `session_info_update { title }` patches the entry
3. switch from an idle thread → `session/close` of the old id, `session/load` of the new one into a fresh model, `active` and `onActiveChange` updated
4. switch while prompting (`keep-while-prompting`) → old thread stays live, its later chunks land in **its** model, not the active one; it is closed after its turn ends; under `close` policy the turn is cancelled and closed at once
5. a permission request for a background thread lands in that thread's model and marks it `needs-permission`
6. `deleteThread` → `session/delete`, entry removed, closed first if live
7. `connectAgent()` compat: `resumeSessionId` loads; a failing load falls back to a new thread; `handle.close()` closes the connection
8. agent with `loadSession: false` → `supportsThreads === false`; `openThread(id)` rejects with a clear message

**Browser, no tokens (`scripts/e2e/m8-threads.mjs`).** Daemon started with `--agent echo=node scripts/e2e/fake-agent.mjs`, demo page in a throwaway Chrome (`cdp.mjs`): pick echo, connect, prompt "one", New, prompt "two", open Threads → two entries, click the first → its history ("one") is shown, delete the second → one entry, reload → the last active thread resumes, the mode dropdown shows Auto.

**Browser, paid (`scripts/e2e/m5-chat.mjs`, Q-14).** After "session ready": assert `modes.current === 'auto'` (report `acceptEdits` plus the fallback notice if the model lacks auto). The mutating-tool step accepts either a prompt (then allows it) or no prompt (auto-approved) and records which. New steps: New thread → prompt → Threads lists two entries with Claude's titles → switch back → replayed history matches.

---

## 8. Acceptance checklist

**Core**
<check id="c31" status="done">`bun run typecheck && bun test` pass with the new `agent-connection.test.ts` (cases 1–8 of §7.1). — *36 tests pass: 13 connection cases (`packages/connector/test/agent-connection.test.ts`), the workspace default, and the earlier suites*</check>
<check id="c32" status="done">In the demo page, **Threads** lists the page's stored threads newest first with titles and ages; the active one is marked. — *`m8-threads.mjs` step "thread list" (newest first, active marked, the switched-away thread as *stored*); `m5-chat.mjs` listed three threads with Claude's titles "Mango", "Pong", "Page UI state snapshot"*</check>
<check id="c33" status="done">Clicking an older thread shows its history within about two seconds; sending a message continues that thread (the reply references its earlier turns). — *m8 "switch back" replayed both messages and "continue thread one" got a reply in that thread; m5 "switch back" replayed 5 turns about 1.5 s after the click*</check>
<check id="c34" status="done">Switching away from an idle thread frees its process: the daemon's `/status.json` agent count does not grow with switches; `ps` shows one Claude CLI per live thread only (policy per Q-11). — *m8: one adapter before and after a new thread; m5: `/health` showed one adapter after the switch; unit case 3 pins the `session/close` of the idle thread*</check>
<check id="c35" status="done">Under `keep-while-prompting`: start a long answer, switch to another thread, come back: the answer completed in the background and is shown in full. — *unit cases 4 and 4b (a slow prompt keeps running while another thread is active, lands in its own model, is released after its turn); not driven in a browser*</check>
<check id="c36" status="done">**New thread** opens a fresh thread on the same connection (no reconnect, no adapter spawn in the daemon log); the previous thread is still in the list. — *m8 and m5 "new thread": same adapter count, previous thread still listed*</check>
<check id="c37" status="done">Reload the page: the last active thread resumes (as today), and the list still shows all the others. — *m8 "resume after reload": same thread, 4 replayed messages, list intact; m5 "resume after reload": same session, 5 turns*</check>

**Auto mode**
<check id="c38" status="done">A new thread starts with the dropdown at **Auto**; `~/.claude/projects/…/<id>.jsonl` carries `"permissionMode":"auto"` from its first user record. — *m5 "session ready" and "new thread": mode `auto`; both transcripts under `~/.claude/projects/-Users-josephc--webmcp-daemon-workspaces-127-0-0-1-5173/` carry `"permissionMode":"auto"` only*</check>
<check id="c39" status="done">In auto mode, "make the background #0066cc" runs the page tool without a prompt (or with one, if Claude's classifier escalates it; record which), and a shell write to the scratch workspace behaves as Claude Code's auto mode decides. — *m5: `set_background_color` ran without a prompt (recorded as auto-approved); the shell write `echo hi > note.txt` also ran without a prompt and created the file in the scratch workspace (§11)*</check>
<check id="c40" status="done">`agentOptions={{ defaultMode: 'default' }}` restores today's behaviour (every non-read tool prompts) and the dropdown starts at Manual. — *unit case 1b: `defaultMode: null` sends no `set_mode`; an agent without `auto` stays in `default`; not driven in a browser*</check>

**Compatibility and docs**
<check id="c41" status="done">`m5-chat.mjs` passes end to end with its updated expectations (if Q-14 says yes); `m8-threads.mjs` passes token-free; the echo agent picker still works. — *m5 passed end to end (the echo picker step skipped because the login-item daemon runs without `--agent`); m8 covers the echo agent through the picker*</check>
<check id="c42" status="done">`bun run build:connector` emits `openAgent`, `AgentConnection` and `ThreadInfo` in `dist/index.d.ts`; `bun run check:bundles` passes without a rebuild (D-34). — *`bun run build:connector` emits `openAgent`, `AgentConnection`, `ThreadInfo`, `PermissionModeId`, `SwitchPolicy` in `dist/index.d.ts`; `bun run check:bundles` passes against the rebuilt bundle (D-37 changed the daemon)*</check>
<check id="c43" status="done">README describes threads and the auto default with the opt-out; `plans/main.md` indexes this plan. — *README "Threads" and "Permission mode" paragraphs; `plans/main.md` indexes this plan; the combined plan carries a pointer line*</check>

---

## 9. Risks

<finding id="F-19" title="Auto mode moves the per-call decision from the user to Claude Code's classifier" severity="p1" status="open" effort="small">
With [D-24](../combined/main.md#D-24) an approved page's embedded Claude needed the user's click for every non-read action. In auto mode the classifier allows most of them, including `Bash` and file writes in the scratch workspace (Bash is not confined to it), and prompts only for what it escalates. Requested by the user (§0); mitigations that remain: origin approval ([D-8](../combined/main.md#D-8)), `toolPolicy.disallowedTools` for pages that want no shell, bypass never offered, the dropdown, and the opt-out option. The README says this plainly.
</finding>

<finding id="F-20" title="session/list, close and delete are new in ACP and the adapter's `_meta` surface keeps moving" severity="p2" status="open" effort="small">
They are in the SDK's *stable* v1 method table (§3.1) and implemented by adapter 0.100.0, but they come from a recent RFD; both packages are pinned ([D-7](../combined/main.md#D-7)). `supportsThreads` is read from `initialize` at runtime, so an agent without them degrades to today's single-thread panel rather than failing.
</finding>

<finding id="F-21" title="Each live thread is a Claude Code process" severity="p2" status="open" effort="small">
Covered by the switch policy (Q-11): idle threads are closed on switch, so a panel holds at most one idle process plus any still-running turns. The daemon's idle reaper and 5-second grace are unchanged.
</finding>

<finding id="F-22" title="Two tabs can load the same thread at once" severity="p3" status="open" effort="small">
The list is per origin, so a second tab of the same page can open a thread the first tab already has live; two Claude processes then append to one transcript. Claude Code has the same exposure with two `claude --resume` of one session. Not guarded here; the list could mark threads live in *other* connections later (the adapter's AIR session index does this, but only for JetBrains clients).
</finding>

<finding id="F-23" title="Titles lag the first prompt by a few seconds and may be absent" severity="p3" status="open" effort="small">
Claude Code generates the title with a small model after the first prompt; until then `session/list` reports the first prompt and a brand-new thread has no stored entry at all. The list shows "New thread" and patches the title from `session_info_update` when it arrives; a refresh after each turn catches the rest. With `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set the adapter asks for the title itself.
</finding>

<finding id="F-24" title="Re-loading an already loaded thread replays its history twice" severity="p3" status="open" effort="small">
`loadSession` replays even when the session is live on the connection (§3.2). The connection therefore never re-loads a live thread (it just makes it active) and always loads into a fresh `SessionModel`; unit case 3 pins this.
</finding>

<finding id="F-25" title="m5-chat's permission expectations change under auto mode" severity="p3" status="open" effort="small">
Its step "mutating page tool → permission prompt → allow once" assumed Manual. The updated script accepts either outcome and records it (§7.1); on 2026-11-05 it recorded "auto-approved" for the page tool and for the shell write. `m4-relay.mjs` sets no mode, so with [D-37](#D-37) a *fresh* test workspace starts it in auto as well; its step labels are reworded to say the prompt may not appear (the script records outcomes, it does not assert them).
</finding>

---

## 10. Out of scope (possible later)

- **Rename a thread**: the adapter only offers it through the JetBrains `_session/rename` extension; the spec-level `session/set_title` is unstable in the SDK and not registered by the adapter.
- **Branch a thread** (`session/fork`, which the adapter advertises): "continue from here in a new thread".
- **Archive** instead of delete; threads live in other tabs marked as such ([F-22](#F-22)); a notification when a background thread finishes or needs a permission while the panel shows another thread (the state mark in the list is the first step).
- Threads across pages, or a thread list on the daemon's status page.

---

## 11. Implementation status (2026-11-05)

Built in the order T1 → T5 and committed in four code commits plus one for docs and plans (`git log`). Daemon, plugin and protocol untouched except the one-line workspace default of [D-37](#D-37) (bundle rebuilt, `bun run check:bundles` passes). Package version 0.0.2.

| Check | Result | Evidence |
|---|---|---|
| Unit | 36 pass: 13 connection cases against the in-process fake agent (default mode, list and titles, switch and replay, keep-while-prompting, close policy, permission routing, auto-allow, delete, agents without threads, close and drop, `connectAgent` compat), the workspace default, the earlier suites | `bun test` |
| Browser, no tokens | private daemon on 8718 with the echo agent: connect in `auto` → thread one → **New** on the same adapter → list newest first with the active one marked and the other *stored* → switch back with the two messages replayed → continue in it → delete the second (inline confirm) → reload resumes the first with four messages → disconnect stops the adapter; whole run 11 s | `node scripts/e2e/m8-threads.mjs` |
| Browser, paid | against the login-item daemon on 8717: session ready in **`auto`** (catalogue `default, acceptEdits, plan, auto`); `get_state` without a prompt; `set_background_color` **auto-approved** (no prompt; page turned `rgb(0, 102, 204)`); the shell write `echo hi > note.txt` **also ran without a prompt** and created the file in the scratch workspace; reload resumed the same session (5 turns, mode `auto`); **New** opened a second thread in `auto` on the same adapter; the Threads panel listed three threads with Claude's generated titles ("Mango", "Pong", and the pre-existing "Page UI state snapshot"); switching back replayed the 5 turns in about 1.5 s with one adapter process left | `node scripts/e2e/m5-chat.mjs` |
| Fresh checkout | `scripts/fresh-check.sh` (copy without node_modules/dist/bundles → install, typecheck, 36 tests, both builds, bundled daemon and page link on spare ports): passed, `m1 fresh: connected`, 5 tools after the bonus registration | `bash scripts/fresh-check.sh` |

Observations worth keeping:

- **Auto mode and the shell** ([F-19](#F-19) in practice): Claude Code's classifier let `echo hi > note.txt` run in the page's scratch workspace without a prompt. Pages that must not have that pass `toolPolicy.disallowedTools: ['Bash']` or `defaultMode: 'default'`; the README says so.
- **Stop mid-turn** reported `end_turn` in the paid run because the 400-number answer completed within the 1.5 s before the Stop click (1,491 characters streamed); the cancel path is unchanged by this plan and was verified earlier (combined plan c13).
- **Adapter count** in m5's "new thread" step read 2 before and after because the pre-reload Chrome's adapter was still in its 5-second grace; after the switch it read 1.
- The echo agent used by the picker now keeps its sessions in `.echo-agent-sessions.json` inside the workspace it is spawned in, so a reload (a new adapter process) sees the same threads.
