// The workbench as a WebMCP page, and the chat panel that is the researcher's own local Claude Code.
//
// One connection to the webmcp-bridge daemon per tab (`connect()`), four tools on
// `document.modelContext` that read and steer the app through refs, and `<AgentChat>` in a fixed
// panel. A terminal thread that `ta.py open` handed off shows up in the daemon's handoff list; the
// banner opens it with one click, and the panel's thread list keeps it under "From your terminal".
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { connect, listHandoffs, type ConnectorStatus, type HandoffInfo, type PageConnection } from 'webmcp-connector';
import { AgentChat, type AgentChatHeaderContext, type AgentHandle } from 'webmcp-connector/react';
import { formatContext, instructionsFor, loopbackDaemonUrl, navigationPatch, plainName, summaryFor, type PendingRow, type WorkbenchState } from './agent';

export interface AgentActions {
  navigate: (patch: { view?: string; t?: string | null; e?: string | null; c?: string | null; th?: string | null; cmp?: string | null }) => void;
  openDrawer: (open: boolean) => void;
  pendingRows: () => PendingRow[];
}

export interface AgentBridge {
  page: PageConnection;
  status: ConnectorStatus;
  /** Terminal sessions the daemon lists for this page, newest first. */
  handoffs: HandoffInfo[];
  setHandoffs: (list: HandoffInfo[]) => void;
  refreshHandoffs: () => void;
}

const SCHEMA_STATE = { type: 'object', properties: {}, additionalProperties: false };

/**
 * Connects the tab to the daemon once per analysis folder and registers the page tools. `latest()` and
 * `actions` are read through refs at call time, so a tool always sees the current view and selection.
 */
