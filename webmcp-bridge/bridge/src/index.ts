#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CANDIDATE_PORTS } from 'webmcp-protocol';
import { HELP, parseArgs, type DaemonConfig, type HandoffArgs } from './config.ts';
import { AlreadyRunningError, claimDaemonFile, findRunningDaemon, locateDaemon, pickPort, readDaemonRecord, removeDaemonFile, updateDaemonFile, type DaemonRecord } from './instance.ts';
import { claudeAgentsLister, HandoffRegistry } from './handoffs.ts';
import { createHttpServer } from './http.ts';
import { log } from './log.ts';
import { Registry } from './registry.ts';
import { OriginPolicy } from './security.ts';
import { Workspaces } from './workspace.ts';
import { PageServer } from './ws-server.ts';
import { createMcpHandler } from './mcp.ts';
import { AcpRelay } from './acp.ts';
import { installLaunchd, uninstallLaunchd } from './launchd.ts';
import { Tray } from './tray.ts';

const VERSION = '0.0.1';

export interface Daemon { close(): Promise<void>; port: number; instance: string; registry: Registry }

/**
 * Starts the daemon for `config.stateDir`: one instance per state directory, on
 * the pinned port or the first free candidate (plans/daemon-port-discovery
 * D-2, D-3). Throws `AlreadyRunningError` when an instance is already serving
 * that directory and `AllPortsTakenError` when no candidate can be bound.
 */
export async function serve(config: DaemonConfig): Promise<Daemon> {
  mkdirSync(config.stateDir, { recursive: true });
  const running = await findRunningDaemon(config.stateDir, config.host);
  if (running) throw new AlreadyRunningError(running.pid, running.port, config.host, running.legacy);
  const instance = randomUUID();
  const record: DaemonRecord = { pid: process.pid, port: null, startedAt: new Date().toISOString(), version: VERSION, instance };
  if (!claimDaemonFile(config.stateDir, record)) {
    // Another starter claimed the file between our probe and our write: it is the daemon, once it has a port.
    const other = await findRunningDaemon(config.stateDir, config.host);
    if (other) throw new AlreadyRunningError(other.pid, other.port, config.host);
    if (!claimDaemonFile(config.stateDir, record)) throw new Error(`could not claim ${join(config.stateDir, 'daemon.json')}`);
  }
  try {
    const candidates = config.portPinned ? [config.port] : (config.portCandidates ?? CANDIDATE_PORTS);
    // Pick, build, listen; a port taken between the pick and the listen (rare) means pick again.
    for (let attempt = 1; ; attempt++) {
      const picked = await pickPort(candidates, config.host);
      config.port = picked.port;
      const built = build(config, instance);
      try {
        await new Promise<void>((resolve, reject) => {
          built.server.once('error', reject);
          built.server.listen(config.port, config.host, () => { built.server.off('error', reject); resolve(); });
        });
      } catch (err) {
        await built.dispose();
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && attempt < 3) continue;
        throw err;
      }
      updateDaemonFile(config.stateDir, { ...record, port: config.port });
      const which = candidates.length > 1 ? ` (candidate ${picked.index + 1} of ${candidates.length})` : '';
      log.info(`listening on http://${config.host}:${config.port}${which} (ws: /ws, mcp: /mcp, acp: /acp, state dir: ${config.stateDir}, pre-approved origins: ${config.allowOrigins.join(', ') || 'none'})`);
      return built.start();
    }
  } catch (err) {
    removeDaemonFile(config.stateDir);
    throw err;
  }
}

