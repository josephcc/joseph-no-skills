/**
 * Wire protocol between a page (via webmcp-connector) and the webmcp-bridge,
 * spoken as JSON text frames over the `/ws` WebSocket. See plans/combined/main.md §5.1.
 */
export const PROTOCOL_VERSION = 1 as const;
/**
 * The ports the daemon tries in order and every client walks in the same order
 * (plans/daemon-port-discovery/main.md D-1): the historical port first, then
 * four arbitrary ports from the dynamic range no common tool listens on.
 */
export const CANDIDATE_PORTS: readonly number[] = [8737, 49237, 52451, 55913, 61327];
export const DEFAULT_PORT = CANDIDATE_PORTS[0]!;
/** What `GET /id` answers: enough to recognise the daemon, nothing private (D-6). */
export const DAEMON_NAME = 'webmcp-bridge' as const;
export interface DaemonIdentity { daemon: typeof DAEMON_NAME; protocol: number; version: string; instance: string }
export const PING_INTERVAL_MS = 20_000;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
/** Hook-injected context is capped by Claude Code at 10,000 characters; leave headroom. */
export const MAX_INJECTED_CHARS = 9_500;

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  consequentialHint?: boolean;
  untrustedContentHint?: boolean;
  debugging?: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

export interface HelloFrame {
  type: 'hello';
  protocolVersion: typeof PROTOCOL_VERSION;
  origin: string;
  url: string;
  title: string;
  /** Full system prompt for the embedded chat (no size limit). */
  instructions?: string;
  /** Short version for terminal sessions (hook-injected, ≤ MAX_INJECTED_CHARS). */
  instructionsSummary?: string;
  /** Whether the page can answer `context/request`. */
  hasContext: boolean;
  client?: string;
}

export type PageFrame =
  | HelloFrame
  | { type: 'tools'; tools: ToolInfo[] }
  | { type: 'instructions'; instructions?: string; instructionsSummary?: string }
  | { type: 'visibility'; visible: boolean }
  | { type: 'context/result'; requestId: string; text?: string; error?: string }
  | { type: 'call/result'; callId: string; ok: true; result: string | null }
  | { type: 'call/result'; callId: string; ok: false; error: { name: string; message: string } }
  | { type: 'pong' };

export interface WelcomeFrame {
  type: 'welcome';
  pageId: string;
  daemonVersion: string;
  /** Absolute path of the per-origin workspace the daemon prepared (session cwd for ACP). */
  workspaceDir: string;
  /** Streamable HTTP MCP endpoint serving only this page's tools. */
  mcpUrl: string;
  /** GET endpoint returning this page's latest context snapshot. */
  stateUrl: string;
  /** ACP endpoint for the embedded chat. */
  acpUrl: string;
  /** Agents the chat may select (`?agent=<id>` on acpUrl). */
  agents?: Array<{ id: string; name: string; default: boolean }>;
  /** GET endpoint listing the terminal sessions offered to this page (plans/terminal-handoff); absent on older daemons. */
  handoffsUrl?: string;
}

export type DaemonFrame =
  | WelcomeFrame
  | { type: 'call'; callId: string; name: string; args: Record<string, unknown>; timeoutMs: number }
  | { type: 'cancel'; callId: string }
  | { type: 'context/request'; requestId: string }
  | { type: 'ping' }
  | { type: 'error'; message: string };

export function isPageFrame(value: unknown): value is PageFrame {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
