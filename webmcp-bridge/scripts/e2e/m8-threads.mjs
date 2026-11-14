// Threads in the embedded chat, token-free: a private daemon with the echo agent (sessions persisted by the
// fake), the demo page in a throwaway Chrome. Needs: vite on 5173 (`bun run demo`). Plan threads-and-auto-mode §7.1.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { launchChrome, waitFor, sleep } from './cdp.mjs';

const PORT = Number(process.env.THREADS_PORT ?? 8718);
const DEMO = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/';
const ORIGIN = new URL(DEMO).origin;
const STATE = `/tmp/webmcp-e2e/threads-state`;
const ROOT = new URL('../../', import.meta.url).pathname;
const FAKE = new URL('./fake-agent.mjs', import.meta.url).pathname;
const out = { steps: [] }; const t0 = Date.now();
const step = (name, data) => out.steps.push({ name, at_ms: Date.now() - t0, ...data });

rmSync(STATE, { recursive: true, force: true });
const daemon = spawn('node', [`${ROOT}bridge/src/index.ts`, 'serve', '--port', String(PORT), '--state-dir', STATE, '--allow-origin', ORIGIN, '--no-browser', '--agent', `echo=node ${FAKE}`], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT });
const daemonLog = [];
daemon.stdout.on('data', (d) => daemonLog.push(...d.toString().split('\n').filter(Boolean)));
daemon.stderr.on('data', (d) => daemonLog.push(...d.toString().split('\n').filter(Boolean)));
await waitFor(() => fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false), 'daemon health');

