#!/usr/bin/env node
/**
 * Claude Code's MCP server for the plugin: a stdio relay to the daemon's
 * streamable-HTTP `/mcp` (plans/daemon-port-discovery/main.md D-5).
 *
 * `.mcp.json` is read once per session and an `http` entry is one fixed URL,
 * so when the daemon is on a fallback port the session would have no server.
 * This process finds the daemon (the record in the state directory, then the
 * candidate ports), starts one if none is up, and relays JSON-RPC messages
 * both ways without interpreting them: tools, resources, prompts and
 * `list_changed` notifications pass through unchanged. When the daemon goes
 * away the relay exits and Claude Code reports the server as disconnected.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CANDIDATE_PORTS } from 'webmcp-protocol';
import { identify, locateDaemon } from './instance.ts';

const HOST = '127.0.0.1';
const stateDir = process.env.WEBMCP_DAEMON_STATE ?? join(homedir(), '.webmcp-daemon');
const pinned = process.env.WEBMCP_DAEMON_PORT ? Number(process.env.WEBMCP_DAEMON_PORT) : undefined;
/** The SessionStart hook usually starts the daemon at the same moment; give it this long before starting one here. */
const HOOK_GRACE_MS = Number(process.env.WEBMCP_RELAY_WAIT_MS ?? 5_000);
const START_WAIT_MS = 20_000;
/** How often the relay checks the daemon is still the one it dialled. */
const LIVENESS_MS = Number(process.env.WEBMCP_RELAY_LIVENESS_MS ?? 5_000);
const log = (msg: string) => process.stderr.write(`webmcp-mcp: ${msg}\n`);

async function locate(): Promise<number | null> {
  if (pinned) return (await identify(HOST, pinned)) ? pinned : null;
  return locateDaemon(stateDir, HOST, CANDIDATE_PORTS);
}

async function waitFor(ms: number): Promise<number | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const port = await locate();
    if (port !== null || Date.now() >= deadline) return port;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The daemon bundle next to this file (the plugin), or the source checkout (dev). */
function daemonEntry(): string | null {
  const here = dirname(new URL(import.meta.url).pathname);
  for (const candidate of [join(here, 'webmcp-daemon.js'), join(here, 'index.ts')]) if (existsSync(candidate)) return candidate;
  return null;
}

function startDaemon(): boolean {
  const entry = daemonEntry();
  if (!entry) { log('no daemon bundle next to the relay'); return false; }
  mkdirSync(stateDir, { recursive: true });
  const fd = openSync(join(stateDir, 'daemon.log'), 'a');
  const args = [entry, 'serve', '--state-dir', stateDir, ...(pinned ? ['--port', String(pinned)] : []), ...(process.env.WEBMCP_DAEMON_NO_TRAY ? [] : ['--tray'])];
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', fd, fd], env: process.env });
  child.unref();
  log(`started the daemon (pid ${child.pid})`);
  return true;
}

async function main(): Promise<void> {
  let port = await waitFor(HOOK_GRACE_MS);
  if (port === null && process.env.WEBMCP_RELAY_START !== '0' && startDaemon()) port = await waitFor(START_WAIT_MS);
  if (port === null) { log(`no daemon on ${HOST} (candidates ${CANDIDATE_PORTS.join(', ')}); run the plugin's setup`); process.exit(1); }
  const identity = await identify(HOST, port);
  const url = new URL(`http://${HOST}:${port}/mcp`);
  const upstream = new StreamableHTTPClientTransport(url);
  const stdio = new StdioServerTransport();
  // One exit, with the first code: the SDK's close() calls onclose, which must not re-enter.
  let exiting = false;
  const quit = (code: number, why?: string) => {
    if (exiting) return;
    exiting = true;
    if (why) log(why);
    upstream.onclose = undefined;
    clearInterval(liveness);
    void upstream.close().catch(() => undefined);
    process.exit(code);
  };
  stdio.onmessage = (message) => { void upstream.send(message).catch((err) => quit(1, `daemon unreachable: ${String((err as Error).message ?? err)}`)); };
  upstream.onmessage = (message) => { void stdio.send(message).catch(() => quit(0)); };
  upstream.onerror = (err) => log(`upstream: ${err.message}`);
  upstream.onclose = () => quit(0);
  stdio.onclose = () => quit(0);
  // Claude Code ends the session by closing our stdin (or a SIGTERM); the SDK's stdio transport only
  // watches for data, and the daemon's SSE stream would keep this process alive forever.
  process.stdin.on('end', () => quit(0));
  process.stdin.on('close', () => quit(0));
  process.on('SIGTERM', () => quit(0));
  process.on('SIGINT', () => quit(0));
  // The daemon going away, or restarting as a new instance, ends the relay: an idle session would
  // otherwise keep a relay whose upstream is gone (plan F-3; the SDK only reports that through onerror).
  let misses = 0;
  const liveness = setInterval(() => {
    void identify(HOST, port).then((now) => {
      if (now && (!identity || now.instance === identity.instance)) { misses = 0; return; }
      if (++misses >= 2) quit(0, now ? 'the daemon restarted; reconnect the MCP server' : 'the daemon went away');
    });
  }, LIVENESS_MS);
  liveness.unref();
  await upstream.start();
  await stdio.start();
  log(`relaying stdio ⇄ ${url}`);
}

main().catch((err) => { log(String((err as Error).stack ?? err)); process.exit(1); });
