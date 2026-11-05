# WebMCP ⇄ local daemon ⇄ Claude Code

Connect web pages to a *local* Claude Code: terminal Claude can see and operate a page through the
page's own [WebMCP](https://webmachinelearning.github.io/webmcp/) tools, and the page can embed a
chat with that same local Claude through the [Agent Client Protocol](https://agentclientprotocol.com).
Plan and evidence: [`plans/combined/main.md`](plans/combined/main.md).

Three things ship from this repo:

| Deliverable | Path | What it is |
|---|---|---|
| `webmcp-connector` (npm, 0.0.4) | `packages/connector` | Tiny browser library: mirrors the page's `document.modelContext` tools to the daemon (with a shim when the browser lacks the API), carries the page's instructions and a UI-state snapshot, and offers an embedded chat with threads and page-provided widgets: `openAgent()` / `connectAgent()` plus a React `<AgentChat>` and `<FloatingWidgetPanel>` (`webmcp-connector/react`). |
| Demo page | `demo-site` | Vite page with WebMCP tools for the colour and the sentence, two card tools (`propose_palette`, `suggest_replies`), a `show_output` tool that fills a big monospace output box on the page (for results from any Claude, skill or tool), a call log, a bonus tool for dynamic registration, and the embedded chat. |
| `webmcp-daemon` Claude Code plugin | `plugin` | Ships and runs the local daemon (`bridge/`), points Claude Code at it over MCP, and injects each page's instructions (session start) and live UI state (every prompt) through hooks. |

## Try it (this checkout)

```bash
bun install
bun run daemon -- --allow-origin http://127.0.0.1:5173     # http://127.0.0.1:8717: /ws /mcp /acp
bun run demo                                                # http://127.0.0.1:5173
claude --plugin-dir ./plugin                                # in any directory; ask about "the demo page"
```

Open the demo in Chrome. With `chrome://flags/#enable-webmcp-testing` enabled the page uses the
native API; without it the connector's shim is used. Click **Connect to local Claude** in the page
for the embedded chat (it uses your existing Claude Code login).

Without `--allow-origin`, the daemon opens an approval tab the first time an origin connects.

## For web developers

```ts
import { connect, preamble } from 'webmcp-connector';

const page = connect({
  instructions: preamble({ pageTitle: 'My app' }) + '\n\n' + MY_SYSTEM_PROMPT,   // replaces Claude Code's preset in the embedded chat
  instructionsSummary: 'Short version for terminal sessions (≤ 9,500 chars).',
  context: () => describeWhatTheUserSees(),                                     // deterministic; attached to every prompt
  // toolPolicy: { disallowedTools: ['Bash', 'Write', 'Edit'] },                // default: full Claude Code; new chat threads start in auto mode (see below)
});
document.modelContext.registerTool({ name: 'get_state', description: '…', inputSchema: {…}, annotations: { readOnlyHint: true }, execute: () => state });
```

React chat: `import { AgentChat } from 'webmcp-connector/react'` and render `<AgentChat page={page} />`.

**Threads.** The panel holds one ACP connection and lists every stored thread of the page under **Threads**
(title, age, state); click one to switch, **New** for a fresh one, × to delete. Switching away from an idle
thread frees its Claude process (reopening replays the history in about a second); a thread that is still
answering keeps running in the background and is released when its turn ends. The last active thread reopens
after a reload. The daemon also releases a chat that has been idle for about ten minutes; the panel then keeps the
transcript on screen, says so, and reconnects into the same thread when you send the next message. Without React: `openAgent(page)` returns an `AgentConnection` with `listThreads()`,
`openThread(id?)`, `closeThread()`, `deleteThread()` and change listeners; `connectAgent(page)` is the
one-thread shorthand. Agents that cannot list or resume sessions get the single-thread panel.

**Permission mode.** New threads start in Claude Code's **auto** mode: Claude Code decides most permissions
itself, including shell and file tools in the page's scratch workspace, and the panel prompts only for what it
escalates. Change it per thread in the mode dropdown, or pin the default with
`<AgentChat agentOptions={{ defaultMode: 'default' }}>` (`null` leaves the agent's own default);
`toolPolicy.disallowedTools` still removes tools entirely. Resumed threads keep the mode they were in. The daemon
writes `defaultMode: "auto"` into new page workspaces so other ACP clients start the same way; the page's origin
approval and the per-call prompts auto mode still raises are the safety boundary.

**Widgets.** A page tool's result can render as the page's own card inside the chat instead of the generic row:
pass `<AgentChat page={page} widgets={{ propose_palette: PaletteCard, suggest_replies: RepliesRow }} />`, keyed by
tool name; an entry may also be `{ component, placement: 'end', latestOnly: true }` to render after the turn's last
message instead of where the call sits, and only in the most recent turn (what suggested replies want). The component
receives the call (`input`, the parsed `output` and the raw `text`, `status`, a stable
`id`, `restored` for history replayed after a reload or a thread switch), persisted `state` / `setState`
(localStorage, per origin, agent, thread and call; swept when a thread is gone), `prompt(text)` to send a message (refused while the thread is busy),
and `note(text)` to record what the user did: notes since the thread's last prompt ride along with the next one as
a `page://widget-activity` resource, and the state text terminal Claude receives ends with the same list. Three
rules make a card work: the tool's description says what the card shows and that the assistant's message should
not repeat it (`preamble()` tells Claude the same in general; a tool that accompanies an answer, like suggested
replies, should ask to be called *before* the answer, because Claude writes a text after every tool result and an
answer-then-tool order makes it restate the answer); the tool returns what the card needs as its
result, because that is what replays after a reload; and the card does nothing in render, only in click handlers,
because history replays every call. The raw input and output stay one click away under every card; unmapped tools
keep the generic row. Agent-asked questions (Claude's `AskUserQuestion`, MCP elicitations) render as a form in the
panel; `renderElicitation` replaces it, `agentOptions={{ elicitation: false }}` turns the capability off. The
demo's `demo-site/src/widgets.tsx` has a palette proposal card and suggestion chips.

**Rendering the panel in your own style.** `<AgentChat>` keeps its connection, threads, permissions, elicitations and
widgets, and lets a page replace the surfaces it draws: `renderHeader={(ctx) => …}` (the badge, the mode, the threads, connect;
`ctx.actions` carries every built-in action), `renderMessage={(item, info) => …}` (the page's own markdown and chips),
`renderToolCall={(item, info) => …}` (the generic row for unmapped tools), `renderEmpty={(info) => …}` (starter prompts) and
`renderComposer={(ctx) => …}` (the page's own input; `ctx.send(text)` sends, `ctx.cancel()` stops, `ctx.usage` is the context
meter); `footer={false}` drops the footer; `autoConnect` opens the chat as soon as the daemon is there. `threadFilter={(t) => …}` lists only some of the origin's threads (a page with several
workspaces scopes them), and `sessionStorageKey` keys the last-thread memory the same way. The agent's settings arrive on the
snapshot as `configOptions` (Claude Code's adapter offers the permission mode, the model, the effort level, fast mode);
`handle.setConfigOption(id, value)` changes one and the snapshot follows (`config_option_update`). The CSS variables `--wmc-*`
on `.wmc-chat` restyle what stays. science-kg's **Use local Claude** panel is the worked example. The package's button defaults (`:where(.wmc-chat) button`, `:where(.wmc-float, .wmc-widget) button`) carry no specificity, so a page's own classes on the buttons it renders — in a header, a composer or a widget — win without `!important`. The floating widget panel is a scroll box no taller than the window, and its cards are opaque (`--wmc-bg`), so a tall card from terminal Claude never runs off the screen or shows the page through (0.0.5).

**Terminal Claude and cards.** `<FloatingWidgetPanel page={page} widgets={WIDGETS} />` shows the same components,
bottom-right of the page, for page tool calls that did not come through the chat panel (calls from a terminal
session). There is no thread to send to, so `prompt` is absent; `note()` still reaches the terminal through the
state hook. The panel waits 400 ms for the chat to claim a call; a call the chat makes can show twice for a moment
if its transcript item arrives late, and goes away as soon as the claim lands. Without React: `page.calls`,
`page.onCall()`, `page.claimOf()`, `page.onClaim()` and `page.activity` carry the same information.

## The menu bar item

While the daemon runs on macOS it shows **webmcp-bridge** in the menu bar: daemon status, page and chat counts, *Start at login* (registers the opt-in launchd item), open log, show state folder, copy the MCP URL, stop. It is not a separate app: the daemon spawns a 150 KB status-bar helper (`plugin/daemon/tray/webmcp-bridge-tray`, Objective-C, universal binary, built with `bun run build:tray`) and drives it over stdin/stdout; the helper exits with the daemon. The icon is the icon as a template image (`plugin/daemon/tray/webmcp-bridge-icon.png`, regenerated from the company logo with `scripts/make-tray-icon.py`), so the menu bar colours it like its neighbours: white in dark mode, black in light mode; `--tray-text` shows the name instead. The plugin hook and the login item start the daemon with `--tray`; `bun run daemon` does not (add `-- --tray`).

## For Claude Code users

```bash
/plugin marketplace add josephcc/webmcp-bridge                  # inside Claude Code (private repo: your gh/git credentials must reach it)
/plugin install webmcp-daemon@webmcp-bridge
# or, from a checkout:
claude --plugin-dir ./plugin
# then just run `claude`: the SessionStart hook starts the daemon (menu bar item "webmcp-bridge" appears) and, until
# setup is finished, Claude offers to make it start at login. After that the browser chat works with no terminal.
```

The plugin has one setting, *Inject page context into terminal sessions* (default on): a connected page's instructions are added at session start and its UI state with every prompt. Turn it off if you only use the chat in the browser.

All of the daemon's state (approvals, workspaces, logs, pid) lives in `~/.webmcp-daemon`, shared by the CLI, the plugin, the login item and the menu bar item.

The repository root carries the marketplace manifest (`.claude-plugin/marketplace.json`), so the install lines work against the hosted repository, `github.com/josephcc/webmcp-bridge`.

## Privacy

Everything stays on your machine: see [PRIVACY.md](PRIVACY.md).

## Layout

`packages/protocol` shared wire types · `packages/connector` the npm package · `bridge` daemon source
(`plugin/daemon/*.js` are its bundles, built by `bun run build:plugin`) · `plugin` the Claude Code plugin ·
`demo-site` · `scripts/e2e` browser-driven checks · `spikes` the original feasibility spike · `plans`.

## Development

```bash
bun run typecheck && bun test        # types + unit tests
bun run build:plugin                 # bundles daemon + Claude adapter into plugin/daemon/ (commit them: the plugin runs the bundles)
bun run check:bundles                # fails if the committed bundles are stale relative to bridge/
node scripts/e2e/m1.mjs              # page ⇄ daemon (needs daemon + demo running)
node scripts/e2e/m2.mjs              # MCP client against the daemon
node scripts/e2e/m4-relay.mjs        # ACP relay (spawns a Claude agent: costs tokens)
node scripts/e2e/m5-chat.mjs         # embedded chat through the real browser, incl. auto mode and a thread switch (costs tokens)
node scripts/e2e/m8-threads.mjs      # threads in the chat panel with the echo agent on a private daemon (needs vite; no tokens)
node scripts/e2e/m9-widgets.mjs      # widget cards, chips, the question form, restore after reload, the floating panel (needs vite; no tokens)
```
