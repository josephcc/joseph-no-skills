// The README's screenshots (plans/readme-three-audiences/main.md D-3): starts a private daemon (real Claude adapter) and the
// demo server, opens the demo in a throwaway Chrome at 1280×800 (2× DPR), and runs embedded-chat turns against the page:
// 'palette' (a card and reply chips → docs/img/demo-hero.png), 'skill' (a fresh thread, the s2-paper-search skill, the
// title set → docs/img/demo-chat-skill.png); 'terminal' runs a `claude -p` session against the same page and keeps its
// transcript and the floating card's capture under the state directory (not committed). SHOTS=palette,skill,terminal
// selects; KEEP=1 leaves everything running afterwards. Costs a few cents per real turn.
// Usage: node scripts/docs/screenshots.mjs
import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { launchChrome, waitFor, sleep } from '../e2e/cdp.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
/** Which captures to make: SHOTS=palette,skill,terminal (default all). */
const SHOTS = new Set((process.env.SHOTS ?? 'palette,skill,terminal').split(',').map((x) => x.trim()));
const IMG = join(ROOT, 'docs', 'img');
const DEMO_PORT = Number(process.env.DEMO_PORT ?? 5179);
const ORIGIN = `http://127.0.0.1:${DEMO_PORT}`;
const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const stateDir = mkdtempSync(join(tmpdir(), 'webmcp-docs-'));
const children = [];
const out = { images: [], steps: [] };
/** KEEP=1 leaves the daemon, the demo server and the Chrome window running after the captures (for a hands-on look). */
const KEEP = process.env.KEEP === '1';
const step = (name, data = {}) => {
  out.steps.push({ name, ...data });
  console.error('step', name, JSON.stringify(data).slice(0, 200));
  if (process.env.STEPS_FILE) appendFileSync(process.env.STEPS_FILE, JSON.stringify({ name, ...data }) + '\n');
};
const PORT = await freePort();

