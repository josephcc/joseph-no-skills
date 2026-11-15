import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * What the relay enforces on the frames a page sends to its agent (plans/terminal-handoff/main.md §2.3;
 * the security audit's F-1). The page may not choose where the agent runs or which MCP servers it
 * gets: `cwd` is the page's workspace and `mcpServers` is exactly the daemon's page server. The one
 * exception is a `session/load` of a session a terminal registered as a handoff for this origin:
 * that runs in the terminal session's own directory, and the page's system prompt is turned into an
 * *append* to Claude Code's own, never a replacement, so the thread keeps the preset it was started
 * with (D-9). Every session request is rebuilt from the fields the daemon vouches for, so a field the
 * page adds on its own (a top-level `systemPrompt`, `additionalDirectories`, `_meta.additionalRoots`)
 * never reaches the adapter; `_meta.claudeCode.options` keeps an allow-list of keys, and `allowedTools`
 * only the page's own MCP tools. A `session/delete` goes through only for a thread of the page's own
 * workspace: the adapter deletes a transcript by id wherever it lives, and a handoff id is a terminal's.
 * A frame that already conforms (every page built on the connector) comes out equal to what went in,
 * and nothing is logged.
 */
export interface GuardContext {
  origin: string;
  workspaceDir: string;
  /** The daemon's MCP server for this page; undefined when the connection has no page (then no servers). */
  pageMcpUrl?: string;
  /** A registered handoff this origin may load, by session id. */
  handoffFor(sessionId: string): { cwd: string } | undefined;
  /** Whether a stored session is one of this page's own threads (its transcript lives under the workspace's project directory and records that cwd). */
  ownsSession?(sessionId: string): boolean;
  /** Whether a session id is registered as a terminal handoff at all (for any origin): never deletable from a page. */
  isHandoff?(sessionId: string): boolean;
  log?: (line: string) => void;
}

export const GUARDED_METHODS = new Set(['session/new', 'session/load', 'session/list']);
/** `_meta.claudeCode.options` keys a page may set (the audit's allow-list, plus a false `allowDangerouslySkipPermissions`). */
export const ALLOWED_OPTION_KEYS = new Set(['allowedTools', 'disallowedTools', 'model']);
/** The only tools a page may pre-approve: its own, as the adapter names them. */
export const PAGE_TOOL_PREFIX = 'mcp__page__';
/** JSON-RPC error codes the relay answers with. Both sit outside the ACP SDK's own codes: its client treats -32002 (resource not found) on session/delete and session/close as success, so a refusal must not look like one. */
export const HELD_ELSEWHERE_CODE = -32040;
export const DELETE_REFUSED_CODE = -32041;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Call { jsonrpc?: string; id?: unknown; method: string; params?: unknown }
export interface ErrorResponse { jsonrpc: '2.0'; id: unknown; error: { code: number; message: string } }

/** Any message that names a method: a request when it carries an `id` key (null included, which the SDK still answers), a notification without one. */
function isCall(msg: unknown): msg is Call {
  return !!msg && typeof msg === 'object' && !Array.isArray(msg) && typeof (msg as Call).method === 'string';
}
const hasId = (msg: Call): boolean => Object.prototype.hasOwnProperty.call(msg, 'id');
const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Returns the message to forward: the same object for anything but a guarded call, one rebuilt from the allowed
 * fields for a guarded request, and `undefined` (drop it) for a guarded method sent without an `id`, which no
 * legitimate client does and which the adapter could only act on blindly.
 */
export function rewriteOutbound(msg: unknown, ctx: GuardContext): unknown {
  if (!isCall(msg) || !GUARDED_METHODS.has(msg.method)) return msg;
  if (!hasId(msg)) { ctx.log?.(`${msg.method} without an id dropped`); return undefined; }
  const sent = asObject(msg.params);
  const changes: string[] = [];
  const sessionId = typeof sent.sessionId === 'string' ? sent.sessionId : undefined;
  let cwd = ctx.workspaceDir;
  let handoff = false;
  if (msg.method === 'session/load' && sessionId) {
    const h = ctx.handoffFor(sessionId);
    if (h) { cwd = h.cwd; handoff = true; }
  }
  if (sent.cwd !== cwd) changes.push(`cwd ${JSON.stringify(sent.cwd)} → ${cwd}`);
  const p: Record<string, unknown> = {};
  if (msg.method === 'session/load' && sessionId) p.sessionId = sessionId;
  p.cwd = cwd;
  const known = new Set(['sessionId', 'cwd']);
  if (msg.method === 'session/list') {
    known.add('cursor');
    if (typeof sent.cursor === 'string') p.cursor = sent.cursor;
  } else {
    known.add('mcpServers'); known.add('_meta');
    const want = ctx.pageMcpUrl ? [{ type: 'http', name: 'page', url: ctx.pageMcpUrl, headers: [] }] : [];
    if (!sameServers(sent.mcpServers, want)) changes.push(`mcpServers ${JSON.stringify(sent.mcpServers)} → ${want.length ? 'the page server' : 'none'}`);
    p.mcpServers = want;
    const meta = filterMeta(sent._meta, handoff, changes);
    if (meta !== undefined) p._meta = meta;
  }
  for (const k of Object.keys(sent)) if (!known.has(k)) changes.push(`${k} dropped`);
  if (changes.length) ctx.log?.(`${msg.method}${handoff ? ' (registered handoff)' : ''}: ${changes.join('; ')}`);
  return { ...msg, params: p };
}

/** The session id when `msg` is a `session/load` of a handoff this origin may load; the relay checks who holds it first. */
export function handoffLoadOf(msg: unknown, ctx: GuardContext): string | undefined {
  if (!isCall(msg) || !hasId(msg) || msg.method !== 'session/load') return undefined;   // a load with no id is dropped by rewriteOutbound; no liveness check for it
  const id = asObject(msg.params).sessionId;
  return typeof id === 'string' && ctx.handoffFor(id) ? id : undefined;
}

/** The JSON-RPC error answered in the agent's place when another process still holds the session (two writers on one transcript otherwise). */
export function heldElsewhereError(msg: unknown, live: { pid?: number; kind?: string; status?: string }): ErrorResponse {
  const where = live.kind === 'background' ? 'a background session' : 'your terminal (or another tab)';
  const pid = live.pid ? `, pid ${live.pid}` : '';
  return { jsonrpc: '2.0', id: (msg as Call).id ?? null, error: { code: HELD_ELSEWHERE_CODE, message: `That session is still open in ${where}${pid}${live.status ? `, ${live.status}` : ''}. Press Ctrl+D there (or run \`claude stop\` for a background session) and try again; the thread is kept.` } };
}

/**
 * A `session/delete` the relay answers itself (or drops, when it carries no id to answer): only a thread of this
 * page's workspace may be deleted; a terminal's session is forgotten from the list, never deleted.
 */
export function refusedDelete(msg: unknown, ctx: GuardContext): ErrorResponse | 'drop' | undefined {
  if (!isCall(msg) || msg.method !== 'session/delete') return undefined;
  const id = asObject(msg.params).sessionId;
  const allowed = typeof id === 'string' && !ctx.isHandoff?.(id) && !!ctx.ownsSession?.(id);
  if (allowed) return undefined;
  if (!hasId(msg)) return 'drop';
  return { jsonrpc: '2.0', id: msg.id ?? null, error: { code: DELETE_REFUSED_CODE, message: 'Only a thread of this page can be deleted here. A terminal session offered to the page is forgotten from the list, never deleted.' } };
}

const TRANSCRIPT_HEAD_BYTES = 1 << 20;
const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => { const t = p.replace(/\/+$/, ''); try { return realpathSync(t); } catch { return t; } };
  return a === b || norm(a) === norm(b);
};

