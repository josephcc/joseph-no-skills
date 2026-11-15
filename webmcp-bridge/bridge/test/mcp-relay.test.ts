// The stdio relay Claude Code starts for the plugin (plans/daemon-port-discovery/main.md c11): finds the daemon on
// whatever port it took and passes JSON-RPC through both ways.
import { afterEach, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { DaemonConfig } from '../src/config.ts';
import { serve, type Daemon } from '../src/index.ts';

const HOST = '127.0.0.1';
const RELAY = join(import.meta.dir, '..', 'src', 'mcp-relay.ts');
const squatters: Server[] = [];
const daemons: Daemon[] = [];
const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const c of children.splice(0)) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  for (const d of daemons.splice(0)) await d.close();
  for (const s of squatters.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => { const s = createServer(); s.listen(0, HOST, () => { const port = (s.address() as { port: number }).port; s.close(() => resolve(port)); }); });
}
function squat(port: number): Promise<void> {
  return new Promise((resolve) => { const s = createServer(); squatters.push(s); s.listen(port, HOST, () => resolve()); });
}
function stateDir(): string { const d = mkdtempSync(join(tmpdir(), 'webmcp-relay-')); dirs.push(d); return d; }
function config(dir: string, candidates: number[]): DaemonConfig {
  return { host: HOST, port: candidates[0]!, portPinned: false, portCandidates: candidates, stateDir: dir, allowOrigins: [], noBrowser: true, approval: 'reject', agents: [], callTimeoutMs: 1000, idleAgentMs: 60_000, tray: false, trayText: false, version: 'test' };
}

/** Spawns the relay and speaks newline-delimited JSON-RPC to it. */
function relay(env: Record<string, string>) {
  const child = spawn(process.execPath, [RELAY], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const pending = new Map<number, (m: Record<string, unknown>) => void>();
  const notifications: Record<string, unknown>[] = [];
  let stderr = '';
  child.stderr!.on('data', (d) => { stderr += String(d); });
  createInterface({ input: child.stdout! }).on('line', (line) => {
    let m: Record<string, unknown>;
    try { m = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    if (typeof m.id === 'number' && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } else notifications.push(m);
  });
  let next = 1;
  const request = (method: string, params: unknown): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, resolve);
    child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out; stderr: ${stderr}`)); }, 15_000);
  });
  const notify = (method: string, params: unknown = {}) => { child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); };
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, request, notify, notifications, exited, stderr: () => stderr };
}

describe('webmcp-mcp relay', () => {
  test('initialize and tools/list reach a daemon on a fallback port; the relay exits with stdin', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await squat(a);
    const dir = stateDir();
    daemons.push(await serve(config(dir, [a, b])));
    const r = relay({ WEBMCP_BRIDGE_STATE: dir, WEBMCP_BRIDGE_RELAY_START: '0', WEBMCP_BRIDGE_RELAY_WAIT_MS: '3000' });
    const init = await r.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe('webmcp');
    r.notify('notifications/initialized');
    const tools = await r.request('tools/list', {});
    const names = (tools.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).toContain('webmcp_list_pages');
    expect(r.stderr()).toContain(`relaying stdio ⇄ http://${HOST}:${b}/mcp`);
    r.child.stdin!.end();
    expect(await r.exited).toBe(0);
  }, 20_000);

  test('the daemon going away ends the relay, once (Codex audit)', async () => {
    const port = await freePort();
    const dir = stateDir();
    const d = await serve({ ...config(dir, [port]), port, portPinned: true });
    daemons.push(d);
    const r = relay({ WEBMCP_BRIDGE_STATE: dir, WEBMCP_BRIDGE_RELAY_START: '0', WEBMCP_BRIDGE_RELAY_WAIT_MS: '3000', WEBMCP_BRIDGE_RELAY_LIVENESS_MS: '200' });
    const init = await r.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe('webmcp');
    r.notify('notifications/initialized');
    // Let the notification's POST complete, so the exit comes from the liveness probe, not a failed send.
    await new Promise((r2) => setTimeout(r2, 400));
    await d.close();
    daemons.length = 0;
    expect(await r.exited).toBe(0);
    expect(r.stderr()).toContain('the daemon went away');
  }, 20_000);

  test('no daemon within the wait, and starting disabled, is a clear exit 1', async () => {
    const r = relay({ WEBMCP_BRIDGE_STATE: stateDir(), WEBMCP_BRIDGE_RELAY_START: '0', WEBMCP_BRIDGE_RELAY_WAIT_MS: '300', WEBMCP_BRIDGE_PORT: String(await freePort()) });
    expect(await r.exited).toBe(1);
    expect(r.stderr()).toContain('no daemon');
  }, 20_000);
});