// The daemon (new code, the real Claude adapter) and the demo server.
children.push(spawn(process.execPath, [join(ROOT, 'bridge/src/index.ts'), 'serve', '--state-dir', stateDir, '--ports', String(PORT), '--allow-origin', ORIGIN, '--no-browser', '--no-tray'], { stdio: ['ignore', 'ignore', 'inherit'] }));
children.push(spawn('bun', ['run', 'demo', '--', '--port', String(DEMO_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] }));
await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/id`)).ok ? true : null; } catch { return null; } }, 'daemon', { tries: 60 });
await waitFor(async () => { try { return (await fetch(ORIGIN)).ok ? true : null; } catch { return null; } }, 'demo server', { tries: 60 });

const { page, close } = await launchChrome({ url: `${ORIGIN}/?ports=${PORT}`, webmcp: true, port: 9347, extraArgs: ['--window-size=1280,800', '--hide-scrollbars'] });
const evalJson = (expr) => page.evaluate(`(async () => JSON.stringify(await (${expr})))()`).then((s) => (s === undefined ? undefined : JSON.parse(s)));
const shot = async (name, clip) => {
  const r = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  const file = name.startsWith('/') ? name : join(IMG, name);
  // cdp.mjs resolves send() with the whole CDP message.
  writeFileSync(file, Buffer.from((r.result ?? r).data, 'base64'));
  out.images.push(name);
  return file;
};
const snap = () => evalJson('window.__demo.agent ? window.__demo.agent.model.snapshot() : null');
try {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
  await waitFor(() => page.evaluate('document.readyState === "complete" && !!window.__demo'), 'demo loaded');
  await waitFor(async () => (await evalJson('window.__demo.page.status')).state === 'connected' ? true : null, 'page connected', { tries: 60 });
  // The demo's chat waits for the user's click (no autoConnect): the Connect button in the panel.
  await page.evaluate('document.querySelector(".wmc-chat button.wmc-primary").click(); "clicked"');
  await waitFor(async () => { const s = await snap(); return s && s.state === 'ready' ? s : null; }, 'chat ready', { tries: 120 });
  step('connected', { port: PORT });

  const turnItems = (s) => s.turns.at(-1).items.map((i) => (i.kind === 'tool_call' ? `${i.name}:${i.status}` : i.kind));
  const runTurn = async (prompt, { minTurns = 1, tries = 300 } = {}) => {
    await page.evaluate(`window.__demo.agent.prompt(${JSON.stringify(prompt)}).catch((e) => console.error(String(e)))`);
    await waitFor(async () => { const s = await snap(); return s && s.state === 'prompting' ? s : null; }, 'prompting', { tries: 40 }).catch(() => null);
    return waitFor(async () => { const s = await snap(); return s && s.state === 'ready' && s.turns.length >= minTurns ? s : null; }, 'turn done', { tries, every: 1000 });
  };

  if (SHOTS.has('palette')) {
    // One embedded-chat turn: the page changes, a palette card and reply chips appear.
    const PROMPT = "Give this page an evening feel: set the sentence to 'Local Claude is reading this page', then propose a palette I can pick from, and suggest two follow-ups.";
    const turn = await runTurn(PROMPT);
    await waitFor(() => page.evaluate('!!document.querySelector(".wmc-widget[data-tool=propose_palette][data-status=completed]")'), 'palette card', { tries: 20 }).catch(() => null);
    await sleep(800);
    step('chat turn', { items: turnItems(turn), sentence: await page.evaluate('document.getElementById("sentence").textContent'), cards: await page.evaluate('document.querySelectorAll(".wmc-widget").length') });
    await page.evaluate('document.querySelector(".wmc-log")?.scrollTo(0, 1e9); "ok"');
    await sleep(300);
    await shot('demo-hero.png');
  }

  if (SHOTS.has('skill')) {
    // A fresh thread: local Claude Code's own skills work in the chat. The paper-search skill finds a paper, a page tool sets the title.
    const before = await snap();
    if (before.turns.length > 0) {
      await page.evaluate('[...document.querySelectorAll(".wmc-chat button")].find((b) => b.textContent.trim() === "New").click(); "new"');
      await waitFor(async () => { const s = await snap(); return s && s.state === 'ready' && s.sessionId !== before.sessionId && s.turns.length === 0 ? s : null; }, 'new thread', { tries: 60 });
    }
    const SKILL_PROMPT = "Use your s2-paper-search skill to find the most recent paper by Joseph Chee Chang, then set this page's sentence to that paper's title.";
    const sentenceBefore = await page.evaluate('document.getElementById("sentence").textContent');
    const turn = await runTurn(SKILL_PROMPT, { tries: 420 });
    await sleep(800);
    step('skill turn', { items: turnItems(turn), sentence: await page.evaluate('document.getElementById("sentence").textContent'), changed: (await page.evaluate('document.getElementById("sentence").textContent')) !== sentenceBefore, text: turn.turns.at(-1).items.filter((i) => i.kind === 'text').map((i) => i.text.slice(0, 200)) });
    await page.evaluate('document.querySelector(".wmc-log")?.scrollTo(0, 1e9); "ok"');
    await sleep(300);
    await shot('demo-chat-skill.png');
  }

  if (!SHOTS.has('terminal')) throw Object.assign(new Error('done'), { done: true });
  // Terminal Claude against the same page: a print-mode session whose only MCP server is this daemon.
  const mcpConfig = join(stateDir, 'mcp.json');
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { webmcp: { type: 'http', url: `http://127.0.0.1:${PORT}/mcp` } } }));
  const TERMINAL_PROMPT = "I have a web page open in my browser. What is it showing right now? Then change its sentence to 'Hello from terminal Claude' and propose a warmer palette for it.";
  const claude = spawn('claude', ['-p', TERMINAL_PROMPT, '--mcp-config', mcpConfig, '--strict-mcp-config', '--allowedTools', 'mcp__webmcp', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet'], {
    cwd: stateDir,
    env: { ...process.env, CLAUDE_PLUGIN_OPTION_INJECT_PAGE_CONTEXT: 'false', WEBMCP_BRIDGE_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(claude);
  const events = []; let claudeErr = '';
  claude.stderr.on('data', (d) => { claudeErr += d; });
  createInterface({ input: claude.stdout }).on('line', (line) => { try { events.push(JSON.parse(line)); } catch { /* not json */ } });
  const code = await new Promise((resolve) => { claude.on('exit', resolve); setTimeout(() => { claude.kill('SIGTERM'); resolve(-1); }, 240_000); });
  writeFileSync(join(stateDir, 'terminal-stream.json'), JSON.stringify(events, null, 1));
  // A transcript in the shape of the terminal: the prompt, each tool call with a one-line result, the text.
  const lines = [`> ${TERMINAL_PROMPT}`, ''];
  const resultById = new Map();
  for (const ev of events) if (ev.type === 'user' && Array.isArray(ev.message?.content)) for (const c of ev.message.content) if (c.type === 'tool_result') resultById.set(c.tool_use_id, c);
  const firstLine = (c) => { const text = Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join(' ') : String(c.content ?? ''); return text.replace(/\s+/g, ' ').trim().slice(0, 110); };
  for (const ev of events) {
    if (ev.type !== 'assistant' || !Array.isArray(ev.message?.content)) continue;
    for (const c of ev.message.content) {
      if (c.type === 'text' && c.text.trim()) lines.push(`⏺ ${c.text.trim()}`, '');
      if (c.type === 'tool_use') {
        const name = c.name.replace(/^mcp__webmcp__/, '');
        const args = Object.entries(c.input ?? {}).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
        lines.push(`⏺ ${name}(${args})`);
        const r = resultById.get(c.id);
        lines.push(`  ⎿  ${r ? firstLine(r) : '…'}`, '');
      }
    }
  }
  const final = events.find((e) => e.type === 'result');
  writeFileSync(join(stateDir, 'terminal-transcript.txt'), lines.join('\n').trim() + '\n');
  step('terminal session', { code, turns: final?.num_turns, costUsd: final?.total_cost_usd, toolCalls: lines.filter((l) => /^⏺ [a-z_]+\(/.test(l)).length, stderr: claudeErr.slice(0, 200) });

  // The card terminal Claude's proposal left on the page.
  await waitFor(() => page.evaluate('!!document.querySelector(".wmc-float .wmc-widget")'), 'floating card', { tries: 30 }).catch(() => null);
  await sleep(600);
  step('after terminal', { sentence: await page.evaluate('document.getElementById("sentence").textContent'), floating: await page.evaluate('document.querySelectorAll(".wmc-float .wmc-widget").length') });
  await shot(join(stateDir, 'demo-terminal-card.png'));
} catch (err) {
  if (!err?.done) { out.error = String(err?.stack ?? err); out.console = page.consoleLines.slice(-15); }
} finally {
  out.stateDirKept = stateDir;
  if (KEEP && !out.error) {
    out.kept = { demo: `${ORIGIN}/?ports=${PORT}`, daemon: `http://127.0.0.1:${PORT}`, note: 'the Chrome window, the daemon and the demo server stay up until this process is stopped' };
    console.error(`KEEP: ${out.kept.demo} (daemon ${out.kept.daemon}); stop this process to tear down`);
    if (process.env.STEPS_FILE) appendFileSync(process.env.STEPS_FILE, JSON.stringify({ name: 'kept', ...out.kept }) + '\n');
  } else {
    try { page.close(); } catch { /* none */ }
    close();
    for (const c of children) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
    await sleep(500);
  }
}
console.log(JSON.stringify(out, null, 2));
if (KEEP && !out.error) {
  const bye = () => { try { page.close(); } catch { /* none */ } close(); for (const c of children) { try { c.kill('SIGTERM'); } catch { /* gone */ } } process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
  await new Promise(() => {});
}
process.exit(out.error ? 1 : 0);
