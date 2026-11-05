// M5: the embedded chat inside the demo page, driven through the real browser (CDP).
// Needs: daemon on 8717 + vite on 5173. Launches its own Chrome. Uses your Claude login/model (costs tokens).
// Since the threads-and-auto-mode plan: new threads start in auto mode (a mutating page tool may run without a
// prompt), and a thread switch through the Threads panel is exercised with real Claude titles.
import { launchChrome, waitFor, sleep } from './cdp.mjs';

const DEMO = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/';
const DAEMON = process.env.DAEMON_URL ?? 'http://127.0.0.1:8717';
const out = { steps: [] }; const t0 = Date.now();
const step = (name, data) => out.steps.push({ name, at_ms: Date.now() - t0, ...data });
const { page, close } = await launchChrome({ url: DEMO, webmcp: true, port: 9336 });
const snap = () => page.evaluate('JSON.stringify(window.__demo.agent ? window.__demo.agent.model.snapshot() : null)').then((s) => JSON.parse(s));
const lastAgentText = (s) => { const t = s.turns[s.turns.length - 1]; return t?.items.filter((i) => i.kind === 'text' && i.role === 'agent').map((i) => i.text).join('') ?? ''; };
const toolNames = (s) => { const t = s.turns[s.turns.length - 1]; return t?.items.filter((i) => i.kind === 'tool_call').map((i) => `${i.name ?? i.title}:${i.status}`) ?? []; };
try {
  await waitFor(async () => JSON.parse(await page.evaluate('JSON.stringify(window.__demo.page.status)')).state === 'connected', 'page connected');
  step('page connected', { chatMounted: await page.evaluate('!!document.querySelector(".wmc-chat")') });
  // 1. connect through the UI button
  await page.evaluate('document.querySelector(".wmc-chat button.wmc-primary").click(); "clicked"');
  await waitFor(() => page.evaluate('!!window.__demo.agent'), 'agent handle', { tries: 60 });
  const s0 = await waitFor(async () => { const s = await snap(); return s && s.state === 'ready' ? s : null; }, 'session ready');
  step('session ready', { sessionId: s0.sessionId?.slice(0, 8), agent: s0.agentName, mode: s0.modes?.current, autoMode: s0.modes?.current === 'auto', modes: s0.modes?.available?.map((m) => m.id), badge: await page.evaluate('document.querySelector(".wmc-badge").textContent') });
  // 2. prompt through the UI (textarea + Enter)
  await page.evaluate(`(() => { const ta = document.querySelector('.wmc-input textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(ta, 'Reply with exactly one word: pong'); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`);
  await sleep(100);
  await page.evaluate(`(() => { const ta = document.querySelector('.wmc-input textarea'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'enter'; })()`);
  const s1 = await waitFor(async () => { const s = await snap(); return s.turns.length >= 1 && s.state === 'ready' ? s : null; }, 'pong turn done', { tries: 120 });
  step('ui prompt: pong', { reply: lastAgentText(s1).slice(0, 120), stopReason: s1.turns[0].stopReason, renderedAgentMsgs: await page.evaluate('document.querySelectorAll(".wmc-msg.agent").length') });
  // 3. read-only page tool via the handle (no permission prompt expected)
  await page.evaluate(`window.__demo.agent.prompt('Use the page tool get_state and tell me the background colour in one short sentence.'); 'sent'`);
  const s2 = await waitFor(async () => { const s = await snap(); return s.turns.length >= 2 && s.state === 'ready' ? s : null; }, 'get_state turn', { tries: 120 });
  step('read-only tool', { reply: lastAgentText(s2).slice(0, 160), tools: toolNames(s2), permissionsPending: s2.pendingPermissions.length, toolCards: await page.evaluate('document.querySelectorAll(".wmc-tool").length') });
  // 4. mutating page tool → permission prompt in the UI → allow once
  await page.evaluate(`window.__demo.agent.prompt('Set the page background to #0066cc with the page tool, then confirm in one line.'); 'sent'`);
  const s3a = await waitFor(async () => { const s = await snap(); return s.pendingPermissions.length > 0 || (s.turns.length >= 3 && s.state === 'ready') ? s : null; }, 'permission prompt or auto-approved turn', { tries: 120 });
  if (s3a.pendingPermissions.length) {
    step('permission prompt shown', { title: s3a.pendingPermissions[0]?.title, buttons: await page.evaluate('[...document.querySelectorAll(".wmc-perm button")].map(b => b.dataset.kind)') });
    await page.evaluate('document.querySelector(".wmc-perm button[data-kind=allow_once]").click(); "allowed"');
  } else step('permission prompt', { skipped: `auto-approved in mode ${s3a.modes?.current}` });
  const s3 = await waitFor(async () => { const s = await snap(); return s.turns.length >= 3 && s.state === 'ready' ? s : null; }, 'mutating turn', { tries: 120 });
  step('mutating tool ran', { reply: lastAgentText(s3).slice(0, 160), tools: toolNames(s3), prompted: s3a.pendingPermissions.length > 0, bg: await page.evaluate('document.body.style.backgroundColor') });
  // 5. shell → permission prompt (full Claude Code per D-24) → reject
  await page.evaluate(`window.__demo.agent.prompt('Run this exact shell command: echo hi > note.txt. If you cannot, say so in one sentence.'); 'sent'`);
  const s4 = await waitFor(async () => { const s = await snap(); return s.pendingPermissions.length > 0 || (s.turns.length >= 4 && s.state === 'ready') ? s : null; }, 'bash prompt or done', { tries: 120 });
  if (s4.pendingPermissions.length) {
    step('shell permission prompt', { title: s4.pendingPermissions[0].title });
    await page.evaluate('document.querySelector(".wmc-perm button[data-kind=reject_once]").click(); "rejected"');
  }
  const s5 = await waitFor(async () => { const s = await snap(); return s.turns.length >= 4 && s.state === 'ready' ? s : null; }, 'bash turn done', { tries: 120 });
  step('shell write (Manual: prompt rejected; auto: Claude Code decides)', { prompted: s4.pendingPermissions.length > 0, reply: lastAgentText(s5).slice(0, 160), tools: toolNames(s5) });
  // 5b. cancel mid-turn (c13)
  await page.evaluate(`window.__demo.agent.prompt('Count from 1 to 400, one number per line, no commentary.'); 'sent'`);
  await waitFor(async () => (await snap()).state === 'prompting', 'prompting', { tries: 20 });
  await sleep(1500);
  await page.evaluate('document.querySelector(".wmc-head button") && [...document.querySelectorAll(".wmc-head button")].find(b => b.textContent === "Stop")?.click(); "stop"');
  const s5b = await waitFor(async () => { const s = await snap(); return s.turns.length >= 5 && s.state === 'ready' ? s : null; }, 'cancelled turn', { tries: 60 });
  step('cancel mid-turn', { stopReason: s5b.turns[s5b.turns.length - 1].stopReason, partialChars: lastAgentText(s5b).length });
  // 6. reload → resume via session/load
  const sid = s5.sessionId;
  await page.send('Page.reload');
  await waitFor(() => page.evaluate('document.readyState === "complete" && !!window.__demo && JSON.parse(JSON.stringify(window.__demo.page.status)).state === "connected"').catch(() => false), 'reloaded + connected', { tries: 60 });
  await page.evaluate('document.querySelector(".wmc-chat button.wmc-primary").click(); "clicked"');
  const s6 = await waitFor(async () => { const s = await snap().catch(() => null); return s && s.state === 'ready' ? s : null; }, 'resumed session', { tries: 90 });
  step('resume after reload', { sameSession: s6.sessionId === sid, replayedTurns: s6.turns.length, firstUser: s6.turns[0]?.items[0]?.text?.slice(0, 40), mode: s6.modes?.current });
  // 6b. threads: New → second thread on the same connection → Threads panel lists both with Claude's titles → switch back → history replays
  const firstId = s6.sessionId;
  const adaptersBefore = (await (await fetch(`${DAEMON}/health`)).json()).agents?.length;
  await page.evaluate('document.querySelector("button[data-role=new-thread]").click(); "new"');
  const s6b = await waitFor(async () => { const s = await snap().catch(() => null); return s && s.state === 'ready' && s.sessionId && s.sessionId !== firstId ? s : null; }, 'new thread ready', { tries: 60 });
  step('new thread', { sessionId: s6b.sessionId?.slice(0, 8), mode: s6b.modes?.current, turns: s6b.turns.length, adaptersBefore, adaptersAfter: (await (await fetch(`${DAEMON}/health`)).json()).agents?.length });
  await page.evaluate(`window.__demo.agent.prompt('Reply with exactly one word: mango'); 'sent'`);
  const s6c = await waitFor(async () => { const s = await snap(); return s.turns.length >= 1 && s.state === 'ready' ? s : null; }, 'mango turn', { tries: 120 });
  step('second thread prompt', { reply: lastAgentText(s6c).slice(0, 60) });
  await page.evaluate('document.querySelector("button[data-role=threads-toggle]").click(); "threads"');
  const list = await waitFor(async () => { const l = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll(".wmc-thread")].map(li => ({ id: li.dataset.id, active: li.dataset.active, state: li.dataset.state, title: li.querySelector(".wmc-thread-title").textContent })))')); return l.length >= 2 ? l : null; }, 'thread list', { tries: 40 });
  step('thread list', { count: list.length, entries: list.slice(0, 4) });
  await page.evaluate(`document.querySelector('.wmc-thread[data-id="${firstId}"] .wmc-thread-open').click(); "switch"`);
  const s6d = await waitFor(async () => { const s = await snap().catch(() => null); return s && s.state === 'ready' && s.sessionId === firstId ? s : null; }, 'switched back', { tries: 90 });
  step('switch back', { sessionId: s6d.sessionId?.slice(0, 8), replayedTurns: s6d.turns.length, firstUser: s6d.turns[0]?.items[0]?.text?.slice(0, 40), mode: s6d.modes?.current, adapters: (await (await fetch(`${DAEMON}/health`)).json()).agents?.length });
  // 7. agent picker: disconnect, choose the fake echo agent (if the daemon offers it), connect, prompt
  const agents = JSON.parse(await page.evaluate('JSON.stringify(window.__demo.page.status.agents || [])'));
  if (agents.some((a) => a.id === 'echo')) {
    await page.evaluate('[...document.querySelectorAll(".wmc-head button")].find(b => b.textContent === "Disconnect").click(); "disconnected"');
    await waitFor(() => page.evaluate('!!document.querySelector("select[data-role=agent-picker]")'), 'agent picker visible');
    await page.evaluate(`(() => { const sel = document.querySelector('select[data-role=agent-picker]'); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(sel, 'echo'); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'picked'; })()`);
    await page.evaluate('document.querySelector(".wmc-chat button.wmc-primary").click(); "connect"');
    await waitFor(async () => { const s = await snap().catch(() => null); return s && s.state === 'ready' && s.agentName === 'echo-agent'; }, 'echo agent ready', { tries: 40 });
    await page.evaluate(`window.__demo.agent.prompt('hello picker'); 'sent'`);
    const s7 = await waitFor(async () => { const s = await snap(); return s.turns.length >= 1 && s.state === 'ready' ? s : null; }, 'echo turn', { tries: 40 });
    step('agent picker (echo)', { agentName: s7.agentName, reply: lastAgentText(s7), footer: await page.evaluate('document.querySelector(".wmc-foot").textContent') });
  } else step('agent picker', { skipped: 'daemon offers no extra agent' });
  out.agents = (await (await fetch(`${DAEMON}/health`)).json()).agents?.length;
  out.console = page.consoleLines.filter((l) => !/\[vite\]/.test(l)).slice(0, 15);
} catch (err) {
  out.error = String(err?.stack ?? err); out.console = page.consoleLines.filter((l) => !/\[vite\]/.test(l)).slice(0, 30);
} finally { page.close(); close(); }
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
