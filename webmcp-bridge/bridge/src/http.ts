import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CANDIDATE_PORTS, DAEMON_NAME, MAX_INJECTED_CHARS, PROTOCOL_VERSION } from 'webmcp-protocol';
import { installLaunchd, uninstallLaunchd } from './launchd.ts';
import type { DaemonConfig } from './config.ts';
import type { HandoffRegistry } from './handoffs.ts';
import { log } from './log.ts';
import { errorResult, normaliseResult } from './normalise.ts';
import type { Registry } from './registry.ts';
import { approvalPageHtml, type OriginPolicy } from './security.ts';
import type { PageServer } from './ws-server.ts';

export interface HttpDeps {
  config: DaemonConfig;
  registry: Registry;
  policy: OriginPolicy;
  pages: PageServer;
  /** Added in M2: handles /mcp and /mcp/by-page/<id>. */
  mcp?: (req: IncomingMessage, res: ServerResponse, scope: { pageId?: string }) => Promise<void>;
  /** Added in M4: handles /acp upgrades. */
  acpUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  acpStatus?: () => unknown;
  agents?: () => Array<{ id: string; name: string; default: boolean }>;
  /** Random per start; `GET /id` reports it so a client can tell a restart (D-6). */
  instance?: string;
  /** Terminal sessions offered to pages (plans/terminal-handoff): /handoff, /handoffs, /handoffs/forget. */
  handoffs?: HandoffRegistry;
  /** The daemon's own agent processes, so a handoff a page holds is listed as such rather than as "open in your terminal". */
  adapterPids?: () => number[];
}

/**
 * Loopback only, by the Host header too: a DNS-rebinding page resolves its own hostname to 127.0.0.1 and then reaches
 * every route with a same-origin request that carries no Origin header. Its Host header still names that hostname,
 * so nothing is served to it. Every client of ours (the connector's sweep, the hooks, the relay, the status page) uses
 * 127.0.0.1 or localhost with the daemon's port.
 */
export function isLoopbackHost(host: string | undefined, port: number, extra?: string): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:\s]+)(?::(\d+))?$/.exec(host.trim());
  if (!m) return false;
  const name = m[1]!.toLowerCase();
  const p = m[2] !== undefined ? Number(m[2]) : undefined;
  const ok = name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || (extra !== undefined && name === extra.toLowerCase());
  return ok && (p === undefined || p === port);
}

export function createHttpServer(deps: HttpDeps): Server {
  const server = createServer((req, res) => {
    if (!isLoopbackHost(req.headers.host, deps.config.port, deps.config.host)) { log.warn(`refused ${req.method} ${req.url} for host ${JSON.stringify(req.headers.host ?? '')}`); json(res, 403, { error: 'host not loopback' }); return; }
    void route(deps, req, res).catch((err) => { log.error(`http ${req.method} ${req.url}: ${String(err)}`); if (!res.headersSent) json(res, 500, { error: String(err) }); });
  });
  server.on('upgrade', (req, socket, head) => {
    if (!isLoopbackHost(req.headers.host, deps.config.port, deps.config.host)) { log.warn(`refused upgrade ${req.url} for host ${JSON.stringify(req.headers.host ?? '')}`); socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path === '/ws') { void deps.pages.handleUpgrade(req, socket, head); return; }
    if (path === '/acp' && deps.acpUpgrade) { deps.acpUpgrade(req, socket, head); return; }
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy();
  });
  return server;
}

