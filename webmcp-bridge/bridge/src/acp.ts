import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { WebSocketServer } from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import { AcpServer } from '@agentclientprotocol/sdk/experimental/server';
import { createNodeWebSocketUpgradeHandler } from '@agentclientprotocol/sdk/experimental/node';
import type { DaemonConfig } from './config.ts';
import type { HandoffRegistry } from './handoffs.ts';
import { log } from './log.ts';
import type { Registry } from './registry.ts';
import type { OriginPolicy } from './security.ts';
import { handoffLoadOf, heldElsewhereError, rewriteOutbound, type GuardContext } from './session-guard.ts';
import type { Workspaces } from './workspace.ts';

export interface AcpDeps { registry: Registry; policy: OriginPolicy; workspaces: Workspaces; config: DaemonConfig; handoffs?: HandoffRegistry }

const ADAPTER_PACKAGE = '@agentclientprotocol/claude-agent-acp';
const ADAPTER_VERSION = '0.100.0';
const DISCONNECT_GRACE_MS = 5_000;

/**
 * `/acp`: the embedded chat. Each browser connection gets its own claude-agent-acp process
 * (the ACP *agent*); the page is the ACP *client*. The daemon relays frames as they are except
 * for the session requests (plans/terminal-handoff/main.md §2.3, the security audit's F-1):
 * `cwd` is forced to the page's workspace and `mcpServers` to the daemon's page server, with a
 * registered terminal handoff as the one exception (the page's prompt is then appended to Claude
 * Code's own instead of replacing it), and `_meta.claudeCode.options` is filtered.
 */
export class AcpRelay {
  readonly #deps: AcpDeps;
  readonly #wss = new WebSocketServer({ noServer: true });
  readonly #children = new Map<ChildProcess, { pageId?: string; origin: string; startedAt: number; lastActivity: number }>();
  readonly #server: AcpServer;
  readonly #upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  readonly #reaper: ReturnType<typeof setInterval>;
  #adapterCmd: { cmd: string; args: string[] } | undefined;
  #claudePath: string | undefined;

  constructor(deps: AcpDeps) {
    this.#deps = deps;
    this.#server = new AcpServer({ createAgent: () => this.#connector() });
    this.#upgrade = createNodeWebSocketUpgradeHandler(this.#server, this.#wss);
    this.#reaper = setInterval(() => this.#reapIdle(), 30_000);
    this.#reaper.unref();
  }

