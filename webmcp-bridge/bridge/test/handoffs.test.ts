// The handoff registry and its routes (plans/terminal-handoff/main.md §2.2): only a local process offers, a page
// sees what was offered to its origin, records persist, liveness comes from a lister.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DaemonConfig } from '../src/config.ts';
import { HANDOFF_CAP, HandoffRegistry, validateHandoff, type LiveSession } from '../src/handoffs.ts';
import { serve, type Daemon } from '../src/index.ts';

const HOST = '127.0.0.1';
const ID = (n: number) => `0000000${n}-1111-4222-8333-444444444444`.slice(-36);
const daemons: Daemon[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const d of daemons.splice(0)) await d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(prefix = 'webmcp-handoff-'): string { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; }
function freePort(): Promise<number> {
  return new Promise((resolve) => { const s = createServer(); s.listen(0, HOST, () => { const port = (s.address() as { port: number }).port; s.close(() => resolve(port)); }); });
}
const none = async (): Promise<LiveSession[]> => [];

describe('validateHandoff', () => {
  test('refuses what a page or a typo could send', () => {
    const cwd = tmp();
    expect(validateHandoff(null)).toBe('expected a JSON object');
    expect(validateHandoff({ sessionId: 'nope', cwd })).toBe('sessionId must be a UUID');
    expect(validateHandoff({ sessionId: ID(1), cwd: 'relative/dir' })).toBe('cwd must be an absolute path');
    expect(validateHandoff({ sessionId: ID(1), cwd: join(cwd, 'missing') })).toBe('cwd does not exist');
    expect(validateHandoff({ sessionId: ID(1), cwd, origin: 'null' })).toBe('origin must be an http(s) site origin');
    expect(validateHandoff({ sessionId: ID(1), cwd, pid: -1 })).toBe('pid must be a positive integer');
    expect(validateHandoff({ sessionId: ID(1), cwd, tags: { a: 1 } })).toBe('tags must be an object of strings');
    expect(validateHandoff({ sessionId: ID(1), cwd, origin: 'http://localhost:47821', title: 't', tags: { analysis: '/x' }, pid: 42 })).toBeNull();
  });
});

describe('HandoffRegistry', () => {
  test('offer, replace, forget, persist across instances; newest first; capped', () => {
    const state = tmp(); const cwd = tmp();
    const reg = new HandoffRegistry(state, none);
    const a = reg.offer({ sessionId: ID(1).toUpperCase(), cwd, title: 'first' });
    expect(a.sessionId).toBe(ID(1));
    expect(a.offeredAt).toMatch(/^\d{4}-/);
    reg.offer({ sessionId: ID(2), cwd, origin: 'http://localhost:47821' });
    reg.offer({ sessionId: ID(1), cwd, title: 'first again' });   // replaces, moves to the top
    expect(reg.all().map((h) => h.sessionId)).toEqual([ID(1), ID(2)]);
    expect(reg.get(ID(1))?.title).toBe('first again');
    expect(JSON.parse(readFileSync(join(state, 'handoffs.json'), 'utf8'))).toHaveLength(2);
    const again = new HandoffRegistry(state, none);
    expect(again.all().map((h) => h.sessionId)).toEqual([ID(1), ID(2)]);
    expect(again.forget(ID(2).toUpperCase())).toBe(true);
    expect(again.forget(ID(2))).toBe(false);
    expect(again.all()).toHaveLength(1);
    for (let i = 10; i < 10 + HANDOFF_CAP + 5; i++) again.offer({ sessionId: ID(i), cwd });
    expect(again.all()).toHaveLength(HANDOFF_CAP);
    expect(again.get(ID(1))).toBeUndefined();   // the oldest fell off
  });

  test('visibility by origin: offered to one origin, or to any', () => {
    const reg = new HandoffRegistry(tmp(), none); const cwd = tmp();
    reg.offer({ sessionId: ID(1), cwd, origin: 'http://localhost:47821' });
    reg.offer({ sessionId: ID(2), cwd });
    reg.offer({ sessionId: ID(3), cwd, origin: 'http://localhost:5173' });
    expect(reg.visibleTo('http://localhost:47821').map((h) => h.sessionId)).toEqual([ID(2), ID(1)]);
    expect(reg.visibleTo(undefined).map((h) => h.sessionId)).toEqual([ID(3), ID(2), ID(1)]);
    expect(reg.forOrigin(ID(1), 'http://localhost:47821')?.cwd).toBe(cwd);
    expect(reg.get(ID(1).toUpperCase())?.sessionId).toBe(ID(1));   // a re-cased UUID is the same record
    expect(reg.forOrigin(ID(1).toUpperCase(), 'http://localhost:47821')?.cwd).toBe(cwd);
    expect(reg.forOrigin(ID(1), 'http://localhost:5173')).toBeUndefined();
    expect(reg.forOrigin(ID(2), 'http://localhost:5173')?.cwd).toBe(cwd);
  });

  test('liveness: matched by session id, cached, and unknown when the lister fails', async () => {
    const cwd = tmp();
    let calls = 0;
    const reg = new HandoffRegistry(tmp(), async () => { calls++; return [{ sessionId: ID(1), pid: 99, kind: 'interactive', status: 'idle' }]; });
    reg.offer({ sessionId: ID(1), cwd }); reg.offer({ sessionId: ID(2), cwd });
    const rows = await reg.withLiveness(reg.all());
    expect(rows.find((r) => r.sessionId === ID(1))?.live).toEqual({ sessionId: ID(1), pid: 99, kind: 'interactive', status: 'idle', heldByPage: false });
    expect(rows.find((r) => r.sessionId === ID(2))?.live).toBeNull();
    await reg.withLiveness(reg.all());
    expect(calls).toBe(1);   // cached
    const broken = new HandoffRegistry(tmp(), async () => { throw new Error('no claude'); });
    broken.offer({ sessionId: ID(1), cwd });
    const r2 = await broken.withLiveness(broken.all());
    expect(r2[0]!.live).toBeNull(); expect(r2[0]!.liveUnknown).toBe(true);
  });
});