async function route(deps: HttpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const { registry, policy, config } = deps;
  const path = url.pathname;
  const selfOrigin = `http://${config.host}:${config.port}`;

  // State-changing routes: a browser can reach loopback with a `no-cors` POST it cannot read. Such requests cannot
  // carry application/json, and every browser POST carries Origin; so require JSON and an authorised Origin.
  if (req.method === 'POST' && (path === '/call' || path === '/approve')) {
    const ct = String(req.headers['content-type'] ?? '');
    if (!/^application\/json\b/i.test(ct)) return json(res, 415, { error: 'content-type must be application/json' });
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const ok = path === '/approve' ? origin === selfOrigin : origin === selfOrigin || policy.isAllowed(origin);
      if (!ok) { log.warn(`refused POST ${path} from origin ${origin}`); return json(res, 403, { error: 'origin not authorised' }); }
    }
  }

  if (path === '/' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(statusPageHtml()); return; }
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }   // the status page has no icon; keep the browser console quiet
  if (path === '/status.json') {
    const sel = registry.selected()?.id;
    const loginInstalled = existsSync(join(homedir(), 'Library', 'LaunchAgents', 'com.webmcp-bridge.daemon.plist'));
    let logTail = '';
    try { logTail = readFileSync(join(config.stateDir, 'daemon.log'), 'utf8').split('\n').slice(-40).join('\n'); } catch { /* no log yet */ }
    return json(res, 200, { version: config.version, port: config.port, ports: config.portPinned ? [config.port] : (config.portCandidates ?? CANDIDATE_PORTS), stateDir: config.stateDir, loginInstalled, pid: process.pid,
      pages: registry.all().map((p) => ({ id: p.id, title: p.title, origin: p.origin, tools: p.tools.length, selected: p.id === sel })),
      agents: deps.acpStatus?.() ?? [], origins: policy.snapshot(),
      handoffs: (deps.handoffs?.all() ?? []).map(({ tags: _tags, ...h }) => h), logTail });
  }
  if (path === '/launchd' && req.method === 'POST') {
    if (req.headers.origin !== undefined && req.headers.origin !== selfOrigin) return json(res, 403, { error: 'origin not authorised' });
    const body = JSON.parse(await readBody(req) || '{}') as { action?: string };
    try {
      const msg = body.action === 'uninstall' ? uninstallLaunchd() : installLaunchd(config, process.argv[1]!);
      return json(res, 200, { ok: true, message: msg });
    } catch (err) { return json(res, 500, { ok: false, message: String((err as Error)?.message ?? err) }); }
  }
  if (path === '/origins/forget' && req.method === 'POST') {
    if (req.headers.origin !== undefined && req.headers.origin !== selfOrigin) return json(res, 403, { error: 'origin not authorised' });
    const body = JSON.parse(await readBody(req) || '{}') as { origin?: string };
    if (body.origin) policy.forget(body.origin);
    return json(res, 200, { ok: true });
  }

  // Terminal handoffs (plans/terminal-handoff/main.md §2.2). A handoff is *offered* by a local process only: a
  // request with an Origin header comes from a page, and a page may only read (and forget) what was offered to
  // its origin. Pages read across origins, so the answers carry CORS headers for approved origins only.
  if (path === '/handoff' && req.method === 'POST') {
    if (!deps.handoffs) return json(res, 404, { error: 'handoffs are not enabled' });
    if (req.headers.origin !== undefined) { log.warn(`refused POST /handoff from origin ${req.headers.origin}`); return json(res, 403, { error: 'a handoff is offered by a local process, never by a page' }); }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return json(res, 415, { error: 'content-type must be application/json' });
    let body: unknown;
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    try {
      const rec = deps.handoffs.offer(body);
      log.info(`handoff offered: session ${rec.sessionId} in ${rec.cwd}${rec.origin ? ` for ${rec.origin}` : ' for any approved origin'}${rec.title ? ` ("${rec.title}")` : ''}`);
      return json(res, 200, rec);
    } catch (err) { return json(res, 400, { error: String((err as Error)?.message ?? err) }); }
  }
  if (path === '/handoffs' || path === '/handoffs/forget') {
    if (!deps.handoffs) return json(res, 404, { error: 'handoffs are not enabled' });
    const origin = req.headers.origin;
    const fromPage = origin !== undefined && origin !== selfOrigin;
    if (origin !== undefined) {
      if (!(origin === selfOrigin || policy.isAllowed(origin))) { log.warn(`refused ${req.method} ${path} from origin ${origin}`); res.writeHead(403); res.end(); return; }
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    }
    if (path === '/handoffs' && req.method === 'GET') {
      const rows = await deps.handoffs.withLiveness(deps.handoffs.visibleTo(fromPage ? origin : undefined), deps.adapterPids?.() ?? []);
      return json(res, 200, { handoffs: rows });
    }
    if (path === '/handoffs/forget' && req.method === 'OPTIONS') {   // the browser's preflight for a JSON POST from another origin
      if (origin === undefined) { res.writeHead(204); res.end(); return; }
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' }); res.end(); return;
    }
    if (path === '/handoffs/forget' && req.method === 'POST') {
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return json(res, 415, { error: 'content-type must be application/json' });
      let body: { sessionId?: unknown };
      try { body = JSON.parse(await readBody(req) || '{}') as { sessionId?: unknown }; } catch { return json(res, 400, { error: 'invalid JSON' }); }
      const id = String(body.sessionId ?? '').toLowerCase();
      const rec = deps.handoffs.get(id);
      if (!rec || (fromPage && rec.origin && rec.origin !== origin)) return json(res, 404, { ok: false, error: 'no such handoff' });
      deps.handoffs.forget(id);
      log.info(`handoff forgotten: session ${id}${fromPage ? ` (by ${origin})` : ''}`);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'method not allowed' });
  }

  // Who is on this port: the one answer any origin may read, so a page can walk the candidate ports
  // without opening a WebSocket to a stranger (plans/daemon-port-discovery D-4, D-6). Nothing private.
  if (path === '/id' && req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return json(res, 200, { daemon: DAEMON_NAME, protocol: PROTOCOL_VERSION, version: config.version, instance: deps.instance ?? '' });
  }
  if (path === '/health') {
    const sel = registry.selected();
    return json(res, 200, { ok: true, version: config.version, pid: process.pid, pages: registry.all().length, selectedPage: sel ? { id: sel.id, title: sel.title, origin: sel.origin } : null, agents: deps.acpStatus?.() ?? [] });
  }
  if (path === '/pages') {
    const sel = registry.selected()?.id;
    return json(res, 200, registry.all().map((p) => ({ id: p.id, title: p.title, origin: p.origin, url: p.url, toolCount: p.tools.length, tools: p.tools.map((t) => t.name), hasContext: p.hasContext, visible: p.visible, selected: p.id === sel, connectedAt: p.connectedAt })));
  }
  if (path === '/origins') return json(res, 200, policy.snapshot());
  if (path === '/agents') return json(res, 200, deps.agents?.() ?? []);

  if (path === '/state') {
    const page = registry.resolve(url.searchParams.get('page') ?? undefined);
    if (!page) { res.writeHead(204); res.end(); return; }
    if (!page.hasContext) { res.writeHead(204); res.end(); return; }
    try {
      const text = await page.link.requestContext();
      page.contextCache = { text, at: Date.now() };
      return textOut(res, 200, frameState(page.title, page.origin, text));
    } catch (err) {
      if (page.contextCache) return textOut(res, 200, frameState(page.title, page.origin, page.contextCache.text) + `\n(cached; live request failed: ${String(err)})`);
      res.writeHead(204); res.end(); return;
    }
  }

  if (path === '/instructions') {
    const page = registry.resolve(url.searchParams.get('page') ?? undefined);
    if (!page) { res.writeHead(204); res.end(); return; }
    const full = url.searchParams.get('full') === '1';
    const text = full ? (page.instructions ?? '') : hookInstructions(page, config.stateDir);
    if (!text) { res.writeHead(204); res.end(); return; }
    return textOut(res, 200, text);
  }

  if (path === '/approve' && req.method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    const pending = policy.pending(id);
    if (!pending) return textOut(res, 404, 'No pending approval with that id (it may have expired).');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(approvalPageHtml(id, pending.origin, pending.title)); return;
  }
  if (path === '/approve' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}') as { id?: string; allow?: boolean; remember?: boolean };
    const ok = policy.settle(String(body.id ?? ''), !!body.allow, body.remember !== false);
    return json(res, ok ? 200 : 404, { ok });
  }

  if (path === '/call' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}') as { page?: string; name?: string; args?: Record<string, unknown> };
    const page = registry.resolve(body.page);
    if (!page) return json(res, 404, errorResult(body.name ?? '?', { name: 'NotFoundError', message: 'no page connected' }));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.callTimeoutMs);
    try {
      const raw = await page.link.call(String(body.name), body.args ?? {}, controller.signal);
      return json(res, 200, normaliseResult(raw));
    } catch (err) {
      const e = err as { name?: string; message?: string };
      return json(res, 200, errorResult(String(body.name), { name: e.name, message: e.message }));
    } finally { clearTimeout(timer); }
  }

  if (deps.mcp && (path === '/mcp' || path.startsWith('/mcp/by-page/'))) {
    const pageId = path.startsWith('/mcp/by-page/') ? path.slice('/mcp/by-page/'.length).split('/')[0] : undefined;
    return deps.mcp(req, res, { pageId });
  }

  json(res, 404, { error: 'not found' });
}

