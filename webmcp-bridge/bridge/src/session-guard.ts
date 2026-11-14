/**
 * What the relay enforces on the frames a page sends to its agent (plans/terminal-handoff/main.md §2.3;
 * the security audit's F-1). The page may not choose where the agent runs or which MCP servers it
 * gets: `cwd` is the page's workspace and `mcpServers` is exactly the daemon's page server. The one
 * exception is a `session/load` of a session a terminal registered as a handoff for this origin:
 * that runs in the terminal session's own directory, and the page's system prompt is turned into an
 * *append* to Claude Code's own, never a replacement, so the thread keeps the preset it was started
 * with (D-9). `_meta.claudeCode.options` keeps an allow-list of keys. A frame that already conforms
 * (every page built on the connector) comes out equal to what went in, and nothing is logged.
 */
export interface GuardContext {
  origin: string;
  workspaceDir: string;
  /** The daemon's MCP server for this page; undefined when the connection has no page (then no servers). */
  pageMcpUrl?: string;
  /** A registered handoff this origin may load, by session id. */
  handoffFor(sessionId: string): { cwd: string } | undefined;
  log?: (line: string) => void;
}

export const GUARDED_METHODS = new Set(['session/new', 'session/load', 'session/list']);
/** `_meta.claudeCode.options` keys a page may set (the audit's allow-list, plus a false `allowDangerouslySkipPermissions`). */
export const ALLOWED_OPTION_KEYS = new Set(['allowedTools', 'disallowedTools', 'model']);

interface Request { jsonrpc?: string; id: unknown; method: string; params?: unknown }

function isRequest(msg: unknown): msg is Request {
  return !!msg && typeof msg === 'object' && typeof (msg as Request).method === 'string' && (msg as Request).id !== undefined && (msg as Request).id !== null;
}

/** The session id when `msg` is a `session/load` of a handoff this origin may load; the relay checks who holds it first. */
export function handoffLoadOf(msg: unknown, ctx: GuardContext): string | undefined {
  if (!isRequest(msg) || msg.method !== 'session/load') return undefined;
  const id = msg.params && typeof msg.params === 'object' ? (msg.params as { sessionId?: unknown }).sessionId : undefined;
  return typeof id === 'string' && ctx.handoffFor(id) ? id : undefined;
}

/** The JSON-RPC error answered in the agent's place when another process still holds the session (two writers on one transcript otherwise). */
export function heldElsewhereError(msg: unknown, live: { pid?: number; kind?: string; status?: string }): { jsonrpc: '2.0'; id: unknown; error: { code: number; message: string } } {
  const where = live.kind === 'background' ? 'a background session' : 'your terminal (or another tab)';
  const pid = live.pid ? `, pid ${live.pid}` : '';
  return { jsonrpc: '2.0', id: (msg as Request).id, error: { code: -32001, message: `That session is still open in ${where}${pid}${live.status ? `, ${live.status}` : ''}. Press Ctrl+D there (or run \`claude stop\` for a background session) and try again; the thread is kept.` } };
}

/** Returns the message to forward: the same object for anything but a guarded request, else a rewritten copy. */
export function rewriteOutbound(msg: unknown, ctx: GuardContext): unknown {
  if (!isRequest(msg) || !GUARDED_METHODS.has(msg.method)) return msg;
  const p: Record<string, unknown> = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? { ...(msg.params as Record<string, unknown>) } : {};
  const changes: string[] = [];
  let cwd = ctx.workspaceDir;
  let handoff = false;
  if (msg.method === 'session/load' && typeof p.sessionId === 'string') {
    const h = ctx.handoffFor(p.sessionId);
    if (h) { cwd = h.cwd; handoff = true; }
  }
  if (p.cwd !== cwd) changes.push(`cwd ${JSON.stringify(p.cwd)} → ${cwd}`);
  p.cwd = cwd;
  if (msg.method !== 'session/list') {
    const want = ctx.pageMcpUrl ? [{ type: 'http', name: 'page', url: ctx.pageMcpUrl, headers: [] }] : [];
    if (!sameServers(p.mcpServers, want)) changes.push(`mcpServers ${JSON.stringify(p.mcpServers)} → ${want.length ? 'the page server' : 'none'}`);
    p.mcpServers = want;
    const meta = filterMeta(p._meta, handoff, changes);
    if (meta === undefined) delete p._meta; else p._meta = meta;
  }
  if (changes.length) ctx.log?.(`${msg.method}${handoff ? ' (registered handoff)' : ''}: ${changes.join('; ')}`);
  return { ...msg, params: p };
}

function sameServers(sent: unknown, want: Array<{ type: string; url: string }>): boolean {
  if (!Array.isArray(sent) || sent.length !== want.length) return false;
  return sent.every((s, i) => s && typeof s === 'object' && (s as { type?: unknown }).type === want[i]!.type && (s as { url?: unknown }).url === want[i]!.url && (s as { command?: unknown }).command === undefined);
}

/** The page's prompt as an append to Claude Code's preset (the connector's 'append' shape); a replace-mode string becomes one. */
function asAppend(v: unknown, changes: string[]): unknown {
  if (typeof v === 'string') { changes.push('_meta.systemPrompt: replace → append'); return { append: v, excludeDynamicSections: true }; }
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { append?: unknown }).append === 'string') return v;
  changes.push('_meta.systemPrompt dropped (neither a string nor an append)');
  return undefined;
}

function filterMeta(meta: unknown, handoff: boolean, changes: string[]): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const m = meta as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (k === 'systemPrompt') {
      if (!handoff) { out.systemPrompt = v; continue; }
      const appended = asAppend(v, changes);
      if (appended !== undefined) out.systemPrompt = appended;
      continue;
    }
    if (k === 'claudeCode') {
      const cc = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      const options = cc.options && typeof cc.options === 'object' && !Array.isArray(cc.options) ? (cc.options as Record<string, unknown>) : {};
      const kept: Record<string, unknown> = {};
      for (const [ok, ov] of Object.entries(options)) {
        if (ALLOWED_OPTION_KEYS.has(ok) || (ok === 'allowDangerouslySkipPermissions' && ov === false)) kept[ok] = ov;
        else changes.push(`_meta.claudeCode.options.${ok} dropped`);
      }
      for (const extra of Object.keys(cc)) if (extra !== 'options') changes.push(`_meta.claudeCode.${extra} dropped`);
      out.claudeCode = { options: kept };
      continue;
    }
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