export function useAgentPage(dir: string | null, latest: () => WorkbenchState, actions: AgentActions): AgentBridge | null {
  const latestRef = useRef(latest); latestRef.current = latest;
  const actionsRef = useRef(actions); actionsRef.current = actions;
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffInfo[]>([]);
  const pageRef = useRef<PageConnection | null>(null);
  const [page, setPage] = useState<PageConnection | null>(null);

  useEffect(() => {
    if (!dir) return;
    const study = latestRef.current().study;
    // `?daemon=ws://127.0.0.1:8731` pins a daemon (a private one while developing); default: the port sweep.
    // Loopback only: a crafted link must not hand the page's state and chat to a remote socket.
    const pinned = loopbackDaemonUrl(new URLSearchParams(window.location.search).get('daemon'));
    const p = connect({
      ...(pinned ? { daemonUrl: pinned } : {}),
      title: `Thematic analysis · ${plainName(study, 60) || dir.split('/').filter(Boolean).slice(-2).join('/')}`,
      instructions: instructionsFor(dir, study),
      instructionsSummary: summaryFor(dir, study),
      context: () => formatContext(latestRef.current()),
      onStatus: setStatus,
    });
    pageRef.current = p; setPage(p);
    const ac = new AbortController();
    const mc = p.modelContext;
    const state = () => latestRef.current();
    void mc.registerTool({ name: 'get_state', description: 'What the researcher is looking at in the thematic-analysis workbench: the analysis folder, the view and selection, the codebook version, the inbox counts, and which page tools exist. Same text as the snapshot attached to each prompt, as JSON.', inputSchema: SCHEMA_STATE, annotations: { readOnlyHint: true }, execute: () => state() }, { signal: ac.signal });
    void mc.registerTool({ name: 'list_pending', description: 'The inbox rows waiting for the agent: its own proposals the researcher left standing, lines the researcher staged, and the open comment threads (id, by, op, target, note, status, view).', inputSchema: SCHEMA_STATE, annotations: { readOnlyHint: true }, execute: () => ({ pending: actionsRef.current.pendingRows() }) }, { signal: ac.signal });
    void mc.registerTool({
      name: 'navigate',
      description: 'Open a view and selection for the researcher: view (transcript | codebook | coverage | themes | quotes | study | history), t (transcript id), e (extract id), c (code id), th (theme id), cmp (second code for the compare pane). Omitted keys keep their value; null clears one. Returns the resulting state.',
      inputSchema: { type: 'object', properties: { view: { type: 'string', enum: ['transcript', 'codebook', 'coverage', 'themes', 'quotes', 'study', 'history'] }, t: { type: ['string', 'null'] }, e: { type: ['string', 'null'] }, c: { type: ['string', 'null'] }, th: { type: ['string', 'null'] }, cmp: { type: ['string', 'null'] } }, additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute: (input: unknown) => {
        // The schema is advisory for a caller that bypasses it (webmcp_call_tool, an older daemon): validate here too.
        actionsRef.current.navigate(navigationPatch(input));
        return state();
      },
    }, { signal: ac.signal });
    void mc.registerTool({ name: 'open_pending', description: 'Open or close the pending drawer (the agent proposals, staged lines and threads waiting for the agent). Returns the resulting state.', inputSchema: { type: 'object', properties: { open: { type: 'boolean' } }, required: ['open'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: (input: { open?: boolean }) => { actionsRef.current.openDrawer(!!input?.open); return state(); } }, { signal: ac.signal });
    return () => { ac.abort(); p.disconnect(); pageRef.current = null; setPage(null); setStatus(null); setHandoffs([]); };
  }, [dir]);

  // Keep the instructions in step with the study name once the bundle has loaded.
  const study = latest().study;
  useEffect(() => { const p = pageRef.current; if (p && dir) p.setInstructions(instructionsFor(dir, study), summaryFor(dir, study)); }, [dir, study]);

  const refreshHandoffs = useCallback(() => {
    const p = pageRef.current;
    if (!p || p.status.state !== 'connected' || !p.status.handoffsUrl) return;
    void listHandoffs(p).then(setHandoffs).catch(() => { /* the daemon predates handoffs, or went away */ });
  }, []);
  const connected = status?.state === 'connected';
  useEffect(() => {
    if (!connected) return;
    refreshHandoffs();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshHandoffs(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(refreshHandoffs, 30_000);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer); };
  }, [connected, refreshHandoffs]);

  return useMemo(() => (page && status ? { page, status, handoffs, setHandoffs, refreshHandoffs } : null), [page, status, handoffs, refreshHandoffs]);
}

const SETUP = {
  title: 'Local Claude is not running yet',
  steps: [
    'Install the webmcp-bridge plugin in Claude Code (`/plugin marketplace add <this repo>/webmcp-bridge`, then `/plugin install webmcp-bridge@webmcp-bridge`) and run `claude` once; its daemon shows as "webmcp-bridge" in the menu bar.',
    'The first time this page connects, the daemon opens a tab asking you to approve this origin. Say yes.',
    'Come back here: the panel connects by itself. A terminal thread that opened this workbench waits under Threads → From your terminal.',
  ],
};

export const CHAT_WIDTH_KEY = 'ta-workbench:chat-width';
const CHAT_WIDTH_DEFAULT = 440;
const CHAT_WIDTH_MIN = 320;

/** A width the panel can have: never narrower than the composer needs, never the whole window. */
export const clampChatWidth = (w: number): number => {
  const max = Math.max(CHAT_WIDTH_MIN, (typeof window === 'undefined' ? 1200 : window.innerWidth) - 240);
  return Math.round(Math.min(Math.max(CHAT_WIDTH_MIN, w), max));
};

/** The width the researcher last dragged the panel to, or the default. */
export function storedChatWidth(): number {
  try {
    const n = Number(localStorage.getItem(CHAT_WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? clampChatWidth(n) : CHAT_WIDTH_DEFAULT;
  } catch {
    return CHAT_WIDTH_DEFAULT;
  }
}

export function AgentPanel({ bridge, dir, open, width, onResize, openRequest, onClose, onHandle, onHandoffs }: {
  bridge: AgentBridge;
  dir: string;
  /** Hidden when false, but still mounted: the thread stays connected, and reopening is instant. */
  open: boolean;
  width: number;
  onResize: (w: number) => void;
  /** A thread to open when the value changes (the banner's one click). */
  openRequest?: { id: string; at: number };
  onClose: () => void;
  onHandle: (h: AgentHandle | undefined) => void;
  onHandoffs: (list: HandoffInfo[]) => void;
}) {
  const agentOptions = useMemo(() => ({ systemPromptMode: 'append' as const }), []);
  const renderHeader = useCallback((ctx: AgentChatHeaderContext) => <PanelHeader ctx={ctx} onClose={onClose} />, [onClose]);
  // The grip on the panel's left edge: the pointer is captured, so the drag survives leaving the
  // 6 px strip, and the width follows the pointer until it is released.
  const onGrip = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      const startX = e.clientX;
      const startW = width;
      const move = (ev: PointerEvent) => onResize(clampChatWidth(startW + (startX - ev.clientX)));
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      try { el.setPointerCapture(e.pointerId); } catch { /* a pointer the browser is not tracking: the strip itself still gets the moves */ }
    },
    [width, onResize],
  );
  return (
    <aside className={`wb-chat${open ? '' : ' wb-chat-hidden'}`} aria-label="Local Claude" aria-hidden={!open}>
      <div className="wb-chat-grip" onPointerDown={onGrip} title="Drag to resize" />
      <AgentChat
        renderHeader={renderHeader}
        page={bridge.page}
        agentOptions={agentOptions}
        title="Local Claude"
        placeholder="Ask about the coding, or hand the pass back: “review my feedback”…"
        sessionStorageKey={`ta-workbench:session:${dir}`}
        setup={SETUP}
        autoConnect
        openThreadRequest={openRequest}
        onHandle={onHandle}
        onHandoffs={onHandoffs}
        className="wb-chat-panel"
      />
    </aside>
  );
}

/** The panel's header, dense: one row of what matters, a slim second row for the thread's settings. Replaces the connector's. */
function PanelHeader({ ctx, onClose }: { ctx: AgentChatHeaderContext; onClose: () => void }) {
  const { state, label, connected, busy, released, error, conn, handle, snapshot, threads, threadsOn, showThreads, switching, autoAllow, handoffs, actions } = ctx;
  const count = threads.length + handoffs.length;
  return (
    <header className="wb-chat-head">
      <div className="wb-chat-head-row">
        <b title="Your local Claude Code, in this workbench. A thread handed off from the terminal continues here under the same id; claude --resume <id> takes it back.">Local Claude</b>
        <span className="wmc-badge" data-state={state}>{label}</span>
        <span className="wb-chat-head-spacer" />
        {handle && snapshot.state === 'prompting' && <button onClick={actions.cancel} title="Stop the current turn">Stop</button>}
        {threadsOn && <button onClick={actions.toggleThreads} aria-expanded={showThreads} title="Threads of this page, and terminal threads handed to it" data-role="threads-toggle">Threads{count ? ` (${count})` : ''} ▾</button>}
        {conn && <button onClick={actions.newThread} disabled={!!switching} title="Start a new thread" data-role="new-thread">New</button>}
        {!conn && <button className="wmc-primary" disabled={!connected || busy} onClick={actions.connect}>{busy ? 'Connecting…' : released ? 'Reconnect' : 'Connect'}</button>}
        <button className="wb-chat-close" onClick={onClose} title="Hide the panel; the thread stays connected and the Agent button brings it back" aria-label="Close">×</button>
      </div>
      {handle && (
        <div className="wb-chat-head-row wb-chat-head-sub">
          {snapshot.modes && snapshot.modes.available.length > 0 && (
            <select value={snapshot.modes.current ?? ''} onChange={(e) => actions.setMode(e.target.value)} title="Permission mode" data-role="mode">
              {snapshot.modes.available.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <label className="wmc-toggle" title="Approve the page's read-only tools without asking">
            <input type="checkbox" checked={autoAllow} onChange={(e) => actions.setAutoAllow(e.target.checked)} /> auto-allow read-only
          </label>
          <span className="wb-chat-head-spacer" />
          <button className="wb-chat-ghost" onClick={actions.disconnect} title="Disconnect from local Claude (the thread is kept)">Disconnect</button>
        </div>
      )}
      {error && <div className="wmc-error">{error}</div>}
    </header>
  );
}

/** The one-click way in: a terminal thread offered for this folder, and whether its terminal still holds it. */
export function HandoffBanner({ handoff, onOpen }: { handoff: HandoffInfo; onOpen: () => void }) {
  const live = handoff.live;
  return (
    <div className="wb-handoff" role="status">
      <span>
        <b>Your terminal thread is waiting</b>
        {handoff.title ? <> · {handoff.title}</> : null}
        {live ? <span className="wb-handoff-live"> · still open in your terminal{live.pid ? ` (pid ${live.pid})` : ''}: press Ctrl+D there first</span> : null}
      </span>
      <button className="wb-btn wb-btn-primary wb-tiny" onClick={onOpen} title={`${handoff.sessionId}\n${handoff.cwd}`}>Continue it here</button>
    </div>
  );
}