describe('handoff routes', () => {
  function config(dir: string, port: number): DaemonConfig {
    return { host: HOST, port, portPinned: true, stateDir: dir, allowOrigins: ['http://localhost:47821'], noBrowser: true, approval: 'reject', agents: [], callTimeoutMs: 1000, idleAgentMs: 60_000, tray: false, trayText: false, version: 'test' };
  }
  test('local processes offer; pages read and forget within their origin; strangers are refused', async () => {
    const state = tmp(); const cwd = tmp();
    const port = await freePort();
    daemons.push(await serve(config(state, port)));
    const base = `http://${HOST}:${port}`;
    const json = { 'content-type': 'application/json' };
    // a page cannot offer
    let r = await fetch(`${base}/handoff`, { method: 'POST', headers: { ...json, origin: 'http://localhost:47821' }, body: JSON.stringify({ sessionId: ID(1), cwd }) });
    expect(r.status).toBe(403);
    // a local process can, and bad input is a 400 with the reason
    r = await fetch(`${base}/handoff`, { method: 'POST', headers: json, body: JSON.stringify({ sessionId: 'x', cwd }) });
    expect(r.status).toBe(400); expect(((await r.json()) as { error: string }).error).toBe('sessionId must be a UUID');
    r = await fetch(`${base}/handoff`, { method: 'POST', headers: json, body: JSON.stringify({ sessionId: ID(1), cwd, origin: 'http://localhost:47821', title: 'Study · thematic analysis', tags: { analysis: '/a' } }) });
    expect(r.status).toBe(200);
    r = await fetch(`${base}/handoff`, { method: 'POST', headers: json, body: JSON.stringify({ sessionId: ID(2), cwd, origin: 'http://localhost:5173' }) });
    expect(r.status).toBe(200);
    r = await fetch(`${base}/handoff`, { method: 'POST', headers: json, body: JSON.stringify({ sessionId: ID(3), cwd }) });
    expect(r.status).toBe(200);
    // the page sees its own and the unscoped one, with CORS
    r = await fetch(`${base}/handoffs?page=x`, { headers: { origin: 'http://localhost:47821' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:47821');
    const list = (await r.json()) as { handoffs: Array<{ sessionId: string; live: unknown; tags?: Record<string, string> }> };
    expect(list.handoffs.map((h) => h.sessionId)).toEqual([ID(3), ID(1)]);
    expect(list.handoffs[1]!.tags).toEqual({ analysis: '/a' });
    // a stranger origin is refused outright
    r = await fetch(`${base}/handoffs`, { headers: { origin: 'http://evil.example' } });
    expect(r.status).toBe(403);
    // a local reader sees everything
    r = await fetch(`${base}/handoffs`);
    expect(((await r.json()) as { handoffs: unknown[] }).handoffs).toHaveLength(3);
    // preflight, then forget: the page may not forget another origin's record
    r = await fetch(`${base}/handoffs/forget`, { method: 'OPTIONS', headers: { origin: 'http://localhost:47821', 'access-control-request-method': 'POST' } });
    expect(r.status).toBe(204); expect(r.headers.get('access-control-allow-methods')).toBe('POST');
    r = await fetch(`${base}/handoffs/forget`, { method: 'POST', headers: { ...json, origin: 'http://localhost:47821' }, body: JSON.stringify({ sessionId: ID(2) }) });
    expect(r.status).toBe(404);
    r = await fetch(`${base}/handoffs/forget`, { method: 'POST', headers: { ...json, origin: 'http://localhost:47821' }, body: JSON.stringify({ sessionId: ID(1) }) });
    expect(r.status).toBe(200);
    r = await fetch(`${base}/status.json`);
    const status = (await r.json()) as { handoffs: Array<{ sessionId: string; tags?: unknown }> };
    expect(status.handoffs.map((h) => h.sessionId)).toEqual([ID(3), ID(2)]);
    expect(status.handoffs[0]!.tags).toBeUndefined();
  }, 15_000);
});

describe('HandoffRegistry.liveHolder', () => {
  test('fresh skips the cache; the holder is matched by id', async () => {
    const cwd = tmp();
    let calls = 0;
    let rows: LiveSession[] = [];
    const reg = new HandoffRegistry(tmp(), async () => { calls++; return rows; });
    reg.offer({ sessionId: ID(1), cwd });
    expect(await reg.liveHolder(ID(1))).toBeNull();
    rows = [{ sessionId: ID(1), pid: 7, kind: 'interactive', status: 'idle' }];
    expect(await reg.liveHolder(ID(1))).toBeNull();            // cached listing
    expect(await reg.liveHolder(ID(1), { fresh: true })).toEqual({ ...rows[0]!, heldByPage: false }); // fresh listing
    expect(await reg.liveHolder(ID(1).toUpperCase(), { fresh: true })).toEqual({ ...rows[0]!, heldByPage: false });
    expect(calls).toBe(3);
  });
  test('a holder whose parent is one of the daemon\'s own agents is heldByPage', async () => {
    const cwd = tmp();
    const parents: Record<number, number> = { 7: 100, 8: 200 };
    const reg = new HandoffRegistry(tmp(), async () => [{ sessionId: ID(1), pid: 7, kind: 'interactive' }, { sessionId: ID(2), pid: 8, kind: 'interactive' }], async (pid) => parents[pid]);
    reg.offer({ sessionId: ID(1), cwd }); reg.offer({ sessionId: ID(2), cwd });
    expect((await reg.liveHolder(ID(1), { ownAdapterPids: [100] }))?.heldByPage).toBe(true);
    expect((await reg.liveHolder(ID(2), { ownAdapterPids: [100] }))?.heldByPage).toBe(false);
    const views = await reg.withLiveness(reg.all(), [200]);
    expect(views.map((v) => [v.sessionId, v.live?.heldByPage])).toEqual([[ID(2), true], [ID(1), false]]);
  });
});

describe('one session id listed twice (Codex audit, 2026-11-14)', () => {
  test('a holder that is not one of the daemon\'s agents wins over one that is', async () => {
    const cwd = tmp();
    const parents: Record<number, number> = { 7: 100, 8: 555 };
    const reg = new HandoffRegistry(tmp(), async () => [{ sessionId: ID(1), pid: 7, kind: 'interactive' }, { sessionId: ID(1), pid: 8, kind: 'interactive', status: 'idle' }], async (pid) => parents[pid]);
    reg.offer({ sessionId: ID(1), cwd });
    const h = await reg.liveHolder(ID(1), { ownAdapterPids: [100] });
    expect(h).toEqual({ sessionId: ID(1), pid: 8, kind: 'interactive', status: 'idle', heldByPage: false });
    const views = await reg.withLiveness(reg.all(), [100]);
    expect(views[0]!.live?.pid).toBe(8);
    const onlyOurs = new HandoffRegistry(tmp(), async () => [{ sessionId: ID(1), pid: 7 }], async () => 100);
    onlyOurs.offer({ sessionId: ID(1), cwd });
    expect((await onlyOurs.liveHolder(ID(1), { ownAdapterPids: [100] }))?.heldByPage).toBe(true);
  });
});

describe('loopback Host only (DNS rebinding)', () => {
  function config(dir: string, port: number): DaemonConfig {
    return { host: HOST, port, portPinned: true, stateDir: dir, allowOrigins: ['http://localhost:47821'], noBrowser: true, approval: 'reject', agents: [], callTimeoutMs: 1000, idleAgentMs: 60_000, tray: false, trayText: false, version: 'test' };
  }
  test('a rebound hostname is refused on every route; 127.0.0.1 and localhost with the port are served', async () => {
    const port = await freePort();
    daemons.push(await serve(config(tmp(), port)));
    const base = `http://${HOST}:${port}`;
    for (const path of ['/handoffs', '/status.json', '/id', '/health', '/pages']) {
      const r = await fetch(`${base}${path}`, { headers: { host: 'evil.example' } });
      expect([path, r.status]).toEqual([path, 403]);
    }
    expect((await fetch(`${base}/handoffs`, { headers: { host: `127.0.0.1.attacker.example:${port}` } })).status).toBe(403);
    expect((await fetch(`${base}/handoffs`, { headers: { host: `localhost:${port}` } })).status).toBe(200);
    expect((await fetch(`${base}/handoffs`, { headers: { host: `localhost:${port + 1}` } })).status).toBe(403);
    expect((await fetch(`${base}/id`)).status).toBe(200);
  }, 15_000);
});
