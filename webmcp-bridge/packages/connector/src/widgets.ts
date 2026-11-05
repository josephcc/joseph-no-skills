/**
 * In-chat widgets (plan in-chat-widgets, D-40–D-44, D-49, D-50): the framework-free half.
 *
 * - `pageToolOf` / `widgetInstanceOf` turn an ACP tool-call item of a page tool into what a page-provided
 *   component renders from: the page tool's own name, the call's input, the result text the model received
 *   (parsed when it is JSON), the status and a stable id.
 * - `createActivityLog` is the page-wide record of what the user did in cards (`note()`), attached to the next
 *   prompt as a `page://widget-activity` resource and to the terminal hook's state text.
 * - `PendingCall` and `deepEqual` serve the in-flight call list the page keeps and the claims the chat's
 *   connection makes on it (§4.7 of the plan), which the floating widget panel reads.
 */
import type { ToolCallItem } from './session-model.ts';

export type WidgetStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface WidgetInstance<I = Record<string, unknown>, O = unknown> {
  /** The page tool's own name as given to registerTool (in its mirrored, sanitised spelling). */
  tool: string;
  /** Stable id: the ACP toolCallId (Claude's toolu_…) in a chat thread; the daemon callId in the floating panel. */
  id: string;
  status: WidgetStatus;
  /** The call's arguments (ACP rawInput; the daemon call's args). */
  input: I;
  /** The tool's result as the model received it: the first text content block (undefined until completed). */
  text?: string;
  /** `text` parsed as JSON when it parses; otherwise undefined. */
  output?: O;
  /** failed / cancelled: the error text, with the adapter's code fence removed. */
  error?: string;
  /** Where the instance was observed: a chat thread, or the page's own call stream. */
  source: 'chat' | 'page';
  sessionId?: string;
  /** Replayed by session/load: no live call behind it. */
  restored: boolean;
  /** Reserved for blocking widgets (P3, deferred by D-54): never set in this round. */
  settle?: { resolve(value: unknown): void; reject(reason?: string): void; signal: AbortSignal };
}

/** Mirrors `sanitiseToolName` in the daemon: Claude Code maps anything outside [A-Za-z0-9_-] to "_". */
export function sanitiseToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

const PAGE_PREFIXES = ['mcp__page__', 'mcp__webmcp__'];

/** The page tool behind a tool-call item ('mcp__page__get_state' → 'get_state'), or undefined for any other tool. */
export function pageToolOf(item: { name?: string; meta?: unknown; title?: string }): string | undefined {
  const name = item.name ?? claudeToolName(item.meta) ?? item.title;
  if (typeof name !== 'string') return undefined;
  for (const p of PAGE_PREFIXES) if (name.startsWith(p) && name.length > p.length) return name.slice(p.length);
  return undefined;
}

function claudeToolName(meta: unknown): string | undefined {
  const n = (meta as { claudeCode?: { toolName?: unknown } } | undefined)?.claudeCode?.toolName;
  return typeof n === 'string' ? n : undefined;
}

/** Look a page tool up in a map under its own name or its mirrored (sanitised) spelling. */
export function lookupWidget<T>(map: Record<string, T> | undefined, tool: string): T | undefined {
  if (!map) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, tool)) return map[tool];
  const wanted = sanitiseToolName(tool);
  for (const key of Object.keys(map)) if (sanitiseToolName(key) === wanted) return map[key];
  return undefined;
}

/** The result text of an item: the first text content block, else whatever textual rawOutput exists. */
export function resultTextOf(item: Pick<ToolCallItem, 'content' | 'rawOutput'>): string | undefined {
  for (const c of item.content as Array<Record<string, any>>) {
    const inner = c?.type === 'content' ? c.content : undefined;
    if (inner?.type === 'text' && typeof inner.text === 'string') return inner.text;
  }
  return textOf(item.rawOutput);
}

function textOf(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) { const t = raw.find((b) => b?.type === 'text' && typeof b.text === 'string'); return t ? String(t.text) : undefined; }
  if (typeof raw === 'object') {
    const content = (raw as { content?: unknown }).content;
    if (content !== undefined) return textOf(content);
    try { return JSON.stringify(raw); } catch { return undefined; }
  }
  return String(raw);
}

/** Remove the ``` fence the Claude adapter wraps error text in (dist/tool-calls/content.js). */
export function unfence(text: string): string {
  const m = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text.trim());
  return m ? m[1]! : text;
}

