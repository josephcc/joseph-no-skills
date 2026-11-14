import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListToolsRequestSchema, isInitializeRequest,
  type CallToolResult, type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolInfo } from 'webmcp-protocol';
import type { DaemonConfig } from './config.ts';
import { log } from './log.ts';
import { errorResult, normaliseResult, sanitiseToolName } from './normalise.ts';
import type { PageRecord, Registry } from './registry.ts';

export interface McpDeps { registry: Registry; config: DaemonConfig; version: string }

/** `/mcp` serves meta-tools + the selected page's tools; `/mcp/by-page/<id>` serves one page's tools only. */
interface Scope { pageId?: string }
interface Session { id: string; scope: Scope; server: Server; transport: StreamableHTTPServerTransport }

const META_TOOL_NAMES = new Set(['webmcp_list_pages', 'webmcp_use_page', 'webmcp_list_tools', 'webmcp_call_tool', 'webmcp_get_context']);
const INSTRUCTIONS_PROMPT = 'page-instructions';

export function createMcpHandler(deps: McpDeps) {
  const sessions = new Map<string, Session>();

  // Fan out list_changed to every session whose view could have changed (debounced).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const s of sessions.values()) {
        s.server.sendToolListChanged().catch(() => {});
        s.server.sendPromptListChanged().catch(() => {});
      }
    }, 100);
  };
  deps.registry.on('change', notify);
  deps.registry.on('selection', notify);

  async function handle(req: IncomingMessage, res: ServerResponse, scope: Scope): Promise<void> {
    const sessionId = req.headers['mcp-session-id'];
    const sid = Array.isArray(sessionId) ? sessionId[0] : sessionId;
    const existing = sid ? sessions.get(sid) : undefined;
    if (existing) { await existing.transport.handleRequest(req, res); return; }

    if (req.method !== 'POST') { jsonError(res, 400, 'Bad Request: no valid session'); return; }
    const body = await readJson(req);
    if (!isInitializeRequest(body)) { jsonError(res, 400, 'Bad Request: expected initialize'); return; }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { sessions.set(id, { id, scope, server, transport }); log.info(`mcp session ${id.slice(0, 8)} opened (${scope.pageId ? `page ${scope.pageId}` : 'global'})`); },
    });
    transport.onclose = () => { if (transport.sessionId) { sessions.delete(transport.sessionId); log.info(`mcp session ${transport.sessionId.slice(0, 8)} closed`); } };
    const server = makeServer(deps, scope);
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function close() {
    clearTimeout(timer);
    await Promise.all([...sessions.values()].map((s) => s.transport.close().catch(() => {})));
    sessions.clear();
  }

  return { handle, close, sessionCount: () => sessions.size };
}

