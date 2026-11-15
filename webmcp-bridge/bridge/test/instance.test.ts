// One daemon per state directory, on the first free candidate port (plans/daemon-port-discovery/main.md c1–c6).
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonConfig } from '../src/config.ts';
import { AllPortsTakenError, AlreadyRunningError, claimDaemonFile, daemonFilePath, findRunningDaemon, identify, pickPort, readDaemonRecord } from '../src/instance.ts';
import { serve, type Daemon } from '../src/index.ts';

const HOST = '127.0.0.1';
const squatters: Array<Server | HttpServer> = [];
const daemons: Daemon[] = [];
const dirs: string[] = [];

afterEach(async () => {
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
/** A fake daemon answering /id with `id` (or 404 without it) and /health with `healthPid`. */
function fakeDaemon(port: number, { id, healthPid }: { id?: Record<string, unknown>; healthPid?: number }): Promise<void> {
  return new Promise((resolve) => {
    const s = createHttpServer((req, res) => {
      if (req.url === '/id' && id) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(id)); return; }
      if (req.url === '/health' && healthPid !== undefined) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, pid: healthPid })); return; }
      res.writeHead(404); res.end();
    });
    squatters.push(s);
    s.listen(port, HOST, () => resolve());
  });
}
function stateDir(): string { const d = mkdtempSync(join(tmpdir(), 'webmcp-instance-')); dirs.push(d); return d; }
function config(dir: string, candidates: number[]): DaemonConfig {
  return { host: HOST, port: candidates[0]!, portPinned: false, portCandidates: candidates, stateDir: dir, allowOrigins: [], noBrowser: true, approval: 'reject', agents: [], callTimeoutMs: 1000, idleAgentMs: 60_000, tray: false, trayText: false, version: 'test' };
}
async function start(cfg: DaemonConfig): Promise<Daemon> { const d = await serve(cfg); daemons.push(d); return d; }

describe('pickPort', () => {
  test('the first free candidate, skipping taken ones', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await squat(a);
    expect(await pickPort([a, b], HOST)).toEqual({ port: b, index: 1 });
  });
  test('every candidate taken is a clear error naming them', async () => {
    const a = await freePort();
    await squat(a);
    await expect(pickPort([a], HOST)).rejects.toBeInstanceOf(AllPortsTakenError);
    await expect(pickPort([a], HOST)).rejects.toThrow(String(a));
  });
});

