import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openAgent, type AgentConnection, type AgentHandle, type AgentOptions, type ThreadInfo } from '../agent.ts';
import type { PendingElicitation, PendingPermission, SessionSnapshot, ToolCallItem, TurnItem } from '../session-model.ts';
import type { ConnectorStatus, PageConnection } from '../types.ts';
import { pageToolOf, widgetInstanceOf } from '../widgets.ts';
import { ensureStyles } from './styles.ts';
import { clearWidgetState, ElicitationView, resolveWidget, sweepWidgetState, threadScope, WidgetHost, type WidgetMap } from './widgets.tsx';

export type { AgentConnection, AgentHandle, AgentOptions, ThreadInfo } from '../agent.ts';
export type { SessionSnapshot, Turn, TurnItem, ToolCallItem, PendingPermission, PendingElicitation, ElicitationResult } from '../session-model.ts';
export { pageToolOf, widgetInstanceOf, widgetInstanceOfCall, lookupWidget, type WidgetInstance, type WidgetStatus } from '../widgets.ts';
export { ElicitationView, FloatingWidgetPanel, WidgetHost, useWidgetState, widgetStateKey, threadScope, clearWidgetState, removeWidgetState, sweepWidgetState, resolveWidget, elicitationInitialValues, elicitationContent, elicitationMissing, PAGE_SCOPE, type WidgetProps, type WidgetComponent, type WidgetMap, type WidgetSpec, type WidgetPlacement, type ResolvedWidget, type FloatingWidgetPanelProps } from './widgets.tsx';

export interface AgentChatProps {
  page: PageConnection;
  agentOptions?: AgentOptions;
  title?: string;
  placeholder?: string;
  /** Reopen the last active thread of this origin after a reload (localStorage). Default true. */
  rememberSession?: boolean;
  /** Show thoughts (agent_thought_chunk) as collapsible blocks. Default true. */
  showThoughts?: boolean;
  /** Show the thread list when the agent can list and resume sessions. Default true. */
  threads?: boolean;
  /** Called with the active thread's handle on connect and on every switch, and with undefined on disconnect. */
  onHandle?: (handle: AgentHandle | undefined) => void;
  className?: string;
  /** Shown while no daemon is reachable: how to get one. Steps are inline markdown-ish text; `code` spans render as code. */
  setup?: { title?: string; steps?: string[] };
  /** Page tool name → component rendered in place of the generic tool row (plan in-chat-widgets). */
  widgets?: WidgetMap;
  /** Replace the built-in form for agent-asked questions (ACP elicitation). */
  renderElicitation?: (e: PendingElicitation) => ReactNode;
}

const EMPTY: SessionSnapshot = { state: 'connecting', turns: [], pendingPermissions: [], pendingElicitations: [], plan: [], commands: [] };

const DEFAULT_SETUP = { title: 'Local Claude is not running yet', steps: [
  'Start the local daemon on this computer; it shows up as "webmcp-bridge" in the menu bar while it runs.',
  'Or install the Claude Code plugin and run `claude` once; say yes to "start at login". After that, this chat works without a terminal.',
  'Come back here: this panel connects by itself.',
] };

