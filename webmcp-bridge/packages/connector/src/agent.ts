import * as acp from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import { listTools } from './mirror.ts';
import { SessionModel } from './session-model.ts';
import type { PageConnection, ToolPolicy } from './types.ts';

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
  /** Resume a previous session instead of creating one. */
  resumeSessionId?: string;
  /** Agent SDK options forwarded per session (merged after the ones derived above). */
  claudeOptions?: Record<string, unknown>;
  /** Which daemon-side agent to spawn (ids from page.status.agents). Default 'claude'. */
  agent?: string;
  model?: SessionModel;
}

export interface AgentHandle {
  readonly model: SessionModel;
  readonly sessionId: string;
  prompt(text: string): Promise<{ stopReason: string }>;
  cancel(): Promise<void>;
  setMode(modeId: string): Promise<void>;
  /** Toggle client-side auto-approval of the page's read-only tools for future permission requests. */
  setAutoAllowReadOnly(on: boolean): void;
  readonly autoAllowReadOnly: boolean;
  readonly agentId: string;
  close(): void;
}

/**
 * Open the embedded chat: the page is the ACP client, the daemon relays to a Claude agent
 * (plan §2.1 flow 3, §4.3). Page tools arrive through the daemon's per-page MCP endpoint.
 */
export async function connectAgent(page: PageConnection, opts: AgentOptions = {}): Promise<AgentHandle> {
  const st = page.status;
  if (st.state !== 'connected' || !st.acpUrl || !st.workspaceDir || !st.mcpUrl) throw new Error('page is not connected to the daemon');
  const model = opts.model ?? new SessionModel();
  const settings = page.settings;
  const instructions = opts.instructions ?? settings.instructions ?? 'You are embedded in a web page; use the page tools to read and change it.';
  const context = opts.context ?? settings.context;
  const toolPolicy = opts.toolPolicy ?? settings.toolPolicy;
  const readOnly = (await listTools(page.modelContext)).filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
  const readOnlyQualified = new Set(readOnly.map((n) => `mcp__page__${n}`));

  const agentId = opts.agent ?? 'claude';
  let autoAllow = opts.autoAllowReadOnly ?? true;
  const acpUrl = agentId === 'claude' ? st.acpUrl : `${st.acpUrl}${st.acpUrl.includes('?') ? '&' : '?'}agent=${encodeURIComponent(agentId)}`;
  const stream = createWebSocketStream(acpUrl);
  let ctxRef: any;
  let closeResolve: (() => void) | undefined;
  let sessionId = opts.resumeSessionId ?? '';
  const closed = new Promise<void>((r) => { closeResolve = r; });

  const connection = acp.client({ name: 'webmcp-connector' })
    .onRequest(acp.methods.client.session.requestPermission, (ctx: any) => new Promise((resolve) => {
      const p = ctx.params;
      const title: string = p.toolCall?.title ?? p.toolCall?.name ?? 'tool';
      const options: Array<{ optionId: string; name: string; kind: string }> = p.options ?? [];
      const settle = (optionId: string) => resolve(optionId === '__cancelled__' ? { outcome: { outcome: 'cancelled' } } : { outcome: { outcome: 'selected', optionId } });
      if (autoAllow && readOnlyQualified.has(String(p.toolCall?.name ?? title))) {
        const allow = options.find((o) => o.kind === 'allow_always') ?? options.find((o) => o.kind === 'allow_once');
        if (allow) { settle(allow.optionId); return; }
      }
      model.addPermission({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, toolName: p.toolCall?.name, toolKind: p.toolCall?.kind, rawInput: p.toolCall?.rawInput, options, respond: settle });
    }))
    .onNotification(acp.methods.client.session.update, (ctx: any) => { model.applyUpdate(ctx.params.update); });

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    connection.connectWith(stream, async (ctx: any) => {
      ctxRef = ctx;
      try {
        const init = await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
        const meta = {
          systemPrompt: (opts.systemPromptMode ?? 'replace') === 'append' ? { append: instructions, excludeDynamicSections: true } : instructions,
          claudeCode: { options: {
            ...(readOnly.length && (opts.autoAllowReadOnly ?? true) ? { allowedTools: [...readOnlyQualified] } : {}),
            ...(toolPolicy?.disallowedTools?.length ? { disallowedTools: toolPolicy.disallowedTools } : {}),
            allowDangerouslySkipPermissions: false,
            ...(opts.claudeOptions ?? {}),
          } },
        };
        const mcpServers = [{ type: 'http', name: 'page', url: st.mcpUrl, headers: [] }];
        let modes: any;
        if (sessionId && init.agentCapabilities?.loadSession) {
          try { const r = await ctx.request(acp.methods.agent.session.load, { sessionId, cwd: st.workspaceDir, mcpServers, _meta: meta }); modes = r?.modes; }
          catch { sessionId = ''; }
        }
        if (!sessionId) {
          const r = await ctx.request(acp.methods.agent.session.new, { cwd: st.workspaceDir, mcpServers, _meta: meta });
          sessionId = r.sessionId; modes = r.modes;
        }
        model.setSession({ sessionId, agentName: init.agentInfo?.name, modes: modes ? { current: modes.currentModeId, available: (modes.availableModes ?? []).map((m: any) => ({ id: m.id, name: m.name, description: m.description })) } : undefined });
        model.setState('ready');
        resolveReady();
      } catch (err) { rejectReady(err); throw err; }
      await closed;
    }).catch((err: unknown) => { model.setState('error', String((err as Error)?.message ?? err)); rejectReady(err); });
  });
  await ready;

  const handle: AgentHandle = {
    model,
    get sessionId() { return sessionId; },
    async prompt(text) {
      model.beginTurn(text);
      const blocks: any[] = [{ type: 'text', text }];
      if (context) {
        try { const snap = await context(); if (snap) blocks.push({ type: 'resource', resource: { uri: 'page://ui-state', mimeType: 'text/plain', text: `Current UI state of the page (deterministic snapshot):\n${snap}` } }); } catch { /* no snapshot this turn */ }
      }
      try {
        const r = await ctxRef.request(acp.methods.agent.session.prompt, { sessionId, prompt: blocks });
        model.endTurn(r.stopReason); return { stopReason: r.stopReason };
      } catch (err) { model.endTurn('error'); model.setState('error', String((err as Error)?.message ?? err)); throw err; }
    },
    async cancel() { model.cancelPermissions(); await ctxRef.notify(acp.methods.agent.session.cancel, { sessionId }); },
    async setMode(modeId) { await ctxRef.request(acp.methods.agent.session.setMode, { sessionId, modeId }); model.setSession({ modes: { ...(model.snapshot().modes ?? { available: [] }), current: modeId } }); },
    setAutoAllowReadOnly(on) { autoAllow = on; },
    get autoAllowReadOnly() { return autoAllow; },
    agentId,
    close() { closeResolve?.(); try { void stream.writable.close(); } catch { /* already closed */ } model.setState('closed'); },
  };
  return handle;
}