describe('serve', () => {
  test('lands on the second candidate when the first is squatted, and records it (c1)', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await squat(a);
    const dir = stateDir();
    const d = await start(config(dir, [a, b]));
    expect(d.port).toBe(b);
    expect(readDaemonRecord(dir)).toMatchObject({ pid: process.pid, port: b, instance: d.instance });
  });

  test('a pinned port never falls back', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await squat(a);
    const cfg = { ...config(stateDir(), [a, b]), port: a, portPinned: true };
    await expect(serve(cfg)).rejects.toBeInstanceOf(AllPortsTakenError);
  });

  test('a second start for the same state directory exits as "already running"; another directory starts (c2)', async () => {
    const [a, b] = [await freePort(), await freePort()];
    const dir = stateDir();
    const first = await start(config(dir, [a, b]));
    let err: unknown;
    try { await serve(config(dir, [a, b])); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AlreadyRunningError);
    expect((err as AlreadyRunningError).port).toBe(first.port);
    expect((err as AlreadyRunningError).pid).toBe(process.pid);
    // The record still belongs to the first daemon.
    expect(readDaemonRecord(dir)?.instance).toBe(first.instance);
    const second = await start(config(stateDir(), [a, b]));
    expect(second.port).toBe(b);
  });

  test('a stale record (dead pid, or a port that does not answer) is removed and the daemon starts (c3)', async () => {
    const [a, b] = [await freePort(), await freePort()];
    const dir = stateDir();
    writeFileSync(daemonFilePath(dir), JSON.stringify({ pid: 2 ** 31 - 7, port: a, startedAt: 'x', version: 'old' }));
    const d = await start(config(dir, [a, b]));
    expect(d.port).toBe(a);
    await d.close();
    daemons.length = 0;
    // A live pid (ours) whose port answers nothing: stale after the wait.
    writeFileSync(daemonFilePath(dir), JSON.stringify({ pid: process.pid, port: b, startedAt: 'x', version: 'old' }));
    expect(await findRunningDaemon(dir, HOST, { waitMs: 300 })).toBeNull();
    expect(readDaemonRecord(dir)).toBeNull();
  });

  test('two starters racing for one directory end with one daemon (c4)', async () => {
    const [a, b] = [await freePort(), await freePort()];
    const dir = stateDir();
    const results = await Promise.allSettled([serve(config(dir, [a, b])), serve(config(dir, [a, b]))]);
    const started = results.filter((r): r is PromiseFulfilledResult<Daemon> => r.status === 'fulfilled').map((r) => r.value);
    daemons.push(...started);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(started).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reason).toBeInstanceOf(AlreadyRunningError);
    expect((refused[0]!.reason as AlreadyRunningError).port).toBe(started[0]!.port);
  });

  test('/id answers any origin with the minimal body; /health has no CORS (c5)', async () => {
    const dir = stateDir();
    const d = await start(config(dir, [await freePort()]));
    const id = await fetch(`http://${HOST}:${d.port}/id`, { headers: { origin: 'https://example.org' } });
    expect(id.headers.get('access-control-allow-origin')).toBe('*');
    expect(await id.json()).toEqual({ daemon: 'webmcp-bridge', protocol: 1, version: 'test', instance: d.instance });
    const health = await fetch(`http://${HOST}:${d.port}/health`);
    expect(health.headers.get('access-control-allow-origin')).toBeNull();
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true);
  });

  test('close removes the record; a claim after that succeeds', async () => {
    const dir = stateDir();
    const d = await start(config(dir, [await freePort()]));
    await d.close();
    daemons.length = 0;
    expect(readDaemonRecord(dir)).toBeNull();
    expect(claimDaemonFile(dir, { pid: process.pid, port: null, startedAt: 'x', version: 'test' })).toBe(true);
    expect(claimDaemonFile(dir, { pid: process.pid, port: null, startedAt: 'x', version: 'test' })).toBe(false);
    expect(JSON.parse(readFileSync(daemonFilePath(dir), 'utf8')).port).toBeNull();
  });
});

describe('findRunningDaemon and identify (Codex audit on the port-discovery build)', () => {
  test('a daemon from before /id, whose /health carries the recorded pid, counts as running and keeps its record', async () => {
    const port = await freePort();
    await fakeDaemon(port, { healthPid: process.pid });
    const dir = stateDir();
    writeFileSync(daemonFilePath(dir), JSON.stringify({ pid: process.pid, port, startedAt: 'x', version: '0.0.1' }));
    expect(await findRunningDaemon(dir, HOST, { waitMs: 300 })).toEqual({ pid: process.pid, port, legacy: true });
    expect(readDaemonRecord(dir)?.port).toBe(port);
    let err: unknown;
    try { await serve(config(dir, [await freePort()])); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AlreadyRunningError);
    expect((err as Error).message).toMatch(/predates port discovery/);
  });
  test('a record whose port answers as another instance is stale, not ours', async () => {
    const port = await freePort();
    await fakeDaemon(port, { id: { daemon: 'webmcp-bridge', protocol: 1, version: 'x', instance: 'theirs' } });
    const dir = stateDir();
    writeFileSync(daemonFilePath(dir), JSON.stringify({ pid: process.pid, port, startedAt: 'x', version: 'x', instance: 'ours' }));
    expect(await findRunningDaemon(dir, HOST, { waitMs: 300 })).toBeNull();
    expect(readDaemonRecord(dir)).toBeNull();
  });
  test('a legacy record whose port now answers as some new instance (its pid reused) is stale (Codex audit 2)', async () => {
    const port = await freePort();
    await fakeDaemon(port, { id: { daemon: 'webmcp-bridge', protocol: 1, version: 'x', instance: 'new' }, healthPid: 424242 });
    const dir = stateDir();
    writeFileSync(daemonFilePath(dir), JSON.stringify({ pid: process.pid, port, startedAt: 'x', version: '0.0.1' }));
    expect(await findRunningDaemon(dir, HOST, { waitMs: 300 })).toBeNull();
    expect(readDaemonRecord(dir)).toBeNull();
  });
  test('identify passes over a daemon of another protocol version', async () => {
    const port = await freePort();
    await fakeDaemon(port, { id: { daemon: 'webmcp-bridge', protocol: 2, version: 'x', instance: 'i' } });
    expect(await identify(HOST, port)).toBeNull();
  });
});
