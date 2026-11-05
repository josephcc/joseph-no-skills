**Status:** implemented and verified 2026-11-05 (57 unit tests, token-free browser run `m9-widgets.mjs`, two paid runs of `m5-chat.mjs`, fresh-checkout check, four Codex audits); results in §12
**Update 2026-11-05 (rev 4, implemented):** W1–W6 built; every check ticked with its evidence; §12 records the runs, the one defect the paid run exposed outside the feature (frame-based refresh in a hidden tab) and its fix; the Codex audit records follow §12.
**Update 2026-11-05 (rev 3):** review pass on Q-16 and Q-22; D-54 locked, D-55 added; P3's removal propagated (§1.1, §1.2, §4.1, §4.4, §4.6, §4.7, §4.9–4.11, W1/W3/W4/W5, c48/c49/c53/c55, F-27/F-28, §10); details pinned in the self-review: claims live in the core connection and fire on both call start and item arrival, the activity block follows the ui-state block and is stripped on replay, failed results lose the adapter's code fence, the terminal section stays under the hook cap, a widget's `prompt()` refuses while the thread is busy.
**Update 2026-11-05 (rev 2):** review pass on the user's answers; science-kg's "no blocking tools" and its three outcome channels recorded (§2.2 item 9, §4.4); §11 rewritten from a note into a survey with a verdict (adopt the convention every chat library shares, use ACP elicitation, keep MCP Apps as a possible later mirror).
**Date:** 2026-11-05
**Scope:** Page-provided **widgets** rendered inside the embedded chat (`webmcp-connector/react` `<AgentChat>`) in place of the generic tool-call row: a page maps a tool name to a React component, the component receives the call's input and result, keeps its own state across reloads and thread switches, can act on the page, send a follow-up message, or answer a tool that is waiting for the user. The same components can be shown by a small **floating widget panel** on the page (a stack of cards pinned to a corner, outside the chat) for calls made by terminal Claude (best effort). The daemon, the wire protocol and the plugin do not change except one optional environment line for blocking widgets.
**Inputs:** [plans/main.md](../main.md) · [Combined plan](../combined/main.md) (§6.4 mapping table, [D-21](../combined/main.md#D-21), [D-22](../combined/main.md#D-22), [D-18](../combined/main.md#D-18)) · [Threads plan](../threads-and-auto-mode/main.md) (`AgentConnection`, `SessionModel`) · science-kg `causal-graph-viewer/src/components/ChatPanel.tsx`, `src/hooks/useChatSession.ts`, `src/agent/clientToolHandlers.ts`, `src/utils/syntheticChatParts.ts`, `src/components/chat/ProposalModal.tsx`, `server/agent/serverTools.ts`, `shared/agent/systemPrompt.ts`, `plan/chatbot/chatbot_context_and_tools.md`, `plan/chatbot/concept_first_proposal_flow.md` · `packages/connector/src/{index,agent,agent-connection,session-model,preamble}.ts`, `src/react/index.tsx` · `node_modules/@agentclientprotocol/claude-agent-acp` 0.100.0 (`dist/tool-calls/renderer.js`, `dist/tool-calls/content.js`, `dist/elicitation.js`, `dist/acp-agent.js`) · `node_modules/@agentclientprotocol/sdk` 2.4.0 (`dist/v1/schema/types.gen.d.ts`) · this page's stored transcript under `~/.claude/projects/-Users-josephc--webmcp-daemon-workspaces-127-0-0-1-5173/`
**Related plans:** [Project goals and plan index](../main.md) · [Combined plan (implemented)](../combined/main.md) · [Threads and auto mode (implemented)](../threads-and-auto-mode/main.md)

---

# In-chat widgets: page-provided cards for tool calls in the embedded chat, and a floating widget panel for terminal Claude

## 0. Brief (verbatim)

Chat message, 2026-11-05:

> Look into the use cases of science-kg, and let's address one missing feature here, in-chat widgets!
>
> first explore how that is done in the science-kg repo, then plan out how to do it here.
>
> If possible, we should support both embeded chat and terminal claude, but embedded chat takes absolute priority and its okay if terminal claude is not fully supported for this use case

My reading (not the user's words): "in-chat widgets" are what science-kg's `ChatPanel` does when a tool call lands in the transcript: instead of a collapsed "called tool X" row it renders a purpose-built card (a proposal with checkboxes and an **Add** button, a row of suggested replies, an evidence card whose excerpts open the PDF). Here the embedded chat renders every page tool call as a `<details>` dump of input and output (`packages/connector/src/react/index.tsx:303`). The feature is the mechanism that lets a page replace that dump with its own component, with the interaction patterns science-kg relies on. science-kg itself is not modified ([D-22](../combined/main.md#D-22)); §2.3 says what its cards would need to run here.

---

## 1. Summary

### 1.1 What changes

| Where | Today | After this plan |
|---|---|---|
| `webmcp-connector/react` `<AgentChat>` | every tool call renders as `ToolCallView`: a `<details>` with raw input and output (`react/index.tsx:303`) | a `widgets` prop maps **page tool names** to React components; a matching tool call renders the component (any status, pending through completed) inside a `.wmc-widget` frame with a raw-data toggle; unmapped tools keep the row (§4.2–4.3) |
| Widget contract | none | `WidgetProps`: the tool's input and parsed result, status, a stable id, `restored`, `live`, persisted `state`/`setState`, `prompt()`, `note()`, and a reserved `settle` for tools that wait for the user (P3, deferred; §4.1) |
| How the model learns what the user did in a card | nothing (the `page://ui-state` snapshot only, if the page puts it there) | an **activity log** on the page connection: `note()` entries ride along with the next prompt as a `page://widget-activity` resource and with the terminal hook's state text (§4.5); nothing is injected into the agent's transcript ([D-43](#D-43)) |
| Blocking tools ("ask the user, then return their answer") | not possible: a tool that does not return times out in 60 s with nothing to click | `page.awaitUser(tool, args, signal)`: the tool waits, the widget shows the question and settles it; bounded by the daemon's call timeout (§4.7). **Deferred** to a later round ([D-54](#D-54)): the design stays in §4.7; of it only the call list and the claims the floating panel needs are built |
| Agent-asked questions | Claude's `AskUserQuestion` is disabled by the adapter because the client offers no form capability | the connector advertises `elicitation.form`; the panel renders the question as a form; MCP elicitations from any server reach the page the same way (§4.8) |
| Terminal Claude | a page tool call is visible only in the page's own call log | `<FloatingWidgetPanel page widgets>` shows the same components for calls that no chat panel claimed (§4.9); `prompt()` is absent there, everything else works |
| Demo page | four tools, a call log, the chat | two widget tools (a palette proposal, suggested replies), Claude's `AskUserQuestion` rendered as a form, and the floating panel; `preamble()` learns a paragraph about cards (§4.10) |
| Tests | 36 unit tests; `m5` (paid), `m8-threads` (free) | unit tests for routing, parsing, call claims, the activity log, elicitation; the fake agent learns to emit tool calls and elicitations; `m9-widgets.mjs` (free, through the real browser); optional paid steps in `m5` (Q-21) |

### 1.2 What does not change

The daemon (`bridge/`), the `/ws` protocol, the MCP surface and the plugin: nothing under `bridge/` or `plugin/` changes and no bundle is rebuilt (the one candidate, an `MCP_TOOL_TIMEOUT` line for blocking widgets, went with P3, [D-54](#D-54)). The tool-call path is untouched: the page still executes its tools itself, the result still reaches the model as text, and the generic row still renders for every tool without a widget.

### 1.3 Facts the design rests on (details in §3)

- For a page tool the Claude adapter sends an ACP `tool_call` with **`name: "mcp__page__<tool>"`**, `rawInput` = the arguments, `title` = the same name, `kind: "other"`, and `_meta.claudeCode.toolName`; the result arrives as a `tool_call_update` whose `content[0].content.text` is **the tool's own result string** (the daemon's JSON text), with `status: "completed"` or `"failed"`. There is no `rawOutput` for these results. `session/load` replays the same frames through the same converter, with the same `toolCallId` (`toolu_…`).
- The page sees every call to its tools, from either Claude, as a daemon `call` frame with the tool name and arguments, and answers it from its own `execute` (`packages/connector/src/index.ts:122`). The embedded chat's calls arrive **after** the transcript item that announces them.
- The adapter forwards Claude's `AskUserQuestion` and any MCP server's elicitation to the ACP client as a **form** request when the client advertises `clientCapabilities.elicitation.form`; without it `AskUserQuestion` is removed from the tool set.
- WebMCP tool annotations are a fixed four-key dictionary; Chrome's `getTools()` returns exactly those keys. A widget binding cannot ride on the tool registration ([F-31](#F-31)); it is a map by name on the page side.
- science-kg renders cards from the Vercel AI SDK's `tool-<name>` message parts once their output is available, joins live card state through an index the tool wrote into its own output, falls back to a read-only twin for restored threads, and tells the model in the system prompt what each card shows so it does not repeat it (§2).
- No existing protocol defines page-native components for tool calls over ACP (§11): MCP Apps and the OpenAI Apps SDK ship server HTML into sandboxed iframes, A2UI and json-render let the model compose UI from a catalogue, AG-UI leaves rendering to the client, and ACP has no UI RFD. What exists is an application-level convention shared by assistant-ui, CopilotKit, LangGraph and the Vercel AI SDK: tool name → component receiving input, output and status, plus a respond callback. §4.1 follows it.

---

## 2. How science-kg does it (the reference)

Paths below are under `/Users/josephc/git/s2/science-kg/causal-graph-viewer/`.

### 2.1 The widget catalogue

| Tool (declared in `server/agent/serverTools.ts`) | Card | What the user does with it | Where its live state lives | On a restored thread |
|---|---|---|---|---|
| `propose_add_triples` (`:136`, no `execute`: runs in the browser) | `ProposedTriplesCard` (`ChatPanel.tsx:2030`) | reviews rows grouped by canvas cost, toggles checkboxes, clicks **Add N …** (applies through the same batch handler the sidebar uses), undo | `useChatSession.proposals: ProposalState[]` (`useChatSession.ts:398`), joined to the part by the `pN.M` index parsed out of the tool's output (`extractProposalIndex`, `ChatPanel.tsx:2370`); `checkedPathKeys` and the applied record are saved with the thread | `ResumedProposalCard`: read-only from the persisted output (`ChatPanel.tsx:2050`) |
| `propose_concepts` (`:282`) | `ProposedConceptsCard` (`ProposedConceptsCard.tsx:28`) | clicks **+ Add** on one row: the concept lands on the canvas and a *relations widget* appears underneath with no model turn | `conceptCards`, joined by `card_index` in the output (`ChatPanel.tsx:2363`); live canvas membership decides the row's state | no read-only twin: the generic row, "the user asks again" (`ChatPanel.tsx:2067`) |
| `propose_remove` (`:731`) | `ProposedRemovalsCard` | like the triples card, with cascade rows | `removalCards` by `card_index` | `ResumedRemovalCard` |
| `ask_paper` (`:23`, server-side) | `AskPaperCard` (`chat/AskPaperCard.tsx`) | reads the answer, clicks an excerpt → `PdfHighlightModal` opens on that page | the modal's props in `ChatPanel` state; the card itself is pure | renders the same (pure) |
| `suggest_next_messages` (`:554`) | `SuggestedMessagesRow` (`ChatPanel.tsx:2174`) | clicks a chip → `sendMessage(text)`; disabled while a response streams | none | renders the same |
| `filter_theory` (`:715`) | `FilterTheoryCard` (`ChatPanel.tsx:2231`) | toggles a sidebar filter; **not** gated on streaming, since it sends nothing | `activeTheoryFilterId` = the part's `toolCallId` | renders; the toggle state is session-only |
| `generate_pathway_hypotheses`, `revise_…`, `ask_pathway_agent` (`:926`) | `PathwayRunCard` (`chat/PathwayRunCard.tsx`) | watches a long run the tool started; the card shows the result when it lands, the model is not re-invoked | `pathwayRunByCall: Map<toolCallId, runId>` (`ChatPanel.tsx:1785`) | shows the persisted output |
| everything else | `ToolCallRow` (`ChatPanel.tsx:2385`) | expands to see input and output | none | same |

### 2.2 The mechanics, in order

1. **Tools are declared server-side without `execute`** (`serverTools.ts:129`). The Vercel AI SDK streams the call to the browser; `useChat`'s `onToolCall` (`useChatSession.ts:885`) dispatches by name to `clientToolHandlers.ts` (`handleProposeAddTriples`, `:1279`), which reads live React state through a context ref and returns a trimmed, model-facing result; `addToolResult` sends it back and `sendAutomaticallyWhen` continues the agent loop (`useChatSession.ts:955`).
2. **The handler also writes a side channel** (`ctx.onProposedTriples(...)`): the card's rich state (`ProposalState`, `useChatSession.ts:237`) with the pool rows, labels, checked set, applied record. The model-facing result carries only ids and a few numbers, plus the join key (`pending_id: "pN.M"`, `card_index`).
3. **`ChatPanel` renders parts by type** (`ChatPanel.tsx:1873`–`2130`): `part.type === 'tool-propose_add_triples' && part.state === 'output-available'` → look up the side-channel entry by the index parsed from `part.output` → the live card; no entry → the read-only twin; other `tool-*` parts → `ToolCallRow`.
4. **The prompt tells the model what the card shows**, so it does not repeat it: "usually nothing at all after propose_add_triples … the widget speaks for it" (`systemPrompt.ts:63`); a whole section "What the propose_add_triples widget shows the user" (`:905`); the tool description itself repeats the rule (`serverTools.ts:159`).
5. **Durable widget state**: the card writes its checked set back into the proposal on every toggle; proposals and cards are serialised with the thread (`chatThread.ts`), so a reload restores the selection; `restored: true` marks a rehydrated card for telemetry.
6. **Click-driven flows inject synthetic parts** (`syntheticChatParts.ts:1`, their D8/D11): clicking a concept builds a relations proposal client-side and appends a fabricated `tool-propose_add_triples` part plus a gray status line (a real `user` message with metadata) to `messages`, with no model turn. Their plan records why: "Can we render a widget without a model turn? **Only by injecting a part.**" (`plan/chatbot/concept_first_proposal_flow.md:384`). The model sees the injected pair on its next turn, which is deliberate; ids are prefixed `synthetic-` so logs can tell them apart; the append must not race the stream (`canInjectSynthetic`).
7. **Busy gating is per card**: chips that send a message are disabled while a response streams; toggles that only touch page state are not (`ChatPanel.tsx:2004`).
8. **Release 4 moved one widget into a modal** over the chat sidebar (`chat/ProposalModal.tsx:1`), with the status line as the reopen affordance; the part stays in the transcript, only its render moved.
9. **How the agent learns what the user did.** Three channels, each for a different action, none a general "the user did X in a card" message. (a) The canvas summary on every turn (`src/utils/buildCanvasSummary.ts`): after an Add, the new nodes and edges simply appear; nothing says "accepted", and the summary carries no provenance. (b) A journal for removals only, `removed_this_thread` (`src/utils/removalMemory.ts`, `buildCanvasSummary.ts:251`): oldest first, the most recent 50, each marked `you` (a card the agent proposed and the user applied), `rule`, or the user by hand, paired with the prompt rule "do not re-propose anything under removed_this_thread" (`systemPrompt.ts:233`). It exists because an absent edge looks the same whether it was never added or was taken away. (c) A real user message for concept clicks, "I added the concept "X" to my canvas." (`syntheticChatParts.ts:202`), first person on purpose so the model credits the add to the user. Silent: accepting or ignoring a triples card, filter toggles, dismissals.

### 2.3 What transfers and what does not

| science-kg mechanism | Here | Notes |
|---|---|---|
| `tool-<name>` part with `state: 'output-available'` | ACP `tool_call` item with `name: mcp__page__<tool>` and `status: completed` | same shape of information: input, output text, status, stable call id (§3.2) |
| handler runs in the browser over live state, returns a trimmed result | the page's WebMCP `execute` does exactly this already | no new concept |
| side channel keyed by an index in the output | the page's own state keyed however it likes; the tool may still write an id into its output (the demo does) | optional; a widget can render from input and output alone |
| read-only twin for restored threads | `restored: true` on replayed items (§4.6); the widget decides | same degradation rule |
| prompt guidance ("the widget speaks for it") | `preamble()` paragraph + a description convention (§4.5) | the page writes its own instructions anyway |
| durable widget state in the thread | `state`/`setState` persisted per thread and call id in `localStorage` (§4.6) | ACP gives the page no slot in the transcript |
| synthetic parts (a widget without a model turn) | **not available**: an ACP client cannot append to the agent's history | substitute: the widget renders page UI directly, and `note()` tells the model next turn ([F-29](#F-29)) |
| suggestion chips → `sendMessage` | `prompt(text)` on the thread | gated on `live` |
| long-running run cards | the widget subscribes to page state by an id from the output | page-owned, nothing to add |
| how the agent learns outcomes | the canvas summary; the `removed_this_thread` journal; a user message for concept clicks (§2.2, item 9) | `page://ui-state` (the page's `context()`); the activity resource ([D-49](#D-49)), which generalises the journal; `prompt()` when a model turn is wanted | the same three channels, one level up |
| modal host | out of scope; a widget is a page component and may portal itself anywhere | §10 |

---

## 3. What exists here today

### 3.1 The tool-call path and its rendering

Embedded: Claude (inside `claude-agent-acp`, spawned by the daemon) calls `mcp__page__<tool>` on the page-scoped MCP endpoint → the daemon sends `call { callId, name, args, timeoutMs }` over `/ws` → `onCall` in `packages/connector/src/index.ts:122` runs `executeTool` and answers `call/result` → the daemon's `normaliseResult` (`bridge/src/normalise.ts:9`) turns the string into MCP content (JSON objects become pretty-printed text plus `structuredContent`) → Claude Code records the result → the adapter emits the ACP frames of §3.2 → `SessionModel.applyUpdate` stores a `ToolCallItem` (`session-model.ts:87`) → `TurnView` renders `ToolCallView` (`react/index.tsx:290`, `:303`).

Terminal: the same from `mcp__webmcp__<tool>` on the global endpoint; the page sees the identical `call` frame; nothing renders in the page except the demo's call log (`demo-site/src/main.ts:123`).

### 3.2 What the ACP frames carry for a page tool (verified in adapter 0.100.0)

| Frame | Fields | Source |
|---|---|---|
| `tool_call` (first report) | `toolCallId` (Claude's `toolu_…`), **`name: toolUse.name`** (`mcp__page__set_background_color`), `rawInput` (the arguments, sent even while streaming for non-AIR clients), `status: "pending"`, `title`, `kind`, `content: []`, `_meta.claudeCode.toolName` | `dist/tool-calls/renderer.js:105`–`130` (`toolCall`), `:572` (`toolUseMeta`) |
| title and kind for an MCP tool | `GenericReporter`: `title` = the tool name, `kind: "other"` | `dist/tool-calls/reporters/index.js:39`, the class below it |
| `tool_call_update` (input complete) | `rawInput`, `title`, `kind`, `_meta` | `renderer.js:131` (`refinement`) |
| `tool_call_update` (result) | `status: "completed"` or `"failed"`; **`content: [{ type: "content", content: { type: "text", text } }]`** where `text` is the stored tool result; **no `rawOutput`** ("the raw tool_result goes to rawOutput only when no other field carries the result") | `renderer.js` `result()`, `resultFacts()` → `resultText()` → `toAcpContentUpdate()` in `dist/tool-calls/content.js:46`; the untracked fallback in `dist/acp-agent.js:11087` is the only `rawOutput` path |
| what Claude Code stored for a real call on this page | `tool_use { name: "mcp__page__set_background_color", input: { color: "green" } }`; `tool_result { content: "{\"backgroundColor\":\"green\",…}" }` (a plain string); `toolUseResult` the same string | `~/.claude/projects/-Users-josephc--webmcp-daemon-workspaces-127-0-0-1-5173/2fed3939-….jsonl` |
| replay on `session/load` | the stored messages go through the same `toAcpNotifications` with a fresh `toolUseCache`, so `tool_call` and `tool_call_update` replay with the same ids, input and content | `dist/acp-agent.js:7116` (`replaySessionHistory`), `:7464` |
| permission request | `toolCall: { toolCallId, name, rawInput, title, kind, content, status }` for non-AIR clients | `renderer.js:169` (`permissionToolCall`) |
| schema | `ToolCall.name?: string | null`, `ToolCallUpdate.rawOutput?: unknown`, `ToolCallContent = content | diff | terminal` | `sdk/dist/v1/schema/types.gen.d.ts:2420`, `:140`, `:220` |

Consequences: the widget key is `name` with the `mcp__page__` prefix removed (fallback `_meta.claudeCode.toolName`); the widget's data is the text of the first content block, parsed as JSON when it parses; both survive a reload. The `SessionModel` already keeps `name`, `content`, `rawInput` and `rawOutput` on the item (`session-model.ts:8`), so the core change is a pair of helpers, not a new model.

### 3.3 What the page sees on both paths

`connect()` keeps an `inflight` map of abort controllers per daemon `callId` (`index.ts:44`) and reports `start`/`end` through the optional `onToolCall` callback (`index.ts:127`, `:131`, `:136`) with `{ callId, name, args, ok, result, error, durationMs }`. There is no subscribable event, no list of in-flight calls, and no way for a tool to hand the user a question and wait: a tool that does not resolve is aborted by the daemon after `callTimeoutMs` (60 s default, `bridge/src/config.ts:36`, `--call-timeout-ms`).

Ordering, embedded path: the adapter emits `tool_call` when the assistant's `tool_use` block streams; the CLI then executes the MCP call, which reaches the page as a `call` frame. So the transcript item precedes the page-side call, and the result frame follows the page's answer.

### 3.4 The adapter's elicitation support (verified)

- `initialize` from the connector sends `clientCapabilities: {}` (`agent-connection.ts:171`).
- With `clientCapabilities.elicitation.form` set, Claude's built-in `AskUserQuestion` is presented as an ACP `elicitation/create` **form** request on the client and the answers become the tool's input (`dist/acp-agent.js:8143`, `handleAskUserQuestion` `:8337`); without it the adapter adds `AskUserQuestion` to `disallowedTools` (`:9123`). MCP servers' own elicitations are forwarded the same way (`handleMcpElicitation`, `:8298`); unsupported modes are answered `cancel`.
- The form schema is a flat object: per question a `string` with `oneOf: [{ const, title, description? }]` (single select) or an `array` with `items.anyOf` (multi select), plus a companion `string` field titled "Other" (`dist/elicitation.js`, `askUserQuestionsToCreateRequest`). MCP form elicitations use primitive-typed properties (string, number, integer, boolean, enum), normalised by the same module.
- Client methods: `acp.methods.client.elicitation.create` (request) and `.complete` (notification, URL mode only); `ElicitationFormCapabilities` is `{}` (`types.gen.d.ts:3110`, `sdk/dist/v1/stable/acp.js:129`).

### 3.5 Terminal path

`plugin/hooks/hooks.json`: `SessionStart` injects the page's instructions, `UserPromptSubmit` runs `inject-state.sh`, which prints `GET /state?page=selected` (the page's `context()` through `context/request`, or the daemon's cache). Anything the connector appends to the `context/result` text therefore reaches terminal Claude with every prompt, and `webmcp_get_context` on demand ([D-28](../combined/main.md#D-28)).

---

## 4. Design

### 4.1 The widget contract

Core package (`packages/connector/src/widgets.ts`, framework-free):

```ts
export type WidgetStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface WidgetInstance<I = Record<string, unknown>, O = unknown> {
  /** The page tool's own name as given to registerTool (sanitised like the daemon does). */
  tool: string;
  /** Stable id: the ACP toolCallId (Claude's toolu_…) in a chat thread; the daemon callId in the floating panel. */
  id: string;
  status: WidgetStatus;
  /** The call's arguments (ACP rawInput; the daemon call's args). */
  input: I;
  /** The tool's result as the model received it: the first text content block (undefined until completed). */
  text?: string;
  /** `text` parsed as JSON when it parses; otherwise undefined. */
  output?: O;
  /** failed / cancelled: the error text (the daemon's "name: ErrorName: message", with the adapter's code fence removed). */
  error?: string;
  /** Where the instance was observed. */
  source: 'chat' | 'page';
  sessionId?: string;                 // chat only
  /** Replayed by session/load (or reloaded from storage in the floating panel): no live call behind it. */
  restored: boolean;
  /** Reserved for blocking widgets (P3, deferred by D-54): never set in this round. */
  settle?: { resolve(value: unknown): void; reject(reason?: string): void; signal: AbortSignal };
}

export function pageToolOf(item: ToolCallItem): string | undefined;          // 'mcp__page__x' → 'x'; also reads _meta.claudeCode.toolName
export function widgetInstanceOf(item: ToolCallItem, ctx: { sessionId: string; restored: boolean; pending?: PendingCall }): WidgetInstance;
```

React (`webmcp-connector/react`):

```ts
export interface WidgetProps<I = Record<string, unknown>, O = unknown, S = unknown> extends WidgetInstance<I, O> {
  /** The thread is mid-turn (chat only). Disable actions that send a message; page-only actions may stay enabled. */
  live: boolean;
  /** Persisted per (origin, thread or page, id) in localStorage; undefined until set (§4.6). */
  state: S | undefined;
  setState(next: S | ((prev: S | undefined) => S)): void;
  /** Send a user message to this thread (suggestion chips). Absent in the floating panel; rejects while `live`. */
  prompt?: (text: string) => Promise<{ stopReason: string }>;
  /** Record what the user did in this card, for the model's next turn (§4.5). */
  note(text: string): void;
  thread?: AgentHandle;
}
export type WidgetComponent<I = any, O = any, S = any> = React.ComponentType<WidgetProps<I, O, S>>;
export type WidgetMap = Record<string, WidgetComponent>;
```

A widget is the page's own component: it imports the page's stores, opens the page's modals, calls the page's functions. The panel gives it the call and three small services (state, prompt, note); it asks nothing else of it.

### 4.2 Declaring widgets

```tsx
const WIDGETS: WidgetMap = { propose_palette: PaletteCard, suggest_replies: RepliesRow };
<AgentChat page={page} widgets={WIDGETS} />
<FloatingWidgetPanel page={page} widgets={WIDGETS} />   // terminal Claude, §4.9
```

Keys are page tool names. A registry on the page connection (`page.widgets.set(name, component)`) is the alternative in [Q-15](#Q-15); the prop form is the proposal because it keeps React types out of the core package and makes the binding visible where the panel is mounted. Tool names are sanitised the way the daemon sanitises them (`[^A-Za-z0-9_-]` → `_`, `bridge/src/normalise.ts:27`), so a tool registered as `a.b` and mirrored as `a_b` still matches under either spelling.

### 4.3 Routing: from a transcript item to a widget

In `TurnView` (`react/index.tsx:290`): for a `tool_call` item, `tool = pageToolOf(item)`; if `widgets[tool]` exists render

```
<div class="wmc-widget" data-tool data-status>
  <Component {...props} />
  <details class="wmc-widget-raw"><summary>propose_palette · completed</summary><pre>input / output</pre></details>   // the old row, folded
</div>
```

else `ToolCallView` as today. The component renders at every status: `pending`/`in_progress` lets it show its own placeholder (and is where a blocking widget lives), `completed` carries `output`, `failed`/`cancelled` carry `error`. Items of the global endpoint (`mcp__webmcp__<tool>`, only when a page embeds a chat against the global MCP endpoint) are matched the same way.

### 4.4 Four interaction patterns

| Pattern | The tool | The widget | How the model learns the outcome | Works for terminal Claude |
|---|---|---|---|---|
| **P1 Display and act** (science-kg's proposal cards) | returns at once with the data the card needs (and the model may read) | renders it; buttons run page code (apply, open, filter); records `setState`; calls `note('Applied option 2')` | the next prompt's `page://ui-state` resource (the page already describes what the user sees) plus the activity note (§4.5) | yes, in the floating panel |
| **P2 Suggestion** (`suggest_next_messages`) | returns the suggestions | chips; click → `prompt(text)`; disabled while `live` | it *is* the next user message | no (`prompt` absent): the chips render disabled or the widget hides itself |
| **P3 Blocking** (ask, then return the answer; **deferred**, [D-54](#D-54)) | `execute: (args, { signal }) => page.awaitUser('ask_colour', args, signal)` | shows the question while the item is `pending`; `settle.resolve(answer)` completes the tool; the result text is then the answer | the tool result | yes: the floating panel renders the same widget; the answer returns to terminal Claude |
| **P4 Agent-asked form** (no page code) | none: Claude's `AskUserQuestion`, or an MCP server's elicitation | the panel's built-in `ElicitationView` (override with `renderElicitation`) | the tool's input / the elicitation result | no (Claude Code renders its own prompt in the terminal) |

P1 is the required one and the one science-kg uses for everything but chips. **science-kg has no blocking tools**: all seventeen of its browser handlers return at once (four await a backend, none awaits the user; `src/agent/clientToolHandlers.ts`), and its prompt argues against the idea ("propose, don't ask permission": the card is the review step, the user may act now, later or never; `systemPrompt.ts:71`). P3 is new here. Its two uses are narrow: a terminal session asking the user something through the page and getting the answer in the same turn, and a rich same-turn question in the embedded chat for which P4's generic form is not enough. It costs the timeout race ([F-27](#F-27)), the pending-call join ([F-28](#F-28)), a daemon change and about a third of the test surface, and it can be added later without changing the contract (`settle` is simply absent). It is left out of this round ([D-54](#D-54), from Q-16); §4.7 keeps its design for later.

### 4.5 Telling the model about widgets

Three channels, none of which relies on the model calling a tool:

1. **`preamble()`** (`packages/connector/src/preamble.ts:11`) gains one paragraph after the `mcp__page__` sentence: *"Some page tools show the user an interactive card in the chat. The tool's description says what the card shows; do not repeat that content in your message. The user acts on cards themselves; what they did since your last message arrives as a `page://widget-activity` resource."* Pages that write their own instructions without `preamble()` copy the paragraph.
2. **Description convention**, documented in the README: a widget tool's description starts with what the card shows and ends with what the assistant message should add ("usually nothing"). The demo's tools model it. This is science-kg's rule (`serverTools.ts:159`) moved to where every WebMCP agent reads it.
3. **Activity log** (`page.activity` in the core): `note(text)` appends `{ at, tool, id, text }` to a ring buffer (20 entries, 2,000 characters). In the chat, `prompt()` (`agent-connection.ts:212`) attaches the entries newer than the thread's previous prompt as a second resource block `page://widget-activity` ("Since your last message the user did the following in the page's cards: …"), only when there are any. On the terminal path `onContextRequest` (`index.ts:143`) appends the last 10 entries to the `context/result` text under a "Recent widget activity" heading, so the hook and `webmcp_get_context` carry them ([D-28](../combined/main.md#D-28)). Entries are timestamped and never cleared on read, so a failed hook fetch loses nothing. Chosen in [Q-17](#Q-17) ([D-49](#D-49)).

Details pinned in review: the activity block is attached **after** the ui-state block, so the replay strip in `SessionModel.#appendText` (which drops everything from `page://ui-state` to the end of a replayed user chunk) removes both; the strip also learns `page://widget-activity`. A thread's window starts when the thread is opened (`lastPromptAt` set at registration), so a new thread never receives notes from before it existed. Entries are page-wide: a note from a floating-panel card (a terminal-initiated call) also reaches the embedded chat's next prompt, which is intended. `openAgent` hands the connection an `activity` reader (`ConnectionParams.activity?: { since(ts: number): ActivityEntry[] }`), keeping `agent-connection.ts` page-agnostic. On the terminal path the section is bounded: the connector appends entries only while the whole reply stays under 9,000 characters (the daemon's frame header and the hook's 10,000-character cap leave that much), oldest dropped first; the page's own text is never cut.

### 4.6 Persistence and restore

- `useWidgetState(key)` stores JSON in `localStorage["webmcp-connector:widget:<origin>:<sessionId|page>:<id>"]`; `deleteThread` removes that thread's keys. A card's selection, "applied" mark or dismissed flag survives a reload and a thread switch, because the id is Claude's `toolCallId`, which replays unchanged (§3.2).
- `SessionModel` marks items that arrive during `session/load` with `replayed: true` (the connection sets `model.replaying = true` before the request and clears it after, `agent-connection.ts:258`); `widgetInstanceOf` maps it to `restored`. A restored P1 card has its data and its persisted state but no live page objects (science-kg's "read-only twin" is the widget's choice); under P3 (deferred) a restored card would have no `settle` and render as answered (from `text`) or expired.
- Widgets must be idempotent under replay: rendering is repeated on every load, so side effects belong in click handlers, never in render or mount ([F-32](#F-32)).

### 4.7 Pending calls and claims (built now); blocking widgets (deferred)

Built in this round, because the floating panel needs them ([D-50](#D-50)): the call list, the `onCall` events and the claims. Not built: `awaitUser`, `settle` and the timeout line ([D-54](#D-54)); their design stays below as the record for a later round.

Core additions in `connect()` (`index.ts`):

```ts
export interface PendingCall { callId: string; name: string; args: Record<string, unknown>; startedAt: number; signal: AbortSignal; settle?: WidgetInstance['settle']; claimedBy?: string }
page.calls: readonly PendingCall[];                                   // in flight, oldest first
page.onCall(listener: (event: ToolCallEvent) => void): () => void;    // start / end, same shape as the onToolCall option
page.awaitUser<T>(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<T>;   // deferred with P3 (D-54)
page.claimCall(callId: string, by: string): void;                     // a chat panel took this call (§4.9)
```

(Deferred.) `awaitUser` attaches a `settle` to the oldest in-flight call with that tool name, deep-equal `args` and no settle yet, and returns a promise; `signal` (the daemon's timeout or a cancel) rejects it with `AbortError`, so the tool result becomes an error the model can read ("the user did not answer"). **Claims (built now).** The *connection* (`agent-connection.ts`, framework-free) claims calls, so it also covers live threads that are not active: `openAgent` passes it `page.onCall` and `page.claimCall`; on every call `start` it looks through its live threads' models for an unresolved `tool_call` item whose page tool is the call's name and whose current `rawInput` deep-equals the call's `args`, oldest first, and claims the call with that thread's id; the same check runs when a `tool_call` or `tool_call_update` lands while a matching call is already in flight (the input can still be streaming when the first report arrives, so the item's latest `rawInput` is what is compared). Identical concurrent calls of one tool are matched in order ([F-28](#F-28)). Under P3 the same match would also hand `settle` to the widget.

(Deferred with P3.) Timeouts: the daemon aborts after `callTimeoutMs` (60 s, `--call-timeout-ms`). Claude Code has its own per-call MCP timeout (`MCP_TOOL_TIMEOUT`; the default is not documented and reports disagree, [F-27](#F-27)); for the embedded CLI the daemon controls the environment (`bridge/src/acp.ts:73`) and sets `MCP_TOOL_TIMEOUT` to `callTimeoutMs + 5 s`. Terminal users set it themselves (README). A widget shows the remaining time from `signal` plus `startedAt`. **Stop** in the panel cancels the turn, the CLI aborts the MCP call, the daemon sends `cancel`, the widget's `signal` fires.

### 4.8 Agent-asked forms (elicitation)

`openAgentConnection` sends `clientCapabilities: { elicitation: { form: {} } }` and handles `acp.methods.client.elicitation.create`: form mode → `model.addElicitation({ id, message, schema, respond })` (like `addPermission`, `session-model.ts:105`); other modes → error `-32602`, which the adapter maps to `cancel`. `ElicitationView` renders the schema: `oneOf` consts as radio buttons, `array` + `items.anyOf` as checkboxes, `string`/`number`/`integer`/`boolean` inputs, the "Other" companion field; **Submit** → `{ action: 'accept', content }`, **Decline**, **Cancel**. Cancelling the thread settles open elicitations as `cancel`. A page overrides the renderer with `renderElicitation={(e) => …}`. `AskUserQuestion` also produces a transcript item (the adapter's `AskUserQuestionReporter`), which renders as the generic row; the form itself appears below the transcript, where permission prompts appear. Effect: `AskUserQuestion` becomes available to the embedded Claude (§3.4), so "ask me which sentence I prefer" produces a form in the page with no page code. URL mode is not advertised (it would also route Claude Code's MCP OAuth through the page; out of scope).

### 4.9 Terminal Claude: the floating widget panel

The floating widget panel is a stack of cards pinned to a corner of the page, outside the chat, where widgets appear for tool calls that did not come through a chat panel; in practice, calls from terminal Claude. `<FloatingWidgetPanel page widgets position="bottom-right" max={5} />` subscribes to `page.onCall`. For a `start` event of a tool with a widget it waits 400 ms; if no chat panel claimed the `callId` by then (`claimedBy` unset), it shows the widget with `source: 'page'`, `id = callId`, `input = args`, `status: in_progress`; the `end` event sets `completed`/`failed` with `text`/`output`. Cards stay until dismissed; completed cards auto-dismiss after 30 s (prop). Cards do not survive a reload (page-side calls have no replay); dismissing a card clears its state key. `prompt` is absent, `note()` works (the next hook injection carries it). The claim is a heuristic: the chat's connection claims a call when it matches a pending item of one of its threads (§4.7), which happens for every call its own Claude makes, since the transcript item precedes the call (§3.3). If the ordering ever inverts, the floating panel shows a duplicate for a moment; acceptable under the brief ([F-30](#F-30)). Pages that want to render terminal calls themselves use `page.onCall` directly; the floating panel is a convenience ([Q-18](#Q-18)).

### 4.10 The demo

`demo-site/src/widgets.tsx` (new), tools registered in `main.ts`, `chat.tsx` passes `widgets`, the floating panel is mounted bottom-right.

| Tool | Input | Result | Widget | Pattern |
|---|---|---|---|---|
| `propose_palette` | `{ story, options: [{ color, sentence, why }] }` (1–4) | `{ card: "p3", options: [...] }` (echo with an index) | `PaletteCard`: the story, one row per option with a swatch, the sentence and the reason, **Use** → `applyPalette(option)` (page code; the background and sentence change), `setState({ applied: i })`, `note('Applied palette option 2 (teal): "…"')`; restored cards still offer **Use** | P1 |
| `suggest_replies` | `{ replies: string[] }` (1–4) | `{ shown: n }` | `RepliesRow`: chips → `prompt(text)`; disabled while `live`; renders nothing in the floating panel | P2 |
| (none) | | | `ElicitationView` when Claude uses `AskUserQuestion` | P4 |

The blocking colour picker chosen in Q-20 went with P3 ([D-52](#D-52)); the P4 row covers the same user-facing moment (Claude asks, the user answers in the page) with no page code. Descriptions follow §4.5; the page's `instructions` get one line telling Claude to use `propose_palette` when the user asks for ideas and `suggest_replies` at the end of an answer, so the paid run (Q-21) exercises them without prompting tricks.

### 4.11 Compatibility and non-React consumers

- No `widgets` prop → today's rendering. `connectAgent`/`openAgent` signatures unchanged; `AgentOptions` gains `elicitation?: boolean` (default true) for agents or pages that want the old capability set.
- Core exports: `pageToolOf`, `widgetInstanceOf`, `page.calls`, `page.onCall`, `page.claimCall`, `page.activity`; `SessionSnapshot.pendingElicitations`; `ToolCallItem.replayed`. A non-React page renders widgets from the snapshot with the same helpers.
- Package version 0.0.2 → 0.0.3.

---

## 5. Open questions

<open-question id="Q-15" title="Where does a page declare its widgets?" status="answered">
The chat panel and the floating panel both need the map from tool name to component.

<options select="single">
  <option id="prop-map">**A `widgets` prop on `<AgentChat>` and `<FloatingWidgetPanel>` (suggested).** One `WidgetMap` object, passed to both. React types stay in `webmcp-connector/react`; the binding is visible where the panel is mounted; nothing changes in the core package for this part. Pages without React use the core helpers on the session snapshot.
  </option>
  <option id="page-registry">**A registry on the page connection**: `page.widgets.set('propose_palette', PaletteCard)` next to `registerTool`, consumed by both components automatically. Declares the card where the tool is declared, but puts opaque component values in the framework-free core and hides the binding from the mount site.
  </option>
  <option id="both">**Both**: the registry as the default, the prop as an override. Two places for one thing; more to document.
  </option>
</options>

<answer by="user" at="2026-11-05T05:49" chose="prop-map">

</answer>
</open-question>

<open-question id="Q-16" title="Which interaction patterns ship in this round?" status="answered">
§4.4 describes four. P1 is the feature. **science-kg uses P1 and chips only; it has no blocking tools**, so P3 is an addition here, not parity (§4.4). Suggested: P1, P2 and P4, with P3 deferred ([D-54](#D-54)). Your Q-20 answer included the blocking colour picker, which needs P3; [D-52](#D-52) swaps it for the `AskUserQuestion` form if P3 stays out.

<options select="multi">
  <option id="p1-display">**P1 Display and act (required).** The science-kg proposal-card pattern: tool returns, card renders, buttons run page code, the model hears about it next turn.
  </option>
  <option id="p2-chips">**P2 Suggestion chips (suggested).** `prompt()` on the props and the `live` gate; the smallest addition.
  </option>
  <option id="p3-blocking">**P3 Blocking tools (not suggested this round).** `page.awaitUser`, the pending-call join, two timeouts to reconcile, a daemon change. Its remaining uses: a terminal session asking the user through the page, and rich same-turn questions that P4's generic form cannot express. Carries [F-27](#F-27) and [F-28](#F-28); additive later.
  </option>
  <option id="p4-elicitation">**P4 Agent-asked forms (suggested).** Advertise `elicitation.form`, render `ElicitationView`. Zero page code; makes `AskUserQuestion` usable in the embedded chat; also covers MCP servers' elicitations.
  </option>
</options>

<answer by="user" at="2026-11-05T06:11" chose="p1-display,p2-chips,p4-elicitation">

</answer>
</open-question>

<open-question id="Q-17" title="How does the model learn what the user did in a card?" status="answered">
science-kg relies on the canvas summary reflecting the outcome, plus synthetic transcript parts for click-driven flows. ACP has no way to append to the agent's history ([F-29](#F-29)).

<options select="single">
  <option id="activity-resource">**Activity log as a second resource block (suggested).** `note()` entries since the thread's last prompt ride along as `page://widget-activity`; on the terminal path they are appended to the state text. Deterministic, costs no model turn, and the page's own `context()` stays unchanged and cacheable.
  </option>
  <option id="page-context-only">**Leave it to the page's `context()`.** No connector change; a page that wants the model to know folds the information into its snapshot. Simplest, but every page re-invents the "since your last message" bookkeeping.
  </option>
  <option id="auto-message">**Send a user message automatically** when a card is acted on (a gray status line, as science-kg's click flow does). Immediate, but it costs a model turn per click and interleaves badly with a turn in progress.
  </option>
</options>

<answer by="user" at="2026-11-05T05:52" chose="activity-resource">

</answer>
</open-question>

<open-question id="Q-18" title="What do we ship for terminal Claude?" status="answered">
The brief says terminal support may be partial. The page sees every call either way (§3.3).

<options select="single">
  <option id="dock">**`<FloatingWidgetPanel>` plus the `page.onCall` API (suggested).** The same components appear bottom-right for calls no chat panel claimed; P1 and P3 work, P2 renders disabled. The claim heuristic can show a brief duplicate ([F-30](#F-30)).
  </option>
  <option id="events-only">**Only the `page.onCall` / `page.calls` API.** Pages render terminal-initiated calls themselves (science-kg would open its own modal from `execute`). No floating panel, no heuristic.
  </option>
  <option id="nothing">**Nothing for terminal Claude this round.** Embedded chat only; the floating panel comes later if wanted.
  </option>
</options>

<answer by="user" at="2026-11-05T05:51" chose="dock">

</answer>
</open-question>

<open-question id="Q-19" title="Should widget state persist across reloads and thread switches?" status="answered">
science-kg saves card state with the thread (checked rows, applied record) and marks restored cards.

<options select="single">
  <option id="localstorage">**Yes, `useWidgetState` in localStorage keyed by origin, thread and call id (suggested).** Survives reload and thread switches; removed when the thread is deleted. Cards render with `restored: true` and decide what stays live.
  </option>
  <option id="none">**No persistence.** Cards re-render from the replayed input and output only; any selection is lost on reload. Less code; the demo's "applied" mark would not survive a reload.
  </option>
  <option id="page-managed">**Page-managed only.** The props carry `id` and `restored`; the page stores what it wants where it wants. No helper shipped.
  </option>
</options>

<answer by="user" at="2026-11-05T05:52" chose="localstorage">

</answer>
</open-question>

<open-question id="Q-20" title="Which demo widgets?" status="answered">
The demo page is the test bed (§4.10) and the README's example.

<options select="multi">
  <option id="palette">**`propose_palette` → `PaletteCard`** (P1): the closest analogue of science-kg's proposal card on this page.
  </option>
  <option id="replies">**`suggest_replies` → `RepliesRow`** (P2): science-kg's `suggest_next_messages`.
  </option>
  <option id="colour">**`ask_colour` → `ColourPicker`** (P3): a blocking question with a visible timeout.
  </option>
  <option id="askuser">**No tool, just `AskUserQuestion`** (P4): proves the form renderer with a one-line prompt.
  </option>
</options>

<answer by="user" at="2026-11-05T05:52" chose="palette,replies,colour">

</answer>
</open-question>

<open-question id="Q-21" title="Run the paid end-to-end check?" status="answered">
The unit tests and `m9-widgets.mjs` cost nothing (fake agent emitting tool calls and elicitations). Only real Claude proves that the preamble paragraph keeps it from repeating a card's contents, that it picks `propose_palette` when asked for ideas, that `AskUserQuestion` appears in its tool set, and that the activity note changes its next answer. A few steps added to `m5-chat.mjs`, roughly a dollar per run ([F-14](../combined/main.md#F-14)).

<options select="single">
  <option id="paid-yes">**Yes, once, after the free tests pass (suggested)**, recorded in the checklist.
  </option>
  <option id="paid-no">**No.** Free tests plus a manual look in the demo page.
  </option>
</options>

<answer by="user" at="2026-11-05T05:52" chose="paid-yes">

</answer>
</open-question>

<open-question id="Q-22" title="Adopt MCP Apps for widgets instead of page components?" status="answered">
The due diligence in §11 found one standard close to this feature: **MCP Apps** (`io.modelcontextprotocol/ui`, stable 2026-01-26). A tool declares `_meta.ui.resourceUri`, the server serves an HTML view, and the host renders it in a sandboxed iframe behind a proxy on another origin. It is the way to get the same card into Claude.ai, ChatGPT and VS Code. It is also the opposite of what science-kg's cards need: they read the page's pool and canvas, open the page's modals and call the page's apply handlers, none of which an iframe on a different origin can touch without a tool round trip.

<options select="single">
  <option id="page-components">**Page components, as planned (suggested).** The widget is the page's own React component with full access to page state; the contract follows the convention shared by assistant-ui, CopilotKit, LangGraph and the Vercel AI SDK (§11.3). Nothing is standardised, but nothing is invented beyond a map by name and the join to ACP frames. The door to MCP Apps stays open: a page may later add `_meta.ui` to a tool for other hosts without touching its page widgets.
  </option>
  <option id="mcp-apps">**MCP Apps views.** Each widget is an HTML view served by the daemon on the page's behalf and rendered in the chat through `@modelcontextprotocol/ext-apps/app-bridge`, in a sandboxed iframe behind a different-origin proxy (the spec's MUST). Portable to other hosts; but widgets lose page state, need a resource server and a second origin, terminal Claude still cannot render them, and science-kg's cards would have to be rebuilt as iframe apps talking to the page through tools.
  </option>
  <option id="both-later">**Page components now, an MCP Apps mirror later.** The first option, plus a follow-up plan in which the connector carries a page tool's `_meta.ui` and the daemon serves the view, for pages that also publish a hosted MCP server.
  </option>
</options>

<answer by="user" at="2026-11-05T06:11" chose="page-components">

</answer>
</open-question>

---

## 6. Decisions

<decision id="D-40" title="Widgets are keyed by the page tool's own name, read from the ACP tool_call's name field" status="proposed" date="2026-11-05">
`pageToolOf(item)` strips `mcp__page__` (or `mcp__webmcp__`) from `item.name`, falling back to `_meta.claudeCode.toolName`, and sanitises like the daemon. The daemon, the protocol and the plugin do not change for this; no widget metadata travels over the wire.
<rationale>The adapter sends `name: toolUse.name` on every `tool_call` and permission request (§3.2) and the name is the one stable identifier shared by the transcript, the daemon call and the page's registration. WebMCP annotations cannot carry a binding ([F-31](#F-31)), and the mirror already sanitises names (`bridge/src/normalise.ts:27`).</rationale>
</decision>

<decision id="D-41" title="A widget's data is the tool's own result text, parsed as JSON when it parses; the input is the call's arguments" status="proposed" date="2026-11-05">
`text` is the first text content block of the result frame; `output` is `JSON.parse(text)` when that succeeds; `input` is `rawInput`. Pages shape the result for the model and the card at once, as science-kg does; a page may put an id in the result to join its own state.
<rationale>That is exactly what the frames carry for a page tool (§3.2) and what replays. A hidden side channel from the page to the chat would break on reload and on thread switch, and would let the card show the user something the model never saw.</rationale>
</decision>

<decision id="D-42" title="A mapped tool renders its widget at every status; unmapped tools keep the generic row; the raw data stays one click away" status="proposed" date="2026-11-05">
The `.wmc-widget` frame wraps the component and folds the old `<details>` under it. Pending items render the component too (a blocking widget lives there).
<rationale>science-kg renders only at `output-available`, but it has no blocking tools; here the pending state is the whole point of P3. Keeping the raw row foldable preserves today's debugging affordance and `m5`'s `.wmc-tool` counts.</rationale>
</decision>

<decision id="D-43" title="Nothing is injected into the agent's transcript; the model learns about card actions through the next prompt's resources and the terminal hook" status="proposed" date="2026-11-05">
`note()` feeds an activity log on the page connection; the chat attaches new entries as `page://widget-activity` on the next prompt; the terminal path appends them to the state text. Click-driven flows that need a card without a model turn render page UI directly.
<rationale>ACP clients cannot append to the agent's history, and science-kg's synthetic parts exist only because the Vercel AI SDK lets the client own `messages` ([F-29](#F-29)). A deterministic, cost-free channel per prompt mirrors how the UI state already travels ([D-18](../combined/main.md#D-18)).</rationale>
</decision>

<decision id="D-44" title="Widget state persists per origin, thread and call id in localStorage; replayed items are marked restored" status="proposed" date="2026-11-05">
`useWidgetState` plus `ToolCallItem.replayed` set by the connection during `session/load`; `deleteThread` clears the thread's keys. Subject to [Q-19](#Q-19).
<rationale>Claude's `toolCallId` replays unchanged (§3.2), so it is the natural durable key; science-kg's experience (its F-18, "restored" telemetry, read-only twins) says a card that forgets its state after a reload reads as a bug.</rationale>
</decision>

<decision id="D-45" title="Blocking widgets are a page-side pattern bounded by the daemon's call timeout, joined to the transcript by tool name and input" status="proposed" date="2026-11-05">
`page.awaitUser(tool, args, signal)` on the connection; the chat host joins pending items to in-flight calls FIFO by name and deep-equal input and passes `settle` to the widget; the daemon sets `MCP_TOOL_TIMEOUT` for the embedded CLI. Subject to [Q-16](#Q-16).
<rationale>The page already executes the tool, so the simplest blocking mechanism is the tool's own promise; no protocol addition is needed. The join by name and input is the only correlation available, because the daemon's `callId` never appears in the ACP frames and the page cannot see the `toolCallId` when `execute` runs.</rationale>
</decision>

<decision id="D-46" title="The connector advertises form elicitation and the panel renders it" status="proposed" date="2026-11-05">
`clientCapabilities.elicitation.form` on `initialize`; `elicitation/create` requests land in the thread's model as `pendingElicitations`; `ElicitationView` renders them; `renderElicitation` overrides. Subject to [Q-16](#Q-16).
<rationale>It is the one interactive primitive ACP has, the adapter already maps both `AskUserQuestion` and MCP elicitations onto it (§3.4), and it costs the page nothing. Without the capability the adapter removes `AskUserQuestion` from the embedded Claude's tools, which is a silent gap today.</rationale>
</decision>

<decision id="D-47" title="The preamble and a description convention tell the model what cards show, so it does not repeat them" status="proposed" date="2026-11-05">
One paragraph in `preamble()`; the README documents the convention; the demo's tools follow it.
<rationale>science-kg's prompt spends a section on this and its tool descriptions repeat it (`systemPrompt.ts:905`, `serverTools.ts:159`); the brevity of the assistant message after a card is what makes a card feel like UI rather than a duplicate.</rationale>
</decision>

<decision id="D-48" title="Widgets are declared with a `widgets` prop on `<AgentChat>` and `<FloatingWidgetPanel>`; no registry on the page connection" status="locked" date="2026-11-05" from="Q-15">
One `WidgetMap` object, passed to both components; the core package stays free of React values; non-React pages use `pageToolOf` / `widgetInstanceOf` on the snapshot.
<rationale>User's answer to Q-15 (2026-11-05): "prop-map".</rationale>
</decision>

<decision id="D-49" title="Card actions reach the model as a `page://widget-activity` resource on the next prompt, and as a section of the state text for terminal Claude" status="locked" date="2026-11-05" from="Q-17">
`note()` feeds a timestamped ring buffer on the page connection (20 entries, 2,000 characters); `prompt()` attaches the entries newer than the thread's previous prompt as a second resource block; `context/request` replies append the last 10 under "Recent widget activity". Nothing is injected into the agent's transcript ([D-43](#D-43)).
<rationale>User's answer to Q-17 (2026-11-05): "activity-resource". It generalises what science-kg already does for the one action its canvas state cannot show: the `removed_this_thread` journal in the canvas summary (oldest first, capped, with who did it), next to the plain state for additions and a real user message for concept clicks (§2.2, item 9).</rationale>
</decision>

<decision id="D-50" title="Terminal Claude gets `<FloatingWidgetPanel>` plus the `page.onCall` / `page.calls` API" status="locked" date="2026-11-05" from="Q-18">
The panel shows a widget for a call no chat panel claimed within 400 ms; P1 works there, P2 renders disabled; the claim heuristic and its duplicate-for-a-moment failure mode are accepted ([F-30](#F-30)).
<rationale>User's answer to Q-18 (2026-11-05): "dock", the floating widget panel, renamed since.</rationale>
</decision>

<decision id="D-51" title="Widget state persists in localStorage per origin, thread and call id" status="locked" date="2026-11-05" from="Q-19">
`useWidgetState` as in §4.6; `ToolCallItem.replayed` marks restored items; `deleteThread` clears the thread's keys; confirms [D-44](#D-44).
<rationale>User's answer to Q-19 (2026-11-05): "localstorage".</rationale>
</decision>

<decision id="D-52" title="Demo widgets: the palette card, the reply chips, and the colour picker only if P3 ships; otherwise the `AskUserQuestion` form stands in" status="locked" date="2026-11-05" from="Q-20">
`propose_palette` → `PaletteCard` (P1) and `suggest_replies` → `RepliesRow` (P2) are built in any case. `ask_colour` → `ColourPicker` needs P3 ([Q-16](#Q-16)): if P3 is left out of this round, the demo and `m9` exercise P4 with a one-line prompt instead, and no `ask_colour` tool is registered.
<rationale>User's answer to Q-20 (2026-11-05): "palette, replies, colour", given before the P3 discussion of the same evening; the condition keeps the demo consistent with whatever Q-16 decides.</rationale>
</decision>

<decision id="D-53" title="One paid end-to-end run of the extended `m5-chat.mjs`" status="locked" date="2026-11-05" from="Q-21">
Run once after the free tests pass; record the card, the short assistant message, the activity note's effect and the form in the checklist (c55).
<rationale>User's answer to Q-21 (2026-11-05): "paid-yes".</rationale>
</decision>

<decision id="D-54" title="This round ships P1, P2 and P4; P3 (blocking tools) is deferred" status="locked" date="2026-11-05" from="Q-16">
User's answer to Q-16 (2026-11-05): P1, P2, P4. Consequences: W3 (the daemon's `MCP_TOOL_TIMEOUT` line) is dropped, so the daemon and the bundles stay untouched; [F-27](#F-27) moves to deferred and [F-28](#F-28) narrows to the claims; `settle` stays in the contract as a reserved, never-set field; `page.calls` / `page.onCall` / `claimCall` are still built, since the floating panel needs them ([D-50](#D-50)); `awaitUser` is not.
<rationale>science-kg has no blocking tools and argues against them in its prompt (§4.4); P4 covers same-turn questions of the common shapes with no page code; P3's remaining use, a terminal session asking through the page, is best effort under the brief. The pattern is additive and can come later unchanged.</rationale>
</decision>

<decision id="D-55" title="Widgets are page components; MCP Apps is not adopted, and the door to a later mirror stays open" status="locked" date="2026-11-05" from="Q-22">
The contract of §4.1 stands: no iframe, no resource server, no sandbox proxy. A page may later declare `_meta.ui` on a tool for MCP-Apps-capable hosts without touching its page widgets; that mirror would be its own plan.
<rationale>User's answer to Q-22 (2026-11-05): "page-components"; §11.4 gives the reasons.</rationale>
</decision>

<decision id="D-56" title="A widget may be placed at the end of its turn and shown only in the latest turn, by a per-widget option in the map" status="locked" date="2026-11-05">
`widgets` entries may be `{ component, placement: 'inline' | 'end', latestOnly }` instead of a bare component. `'end'` renders the widget after the turn's last message instead of where the tool call sits; `latestOnly` hides it once a newer turn exists. The demo's `suggest_replies` uses both. Inline is the default; the floating panel ignores placement.
<rationale>Manual testing on 2026-11-05: the user found the chips under the tool call, above Claude's reply, and asked for them under the last message as a page-developer flag. science-kg orders the same way ("pills last, under the reply that points at them", `ChatPanel.tsx:1872`). A per-widget option keeps the choice with the page that knows what its card is for.</rationale>
</decision>

---

## 7. Work breakdown

| # | Step | Files | Done when |
|---|---|---|---|
| W1 | Core: `widgets.ts` (`pageToolOf`, `widgetInstanceOf`, sanitiser, result parsing), the activity log, `page.calls` / `onCall` / `claimCall` and the connection-side claims, `SessionModel.replayed` and `pendingElicitations`, the elicitation capability and handler, the activity resource on `prompt()`, the context append on `context/request` | `packages/connector/src/widgets.ts` (new), `index.ts`, `agent-connection.ts`, `session-model.ts`, `types.ts`, `agent.ts` | `bun run typecheck`; unit tests of W5 (core part) pass |
| W2 | React: `widgets` prop, `WidgetHost` frame, `useWidgetState`, `ElicitationView` + `renderElicitation`, `FloatingWidgetPanel`, styles (`.wmc-widget`, `.wmc-widget-raw`, `.wmc-elicit`, `.wmc-floating`) | `packages/connector/src/react/index.tsx`, `react/widgets.tsx` (new), `react/styles.ts` | the demo renders a card for a fake-agent tool call |
| W3 | Daemon: nothing (the `MCP_TOOL_TIMEOUT` line went with P3, [D-54](#D-54)) | — | `bun run check:bundles` passes without a rebuild |
| W4 | Demo: the palette card and the reply chips (the colour picker went with P3; the `AskUserQuestion` form stands in, [D-52](#D-52)), the floating panel, the instructions line; `preamble()` paragraph | `demo-site/src/widgets.tsx` (new), `main.ts`, `chat.tsx`, `style.css`, `packages/connector/src/preamble.ts` | manual run against the echo agent and against Claude |
| W5 | Tests: unit (routing, parsing, claims, activity, replayed flag, elicitation round trip); fake agent emits `tool_call` frames, calls the page tool through the daemon (so the page sees the real `call` frame and the chat claims it), and sends elicitations; `m9-widgets.mjs`; `m5-chat.mjs` additions (Q-21) | `packages/connector/test/widgets.test.ts` (new), `agent-connection.test.ts`, `session-model.test.ts`, `test/fake-acp-agent.ts`, `scripts/e2e/fake-agent.mjs`, `scripts/e2e/m9-widgets.mjs` (new), `m5-chat.mjs` | `bun test` green; `node scripts/e2e/m9-widgets.mjs` green |
| W6 | Docs and bookkeeping: README "Widgets" section (contract, patterns, description convention, timeouts, the floating widget panel), package 0.0.3, `plans/main.md` index line, pointer in the combined plan's §13, this plan's status | `README.md`, `packages/connector/package.json`, `plans/` | `bun run build:connector` emits the new types; `scripts/fresh-check.sh` passes |

Order: W1 → W5 (unit) → W2 → W4 → W5 (browser) → W6. One commit per step, on request.

### 7.1 Test design

**Unit (`bun test`, no tokens).**

1. `pageToolOf`: `mcp__page__get_state` → `get_state`; `mcp__webmcp__a_b` → `a_b`; a non-page tool (`Bash`) → undefined; `_meta.claudeCode.toolName` fallback; sanitisation of `a.b` both ways.
2. `widgetInstanceOf`: completed item with JSON text → `output` object and `text`; plain text → `text` only; failed item → `error` with the adapter's code fence removed; pending → no `text`; `replayed` → `restored`.
3. Claims: two in-flight calls of one tool with different args → the item claims the one with equal input; identical args → oldest first; a call that starts before its `tool_call` item arrives is claimed when the item lands; a call of a live, non-active thread is claimed too; a call no thread matches stays unclaimed.
4. Activity log: ring buffer cap, `since(ts)`, the `page://widget-activity` block is attached only when non-empty and only with entries newer than the previous prompt (fake agent records the prompt blocks); the `context/request` reply ends with the "Recent widget activity" section.
5. `SessionModel`: items applied while `replaying` carry `replayed: true`; `pendingElicitations` add / respond / cancel on `cancelPermissions`.
6. Elicitation round trip against the fake agent: it sends `elicitation/create` (form, one `oneOf` question plus the "Other" field) on a prompt containing `ask-form`; the test answers `accept` through the model; the agent echoes the content; `decline` and `cancel` paths.
7. `initialize` carries `elicitation.form` by default and not with `elicitation: false`.

**Browser, no tokens (`scripts/e2e/m9-widgets.mjs`).** Private daemon with the echo agent (as `m8`), demo page in a throwaway Chrome. The fake agent, on a prompt `widget:<tool> <json>`, emits a `tool_call` for `mcp__page__<tool>` with the JSON as `rawInput`, calls the page tool through the daemon's `/call` endpoint (`POST { page, name, args }`, derived from `mcpServers[0].url`; it sends the page the same `call` frame the MCP route does and returns the normalised result), and emits the `tool_call_update` with the result's text. Steps: `widget:propose_palette {…}` → `.wmc-widget[data-tool=propose_palette]` present, `.wmc-tool` absent for it, option rows rendered → click **Use** → `document.body.style.backgroundColor` changed, the activity log has an entry → prompt `hello` → the agent recorded a `page://widget-activity` resource block → `widget:suggest_replies` → click a chip → a new user turn with the chip text → reload → the palette card re-renders with `restored` and its **applied** mark → `ask-form` → the elicitation form renders, submit, the fake echoes the answer → the floating panel: a direct `POST /call` to the daemon's page endpoint (as terminal Claude would) shows a floating card and the chat shows none.

**Browser, paid (`scripts/e2e/m5-chat.mjs`, Q-21).** "Give me two palette ideas" → a `propose_palette` card and an assistant message under 200 characters that does not list the options; click **Use** → "what did I just pick?" → the reply names the option (activity note); "ask me which sentence I prefer, using your question tool" → a form; answer it → the reply reflects the answer.

---

## 8. Acceptance checklist

**Core and panel**
<check id="c44" status="done">`bun run typecheck && bun test` pass with the new suites (cases 1–7 of §7.1). — *55 tests pass (`bun test`): 10 cases in `widgets.test.ts` (routing, instances, the activity log, the form helpers), 3 new in `session-model.test.ts` (replay marking and meta, elicitations and `cancelPending`, the activity strip), 5 new in `agent-connection.test.ts` (claims, the activity resource incl. a rejected prompt, replay restored, the elicitation round trip, the capability flag); `bun run typecheck` clean*</check>
<check id="c45" status="done">In the demo, a `propose_palette` call renders `PaletteCard` in place of the generic row, with the story and every option; the raw input and output are one click away under it; `get_state` still renders the generic row. — *`m9-widgets.mjs` step "palette card": 2 rows, the story, no generic row for `propose_palette`, the raw toggle present; step "unmapped tool": `get_state` keeps the generic row*</check>
<check id="c46" status="done">Clicking **Use** changes the page without a tool call, marks the row applied, and the next prompt carries a `page://widget-activity` resource naming the option (fake agent: recorded blocks; Claude: its reply reflects it). — *`m9` step "use option 2": background `rgb(233, 196, 106)` and sentence "Golden hour." with `toolCallCount` unchanged, row 2 marked applied, one activity entry; step "activity resource": the next prompt carried `page://ui-state` then `page://widget-activity`, the one after only `page://ui-state`*</check>
<check id="c47" status="done">`suggest_replies` chips send their text as the next user message and are disabled while a turn runs. — *`m9` step "chip click": the chip's text became the next user message and was answered*</check>
<check id="c48" status="done">With `propose_palette` removed from the `widgets` map, the same call renders the generic row again; with it mapped, the `.wmc-widget-raw` toggle under the card shows the same input and output the row would ([D-42](#D-42)). — *`m9` steps "palette card" (raw toggle under the card with the input and output) and "unmapped tool" (the generic row for a tool without a component); the map-removal variant was not driven separately*</check>
<check id="c49" status="done">After a reload and after a thread switch, the palette card re-renders from the replayed call with `restored: true` and its applied mark. — *`m9` step "restored after reload": same thread, the card marked restored with option 2 still applied, the restored note shown; thread switch covered by unit case 5 (replayed items) and the thread-scoped storage key*</check>
<check id="c50" status="done">Widgets belong to their thread: two threads with palette cards show each their own; deleting a thread clears its widget state keys. — *per-thread routing of items and claims: unit case 3; `deleteThread` clears the thread's keys and connect sweeps stale ones (`react/index.tsx`, `sweepWidgetState`); two threads with cards were not driven in a browser*</check>
<check id="c51" status="done">`AskUserQuestion` from Claude (or `ask-form` from the fake) renders as a form in the panel; Submit returns the answers to the agent; Decline and Cancel behave. — *`m9` step "form answered": Option B plus "with a note" reached the agent as `{"action":"accept","content":{"choice":"b","choice_custom":"with a note"}}`, the form closed; decline and cancel: unit case 6*</check>

**Terminal Claude**
<check id="c52" status="done">A `propose_palette` call made by terminal Claude (or a direct `/call` in the test) shows the card in the floating panel and not in the chat; a call made by the embedded Claude shows in the chat and not in the floating panel. — *`m9` step "floating panel": a `POST /call` outside the chat showed one floating card and added nothing to the chat; step "palette card": the chat's own call showed no floating card (claimed)*</check>
<check id="c53" status="done">A note recorded from a floating-panel card reaches terminal Claude: the next `GET /state` reply (what the hook injects) ends with "Recent widget activity" listing it, and the whole reply stays under 9,500 characters. — *`m9` step "state text for the terminal hook": the `/state` reply (473 characters) ends with the "Recent widget activity" section naming the floating card's Use*</check>

**Tests, docs, compatibility**
<check id="c54" status="done">`node scripts/e2e/m9-widgets.mjs` passes token-free; `m8-threads.mjs` still passes. — *`m9-widgets.mjs` passes in about 14 s; `m8-threads.mjs` still passes*</check>
<check id="c55" status="done">The paid `m5-chat.mjs` steps pass (if Q-21 says yes): a short assistant message beside the card, the activity note reflected, the form shown and answered. — *`m5-chat.mjs` (second run, 2026-11-05): a `propose_palette` card with 2 rows and the story beside a 32-character reply ("Two foxes, two moods — pick one."), no generic row; Use applied option 1 and the next answer named it ("You went with the daylight fox — the warm orange background (#e76f51) …"); `suggest_replies` chips rendered; an `AskUserQuestion` form with two options, answered, Claude acted on the choice. The first run failed for a reason outside the feature: its Chrome window was occluded by another test's and got no animation frames, so the panel never refreshed (§12)*</check>
<check id="c56" status="done">README documents widgets (contract, patterns, description convention, timeouts, the floating panel); `bun run build:connector` emits `WidgetProps`, `WidgetMap`, `FloatingWidgetPanel`, `useWidgetState`, `pageToolOf`; package 0.0.3; `plans/main.md` indexes this plan; `bun run check:bundles` passes. — *README "Widgets" and "Terminal Claude and cards" paragraphs and the `m9` line; `bun run build:connector` emits `FloatingWidgetPanel`, `useWidgetState`, `WidgetProps`, `WidgetMap` in `dist/react/index.d.ts` and `pageToolOf` in `dist/index.d.ts`; package 0.0.3; `plans/main.md` indexes this plan; `bun run check:bundles` exits 0 with the bundles untouched*</check>

---

## 9. Risks

<finding id="F-26" title="The frame shapes are observed adapter behaviour, not protocol guarantees" severity="p2" status="open" effort="small">
`name` on `tool_call`, the result as a text content block and the absence of `rawOutput` are how `claude-agent-acp` 0.100.0 renders MCP tools (§3.2); ACP only says `name` is optional and `rawOutput` may exist. Both packages are pinned ([D-7](../combined/main.md#D-7)); `widgetInstanceOf` also reads `rawOutput` (string, `{ content: [...] }` or an object) and `_meta.claudeCode.toolName`, so a future adapter that moves the data keeps working, and unit case 2 pins every shape. ACP v2 (draft) turns `tool_call_update` into a patch (omitted = unchanged, `null` = cleared) and adds `tool_call_content_chunk` for appended content; the helpers read the accumulated `ToolCallItem`, not the frame, so that change lands in `SessionModel`, not in the widgets.
</finding>

<finding id="F-27" title="Blocking widgets race two timeouts, one of them undocumented" severity="p1" status="deferred" effort="small">
Deferred with P3 ([D-54](#D-54)); recorded for the round that builds it. The daemon aborts a page call after 60 s (`bridge/src/config.ts:36`). Claude Code has its own `MCP_TOOL_TIMEOUT` whose default is not documented; third-party reports disagree (a docs mirror lists 25,000 ms with a mislabelled description, a desktop-app report shows cancellation at the MCP SDK's 60 s default, a CLI report shows a 1 s default bug in one release). If Claude Code's timeout fires first, the model sees a timeout while the card is still open and the user's later answer goes nowhere. Mitigation: the daemon sets `MCP_TOOL_TIMEOUT = callTimeoutMs + 5000` for the CLI it spawns (`acp.ts:73`); the widget shows the time left from the daemon's `timeoutMs`; the README tells terminal users to set the variable; the first paid run records what actually happened. Sources: [claude-code#20335](https://github.com/anthropics/claude-code/issues/20335), [claude-code#47076](https://github.com/anthropics/claude-code/issues/47076), [desktop 60 s report](https://claudeissues.com/issue/63379-bug-desktop-app-cancels-stdio-mcp-tool-calls-at-60s-and-ignores-mcp-tool-timeout), [1 s default report](https://claudeissues.com/issue/62121-bug-stdio-mcp-tool-calls-default-to-1-second-timeout-in-v2-1-148-long-running-to), [docs mirror](https://brewpirate.github.io/claude-code-docs/env/integrations/).
</finding>

<finding id="F-28" title="The pending-call join is by tool name and input, not by id" severity="p2" status="open" effort="small">
Now used only for claims (§4.7); under P3 it would also carry the answer. The daemon's `callId` never reaches the ACP frames and the page cannot see the `toolCallId` when `execute` runs, so a `pending` item and an in-flight call are matched by name and deep-equal arguments, oldest first. Two concurrent calls of one blocking tool with identical arguments would be matched in order, which is the only sensible order anyway. A page that needs certainty puts a nonce in the input through its tool description. Unit case 3 pins the rule.
</finding>

<finding id="F-29" title="No synthetic transcript parts: click-driven flows cannot put a card into the chat without a model turn" severity="p2" status="open" effort="medium">
science-kg's concept click injects a fabricated tool part so the relations widget appears instantly and the model later sees it (`syntheticChatParts.ts`). Over ACP the agent owns the history; the client can only prompt. Substitutes: the widget opens page UI directly (science-kg's Release 4 already moved that widget into a modal), `note()` tells the model next turn, or the page sends a real prompt when a model turn is wanted anyway (Q-17's third option as a per-widget choice). When science-kg is integrated ([D-22](../combined/main.md#D-22)) this is the one flow that needs redesign.
</finding>

<finding id="F-30" title="The floating widget panel cannot know which Claude made a call; it relies on the chat panel's claim" severity="p3" status="open" effort="small">
A call claimed by a chat panel within 400 ms of its start is hidden from the floating panel. The transcript item normally precedes the call (§3.3), so claims happen in time; if the adapter ever emits the item late, the floating panel shows a duplicate until the claim lands (then hides it). Acceptable under the brief; the events-only option in [Q-18](#Q-18) avoids it entirely.
</finding>

<finding id="F-31" title="WebMCP annotations cannot carry a widget binding" severity="p3" status="open" effort="small">
`ModelContextToolAnnotations` has four boolean keys; the spike's `getTools()` dump shows exactly those four with defaults filled in (`spikes/2026-11-04-webmcp-isolated-world/README.md:31`), i.e. the dictionary is normalised by the browser. A `widget` key would be dropped by the native API and only work under the shim. Hence the map by name ([D-40](#D-40)).
</finding>

<finding id="F-32" title="Replay renders every widget again; side effects in render would repeat" severity="p2" status="open" effort="small">
`session/load` re-emits every tool call, so a widget mounts again for each stored call, in order. A widget that applies its proposal on mount would re-apply history on every reload. Rule in the README and the demo: effects live in click handlers; render is pure; `restored` tells the card it is looking at history. A restored blocking card has no `settle` and must not pretend to ask.
</finding>

<finding id="F-33" title="localStorage grows with threads and calls" severity="p3" status="open" effort="small">
One key per widget per thread. `deleteThread` removes the thread's keys; a sweep on connect removes keys of threads no longer in `session/list` (when the agent supports listing). Entries are small (a selection, a flag), so the cap is far away; noted so it is not forgotten.
</finding>

---

## 10. Out of scope (possible later)

- **Blocking tools (P3)**: deferred by [D-54](#D-54); the design stays in §4.7 and [F-27](#F-27) records the timeout question for it.
- A **modal host** for widgets (science-kg Release 4): a widget may portal itself; a shared affordance can come with the science-kg integration plan.
- **Rich content in cards from the agent side** (images, resources): the ACP content blocks are passed through to `ToolCallView` already; widgets get `text` only in this round.
- **URL-mode elicitation** (MCP OAuth through the page).
- **MCP Apps** (`io.modelcontextprotocol/ui`): see §11.
- **Widget telemetry** (science-kg's `proposal_shown` / `restored` events): page-side.
- **science-kg's own cards** running here: a separate plan ([D-22](../combined/main.md#D-22)); §2.3 lists what each needs.

## 11. Existing protocols and libraries: adopt, align, or ignore (due diligence, 2026-11-05)

Asked by the user before implementation: is there an existing protocol for in-chat widgets that we should adopt instead of rolling our own? Surveyed from primary sources on 2026-11-05 (links in §11.5).

### 11.1 The short answer

No standard defines what this plan needs: a **page-native component rendered for a tool call, in a chat that runs inside the same page, over ACP**. The standards that exist solve different problems: shipping server-authored HTML into a host that is not the app (MCP Apps, the OpenAI Apps SDK, MCP-UI), letting the model compose UI from a client-owned catalogue (A2UI, json-render), or carrying agent events to a frontend (AG-UI). ACP, our transport, has no UI primitive and no RFD proposing one (51 RFDs listed, none about UI, widgets or rich content). What does exist is a **convention**, the same in every chat library: a map from tool name to a component that receives the call's arguments, result and status, plus a callback for human-in-the-loop tools. The contract in §4.1 is that convention; the only part this plan "rolls" is the thin join to ACP frames and to the daemon's call stream. Recommendation: build as planned, keep the names aligned with the convention (§11.3), and leave MCP Apps as a documented later mirror for pages that also want their cards in Claude.ai or ChatGPT ([Q-22](#Q-22)).

### 11.2 Survey

| Protocol or library | What it is | Who authors the UI | Where it renders | Transport | Human in the loop | Status (2026-11) | Fit here |
|---|---|---|---|---|---|---|---|
| **MCP Apps** (`io.modelcontextprotocol/ui`) | MCP extension: a tool declares `_meta.ui.resourceUri` → a `ui://` resource of type `text/html;profile=mcp-app`; host and view speak JSON-RPC over `postMessage` (`ui/initialize`, `ui/notifications/tool-input`, `ui/notifications/tool-result`, `tools/call`, `ui/message`, `ui/update-model-context`, …); tools must still return meaningful text ("text-only fallback") | the MCP server (HTML and JS) | "All View content MUST be rendered in sandboxed iframes"; a web host "MUST wrap the View … through an intermediate Sandbox proxy" on a different origin | MCP | the view can call tools and post messages; no blocking primitive | stable 2026-01-26; hosts: ChatGPT, Claude, VS Code, Goose, Postman, MCPJam, …; SDK `@modelcontextprotocol/ext-apps` 2.x with `app-bridge` for hosts | wrong shape for page widgets (isolation cuts the card off from page state; needs a resource server and a second origin; terminal Claude cannot render it); right shape for portability to other hosts |
| **OpenAI Apps SDK** | ChatGPT's app model (`_meta["openai/outputTemplate"]`, `window.openai.callTool`, `sendFollowUpMessage`) | the MCP server | iframe in ChatGPT | MCP | as above | converging on MCP Apps (`_meta.ui.resourceUri` replaces `openai/outputTemplate`; `app.callServerTool`, `app.sendMessage`); `window.openai` kept as ChatGPT-only extras | ChatGPT-only; superseded by MCP Apps for new work |
| **MCP-UI** (`@mcp-ui/*`) | the community predecessor of MCP Apps, now an implementation of the standard | the MCP server | iframe (its earlier `remote-dom` native-render mode is no longer on its introduction page) | MCP | UI actions (tool, prompt, link, intent, notify) | maintained as an MCP Apps implementation | same verdict as MCP Apps |
| **A2UI** (Google) | declarative JSON UI that the **agent composes** from a client-owned catalogue of trusted components (flat component list plus data model, streamed, updatable) | the LLM, within the developer's catalogue | native renderers: Lit, Angular, React (`@a2ui/react`), Flutter, SwiftUI | A2A or AG-UI as the pipe | events back to the agent | v0.9.1 stable, v1.0 release candidate, "early public preview"; a bridge to MCP Apps is announced | a different feature: model-composed UI. Could later sit on top of P1 as one generic "catalogue" widget; not a substitute for developer-authored cards |
| **json-render** (Vercel Labs) | the same idea for React: the model emits a spec constrained to a JSON-Schema catalogue (`@json-render/core`, `@json-render/shadcn` with 36 components) | the LLM, within the catalogue | React | any (structured output) | n/a | created 2026-01, Apache-2.0 | as A2UI |
| **AG-UI** (CopilotKit) | event protocol agent → frontend: `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END`, tool messages, state snapshots; client-defined tools in `RunAgentInput.tools`; rendering "left to the client", no UI format | the frontend developer | the frontend | its own event stream | yes: a frontend tool returns the user's decision as the tool result | active; A2UI "day-zero" compatible | would replace ACP as the transport; its tool-call model is the same information ACP's `tool_call` carries |
| **CopilotKit** hooks | v2: `useFrontendTool`, `useRenderToolCall`, `useHumanInTheLoop`; v1: `useCopilotAction` with `render` / `renderAndWaitForResponse`; render receives `args`, `result`, `status` ∈ `inProgress` · `executing` · `complete`; human in the loop answers through `respond` | the frontend developer | React | AG-UI | yes | current | the API shape this plan mirrors |
| **assistant-ui** | React chat kit: `makeAssistantToolUI({ toolName, render })` with `args`, `result`, `status`, `addResult` (human in the loop, `requires-action`); runtimes include `ExternalStoreRuntime` (`messages`, `onNew`, `onAddToolResult`, a `threadList` adapter) | the frontend developer | React | any, through a runtime adapter | yes (`addResult`) | current | the one "adopt a library" candidate: it could replace `<AgentChat>` with an adapter over `SessionModel`. Not now (§11.4); its tool-UI props are mirrored so widgets would port |
| **Vercel AI SDK UI** | `useChat` message parts `tool-<name>` / `dynamic-tool` with states `input-streaming`, `input-available`, `approval-requested`, `approval-responded`, `output-available`, `output-error`, `output-denied`; `onToolCall` plus `addToolOutput`; `addToolApprovalResponse` | the frontend developer | React | AI SDK streams | yes (`addToolOutput` from buttons; approvals) | current (v5); what science-kg uses | the model science-kg's cards are written against; our `status` maps onto it one to one |
| **LangGraph generative UI** | the server pushes `{ name, props }` tied to a message (`push_ui_message`, `typedUi`); the client's `LoadExternalComponent` resolves a `components` map; `useStreamContext().submit` for interactions | the frontend developer (components) and the server (which to show) | React, shadow DOM | LangGraph stream | through `submit` (a new message) | current | the same map-by-name shape, with the server choosing the component; here the tool name chooses |
| **ACP** (ours) | tool calls carry `name`, `title`, `kind`, `status`, `content` (text, image, audio, resource, diff, terminal), `rawInput`, `rawOutput`, `_meta`; elicitation (form, url) is the one interactive primitive; v2 draft makes `tool_call_update` a patch and adds `tool_call_content_chunk` | n/a | the client decides | ACP | elicitation; permission requests | v1 stable; v2 draft; 51 RFDs, none about UI, widgets or rich content; `_meta` is documented for client-to-agent correlation, not for relaying MCP tool-result metadata | the transport we have; everything a widget needs is already on the frame (§3.2) |
| **WebMCP** | tools only: name, description, schemas, four annotation hints | n/a | n/a | in-page | n/a | Chrome 156 behind a flag | no UI channel; the binding stays on the page side ([F-31](#F-31)) |

### 11.3 What this plan adopts

1. **The convention.** One map, tool name → component; the component receives the call's input, result, status and a stable id, and for human-in-the-loop tools a callback that settles the call. Names side by side:

| | this plan | Vercel AI SDK (science-kg) | assistant-ui | CopilotKit | LangGraph |
|---|---|---|---|---|---|
| arguments | `input` | `input` | `args` | `args` | `props` |
| result | `output` (and `text`) | `output` | `result` | `result` | the next push |
| status | `pending` · `in_progress` · `completed` · `failed` · `cancelled` (ACP's) | `input-streaming` · `input-available` · `output-available` · `output-error` | `running` · `complete` · `incomplete` · `requires-action` | `inProgress` · `executing` · `complete` | n/a |
| human in the loop | `settle.resolve()` (P3, deferred) | `addToolOutput` | `addResult` | `respond` | `submit` |
| send a message | `prompt()` | `sendMessage` | `thread.append` | `appendMessage` | `submit` |

`input` and `output` follow the AI SDK, which is what science-kg's cards already read, so porting a card changes the import, not the field names. `status` keeps ACP's vocabulary because that is what arrives on the wire; the README gives the mapping.

2. **ACP elicitation** for agent-asked questions (P4): the only standardised interactive primitive on our transport, stabilised, implemented by the adapter for both `AskUserQuestion` and MCP elicitations (§3.4).

3. **MCP Apps' fallback rule**: "tools must still return a meaningful `content` array even when a UI is available". [D-41](#D-41) is the same rule seen from the other side: the widget renders from the text the model received, so a host without widgets (terminal Claude, another ACP client) loses the card and nothing else.

4. **An open door, not a dependency, to MCP Apps**: `_meta.ui` on a page tool is not carried today (WebMCP has no `_meta`; the connector could add one); a later plan can mirror a page's views to MCP-Apps-capable hosts ([Q-22](#Q-22)).

### 11.4 What it does not adopt, and why

- **MCP Apps iframes for page widgets.** The spec's isolation is a MUST and exists for hosts that must not trust the server. Here the host is the page and the server is the page. Isolation would cost exactly what science-kg's cards need (the pool, the canvas, the modals, the apply handlers, all reachable only through tool round trips from another origin), plus a resource server in the daemon and a sandbox-proxy origin. Terminal Claude cannot render a view either way.
- **A2UI and json-render.** They make the **model** the UI author, constrained to a catalogue. science-kg's cards are developer-authored and data-driven; the model supplies ids and a one-line story and the card computes the rest, by design ("every number on a row is computed client-side", `ProposedConceptsCard.tsx:12`). A catalogue renderer could later be *one* widget under P1 for pages that want model-composed layouts.
- **AG-UI.** A transport, not a widget format; adopting it means replacing ACP, which the Claude adapter does not speak. Its tool-call events carry the same information ACP's `tool_call` already carries.
- **assistant-ui as the chat layer.** Feasible through `ExternalStoreRuntime` over `SessionModel`, and it would bring a mature composer, markdown, attachments and a thread list; but it replaces a working 340-line panel, pulls in a large UI dependency, and ACP's permission requests, modes, plan entries, commands and the page-specific setup flow would still be custom. Revisit if the panel grows into a product surface.
- **OpenAI Apps SDK.** ChatGPT-only and converging on MCP Apps.

### 11.5 Sources

MCP Apps: [specification 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), [ext-apps repository](https://github.com/modelcontextprotocol/ext-apps), [announcement, 2025-11-21](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/) · OpenAI Apps SDK convergence: [migration guide](https://sunpeak.ai/docs/mcp-apps/server/migrate-openai-apps), [comparison](https://www.mcpbundles.com/guides/mcp-apps-vs-chatgpt-apps-sdk) · MCP-UI: [introduction](https://mcpui.dev/guide/introduction) · A2UI: [repository](https://github.com/google/A2UI), [ecosystem page](https://a2ui.org/introduction/agent-ui-ecosystem/) · json-render: [repository](https://github.com/vercel-labs/json-render) · AG-UI: [tools concept](https://docs.ag-ui.com/concepts/tools) · CopilotKit: [useRenderToolCall](https://docs.copilotkit.ai/reference/hooks/useRenderToolCall), [ToolCallStatus](https://docs.copilotkit.ai/reference/core/enums/ToolCallStatus), [useDefaultTool](https://docs.copilotkit.ai/reference/hooks/useDefaultTool) · assistant-ui: [makeAssistantToolUI](https://www.assistant-ui.com/docs/copilots/make-assistant-tool-ui), [external store runtime](https://assistant-ui.com/docs/runtimes/custom/external-store), [tool fallback](https://www.assistant-ui.com/elements/tool-fallback) · Vercel AI SDK: [chatbot tool usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage) · LangGraph: [generative UI for React](https://docs.langchain.com/langgraph-platform/generative-ui-react) · ACP: [documentation index](https://agentclientprotocol.com/llms.txt), [v2 tool call updates RFD](https://agentclientprotocol.com/rfds/v2/tool-call-updates.md), [meta propagation RFD](https://agentclientprotocol.com/rfds/meta-propagation.md), [extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md) · Overview (secondary, vendor-written): [CopilotKit on AG-UI, MCP-UI and A2UI](https://copilotkit.ai/blog/the-state-of-agentic-ui-comparing-ag-ui-mcp-ui-and-a2ui-protocols).

## 12. Implementation status (2026-11-05)

Built in the order W1 → W5 (unit) → W2 → W4 → W5 (browser) → W6, with two Codex audits before the browser runs and one after (records below). Nothing under `bridge/` or `plugin/` changed; `bun run check:bundles` passes with the committed bundles. Package version 0.0.3.

| Check | Result | Evidence |
|---|---|---|
| Unit | 57 pass (21 new): routing and instances, the activity log and its cap, the form helpers incl. `null` defaults, replay marking and meta, elicitations and `cancelPending`, the activity strip, claims in both directions, the activity resource incl. a rejected prompt, replay restored, the elicitation round trip, the capability flag, the localStorage sweep per agent | `bun test` |
| Browser, no tokens | private daemon on 8719 with the echo agent: palette card in place of the row with the raw toggle and no floating duplicate → Use changes the page without a tool call, marks the row, records a note → the next prompt carries `page://ui-state` then `page://widget-activity`, the one after only `page://ui-state` → chips send their text → an unmapped tool keeps the generic row → the question form's answer reaches the agent as sent → reload restores the card with its applied mark → a `POST /call` outside the chat shows one floating card and nothing in the chat → the `/state` reply ends with the activity section (473 characters) → disconnect stops the adapter; 14 s | `node scripts/e2e/m9-widgets.mjs` |
| Browser, paid | against the login-item daemon on 8717: all earlier steps as before (auto mode, tools, reload, threads); then "Give me two palette ideas … with your propose_palette tool" → Claude called `propose_palette` and `suggest_replies` and wrote 32 characters ("Two foxes, two moods — pick one."), the card showed 2 options under its story, no generic row; Use applied option 1; "What did I just pick from your card?" → "You went with the daylight fox — the warm orange background (#e76f51) with the sentence …" (the activity note at work); chips rendered; "Use your AskUserQuestion tool …" → a form with two options, answered, "The autumn fox stays …" | `node scripts/e2e/m5-chat.mjs` (second run) |
| Regression | `m8-threads.mjs` passes; `scripts/fresh-check.sh` passes (install, typecheck, 55 tests, both builds, the bundled daemon listing all seven demo tools) | |

Observations worth keeping:

- **Claude follows the card convention without being told twice.** The tool descriptions plus the one `preamble()` paragraph were enough: after `propose_palette` the reply pointed at the card instead of repeating it, and the activity note let the next answer name the option the user had clicked.
- **A hidden tab froze the panel, not the model.** The first paid run showed zero rendered messages while the model snapshot was complete: the run had been started while another test's Chrome window covered it, Chrome gave the occluded page no animation frames, and `SessionModel`'s notifications were coalesced on `requestAnimationFrame` only. Fixed in `session-model.ts` (`debounceFrame` now also runs on a 50 ms timer when no frame comes), and the test harness launches Chrome with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`. Pre-existing and outside the widgets, but it is what a backgrounded tab with a running turn would have done to any user.
- **The chips selector in `m5` counts every `suggest_replies` card in the thread**, so the recorded list grows with each run of the same thread; the assertion only needs one.
- **The floating panel's claim window held up**: the chat's own calls never showed in the panel across the runs (claims arrive on the call's start event, well inside 400 ms).
- **Placement is a per-widget option** ([D-56](#D-56)): after the manual test the chips moved under the reply (`placement: 'end'`) and vanish once the conversation moves on (`latestOnly`); `m9` asserts both (steps "chips placement" and "chip click").
- **A tool called after the answer makes Claude restate the answer** (manual test, 2026-11-05): every turn read answer → `suggest_replies` → result → the answer again, slightly reworded, because Claude Code's loop always lets the model write after a tool result. Asking it in the description and in the result to end the turn did not help (checked with a paid two-prompt run). What works is the other order: the tool's description now asks to be called *before* the answer, its result says "now write your answer, once", and the page instruction matches; a paid re-check showed one text per turn with the chips in place. Rule recorded in the README: a tool that accompanies an answer asks to be called first; placement `'end'` still puts its card under the answer.
- **Tool rows collapsed to 2 px in a scrolling log** (manual test, 2026-11-05): `.wmc-tool` has `overflow:hidden` (from an earlier audit fix for long titles), which lets a flex column shrink it to nothing once the log overflows; messages and cards, without it, kept their height, so a long thread showed two "divider lines" where the tool rows were. Pre-existing, visible only in the wide layout with a long thread. Fixed with `.wmc-log>*{flex-shrink:0}` (`react/styles.ts`); `m9` now runs in a 1,400 px window and asserts no transcript entry is under 16 px once the log scrolls (step "log layout").
- The first `m9` run timed out on the chips once, most likely the React input lagging the model by a frame; `typeAndSend` now waits for the input to be enabled, and the failure did not recur.

### 12.1 Addendum (2026-11-05): the output box

After the manual test the user asked for "a big monospace font box that the tool can populate, to showcase outputs from other Claude skills and tools on the page". Built as a demo-page feature, not a chat widget: an "Output" panel under the sentence (`demo-site/index.html`, `.output-box` in `style.css`, state in `state.ts`) and a `show_output { text, title?, mode: replace | append }` tool (`main.ts`) that fills it, with Copy and Clear buttons. The page snapshot carries the box's title, line and character counts and a 240-character preview, so either Claude knows what is on screen without re-reading it; the page's instructions and the terminal summary tell Claude to put long or structured results there. The box keeps the last 200,000 characters. `m9` step "output box" covers replace, append and Clear through the page tool. In the chat the call shows as the generic row; a card for it would be a one-line follow-up if wanted.

## Codex audit — 2026-11-05 (1 of the pre-browser-test budget)

**Scope:** the uncommitted W1, W2 and W4 work plus the unit tests (the end-to-end scripts and the README were excluded).
**Codex verdict:** "The implementation largely matches the intended widget flow, but the elicitation form mishandles required boolean answers and widget activity can be dropped when a prompt attempt fails." (Codex omitted the `VERDICT:` / `ISSUES:` lines; two findings, both rated P2 by Codex and confirmed P2 here.)

**Changes made in response:**
- `packages/connector/src/react/widgets.tsx` — finding 1 (required boolean could not be submitted as `false`): the form starts from `elicitationInitialValues(schema)` (schema defaults, `false` for booleans); `elicitationMissing` never reports a boolean; `elicitationContent` keeps `false`. The three helpers are exported and pinned by `widgets.test.ts`.
- `packages/connector/src/agent-connection.ts` — finding 2 (the activity watermark moved before `session/prompt` succeeded, so a rejected prompt swallowed its notes): the cutoff is taken at send time and committed to `lastPromptAt` only after the request resolves. Pinned by the extended case 4 in `agent-connection.test.ts` (a `reject-prompt` prompt in the fake agent).

**Deferred / not actioned:** none.

Codex's full final message saved at `/tmp/codex-audit-20261105-063000-report.md` (this run).

## Codex audit — 2026-11-05 (2 of the pre-browser-test budget)

**Scope:** the two fixes from audit 1, the browser test scripts (`m9-widgets.mjs`, the `m5-chat.mjs` additions, the fake agent's page-call hook and replay), the floating panel's rewritten claim-window timer, the README section and the version bump.
**Codex verdict:** "The implementation has a real elicitation edge-case bug and the fake-agent persistence path can replay failed prompts incorrectly. The paid e2e additions also allow the widget acceptance checks to pass without the required widgets/forms being exercised." (Codex omitted the `VERDICT:` / `ISSUES:` lines; three findings rated P2 by Codex; re-rated P3, P3, P2 here, all fixed.)

**Changes made in response:**
- `packages/connector/src/react/widgets.tsx` — finding 1: a `default: null` in a form schema is now no default (booleans still start `false`), and `null` counts as an empty answer in `elicitationMissing` / `elicitationContent`; pinned in `widgets.test.ts`.
- `packages/connector/test/fake-acp-agent.ts` — finding 2: the `reject-prompt` path persists the session after dropping the rejected user chunk, so a reload does not replay a prompt the agent refused (test-only code).
- `scripts/e2e/m5-chat.mjs` — finding 3: the paid run now fails when the palette card, the chips or the question form does not appear after the prompt that names the tool, instead of recording "skipped"; it also fails when Use records no activity note.

**Deferred / not actioned:** none. The floating panel's timer logic, the claims and the token-free script drew no findings.

Codex's full final message saved at `/tmp/codex-audit-20261105-065500-report.md` (this run).

## Codex audit — 2026-11-05 (3; first of the post-browser-test budget)

**Scope:** the whole work tree after the browser runs, with emphasis on what changed since audit 2 (the frame-independent `debounceFrame`, the Chrome flags, the `m9` fixes, the `null` defaults, the fake agent's persist, the failing checks in `m5`).
**Codex verdict:** "The widget implementation has a real state-retention bug for users who switch between agents, because the new sweep can delete persisted widget state for valid threads belonging to other agents. The floating panel also has minor cleanup/late-claim gaps that can leave duplicate cards or stale page-scope state in edge cases." (Codex omitted the `VERDICT:` / `ISSUES:` lines; findings rated P2, P3, P3 by Codex; confirmed at those ratings; all fixed.)

**Changes made in response:**
- `packages/connector/src/react/widgets.tsx`, `react/index.tsx` — finding 1 (the sweep on connect only knows the connected agent's threads, so picking the echo agent would have deleted Claude's threads' card state): a thread's state scope is now `<agent>/<sessionId>` (`threadScope`), `sweepWidgetState(origin, agentId, keep)` touches only that agent's scopes (and keys from before scopes carried an agent), `deleteThread` clears the scoped keys. Pinned by a new `widgets.test.ts` case with a fake `localStorage`. `m9` re-run after the change: pass.
- `packages/connector/src/index.ts`, `types.ts`, `react/widgets.tsx` — finding 2 (a claim arriving after the 400 ms window left the duplicate card until the call ended): `page.onClaim(listener)`; the floating panel removes a shown card when its call is claimed.
- `packages/connector/src/react/widgets.tsx` — finding 3 (auto-dismissed or evicted cards kept their page-scope state keys): an effect clears the state of every card that leaves the panel, whatever the reason.

**Deferred / not actioned:** none.

Codex's full final message saved at `/tmp/codex-audit-20261105-071500-report.md` (this run).

## Codex audit — 2026-11-05 (4; follow-up on the audit-3 fixes)

**Scope:** the three fixes from audit 3 only (agent-scoped state keys and the sweep, `page.onClaim` and the late-claim removal, state cleanup for cards leaving the panel).
**Codex verdict:** "The scoped thread keys, late-claim listener, and normal removal/eviction cleanup paths otherwise match the intended fixes. The remaining issue is a minor stale localStorage cleanup gap on panel unmount, not a functional blocker for the patch." (Codex omitted the `VERDICT:` / `ISSUES:` lines; one P3 finding, confirmed, fixed.)

**Changes made in response:**
- `packages/connector/src/react/widgets.tsx` — the floating panel's unmount clears the page-scope state of the cards it was showing (an effect cleanup over `shownIds`).

**Deferred / not actioned:** none. Audit budget used: 2 of 5 before the browser tests, 2 of 5 after.

Codex's full final message saved at `/tmp/codex-audit-20261105-073000-report.md` (this run).