const { page, close } = await launchChrome({ url: `${DEMO}?daemon=ws://127.0.0.1:${PORT}`, webmcp: true, port: 9337 });
const snap = () => page.evaluate('JSON.stringify(window.__demo.agent ? window.__demo.agent.model.snapshot() : null)').then((s) => JSON.parse(s));
const threads = () => page.evaluate('JSON.stringify(window.__demo.agent ? window.__demo.agent.connection.threads : [])').then((s) => JSON.parse(s));
const listUi = () => page.evaluate('JSON.stringify([...document.querySelectorAll(".wmc-thread")].map(li => ({ id: li.dataset.id, active: li.dataset.active, state: li.dataset.state, title: li.querySelector(".wmc-thread-title").textContent })))').then((s) => JSON.parse(s));
const texts = (s) => s.turns.flatMap((t) => t.items).filter((i) => i.kind === 'text').map((i) => i.text);
const click = (sel) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element ' + ${JSON.stringify(sel)}); el.click(); return 'clicked'; })()`);
const typeAndSend = async (text) => {
  await page.evaluate(`(() => { const ta = document.querySelector('.wmc-input textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, ${JSON.stringify(text)}); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`);
  await sleep(50);
  await page.evaluate(`(() => { const ta = document.querySelector('.wmc-input textarea'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'enter'; })()`);
};
const pickEcho = async () => {
  await waitFor(() => page.evaluate('!!document.querySelector("select[data-role=agent-picker]")'), 'agent picker');
  await page.evaluate(`(() => { const sel = document.querySelector('select[data-role=agent-picker]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, 'echo'); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'picked'; })()`);
  await click('.wmc-chat button.wmc-primary');
  return waitFor(async () => { const s = await snap().catch(() => null); return s && s.state === 'ready' && s.agentName === 'echo-agent' ? s : null; }, 'echo agent ready', { tries: 60 });
};
try {
  await waitFor(async () => JSON.parse(await page.evaluate('JSON.stringify(window.__demo.page.status)')).state === 'connected', 'page connected');
  // 1. connect with the echo agent: a new thread, in auto mode (the fake offers it)
  const s0 = await pickEcho();
  step('connected', { sessionId: s0.sessionId, mode: s0.modes?.current, modeSelect: await page.evaluate('document.querySelector("select[data-role=mode]")?.value') });
  if (s0.modes?.current !== 'auto') throw new Error(`expected auto mode, got ${s0.modes?.current}`);
  // 2. first thread: one prompt
  await typeAndSend('thread one says hi');
  const s1 = await waitFor(async () => { const s = await snap(); return s.turns.length >= 1 && s.state === 'ready' ? s : null; }, 'turn one');
  const first = s1.sessionId;
  step('thread one', { reply: texts(s1).at(-1), title: s1.title, footer: await page.evaluate('document.querySelector(".wmc-foot span").textContent') });
  // 3. New → second thread on the same connection (no new adapter process)
  const agentsBefore = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).agents.length;
  await click('button[data-role=new-thread]');
  const s2 = await waitFor(async () => { const s = await snap().catch(() => null); return s && s.state === 'ready' && s.sessionId !== first ? s : null; }, 'second thread');
  await typeAndSend('thread two says hello');
  const s3 = await waitFor(async () => { const s = await snap(); return s.turns.length >= 1 && s.state === 'ready' ? s : null; }, 'turn two');
  const second = s3.sessionId;
  const agentsAfter = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).agents.length;
  step('thread two', { sessionId: second, mode: s2.modes?.current, reply: texts(s3).at(-1), adapterProcessesBefore: agentsBefore, adapterProcessesAfter: agentsAfter });
  if (agentsAfter !== agentsBefore) throw new Error('a new thread must not spawn another adapter');
  // 4. the list shows both, newest first, the active one marked
  await click('button[data-role=threads-toggle]');
  const list = await waitFor(async () => { const l = await listUi(); return l.length >= 2 ? l : null; }, 'thread list');
  step('thread list', { entries: list, model: await threads() });
  if (list[0].id !== second || list[0].active !== 'true') throw new Error('newest thread should be first and active');
  if (!list.some((t) => t.id === first && t.state === 'stored')) throw new Error('the first thread should be listed as stored (closed on switch)');
  // 5. switch back to the first thread: history replays, the second is closed (idle)
  await click(`.wmc-thread[data-id="${first}"] .wmc-thread-open`);
  const s4 = await waitFor(async () => { const s = await snap().catch(() => null); return s && s.state === 'ready' && s.sessionId === first ? s : null; }, 'switched to thread one');
  step('switch back', { texts: texts(s4), mode: s4.modes?.current, listOpen: await page.evaluate('!!document.querySelector(".wmc-threads")') });
  if (texts(s4).join('|') !== 'thread one says hi|echo: thread one says hi') throw new Error('history of thread one not replayed');
  await typeAndSend('still thread one');
  const s5 = await waitFor(async () => { const s = await snap(); return s.turns.length >= 2 && s.state === 'ready' ? s : null; }, 'turn three');
  step('continue thread one', { turns: s5.turns.length, reply: texts(s5).at(-1) });
  // 6. delete the second thread (inline confirm)
  await click('button[data-role=threads-toggle]');
  await waitFor(async () => (await listUi()).length >= 2, 'list again');
  await click(`.wmc-thread[data-id="${second}"] .wmc-thread-del`);
  await click(`.wmc-thread[data-id="${second}"] button[data-role=delete-yes]`);
  const afterDelete = await waitFor(async () => { const l = await listUi(); return l.length === 1 ? l : null; }, 'thread deleted');
  step('delete', { entries: afterDelete });
  // 7. reload: the last active thread (one) resumes with its history
  await page.send('Page.reload');
  await waitFor(() => page.evaluate('document.readyState === "complete" && !!window.__demo && JSON.parse(JSON.stringify(window.__demo.page.status)).state === "connected"').catch(() => false), 'reloaded + connected', { tries: 60 });
  const s6 = await pickEcho();
  step('resume after reload', { sameThread: s6.sessionId === first, texts: texts(s6), mode: s6.modes?.current });
  if (s6.sessionId !== first) throw new Error('the last active thread should resume after a reload');
  await click('button[data-role=threads-toggle]');
  step('list after reload', { entries: await waitFor(async () => { const l = await listUi(); return l.length >= 1 ? l : null; }, 'list after reload') });
  // 8. disconnect: the adapter stops shortly after
  await page.evaluate('[...document.querySelectorAll(".wmc-head button")].find(b => b.textContent === "Disconnect").click(); "disconnected"');
  await waitFor(async () => (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).agents.length === 0, 'adapter stopped', { tries: 40 });
  step('disconnected', { adapters: 0 });
  out.console = page.consoleLines.filter((l) => !/\[vite\]/.test(l)).slice(0, 15);
} catch (err) {
  out.error = String(err?.stack ?? err);
  out.console = page.consoleLines.filter((l) => !/\[vite\]/.test(l)).slice(0, 30);
  out.daemonLog = daemonLog.slice(-30);
} finally { page.close(); close(); daemon.kill('SIGTERM'); }
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