const MAX_PROJECT_NAME = 200;
/** The adapter's project-directory name for a cwd (its `encodeProjectPath`): NFC on macOS, every non-alphanumeric as "-", a hash suffix past 200 characters. */
export function encodeProjectPath(cwd: string): string {
  const normalized = process.platform === 'darwin' ? cwd.normalize('NFC') : cwd;
  const sanitized = normalized.replace(/[^a-zA-Z0-9]/g, '-');
  if (sanitized.length <= MAX_PROJECT_NAME) return sanitized;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  return `${sanitized.slice(0, MAX_PROJECT_NAME)}-${Math.abs(hash).toString(36)}`;
}

/**
 * Claude Code keeps a session's transcript under `<config>/projects/<encoded cwd>/<id>.jsonl` and records the cwd it ran
 * in on the transcript's lines. Both have to agree: two different directories can map to one project directory name, so
 * the file's presence alone does not say whose session it is. The agent runs in the workspace path as the daemon spells
 * it, but a process reports its cwd resolved, so both the given path and its real path are tried.
 */
export function sessionBelongsToWorkspace(sessionId: string, workspaceDir: string, configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')): boolean {
  if (!UUID_RE.test(sessionId)) return false;
  const spellings = [workspaceDir.replace(/\/+$/, '')];
  try { const real = realpathSync(workspaceDir); if (!spellings.includes(real)) spellings.push(real); } catch { /* the workspace may be gone */ }
  for (const dir of spellings) {
    for (const name of projectDirNames(dir, configDir)) {
      const file = join(configDir, 'projects', name, `${sessionId.toLowerCase()}.jsonl`);
      if (!existsSync(file)) continue;
      const cwd = recordedCwd(file);
      if (cwd !== undefined && samePath(cwd, workspaceDir)) return true;
    }
  }
  return false;
}

