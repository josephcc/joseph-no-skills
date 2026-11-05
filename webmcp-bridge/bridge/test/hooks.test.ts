// The plugin's hook scripts follow the daemon to whatever port it took (plans/daemon-port-discovery/main.md c10).
import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonConfig } from '../src/config.ts';
import { daemonFilePath, readDaemonRecord } from '../src/instance.ts';
import { serve, type Daemon } from '../src/index.ts';

const HOST = '127.0.0.1';
const ROOT = join(import.meta.dir, '..', '..');
const SCRIPTS = join(ROOT, 'plugin', 'scripts');
const squatters: Server[] = [];
const daemons: Daemon[] = [];
const dirs: string[] = [];
const spawnedPids: number[] = [];

afterEach(async () => {
  for (const d of daemons.splice(0)) await d.close();
  for (const pid of spawnedPids.splice(0)) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  for (const s of squatters.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => { const s = createServer(); s.listen(0, HOST, () => { const port = (s.address() as { port: number }).port; s.close(() => resolve(port)); }); });
}
function squat(port: number): Promise<void> {
  return new Promise((resolve) => { const s = createServer(); squatters.push(s); s.listen(port, HOST, () => resolve()); });
}
function stateDir(): string { const d = mkdtempSync(join(tmpdir(), 'webmcp-hooks-')); dirs.push(d); return d; }
function config(dir: string, candidates: number[]): DaemonConfig {
  return { host: HOST, port: candidates[0]!, portPinned: false, portCandidates: candidates, stateDir: dir, allowOrigins: [], noBrowser: true, approval: 'reject', agents: [], callTimeoutMs: 1000, idleAgentMs: 60_000, tray: false, trayText: false, version: 'test' };
}
/** Sources common.sh with the given environment and prints what it resolved. */
function resolve(env: Record<string, string>): string {
  return execFileSync('bash', ['-c', `. "${SCRIPTS}/common.sh"; printf '%s' "$WEBMCP_PORT"`], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

describe('common.sh resolves the daemon port', () => {
  test('from the record the daemon wrote, on a fallback port', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await squat(a);
    const dir = stateDir();
    const d = await serve(config(dir, [a, b]));
    daemons.push(d);
    expect(resolve({ WEBMCP_DAEMON_STATE: dir, WEBMCP_CANDIDATE_PORTS: '1 2' })).toBe(String(b));
  });
  test('from the candidate list when there is no record; nothing when there is no daemon', async () => {
    const [a, b] = [await freePort(), await freePort()];
    const dir = stateDir();
    const d = await serve(config(dir, [b]));
    daemons.push(d);
    unlinkSync(daemonFilePath(dir));
    expect(resolve({ WEBMCP_DAEMON_STATE: dir, WEBMCP_CANDIDATE_PORTS: `${a} ${b}` })).toBe(String(b));
    expect(resolve({ WEBMCP_DAEMON_STATE: stateDir(), WEBMCP_CANDIDATE_PORTS: `${a}` })).toBe('');
  });
  test('a pinned WEBMCP_DAEMON_PORT wins without probing', () => {
    expect(resolve({ WEBMCP_DAEMON_STATE: stateDir(), WEBMCP_DAEMON_PORT: '12345', WEBMCP_CANDIDATE_PORTS: '1' })).toBe('12345');
  });
});

describe('with no daemon identified, the hooks read nothing (Codex audit)', () => {
  test('WEBMCP_URL stays empty; inject-state prints nothing; inject-instructions says no daemon answered', async () => {
    const a = await freePort();
    const env = { ...process.env, WEBMCP_DAEMON_STATE: stateDir(), WEBMCP_CANDIDATE_PORTS: String(a), CLAUDE_PLUGIN_OPTION_INJECT_PAGE_CONTEXT: 'true' };
    expect(execFileSync('bash', ['-c', `. "${SCRIPTS}/common.sh"; printf '%s|%s' "$WEBMCP_PORT" "$WEBMCP_URL"`], { env, encoding: 'utf8' })).toBe('|');
    expect(execFileSync('bash', [join(SCRIPTS, 'inject-state.sh')], { env, encoding: 'utf8' })).toBe('');
    const out = JSON.parse(execFileSync('bash', [join(SCRIPTS, 'inject-instructions.sh')], { env, encoding: 'utf8' })) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toMatch(/No webmcp-daemon answered/);
  });
});

describe('ensure-daemon.sh', () => {
  test('finds a running daemon on a fallback port and starts nothing', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await squat(a);
    const dir = stateDir();
    const d = await serve(config(dir, [a, b]));
    daemons.push(d);
    const before = readDaemonRecord(dir);
    const r = spawnSync('bash', [join(SCRIPTS, 'ensure-daemon.sh')], { env: { ...process.env, WEBMCP_DAEMON_STATE: dir, WEBMCP_CANDIDATE_PORTS: '1 2', WEBMCP_DAEMON_NO_TRAY: '1' }, encoding: 'utf8', timeout: 20_000 });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(readDaemonRecord(dir)).toEqual(before);
  });
  test('starts a daemon when there is none, without pinning a port, and it records the port it took', async () => {
    const pinned = await freePort();
    const dir = stateDir();
    // Pinned here only so the spawned daemon lands on a known free port instead of the real candidates.
    const r = spawnSync('bash', [join(SCRIPTS, 'ensure-daemon.sh')], { env: { ...process.env, WEBMCP_DAEMON_STATE: dir, WEBMCP_DAEMON_PORT: String(pinned), WEBMCP_DAEMON_NO_TRAY: '1', WEBMCP_DAEMON_NO_BROWSER: '1' }, encoding: 'utf8', timeout: 30_000 });
    const rec = readDaemonRecord(dir);
    if (rec) spawnedPids.push(rec.pid);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(rec?.port).toBe(pinned);
    const health = await fetch(`http://${HOST}:${pinned}/health`).then((x) => x.json() as Promise<{ ok: boolean }>);
    expect(health.ok).toBe(true);
  });
});