  /** Called by http.ts for `/acp` upgrades: origin check, then hand the socket to the SDK's server. */
  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const origin = req.headers.origin;
    if (!origin) { rejectUpgrade(socket, 403, 'Origin header required'); return; }
    socket.on('error', () => {});
    const allowed = await this.#deps.policy.decide(origin, 'embedded chat');
    if (socket.destroyed) return;
    if (!allowed) { log.warn(`acp: denied origin ${origin}`); rejectUpgrade(socket, 403, 'origin denied'); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    const pageId = url.searchParams.get('page') ?? undefined;
    const agentId = url.searchParams.get('agent') ?? 'claude';
    if (agentId !== 'claude' && !this.#deps.config.agents.some((a) => a.id === agentId)) { rejectUpgrade(socket, 404, 'unknown agent'); return; }
    this.#pendingContext = { origin, pageId, agentId };
    this.#upgrade(req, socket, head);
  }

  #pendingContext: { origin: string; pageId?: string; agentId?: string } | undefined;

  #connector() {
    const ctx = this.#pendingContext ?? { origin: 'unknown' };
    this.#pendingContext = undefined;
    return {
      connect: (clientStream: acp.Stream) => {
        const page = ctx.pageId ? this.#deps.registry.get(ctx.pageId) : undefined;
        const cwd = page ? this.#deps.workspaces.ensure(page) : this.#deps.workspaces.ensure({ slug: 'unknown', origin: ctx.origin, title: ctx.origin });
        const { cmd, args } = this.#adapterFor(ctx.agentId ?? 'claude');
        const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_AGENT_ACP_PROTOCOL: 'v1' };
        const claude = (ctx.agentId ?? 'claude') === 'claude' ? this.#claude() : undefined;
        if (claude) env.CLAUDE_CODE_EXECUTABLE = claude;
        const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env });
        const meta = { pageId: page?.id, origin: ctx.origin, startedAt: Date.now(), lastActivity: Date.now() };
        this.#children.set(child, meta);
        log.info(`acp: spawned agent "${ctx.agentId ?? 'claude'}" pid ${child.pid} for ${ctx.origin}${page ? ` (page ${page.id})` : ''} in ${cwd}`);
        child.stderr?.on('data', (d: Buffer) => {
          for (const line of d.toString().split('\n')) {
            const s = line.trim();
            if (!s || /ExperimentalWarning|--trace-warnings|^\[session\/(create|query|models)\]|^\[authStatus\]/.test(s)) continue;
            log.warn(`agent ${child.pid}: ${s.slice(0, 400)}`);
          }
        });
        const agentStream = acp.ndJsonStream(Writable.toWeb(child.stdin!) as unknown as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>);
        // Page → agent: the session guard decides cwd and mcpServers (a registered handoff is the exception); then
        // touch activity on traffic in either direction so the idle reaper spares busy sessions.
        const guard: GuardContext = {
          origin: ctx.origin, workspaceDir: cwd,
          pageMcpUrl: page ? `http://${this.#deps.config.host}:${this.#deps.config.port}/mcp/by-page/${page.id}` : undefined,
          handoffFor: (id) => this.#deps.handoffs?.forOrigin(id, ctx.origin),
          log: (line) => log.info(`acp guard (${ctx.origin}, pid ${child.pid}): ${line}`),
        };
        // Agent → page, with a handle to answer in the agent's place: a handoff load is refused here, before the adapter
        // sees it, while any other process still holds that session (Claude Code itself only refuses for background
        // sessions; two interactive resumes of one transcript would both append to it).
        let toClient: TransformStreamDefaultController<acp.AnyMessage> | undefined;
        const touch2 = new TransformStream<acp.AnyMessage, acp.AnyMessage>({ start: (c) => { toClient = c; }, transform: (m, c) => { meta.lastActivity = Date.now(); c.enqueue(m); } });
        const touch = new TransformStream<acp.AnyMessage, acp.AnyMessage>({ transform: async (m, c) => {
          meta.lastActivity = Date.now();
          const handoffId = handoffLoadOf(m, guard);
          if (handoffId && this.#deps.handoffs) {
            const live = await this.#deps.handoffs.liveHolder(handoffId, { fresh: true, ownAdapterPids: this.adapterPids() }).catch(() => null);
            if (live && !live.heldByPage) {   // our own agent (this page's earlier connection, still in its grace period) does not count
              log.warn(`acp guard (${ctx.origin}, pid ${child.pid}): refused session/load of handoff ${handoffId}: held by pid ${live.pid ?? '?'} (${live.kind ?? '?'}, ${live.status ?? '?'})`);
              toClient?.enqueue(heldElsewhereError(m, live) as acp.AnyMessage);
              return;
            }
          }
          c.enqueue(rewriteOutbound(m, guard) as acp.AnyMessage);
        } });
        // When the browser side goes away, give the adapter a few seconds (it persists the session) and then stop it;
        // a reload reconnects with a fresh adapter and `session/load`.
        const stopSoon = () => { if (child.exitCode === null && !child.killed) setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM'); }, DISCONNECT_GRACE_MS).unref(); };
        clientStream.readable.pipeThrough(touch).pipeTo(agentStream.writable).then(stopSoon, stopSoon);
        agentStream.readable.pipeThrough(touch2).pipeTo(clientStream.writable, { preventCancel: true }).catch(() => {});
        const closed = new Promise<void>((resolve) => {
          child.once('exit', (code, signal) => { this.#children.delete(child); log.info(`acp: agent pid ${child.pid} exited (${code ?? signal})`); resolve(); });
          child.once('error', (err) => {   // e.g. a misconfigured --agent command: fail this connection, keep the daemon alive
            this.#children.delete(child);
            log.error(`acp: could not start agent "${ctx.agentId ?? 'claude'}" (${cmd}): ${err.message}`);
            clientStream.writable.close().catch(() => {});
            resolve();
          });
        });
        return { closed };
      },
    };
  }

