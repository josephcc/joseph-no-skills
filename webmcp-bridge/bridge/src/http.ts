import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { MAX_INJECTED_CHARS } from 'webmcp-protocol';
import type { DaemonConfig } from './config.ts';
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
}

export function createHttpServer(deps: HttpDeps): Server {
  const server = createServer((req, res) => { void route(deps, req, res).catch((err) => { log.error(`http ${req.method} ${req.url}: ${String(err)}`); if (!res.headersSent) json(res, 500, { error: String(err) }); }); });
  server.on('upgrade', (req, socket, head) => {
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

function frameState(title: string, origin: string, text: string): string {
  return `[webmcp] Current UI state of "${title}" (${origin}), captured ${new Date().toISOString()}:\n${text}`;
}

/** What the plugin's SessionStart hook injects: the summary, or a head of the full text, plus pointers (≤ MAX_INJECTED_CHARS). */
export function hookInstructions(page: { title: string; origin: string; slug: string; instructions?: string; instructionsSummary?: string; tools: { name: string }[] }, stateDir: string): string {
  const header = `[webmcp] The page "${page.title}" (${page.origin}) is connected. Its tools are the non-webmcp_ tools of the \"webmcp\" MCP server (webmcp_list_tools shows the live set); the current UI state is injected with each prompt.`;
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
