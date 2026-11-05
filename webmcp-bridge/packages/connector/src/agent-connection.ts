/**
 * One ACP connection holding many threads (plan threads-and-auto-mode, D-31):
 * `session/update` and permission requests are routed by sessionId to a per-thread
 * SessionModel; threads are listed with `session/list`, switched with `session/load`,
 * and released with `session/close` (D-36). New threads start in `defaultMode` when the
 * agent offers it (D-33, D-37). Framework-free; `agent.ts` derives the parameters from a
 * PageConnection and the React panel renders the result.
 */
import * as acp from '@agentclientprotocol/sdk';
import type { Stream } from '@agentclientprotocol/sdk';
import { SessionModel } from './session-model.ts';

/** Claude Code permission modes as the adapter names them; other agents may use other ids. */
export type PermissionModeId = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions' | 'dontAsk' | (string & {});
/** What happens to the thread you switch away from (D-36). */
export type SwitchPolicy = 'keep-while-prompting' | 'close';
export type ThreadState = 'stored' | 'ready' | 'prompting' | 'needs-permission';

export interface ThreadInfo {
  id: string;
  /** The agent's title for the thread (Claude Code: user-set, else AI-generated, else the first prompt). Undefined until the first prompt is stored. */
  title?: string;
  /** ISO time: the agent's updatedAt, or the last local activity for a live thread. */
  updatedAt?: string;
  /** 'stored' = known from session/list only; the others are live on this connection. */
  state: ThreadState;
  active: boolean;
}

/** One thread. `model` and `sessionId` never change; switch threads through the connection. */
export interface AgentHandle {
  readonly connection: AgentConnection;
  readonly model: SessionModel;
  readonly sessionId: string;
  readonly agentId: string;
  prompt(text: string): Promise<{ stopReason: string }>;
  cancel(): Promise<void>;
  setMode(modeId: string): Promise<void>;
  /** Toggle client-side auto-approval of the page's read-only tools (shared by every thread of the connection). */
  setAutoAllowReadOnly(on: boolean): void;
  readonly autoAllowReadOnly: boolean;
  /** session/close of this thread. A handle returned by connectAgent() also closes the connection it opened. */
  close(): void;
}

export interface AgentConnection {
  readonly agentId: string;
  readonly agentName?: string;
  /** The agent can list and resume sessions (loadSession + sessionCapabilities.list); false hides the thread list. */
  readonly supportsThreads: boolean;
  readonly supportsDelete: boolean;
  /** Stored threads merged with the live ones, newest first. */
  readonly threads: ThreadInfo[];
  readonly active: AgentHandle | undefined;
  readonly closed: boolean;
  readonly autoAllowReadOnly: boolean;
  setAutoAllowReadOnly(on: boolean): void;
  /** session/list for the workspace, merged with live state. */
  listThreads(): Promise<ThreadInfo[]>;
  /** Open a thread and make it active: an id loads it (history replays), no id creates one. */
  openThread(id?: string): Promise<AgentHandle>;
  /** Release a live thread's process; its transcript stays. */
  closeThread(id: string): Promise<void>;
  /** session/delete: removes the stored transcript. Refused while the thread is prompting. */
  deleteThread(id: string): Promise<void>;
  onThreadsChange(listener: (threads: ThreadInfo[]) => void): () => void;
  onActiveChange(listener: (handle: AgentHandle | undefined) => void): () => void;
  /** Fires once when the connection ends; `reason` is set when the other side dropped it. */
  onClose(listener: (reason?: string) => void): () => void;
  close(): void;
}

export interface ConnectionParams {
  stream: Stream;
  agentId: string;
  /** Session cwd (the page's workspace directory); also the session/list filter. */
  cwd: string;
  mcpServers: unknown[];
  /** `_meta` for session/new and session/load (system prompt, Claude options). */
  meta: Record<string, unknown>;
  /** Deterministic UI-state snapshot attached to every prompt as a resource block. */
  context?: () => string | Promise<string>;
  /** Qualified names of the page's read-only tools (mcp__page__<name>), auto-approved when `autoAllowReadOnly`. */
  readOnlyTools?: string[];
  autoAllowReadOnly?: boolean;
  /** Mode for new threads. Default 'auto'; null leaves the agent's own default. */
  defaultMode?: PermissionModeId | null;
  switchPolicy?: SwitchPolicy;
  clientName?: string;
}