function statusPageHtml(): string {
  return `<!doctype html><meta charset="utf-8"><title>webmcp-bridge</title>
<style>:root{--accent:#5b4bd6;--deep:#2d2a6e;--bg:#f6f5ff;--border:#dedbf5;--muted:#6b6a85}
body{font:15px/1.5 system-ui;margin:0;background:var(--bg);color:#1d1b3a}
header{background:linear-gradient(135deg,var(--deep),var(--accent));color:#fff;padding:1.2rem 1.5rem}header h1{margin:0;font-size:1.3rem;font-weight:600}header p{margin:.2rem 0 0;opacity:.85;font-size:.9rem}header code{background:rgba(255,255,255,.18);color:#fff}
main{max-width:46rem;margin:1.2rem auto;padding:0 1rem}section{background:#fff;border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;margin:.8rem 0}
h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin:0 0 .4rem}code{background:#eeecfb;padding:.1rem .3rem;border-radius:4px}
button{font:inherit;padding:.35rem .8rem;border-radius:6px;border:1px solid var(--accent);background:#fff;color:var(--accent);cursor:pointer}.on{background:var(--accent);color:#fff}
.muted{color:var(--muted)}ul{padding-left:1.2rem;margin:.2rem 0}pre{background:#1d1b3a;color:#e9e7ff;padding:.6rem;border-radius:8px;font-size:.78rem;max-height:16rem;overflow:auto}.live{color:#b45309}.held{color:var(--accent)}</style>
<header><h1>webmcp-bridge <span id="v" style="opacity:.7;font-weight:400"></span></h1><p>The skills' bridge between web pages and your Claude Code, on port <code id="port"></code>. Everything on this page stays on this computer.</p></header>
<main>
<section><button id="login"></button> <span class="muted">A login item keeps the daemon (and its menu bar item) available without a terminal.</span></section>
<section><h2>Connected pages</h2><ul id="pages"><li class="muted">none</li></ul></section>
<section><h2>Embedded chats</h2><ul id="agents"><li class="muted">none</li></ul></section>
<section><h2>Terminal handoffs</h2><ul id="handoffs"><li class="muted">none</li></ul><p class="muted" style="margin:.3rem 0 0;font-size:.82rem">A terminal Claude Code session offered to a page: its chat continues the thread under the same id.</p></section>
<section><h2>Approved origins</h2><ul id="origins"><li class="muted">none</li></ul></section>
<section><h2>Claude Code</h2><p>MCP endpoint: <code id="mcp"></code> · state folder: <code id="state"></code> · candidate ports: <code id="ports"></code></p></section>
<section><h2>Log</h2><pre id="log"></pre></section>
</main>
<script>
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){const s=await (await fetch('/status.json')).json();
document.getElementById('v').textContent='v'+s.version;document.getElementById('port').textContent=s.port;document.getElementById('ports').textContent=(s.ports||[]).join(', ');
const b=document.getElementById('login');b.textContent=s.loginInstalled?'Start at login: on (click to turn off)':'Start at login: off (click to turn on)';b.className=s.loginInstalled?'on':'';
b.onclick=async()=>{b.disabled=true;const r=await (await fetch('/launchd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:s.loginInstalled?'uninstall':'install'})})).json();alert(r.message);load();};
const li=(h)=>'<li>'+h+'</li>';
document.getElementById('pages').innerHTML=s.pages.length?s.pages.map(p=>li(esc(p.title)+' <span class=muted>'+esc(p.origin)+' · '+p.tools+' tools'+(p.selected?' · selected':'')+'</span>')).join(''):'<li class=muted>none</li>';
document.getElementById('agents').innerHTML=s.agents.length?s.agents.map(a=>li(esc(a.origin)+' <span class=muted>since '+new Date(a.startedAt).toLocaleTimeString()+'</span>')).join(''):'<li class=muted>none</li>';
const o=[...s.origins.preapproved.map(x=>({o:x,fixed:true})),...s.origins.allowed.map(x=>({o:x}))];
document.getElementById('origins').innerHTML=o.length?o.map(x=>li(esc(x.o)+(x.fixed?' <span class=muted>(command line)</span>':' <button data-o="'+esc(x.o)+'">forget</button>'))).join(''):'<li class=muted>none</li>';
for(const f of document.querySelectorAll('button[data-o]'))f.onclick=async()=>{await fetch('/origins/forget',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({origin:f.dataset.o})});load();};
document.getElementById('mcp').textContent=location.origin+'/mcp';document.getElementById('state').textContent=s.stateDir;
document.getElementById('log').textContent=s.logTail||'(empty)';
try{const h=(await (await fetch('/handoffs')).json()).handoffs||[];document.getElementById('handoffs').innerHTML=h.length?h.map(x=>li(esc(x.title||x.cwd)+' <span class=muted>'+esc(x.sessionId.slice(0,8))+' · '+esc(x.cwd)+(x.origin?' · for '+esc(x.origin):'')+'</span> '+(x.live?(x.live.heldByPage?'<span class=held>open in a page</span>':'<span class=live>open in your terminal'+(x.live.pid?' · pid '+x.live.pid:'')+'</span>'):'<span class=muted>waiting</span>'))).join(''):'<li class=muted>none</li>';}catch{}}
load();setInterval(load,5000);
</script>`;
}