/** Everything behind the port: constructed once the port is known, since the welcome frame and the approval page carry it. */
function build(config: DaemonConfig, instance: string) {
  const httpBase = `http://${config.host}:${config.port}`;
  const wsBase = `ws://${config.host}:${config.port}`;
  const registry = new Registry();
  const policy = new OriginPolicy(config.stateDir, config.allowOrigins, config.noBrowser, httpBase, config.approval === 'log' ? (url) => log.info(`approval needed (open this URL): ${url}`) : undefined);
  const workspaces = new Workspaces(config.stateDir);
  const mcp = createMcpHandler({ registry, config, version: VERSION });
  const handoffs = new HandoffRegistry(config.stateDir, claudeAgentsLister(() => acpRelay.claudeExecutable()));
  const acpRelay = new AcpRelay({ registry, policy, workspaces, config, handoffs });
  const pages = new PageServer({ registry, policy, workspaces, version: VERSION, callTimeoutMs: config.callTimeoutMs, httpBase, wsBase, agents: () => acpRelay.agents() });
  const server = createHttpServer({ config, registry, policy, pages, mcp: mcp.handle, acpUpgrade: (req, socket, head) => void acpRelay.handleUpgrade(req, socket, head), acpStatus: () => acpRelay.status(), agents: () => acpRelay.agents(), instance, handoffs, adapterPids: () => acpRelay.adapterPids() });
  const dispose = async () => { await acpRelay.close(); await mcp.close(); };
  const start = (): Daemon => {
    registry.on('selection', ({ pageId }: { pageId?: string }) => log.info(`selected page: ${pageId ?? 'none'}`));
    let tray: Tray | undefined;
    const close = async () => {
      tray?.stop();
      await dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      removeDaemonFile(config.stateDir);
    };
    if (config.tray) {
      tray = new Tray({ registry, config, agentCount: () => acpRelay.status().length, shutdown: () => { void close().then(() => process.exit(0)); } });
      tray.start();
    }
    return { close, port: config.port, instance, registry };
  };
  return { server, dispose, start };
}

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2), VERSION); } catch (err) { process.stderr.write(`${String(err)}\n${HELP}`); process.exit(2); }
  const { command, config, handoff } = parsed;
  if (command === 'help') { process.stdout.write(HELP); return; }
  if (command === 'handoff') { await runHandoff(config, handoff); return; }
  if (command === 'status') {
    // The daemon may be on a fallback port: the record in the state directory says which.
    const port = config.portPinned ? config.port : (readDaemonRecord(config.stateDir)?.port ?? config.port);
    try { const r = await fetch(`http://${config.host}:${port}/health`); process.stdout.write((await r.text()) + '\n'); }
    catch { process.stdout.write(`no daemon on ${config.host}:${port}\n`); process.exitCode = 1; }
    return;
  }
  if (command === 'stop') {
    try {
      const { pid } = JSON.parse(readFileSync(join(config.stateDir, 'daemon.json'), 'utf8')) as { pid: number };
      process.kill(pid, 'SIGTERM'); process.stdout.write(`sent SIGTERM to ${pid}\n`);
    } catch (err) { process.stdout.write(`nothing to stop (${String(err)})\n`); process.exitCode = 1; }
    return;
  }
  if (command === 'install-launchd') {
    const entry = process.argv[1]!;
    try { process.stdout.write(installLaunchd(config, entry, { dryRun: process.argv.includes('--dry-run') }) + '\n'); } catch (err) { process.stderr.write(String(err) + '\n'); process.exit(1); }
    return;
  }
  if (command === 'uninstall-launchd') { process.stdout.write(uninstallLaunchd() + '\n'); return; }

  let daemon: Daemon;
  try {
    daemon = await serve(config);
  } catch (err) {
    // A second start for a state directory is not a failure: the hook and the login item both call this.
    if (err instanceof AlreadyRunningError) { process.stdout.write(`${err.message}\n`); return; }
    throw err;
  }
  const shutdown = (sig: string) => { log.info(`${sig}: shutting down`); void daemon.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/** `handoff`: offer (or forget) a terminal session through the running daemon's `/handoff` route (plans/terminal-handoff §2.5). */
async function runHandoff(config: DaemonConfig, args: HandoffArgs): Promise<void> {
  const session = (args.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? '').trim();
  if (!session) { process.stderr.write('handoff: no session id. Pass --session <uuid>, or run this inside a Claude Code session (its shell commands carry CLAUDE_CODE_SESSION_ID).\n'); process.exit(2); }
  const candidates = config.portCandidates ?? CANDIDATE_PORTS;
  const port = config.portPinned ? config.port : await locateDaemon(config.stateDir, config.host, candidates);
  if (!port) { process.stderr.write(`handoff: no webmcp-daemon on ${config.host} (tried ${candidates.join(', ')}); start one with \`claude\` (the plugin's session hook) or \`webmcp-daemon serve\`.\n`); process.exit(1); }
  const base = `http://${config.host}:${port}`;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = { error: text || `HTTP ${r.status}` }; }
    return { ok: r.ok, status: r.status, body: parsed };
  };
  if (args.forget) {
    const r = await post('/handoffs/forget', { sessionId: session });
    if (!r.ok) { process.stderr.write(`handoff: ${String(r.body.error ?? `HTTP ${r.status}`)}\n`); process.exit(1); }
    process.stdout.write(`handoff withdrawn: session ${session}\n`);
    return;
  }
  const cwd = args.cwd ?? process.cwd();
  const pid = process.env.CLAUDE_PID ? Number(process.env.CLAUDE_PID) : undefined;
  const r = await post('/handoff', { sessionId: session, cwd, ...(args.origin ? { origin: args.origin } : {}), ...(args.title ? { title: args.title } : {}), ...(args.note ? { note: args.note } : {}), ...(Object.keys(args.tags).length ? { tags: args.tags } : {}), ...(pid && Number.isInteger(pid) ? { pid } : {}) });
  if (!r.ok) { process.stderr.write(`handoff: ${String(r.body.error ?? `HTTP ${r.status}`)}${r.status === 404 ? ' (the daemon on this port predates handoffs; restart it from the current plugin)' : ''}\n`); process.exit(1); }
  process.stdout.write(`handoff registered: session ${session} in ${cwd}${args.origin ? ` for ${args.origin}` : ' for any approved page'} (daemon ${base}).\n`
    + `The page's chat lists it under "From your terminal". Press Ctrl+D in this terminal to release the session before continuing in the browser; \`claude --resume ${session}\` brings it back here.\n`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main().catch((err) => { log.error(String(err?.stack ?? err)); process.exit(1); });
