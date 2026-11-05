import type { ToolInfo } from './protocol.ts';
import type { ActivityLog, PendingCall } from './widgets.ts';

export type ConnectorState =
  | 'idle'            // created, not asked to connect
  | 'searching'       // trying to reach the daemon
  | 'needs-approval'  // socket pending: the daemon is waiting for the user to approve this origin
  | 'connected'
  | 'absent'          // nothing listens on the daemon port (will keep retrying)
  | 'denied';         // the daemon refused this origin (no retries until connect() is called again)

export interface ConnectorStatus {
  state: ConnectorState;
  attempts: number;
  pageId?: string;
  workspaceDir?: string;
  mcpUrl?: string;
  acpUrl?: string;
  daemonVersion?: string;
  /** Agents the daemon offers for the embedded chat. */
  agents?: Array<{ id: string; name: string; default: boolean }>;
  lastError?: string;
  toolCount: number;
}

export interface ToolPolicy {
  /** Claude Code tools the embedded agent may not use, e.g. ['Bash', 'Write', 'Edit']. Default: none (D-24). */
  disallowedTools?: string[];
}

export interface ConnectOptions {
  /** WebSocket base of the daemon. Default ws://127.0.0.1:8717 */
  daemonUrl?: string;
  /** Full system prompt for the embedded chat (replaces Claude Code's preset, D-27). */
  instructions?: string;
  /** Short version (≤ 9,500 chars) injected into terminal sessions by the plugin hook. */
  instructionsSummary?: string;
  /** Deterministic description of what the user is looking at; called on demand by the daemon and on every embedded-chat prompt. */
  context?: () => string | Promise<string>;
  toolPolicy?: ToolPolicy;
  /** Title shown to Claude and in the daemon's approval page. Default document.title */
  title?: string;
  /**
   * Connect immediately. Default: true when the page itself is served from localhost/127.0.0.1,
   * false otherwise (a public https page triggers Chrome's Local Network Access prompt, which
   * should follow a user action; call connection.connect() from a click handler).
   */
  autoConnect?: boolean;
  onStatus?: (status: ConnectorStatus) => void;
  /** Called whenever the daemon invokes a page tool (for call logs). */
  onToolCall?: (event: ToolCallEvent) => void;
  /** Install the modelContext shim when the native API is absent. Default true. */
  shim?: boolean;
  retry?: { minMs?: number; maxMs?: number };
}

export interface ToolCallEvent {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  phase: 'start' | 'end';
  ok?: boolean;
  result?: string | null;
  error?: string;
  durationMs?: number;
}

export interface PageConnection {
  readonly status: ConnectorStatus;
  /** The options the page connected with (instructions, context, toolPolicy, title), read by connectAgent(). */
  readonly settings: Pick<ConnectOptions, 'instructions' | 'instructionsSummary' | 'context' | 'toolPolicy' | 'title'>;
  readonly modelContext: ModelContext;
  readonly usingShim: boolean;
  connect(): void;
  disconnect(): void;
  onStatus(listener: (status: ConnectorStatus) => void): () => void;
  /** Re-read document.modelContext and push the tool list (normally automatic via toolchange). */
  refreshTools(): Promise<ToolInfo[]>;
  setInstructions(instructions?: string, instructionsSummary?: string): void;
  /** Page tool calls in flight right now (from either Claude), oldest first. */
  readonly calls: readonly PendingCall[];
  /** Every page tool call, start and end, like the `onToolCall` option. */
  onCall(listener: (event: ToolCallEvent) => void): () => void;
  /** Mark a call as belonging to a chat thread's transcript item; the floating widget panel then leaves it alone. */
  claimCall(callId: string, by: string): void;
  /** Who claimed a call (a thread id), remembered for a minute after the call ends. */
  claimOf(callId: string): string | undefined;
  /** Fires when a call is claimed (also after it ended), so a panel showing it can take it down. */
  onClaim(listener: (callId: string, by: string) => void): () => void;
  /** What the user did in the page's cards; attached to the next prompt and to the terminal hook's state text. */
  readonly activity: ActivityLog;
}
