// M7: the origin approval page driven through a real browser. A daemon in --approval log mode holds the
// unknown origin; the test opens the printed approval URL in a second tab and clicks Deny, then Allow.
import { spawn } from 'node:child_process';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { launchChrome, connectPage, waitFor, sleep } from './cdp.mjs';

const PORT = 8720; const STATE = '/tmp/webmcp-e2e/state-approval';
const DEMO = `http://127.0.0.1:5173/?daemon=${encodeURIComponent(`ws://127.0.0.1:${PORT}`)}`;
rmSync(STATE, { recursive: true, force: true });
const out = { steps: [] };
let logs = '';
const daemon = spawn(process.execPath, ['bridge/src/index.ts', 'serve', '--port', String(PORT), '--state-dir', STATE, '--approval', 'log'], { stdio: ['ignore', 'pipe', 'pipe'] });
daemon.stderr.on('data', (d) => { logs += d.toString(); });
await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, 'daemon');
const { page, close } = await launchChrome({ url: DEMO, webmcp: true, port: 9337 });
const status = () => page.evaluate('JSON.stringify(window.__demo.page.status)').then(JSON.parse);
const approvalUrl = (after = 0) => { const m = [...logs.matchAll(/approval needed \(open this URL\): (\S+)/g)]; return m[after]?.[1]; };
async function openApproval(url) {
  const r = await page.send('Target.createTarget', { url });
  const targets = await (await fetch('http://127.0.0.1:9337/json')).json();
  const t = targets.find((x) => x.id === r.result.targetId);
  const tab = await connectPage(t.webSocketDebuggerUrl);
  await waitFor(() => tab.evaluate('document.readyState === "complete" && !!document.querySelector("button.allow")'), 'approval page');
  return tab;
}
try {
  await waitFor(async () => (await status()).state === 'needs-approval', 'needs-approval status', { tries: 20 });
  await waitFor(() => approvalUrl(0), 'approval url in daemon log');
  out.steps.push({ step: 'held', status: (await status()).state, url: approvalUrl(0).replace(/id=.*/, 'id=…') });
  // Deny without remembering → page gets 'denied'
  let tab = await openApproval(approvalUrl(0));
  out.steps.push({ step: 'approval page', heading: await tab.evaluate('document.querySelector("h1").textContent'), originShown: await tab.evaluate('document.querySelector("code").textContent') });
  await tab.evaluate('document.getElementById("remember").checked = false; document.querySelector("button:not(.allow)").click(); "denied"');
  await waitFor(async () => (await status()).state === 'denied', 'denied status', { tries: 20 });
  out.steps.push({ step: 'denied', status: (await status()).state, persisted: existsSync(`${STATE}/origins.json`) ? JSON.parse(readFileSync(`${STATE}/origins.json`, 'utf8')) : 'no file' });
  tab.close();
  // Reconnect via the page button → held again → Allow with remember
  await page.evaluate('window.__demo.page.connect(); "retry"');
  await waitFor(() => approvalUrl(1), 'second approval url');
  tab = await openApproval(approvalUrl(1));
  await tab.evaluate('document.querySelector("button.allow").click(); "allowed"');
  await waitFor(async () => (await status()).state === 'connected', 'connected after allow', { tries: 30 });
  out.steps.push({ step: 'allowed', status: (await status()).state, origins: JSON.parse(readFileSync(`${STATE}/origins.json`, 'utf8')), confirmation: await tab.evaluate('document.getElementById("out").textContent') });
  tab.close();
  // Reload → remembered origin connects without any approval
  await page.send('Page.reload');
  await waitFor(() => page.evaluate('document.readyState === "complete" && !!window.__demo && JSON.parse(JSON.stringify(window.__demo.page.status)).state === "connected"').catch(() => false), 'reconnected after reload');
  out.steps.push({ step: 'remembered', approvalsLogged: [...logs.matchAll(/approval needed/g)].length });
} catch (err) { out.error = String(err?.stack ?? err); out.logTail = logs.split('\n').slice(-6); }
page.close(); close(); daemon.kill('SIGTERM');
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