function frameState(title: string, origin: string, text: string): string {
  return `[webmcp-bridge] Current UI state of "${title}" (${origin}), captured ${new Date().toISOString()}:\n${text}`;
}

/** What the plugin's SessionStart hook injects: the summary, or a head of the full text, plus pointers (≤ MAX_INJECTED_CHARS). */
export function hookInstructions(page: { title: string; origin: string; slug: string; instructions?: string; instructionsSummary?: string; tools: { name: string }[] }, stateDir: string): string {
  const header = `[webmcp-bridge] The page "${page.title}" (${page.origin}) is connected. Its tools are the non-webmcp_ tools of the \"webmcp\" MCP server (webmcp_list_tools shows the live set); the current UI state is injected with each prompt.`;
  const full = page.instructions ?? '';
  const file = `${stateDir}/workspaces/${page.slug}/CLAUDE.md`;
  const pointer = full ? `\n\nFull page instructions (${full.length} chars): run /webmcp:page-instructions, or read ${file}` : '';
  let body = page.instructionsSummary?.trim() ?? '';
  if (!body && full) {
    const room = MAX_INJECTED_CHARS - header.length - pointer.length - 40;
    body = full.length > room ? full.slice(0, room) + '\n[… truncated …]' : full;
  }
  const out = `${header}${body ? `\n\n${body}` : ''}${pointer}`;
  return out.length > MAX_INJECTED_CHARS ? out.slice(0, MAX_INJECTED_CHARS) : out;
}

function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function textOut(res: ServerResponse, status: number, text: string) { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); }
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => { let s = ''; req.setEncoding('utf8'); req.on('data', (c) => { s += c; if (s.length > 1e6) reject(new Error('body too large')); }); req.on('end', () => resolve(s)); req.on('error', reject); });
}
