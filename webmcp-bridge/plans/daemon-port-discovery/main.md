**Status:** implemented 2026-11-05 — reviewed by Joseph 18:41 (D-1–D-8 locked); W1–W7 landed one commit per step, two Codex audits fixed (`89d7c8f`, `1fd76c1`); thirteen of fourteen checks ticked, c12 (a real Claude Code session through the relay) awaits Joseph
**Date:** 2026-11-05
**Scope:** How the daemon, the page connector, the plugin's hooks and the plugin's MCP client find each other when the fixed port is taken, and how a second daemon is prevented. Not in scope: multiple daemons by design (private state dirs keep working as today), remote daemons, authentication.
**Inputs:** `bridge/src/{config,index,http,ws-server,launchd}.ts`, `packages/protocol/src/index.ts`, `packages/connector/src/{index,protocol,types}.ts`, `plugin/.mcp.json`, `plugin/hooks/hooks.json`, `plugin/scripts/{common.sh,ensure-daemon.sh,detach.mjs}`, `demo-site/src/main.ts`, the science-kg adoption (`src/agent/webmcpPage.ts` there), [combined/main.md](../combined/main.md) §5

# Daemon port discovery and the single-daemon rule

> **Reading this on GitHub?** This plan is written in the interactive-plan format, a markdown dialect with tags for questions, decisions, findings and checklists. GitHub drops the tags, so the titles, statuses, severities, dates and chosen answers are missing here, and what remains reads as loose prose. Open the raw file to see them, or ask Joseph for a PDF export of the full plan.

## 0. Brief (verbatim)

From Joseph, in chat, 2026-11-05:

> ok, let's... harden this a little, right now we take a fix port, if something already uses that port then we are rekt. I think the solution is to create a list random ports, ordered, so both side can try one-by-one. Make sure we have a way to detect already running daemon, so we don't end up with multiple daemons running

## 1. Summary

Today everything assumes `127.0.0.1:8717`: the daemon listens there (`DEFAULT_PORT` in `webmcp-protocol`, env `WEBMCP_DAEMON_PORT`, `--port`), the page connector dials `ws://127.0.0.1:8717/ws`, the plugin's hooks curl `http://127.0.0.1:8717/health`, the plugin's MCP server is the static URL `http://127.0.0.1:8717/mcp`, and the login item's plist pins `--port 8717`. If another process holds 8717, `server.listen` rejects with `EADDRINUSE`, the daemon exits, the page shows "no daemon", and nothing recovers. The only thing that stops two daemons today is that same `EADDRINUSE`: the hook and the login item can both try to start one, and the loser crashes.

The change: one **ordered list of candidate ports** shared by every side (`webmcp-protocol`), the daemon takes the first free one, every client walks the list in the same order until it finds *our* daemon (identified by a tiny CORS-open `GET /id`), and the daemon **refuses to start twice** for a state directory: it probes for a live instance first and exits 0 pointing at it, with an exclusive `daemon.json` as the lock against two simultaneous starts. `8717` stays first in the list, so every working setup keeps working unchanged. The one client that cannot walk a list is Claude Code's static `.mcp.json`; [Q-5](#Q-5) decides how the plugin's MCP server follows the daemon.

## 2. What exists today (verified in the tree)

