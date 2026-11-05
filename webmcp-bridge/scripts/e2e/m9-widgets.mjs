// In-chat widgets, token-free (plan in-chat-widgets §7.1): a private daemon with the echo agent, the demo page in a
// throwaway Chrome. The fake agent announces page tool calls for `widget:<tool> <json>` prompts and runs them through
// the daemon, so the page executes its real tools and the chat renders the page's own cards. Needs: vite on 5173.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, waitFor, sleep } from './cdp.mjs';

const PORT = Number(process.env.WIDGETS_PORT ?? 8719);
const DEMO = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/';
const ORIGIN = new URL(DEMO).origin;
const STATE = `/tmp/webmcp-e2e/widgets-state`;
const ROOT = new URL('../../', import.meta.url).pathname;
const FAKE = new URL('./fake-agent.mjs', import.meta.url).pathname;
const out = { steps: [] }; const t0 = Date.now();
const step = (name, data) => out.steps.push({ name, at_ms: Date.now() - t0, ...data });
const fail = (msg) => { throw new Error(msg); };

rmSync(STATE, { recursive: true, force: true });
const daemon = spawn('node', [`${ROOT}bridge/src/index.ts`, 'serve', '--port', String(PORT), '--state-dir', STATE, '--allow-origin', ORIGIN, '--no-browser', '--agent', `echo=node ${FAKE}`], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT });
const daemonLog = [];
daemon.stdout.on('data', (d) => daemonLog.push(...d.toString().split('\n').filter(Boolean)));
daemon.stderr.on('data', (d) => daemonLog.push(...d.toString().split('\n').filter(Boolean)));
await waitFor(() => fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false), 'daemon health');

const { page, close } = await launchChrome({ url: `${DEMO}?daemon=ws://127.0.0.1:${PORT}`, webmcp: true, port: 9338, extraArgs: ['--window-size=1400,700'] });   // the wide layout: the chat is a fixed-height sidebar whose log scrolls
const snap = () => page.evaluate('JSON.stringify(window.__demo.agent ? window.__demo.agent.model.snapshot() : null)').then((s) => JSON.parse(s));
const texts = (s) => s.turns.flatMap((t) => t.items).filter((i) => i.kind === 'text').map((i) => i.text);
const count = (sel) => page.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const click = (sel) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element ' + ${JSON.stringify(sel)}); el.click(); return 'clicked'; })()`);
const setInput = (sel, text) => page.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element ' + ${JSON.stringify(sel)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'set'; })()`);
const typeAndSend = async (text) => {
  await waitFor(() => page.evaluate('!!document.querySelector(".wmc-input textarea") && !document.querySelector(".wmc-input textarea").disabled'), 'input enabled');   // the React side lags the model by a frame
  await setInput('.wmc-input textarea', text);
  await sleep(50);
  await page.evaluate(`(() => { const ta = document.querySelector('.wmc-input textarea'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'enter'; })()`);
};
const turnDone = (n) => waitFor(async () => { const s = await snap(); return s && s.turns.length >= n && s.state === 'ready' ? s : null; }, `turn ${n} done`);
const pickEcho = async () => {
  await waitFor(() => page.evaluate('!!document.querySelector("select[data-role=agent-picker]")'), 'agent picker');
  await page.evaluate(`(() => { const sel = document.querySelector('select[data-role=agent-picker]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'echo'); sel.dispatchEvent(new Event('change', { bubbles: true })); return 'picked'; })()`);
  await click('.wmc-chat button.wmc-primary');
  return waitFor(async () => { const s = await snap().catch(() => null); return s && s.state === 'ready' && s.agentName === 'echo-agent' ? s : null; }, 'echo agent ready', { tries: 60 });
};
const pageState = () => page.evaluate('JSON.stringify(window.__demo.snapshot())').then((s) => JSON.parse(s));
const activity = () => page.evaluate('JSON.stringify(window.__demo.page.activity.entries)').then((s) => JSON.parse(s));
const storedSessions = () => {
  const dir = join(STATE, 'workspaces');
  for (const slug of readdirSync(dir)) { try { return JSON.parse(readFileSync(join(dir, slug, '.echo-agent-sessions.json'), 'utf8')); } catch { /* next */ } }
  return [];
};

