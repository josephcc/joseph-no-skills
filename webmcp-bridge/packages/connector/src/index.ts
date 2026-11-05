import './webmcp-global.ts';
import { DEFAULT_PORT, PROTOCOL_VERSION, type DaemonFrame, type ToolInfo, type WelcomeFrame } from './protocol.ts';
import { DaemonLink } from './link.ts';
import { callTool, debounce, listTools } from './mirror.ts';
import { hasNativeModelContext, installShim } from './shim.ts';
import type { ConnectOptions, ConnectorStatus, PageConnection, ToolCallEvent } from './types.ts';
import { CONNECTOR_VERSION } from './version.ts';

export type { ConnectOptions, ConnectorState, ConnectorStatus, PageConnection, ToolCallEvent, ToolPolicy } from './types.ts';
export { installShim, hasNativeModelContext } from './shim.ts';
export { preamble } from './preamble.ts';
export * from './protocol.ts';
export { connectAgent, openAgent, type AgentConnection, type AgentHandle, type AgentOptions, type PermissionModeId, type SwitchPolicy, type ThreadInfo, type ThreadState } from './agent.ts';
export { CONNECTOR_VERSION } from './version.ts';
export { SessionModel, type SessionSnapshot, type Turn, type TurnItem, type ToolCallItem, type PendingPermission } from './session-model.ts';

const DEFAULT_URL = `ws://127.0.0.1:${DEFAULT_PORT}`;
const APPROVAL_GRACE_MS = 1_500;
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 15_000;

/**
 * Connect this page to the local webmcp-daemon: mirrors the page's WebMCP tools,
 * answers context requests, and executes tool calls on the daemon's behalf.
 */