export function AgentChat({ page, agentOptions, title = 'Local Claude', placeholder = 'Ask about this page, or tell Claude what to change…', rememberSession = true, showThoughts = true, threads: threadsEnabled = true, onHandle, className, setup, widgets, renderElicitation }: AgentChatProps) {
  ensureStyles();
  const [pageStatus, setPageStatus] = useState<ConnectorStatus>(page.status);
  const [conn, setConn] = useState<AgentConnection>();
  const [handle, setHandle] = useState<AgentHandle>();
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [showThreads, setShowThreads] = useState(false);
  const [switching, setSwitching] = useState<string>();          // thread id being opened, or 'new'
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [snap, setSnap] = useState<SessionSnapshot>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** The daemon closed the connection (it releases idle chats after about ten minutes): the transcript stays, the next message reconnects. */
  const [released, setReleased] = useState<string>();
  const [input, setInput] = useState('');
  const [agentId, setAgentId] = useState<string>();
  const [autoAllow, setAutoAllow] = useState(agentOptions?.autoAllowReadOnly ?? true);
  const logRef = useRef<HTMLDivElement>(null);
  const connRef = useRef<AgentConnection | undefined>(undefined);
  const onHandleRef = useRef(onHandle);
  onHandleRef.current = onHandle;
  const mountedRef = useRef(true);
  const agents = pageStatus.agents ?? [];
  const chosenAgent = agentId ?? agentOptions?.agent ?? agents.find((a) => a.default)?.id ?? 'claude';
  const commandMatches = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const q = input.slice(1).toLowerCase();
    return snap.commands.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8);
  }, [input, snap.commands]);
  /** Last active thread per origin (and per agent other than Claude, so ids never cross agents). */
  const storageKeyFor = useCallback((agent: string) => `webmcp-connector:session:${location.origin}${agent === 'claude' ? '' : `:${agent}`}`, []);

  useEffect(() => page.onStatus(setPageStatus), [page]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [snap]);
  useEffect(() => { if (!handle) return; setSnap(handle.model.snapshot()); return handle.model.onChange(setSnap); }, [handle]);   // one subscription per handle; a lost handle keeps the last snapshot on screen
  useEffect(() => {
    if (!conn) return;
    const publish = (h: AgentHandle | undefined) => {
      setHandle(h); onHandleRef.current?.(h);
      if (h && rememberSession) localStorage.setItem(storageKeyFor(conn.agentId), h.sessionId);
    };
    setThreads(conn.threads); publish(conn.active);
    const offThreads = conn.onThreadsChange(setThreads);
    const offActive = conn.onActiveChange(publish);
    const offClose = conn.onClose((reason) => {
      if (!mountedRef.current || !reason) return;   // no reason: our own disconnect()
      if (connRef.current === conn) connRef.current = undefined;
      setConn(undefined); setHandle(undefined); setThreads([]); setShowThreads(false); setSwitching(undefined);
      setReleased(reason); onHandleRef.current?.(undefined);
    });
    return () => { offThreads(); offActive(); offClose(); };
  }, [conn, rememberSession, storageKeyFor]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; connRef.current?.close(); connRef.current = undefined; }; }, []);   // unmount: close the ACP connection so the agent process can stop
  useEffect(() => {
    if (!showThreads) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setShowThreads(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showThreads]);

  const connect = useCallback(async (resume = true) => {
    setBusy(true); setError(undefined); setReleased(undefined);
    let c: AgentConnection | undefined;
    try {
      c = await openAgent(page, { ...agentOptions, agent: chosenAgent, autoAllowReadOnly: autoAllow });
      if (!mountedRef.current) { c.close(); return; }   // unmounted while connecting: do not publish or keep the connection
      connRef.current?.close(); connRef.current = c; setConn(c);
      const key = storageKeyFor(chosenAgent);
      const stored = resume && rememberSession ? localStorage.getItem(key) : null;
      if (stored && c.supportsThreads) {
        try { await c.openThread(stored); }
        catch { localStorage.removeItem(key); await c.openThread(); }
      } else await c.openThread();
      const agentId = c.agentId;
      if (c.supportsThreads) void c.listThreads().then((list) => sweepWidgetState(location.origin, agentId, list.map((t) => t.id))).catch(() => {});
    } catch (e) {
      if (!mountedRef.current) { c?.close(); return; }
      setError(String((e as Error)?.message ?? e));
      if (c && !c.active) { c.close(); if (connRef.current === c) { connRef.current = undefined; setConn(undefined); } }
    } finally { if (mountedRef.current) setBusy(false); }
  }, [page, agentOptions, rememberSession, storageKeyFor, chosenAgent, autoAllow]);

  const disconnect = useCallback(() => {
    connRef.current?.close(); connRef.current = undefined;
    setConn(undefined); setHandle(undefined); setThreads([]); setShowThreads(false); setSnap(EMPTY);
    onHandleRef.current?.(undefined);
  }, []);

  const openThread = useCallback(async (id?: string) => {
    const c = connRef.current; if (!c) return;
    setSwitching(id ?? 'new'); setError(undefined); setConfirmDelete(undefined);
    try { await c.openThread(id); if (id) setShowThreads(false); }
    catch (e) {
      if (mountedRef.current) setError(String((e as Error)?.message ?? e));
      if (!c.active && !c.closed) { try { await c.openThread(); } catch { /* reported above */ } }
    } finally { if (mountedRef.current) setSwitching(undefined); }
  }, []);

  const deleteThread = useCallback(async (id: string) => {
    const c = connRef.current; if (!c) return;
    setConfirmDelete(undefined);
    try { await c.deleteThread(id); clearWidgetState(location.origin, threadScope(c.agentId, id)); if (!c.active && !c.closed) await c.openThread(); }
    catch (e) { if (mountedRef.current) setError(String((e as Error)?.message ?? e)); }
  }, []);

  const toggleThreads = useCallback(() => {
    const next = !showThreads;
    setShowThreads(next); setConfirmDelete(undefined);
    if (next) void connRef.current?.listThreads().catch(() => {});
  }, [showThreads]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || switching || busy) return;
    let h = handle;
    if (!h) {
      if (!released) return;
      await connect(true);   // the daemon released the idle chat: come back into the same thread, then send
      h = connRef.current?.active;
      if (!h) return;
    } else if (snap.state === 'prompting') return;
    setInput('');
    await h.prompt(text).catch(() => { /* surfaced through the model */ });
  }, [input, handle, snap.state, switching, busy, released, connect]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && commandMatches.length > 0) { e.preventDefault(); setInput(`/${commandMatches[0]!.name} `); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  /** What widgets send with: refused while the thread is mid-turn (chips are disabled then anyway). */
  const widgetPrompt = useCallback((text: string) => {
    if (!handle) return Promise.reject(new Error('no thread'));
    if (handle.model.snapshot().state === 'prompting') return Promise.reject(new Error('the thread is busy'));
    return handle.prompt(text);
  }, [handle]);

  const connected = pageStatus.state === 'connected';
  const state = handle ? snap.state : conn ? 'connecting' : released ? 'released' : connected ? 'idle' : pageStatus.state;
  const canType = !switching && !busy && (handle ? snap.state !== 'prompting' : !!released && connected);
  const threadsOn = !!conn && conn.supportsThreads && threadsEnabled;

  return (
    <section className={`wmc-chat${className ? ` ${className}` : ''}`} data-state={state}>
      <header className="wmc-head">
        <div className="wmc-head-row">
          <h3 title={snap.title ?? title}>{title}</h3>
          <span className="wmc-badge" data-state={state}>{switching ? 'loading' : state}</span>
        </div>
        <div className="wmc-head-row wmc-controls">
        {snap.modes && snap.modes.available.length > 0 && handle && (
          <select value={snap.modes.current ?? ''} onChange={(e) => void handle.setMode(e.target.value)} title="Permission mode" data-role="mode">
            {snap.modes.available.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {handle && (
          <label className="wmc-toggle" title="Approve the page's read-only tools without asking">
            <input type="checkbox" checked={autoAllow} onChange={(e) => { setAutoAllow(e.target.checked); handle.setAutoAllowReadOnly(e.target.checked); }} /> auto-allow read-only tools
          </label>
        )}
        {!conn && agents.length > 1 && (
          <select value={chosenAgent} onChange={(e) => setAgentId(e.target.value)} title="Agent" data-role="agent-picker">
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {handle && snap.state === 'prompting' && <button onClick={() => void handle.cancel()}>Stop</button>}
        {threadsOn && <button onClick={toggleThreads} aria-expanded={showThreads} title="Threads of this page" data-role="threads-toggle">Threads{threads.length ? ` (${threads.length})` : ''} ▾</button>}
        {conn && <button onClick={() => void openThread()} disabled={!!switching} title="Start a new thread" data-role="new-thread">New</button>}
        {conn ? <button onClick={disconnect}>Disconnect</button>
          : <button className="wmc-primary" disabled={!connected || busy} onClick={() => void connect()}>{busy ? 'Connecting…' : released ? 'Reconnect' : 'Connect to local Claude'}</button>}
        </div>
      </header>
      {error && <div className="wmc-error">{error}</div>}
      {released && !conn && !busy && <div className="wmc-notice" data-role="released">The connection to local Claude closed (idle chats are released after about ten minutes). Send a message to continue this thread, or <button type="button" data-role="reconnect" onClick={() => void connect()}>reconnect</button> now.</div>}
      {!connected && !conn && <SetupView state={pageStatus.state} setup={setup} />}
      {threadsOn && showThreads && (
        <ThreadList threads={threads} switching={switching} confirmDelete={confirmDelete} canDelete={conn.supportsDelete}
          onOpen={(id) => void openThread(id)} onNew={() => void openThread()} onRefresh={() => void conn.listThreads().catch(() => {})}
          onAskDelete={setConfirmDelete} onDelete={(id) => void deleteThread(id)} />
      )}
      <div className="wmc-log" ref={logRef}>
        {snap.turns.length === 0 && <div className="wmc-empty">{handle ? 'Session ready. Claude can see this page\'s tools and current state.' : conn ? 'Opening a thread…' : 'Connect to start a chat with your local Claude about this page.'}</div>}
        {snap.turns.map((t, i) => (
          <TurnView key={t.id} items={t.items} stopReason={t.stopReason} showThoughts={showThoughts} widgets={widgets} page={page} handle={handle} live={snap.state === 'prompting'} prompt={widgetPrompt} isLatest={i === snap.turns.length - 1} />
        ))}
        {snap.pendingPermissions.map((p) => <PermissionView key={p.id} p={p} />)}
        {snap.pendingElicitations.map((e) => (renderElicitation ? <div key={e.id}>{renderElicitation(e)}</div> : <ElicitationView key={e.id} e={e} />))}
        {snap.plan.length > 0 && (
          <div className="wmc-plan"><strong>Plan</strong><ul>{snap.plan.map((e, i) => <li key={i} data-status={e.status}>{e.content}</li>)}</ul></div>
        )}
      </div>
      {commandMatches.length > 0 && handle && (
        <ul className="wmc-commands" role="listbox">
          {commandMatches.map((c) => (
            <li key={c.name} role="option" onMouseDown={(e) => { e.preventDefault(); setInput(`/${c.name} `); }}>
              <code>/{c.name}</code>{c.description ? <span>{c.description}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <div className="wmc-input">
        <textarea value={input} placeholder={placeholder} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} disabled={!canType} rows={1} />
        <button className="wmc-primary" disabled={!canType || !input.trim()} onClick={() => void send()}>Send</button>
      </div>
      <div className="wmc-foot">
        {snap.sessionId && <span title={`Thread ${snap.sessionId}`}>{snap.title ? `thread: ${snap.title}` : `session ${snap.sessionId.slice(0, 6)}`}</span>}
        {snap.agentName && <span title={snap.agentName}>{snap.agentName.replace(/^@[^/]+\//, '')}</span>}
        {handle && handle.agentId !== 'claude' && <span>agent: {handle.agentId}</span>}
        {snap.commands.length > 0 && <span title="Type / in the box to pick one">{snap.commands.length} commands</span>}
        {snap.usage?.used !== undefined && <span>{formatK(snap.usage.used)}{snap.usage.size ? `/${formatK(snap.usage.size)}` : ''} ctx</span>}
        {snap.usage?.cost && <span>{snap.usage.cost.amount.toFixed(3)} {snap.usage.cost.currency}</span>}
        {pageStatus.mcpUrl && <a href={new URL('/', pageStatus.mcpUrl).href} target="_blank" rel="noreferrer" title="Daemon status page">daemon</a>}
      </div>
    </section>
  );
}

function ThreadList({ threads, switching, confirmDelete, canDelete, onOpen, onNew, onRefresh, onAskDelete, onDelete }: {
  threads: ThreadInfo[]; switching?: string; confirmDelete?: string; canDelete: boolean;
  onOpen: (id: string) => void; onNew: () => void; onRefresh: () => void; onAskDelete: (id: string | undefined) => void; onDelete: (id: string) => void;
}) {
  return (
    <div className="wmc-threads" data-role="threads">
      <div className="wmc-threads-head">
        <button onClick={onNew} disabled={!!switching}>New thread</button>
        <button onClick={onRefresh} title="Reload the list">Refresh</button>
        <span>{threads.length === 0 ? 'no threads yet' : `${threads.length} thread${threads.length === 1 ? '' : 's'}`}</span>
      </div>
      <ul>
        {threads.map((t) => (
          <li key={t.id} className="wmc-thread" data-active={t.active} data-state={t.state} data-id={t.id}>
            <button className="wmc-thread-open" onClick={() => onOpen(t.id)} disabled={!!switching || t.active} title={t.id}>
              <span className="wmc-thread-title">{threadLabel(t)}</span>
              <span className="wmc-thread-meta">{switching === t.id ? 'loading…' : stateLabel(t) ?? formatAgo(t.updatedAt)}</span>
            </button>
            {canDelete && (confirmDelete === t.id
              ? <span className="wmc-thread-confirm">Delete? <button onClick={() => onDelete(t.id)} data-role="delete-yes">yes</button><button onClick={() => onAskDelete(undefined)}>no</button></span>
              : <button className="wmc-thread-del" title="Delete thread" aria-label="Delete thread" disabled={t.state === 'prompting' || t.state === 'needs-permission'} onClick={() => onAskDelete(t.id)}>×</button>)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function threadLabel(t: ThreadInfo): string { return t.title ?? (t.state === 'stored' ? `thread ${t.id.slice(0, 6)}` : 'New thread'); }
function stateLabel(t: ThreadInfo): string | undefined { return t.state === 'prompting' ? 'running…' : t.state === 'needs-permission' ? 'needs approval' : undefined; }
function formatAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

function SetupView({ state, setup }: { state: ConnectorStatus['state']; setup?: AgentChatProps['setup'] }) {
  if (state === 'needs-approval') return <div className="wmc-setup"><strong>Approve this page.</strong> The local daemon opened a tab asking whether this page may use your Claude; allow it there and this panel connects by itself.</div>;
  if (state === 'denied') return <div className="wmc-setup"><strong>This page was denied.</strong> Allow it from the daemon's approval page (or its state folder) and reconnect.</div>;
  if (state === 'searching' || state === 'idle') return <div className="wmc-setup">Looking for the local daemon…</div>;
  const s = { ...DEFAULT_SETUP, ...(setup ?? {}) };
  return (
    <div className="wmc-setup">
      <strong>{s.title}</strong>
      <ol>{s.steps.map((step, i) => <li key={i}>{renderCode(step)}</li>)}</ol>
      <div className="wmc-setup-note">One-time setup. The chat you want is this one, in the page; a terminal Claude session is only needed to install.</div>
    </div>
  );
}
function renderCode(text: string) {
  return text.split(/(`[^`]+`)/g).map((part, i) => (part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>));
}

function TurnView({ items, stopReason, showThoughts, widgets, page, handle, live, prompt, isLatest }: {
  items: TurnItem[]; stopReason?: string; showThoughts: boolean; widgets?: WidgetMap; page: PageConnection; handle?: AgentHandle; live: boolean; prompt: (text: string) => Promise<{ stopReason: string }>; isLatest: boolean;
}) {
  const trailing: ReactNode[] = [];   // widgets placed at the end of the turn (suggested replies), in call order
  const widgetFor = (item: ToolCallItem) => {
    const tool = widgets ? pageToolOf(item) : undefined;
    const w = tool !== undefined ? resolveWidget(widgets, tool) : undefined;
    if (!w || !handle) return undefined;
    const instance = widgetInstanceOf(item, { sessionId: handle.sessionId });
    return <WidgetHost key={item.toolCallId} Component={w.Component} instance={instance} origin={location.origin} scope={threadScope(handle.agentId, handle.sessionId)} live={live} prompt={prompt} thread={handle}
      note={(text) => page.activity.note(text, { tool: instance.tool, id: instance.id })} raw={toolBody(item)} />;
  };
  return (<>
    {items.map((item, i) => {
      if (item.kind === 'text') return item.role === 'user'
        ? <div key={i} className="wmc-msg user">{item.text}</div>
        : <div key={i} className="wmc-msg agent"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown></div>;
      if (item.kind === 'thought') return showThoughts ? <details key={i} className="wmc-thought"><summary>Thinking…</summary>{item.text}</details> : null;
      const tool = widgets ? pageToolOf(item) : undefined;
      const w = tool !== undefined ? resolveWidget(widgets, tool) : undefined;
      if (w && handle) {
        if (w.latestOnly && !isLatest) return null;             // its moment has passed
        const el = widgetFor(item);
        if (w.placement === 'end') { trailing.push(el); return null; }
        return el;
      }
      return <ToolCallView key={item.toolCallId} item={item} />;
    })}
    {trailing}
    {stopReason && stopReason !== 'end_turn' && <div className="wmc-stop">stopped: {stopReason}</div>}
  </>);
}

/** The generic row's text: input, content blocks, output. */
function toolBody(item: ToolCallItem): string {
  const parts: string[] = [];
  if (item.rawInput !== undefined) parts.push(`input: ${pretty(item.rawInput)}`);
  for (const c of item.content as Array<Record<string, unknown>>) {
    if (c.type === 'content' && (c.content as { type?: string; text?: string })?.type === 'text') parts.push(String((c.content as { text?: string }).text));
    else if (c.type === 'diff') parts.push(`diff ${String(c.path)}\n${String(c.newText ?? '')}`);
    else if (c.type === 'terminal') parts.push(`terminal ${String(c.terminalId)}`);
  }
  if (item.rawOutput !== undefined) parts.push(`output: ${pretty(item.rawOutput)}`);
  return parts.join('\n\n');
}

function ToolCallView({ item }: { item: ToolCallItem }) {
  const body = useMemo(() => toolBody(item), [item]);
  return (
    <details className="wmc-tool" data-status={item.status}>
      <summary><span className="wmc-title" title={item.title}>{item.title}</span>{item.toolKind && item.toolKind !== 'other' && <span className="wmc-kind">{item.toolKind}</span>}<span className="wmc-status">{item.status}</span></summary>
      {body && <pre>{body}</pre>}
    </details>
  );
}

function PermissionView({ p }: { p: PendingPermission }) {
  return (
    <div className="wmc-perm" role="alertdialog" aria-label="Permission request">
      <div className="wmc-perm-title">Claude wants to run: {p.title}</div>
      {p.rawInput !== undefined && <pre>{pretty(p.rawInput)}</pre>}
      <div className="wmc-perm-actions">
        {p.options.map((o) => <button key={o.optionId} className={o.kind.startsWith('allow') ? 'wmc-primary' : ''} data-kind={o.kind} onClick={() => p.respond(o.optionId)}>{o.name}</button>)}
      </div>
    </div>
  );
}

function pretty(v: unknown): string { try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { return String(v); } }
function formatK(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