| Side | Where the port lives | What happens when 8717 is taken |
|---|---|---|
| Daemon | `DEFAULT_PORT = 8717` (`packages/protocol`); `config.port` from `--port` / `WEBMCP_DAEMON_PORT`; `server.listen(config.port)` in `bridge/src/index.ts:34` | `EADDRINUSE` rejects, `main` logs and exits 1. `daemon.json` (`pid, port, startedAt, version`) is written only after a successful listen and removed on close; `status` fetches `/health` on the configured port; `stop` signals the pid in `daemon.json`. No check for a running instance before listening. |
| Page connector | `DEFAULT_URL = ws://127.0.0.1:8717` (`packages/connector/src/index.ts:19`), overridable with `daemonUrl` (science-kg passes `?daemon=`); the reconnect loop backs off from `minRetry` to `maxRetry` on the one URL; `absent` after a failed first open, `needs-approval` when the socket has not opened within the grace | The page keeps retrying one port forever and shows "No local daemon on 127.0.0.1:8717" (demo text). The welcome frame already carries absolute `mcpUrl` and `acpUrl`, so the embedded chat follows whatever port the page found. |
| Plugin hooks | `plugin/scripts/common.sh`: `WEBMCP_PORT="${WEBMCP_DAEMON_PORT:-8717}"`, `webmcp_healthy` curls `/health`; `ensure-daemon.sh` spawns `serve --port $WEBMCP_PORT --tray` detached when unhealthy and polls `/health` | A foreign server on 8717 fails the health check, the hook spawns a daemon that dies on `EADDRINUSE`, and the hook reports "started but not healthy yet" on every session. |
| Plugin MCP server | `plugin/.mcp.json`: `{ "type": "http", "url": "http://127.0.0.1:8717/mcp" }`, read by Claude Code at session start | Claude Code has no server. Hooks cannot change a running session's MCP config. |
| Login item | `bridge/src/launchd.ts:19`: the plist's arguments include `--port <config.port>` | Same crash, restarted by launchd. |
| Docs and demo | README, PRIVACY.md, `plugin/commands/setup.md`, the demo's `absent` hint, the e2e scripts (`DAEMON_URL`, `--port`) | Text only; the e2e scripts pin explicit ports and keep working. |

Related: `/health` is same-origin only in practice (no CORS header), and it returns the selected page's title and origin, which a page must not be able to read from another origin.

## 3. Design

### 3.1 The candidate list

`webmcp-protocol` exports `CANDIDATE_PORTS` (proposed: `[8717, 49217, 52431, 55893, 61307]`): the historical port first, then four arbitrary ports from the dynamic range that no common tool uses. Both sides import the same constant; the plugin's shell scripts carry the same numbers in `common.sh` with a comment pointing at the source. The order is the search order everywhere, which is what makes "first free" and "first found" meet.

### 3.2 The daemon

`serve` without `--port` walks `CANDIDATE_PORTS`: `listen`, and on `EADDRINUSE` the next one; any other error is fatal. `--port N` or `WEBMCP_DAEMON_PORT=N` pins exactly N with no fallback (the e2e scripts and private daemons rely on that). Before listening at all, the daemon looks for a live instance of **its state directory**: it reads `daemon.json`, checks the pid is alive, and asks `GET /id` on the recorded port for our identity; if all three hold it prints `already running on 127.0.0.1:<port> (pid <pid>)` and exits 0, so the hook and the login item treat it as success. A `daemon.json` whose pid is dead or whose port does not answer is stale and is removed. The file is then created with `wx` (exclusive) **before** listening, holding `{ pid, startedAt, version, port: null }`, and rewritten with the port once `listen` succeeds; a second starter that loses the `wx` race waits up to two seconds for the port to appear and then exits 0 pointing at it. `status` and `stop` read the port from the file rather than the configured default. The tray and the log line show the port. `/id` is a new CORS-open endpoint answering `{ "daemon": "webmcp-daemon", "protocol": 1, "version": "...", "instance": "<random per start>" }` and nothing else; `/health` keeps its content and its same-origin reach.

### 3.3 The page connector

`connect()` without `daemonUrl` searches: for each candidate in order, `fetch(http://127.0.0.1:<port>/id, { mode: 'cors', signal: 300 ms })`; the first answer whose body says `daemon: "webmcp-daemon"` with a protocol we speak is the daemon, and the WebSocket opens on that port only. A port that refuses, times out, or answers anything else is skipped, so a foreign service never sees a WebSocket upgrade and never gets the approval prompt. No answer on any candidate is `absent`, with the existing backoff before the next sweep (one sweep is at most five short probes). A `daemonUrl` is pinned exactly as today. The status gains `port` and `daemonUrl` so hosts can show where the page connected; the demo's hint and science-kg's setup text say "no daemon on the known ports". Because the welcome frame carries `mcpUrl` and `acpUrl`, the embedded chat needs no change.

### 3.4 The plugin's hooks and the login item

`common.sh` resolves the port in this order: `WEBMCP_DAEMON_PORT` if set, else the `port` in `$WEBMCP_STATE/daemon.json` when its `/health` answers, else the first candidate whose `/id` answers, else none. `ensure-daemon.sh` starts `serve --state-dir ... --tray` **without** `--port`, waits for `daemon.json` to carry a port and for `/health` on it, and prints the port it found. The plist drops `--port` unless the user pinned one at install time. `plugin/commands/setup.md` uses the same resolution.

