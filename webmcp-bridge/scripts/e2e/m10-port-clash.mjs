// M10: a stranger on the first candidate port (plans/daemon-port-discovery/main.md c1, c2, c7, c10, c11). A foreign
// HTTP server squats port A; the daemon started with `--ports A,B` lands on B and records it; a second start for the
// same state directory exits 0 as "already running"; the demo page given `?ports=A,B` finds B after one GET /id on A;
// the hook's common.sh resolves B; the MCP relay serves initialize and tools/list through B. Needs the demo on
// DEMO_PORT (default 5179: `bun run demo -- --port 5179 --strictPort`). Starts and stops its own daemon and squatter.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { launchChrome, waitFor, sleep } from './cdp.mjs';

const DEMO_PORT = Number(process.env.DEMO_PORT ?? 5179);
const ORIGIN = `http://127.0.0.1:${DEMO_PORT}`;
const ROOT = new URL('../../', import.meta.url).pathname;
const out = { steps: [] };
const step = (name, data) => { out.steps.push({ name, ...data }); console.error('step', name, JSON.stringify(data).slice(0, 240)); };
const freePort = () => new Promise((resolve) => { const s = createTcpServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const stateDir = mkdtempSync(join(tmpdir(), 'webmcp-m10-'));
const children = [];
const spawnDaemon = (extra = []) => {
  const child = spawn(process.execPath, [join(ROOT, 'bridge/src/index.ts'), 'serve', '--state-dir', stateDir, '--ports', `${A},${B}`, '--allow-origin', ORIGIN, '--no-browser', '--no-tray', ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let text = '';
  child.stdout.on('data', (d) => { text += d; }); child.stderr.on('data', (d) => { text += d; });
  return { child, output: () => text, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
};

const [A, B] = [await freePort(), await freePort()];
// The stranger: an HTTP server that counts what reaches it.
const seen = [];
const squatter = createServer((req, res) => { seen.push(`${req.method} ${req.url}`); res.writeHead(404); res.end('not the daemon'); });
await new Promise((r) => squatter.listen(A, '127.0.0.1', r));
let page; let close = () => {};
try {
  // c1: the daemon lands on B.
  const first = spawnDaemon();
  await waitFor(async () => { try { const r = await fetch(`http://127.0.0.1:${B}/id`); return r.ok ? await r.json() : null; } catch { return null; } }, 'daemon on B', { tries: 60 });
  const record = JSON.parse(await (await import('node:fs')).promises.readFile(join(stateDir, 'daemon.json'), 'utf8'));
  step('daemon on the second candidate (c1)', { A, B, recordPort: record.port, log: first.output().split('\n').find((l) => l.includes('listening')) ?? null });
  if (record.port !== B) throw new Error('the daemon did not record port B');

  // c2: a second start for the same state directory exits 0 as already running.
  const second = spawnDaemon();
  const code = await second.exited;
  step('second start exits as already running (c2)', { code, output: second.output().trim().slice(0, 120) });
  if (code !== 0 || !/already running/.test(second.output())) throw new Error('the second start did not exit 0 as already running');

  // c7: the demo page sweeps A then B.
  ({ page, close } = await launchChrome({ url: `${ORIGIN}/?ports=${A},${B}`, webmcp: true, port: 9346 }));
  await waitFor(() => page.evaluate('document.readyState === "complete" && !!window.__demo'), 'demo loaded');
  const status = JSON.parse(await waitFor(async () => { const s = await page.evaluate('JSON.stringify(window.__demo.page.status)'); return JSON.parse(s).state === 'connected' ? s : null; }, 'page connected', { tries: 60 }));
  step('page found the daemon on B (c7)', { state: status.state, port: status.port, daemonUrl: status.daemonUrl, squatterSaw: [...seen], badge: await page.evaluate('document.getElementById("daemon-badge").textContent') });
  if (status.port !== B) throw new Error('the page did not connect to B');
  if (seen.filter((s) => s === 'GET /id').length !== 1 || seen.length !== 1) throw new Error(`the stranger saw more than one GET /id: ${seen.join(', ')}`);

  // c10: the hook's resolution.
  const resolved = await new Promise((resolve) => { const p = spawn('bash', ['-c', `. "${join(ROOT, 'plugin/scripts/common.sh')}"; printf '%s' "$WEBMCP_PORT"`], { env: { ...process.env, WEBMCP_DAEMON_STATE: stateDir, WEBMCP_CANDIDATE_PORTS: `${A} ${B}` } }); let t = ''; p.stdout.on('data', (d) => { t += d; }); p.on('exit', () => resolve(t)); });
  step('common.sh resolves B (c10)', { resolved });
  if (resolved !== String(B)) throw new Error('the hook did not resolve port B');

  // c11: the relay.
  const relay = spawn(process.execPath, [join(ROOT, 'bridge/src/mcp-relay.ts')], { env: { ...process.env, WEBMCP_DAEMON_STATE: stateDir, WEBMCP_RELAY_START: '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(relay);
  const replies = new Map(); let relayErr = '';
  relay.stderr.on('data', (d) => { relayErr += d; });
  createInterface({ input: relay.stdout }).on('line', (line) => { try { const m = JSON.parse(line); if (m.id !== undefined) replies.set(m.id, m); } catch { /* not json */ } });
  const ask = (id, method, params) => { relay.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); return waitFor(() => replies.get(id) ?? null, method, { tries: 60 }); };
  const init = await ask(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'm10', version: '0' } });
  relay.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  const tools = await ask(2, 'tools/list', {});
  const names = tools.result.tools.map((t) => t.name);
  step('relay through B (c11)', { server: init.result.serverInfo, tools: names.slice(0, 6), relayed: /relaying stdio/.test(relayErr) });
  if (!names.includes('webmcp_list_pages')) throw new Error('the relay did not list the daemon tools');
  relay.stdin.end();
} catch (err) {
  out.error = String(err?.stack ?? err);
} finally {
  try { page?.close(); } catch { /* none */ }
  close();
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  await new Promise((r) => squatter.close(() => r()));
  await sleep(300);
  rmSync(stateDir, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
