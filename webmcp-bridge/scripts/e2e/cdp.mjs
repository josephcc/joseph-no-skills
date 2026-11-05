// Minimal Chrome DevTools Protocol driver (no dependencies; Node ≥ 22 has global WebSocket).
// Launches a throwaway Chrome profile so the user's real profile is never touched.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, label, { tries = 60, every = 500 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(every);
  }
  throw new Error(`timeout waiting for ${label}${last ? `: ${last.message ?? last}` : ''}`);
}

export async function launchChrome({ url, webmcp = true, port = 9333, extraArgs = [] } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'webmcp-e2e-'));
  const args = [
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync',
    `--remote-debugging-port=${port}`, '--window-size=1000,700', '--disable-background-timer-throttling',
    ...(webmcp ? ['--enable-features=WebMCP'] : []), ...(process.env.CHROME_EXTRA_ARGS ? process.env.CHROME_EXTRA_ARGS.split(' ') : []), ...extraArgs, url,
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore', detached: true });
  const close = () => {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
    try { proc.kill('SIGTERM'); } catch {}
    try { spawn('pkill', ['-f', `user-data-dir=${profile}`], { stdio: 'ignore' }); } catch {}   // Chrome re-parents helpers; kill by profile path too
    setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 2500);
  };
  const target = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${port}/json`); const t = await r.json();
    return t.find((x) => x.type === 'page' && x.url.startsWith(url.split('?')[0].replace(/\/$/, ''))) ?? null;
  }, 'page target');
  const page = await connectPage(target.webSocketDebuggerUrl);
  return { page, close, profile };
}

export async function connectPage(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) for (const l of listeners) l(m);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  const consoleLines = [];
  listeners.push((m) => { if (m.method === 'Runtime.consoleAPICalled') consoleLines.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`); if (m.method === 'Runtime.exceptionThrown') consoleLines.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`); });
  const evaluate = async (expression, { contextId } = {}) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };
  return { send, evaluate, consoleLines, close: () => ws.close() };
}
