import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { PING_INTERVAL_MS, isPageFrame, type DaemonFrame, type HelloFrame, type PageFrame, type WelcomeFrame } from 'webmcp-protocol';
import { log } from './log.ts';
import type { Registry, PageLink, PageRecord } from './registry.ts';
import type { OriginPolicy } from './security.ts';
import type { Workspaces } from './workspace.ts';

export interface PageServerDeps {
  registry: Registry;
  policy: OriginPolicy;
  workspaces: Workspaces;
  version: string;
  callTimeoutMs: number;
  /** http://127.0.0.1:port and ws://127.0.0.1:port */
  httpBase: string;
  wsBase: string;
  agents?: () => Array<{ id: string; name: string; default: boolean }>;
}

const HELLO_TIMEOUT_MS = 10_000;
const CONTEXT_TIMEOUT_MS = 10_000;
const LIVENESS_MS = PING_INTERVAL_MS * 3;

/** Accepts page connections on /ws: origin approval, hello/welcome, then frames (plan §5.1). */
export class PageServer {
  readonly #wss = new WebSocketServer({ noServer: true });
  readonly deps: PageServerDeps;

  constructor(deps: PageServerDeps) { this.deps = deps; }

  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const origin = req.headers.origin;
    const title = new URL(req.url ?? '/', 'http://x').searchParams.get('title') ?? undefined;
    if (!origin) { reject(socket, 403, 'Origin header required'); return; }
    socket.on('error', () => { /* client went away while we were deciding */ });
    const allowed = await this.deps.policy.decide(origin, title);
    if (socket.destroyed) return;
    this.#wss.handleUpgrade(req, socket, head, (ws) => {
      if (!allowed) { log.warn(`denied origin ${origin}`); ws.close(4403, 'origin-denied'); return; }
      this.#attach(ws, origin, req);
    });
  }

  #attach(ws: WebSocket, origin: string, req: IncomingMessage): void {
    let page: PageRecord | undefined;
    let lastSeen = Date.now();
    const pendingCalls = new Map<string, { resolve: (r: string | null) => void; reject: (e: Error) => void }>();
    const pendingContext = new Map<string, { resolve: (t: string) => void; reject: (e: Error) => void }>();
    const send = (frame: DaemonFrame) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame)); };

    const helloTimer = setTimeout(() => { if (!page) { log.warn(`no hello from ${origin}; closing`); ws.close(4400, 'hello-timeout'); } }, HELLO_TIMEOUT_MS);
    const ping = setInterval(() => {
      if (Date.now() - lastSeen > LIVENESS_MS) { log.warn(`page ${page?.id ?? '?'} unresponsive; terminating`); ws.terminate(); return; }
      send({ type: 'ping' });
    }, PING_INTERVAL_MS);

    const link: PageLink = {
      call: (name, args, signal) => new Promise<string | null>((resolve, reject) => {
        const callId = randomUUID();
        if (signal.aborted) { reject(abortError()); return; }
        pendingCalls.set(callId, { resolve, reject });
        const onAbort = () => { if (pendingCalls.delete(callId)) { send({ type: 'cancel', callId }); reject(abortError()); } };
        signal.addEventListener('abort', onAbort, { once: true });
        send({ type: 'call', callId, name, args, timeoutMs: this.deps.callTimeoutMs });
      }),
      requestContext: () => new Promise<string>((resolve, reject) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => { if (pendingContext.delete(requestId)) reject(new Error('context request timed out')); }, CONTEXT_TIMEOUT_MS);
        pendingContext.set(requestId, { resolve: (t) => { clearTimeout(timer); resolve(t); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        send({ type: 'context/request', requestId });
      }),
      close: (reason) => ws.close(1000, reason),
    };

    ws.on('message', (data) => {
      lastSeen = Date.now();
      let frame: unknown;
      try { frame = JSON.parse(data.toString()); } catch { send({ type: 'error', message: 'invalid JSON' }); return; }
      if (!isPageFrame(frame)) { send({ type: 'error', message: 'invalid frame' }); return; }
      if (!page) {
        if (frame.type !== 'hello') { send({ type: 'error', message: 'expected hello' }); return; }
        page = this.#welcome(frame as HelloFrame, origin, link, send);
        clearTimeout(helloTimer);
        return;
      }
      this.#onFrame(page, frame as PageFrame, pendingCalls, pendingContext);
    });

    ws.on('close', (code, reason) => {
      clearTimeout(helloTimer); clearInterval(ping);
      for (const p of pendingCalls.values()) p.reject(new Error('page disconnected'));
      for (const p of pendingContext.values()) p.reject(new Error('page disconnected'));
      pendingCalls.clear(); pendingContext.clear();
      if (page) { log.info(`page ${page.id} (${page.origin}) disconnected: ${code} ${reason.toString()}`); this.deps.registry.remove(page.id); }
    });
    ws.on('error', (err) => log.warn(`ws error from ${origin}: ${err.message}`));
    void req;
  }

  #welcome(hello: HelloFrame, origin: string, link: PageLink, send: (f: DaemonFrame) => void): PageRecord {
    if (hello.origin !== origin) log.warn(`hello origin ${hello.origin} differs from header ${origin}; using header`);
    const page = this.deps.registry.add({
      origin, url: hello.url, title: hello.title || origin,
      instructions: hello.instructions, instructionsSummary: hello.instructionsSummary,
      hasContext: !!hello.hasContext, link,
    });
    const workspaceDir = this.deps.workspaces.ensure(page);
    const { httpBase, wsBase, version } = this.deps;
    const welcome: WelcomeFrame = {
      type: 'welcome', pageId: page.id, daemonVersion: version, workspaceDir,
      mcpUrl: `${httpBase}/mcp/by-page/${page.id}`,
      stateUrl: `${httpBase}/state?page=${page.id}`,
      acpUrl: `${wsBase}/acp?page=${page.id}`,
      agents: this.deps.agents?.() ?? [{ id: 'claude', name: 'Claude', default: true }],
      handoffsUrl: `${httpBase}/handoffs?page=${page.id}`,
    };
    send(welcome);
    log.info(`page ${page.id} connected: "${page.title}" ${origin} (context: ${page.hasContext}, instructions: ${hello.instructions?.length ?? 0} chars)`);
    return page;
  }

  #onFrame(page: PageRecord, frame: PageFrame, calls: Map<string, { resolve: (r: string | null) => void; reject: (e: Error) => void }>, ctx: Map<string, { resolve: (t: string) => void; reject: (e: Error) => void }>): void {
    const { registry } = this.deps;
    switch (frame.type) {
      case 'tools':
        registry.setTools(page.id, Array.isArray(frame.tools) ? frame.tools : []);
        log.info(`page ${page.id}: ${page.tools.length} tools [${page.tools.map((t) => t.name).join(', ')}]`);
        break;
      case 'instructions':
        registry.setInstructions(page.id, frame.instructions, frame.instructionsSummary);
        this.deps.workspaces.writeInstructions(this.deps.workspaces.ensure(page), page);
        break;
      case 'visibility': registry.setVisible(page.id, !!frame.visible); break;
      case 'context/result': {
        const p = ctx.get(frame.requestId); if (!p) return; ctx.delete(frame.requestId);
        if (frame.error !== undefined && frame.text === undefined) p.reject(new Error(frame.error)); else p.resolve(frame.text ?? '');
        break;
      }
      case 'call/result': {
        const p = calls.get(frame.callId); if (!p) return; calls.delete(frame.callId);
        registry.touch(page.id);
        if (frame.ok) p.resolve(frame.result ?? null); else p.reject(Object.assign(new Error(frame.error?.message ?? 'tool failed'), { name: frame.error?.name ?? 'Error' }));
        break;
      }
      case 'pong': break;
      case 'hello': break;
    }
  }
}

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
function abortError(): Error { return Object.assign(new Error('call aborted'), { name: 'AbortError' }); }
