/**
 * Framework-agnostic model of one ACP chat session, built from session/update notifications,
 * permission requests and prompt results. A UI (React or otherwise) renders `snapshot()` and
 * subscribes to `onChange`. Plan §4.4 / D-21.
 */
export type ContentBlock = { type: 'text'; text: string } | { type: string; [k: string]: unknown };

export interface ToolCallItem {
  kind: 'tool_call';
  toolCallId: string;
  title: string;
  name?: string;
  toolKind?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  content: unknown[];
  rawInput?: unknown;
  rawOutput?: unknown;
  /** The agent's `_meta` for the call (the Claude adapter puts the tool name under claudeCode.toolName). */
  meta?: Record<string, unknown>;
  /** Replayed by session/load rather than produced by a live turn (widgets render it as restored). */
  replayed?: boolean;
}
export interface TextItem { kind: 'text'; role: 'user' | 'agent'; text: string }
export interface ThoughtItem { kind: 'thought'; text: string }
export type TurnItem = TextItem | ThoughtItem | ToolCallItem;

export interface Turn { id: number; items: TurnItem[]; stopReason?: string; startedAt: number; endedAt?: number }

export interface PermissionOption { optionId: string; name: string; kind: string }
export interface PendingPermission {
  id: string;
  title: string;
  toolName?: string;
  toolKind?: string;
  rawInput?: unknown;
  options: PermissionOption[];
  respond: (optionId: string) => void;
}

export interface PlanEntry { content: string; priority?: string; status?: string }

/** An agent-side setting (ACP `configOptions`): the Claude adapter offers the permission mode, the model, the effort level, … */
export interface ConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: 'select' | 'boolean' | (string & {});
  currentValue: unknown;
  options?: Array<{ value: string; name: string; description?: string }>;
}

export type ElicitationResult = { action: 'accept'; content: Record<string, unknown> } | { action: 'decline' } | { action: 'cancel' };
/** A form the agent (or an MCP server behind it) asks the user to fill in: ACP `elicitation/create`, form mode. */
export interface PendingElicitation {
  id: string;
  message: string;
  /** A JSON Schema object with primitive-typed properties (string with oneOf consts, array with items.anyOf, number, boolean). */
  schema: Record<string, unknown>;
  respond: (result: ElicitationResult) => void;
}

export interface SessionSnapshot {
  state: 'connecting' | 'ready' | 'prompting' | 'closed' | 'error';
  error?: string;
  sessionId?: string;
  agentName?: string;
  turns: Turn[];
  pendingPermissions: PendingPermission[];
  pendingElicitations: PendingElicitation[];
  plan: PlanEntry[];
  commands: Array<{ name: string; description?: string }>;
  modes?: { current?: string; available: Array<{ id: string; name: string; description?: string }> };
  /** The agent's settings, from session/new (or load) and every `config_option_update`; undefined for agents without them. */
  configOptions?: ConfigOption[];
  usage?: { used?: number; size?: number; cost?: { amount: number; currency: string } };
  title?: string;
}

type Listener = (s: SessionSnapshot) => void;

export class SessionModel {
  #s: SessionSnapshot = { state: 'connecting', turns: [], pendingPermissions: [], pendingElicitations: [], plan: [], commands: [] };
  #listeners = new Set<Listener>();
  #turnSeq = 0;
  #notify = debounceFrame(() => { const snap = this.snapshot(); for (const l of this.#listeners) l(snap); });
  /** Set by the connection around session/load: items applied meanwhile are marked `replayed`. */
  replaying = false;