interface Live {
  id: string;
  model: SessionModel;
  handle: AgentHandle;
  prompting: boolean;
  pending: number;
  closeWhenIdle: boolean;
  closed: boolean;
  title?: string;
  lastActivity: number;
}

interface Stored { id: string; title?: string; updatedAt?: string }

type Listener<T> = (value: T) => void;
const CANCELLED = '__cancelled__';
const ORPHAN_LIMIT = 200;

export async function openAgentConnection(params: ConnectionParams): Promise<AgentConnection> {
  const policy = params.switchPolicy ?? 'keep-while-prompting';
  const defaultMode = params.defaultMode === undefined ? 'auto' : params.defaultMode;
  const readOnly = new Set(params.readOnlyTools ?? []);
  let autoAllow = params.autoAllowReadOnly ?? true;
  const live = new Map<string, Live>();
  /** Updates that arrived for a session not registered yet (the session/new reply can race its first updates). */
  const orphaned = new Map<string, Array<Record<string, unknown>>>();
  const ignored = new Set<string>();
  let stored: Stored[] = [];
  let activeId: string | undefined;
  let closed = false;
  let listing: Promise<ThreadInfo[]> | undefined;
  const threadListeners = new Set<Listener<ThreadInfo[]>>();
  const activeListeners = new Set<Listener<AgentHandle | undefined>>();
  const closeListeners = new Set<Listener<string | undefined>>();

  const notifyThreads = () => { const t = threads(); for (const l of threadListeners) l(t); };
  const notifyActive = () => { const h = activeId !== undefined ? live.get(activeId)?.handle : undefined; for (const l of activeListeners) l(h); };
  const message = (err: unknown) => String((err as Error)?.message ?? err);

  const app = acp.client({ name: params.clientName ?? 'webmcp-connector' })
    .onRequest(acp.methods.client.session.requestPermission, (ctx: any) => new Promise((resolve) => {
      const p = ctx.params ?? {};
      const options: Array<{ optionId: string; name: string; kind: string }> = p.options ?? [];
      const name = String(p.toolCall?.name ?? p.toolCall?.title ?? 'tool');
      const settle = (optionId: string) => resolve(optionId === CANCELLED ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId } });
      if (autoAllow && readOnly.has(name)) {
        const allow = options.find((o) => o.kind === 'allow_always') ?? options.find((o) => o.kind === 'allow_once');
        if (allow) { settle(allow.optionId); return; }
      }
      const t = live.get(String(p.sessionId));
      if (!t || t.closed) { settle(CANCELLED); return; }
      t.pending += 1;
      t.model.addPermission({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: String(p.toolCall?.title ?? name), toolName: p.toolCall?.name, toolKind: p.toolCall?.kind, rawInput: p.toolCall?.rawInput, options,
        respond: (optionId) => { t.pending = Math.max(0, t.pending - 1); settle(optionId); notifyThreads(); },
      });
      notifyThreads();
    }))
    .onNotification(acp.methods.client.session.update, (ctx: any) => {
      const id = String(ctx.params?.sessionId ?? '');
      const update = ctx.params?.update;
      if (!update || ignored.has(id)) return;
      const t = live.get(id);
      if (!t) { const q = orphaned.get(id) ?? []; if (q.length < ORPHAN_LIMIT) q.push(update); orphaned.set(id, q); return; }
      if (!t.closed) applyUpdate(t, update);
    });

  function applyUpdate(t: Live, update: any) {
    t.model.applyUpdate(update);
    if (update.sessionUpdate === 'session_info_update' && typeof update.title === 'string' && update.title.trim()) { t.title = update.title.trim(); notifyThreads(); }
  }

  const conn = app.connect(params.stream);
  const peer = conn.agent as unknown as { request(method: string, p?: unknown): Promise<any>; notify(method: string, p?: unknown): Promise<void> };
  const req = (method: string, p?: unknown): Promise<any> => peer.request(method, p);
  void conn.closed.then(() => dropped('connection closed'));

  let init: any;
  try { init = await req(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} }); }
  catch (err) { conn.close(); throw err; }
  const caps = init?.agentCapabilities ?? {};
  const sc = caps.sessionCapabilities ?? {};
  const supportsLoad = !!caps.loadSession;
  const supportsList = !!sc.list;
  const supportsClose = !!sc.close;
  const supportsDelete = !!sc.delete;
  const agentName: string | undefined = init?.agentInfo?.name;

  const toModes = (m: any) => (m ? { current: m.currentModeId as string | undefined, available: ((m.availableModes ?? []) as any[]).map((x) => ({ id: String(x.id), name: String(x.name ?? x.id), description: x.description as string | undefined })) } : undefined);
  const stamp = (t: { updatedAt?: string }) => (t.updatedAt ? Date.parse(t.updatedAt) || 0 : 0);

  function threads(): ThreadInfo[] {
    const out = new Map<string, ThreadInfo>();
    for (const s of stored) out.set(s.id, { id: s.id, title: s.title, updatedAt: s.updatedAt, state: 'stored', active: false });
    for (const t of live.values()) {
      if (t.closed) continue;
      const s = out.get(t.id);
      const at = Math.max(t.lastActivity, s ? stamp(s) : 0);
      out.set(t.id, { id: t.id, title: t.title ?? s?.title, updatedAt: new Date(at).toISOString(), state: t.pending > 0 ? 'needs-permission' : t.prompting ? 'prompting' : 'ready', active: t.id === activeId });
    }
    const rank = (t: ThreadInfo) => (t.state === 'stored' ? 1 : 0);
    return [...out.values()].sort((a, b) => stamp(b) - stamp(a) || rank(a) - rank(b));
  }

  function assertOpen() { if (closed) throw new Error('agent connection is closed'); }

  function register(id: string): Live {
    const t = { id, model: new SessionModel(), prompting: false, pending: 0, closeWhenIdle: false, closed: false, lastActivity: Date.now() } as Live;
    t.handle = makeHandle(t);
    live.set(id, t);
    ignored.delete(id);
    for (const u of orphaned.get(id) ?? []) applyUpdate(t, u);
    orphaned.delete(id);
    return t;
  }

  function makeHandle(t: Live): AgentHandle {
    return {
      connection: api, model: t.model, sessionId: t.id, agentId: params.agentId,
      async prompt(text) {
        if (t.closed) throw new Error('thread is closed');
        t.model.beginTurn(text); t.prompting = true; t.lastActivity = Date.now(); notifyThreads();
        const blocks: any[] = [{ type: 'text', text }];
        if (params.context) {
          try { const snap = await params.context(); if (snap) blocks.push({ type: 'resource', resource: { uri: 'page://ui-state', mimeType: 'text/plain', text: `Current UI state of the page (deterministic snapshot):\n${snap}` } }); } catch { /* no snapshot this turn */ }
        }
        try {
          const r = await req(acp.methods.agent.session.prompt, { sessionId: t.id, prompt: blocks });
          const stopReason = String(r?.stopReason ?? 'end_turn');
          if (!t.closed) t.model.endTurn(stopReason);
          return { stopReason };
        } catch (err) {
          if (!t.closed) { t.model.endTurn('error'); t.model.setState('error', message(err)); }
          throw err;
        } finally {
          t.prompting = false; t.lastActivity = Date.now();
          if (t.closeWhenIdle && activeId !== t.id && !t.closed) void closeThreadInternal(t.id);
          notifyThreads();
          if (supportsList && !closed) void listThreads().catch(() => {});
        }
      },
      async cancel() { t.model.cancelPermissions(); await peer.notify(acp.methods.agent.session.cancel, { sessionId: t.id }); },
      async setMode(modeId) {
        await req(acp.methods.agent.session.setMode, { sessionId: t.id, modeId });
        t.model.setSession({ modes: { ...(t.model.snapshot().modes ?? { available: [] }), current: modeId } });
      },
      setAutoAllowReadOnly(on) { autoAllow = on; },
      get autoAllowReadOnly() { return autoAllow; },
      close() { void closeThreadInternal(t.id); },
    };
  }

  async function newThread(): Promise<Live> {
    const r = await req(acp.methods.agent.session.new, { cwd: params.cwd, mcpServers: params.mcpServers, _meta: params.meta });
    const t = register(String(r.sessionId));
    let modes = toModes(r.modes);
    if (defaultMode && modes && modes.current !== defaultMode && modes.available.some((m) => m.id === defaultMode)) {
      try { await req(acp.methods.agent.session.setMode, { sessionId: t.id, modeId: defaultMode }); modes = { ...modes, current: defaultMode }; }
      catch { /* keep the agent's own mode */ }
    }
    t.model.setSession({ sessionId: t.id, agentName, modes });
    t.model.setState('ready');
    return t;
  }

  async function loadThread(id: string): Promise<Live> {
    if (!supportsLoad) throw new Error('this agent cannot resume threads');
    const t = register(id);   // before the request: the replayed history routes here
    try {
      const r = await req(acp.methods.agent.session.load, { sessionId: id, cwd: params.cwd, mcpServers: params.mcpServers, _meta: params.meta });
      t.model.setSession({ sessionId: id, agentName, modes: toModes(r?.modes) });
      t.model.setState('ready');
      return t;
    } catch (err) { t.closed = true; live.delete(id); throw err; }
  }

  async function openThread(id?: string): Promise<AgentHandle> {
    assertOpen();
    const current = id !== undefined ? live.get(id) : undefined;
    const isLive = !!current && !current.closed;
    if (isLive && id === activeId) return current!.handle;
    if (id !== undefined && !isLive && !supportsLoad) throw new Error('this agent cannot resume threads');
    let t: Live;
    if (isLive) { t = current!; t.closeWhenIdle = false; }
    else t = id !== undefined ? await loadThread(id) : await newThread();   // on failure the active thread is untouched
    const prev = activeId !== undefined ? live.get(activeId) : undefined;   // read after the await: it may have changed meanwhile
    activeId = t.id;
    if (prev && !prev.closed && prev.id !== t.id) {
      if (policy === 'close' || !prev.prompting) void closeThreadInternal(prev.id);
      else prev.closeWhenIdle = true;
    }
    notifyActive(); notifyThreads();
    return t.handle;
  }

  async function closeThreadInternal(id: string): Promise<void> {
    const t = live.get(id);
    if (!t || t.closed) return;
    t.closed = true; live.delete(id); orphaned.delete(id); ignored.add(id);
    t.model.cancelPermissions(); t.model.setState('closed');
    const wasActive = activeId === id;
    if (wasActive) activeId = undefined;
    notifyThreads();
    if (wasActive) notifyActive();
    if (supportsClose && !closed) { try { await req(acp.methods.agent.session.close, { sessionId: id }); } catch { /* already gone */ } }
  }

  async function deleteThread(id: string): Promise<void> {
    assertOpen();
    if (!supportsDelete) throw new Error('this agent cannot delete threads');
    const t = live.get(id);
    if (t && !t.closed && t.prompting) throw new Error('stop the thread before deleting it');
    if (t && !t.closed) await closeThreadInternal(id);
    await req(acp.methods.agent.session.delete, { sessionId: id });
    stored = stored.filter((s) => s.id !== id);
    notifyThreads();
  }

  function listThreads(): Promise<ThreadInfo[]> {
    if (!supportsList || closed) return Promise.resolve(threads());
    if (listing) return listing;
    listing = (async () => {
      try {
        const r = await req(acp.methods.agent.session.list, { cwd: params.cwd });
        stored = ((r?.sessions ?? []) as any[]).map((s) => ({ id: String(s.sessionId), title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : undefined, updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : undefined }));
        notifyThreads();
        return threads();
      } finally { listing = undefined; }
    })();
    return listing;
  }

  function endAll(state: 'closed' | 'error', reason?: string) {
    for (const t of live.values()) { t.closed = true; t.model.setState(state, reason); }
    live.clear(); orphaned.clear(); activeId = undefined;
    notifyThreads(); notifyActive();
    for (const l of closeListeners) l(reason);
  }
  function dropped(reason: string) { if (closed) return; closed = true; endAll('error', reason); }
  function close() {
    if (closed) return;
    closed = true;
    conn.close();
    if (!params.stream.writable.locked) params.stream.writable.close().catch(() => {});
    endAll('closed');
  }

  const api: AgentConnection = {
    agentId: params.agentId,
    agentName,
    supportsThreads: supportsLoad && supportsList,
    supportsDelete,
    get threads() { return threads(); },
    get active() { return activeId !== undefined ? live.get(activeId)?.handle : undefined; },
    get closed() { return closed; },
    get autoAllowReadOnly() { return autoAllow; },
    setAutoAllowReadOnly(on) { autoAllow = on; },
    listThreads,
    openThread,
    closeThread: (id) => closeThreadInternal(id),
    deleteThread,
    onThreadsChange(l) { threadListeners.add(l); return () => threadListeners.delete(l); },
    onActiveChange(l) { activeListeners.add(l); return () => activeListeners.delete(l); },
    onClose(l) { closeListeners.add(l); return () => closeListeners.delete(l); },
    close,
  };
  return api;
}