  /** Agents the embedded chat may pick from: Claude (the adapter) plus any configured with --agent. */
  agents(): Array<{ id: string; name: string; default: boolean }> {
    return [{ id: 'claude', name: 'Claude', default: true }, ...this.#deps.config.agents.map((a) => ({ id: a.id, name: a.name, default: false }))];
  }

  #adapterFor(agentId: string): { cmd: string; args: string[] } {
    if (agentId === 'claude') return this.#adapter();
    const a = this.#deps.config.agents.find((x) => x.id === agentId);
    if (!a) throw new Error(`unknown agent ${agentId}`);
    return { cmd: a.command[0]!, args: a.command.slice(1) };
  }

  #adapter(): { cmd: string; args: string[] } {
    if (this.#adapterCmd) return this.#adapterCmd;
    const explicit = process.env.WEBMCP_ACP_AGENT;
    if (explicit) { const [cmd, ...args] = explicit.split(' '); this.#adapterCmd = { cmd: cmd!, args }; return this.#adapterCmd; }
    const sibling = join(dirname(process.argv[1] ?? ''), 'claude-agent-acp.js');   // bundled next to the daemon (plugin)
    if (existsSync(sibling)) { this.#adapterCmd = { cmd: process.execPath, args: [sibling] }; return this.#adapterCmd; }
    try {
      const require = createRequire(import.meta.url);
      const pkg = require.resolve(`${ADAPTER_PACKAGE}/package.json`);
      const entry = join(dirname(pkg), 'dist', 'index.js');
      if (existsSync(entry)) { this.#adapterCmd = { cmd: process.execPath, args: [entry] }; return this.#adapterCmd; }
    } catch { /* not installed next to us (bundled daemon): fall through */ }
    this.#adapterCmd = { cmd: 'npx', args: ['-y', `${ADAPTER_PACKAGE}@${ADAPTER_VERSION}`] };
    log.warn(`acp: ${ADAPTER_PACKAGE} not found locally; will spawn via npx (first start downloads it)`);
    return this.#adapterCmd;
  }

  /** The `claude` the embedded chat runs (also what the handoff registry asks for live sessions). */
  claudeExecutable(): string | undefined { return this.#claude(); }

  #claude(): string | undefined {
    if (this.#claudePath !== undefined) return this.#claudePath || undefined;
    const fromConfig = this.#deps.config.claudePath;
    if (fromConfig) { this.#claudePath = fromConfig; return fromConfig; }
    try { this.#claudePath = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim(); } catch { this.#claudePath = ''; }
    if (!this.#claudePath) log.warn('acp: no `claude` executable found on PATH; the adapter will use its bundled CLI if any');
    return this.#claudePath || undefined;
  }

  #reapIdle() {
    const limit = this.#deps.config.idleAgentMs;
    for (const [child, meta] of this.#children) {
      if (Date.now() - meta.lastActivity > limit) { log.info(`acp: reaping idle agent pid ${child.pid}`); child.kill('SIGTERM'); }
    }
  }

  status() { return [...this.#children.values()].map((m) => ({ ...m })); }
  /** The agent processes this daemon runs right now; their `claude` children show up in `claude agents --json`. */
  adapterPids(): number[] { return [...this.#children.keys()].map((c) => c.pid).filter((p): p is number => typeof p === 'number'); }

  async close(): Promise<void> {
    clearInterval(this.#reaper);
    for (const child of this.#children.keys()) child.kill('SIGTERM');
    await this.#server.close().catch(() => {});
  }
}

function rejectUpgrade(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
