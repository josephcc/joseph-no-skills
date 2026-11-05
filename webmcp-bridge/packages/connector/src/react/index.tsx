import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { connectAgent, type AgentHandle, type AgentOptions } from '../agent.ts';
import type { PendingPermission, SessionSnapshot, ToolCallItem, TurnItem } from '../session-model.ts';
import type { ConnectorStatus, PageConnection } from '../types.ts';
import { ensureStyles } from './styles.ts';

export type { AgentHandle, AgentOptions } from '../agent.ts';
export type { SessionSnapshot, Turn, TurnItem, ToolCallItem, PendingPermission } from '../session-model.ts';

export interface AgentChatProps {
  page: PageConnection;
  agentOptions?: AgentOptions;
  title?: string;
  placeholder?: string;
  /** Resume the last session of this origin from localStorage. Default true. */
  rememberSession?: boolean;
  /** Show thoughts (agent_thought_chunk) as collapsible blocks. Default true. */
  showThoughts?: boolean;
  onHandle?: (handle: AgentHandle | undefined) => void;
  className?: string;
}

const EMPTY: SessionSnapshot = { state: 'connecting', turns: [], pendingPermissions: [], plan: [], commands: [] };

export function AgentChat({ page, agentOptions, title = 'Local Claude', placeholder = 'Ask about this page, or tell Claude what to change…', rememberSession = true, showThoughts = true, onHandle, className }: AgentChatProps) {
  ensureStyles();
  const [pageStatus, setPageStatus] = useState<ConnectorStatus>(page.status);
  const [handle, setHandle] = useState<AgentHandle>();
  const [snap, setSnap] = useState<SessionSnapshot>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [input, setInput] = useState('');
  const [agentId, setAgentId] = useState<string>();
  const [autoAllow, setAutoAllow] = useState(agentOptions?.autoAllowReadOnly ?? true);
  const logRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<AgentHandle | undefined>(undefined);
  const mountedRef = useRef(true);
  const agents = pageStatus.agents ?? [];
  const chosenAgent = agentId ?? agentOptions?.agent ?? agents.find((a) => a.default)?.id ?? 'claude';
  const commandMatches = useMemo(() => {
    if (!input.startsWith('/') || input.includes(' ')) return [];
    const q = input.slice(1).toLowerCase();
    return snap.commands.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8);
  }, [input, snap.commands]);
  const storageKey = useMemo(() => `webmcp-connector:session:${location.origin}`, []);

  useEffect(() => page.onStatus(setPageStatus), [page]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [snap]);
  useEffect(() => { if (!handle) return; setSnap(handle.model.snapshot()); return handle.model.onChange(setSnap); }, [handle]);   // one subscription per handle
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; handleRef.current?.close(); handleRef.current = undefined; }; }, []);   // unmount: close the ACP session so the agent process can stop

  const connect = useCallback(async (resume = true) => {
    setBusy(true); setError(undefined);
    try {
      const resumeSessionId = resume && rememberSession ? localStorage.getItem(storageKey) ?? undefined : undefined;
      const h = await connectAgent(page, { ...agentOptions, agent: chosenAgent, autoAllowReadOnly: autoAllow, resumeSessionId: chosenAgent === 'claude' ? resumeSessionId : undefined });
      if (!mountedRef.current) { h.close(); return; }   // unmounted while connecting: do not publish or keep the session
      if (rememberSession) localStorage.setItem(storageKey, h.sessionId);
      handleRef.current?.close(); handleRef.current = h; setHandle(h); onHandle?.(h);
    } catch (e) { if (mountedRef.current) setError(String((e as Error)?.message ?? e)); }
    finally { if (mountedRef.current) setBusy(false); }
  }, [page, agentOptions, rememberSession, storageKey, onHandle, chosenAgent, autoAllow]);

  const disconnect = useCallback(() => { handle?.close(); handleRef.current = undefined; setHandle(undefined); setSnap(EMPTY); onHandle?.(undefined); }, [handle, onHandle]);
  const newSession = useCallback(async () => { handle?.close(); handleRef.current = undefined; localStorage.removeItem(storageKey); setHandle(undefined); setSnap(EMPTY); await connect(false); }, [handle, storageKey, connect]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !handle || snap.state === 'prompting') return;
    setInput('');
    await handle.prompt(text).catch(() => { /* surfaced through the model */ });
  }, [input, handle, snap.state]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && commandMatches.length > 0) { e.preventDefault(); setInput(`/${commandMatches[0]!.name} `); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const connected = pageStatus.state === 'connected';
  const state = handle ? snap.state : connected ? 'idle' : pageStatus.state;

  return (
    <section className={`wmc-chat${className ? ` ${className}` : ''}`} data-state={state}>
      <header className="wmc-head">
        <h3>{title}{snap.title ? ` — ${snap.title}` : ''}</h3>
        <span className="wmc-badge" data-state={state}>{state}</span>
        {snap.modes && snap.modes.available.length > 0 && handle && (
          <select value={snap.modes.current ?? ''} onChange={(e) => void handle.setMode(e.target.value)} title="Permission mode">
            {snap.modes.available.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {handle && (
          <label className="wmc-toggle" title="Approve the page's read-only tools without asking">
            <input type="checkbox" checked={autoAllow} onChange={(e) => { setAutoAllow(e.target.checked); handle.setAutoAllowReadOnly(e.target.checked); }} /> auto-allow read-only
          </label>
        )}
        {!handle && agents.length > 1 && (
          <select value={chosenAgent} onChange={(e) => setAgentId(e.target.value)} title="Agent" data-role="agent-picker">
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {handle && snap.state === 'prompting' && <button onClick={() => void handle.cancel()}>Stop</button>}
        {handle && <button onClick={() => void newSession()} title="Start a fresh session">New</button>}
        {handle ? <button onClick={disconnect}>Disconnect</button>
          : <button className="wmc-primary" disabled={!connected || busy} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Connect to local Claude'}</button>}
      </header>
      {error && <div className="wmc-error">{error}</div>}
      {!connected && !handle && <div className="wmc-error">The page is not connected to the local daemon ({pageStatus.state}).</div>}
      <div className="wmc-log" ref={logRef}>
        {snap.turns.length === 0 && <div className="wmc-empty">{handle ? 'Session ready. Claude can see this page\'s tools and current state.' : 'Connect to start a chat with your local Claude about this page.'}</div>}
        {snap.turns.map((t) => (
          <TurnView key={t.id} items={t.items} stopReason={t.stopReason} showThoughts={showThoughts} />
        ))}
        {snap.pendingPermissions.map((p) => <PermissionView key={p.id} p={p} />)}
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
        <textarea value={input} placeholder={placeholder} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} disabled={!handle || snap.state === 'prompting'} rows={1} />
        <button className="wmc-primary" disabled={!handle || snap.state === 'prompting' || !input.trim()} onClick={() => void send()}>Send</button>
      </div>
      <div className="wmc-foot">
        {snap.sessionId && <span>session {snap.sessionId.slice(0, 8)}</span>}
        {snap.agentName && <span>{snap.agentName}</span>}
        {handle && handle.agentId !== 'claude' && <span>agent: {handle.agentId}</span>}
        {snap.commands.length > 0 && <span>type / for {snap.commands.length} commands</span>}
        {snap.usage?.used !== undefined && <span>context {formatK(snap.usage.used)}{snap.usage.size ? ` / ${formatK(snap.usage.size)}` : ''}</span>}
        {snap.usage?.cost && <span>{snap.usage.cost.amount.toFixed(3)} {snap.usage.cost.currency}</span>}
      </div>
    </section>
  );
}

function TurnView({ items, stopReason, showThoughts }: { items: TurnItem[]; stopReason?: string; showThoughts: boolean }) {
  return (<>
    {items.map((item, i) => {
      if (item.kind === 'text') return item.role === 'user'
        ? <div key={i} className="wmc-msg user">{item.text}</div>
        : <div key={i} className="wmc-msg agent"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown></div>;
      if (item.kind === 'thought') return showThoughts ? <details key={i} className="wmc-thought"><summary>Thinking…</summary>{item.text}</details> : null;
      return <ToolCallView key={item.toolCallId} item={item} />;
    })}
    {stopReason && stopReason !== 'end_turn' && <div className="wmc-stop">stopped: {stopReason}</div>}
  </>);
}

function ToolCallView({ item }: { item: ToolCallItem }) {
  const body = useMemo(() => {
    const parts: string[] = [];
    if (item.rawInput !== undefined) parts.push(`input: ${pretty(item.rawInput)}`);
    for (const c of item.content as Array<Record<string, unknown>>) {
      if (c.type === 'content' && (c.content as { type?: string; text?: string })?.type === 'text') parts.push(String((c.content as { text?: string }).text));
      else if (c.type === 'diff') parts.push(`diff ${String(c.path)}\n${String(c.newText ?? '')}`);
      else if (c.type === 'terminal') parts.push(`terminal ${String(c.terminalId)}`);
    }
    if (item.rawOutput !== undefined) parts.push(`output: ${pretty(item.rawOutput)}`);
    return parts.join('\n\n');
  }, [item]);
  return (
    <details className="wmc-tool" data-status={item.status}>
      <summary><span>{item.title}</span>{item.toolKind && <span className="wmc-kind">{item.toolKind}</span>}<span className="wmc-status">{item.status}</span></summary>
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