function makeServer(deps: McpDeps, scope: Scope): Server {
  const { registry, config } = deps;
  const server = new Server(
    { name: scope.pageId ? 'page' : 'webmcp', version: deps.version },
    {
      capabilities: { tools: { listChanged: true }, prompts: { listChanged: true } },
      instructions: scope.pageId
        ? 'Tools of the web page this chat is embedded in. Read-only tools describe the page; others change what the user sees and return the resulting state.'
        : 'Bridge to web pages connected to this computer. Call webmcp_list_pages to see them; the selected page\'s tools are also mirrored here by name. The plugin injects each page\'s instructions at session start and its current UI state with every prompt; webmcp_get_context refreshes it on demand; /webmcp:page-instructions loads the full instructions.',
    },
  );

  // name → target, rebuilt on every tools/list and lazily on tools/call
  let mirrored = new Map<string, { pageId: string; toolName: string }>();

  const view = (): { page?: PageRecord; tools: Tool[] } => {
    const page = scope.pageId ? registry.get(scope.pageId) : registry.selected();
    const tools: Tool[] = scope.pageId ? [] : metaTools();
    mirrored = new Map();
    if (page) {
      const taken = new Set(tools.map((t) => t.name));
      for (const t of page.tools) {
        let name = sanitiseToolName(t.name) || 'tool';
        if (taken.has(name) || META_TOOL_NAMES.has(name)) { let i = 2; while (taken.has(`${name}_${i}`) || META_TOOL_NAMES.has(`${name}_${i}`)) i++; name = `${name}_${i}`; }
        taken.add(name);
        mirrored.set(name, { pageId: page.id, toolName: t.name });
        tools.push(toMcpTool(name, t, page, !!scope.pageId));
      }
      if (page.hasContext && scope.pageId) tools.push(contextTool(true));
    }
    return { page, tools };
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: view().tools }));

  server.setRequestHandler(CallToolRequestSchema, async (req, extra): Promise<CallToolResult> => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    if (META_TOOL_NAMES.has(name)) return runMeta(name, args, registry, config, extra.signal, scope.pageId);
    if (!mirrored.has(name)) view();
    const target = mirrored.get(name);
    if (!target) return errorResult(name, { name: 'NotFoundError', message: `unknown tool; call ${scope.pageId ? 'tools/list' : 'webmcp_list_tools'} to refresh` });
    const page = registry.get(target.pageId);
    if (!page) return errorResult(name, { name: 'NotFoundError', message: 'the page that provided this tool has disconnected' });
    return callPageTool(page, target.toolName, args, config.callTimeoutMs, extra.signal, name);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const page = scope.pageId ? registry.get(scope.pageId) : registry.selected();
    return { prompts: [{
      name: INSTRUCTIONS_PROMPT,
      description: page ? `Full instructions of the connected page "${page.title}" (${page.instructions?.length ?? 0} chars)` : 'Full instructions of the connected page (none connected right now)',
      arguments: scope.pageId ? [] : [{ name: 'page_id', description: 'Page id from webmcp_list_pages (default: selected page)', required: false }],
    }] };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name !== INSTRUCTIONS_PROMPT) throw new Error(`unknown prompt ${req.params.name}`);
    const page = scope.pageId ? registry.get(scope.pageId) : registry.resolve(req.params.arguments?.page_id);
    const text = page?.instructions?.trim()
      ? `Instructions from the web page "${page.title}" (${page.origin}):\n\n${page.instructions}`
      : page ? `The page "${page.title}" provided no instructions.` : 'No page is connected.';
    return { description: page ? `Instructions of "${page.title}"` : 'No page connected', messages: [{ role: 'user', content: { type: 'text', text } }] };
  });

  return server;
}

function toMcpTool(name: string, t: ToolInfo, page: PageRecord, pageScoped: boolean): Tool {
  const untrusted = t.annotations?.untrustedContentHint ? '[returns untrusted page content] ' : '';
  const where = pageScoped ? '' : ` (WebMCP tool on ${page.origin}, page "${page.title}")`;
  return {
    name,
    description: `${untrusted}${t.description}${where}`,
    inputSchema: (t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object', properties: {} }) as Tool['inputSchema'],
    annotations: {
      readOnlyHint: !!t.annotations?.readOnlyHint,
      destructiveHint: !!t.annotations?.consequentialHint,
      openWorldHint: false,
    },
  };
}

const PAGE_ID_ARG = { page_id: { type: 'string', description: 'Page id (or id prefix) from webmcp_list_pages; defaults to the selected page' } };

function metaTools(): Tool[] {
  return [
    { name: 'webmcp_list_pages', description: 'Web pages currently connected to this computer\'s webmcp-daemon, with their tool counts and which one is selected (its tools are mirrored here by name).', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, openWorldHint: false } },
    { name: 'webmcp_use_page', description: 'Select which connected page is mirrored by name (and whose UI state is injected). Persists until that page disconnects.', inputSchema: { type: 'object', properties: PAGE_ID_ARG, required: ['page_id'] }, annotations: { readOnlyHint: false, openWorldHint: false } },
    { name: 'webmcp_list_tools', description: 'List a page\'s WebMCP tools with their full input schemas and annotations.', inputSchema: { type: 'object', properties: PAGE_ID_ARG }, annotations: { readOnlyHint: true, openWorldHint: false } },
    { name: 'webmcp_call_tool', description: 'Call a page tool by its own name (works even when mirrored tools have not refreshed yet).', inputSchema: { type: 'object', properties: { ...PAGE_ID_ARG, name: { type: 'string', description: 'Tool name as listed by webmcp_list_tools' }, args: { type: 'object', description: 'Arguments matching the tool\'s input schema', additionalProperties: true } }, required: ['name'] }, annotations: { openWorldHint: false } },
    contextTool(false),
  ];
}