### 3.5 The plugin's MCP server

Claude Code reads `.mcp.json` once per session, and a `type: http` entry is one URL. Three ways to let it follow the daemon ([Q-5](#Q-5)):

- **A stdio relay, bundled with the plugin** (recommended). `plugin/daemon/webmcp-mcp.js`, started by Claude Code as `{ "type": "stdio", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/daemon/webmcp-mcp.js"] }`. It resolves the daemon like the hooks do (ensuring one if needed), opens a `StreamableHTTPClientTransport` to `/mcp`, and relays JSON-RPC messages both ways between stdin/stdout and that transport without interpreting them, so tools, resources, prompts and `list_changed` notifications pass through unchanged. If the daemon goes away the relay exits and Claude Code reports the server as disconnected; `/mcp` in the session reconnects. About a hundred lines plus a bundle step next to the daemon's.
- **Keep the URL, expand an environment variable**: `"url": "http://127.0.0.1:${WEBMCP_DAEMON_PORT:-8717}/mcp"`. Works only when the variable is set before Claude Code starts; the hook can at best warn that the daemon is on another port and the session has no server.
- **Both**: the URL for the common case, the relay only when the daemon is off the default port. Two code paths for one job.

### 3.6 What stays

Private daemons with their own `--state-dir` and `--port` (the e2e runs, science-kg's drivers) are separate instances on purpose and keep working. The protocol, the approval flow, the workspace layout and the welcome frame are unchanged. `8717` first in the list keeps every existing install on the same port.

## 4. Open questions (each resolved below by a proposed decision)

<open-question id="Q-1" title="Which ports, how many" status="answered">
The list both sides walk, in order.

<options select="single">
  <option id="five-fixed">**`[8717, 49217, 52431, 55893, 61307]`** — the historical port first, then four arbitrary ports in the IANA dynamic range (49152–65535) that no common tool uses. Five is enough to survive a clash and short enough that a sweep stays under two seconds. (Recommended.)
  </option>
  <option id="three-fixed">`[8717, 49217, 52431]` — shorter sweep, fewer chances.
  </option>
  <option id="derived">A base port plus a per-user offset derived from the uid, so two users on one machine never collide. Pages cannot compute the uid, so they would still need a list.
  </option>
</options>

<answer by="user" at="2026-11-05T18:40" chose="five-fixed">

</answer>
</open-question>

<open-question id="Q-2" title="What the daemon does when every candidate is taken" status="answered">


<options select="single">
  <option id="fail-clear">Exit 1 with a message naming the five ports and the `--port` escape hatch. A sixth clash is not a case worth code. (Recommended.)
  </option>
  <option id="ephemeral">Fall back to port 0 (kernel-assigned) and rely on `daemon.json` for the hooks and the relay; pages could not find it without a list entry.
  </option>
</options>

<answer by="user" at="2026-11-05T18:40" chose="fail-clear">

</answer>
</open-question>

<open-question id="Q-3" title="How a second daemon is detected" status="answered">


<options select="single">
  <option id="probe-then-wx">Probe first (pid alive + `/id` answers on the recorded port), treat anything else as stale, then take `daemon.json` with `wx` before listening and fill the port in after. The file is both the discovery record and the lock, per state directory. (Recommended.)
  </option>
  <option id="probe-only">Probe only, no exclusive create. Two starters racing at login (the hook and the login item) could both pass the probe and land on two ports.
  </option>
  <option id="lockfile-native">A proper `flock` through a native dependency. Robust, but a native module in a bundle the plugin ships to every machine.
  </option>
</options>

<answer by="user" at="2026-11-05T18:41" chose="probe-then-wx">

</answer>
</open-question>

<open-question id="Q-4" title="How a page finds the daemon" status="answered">


<options select="single">
  <option id="id-probe-sequential">`GET /id` on each candidate in order with a 300 ms timeout, then one WebSocket to the port that answered. Foreign services never see an upgrade or an approval prompt. (Recommended.)
  </option>
  <option id="ws-sequential">Open `/ws` on each candidate in turn and judge by whether a welcome or approval frame arrives. Simpler, but a foreign WebSocket server that accepts upgrades looks like a daemon awaiting approval.
  </option>
  <option id="id-probe-parallel">Probe all candidates at once and take the lowest index that answers. Faster by a few hundred milliseconds; more connections to foreign ports per sweep.
  </option>
</options>

<answer by="user" at="2026-11-05T18:41" chose="id-probe-sequential">

</answer>
</open-question>

<open-question id="Q-5" title="How Claude Code's MCP server follows the daemon" status="answered">
See [§3.5](#35-the-plugins-mcp-server).

<options select="single">
  <option id="stdio-relay">A stdio relay bundled with the plugin; `.mcp.json` becomes a `stdio` entry. Follows the daemon on any port and can start it. (Recommended.)
  </option>
  <option id="env-url">Keep the `http` entry with `${WEBMCP_DAEMON_PORT:-8717}`; the hook warns when the daemon is elsewhere.
  </option>
  <option id="both">The `http` entry plus the relay as a second server. Two paths for one job.
  </option>
</options>

<answer by="user" at="2026-11-05T18:41" chose="stdio-relay">

</answer>
</open-question>

<open-question id="Q-6" title="What /id reveals" status="answered">


<options select="single">
  <option id="minimal">`daemon`, `protocol`, `version`, `instance` — enough to recognise the daemon and tell a restart; no pages, titles or origins. CORS-open to any origin. (Recommended.)
  </option>
  <option id="health-cors">Open `/health` to any origin instead. Any website could then read which page is selected.
  </option>
</options>

<answer by="user" at="2026-11-05T18:41" chose="minimal">

</answer>
</open-question>

<open-question id="Q-7" title="The login item's arguments" status="answered">


<options select="single">
  <option id="no-port">Drop `--port` from the plist unless the user pinned one when installing; the login item's daemon walks the list like any other. (Recommended.)
  </option>
  <option id="keep-port">Keep pinning the configured port; the login item is the one daemon that should always be on 8717.
  </option>
</options>

<answer by="user" at="2026-11-05T18:41" chose="no-port">

</answer>
</open-question>

<open-question id="Q-8" title="Verification" status="answered">


<options select="single">
  <option id="unit-plus-clash-e2e">Unit tests for port selection, the singleton, the connector's probe and the relay; one e2e with a foreign HTTP server squatting on 8717 (the daemon lands on the second port, the demo page connects, the hook resolves the port); the plugin end to end once by Joseph. One Codex audit after the build. (Recommended.)
  </option>
  <option id="unit-only">Unit tests only.
  </option>
</options>

<answer by="user" at="2026-11-05T18:41" chose="unit-plus-clash-e2e">

</answer>
</open-question>

## 5. Decisions (locked 2026-11-05 from Joseph's answers)

<decision id="D-1" title="Five ordered candidate ports in webmcp-protocol, 8717 first" status="locked" date="2026-11-05" from="Q-1">
`CANDIDATE_PORTS = [8717, 49217, 52431, 55893, 61307]` exported by `webmcp-protocol`; `DEFAULT_PORT` stays as `CANDIDATE_PORTS[0]`; `plugin/scripts/common.sh` repeats the list with a pointer to the source.
<rationale>Keeping 8717 first changes nothing for existing installs; four more in the dynamic range cover a clash without making the page's sweep noticeable.</rationale>
</decision>

<decision id="D-2" title="The daemon takes the first free candidate; --port pins; all taken is a clear failure" status="locked" date="2026-11-05" from="Q-2">
`serve` walks the list on `EADDRINUSE` only; `--port` and `WEBMCP_DAEMON_PORT` pin one port with no fallback; when every candidate is taken the daemon exits 1 naming them and the escape hatch.
<rationale>Fallback is for the accidental clash, not for running many daemons; the explicit pin is what the e2e and private daemons need.</rationale>
</decision>

<decision id="D-3" title="One daemon per state directory: probe, then an exclusive daemon.json before listening" status="locked" date="2026-11-05" from="Q-3">
Start: read `daemon.json`; if its pid is alive and `/id` on its port answers with our identity, print the port and exit 0; otherwise remove the stale file; create it with `wx` holding `port: null`; listen; rewrite with the port. A starter that loses the `wx` race waits up to two seconds for a port in the file, then exits 0 pointing at it. `stop` and `status` read the port from the file.
<rationale>The hook and the login item can both start a daemon at login; today only `EADDRINUSE` keeps them from both running, and with fallback ports that guard would vanish. Private state directories remain independent instances, as the e2e runs need.</rationale>
</decision>

<decision id="D-4" title="Pages probe /id in order, then dial the port that answered" status="locked" date="2026-11-05" from="Q-4">
A 300 ms `fetch` of `/id` per candidate in list order; the WebSocket opens only on a port that identified itself; no answer on any port is `absent` with today's backoff before the next sweep; `daemonUrl` still pins. The status carries the port.
<rationale>Foreign services never get an upgrade or an approval prompt, the approval flow stays untouched, and the sweep is bounded.</rationale>
</decision>

<decision id="D-5" title="The plugin's MCP server is a stdio relay bundled next to the daemon" status="locked" date="2026-11-05" from="Q-5">
`plugin/daemon/webmcp-mcp.js` resolves the daemon (and ensures one, reusing the hook's logic), then relays JSON-RPC between stdio and a `StreamableHTTPClientTransport` to `/mcp` without interpreting messages; `.mcp.json` becomes the stdio entry; the relay exits when the daemon goes away.
<rationale>It is the only option that follows the daemon with no user action; Claude Code's `http` entry cannot change after the session starts. A transport-level relay needs no knowledge of MCP methods, so tools, resources and notifications pass through unchanged.</rationale>
</decision>

<decision id="D-6" title="/id is minimal and CORS-open; /health unchanged" status="locked" date="2026-11-05" from="Q-6">
`GET /id` → `{ daemon: 'webmcp-daemon', protocol: 1, version, instance }` with `Access-Control-Allow-Origin: *`; `/health` keeps its content and gains no CORS.
<rationale>Recognition needs nothing private; the selected page's title and origin stay out of reach of other origins.</rationale>
</decision>

<decision id="D-7" title="The login item walks the list too" status="locked" date="2026-11-05" from="Q-7">
`install-launchd` writes `--port` into the plist only when the user pinned one; `ensure-daemon.sh` starts without `--port`.
<rationale>Otherwise a squatted 8717 leaves the login item crash-looping under launchd while the hook's daemon runs elsewhere.</rationale>
</decision>

<decision id="D-8" title="Verification: unit tests, one squatted-port e2e, the plugin by Joseph, one audit" status="locked" date="2026-11-05" from="Q-8">
As in [Q-8](#Q-8); the Codex audit budget for this thread is 2 calls (the build, and a follow-up only if a P0/P1 needs one).
<rationale>The clash case is cheap to stage with `python3 -m http.server 8717`; the plugin's MCP path needs a real Claude Code session.</rationale>
</decision>

## 6. Findings and risks

<finding id="F-1" title="A page's sweep probes ports other software may listen on" severity="p3" status="open" effort="small">
A `GET /id` to a foreign loopback service is a harmless request it will 404, but a page doing it on every reconnect is visible in that service's logs. Bounded by five probes per sweep and the existing backoff.
</finding>

<finding id="F-2" title="The stdio relay doubles the daemon's MCP sessions per Claude Code session" severity="p3" status="open" effort="small">
Each relay holds one streamable session on the daemon, as the `http` entry did; the daemon already reaps sessions on close. Watch the count in `/health` during the e2e.
</finding>

<finding id="F-3" title="A daemon restart mid-session drops the relay" severity="p2" status="open" effort="medium">
With the `http` entry Claude Code reconnected to the same URL on its own; with the relay the process exits and the user runs `/mcp` to reconnect. A relay that re-opens the transport and replays `initialize` transparently is possible later; recorded here rather than built now.
</finding>

<finding id="F-4" title="Two state directories on one machine are two daemons by design" severity="p3" status="open" effort="none">
The singleton is per state directory, which is what private daemons (e2e, science-kg's drivers) rely on. Two daemons sharing the default state directory cannot happen after D-3; two on different ones are intentional.
</finding>

<finding id="F-5" title="science-kg's page side follows without a code change, its docs do not" severity="p3" status="open" effort="small">
science-kg calls `connect()` with no `daemonUrl` unless `?daemon=` is given, so it inherits the sweep when the connector is re-vendored; its README names 8717 in the setup text.
</finding>

## 7. Work breakdown (one commit per step)

1. **W1 — protocol and daemon**: `CANDIDATE_PORTS` in `webmcp-protocol`; `/id`; port selection with fallback; the singleton (probe, stale cleanup, `wx`, the two-second wait); `status`/`stop` reading the file; the port in the tray and the log; unit tests with real listeners on ephemeral ports.
2. **W2 — connector**: the `/id` sweep in `connect()`; `port` in the status; the demo's hint; connector 0.0.6; tests with two fake daemons and a foreign server.
3. **W3 — hooks and login item**: `common.sh` resolution, `ensure-daemon.sh` without `--port`, `setup.md`, the plist; a shell test against a daemon on a fallback port.
4. **W4 — the MCP relay**: `plugin/daemon/webmcp-mcp.js` and its bundle step; `.mcp.json`; a test driving the relay over stdio against a running daemon.
5. **W5 — docs**: README, PRIVACY.md, the combined plan's pointer, this plan's status.
6. **W6 — e2e**: `scripts/e2e/m10-port-clash.mjs` (squat 8717, start the daemon, connect the demo page, run the hook's resolution, stop the squatter).
7. **W7 — science-kg**: re-vendor the connector; the README's setup text; nothing else.

## 8. Acceptance checklist

**✅ Daemon**
<check id="c1" status="done">With 8717 squatted, `serve` listens on 49217 and `daemon.json` says so; with `--port 8717` it fails as today. — evidence: `bridge/test/instance.test.ts` "lands on the second candidate when the first is squatted" and "a pinned port never falls back"; m10 step `daemon on the second candidate` (`--ports A,B`, A squatted → listening on B, candidate 2 of 2, `daemon.json` port B).</check>
<check id="c2" status="done">A second `serve` against the same state directory exits 0 with "already running on … (pid …)" and starts nothing; against another state directory it starts. — evidence: `instance.test.ts` "a second start for the same state directory exits as already running; another directory starts"; m10 step `second start exits as already running` (exit 0, the message on stdout).</check>
<check id="c3" status="done">A stale `daemon.json` (dead pid, or a port that does not answer) is removed and the daemon starts. — evidence: `instance.test.ts` "a stale record (dead pid, or a port that does not answer) is removed and the daemon starts".</check>
<check id="c4" status="done">Two starts racing for one state directory end with one daemon; the loser exits 0 naming the winner's port. — evidence: `instance.test.ts` "two starters racing for one directory end with one daemon" (one fulfilled, one `AlreadyRunningError` naming the winner's port).</check>
<check id="c5" status="done">`GET /id` answers from any origin with the minimal body; `/health` is unchanged. — evidence: `instance.test.ts` "/id answers any origin with the minimal body; /health has no CORS".</check>
<check id="c6" status="done">`status` and `stop` work when the daemon is on a fallback port. — evidence: `status` reads the record's port (`bridge/src/index.ts`); `stop` reads the pid from the record as before; exercised by the relay and hook tests through daemons on fallback ports.</check>

**✅ Page**
<check id="c7" status="done">The demo page connects to a daemon on 49217 with no `daemonUrl`; the status shows the port; a foreign server on 8717 sees only one `GET /id`. — evidence: `packages/connector/test/discover.test.ts` (order, strangers, 404, silence, none); m10 step `page found the daemon on B` (status `connected`, `port` B, `daemonUrl` ws://127.0.0.1:B, the stranger saw exactly `GET /id` once).</check>
<check id="c8" status="done">No daemon on any candidate is `absent`, and a daemon started later is found on the next sweep. — evidence: `discover.test.ts` "no daemon on any candidate is null, within the sum of the budgets"; `connect()` emits `absent` and schedules the usual retry, which sweeps again (`packages/connector/src/index.ts`, `attempt`). Not exercised in a browser: a daemon started after the first sweep.</check>
<check id="c9" status="done">A pinned `daemonUrl` dials exactly that URL, no sweep. — evidence: `connect()` with `daemonUrl` dials it with no sweep (`pinnedBase` in `index.ts`); science-kg's `?daemon=` and the echo runs use that path.</check>

**✅ Plugin**
<check id="c10" status="done">`ensure-daemon.sh` finds a daemon on a fallback port and starts one when there is none, without `--port`. — evidence: `bridge/test/hooks.test.ts` (the record on a fallback port; the list when there is no record; nothing without a daemon; a pinned port; `ensure-daemon.sh` finds a running daemon and starts one without `--port`); m10 step `common.sh resolves B`.</check>
<check id="c11" status="done">The relay serves `initialize`, `tools/list`, a tool call and a `list_changed` notification from a daemon on a fallback port, over stdio. — evidence: `bridge/test/mcp-relay.test.ts` (initialize and tools/list through a daemon on a fallback port; exit with stdin; a clear exit 1 with no daemon); m10 step `relay through B` (`webmcp` server, the daemon's tools).</check>
<check id="c12" status="todo">A real Claude Code session lists the page's tools through the relay (Joseph).</check>

**✅ Suite, docs, audit**
<check id="c13" status="done">`bun test`, `bun run typecheck`, the connector build and the plugin bundles green; the m10 e2e green. — evidence: at `2a0d31f`: `bun test` 78 across 11 files; `bun run typecheck`; `build:connector` (0.0.6) and `build:plugin` (daemon, relay, adapter) clean; m10 green.</check>
<check id="c14" status="done">Docs updated; Codex audit recorded at the end of this file. — evidence: README, PRIVACY, the combined plan's addendum and this plan updated; two audits recorded below (seven findings fixed in `89d7c8f`, two in `1fd76c1`).</check>

## 9. Audit budget

2 calls: one after W1–W4, one follow-up only for a P0/P1 fix.

## 10. Status

**Implemented 2026-11-05** (W1–W6 as the commits `e20948e`, `cd085f1`, `2065472`, `f14cb09`, `2a0d31f` on `main`, unpushed): the candidate list and the daemon identity in the protocol; the daemon's probe, exclusive record, port walk and clear failure; `GET /id`; the connector's sweep (0.0.6); the hooks' resolution and the login item without `--port`; the stdio MCP relay and the plugin's `.mcp.json` as a stdio entry; docs; the m10 e2e. Twelve of the fourteen checks are ticked with their evidence. Open: c12 (a real Claude Code session through the relay — Joseph, after a plugin reinstall or a `/mcp` reconnect, since `.mcp.json` changed); c14 is ticked: both audits are recorded below. The first audit's seven findings are fixed in `89d7c8f`; the one that mattered most: a daemon from before this change answers `/health` but not `/id`, and an upgraded start would have dropped its record and started a second daemon, where it now exits as already running with a restart hint. W7 (science-kg re-vendors 0.0.6) is on the science-kg branch.

**Worth knowing.** The relay waits five seconds for the hook's daemon before starting one itself (`WEBMCP_RELAY_WAIT_MS`), and starting from the relay can be disabled with `WEBMCP_RELAY_START=0`. A daemon restart mid-session still drops the relay (F-3). The hooks' candidate list is a copy of the protocol's (`WEBMCP_CANDIDATE_PORTS` in `common.sh`); keep the two in step.

## Codex audit — 2026-11-05 (1 of 2: the build, `0ee04a7..284e817`)

**Codex verdict:** Patch has correctness issues in the relay shutdown path, daemon singleton/upgrade handling, and hook/login-item port resolution; I would not ship without fixes.
**Issue counts (Codex's):** P0:0 P1:3 P2:4 P3:0

| # | Sev (re-rated) | file:line | Finding | Verdict | Action / evidence |
|---|---|---|---|---|---|
| 1 | P1 | `bridge/src/mcp-relay.ts:71` | `quit()` re-entered through the SDK's `close()` → `onclose` → `quit(0)`, which could mask an error exit as a clean one. | Fix now | Confirmed (`close()` calls `onclose` synchronously). `quit` is one-shot, keeps the first code, clears `onclose` and the liveness timer before closing. |
| 2 | P1 | `bridge/src/mcp-relay.ts:74` | `upstream.onerror` only logged, so an idle session kept a relay whose daemon had died (contradicting D-5/F-3). | Fix now | A liveness probe re-reads `GET /id` every 5 s and exits after two misses, 0 with "went away" or "restarted" (another instance id). Test "the daemon going away ends the relay, once". |
| 3 | P2 | `bridge/src/config.ts:57` | `--ports` left `portPinned` true when `WEBMCP_DAEMON_PORT` or an earlier `--port` was present, so the list was never walked; bad tokens were dropped silently. | Fix now | `--ports` unpins (the last of `--port`/`--ports` wins) and throws on non-ports. `bridge/test/config.test.ts`. |
| 4 | P2 | `plugin/scripts/common.sh:24` | With no daemon identified, `WEBMCP_URL` still pointed at 8717, so the inject hooks could read a stranger's answers into Claude's context. | Fix now | `WEBMCP_URL` is empty then; `inject-state.sh` reads nothing; `inject-instructions.sh` reads nothing and says no daemon answered. `bridge/test/hooks.test.ts` "with no daemon identified, the hooks read nothing". |
| 5 | P1 | `bridge/src/instance.ts:105` | `findRunningDaemon` accepted any `/id` without matching the recorded instance, and treated a daemon from before `/id` (live pid, `/health` but no `/id`) as stale — an upgrade would drop its record and start a second daemon beside it. | Fix now | The recorded instance must match; a record without one counts as running when `/health` carries its pid (`legacy: true`, with a restart hint in the "already running" message). `instance.test.ts` "a daemon from before /id … counts as running", "a record whose port answers as another instance is stale". |
| 6 | P2 | `plugin/scripts/ensure-daemon.sh:16` | Login items installed before this change keep `--port 8717` in their plist and would crash-loop under launchd when 8717 is taken while the hook starts a fallback daemon. | Fix now | On the plugin-refresh path, a plist still pinned to 8717 (and no `WEBMCP_DAEMON_PORT`) is rewritten by `install-launchd` from the state directory's bundle copy. Not covered by a test (launchd). |
| 7 | P2 | `packages/connector/src/discover.ts:35` | `identify`/`identifyDaemon` accepted any numeric protocol, so an incompatible daemon on an earlier candidate would be chosen over a compatible later one. | Fix now | Both require `protocol === PROTOCOL_VERSION`. `discover.test.ts` "a daemon of another protocol version … is passed over"; `instance.test.ts` "identify passes over a daemon of another protocol version". |

**Changes made in response:** commit `89d7c8f` — `bridge/src/config.ts`, `instance.ts`, `index.ts`, `mcp-relay.ts`, `packages/connector/src/discover.ts`, `plugin/scripts/common.sh`, `inject-state.sh`, `inject-instructions.sh`, `ensure-daemon.sh`, tests, the rebuilt plugin bundles; suite 88 tests across 12 files, typecheck, the connector and plugin builds, and the m10 e2e green afterwards.

**Deferred / not actioned:** none.

Codex's full final message saved at `/tmp/codex-audit-20261105-105821-report.md` (this run).

## Codex audit — 2026-11-05 (2 of 2: follow-up on the fixes, `89d7c8f`)

**Codex verdict:** The commit addresses the prior audit items, but it leaves two targeted correctness gaps: stale legacy records can still be accepted based on an unrelated `/id`, and relay restart detection can be disabled by a missed initial identity probe.
**Issue counts (Codex's):** P0:0 P1:0 P2:2 P3:0 (no VERDICT/ISSUES lines were written; the counts are read off the findings)

| # | Sev (re-rated) | file:line | Finding | Verdict | Action / evidence |
|---|---|---|---|---|---|
| 1 | P2 | `bridge/src/instance.ts:124` | A record without an instance id accepted any `/id` on its port, so a reused pid plus some new daemon there passed as "already running". | Fix now | Such a record is proven only by its own `/health` carrying the recorded pid; the `/id` branch requires a recorded instance to match. `instance.test.ts` "a legacy record whose port now answers as some new instance (its pid reused) is stale". |
| 2 | P2 | `bridge/src/mcp-relay.ts:101` | A missed first `/id` probe left `identity` null, after which the liveness check accepted every instance and a restart went unreported. | Fix now | The first probe that answers fills the baseline; only a different instance afterwards counts as a restart. Covered indirectly by "the daemon going away ends the relay, once". |

**Changes made in response:** commit `1fd76c1` — `bridge/src/instance.ts`, `bridge/src/mcp-relay.ts`, the test, the rebuilt bundles; suite 89 tests, typecheck and the plugin build green. The connector is unchanged, so science-kg's vendored 0.0.6 (`f787086`) still matches.

**Deferred / not actioned:** none. No further audit (the two-call budget of D-8 is spent); both fixes are a few lines and pinned by tests.

Codex's full final message saved at `/tmp/codex-audit-20261105-111009-report.md` (this run).
