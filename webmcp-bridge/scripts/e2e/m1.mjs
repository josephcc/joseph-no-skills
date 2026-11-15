// M1 end-to-end: demo page ⇄ daemon over /ws; daemon HTTP endpoints; a tool call round trip.
// Usage: node scripts/e2e/m1.mjs [--no-webmcp]   (daemon + vite must already be running)
import { launchChrome, waitFor, sleep } from './cdp.mjs';

const DEMO = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/';
const DAEMON = process.env.DAEMON_URL ?? 'http://127.0.0.1:8737';
const webmcp = !process.argv.includes('--no-webmcp');
const out = { mode: webmcp ? 'native' : 'shim' };
const { page, close } = await launchChrome({ url: DEMO, webmcp });
try {
  await waitFor(() => page.evaluate('document.readyState === "complete" && !!window.__demo'), 'demo loaded');
  out.usingShim = await page.evaluate('window.__demo.page.usingShim');
  out.apiBadge = await page.evaluate('document.getElementById("api-badge").textContent');
  const status = await waitFor(async () => { const s = await page.evaluate('JSON.stringify(window.__demo.page.status)'); return JSON.parse(s).state === 'connected' ? s : null; }, 'connector connected', { tries: 40 });
  out.status = JSON.parse(status);
  out.badge = await page.evaluate('document.getElementById("daemon-badge").textContent');
  await sleep(300);
  out.health = await (await fetch(`${DAEMON}/health`)).json();
  out.pages = await (await fetch(`${DAEMON}/pages`)).json();
  out.state = await (await fetch(`${DAEMON}/state`)).text();
  out.instructions = (await (await fetch(`${DAEMON}/instructions`)).text()).slice(0, 300);
  const call = async (name, args = {}) => (await fetch(`${DAEMON}/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, args }) })).json();
  out.call_get_state = await call('get_state');
  out.call_set_color = await call('set_background_color', { color: '#0066cc' });
  out.call_set_sentence = await call('set_sentence', { text: 'Hello from the daemon' });
  out.call_bad_color = await call('set_background_color', { color: 'not-a-colour' });
  out.call_missing = await call('nope');
  out.pageAfter = { bg: await page.evaluate('document.body.style.backgroundColor'), sentence: await page.evaluate('document.getElementById("sentence").textContent'), logEntries: await page.evaluate('document.querySelectorAll("#log li").length') };
  // dynamic registration: bonus tool → daemon sees 5 tools
  await page.evaluate('document.getElementById("bonus-btn").click(); "ok"');
  const toolsAfterBonus = await waitFor(async () => { const p = await (await fetch(`${DAEMON}/pages`)).json(); return p[0]?.tools.includes('shout') ? p[0].tools : null; }, 'bonus tool mirrored');
  out.toolsAfterBonus = toolsAfterBonus;
  out.call_shout = await call('shout');
  await page.evaluate('document.getElementById("unbonus-btn").click(); "ok"');
  out.toolsAfterUnbonus = await waitFor(async () => { const p = await (await fetch(`${DAEMON}/pages`)).json(); return !p[0]?.tools.includes('shout') ? p[0].tools : null; }, 'bonus tool removed');
  out.console = page.consoleLines.slice(0, 10);
} catch (err) {
  out.error = String(err?.stack ?? err); out.console = page.consoleLines.slice(0, 20);
} finally {
  page.close(); close();
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