  snapshot(): SessionSnapshot { return { ...this.#s, turns: this.#s.turns.map((t) => ({ ...t, items: [...t.items] })), pendingPermissions: [...this.#s.pendingPermissions], pendingElicitations: [...this.#s.pendingElicitations] }; }
  onChange(l: Listener): () => void { this.#listeners.add(l); return () => this.#listeners.delete(l); }

  setState(state: SessionSnapshot['state'], error?: string) { this.#s.state = state; this.#s.error = error; this.#notify(); }
  setSession(info: { sessionId?: string; agentName?: string; modes?: SessionSnapshot['modes']; configOptions?: ConfigOption[] }) { Object.assign(this.#s, info); this.#notify(); }
  /** Replace the agent's settings (a `session/set_config_option` reply or a `config_option_update`). */
  setConfigOptions(options: unknown) { if (Array.isArray(options)) { this.#s.configOptions = options.map(toConfigOption); this.#notify(); } }

  /** A user prompt starts a turn; the agent's chunks and tool calls attach to it until the prompt resolves. */
  beginTurn(userText: string): number {
    const id = ++this.#turnSeq;
    this.#s.turns.push({ id, items: [{ kind: 'text', role: 'user', text: userText }], startedAt: Date.now() });
    this.#s.state = 'prompting';
    this.#notify();
    return id;
  }
  endTurn(stopReason: string) {
    const t = this.#current(); if (t) { t.stopReason = stopReason; t.endedAt = Date.now(); }
    this.#s.state = 'ready';
    this.#notify();
  }

  /** Apply one `session/update`. Unknown kinds are ignored on purpose (forward compatibility). */
  applyUpdate(update: { sessionUpdate: string; [k: string]: unknown }) {
    const u = update as Record<string, any>;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': this.#appendText('agent', u.content); break;
      case 'user_message_chunk': this.#appendText('user', u.content); break;           // history replay (session/load)
      case 'agent_thought_chunk': this.#appendThought(u.content); break;
      case 'tool_call': this.#items().push(this.#newToolCall(u, 'pending')); break;
      case 'tool_call_update': {
        const item = this.#findToolCall(u.toolCallId);
        if (!item) { this.#items().push(this.#newToolCall(u, 'in_progress')); break; }
        if (u.status) item.status = u.status; if (u.title) item.title = u.title; if (u.name) item.name = u.name; if (u.kind) item.toolKind = u.kind;
        if (u.content) item.content = u.content; if (u.rawInput !== undefined) item.rawInput = u.rawInput; if (u.rawOutput !== undefined) item.rawOutput = u.rawOutput;
        if (u._meta && typeof u._meta === 'object') item.meta = { ...(item.meta ?? {}), ...u._meta };
        break;
      }
      case 'plan': this.#s.plan = (u.entries ?? []).map((e: any) => ({ content: e.content, priority: e.priority, status: e.status })); break;
      case 'available_commands_update': this.#s.commands = (u.availableCommands ?? []).map((c: any) => ({ name: c.name, description: c.description })); break;
      case 'current_mode_update': this.#s.modes = { available: this.#s.modes?.available ?? [], current: u.currentModeId }; break;
      case 'config_option_update': if (Array.isArray(u.configOptions)) this.#s.configOptions = u.configOptions.map(toConfigOption); break;
      case 'usage_update': this.#s.usage = { used: u.used, size: u.size, cost: u.cost }; break;
      case 'session_info_update': if (u.title) this.#s.title = u.title; break;
      default: return;
    }
    this.#notify();
  }

  #newToolCall(u: Record<string, any>, defaultStatus: ToolCallItem['status']): ToolCallItem {
    return {
      kind: 'tool_call', toolCallId: u.toolCallId, title: u.title ?? u.name ?? 'tool', name: u.name, toolKind: u.kind, status: u.status ?? defaultStatus,
      content: u.content ?? [], rawInput: u.rawInput, rawOutput: u.rawOutput,
      ...(u._meta && typeof u._meta === 'object' ? { meta: u._meta } : {}),
      ...(this.replaying ? { replayed: true } : {}),
    };
  }

  /** A tool call by id (any turn), or undefined. */
  toolCall(id: string): ToolCallItem | undefined { return this.#findToolCall(id); }
  /** Tool calls that have not finished yet, oldest first. */
  openToolCalls(): ToolCallItem[] {
    const out: ToolCallItem[] = [];
    for (const t of this.#s.turns) for (const i of t.items) if (i.kind === 'tool_call' && (i.status === 'pending' || i.status === 'in_progress')) out.push(i);
    return out;
  }

  addElicitation(e: PendingElicitation) {
    const wrapped: PendingElicitation = { ...e, respond: (result) => { this.#s.pendingElicitations = this.#s.pendingElicitations.filter((x) => x.id !== e.id); e.respond(result); this.#notify(); } };
    this.#s.pendingElicitations.push(wrapped);
    this.#notify();
  }
  cancelElicitations() { for (const e of this.#s.pendingElicitations) e.respond({ action: 'cancel' }); this.#s.pendingElicitations = []; this.#notify(); }
  /** Cancel every open permission request and elicitation (the turn is being cancelled or the thread closed). */
  cancelPending() { this.cancelPermissions(); this.cancelElicitations(); }

  addPermission(p: Omit<PendingPermission, 'respond'> & { respond: (optionId: string) => void }) {
    const wrapped: PendingPermission = { ...p, respond: (optionId) => { this.#s.pendingPermissions = this.#s.pendingPermissions.filter((x) => x.id !== p.id); p.respond(optionId); this.#notify(); } };
    this.#s.pendingPermissions.push(wrapped);
    this.#notify();
  }
  cancelPermissions() { for (const p of this.#s.pendingPermissions) p.respond('__cancelled__'); this.#s.pendingPermissions = []; this.#notify(); }

  #current(): Turn | undefined { return this.#s.turns[this.#s.turns.length - 1]; }
  #items(): TurnItem[] {
    let t = this.#current();
    if (!t || t.endedAt !== undefined) { t = { id: ++this.#turnSeq, items: [], startedAt: Date.now() }; this.#s.turns.push(t); }   // agent-initiated / replayed
    return t.items;
  }
  #appendText(role: 'user' | 'agent', content: any) {
    if (!content || content.type !== 'text') return;   // attached resources (page://ui-state) are not shown
    let text: string = content.text;
    if (role === 'user') {
      // Replayed history (session/load) folds the attached ui-state resource into the user text; strip it.
      text = text.replace(/\n?<context[\s\S]*$/, '').replace(/\n?page:\/\/(ui-state|widget-activity)[\s\S]*$/, '');
      if (!text.trim()) return;
    }
    if (role === 'user') {
      // Replayed history (session/load): a user chunk after agent output starts a new turn.
      const cur = this.#current();
      if (cur && (cur.endedAt !== undefined || cur.items.some((i) => i.kind !== 'text' || i.role !== 'user'))) {
        cur.endedAt ??= Date.now();
        this.#s.turns.push({ id: ++this.#turnSeq, items: [], startedAt: Date.now() });
      }
    }
    const items = this.#items();
    const last = items[items.length - 1];
    if (last && last.kind === 'text' && last.role === role) last.text += text;
    else items.push({ kind: 'text', role, text });
  }
  #appendThought(content: any) {
    if (!content || content.type !== 'text') return;
    const items = this.#items();
    const last = items[items.length - 1];
    if (last && last.kind === 'thought') last.text += content.text; else items.push({ kind: 'thought', text: content.text });
  }
  #findToolCall(id: string): ToolCallItem | undefined {
    for (let i = this.#s.turns.length - 1; i >= 0; i--) {
      const item = this.#s.turns[i]!.items.find((x) => x.kind === 'tool_call' && x.toolCallId === id) as ToolCallItem | undefined;
      if (item) return item;
    }
    return undefined;
  }
}

export function toConfigOption(o: any): ConfigOption {
  return {
    id: String(o?.id), name: String(o?.name ?? o?.id), description: o?.description, category: o?.category, type: o?.type ?? 'select', currentValue: o?.currentValue,
    ...(Array.isArray(o?.options) ? { options: o.options.map((x: any) => ({ value: String(x?.value), name: String(x?.name ?? x?.value), description: x?.description })) } : {}),
  };
}

/** Coalesce notifications to one per frame; a hidden or occluded tab gets no frames, so a short timer runs it instead. */
function debounceFrame(fn: () => void): () => void {
  let scheduled = false;
  const hasRaf = typeof requestAnimationFrame === 'function';
  return () => {
    if (scheduled) return;
    scheduled = true;
    let done = false;
    const run = () => { if (done) return; done = true; scheduled = false; fn(); };
    if (hasRaf) requestAnimationFrame(run);
    setTimeout(run, hasRaf ? 50 : 16);
  };
}
