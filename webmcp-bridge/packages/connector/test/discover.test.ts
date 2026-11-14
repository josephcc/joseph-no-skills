// The page's port sweep (plans/daemon-port-discovery/main.md D-4, c7–c9): the first candidate that answers
// GET /id as the daemon wins, strangers and silence are skipped, order is respected.
import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net';
import { discoverDaemon, identifyDaemon } from '../src/discover.ts';

const HOST = '127.0.0.1';
const servers: Array<Server | TcpServer> = [];
afterEach(async () => { for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r())); });

function freePort(): Promise<number> {
  return new Promise((resolve) => { const s = createTcpServer(); s.listen(0, HOST, () => { const port = (s.address() as { port: number }).port; s.close(() => resolve(port)); }); });
}
/** An HTTP server answering GET /id with `body` (a stranger answers something else, or nothing). */
function serveId(port: number, body: unknown, { status = 200, hang = false }: { status?: number; hang?: boolean } = {}): Promise<void> {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      if (hang) return;   // never answers: the probe must time out
      if (req.url === '/id') { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); return; }
      res.writeHead(404); res.end();
    });
    servers.push(s);
    s.listen(port, HOST, () => resolve());
  });
}
const identity = (instance = 'i1') => ({ daemon: 'webmcp-daemon', protocol: 1, version: 'test', instance });

describe('identifyDaemon', () => {
  test('the daemon identifies itself; a stranger does not', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await serveId(a, identity());
    await serveId(b, { hello: 'world' });
    expect(await identifyDaemon(HOST, a)).toEqual(identity());
    expect(await identifyDaemon(HOST, b)).toBeNull();
  });
  test('nothing listening, or a server that never answers, is null within the budget', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await serveId(b, identity(), { hang: true });
    const t0 = Date.now();
    expect(await identifyDaemon(HOST, a, 200)).toBeNull();
    expect(await identifyDaemon(HOST, b, 200)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('discoverDaemon', () => {
  test('walks the candidates in order: a stranger on the first, the daemon on the second', async () => {
    const [a, b, c] = [await freePort(), await freePort(), await freePort()];
    await serveId(a, { not: 'ours' });
    await serveId(b, identity('two'));
    await serveId(c, identity('three'));
    const found = await discoverDaemon({ candidates: [a, b, c], timeoutMs: 200 });
    expect(found).toEqual({ port: b, httpBase: `http://${HOST}:${b}`, wsBase: `ws://${HOST}:${b}`, identity: identity('two') });
  });
  test('an empty port and a 404 are skipped; the last candidate still wins', async () => {
    const [a, b, c] = [await freePort(), await freePort(), await freePort()];
    await serveId(b, { error: 'not here' }, { status: 404 });
    await serveId(c, identity());
    expect((await discoverDaemon({ candidates: [a, b, c], timeoutMs: 200 }))?.port).toBe(c);
  });
  test('a daemon of another protocol version on an earlier candidate is passed over (Codex audit)', async () => {
    const [a, b] = [await freePort(), await freePort()];
    await serveId(a, { ...identity('old'), protocol: 2 });
    await serveId(b, identity('ours'));
    expect((await discoverDaemon({ candidates: [a, b], timeoutMs: 200 }))?.port).toBe(b);
  });
  test('no daemon on any candidate is null, within the sum of the budgets', async () => {
    const [a, b] = [await freePort(), await freePort()];
    const t0 = Date.now();
    expect(await discoverDaemon({ candidates: [a, b], timeoutMs: 200 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