export function connect(options: ConnectOptions = {}): PageConnection {
  const mc: ModelContext = (document as Document).modelContext ?? (options.shim === false ? undefined : installShim())!;
  if (!mc) throw new Error('webmcp-connector: document.modelContext is unavailable and the shim is disabled');
  const usingShim = !hasNativeModelContext();
  const base = (options.daemonUrl ?? DEFAULT_URL).replace(/\/+$/, '');
  const link = new DaemonLink(`${base}/ws?title=${encodeURIComponent(options.title ?? document.title)}`);
  const minRetry = options.retry?.minMs ?? MIN_RETRY_MS;
  const maxRetry = options.retry?.maxMs ?? MAX_RETRY_MS;

  const status: ConnectorStatus = { state: 'idle', attempts: 0, toolCount: 0 };
  const listeners = new Set<(s: ConnectorStatus) => void>();
  if (options.onStatus) listeners.add(options.onStatus);
  let instructions = options.instructions;
  let instructionsSummary = options.instructionsSummary;
  let wantConnected = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let approvalTimer: ReturnType<typeof setTimeout> | undefined;
  let backoff = minRetry;
  const inflight = new Map<string, AbortController>();

  const emit = (patch: Partial<ConnectorStatus>) => {
    Object.assign(status, patch);
    for (const l of listeners) l({ ...status });
  };

  const pushTools = async (): Promise<ToolInfo[]> => {
    const tools = await listTools(mc);
    emit({ toolCount: tools.length });
    link.send({ type: 'tools', tools });
    return tools;
  };
  const pushToolsDebounced = debounce(() => { void pushTools(); }, 100);
  mc.addEventListener('toolchange', pushToolsDebounced);
  document.addEventListener('visibilitychange', () => link.send({ type: 'visibility', visible: document.visibilityState === 'visible' }));

  link.on('open', () => {
    clearTimeout(approvalTimer);
    backoff = minRetry;
    link.send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      origin: location.origin,
      url: location.href,
      title: options.title ?? document.title,
      instructions,
      instructionsSummary,
      hasContext: typeof options.context === 'function',
      client: `webmcp-connector/${CONNECTOR_VERSION}`,
    });
  });

  link.on('frame', (frame: DaemonFrame) => {
    switch (frame.type) {
      case 'welcome': onWelcome(frame); break;
      case 'call': void onCall(frame); break;
      case 'cancel': inflight.get(frame.callId)?.abort(); break;
      case 'context/request': void onContextRequest(frame.requestId); break;
      case 'error': emit({ lastError: frame.message }); break;
    }
  });

  link.on('close', ({ code, reason, openedBefore }) => {
    clearTimeout(approvalTimer);
    for (const c of inflight.values()) c.abort();
    inflight.clear();
    if (!wantConnected) { emit({ state: 'idle' }); return; }
    if (code === 4403 || reason === 'origin-denied') {
      wantConnected = false;
      emit({ state: 'denied', lastError: 'the daemon denied this origin' });
      return;
    }
    const next = openedBefore ? 'searching' : 'absent';
    emit({ state: next, lastError: openedBefore ? `connection closed (${code})` : 'no daemon listening' });
    scheduleRetry();
  });

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (wantConnected) attempt(); }, backoff);
    backoff = Math.min(backoff * 2, maxRetry);
  }

  function attempt() {
    emit({ state: 'searching', attempts: status.attempts + 1 });
    link.open();
    // If the socket neither opens nor closes promptly, the daemon is holding the upgrade for approval.
    clearTimeout(approvalTimer);
    approvalTimer = setTimeout(() => { if (!link.isOpen && wantConnected) emit({ state: 'needs-approval' }); }, APPROVAL_GRACE_MS);
  }

  function onWelcome(frame: WelcomeFrame) {
    emit({ state: 'connected', pageId: frame.pageId, workspaceDir: frame.workspaceDir, mcpUrl: frame.mcpUrl, acpUrl: frame.acpUrl, daemonVersion: frame.daemonVersion, agents: frame.agents, lastError: undefined });
    void pushTools();
    link.send({ type: 'visibility', visible: document.visibilityState === 'visible' });
  }

  async function onCall(frame: Extract<DaemonFrame, { type: 'call' }>) {
    const controller = new AbortController();
    inflight.set(frame.callId, controller);
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), frame.timeoutMs);
    const started = performance.now();
    options.onToolCall?.({ callId: frame.callId, name: frame.name, args: frame.args, phase: 'start' });
    try {
      const result = await callTool(mc, frame.name, frame.args ?? {}, controller.signal);
      link.send({ type: 'call/result', callId: frame.callId, ok: true, result });
      options.onToolCall?.({ callId: frame.callId, name: frame.name, args: frame.args, phase: 'end', ok: true, result, durationMs: performance.now() - started });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      const error = { name: e?.name ?? 'Error', message: e?.message ?? String(err) };
      link.send({ type: 'call/result', callId: frame.callId, ok: false, error });
      options.onToolCall?.({ callId: frame.callId, name: frame.name, args: frame.args, phase: 'end', ok: false, error: `${error.name}: ${error.message}`, durationMs: performance.now() - started });
    } finally {
      clearTimeout(timer);
      inflight.delete(frame.callId);
    }
  }

  async function onContextRequest(requestId: string) {
    if (!options.context) { link.send({ type: 'context/result', requestId, error: 'page has no context()' }); return; }
    try {
      const text = await options.context();
      link.send({ type: 'context/result', requestId, text: String(text ?? '') });
    } catch (err) {
      link.send({ type: 'context/result', requestId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const connection: PageConnection = {
    get status() { return { ...status }; },
    get settings() { return { instructions, instructionsSummary, context: options.context, toolPolicy: options.toolPolicy, title: options.title }; },
    modelContext: mc,
    usingShim,
    connect() {
      if (wantConnected && (link.isOpen || status.state === 'searching')) return;
      wantConnected = true;
      backoff = minRetry;
      attempt();
    },
    disconnect() {
      wantConnected = false;
      clearTimeout(retryTimer);
      clearTimeout(approvalTimer);
      link.close();
      emit({ state: 'idle', pageId: undefined });
    },
    onStatus(listener) {
      listeners.add(listener);
      listener({ ...status });
      return () => listeners.delete(listener);
    },
    refreshTools: pushTools,
    setInstructions(next, summary) {
      instructions = next;
      instructionsSummary = summary;
      link.send({ type: 'instructions', instructions, instructionsSummary });
    },
  };

  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (options.autoConnect ?? isLocal) connection.connect();
  return connection;
}
