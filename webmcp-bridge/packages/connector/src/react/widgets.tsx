/**
 * In-chat widgets, React half (plan in-chat-widgets §4.1–4.3, §4.6, §4.8, §4.9):
 * - `WidgetHost` renders a page-provided component for a tool call, with persisted state, `prompt()` / `note()`
 *   and the raw input/output folded underneath; a throwing widget is contained by an error boundary.
 * - `useWidgetState` keeps a card's state in localStorage per origin, thread (or page) and call id.
 * - `ElicitationView` renders an ACP form elicitation (Claude's AskUserQuestion, MCP elicitations).
 * - `FloatingWidgetPanel` shows the same components for page tool calls no chat panel claimed (terminal Claude).
 */
import { Component, useCallback, useEffect, useRef, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import type { AgentHandle } from '../agent.ts';
import type { ElicitationResult, PendingElicitation } from '../session-model.ts';
import type { PageConnection, ToolCallEvent } from '../types.ts';
import { lookupWidget, sanitiseToolName, widgetInstanceOfCall, type WidgetInstance } from '../widgets.ts';
import { ensureStyles } from './styles.ts';

export interface WidgetProps<I = Record<string, unknown>, O = unknown, S = unknown> extends WidgetInstance<I, O> {
  /** The thread is mid-turn (chat only). Disable actions that send a message; page-only actions may stay enabled. */
  live: boolean;
  /** Persisted per origin, thread (or page) and call id in localStorage; undefined until set. */
  state: S | undefined;
  setState(next: S | ((prev: S | undefined) => S)): void;
  /** Send a user message to this thread (suggestion chips). Absent in the floating panel; rejects while `live`. */
  prompt?: (text: string) => Promise<{ stopReason: string }>;
  /** Record what the user did in this card, for the model's next turn. */
  note(text: string): void;
  thread?: AgentHandle;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WidgetComponent<I = any, O = any, S = any> = ComponentType<WidgetProps<I, O, S>>;
/** Where a widget renders in the transcript. */
export type WidgetPlacement = 'inline' | 'end';
export interface WidgetSpec {
  component: WidgetComponent;
  /** 'inline' (default): where the tool call sits in its turn; 'end': after the turn's last message (suggested replies). */
  placement?: WidgetPlacement;
  /** Render only in the most recent turn (older copies disappear once the conversation moves on). Default false. */
  latestOnly?: boolean;
}
/** Page tool name → component, or a spec with placement options. */
export type WidgetMap = Record<string, WidgetComponent | WidgetSpec>;
export interface ResolvedWidget { Component: WidgetComponent; placement: WidgetPlacement; latestOnly: boolean }

/** The component and options registered for a page tool, under its own name or its mirrored spelling. */
export function resolveWidget(map: WidgetMap | undefined, tool: string): ResolvedWidget | undefined {
  const entry = lookupWidget(map, tool);
  if (!entry) return undefined;
  if (typeof entry === 'object' && 'component' in entry) return { Component: entry.component, placement: entry.placement ?? 'inline', latestOnly: entry.latestOnly ?? false };
  return { Component: entry as WidgetComponent, placement: 'inline', latestOnly: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Persisted widget state
// ---------------------------------------------------------------------------------------------------------------

const PREFIX = 'webmcp-connector:widget:';
/** The page itself (floating panel cards) as a state scope, next to thread scopes. */
export const PAGE_SCOPE = 'page';
/** A chat thread's state scope: the agent and the thread, since thread lists are per agent (audit 3, finding 1). */
export function threadScope(agentId: string, sessionId: string): string { return `${agentId.replace(/[:/]/g, '_')}/${sessionId}`; }

export function widgetStateKey(origin: string, scope: string, id: string): string { return `${PREFIX}${origin}:${scope}:${id}`; }

function storage(): Storage | undefined { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } }
function readState<S>(key: string): S | undefined {
  const raw = storage()?.getItem(key);
  if (raw === null || raw === undefined) return undefined;
  try { return JSON.parse(raw) as S; } catch { return undefined; }
}
function writeState(key: string, value: unknown): void {
  const s = storage(); if (!s) return;
  try { if (value === undefined) s.removeItem(key); else s.setItem(key, JSON.stringify(value)); } catch { /* quota or private mode: the card just forgets */ }
}

/** A card's persisted state; re-read when the key changes (thread switch). */
export function useWidgetState<S>(key: string): [S | undefined, (next: S | ((prev: S | undefined) => S)) => void] {
  const [state, set] = useState<S | undefined>(() => readState<S>(key));
  const keyRef = useRef(key);
  useEffect(() => { if (keyRef.current !== key) { keyRef.current = key; set(readState<S>(key)); } }, [key]);
  const setState = useCallback((next: S | ((prev: S | undefined) => S)) => {
    set((prev) => { const value = typeof next === 'function' ? (next as (p: S | undefined) => S)(prev) : next; writeState(key, value); return value; });
  }, [key]);
  return [state, setState];
}

function keysWithPrefix(prefix: string): string[] {
  const s = storage(); if (!s) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(prefix)) out.push(k); }
  return out;
}
/** Forget every card of one thread (or of the page when `scope` is PAGE_SCOPE). */
export function clearWidgetState(origin: string, scope: string): void { for (const k of keysWithPrefix(`${PREFIX}${origin}:${scope}:`)) storage()?.removeItem(k); }
/** Forget one card. */
export function removeWidgetState(origin: string, scope: string, id: string): void { storage()?.removeItem(widgetStateKey(origin, scope, id)); }
/**
 * Forget the cards of this agent's threads that no longer exist. Other agents' threads and page cards are never
 * touched (a thread list is per agent); keys from before scopes carried an agent are dropped.
 */
export function sweepWidgetState(origin: string, agentId: string, keepSessionIds: Iterable<string>): void {
  const keep = new Set([...keepSessionIds].map((id) => threadScope(agentId, id)));
  const mine = `${threadScope(agentId, '')}`;   // "<agent>/"
  const prefix = `${PREFIX}${origin}:`;
  for (const k of keysWithPrefix(prefix)) {
    const scope = k.slice(prefix.length).split(':')[0] ?? '';
    if (scope === PAGE_SCOPE || keep.has(scope)) continue;
    if (scope.startsWith(mine) || !scope.includes('/')) storage()?.removeItem(k);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Widget host
// ---------------------------------------------------------------------------------------------------------------

class WidgetErrorBoundary extends Component<{ tool: string; children: ReactNode }, { error?: string }> {
  override state: { error?: string } = {};
  static getDerivedStateFromError(err: unknown) { return { error: String((err as Error)?.message ?? err) }; }
  override componentDidCatch(err: unknown, info: ErrorInfo) { console.error(`webmcp-connector: widget for "${this.props.tool}" threw`, err, info.componentStack); }
  override render() { return this.state.error ? <div className="wmc-widget-error">The card for <code>{this.props.tool}</code> failed to render: {this.state.error}</div> : this.props.children; }
}

export function WidgetHost({ Component: Widget, instance, origin, scope, live, prompt, note, thread, raw }: {
  Component: WidgetComponent; instance: WidgetInstance; origin: string; scope: string; live: boolean;
  prompt?: (text: string) => Promise<{ stopReason: string }>; note: (text: string) => void; thread?: AgentHandle; raw?: string;
}) {
  const [state, setState] = useWidgetState<unknown>(widgetStateKey(origin, scope, instance.id));
  const props: WidgetProps = { ...instance, live, state, setState, note, ...(prompt ? { prompt } : {}), ...(thread ? { thread } : {}) };
  return (
    <div className="wmc-widget" data-tool={instance.tool} data-status={instance.status} data-source={instance.source} data-restored={instance.restored ? 'true' : undefined}>
      <WidgetErrorBoundary tool={instance.tool}><Widget {...props} /></WidgetErrorBoundary>
      {raw !== undefined && <details className="wmc-widget-raw"><summary><span className="wmc-title">{instance.tool}</span><span className="wmc-status">{instance.status}</span></summary><pre>{raw}</pre></details>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Elicitation form
// ---------------------------------------------------------------------------------------------------------------

type Prop = { type?: string; title?: string; description?: string; default?: unknown; oneOf?: Array<{ const?: unknown; title?: string; description?: string }>; items?: { anyOf?: Array<{ const?: unknown; title?: string; description?: string }>; enum?: unknown[] }; enum?: unknown[] };
type Option = { value: string; title: string; description?: string };
type FormSchema = { properties?: Record<string, Prop>; required?: string[] };
const optionsOf = (list: Array<{ const?: unknown; title?: string; description?: string }> | undefined, en: unknown[] | undefined): Option[] =>
  list ? list.filter((o) => o.const !== undefined).map((o) => ({ value: String(o.const), title: o.title ?? String(o.const), description: o.description })) : (en ?? []).map((v) => ({ value: String(v), title: String(v) }));
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** The form's starting values: schema defaults, and `false` for a boolean so an untouched box is a real "no". */
export function elicitationInitialValues(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries((schema as FormSchema).properties ?? {})) {
    if (p.default !== undefined && p.default !== null) out[k] = p.type === 'array' && !Array.isArray(p.default) ? [p.default] : p.default;   // a null default is no default
    else if (p.type === 'boolean') out[k] = false;
  }
  return out;
}
/** The accepted content: empty answers are left out, numbers are numbers, booleans (including false) are kept. */
export function elicitationContent(schema: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const [k, p] of Object.entries((schema as FormSchema).properties ?? {})) {
    const v = values[k];
    if (isEmpty(v)) continue;
    content[k] = p.type === 'number' || p.type === 'integer' ? Number(v) : v;
  }
  return content;
}
/** Required fields still unanswered (a boolean is never missing: unchecked means false). */
export function elicitationMissing(schema: Record<string, unknown>, values: Record<string, unknown>): string[] {
  const props = (schema as FormSchema).properties ?? {};
  return ((schema as FormSchema).required ?? []).filter((k) => props[k]?.type !== 'boolean' && isEmpty(values[k]));
}

/** A form for an ACP elicitation (form mode): single and multiple choice, text, numbers, booleans. */
export function ElicitationView({ e }: { e: PendingElicitation }) {
  const props = ((e.schema as FormSchema).properties ?? {});
  const [values, setValues] = useState<Record<string, unknown>>(() => elicitationInitialValues(e.schema));
  const set = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));
  const submit = () => e.respond({ action: 'accept', content: elicitationContent(e.schema, values) });
  const missing = elicitationMissing(e.schema, values).length > 0;
  return (
    <form className="wmc-elicit" role="dialog" aria-label="Question from Claude" onSubmit={(ev) => { ev.preventDefault(); if (!missing) submit(); }}>
      <div className="wmc-elicit-title">{e.message}</div>
      {Object.entries(props).map(([key, p]) => {
        const single = optionsOf(p.oneOf, p.enum);
        const multi = p.type === 'array' ? optionsOf(p.items?.anyOf, p.items?.enum) : [];
        const label = p.title ?? key;
        if (single.length > 0) return (
          <fieldset key={key}><legend>{label}</legend>{p.description && <div className="wmc-elicit-desc">{p.description}</div>}
            {single.map((o) => <label key={o.value}><input type="radio" name={`${e.id}-${key}`} value={o.value} checked={values[key] === o.value} onChange={() => set(key, o.value)} /><span>{o.title}{o.description && <span className="wmc-elicit-desc"> {o.description}</span>}</span></label>)}
          </fieldset>);
        if (multi.length > 0) { const chosen = (values[key] as string[] | undefined) ?? []; return (
          <fieldset key={key}><legend>{label}</legend>{p.description && <div className="wmc-elicit-desc">{p.description}</div>}
            {multi.map((o) => <label key={o.value}><input type="checkbox" checked={chosen.includes(o.value)} onChange={(ev) => set(key, ev.target.checked ? [...chosen, o.value] : chosen.filter((x) => x !== o.value))} /><span>{o.title}{o.description && <span className="wmc-elicit-desc"> {o.description}</span>}</span></label>)}
          </fieldset>); }
        if (p.type === 'boolean') return <label key={key}><input type="checkbox" checked={values[key] === true} onChange={(ev) => set(key, ev.target.checked)} /><span>{label}{p.description && <span className="wmc-elicit-desc"> {p.description}</span>}</span></label>;
        const numeric = p.type === 'number' || p.type === 'integer';
        return (
          <fieldset key={key}><legend>{label}</legend>{p.description && <div className="wmc-elicit-desc">{p.description}</div>}
            <input type={numeric ? 'number' : 'text'} step={p.type === 'integer' ? 1 : undefined} value={(values[key] as string | undefined) ?? ''} onChange={(ev) => set(key, ev.target.value)} />
          </fieldset>);
      })}
      <div className="wmc-elicit-actions">
        <button type="submit" className="wmc-primary" disabled={missing} data-action="accept">Submit</button>
        <button type="button" data-action="decline" onClick={() => e.respond({ action: 'decline' } as ElicitationResult)}>Decline</button>
        <button type="button" data-action="cancel" onClick={() => e.respond({ action: 'cancel' })}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Floating widget panel (page-side calls: terminal Claude)
// ---------------------------------------------------------------------------------------------------------------

export interface FloatingWidgetPanelProps {
  page: PageConnection;
  widgets: WidgetMap;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Most cards shown at once; older ones are dropped. Default 5. */
  max?: number;
  /** Completed cards go away by themselves after this long; 0 keeps them until dismissed. Default 30 s. */
  autoDismissMs?: number;
  /** How long to wait for a chat panel to claim a call before showing it. Default 400 ms. */
  claimDelayMs?: number;
  className?: string;
}

interface Card { event: ToolCallEvent; dismissAt?: number }

/** Cards for page tool calls that did not come through a chat panel: in practice, calls from terminal Claude. */
export function FloatingWidgetPanel({ page, widgets, position = 'bottom-right', max = 5, autoDismissMs = 30_000, claimDelayMs = 400, className }: FloatingWidgetPanelProps) {
  ensureStyles();
  const [cards, setCards] = useState<Map<string, Card>>(() => new Map());
  /** The newest event per call while its claim window is open (a call can end before the window closes). */
  const latest = useRef(new Map<string, ToolCallEvent>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const shownIds = useRef(new Set<string>());
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const remove = useCallback((callId: string) => setCards((m) => { if (!m.has(callId)) return m; const n = new Map(m); n.delete(callId); return n; }), []);
  // A card that leaves the panel for any reason (dismiss, auto-dismiss, the max, a late claim) takes its state with it:
  // page-side calls are never replayed, so the key would otherwise live forever (audit 3, finding 3).
  useEffect(() => {
    const ids = new Set(cards.keys());
    for (const id of shownIds.current) if (!ids.has(id)) removeWidgetState(origin, PAGE_SCOPE, id);
    shownIds.current = ids;
  }, [cards, origin]);
  // The panel unmounting takes every shown card with it (audit 4).
  useEffect(() => () => { for (const id of shownIds.current) removeWidgetState(origin, PAGE_SCOPE, id); shownIds.current = new Set(); }, [origin]);
  // A claim that lands after the window closed hides the card it would have prevented (audit 3, finding 2).
  useEffect(() => page.onClaim((callId) => { latest.current.delete(callId); remove(callId); }), [page, remove]);
  useEffect(() => {
    const show = (ev: ToolCallEvent) => setCards((m) => {
      const n = new Map(m);
      n.set(ev.callId, { event: ev, ...(ev.phase === 'end' && autoDismissMs > 0 ? { dismissAt: Date.now() + autoDismissMs } : {}) });
      while (n.size > max) { const oldest = n.keys().next().value; if (oldest === undefined) break; n.delete(oldest); }
      return n;
    });
    const off = page.onCall((e) => {
      if (!resolveWidget(widgets, sanitiseToolName(e.name))) return;
      if (e.phase === 'start') {
        latest.current.set(e.callId, e);
        timers.current.set(e.callId, setTimeout(() => {
          timers.current.delete(e.callId);
          const ev = latest.current.get(e.callId); latest.current.delete(e.callId);
          if (ev && !page.claimOf(e.callId)) show(ev);
        }, claimDelayMs));
        return;
      }
      if (page.claimOf(e.callId)) { latest.current.delete(e.callId); remove(e.callId); return; }
      if (timers.current.has(e.callId)) { latest.current.set(e.callId, e); return; }   // the window is still open: the timer shows the end state
      setCards((m) => (m.has(e.callId) ? (show(e), m) : m));
    });
    return () => { off(); for (const t of timers.current.values()) clearTimeout(t); timers.current.clear(); latest.current.clear(); };
  }, [page, widgets, max, autoDismissMs, claimDelayMs, remove]);
  useEffect(() => {
    const due = [...cards.values()].map((c) => c.dismissAt).filter((t): t is number => t !== undefined);
    if (due.length === 0) return;
    const timer = setTimeout(() => { const now = Date.now(); setCards((m) => { const n = new Map([...m].filter(([, c]) => c.dismissAt === undefined || c.dismissAt > now)); return n.size === m.size ? m : n; }); }, Math.max(0, Math.min(...due) - Date.now()) + 10);
    return () => clearTimeout(timer);
  }, [cards]);
  if (cards.size === 0) return null;
  return (
    <div className={`wmc-float${className ? ` ${className}` : ''}`} data-position={position} data-role="floating-widgets">
      {[...cards.values()].map(({ event }) => {
        const instance = widgetInstanceOfCall(event);
        const Widget = resolveWidget(widgets, instance.tool)!.Component;
        return (
          <div key={event.callId} className="wmc-float-card" data-call={event.callId}>
            <div className="wmc-float-head"><span title={event.callId}>{instance.tool} · {instance.status}</span><button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => remove(event.callId)}>×</button></div>
            <WidgetHost Component={Widget} instance={instance} origin={origin} scope={PAGE_SCOPE} live={false} note={(text) => page.activity.note(text, { tool: instance.tool, id: instance.id })} />
          </div>
        );
      })}
    </div>
  );
}