function contextTool(pageScoped: boolean): Tool {
  return { name: 'webmcp_get_context', description: 'Fresh deterministic description of what the user currently sees on the page (same text the plugin injects with each prompt).', inputSchema: { type: 'object', properties: pageScoped ? {} : PAGE_ID_ARG }, annotations: { readOnlyHint: true, openWorldHint: false } };
}

async function runMeta(name: string, args: Record<string, unknown>, registry: Registry, config: DaemonConfig, signal: AbortSignal, scopePageId?: string): Promise<CallToolResult> {
  const pageId = scopePageId ?? (typeof args.page_id === 'string' ? args.page_id : undefined);
  const text = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
  switch (name) {
    case 'webmcp_list_pages': {
      const sel = registry.selected()?.id;
      const pages = registry.all().map((p) => ({ id: p.id, title: p.title, origin: p.origin, url: p.url, toolCount: p.tools.length, tools: p.tools.map((t) => t.name), hasContext: p.hasContext, hasInstructions: !!p.instructions, visible: p.visible, selected: p.id === sel }));
      return text(pages.length ? { pages } : { pages: [], note: 'No page is connected. Open a page that embeds webmcp-connector and approve it when asked.' });
    }
    case 'webmcp_use_page': {
      const page = registry.resolve(pageId);
      if (!page) return errorResult(name, { name: 'NotFoundError', message: `no page ${pageId ?? ''}` });
      registry.select(page.id);
      return text({ selected: { id: page.id, title: page.title, origin: page.origin, tools: page.tools.map((t) => t.name) } });
    }
    case 'webmcp_list_tools': {
      const page = registry.resolve(pageId);
      if (!page) return errorResult(name, { name: 'NotFoundError', message: 'no page connected' });
      return text({ page: { id: page.id, title: page.title, origin: page.origin }, tools: page.tools });
    }
    case 'webmcp_call_tool': {
      const page = registry.resolve(pageId);
      if (!page) return errorResult(name, { name: 'NotFoundError', message: 'no page connected' });
      const toolName = String(args.name ?? '');
      const toolArgs = (args.args && typeof args.args === 'object' ? args.args : {}) as Record<string, unknown>;
      return callPageTool(page, toolName, toolArgs, config.callTimeoutMs, signal, toolName);
    }
    case 'webmcp_get_context': {
      const page = registry.resolve(pageId);
      if (!page) return errorResult(name, { name: 'NotFoundError', message: 'no page connected' });
      if (!page.hasContext) return text(`The page "${page.title}" does not provide a context snapshot; use its read-only tools instead.`);
      try { const t = await page.link.requestContext(); page.contextCache = { text: t, at: Date.now() }; return text(t); }
      catch (err) { return errorResult(name, { name: 'Error', message: String(err) }); }
    }
    default:
      return errorResult(name, { name: 'NotFoundError', message: 'unknown meta-tool' });
  }
}

async function callPageTool(page: PageRecord, toolName: string, args: Record<string, unknown>, timeoutMs: number, signal: AbortSignal, displayName: string): Promise<CallToolResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await page.link.call(toolName, args, controller.signal);
    return normaliseResult(raw) as CallToolResult;
  } catch (err) {
    const e = err as { name?: string; message?: string };
    return errorResult(displayName, { name: e.name, message: e.message }) as CallToolResult;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

function jsonError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => { let s = ''; req.setEncoding('utf8'); req.on('data', (c) => { s += c; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : undefined); } catch (e) { reject(e); } }); req.on('error', reject); });
}