/**
 * The project directories a cwd's transcripts can sit in: its encoded name, and for a path whose sanitised form runs
 * past 200 characters every directory sharing that 200-character prefix, since the hash suffix has differed between
 * Claude Code versions (the adapter's own index matches long names by prefix and then checks the recorded cwd, as this does).
 */
function projectDirNames(cwd: string, configDir: string): string[] {
  const exact = encodeProjectPath(cwd);
  const sanitized = (process.platform === 'darwin' ? cwd.normalize('NFC') : cwd).replace(/[^a-zA-Z0-9]/g, '-');
  if (sanitized.length <= MAX_PROJECT_NAME) return [exact];
  const prefix = sanitized.slice(0, MAX_PROJECT_NAME);
  let names: string[] = [];
  try { names = readdirSync(join(configDir, 'projects')).filter((n) => n.startsWith(prefix) && n !== exact); } catch { /* no projects dir */ }
  return [exact, ...names];
}

/** The first `"cwd":"…"` in the transcript's head, decoded as JSON; undefined when none is there. */
export function recordedCwd(file: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(TRANSCRIPT_HEAD_BYTES);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const m = /"cwd":("(?:[^"\\]|\\.)*")/.exec(buf.toString('utf8', 0, n));
    if (!m) return undefined;
    try { const v = JSON.parse(m[1]!) as unknown; return typeof v === 'string' ? v : undefined; } catch { return undefined; }
  } catch { return undefined; }
  finally { if (fd !== undefined) closeSync(fd); }
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
      const cc = asObject(v);
      const options = asObject(cc.options);
      const kept: Record<string, unknown> = {};
      for (const [ok, ov] of Object.entries(options)) {
        if (ok === 'allowedTools') {
          const tools = Array.isArray(ov) ? ov.filter((t): t is string => typeof t === 'string' && t.startsWith(PAGE_TOOL_PREFIX)) : [];
          if (!Array.isArray(ov) || tools.length !== ov.length) changes.push('_meta.claudeCode.options.allowedTools: only the page\'s own tools kept');
          kept.allowedTools = tools;
        } else if (ok === 'disallowedTools') {
          const tools = Array.isArray(ov) ? ov.filter((t): t is string => typeof t === 'string') : [];
          if (!Array.isArray(ov) || tools.length !== ov.length) changes.push('_meta.claudeCode.options.disallowedTools: non-strings dropped');
          kept.disallowedTools = tools;
        } else if (ok === 'model') {
          if (typeof ov === 'string') kept.model = ov; else changes.push('_meta.claudeCode.options.model dropped (not a string)');
        } else if (ok === 'allowDangerouslySkipPermissions' && ov === false) kept[ok] = ov;
        else changes.push(`_meta.claudeCode.options.${ok} dropped`);
      }
      for (const extra of Object.keys(cc)) if (extra !== 'options') changes.push(`_meta.claudeCode.${extra} dropped`);
      out.claudeCode = { options: kept };
      continue;
    }
    changes.push(`_meta.${k} dropped`);
  }
  return Object.keys(out).length ? out : undefined;
}
