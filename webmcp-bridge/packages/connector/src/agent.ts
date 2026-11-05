import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import type { Stream } from '@agentclientprotocol/sdk';
import { listTools } from './mirror.ts';
import { openAgentConnection, type AgentConnection, type AgentHandle, type PermissionModeId, type SwitchPolicy } from './agent-connection.ts';
import type { PageConnection, ToolPolicy } from './types.ts';

export type { AgentConnection, AgentHandle, PermissionModeId, SwitchPolicy, ThreadInfo, ThreadState } from './agent-connection.ts';

export interface AgentOptions {
  /** Full system prompt. Default: the page connection's `instructions`. */
  instructions?: string;
  /** 'replace' (default, D-27) sends the prompt as a string; 'append' adds it to Claude Code's preset. */
  systemPromptMode?: 'replace' | 'append';
  toolPolicy?: ToolPolicy;
  /** Pre-allow the page's read-only tools (no permission prompt). Default true. */
  autoAllowReadOnly?: boolean;
  /** Deterministic UI-state snapshot attached to every prompt as a resource block. Default: the connection's context(). */
  context?: () => string | Promise<string>;
  /** connectAgent() only: the thread to open first (session/load); a failed load opens a new thread instead. */
  resumeSessionId?: string;
  /** Agent SDK options forwarded per session (merged after the ones derived above). */
  claudeOptions?: Record<string, unknown>;
  /** Which daemon-side agent to spawn (ids from page.status.agents). Default 'claude'. */
  agent?: string;
  /** Permission mode for NEW threads, selected with session/set_mode when the agent offers it. Default 'auto'; null leaves the agent's own default (D-33). */
  defaultMode?: PermissionModeId | null;
  /** What happens to the thread you switch away from. Default 'keep-while-prompting' (D-36). */
  switchPolicy?: SwitchPolicy;
  /** Advertise form elicitation so the agent can ask structured questions in the page (Claude's AskUserQuestion). Default true. */
  elicitation?: boolean;
  /** Advanced: speak ACP over this stream instead of the daemon's /acp socket (tests, custom transports). */
  stream?: Stream;
}

/**
 * Open the embedded chat's connection: the page is the ACP client, the daemon relays to an agent
 * (plan §2.1 flow 3, §4.3). Page tools arrive through the daemon's per-page MCP endpoint. The
 * connection holds the page's threads; open one with `openThread()`.
 */
export async function openAgent(page: PageConnection, opts: AgentOptions = {}): Promise<AgentConnection> {
  const st = page.status;
  if (st.state !== 'connected' || !st.acpUrl || !st.workspaceDir || !st.mcpUrl) throw new Error('page is not connected to the daemon');
  const settings = page.settings;
  const instructions = opts.instructions ?? settings.instructions ?? 'You are embedded in a web page; use the page tools to read and change it.';
  const context = opts.context ?? settings.context;
  const toolPolicy = opts.toolPolicy ?? settings.toolPolicy;
  const readOnly = (await listTools(page.modelContext)).filter((t) => t.annotations?.readOnlyHint).map((t) => `mcp__page__${t.name}`);
  const autoAllowReadOnly = opts.autoAllowReadOnly ?? true;
  const agentId = opts.agent ?? 'claude';
  const acpUrl = agentId === 'claude' ? st.acpUrl : `${st.acpUrl}${st.acpUrl.includes('?') ? '&' : '?'}agent=${encodeURIComponent(agentId)}`;
  const meta = {
    systemPrompt: (opts.systemPromptMode ?? 'replace') === 'append' ? { append: instructions, excludeDynamicSections: true } : instructions,
    claudeCode: { options: {
      ...(readOnly.length && autoAllowReadOnly ? { allowedTools: readOnly } : {}),
      ...(toolPolicy?.disallowedTools?.length ? { disallowedTools: toolPolicy.disallowedTools } : {}),
      allowDangerouslySkipPermissions: false,
      ...(opts.claudeOptions ?? {}),
    } },
  };
  return openAgentConnection({
    stream: opts.stream ?? createWebSocketStream(acpUrl),
    agentId,
    cwd: st.workspaceDir,
    mcpServers: [{ type: 'http', name: 'page', url: st.mcpUrl, headers: [] }],
    meta,
    context,
    readOnlyTools: readOnly,
    autoAllowReadOnly,
    defaultMode: opts.defaultMode,
    switchPolicy: opts.switchPolicy,
    elicitation: opts.elicitation,
    activity: page.activity,
    calls: typeof page.onCall === 'function' ? { onCall: (l) => page.onCall(l), calls: () => page.calls, claimCall: (id, by) => page.claimCall(id, by) } : undefined,
  });
}

/**
 * One-call form: open the connection and one thread (`resumeSessionId` when it can be loaded,
 * else a new one). The returned handle owns the connection: `close()` ends both.
 */
export async function connectAgent(page: PageConnection, opts: AgentOptions = {}): Promise<AgentHandle> {
  const connection = await openAgent(page, opts);
  let thread: AgentHandle;
  try {
    if (opts.resumeSessionId) {
      try { thread = await connection.openThread(opts.resumeSessionId); }
      catch { thread = await connection.openThread(); }
    } else thread = await connection.openThread();
  } catch (err) { connection.close(); throw err; }
  return ownedHandle(connection, thread);
}

/** A handle whose close() also closes the connection it came from (connectAgent compat). */
export function ownedHandle(connection: AgentConnection, h: AgentHandle): AgentHandle {
  return {
    connection, model: h.model, sessionId: h.sessionId, agentId: h.agentId,
    prompt: (text) => h.prompt(text),
    cancel: () => h.cancel(),
    setMode: (modeId) => h.setMode(modeId),
    setConfigOption: (configId, value) => h.setConfigOption(configId, value),
    setAutoAllowReadOnly: (on) => h.setAutoAllowReadOnly(on),
    get autoAllowReadOnly() { return h.autoAllowReadOnly; },
    close() { connection.close(); },
  };
}