/** JSON.parse when the text looks like JSON; undefined otherwise (never throws). */
export function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  const t = text.trim();
  if (!t || !/^[[{"\d-]|^(true|false|null)$/.test(t)) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

const DONE = new Set<string>(['completed', 'failed', 'cancelled']);
const FAILED = new Set<string>(['failed', 'cancelled']);

/** What a widget renders from a chat transcript item. */
export function widgetInstanceOf(item: ToolCallItem, ctx: { sessionId?: string; restored?: boolean } = {}): WidgetInstance {
  const status = (item.status ?? 'pending') as WidgetStatus;
  const raw = DONE.has(status) ? resultTextOf(item) : undefined;
  const failed = FAILED.has(status);
  const text = raw !== undefined && failed ? unfence(raw) : raw;
  return {
    tool: pageToolOf(item) ?? item.name ?? item.title,
    id: item.toolCallId,
    status,
    input: asObject(item.rawInput),
    ...(text !== undefined ? { text } : {}),
    ...(text !== undefined && !failed ? { output: parseJson(text) } : {}),
    ...(failed ? { error: text ?? status } : {}),
    source: 'chat',
    ...(ctx.sessionId !== undefined ? { sessionId: ctx.sessionId } : {}),
    restored: ctx.restored ?? !!item.replayed,
  };
}

/** What a widget renders from the page's own call stream (the floating panel, terminal Claude). */
export function widgetInstanceOfCall(call: { callId: string; name: string; args: Record<string, unknown>; phase: 'start' | 'end'; ok?: boolean; result?: string | null; error?: string }): WidgetInstance {
  const base = { tool: sanitiseToolName(call.name), id: call.callId, input: asObject(call.args), source: 'page' as const, restored: false };
  if (call.phase === 'start') return { ...base, status: 'in_progress' };
  if (call.ok) { const text = call.result ?? ''; return { ...base, status: 'completed', text, output: parseJson(text) }; }
  const error = call.error ?? 'failed';
  return { ...base, status: error.startsWith('AbortError') ? 'cancelled' : 'failed', text: error, error };
}

function asObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Structural equality for JSON-like values (key order ignored). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a as number) && Number.isNaN(b as number);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// ---------------------------------------------------------------------------------------------------------------
// In-flight page tool calls (the page keeps them; the chat's connection claims them; the floating panel reads them)
// ---------------------------------------------------------------------------------------------------------------

export interface PendingCall {
  callId: string;
  /** The page tool's own name (as registered). */
  name: string;
  args: Record<string, unknown>;
  startedAt: number;
  signal: AbortSignal;
  /** The chat thread (sessionId) whose transcript item this call belongs to, once claimed (§4.7). */
  claimedBy?: string;
  /** Reserved for blocking widgets (P3, deferred by D-54). */
  settle?: WidgetInstance['settle'];
}

/** What a chat connection needs from the page to claim calls (`openAgent` derives it from a PageConnection). */
export interface CallsApi {
  onCall(listener: (event: { callId: string; name: string; args: Record<string, unknown>; phase: 'start' | 'end' }) => void): () => void;
  calls(): readonly PendingCall[];
  claimCall(callId: string, by: string): void;
}

// ---------------------------------------------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------------------------------------------

export interface ActivityEntry { at: number; text: string; tool?: string; id?: string }

export interface ActivityLog {
  readonly entries: readonly ActivityEntry[];
  /** Record what the user did in a card, for the model's next turn. */
  note(text: string, ref?: { tool?: string; id?: string }): void;
  /** Entries recorded after `ts` (milliseconds since the epoch), oldest first. */
  since(ts: number): ActivityEntry[];
  /** One line per entry, oldest first, trimmed from the oldest end to `maxChars`; '' when there are none. */
  format(entries?: readonly ActivityEntry[], opts?: { maxChars?: number }): string;
  onChange(listener: (entries: readonly ActivityEntry[]) => void): () => void;
}

export const ACTIVITY_MAX_ENTRIES = 20;
export const ACTIVITY_MAX_CHARS = 2_000;
const ACTIVITY_ENTRY_MAX_CHARS = 300;

export function createActivityLog(opts: { maxEntries?: number; maxChars?: number; now?: () => number } = {}): ActivityLog {
  const maxEntries = opts.maxEntries ?? ACTIVITY_MAX_ENTRIES;
  const maxChars = opts.maxChars ?? ACTIVITY_MAX_CHARS;
  const now = opts.now ?? Date.now;
  let entries: ActivityEntry[] = [];
  const listeners = new Set<(entries: readonly ActivityEntry[]) => void>();
  const size = () => entries.reduce((n, e) => n + e.text.length + 40, 0);
  return {
    get entries() { return entries; },
    note(text, ref) {
      const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, ACTIVITY_ENTRY_MAX_CHARS);
      if (!clean) return;
      entries = [...entries, { at: now(), text: clean, ...(ref?.tool ? { tool: ref.tool } : {}), ...(ref?.id ? { id: ref.id } : {}) }];
      while (entries.length > maxEntries || (entries.length > 1 && size() > maxChars)) entries = entries.slice(1);
      for (const l of listeners) l(entries);
    },
    since(ts) { return entries.filter((e) => e.at > ts); },
    format(list = entries, o = {}) {
      const lines = list.map((e) => `- ${new Date(e.at).toISOString()}${e.tool ? ` [${e.tool}]` : ''} ${e.text}`);
      const limit = o.maxChars ?? Number.POSITIVE_INFINITY;
      let kept = lines;
      while (kept.length > 0 && kept.join('\n').length > limit) kept = kept.slice(1);
      return kept.join('\n');
    },
    onChange(l) { listeners.add(l); return () => listeners.delete(l); },
  };
}

/** The heading the model sees above the entries (one wording for the prompt resource and the state text). */
export const ACTIVITY_HEADING = "Recent widget activity (what the user did in the page's cards since your last message, oldest first):";