try {
  await waitFor(async () => JSON.parse(await page.evaluate('JSON.stringify(window.__demo.page.status)')).state === 'connected', 'page connected');
  const currentPageId = async () => JSON.parse(await page.evaluate('JSON.stringify(window.__demo.page.status)')).pageId;
  const s0 = await pickEcho();
  step('connected', { sessionId: s0.sessionId, mode: s0.modes?.current });
  const before = await pageState();

  // 1. a page tool with a card: the fake announces the call, the daemon runs it in the page, the chat renders PaletteCard (c45)
  await typeAndSend('widget:propose_palette {"story":"Warm and calm","options":[{"color":"#2a9d8f","sentence":"Teal thoughts.","why":"calm"},{"color":"#e9c46a","sentence":"Golden hour."}]}');
  const s1 = await turnDone(1);
  await waitFor(() => page.evaluate('!!document.querySelector(".wmc-widget[data-tool=propose_palette][data-status=completed]")'), 'palette card');
  const card = await page.evaluate('JSON.stringify({ rows: document.querySelectorAll(".wmc-widget[data-tool=propose_palette] .demo-palette li").length, story: document.querySelector(".wmc-widget[data-tool=propose_palette] .demo-card-story")?.textContent, genericRows: [...document.querySelectorAll(".wmc-tool summary .wmc-title")].map(e => e.textContent), raw: !!document.querySelector(".wmc-widget[data-tool=propose_palette] .wmc-widget-raw pre"), floating: !!document.querySelector(".wmc-float") })').then(JSON.parse);
  step('palette card', { ...card, reply: texts(s1).at(-1), toolCallCount: (await pageState()).toolCallCount });
  if (card.rows !== 2 || card.story !== 'Warm and calm') fail('the palette card did not render its two options and story');
  if (card.genericRows.some((t) => t.includes('propose_palette'))) fail('the generic row must not show for a mapped tool');
  if (!card.raw) fail('the raw input/output toggle is missing under the card');
  if ((await pageState()).toolCallCount !== before.toolCallCount + 1) fail('the page did not execute propose_palette');
  await sleep(700);
  if (await page.evaluate('!!document.querySelector(".wmc-float")')) fail('a call made through the chat must not appear in the floating panel (claimed)');

  // 2. Use → the page changes without a tool call, the row is marked applied, the activity log has an entry (c46)
  await click('.wmc-widget[data-tool=propose_palette] .demo-palette li[data-index="2"] button[data-action=use]');
  await waitFor(async () => (await pageState()).backgroundColor === 'rgb(233, 196, 106)', 'background applied');
  const afterUse = await pageState();
  step('use option 2', { background: afterUse.backgroundColor, sentence: afterUse.sentence, toolCallCount: afterUse.toolCallCount, applied: await page.evaluate('document.querySelector(".demo-palette li[data-applied=true]")?.dataset.index'), activity: await activity() });
  if (afterUse.sentence !== 'Golden hour.' || afterUse.toolCallCount !== before.toolCallCount + 1) fail('Use must change the page without a tool call');
  if ((await activity()).length !== 1) fail('one activity entry expected after Use');

  // 3. the next prompt carries the activity resource after the ui-state one (c46)
  await typeAndSend('hello');
  await turnDone(2);
  const chunks = storedSessions().flatMap((s) => s.chunks).filter((c) => c.role === 'user');
  const hello = chunks.find((c) => c.text.startsWith('hello'));
  step('activity resource', { resources: hello?.resources });
  if (!hello || JSON.stringify(hello.resources) !== JSON.stringify(['page://ui-state', 'page://widget-activity'])) fail('the hello prompt should carry ui-state then widget-activity');
  await typeAndSend('again');
  await turnDone(3);
  const again = storedSessions().flatMap((s) => s.chunks).find((c) => c.role === 'user' && c.text.startsWith('again'));
  if (JSON.stringify(again?.resources) !== JSON.stringify(['page://ui-state'])) fail('nothing new happened: no activity block expected on the next prompt');

  // 4. suggestion chips send a message (c47)
  await typeAndSend('widget:suggest_replies {"replies":["Make it warmer","Try a poem"]}');
  await turnDone(4);
  await waitFor(() => page.evaluate('document.querySelectorAll(".wmc-widget[data-tool=suggest_replies] .demo-replies button").length === 2'), 'chips').catch(async (err) => { throw new Error(`${err.message}; chips widget: ${await page.evaluate('JSON.stringify([...document.querySelectorAll(".wmc-widget[data-tool=suggest_replies]")].map(w => w.dataset.status))')}`); });
  const order = await page.evaluate('(() => { const w = document.querySelector(".wmc-widget[data-tool=suggest_replies]"); const r = [...document.querySelectorAll(".wmc-msg.agent")].at(-1); return { chipsAfterReply: !!(w && r && (r.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING)) }; })()');
  step('chips placement', order);
  if (!order.chipsAfterReply) fail('chips must render after the reply of their turn (placement: end)');
  await click('.wmc-widget[data-tool=suggest_replies] .demo-replies button');
  const s4 = await turnDone(5);
  step('chip click', { lastUser: texts(s4).at(-2), reply: texts(s4).at(-1), chipsLeft: await count('.wmc-widget[data-tool=suggest_replies]') });
  if (texts(s4).at(-2) !== 'Make it warmer' || texts(s4).at(-1) !== 'echo: Make it warmer') fail('the chip did not send its text as the next message');
  if ((await count('.wmc-widget[data-tool=suggest_replies]')) !== 0) fail('chips of an earlier turn must disappear (latestOnly)');

  // 5. an unmapped page tool keeps the generic row (c48)
  await typeAndSend('widget:get_state {}');
  await turnDone(6);
  const generic = await page.evaluate('JSON.stringify({ widget: !!document.querySelector(".wmc-widget[data-tool=get_state]"), row: [...document.querySelectorAll(".wmc-tool summary .wmc-title")].some(e => e.textContent.includes("get_state")) })').then(JSON.parse);
  step('unmapped tool', generic);
  if (generic.widget || !generic.row) fail('an unmapped tool must render the generic row');

  // 5b. the output box: a page tool any Claude can call fills the big monospace box; the chat keeps the generic row
  await typeAndSend('widget:show_output {"title":"Hello","text":"line 1\\nline 2"}');
  await turnDone(7);
  const box = await page.evaluate('JSON.stringify({ text: document.getElementById("output").textContent, title: document.getElementById("output-title").textContent, empty: document.getElementById("output-section").dataset.empty, meta: document.getElementById("output-meta").textContent, lines: window.__demo.snapshot().output.lines })').then(JSON.parse);
  step('output box', box);
  if (box.text !== 'line 1\nline 2' || box.title !== 'Hello' || box.empty !== 'false' || box.lines !== 2) fail('show_output did not fill the box as asked');
  await typeAndSend('widget:show_output {"text":"line 3","mode":"append"}');
  await turnDone(8);
  const appended = await page.evaluate('JSON.stringify({ text: document.getElementById("output").textContent, title: document.getElementById("output-title").textContent })').then(JSON.parse);
  if (appended.text !== 'line 1\nline 2\n\nline 3' || appended.title !== 'Hello') fail(`append did not add a section: ${JSON.stringify(appended)}`);
  await click('#output-clear');
  if ((await page.evaluate('document.getElementById("output-section").dataset.empty')) !== 'true') fail('Clear did not empty the box');
  // 6. a form elicitation renders and its answer reaches the agent (c51)
  await typeAndSend('ask-form please');
  await waitFor(() => page.evaluate('!!document.querySelector(".wmc-elicit")'), 'elicitation form');
  await click('.wmc-elicit input[type=radio][value="b"]');
  await setInput('.wmc-elicit input[type=text]', 'with a note');
  await click('.wmc-elicit button[data-action=accept]');
  const s6 = await turnDone(9);
  step('form answered', { reply: texts(s6).at(-1), formGone: !(await page.evaluate('!!document.querySelector(".wmc-elicit")')) });
  if (texts(s6).at(-1) !== 'form: {"action":"accept","content":{"choice":"b","choice_custom":"with a note"}}') fail('the form answer did not reach the agent as sent');

  // 6b. nothing in a scrolling log collapses: tool rows kept their height once the thread overflowed (manual-test finding, 2026-11-05)
  const heights = await page.evaluate('(() => { const l = document.querySelector(".wmc-log"); return { overflows: l.scrollHeight > l.clientHeight, min: Math.min(...[...l.children].map(e => e.offsetHeight)), rows: document.querySelectorAll(".wmc-log > .wmc-tool").length }; })()');
  step('log layout', heights);
  if (!heights.overflows) fail('the thread should be long enough to scroll by now (the window is 700px tall)');
  if (heights.min < 16) fail(`a transcript entry collapsed to ${heights.min}px (flex-shrink)`);
  // 7. reload: the palette card comes back restored with its applied mark; chips too (c49)
  const sid = s6.sessionId;
  await page.send('Page.reload');
  await waitFor(() => page.evaluate('document.readyState === "complete" && !!window.__demo && JSON.parse(JSON.stringify(window.__demo.page.status)).state === "connected"').catch(() => false), 'reloaded + connected', { tries: 60 });
  const s7 = await pickEcho();
  await waitFor(() => page.evaluate('!!document.querySelector(".wmc-widget[data-tool=propose_palette][data-restored=true]")'), 'restored card');
  const restored = await page.evaluate('JSON.stringify({ applied: document.querySelector(".wmc-widget[data-tool=propose_palette] .demo-palette li[data-applied=true]")?.dataset.index, note: document.querySelector(".wmc-widget[data-tool=propose_palette] .demo-card-note")?.textContent, widgets: document.querySelectorAll(".wmc-widget").length })').then(JSON.parse);
  step('restored after reload', { sameThread: s7.sessionId === sid, ...restored });
  if (s7.sessionId !== sid || restored.applied !== '2') fail('the restored card should remember which option was applied');

  // 8. the floating panel: a call that does not come through the chat (terminal Claude) shows there, not in the chat (c52, c53)
  const widgetsBefore = await count('.wmc-widget');
  const pageId = await currentPageId();   // the reload reconnected the page under a new id
  const callRes = await fetch(`http://127.0.0.1:${PORT}/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: pageId, name: 'propose_palette', args: { story: 'From the terminal', options: [{ color: '#c3b1e1', sentence: 'Lavender late.' }] } }) }).then((r) => r.json());
  await waitFor(() => page.evaluate('!!document.querySelector(".wmc-float .wmc-widget[data-tool=propose_palette][data-status=completed]")'), 'floating card');
  const floating = await page.evaluate('JSON.stringify({ cards: document.querySelectorAll(".wmc-float-card").length, chatWidgets: document.querySelectorAll(".wmc-chat .wmc-widget").length })').then(JSON.parse);
  step('floating panel', { ...floating, result: callRes?.content?.[0]?.text?.slice(0, 80) });
  if (floating.cards !== 1 || floating.chatWidgets !== widgetsBefore) fail('the terminal call must show in the floating panel only');
  await click('.wmc-float .demo-palette li[data-index="1"] button[data-action=use]');
  await waitFor(async () => (await pageState()).backgroundColor === 'rgb(195, 177, 225)', 'floating Use applied');
  const stateText = await fetch(`http://127.0.0.1:${PORT}/state?page=${pageId}`).then((r) => r.text());
  step('state text for the terminal hook', { length: stateText.length, tail: stateText.slice(-160) });
  if (!/Recent widget activity/.test(stateText) || !/Lavender late/.test(stateText) || stateText.length > 9_500) fail('the state text must end with the activity section and stay under the hook cap');
  await click('.wmc-float-head button');
  await waitFor(() => page.evaluate('!document.querySelector(".wmc-float")'), 'floating card dismissed');
  await page.evaluate('[...document.querySelectorAll(".wmc-head button")].find(b => b.textContent === "Disconnect").click(); "disconnected"');
  await waitFor(async () => (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()).agents.length === 0, 'adapter stopped', { tries: 40 });
  step('done', { adapters: 0 });
  out.console = page.consoleLines.filter((l) => !/\[vite\]/.test(l)).slice(0, 15);
} catch (err) {
  out.error = String(err?.stack ?? err);
  out.console = page.consoleLines.filter((l) => !/\[vite\]/.test(l)).slice(0, 30);
  out.daemonLog = daemonLog.slice(-30);
  try {   // what the chat showed when it failed
    const s = await snap();
    out.lastTurn = s?.turns?.at(-1)?.items?.map((i) => (i.kind === 'tool_call' ? { kind: i.kind, name: i.name, status: i.status, rawInput: i.rawInput, content: i.content } : { kind: i.kind, text: String(i.text ?? '').slice(0, 80) }));
    out.logHtml = String(await page.evaluate('document.querySelector(".wmc-log")?.innerHTML ?? ""')).slice(-2000);
  } catch { /* no page */ }
} finally { page.close(); close(); daemon.kill('SIGTERM'); }
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
