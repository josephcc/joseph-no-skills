// The workbench as a WebMCP page, and the chat panel that is the researcher's own local Claude Code.
//
// One connection to the webmcp-bridge daemon per tab (`connect()`), four tools on
// `document.modelContext` that read and steer the app through refs, and `<AgentChat>` in a fixed
// panel. A terminal thread that `ta.py open` handed off shows up in the daemon's handoff list; the
// banner opens it with one click, and the panel's thread list keeps it under "From your terminal".
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connect, listHandoffs, type ConnectorStatus, type HandoffInfo, type PageConnection } from 'webmcp-connector';
import { AgentChat, type AgentHandle } from 'webmcp-connector/react';
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

export function AgentPanel({ bridge, dir, openRequest, onClose, onHandle, onHandoffs }: {
  bridge: AgentBridge;
  dir: string;
  /** A thread to open when the value changes (the banner's one click). */
  openRequest?: { id: string; at: number };
  onClose: () => void;
  onHandle: (h: AgentHandle | undefined) => void;
  onHandoffs: (list: HandoffInfo[]) => void;
}) {
  const agentOptions = useMemo(() => ({ systemPromptMode: 'append' as const }), []);
  return (
    <aside className="wb-chat" aria-label="Local Claude">
      <div className="wb-chat-bar">
        <span className="wb-muted">Your local Claude Code, in this workbench. A thread handed off from the terminal continues here under the same id; <code>claude --resume &lt;id&gt;</code> takes it back.</span>
        <button className="wb-btn wb-btn-ghost" onClick={onClose} title="Close the panel (the thread is kept)">Close</button>
      </div>
      <AgentChat
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
