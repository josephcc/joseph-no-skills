# WebMCP ⇄ local daemon ⇄ Claude Code

Connect web pages to a *local* Claude Code: terminal Claude can see and operate a page through the
page's own [WebMCP](https://webmachinelearning.github.io/webmcp/) tools, and the page can embed a
chat with that same local Claude through the [Agent Client Protocol](https://agentclientprotocol.com).
Plan and evidence: [`plans/combined/main.md`](plans/combined/main.md).

Three things ship from this repo:

| Deliverable | Path | What it is |
|---|---|---|
| `webmcp-connector` (npm) | `packages/connector` | Tiny browser library: mirrors the page's `document.modelContext` tools to the daemon (with a shim when the browser lacks the API), carries the page's instructions and a UI-state snapshot, and offers an embedded chat with threads: `openAgent()` / `connectAgent()` plus a React `<AgentChat>` (`webmcp-connector/react`). |
| Demo page | `demo-site` | Vite page with four WebMCP tools (colour + sentence), a call log, a bonus tool for dynamic registration, and the embedded chat. |
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
after a reload. Without React: `openAgent(page)` returns an `AgentConnection` with `listThreads()`,
`openThread(id?)`, `closeThread()`, `deleteThread()` and change listeners; `connectAgent(page)` is the
one-thread shorthand. Agents that cannot list or resume sessions get the single-thread panel.

**Permission mode.** New threads start in Claude Code's **auto** mode: Claude Code decides most permissions
itself, including shell and file tools in the page's scratch workspace, and the panel prompts only for what it
escalates. Change it per thread in the mode dropdown, or pin the default with
`<AgentChat agentOptions={{ defaultMode: 'default' }}>` (`null` leaves the agent's own default);
`toolPolicy.disallowedTools` still removes tools entirely. Resumed threads keep the mode they were in. The daemon
writes `defaultMode: "auto"` into new page workspaces so other ACP clients start the same way; the page's origin
approval and the per-call prompts auto mode still raises are the safety boundary.

## The menu bar item

While the daemon runs on macOS it shows **webmcp-bridge** in the menu bar: daemon status, page and chat counts, *Start at login* (registers the opt-in launchd item), open log, show state folder, copy the MCP URL, stop. It is not a separate app: the daemon spawns a 150 KB status-bar helper (`plugin/daemon/tray/webmcp-bridge-tray`, Objective-C, universal binary, built with `bun run build:tray`) and drives it over stdin/stdout; the helper exits with the daemon. The icon is the icon as a template image (`plugin/daemon/tray/webmcp-bridge-icon.png`, regenerated from the company logo with `scripts/make-tray-icon.py`), so the menu bar colours it like its neighbours: white in dark mode, black in light mode; `--tray-text` shows the name instead. The plugin hook and the login item start the daemon with `--tray`; `bun run daemon` does not (add `-- --tray`).

## For Claude Code users

```bash
/plugin install webmcp-daemon --marketplace <owner>/<repo>   # inside Claude Code, once this repo is pushed (replace <owner>/<repo>)
# or, from a checkout:
claude --plugin-dir ./plugin
# then just run `claude`: the SessionStart hook starts the daemon (menu bar item "webmcp-bridge" appears) and, until
# setup is finished, Claude offers to make it start at login. After that the browser chat works with no terminal.
```

The plugin has one setting, *Inject page context into terminal sessions* (default on): a connected page's instructions are added at session start and its UI state with every prompt. Turn it off if you only use the chat in the browser.

All of the daemon's state (approvals, workspaces, logs, pid) lives in `~/.webmcp-daemon`, shared by the CLI, the plugin, the login item and the menu bar item.

The repository root carries the marketplace manifest (`.claude-plugin/marketplace.json`), so the install line works as soon as the repo is hosted.

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
```
