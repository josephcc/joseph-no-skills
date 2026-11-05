/**
 * A small ACP agent with sessions, for tests of the thread model (plan threads-and-auto-mode, D-35):
 * session/new, load (replays history), list, close, delete, set_mode, and an echo prompt.
 * Prompt text containing "slow" stays open until `release()` or session/cancel; text containing
 * "ask" first requests a permission; "ask-form" asks a form elicitation; `widget:<tool> <json>` announces a
 * page tool call (`mcp__page__<tool>`), runs it through `callPage` when given, and reports the result the way
 * the Claude adapter does (plan in-chat-widgets §7.1). Shared by the bun unit tests (in-process stream pair)
 * and `scripts/e2e/fake-agent.mjs` (stdio, optionally persisted to a file across processes).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as acp from '@agentclientprotocol/sdk';
import type { AnyMessage, Stream } from '@agentclientprotocol/sdk';

export interface FakeAgentOptions {
  name?: string;
  loadSession?: boolean;
  list?: boolean;
  close?: boolean;
  delete?: boolean;
  /** Mode ids offered on session/new and session/load; null = the agent has no modes. */
  modes?: string[] | null;
  /** Keep sessions in this JSON file so a later process sees them (e2e). */
  persistFile?: string;
  /** Run a page tool for `widget:<tool> <json>` prompts and return the result text; omitted → an echo of the input. */
  callPage?: (session: StoredSession, tool: string, input: Record<string, unknown>) => Promise<string>;
}

export interface StoredChunk {
  role: 'user' | 'agent' | 'tool';
  text: string;
  /** role 'user': the URIs of the resource blocks the prompt carried (page://ui-state, page://widget-activity). */
  resources?: string[];
  /** role 'tool': the call as it was announced, so session/load can replay it. */
  toolCallId?: string;
  name?: string;
  input?: Record<string, unknown>;
  failed?: boolean;
}

export interface StoredSession {
  id: string;
  cwd: string;
  title?: string;
  updatedAt: string;
  mode: string;
  chunks: StoredChunk[];
  /** The mcpServers the client passed on session/new (the page's endpoint; e2e derives the daemon from it). */
  mcpServers?: unknown[];
}

export interface FakeAgent {
  app: acp.AgentApp;
  store: Map<string, StoredSession>;
  /** Every request the agent handled, in order. */
  calls: Array<{ method: string; params: any }>;
  /** Threads currently loaded (session/new or session/load without a later close). */
  loaded: Set<string>;
  release(sessionId: string): void;
}

export function buildFakeAgent(opts: FakeAgentOptions = {}): FakeAgent {
  const modes = opts.modes === undefined ? ['default', 'acceptEdits', 'auto'] : opts.modes;
  const store = new Map<string, StoredSession>();
  const loaded = new Set<string>();
  const calls: FakeAgent['calls'] = [];
  const waiting = new Map<string, () => void>();
  let seq = 0;
  if (opts.persistFile && existsSync(opts.persistFile)) {
    try { for (const s of JSON.parse(readFileSync(opts.persistFile, 'utf8')) as StoredSession[]) store.set(s.id, s); } catch { /* start empty */ }
    seq = store.size;
  }
  const persist = () => { if (opts.persistFile) writeFileSync(opts.persistFile, JSON.stringify([...store.values()])); };
  const modeState = (s: StoredSession) => (modes ? { currentModeId: s.mode, availableModes: modes.map((id) => ({ id, name: id })) } : undefined);
  const session = (id: string) => { const s = store.get(id); if (!s) throw acp.RequestError.invalidParams({ sessionId: id }, `no session ${id}`); return s; };
  const record = (method: string, params: any) => calls.push({ method, params });
  const update = (ctx: any, sessionId: string, update: Record<string, unknown>) => ctx.client.notify(acp.methods.client.session.update, { sessionId, update });
  const toolCallFrames = (c: StoredChunk) => {
    const name = `mcp__page__${c.name}`;
    const meta = { claudeCode: { toolName: name } };
    const first = { sessionUpdate: 'tool_call', toolCallId: c.toolCallId, title: name, name, kind: 'other', status: 'pending', content: [], rawInput: c.input ?? {}, _meta: meta };
    const text = c.failed ? `\`\`\`\n${c.text}\n\`\`\`` : c.text;
    const last = { sessionUpdate: 'tool_call_update', toolCallId: c.toolCallId, status: c.failed ? 'failed' : 'completed', content: [{ type: 'content', content: { type: 'text', text } }], _meta: meta };
    return [first, last];
  };

  const app = acp.agent({ name: opts.name ?? 'fake-agent' })
    .onRequest(acp.methods.agent.initialize, (ctx: any) => {
      record('initialize', ctx.params);
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: opts.loadSession ?? true, sessionCapabilities: { ...((opts.list ?? true) ? { list: {} } : {}), ...((opts.close ?? true) ? { close: {} } : {}), ...((opts.delete ?? true) ? { delete: {} } : {}) } },
        agentInfo: { name: opts.name ?? 'fake-agent', title: 'Fake agent', version: '0' },
      };
    })
    .onRequest(acp.methods.agent.session.new, (ctx: any) => {
      record('session/new', ctx.params);
      const id = `${opts.name ?? 'fake'}-${++seq}-${Math.random().toString(36).slice(2, 6)}`;
      const s: StoredSession = { id, cwd: String(ctx.params.cwd), updatedAt: new Date().toISOString(), mode: 'default', chunks: [], ...(Array.isArray(ctx.params.mcpServers) ? { mcpServers: ctx.params.mcpServers } : {}) };
      store.set(id, s); loaded.add(id); persist();
      const m = modeState(s);
      return { sessionId: id, ...(m ? { modes: m } : {}) };
    })
    .onRequest(acp.methods.agent.session.load, async (ctx: any) => {
      record('session/load', ctx.params);
      if (!(opts.loadSession ?? true)) throw acp.RequestError.methodNotFound('session/load');
      const s = session(String(ctx.params.sessionId));
      loaded.add(s.id);
      // The page endpoint a reload reconnects under (a new page id): the real adapter takes the
      // mcpServers of session/load too, so a `widget:` prompt after a reload reaches the page.
      if (Array.isArray(ctx.params.mcpServers)) { s.mcpServers = ctx.params.mcpServers; persist(); }
      for (const c of s.chunks) {
        if (c.role === 'tool') { for (const f of toolCallFrames(c)) await update(ctx, s.id, f); continue; }
        await update(ctx, s.id, { sessionUpdate: c.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk', content: { type: 'text', text: c.text } });
      }
      const m = modeState(s);
      return m ? { modes: m } : {};
    })
    .onRequest(acp.methods.agent.session.list, (ctx: any) => {
      record('session/list', ctx.params);
      const cwd = ctx.params?.cwd;
      const sessions = [...store.values()].filter((s) => !cwd || s.cwd === cwd).filter((s) => s.chunks.length > 0)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((s) => ({ sessionId: s.id, cwd: s.cwd, title: s.title ?? s.chunks[0]?.text, updatedAt: s.updatedAt }));
      return { sessions };
    })
    .onRequest(acp.methods.agent.session.close, (ctx: any) => {
      record('session/close', ctx.params);
      const id = String(ctx.params.sessionId);
      loaded.delete(id); waiting.get(id)?.(); waiting.delete(id);
      return {};
    })
    .onRequest(acp.methods.agent.session.delete, (ctx: any) => {
      record('session/delete', ctx.params);
      const id = String(ctx.params.sessionId);
      store.delete(id); loaded.delete(id); waiting.get(id)?.(); waiting.delete(id); persist();
      return {};
    })
    .onRequest(acp.methods.agent.session.setMode, (ctx: any) => {
      record('session/set_mode', ctx.params);
      const s = session(String(ctx.params.sessionId));
      if (modes && !modes.includes(String(ctx.params.modeId))) throw acp.RequestError.invalidParams(undefined, `Invalid Mode: ${ctx.params.modeId}`);
      s.mode = String(ctx.params.modeId); persist();
      return {};
    })
    .onRequest(acp.methods.agent.session.prompt, async (ctx: any) => {
      record('session/prompt', ctx.params);
      const s = session(String(ctx.params.sessionId));
      const blocks = ctx.params.prompt as Array<{ type: string; text?: string; resource?: { uri?: string } }>;
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ');
      const resources = blocks.filter((b) => b.type === 'resource').map((b) => String(b.resource?.uri ?? ''));
      s.chunks.push({ role: 'user', text, ...(resources.length ? { resources } : {}) }); s.updatedAt = new Date().toISOString(); persist();
      if (/\breject-prompt\b/.test(text)) { s.chunks.pop(); persist(); throw acp.RequestError.internalError(undefined, 'the agent refused this prompt'); }
      let reply = `echo: ${text}`;
      const widget = /^widget:(\S+)\s*(\{.*\})?\s*$/s.exec(text);
      if (widget) {
        // A page tool call the way the Claude adapter reports it: tool_call (pending, name, rawInput, _meta), then the result.
        const tool = widget[1]!;
        let input: Record<string, unknown> = {};
        try { input = widget[2] ? JSON.parse(widget[2]) : {}; } catch { /* keep {} */ }
        const chunk: StoredChunk = { role: 'tool', toolCallId: `toolu_${++seq}_${Math.random().toString(36).slice(2, 6)}`, name: tool, input, text: '' };
        const [first] = toolCallFrames(chunk);
        await update(ctx, s.id, first!);
        try { chunk.text = opts.callPage ? await opts.callPage(s, tool, input) : JSON.stringify({ echoed: input }); }
        catch (err) { chunk.failed = true; chunk.text = `${tool}: ${(err as Error)?.name ?? 'Error'}: ${(err as Error)?.message ?? String(err)}`; }
        await update(ctx, s.id, toolCallFrames(chunk)[1]!);
        s.chunks.push(chunk);
        reply = chunk.failed ? 'the tool failed' : 'card shown';
      } else if (/ask-form/.test(text)) {
        const r = await ctx.client.request(acp.methods.client.elicitation.create, {
          sessionId: s.id, mode: 'form', message: 'Which one?',
          requestedSchema: { type: 'object', properties: {
            choice: { type: 'string', title: 'Choice', oneOf: [{ const: 'a', title: 'Option A' }, { const: 'b', title: 'Option B', description: 'the other one' }] },
            choice_custom: { type: 'string', title: 'Other', description: 'Type your own answer (optional).' },
          } },
        });
        reply = `form: ${JSON.stringify(r)}`;
      } else if (/\bask\b/.test(text)) {
        const r = await ctx.client.request(acp.methods.client.session.requestPermission, {
          sessionId: s.id,
          toolCall: { toolCallId: `t-${Date.now()}`, title: 'write a note', name: 'Write', kind: 'edit', status: 'pending' },
          options: [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }, { optionId: 'no', name: 'No', kind: 'reject_once' }],
        });
        reply = r?.outcome?.outcome === 'selected' && r.outcome.optionId === 'yes' ? 'note written' : 'declined';
      }
      if (/\bslow\b/.test(text)) await new Promise<void>((resolve) => waiting.set(s.id, resolve));
      waiting.delete(s.id);
      if (!loaded.has(s.id)) return { stopReason: 'cancelled' };
      s.chunks.push({ role: 'agent', text: reply }); s.updatedAt = new Date().toISOString();
      await update(ctx, s.id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: reply } });
      if (!s.title) { s.title = text.slice(0, 40); await update(ctx, s.id, { sessionUpdate: 'session_info_update', title: s.title }); }
      persist();
      return { stopReason: 'end_turn' };
    })
    .onNotification(acp.methods.agent.session.cancel, (ctx: any) => {
      record('session/cancel', ctx.params);
      const id = String(ctx.params.sessionId);
      const resume = waiting.get(id);
      loaded.delete(id); resume?.(); waiting.delete(id);
      loaded.add(id);   // cancelled, not closed: the thread stays loaded
    });
  return { app, store, calls, loaded, release: (id) => { waiting.get(id)?.(); } };
}

/** Two connected in-memory ACP streams: [client side, agent side]. */
export function streamPair(): [Stream, Stream] {
  const a = new TransformStream<AnyMessage, AnyMessage>();
  const b = new TransformStream<AnyMessage, AnyMessage>();
  return [{ readable: a.readable, writable: b.writable }, { readable: b.readable, writable: a.writable }];
}

/** The fake agent connected in-process; `stream` is the client's end; `dropAgent()` makes the agent's side go away. */
export function startFakeAgent(opts: FakeAgentOptions = {}): FakeAgent & { stream: Stream; dropAgent(error?: Error): void } {
  const fake = buildFakeAgent(opts);
  const [client, agent] = streamPair();
  fake.app.connect(agent);
  // The client's inbound side goes through a cuttable stage: erroring it is what a dropped WebSocket looks like.
  let cutter: TransformStreamDefaultController<AnyMessage> | undefined;
  const cut = new TransformStream<AnyMessage, AnyMessage>({ start(c) { cutter = c; } });
  const abort = new AbortController();
  client.readable.pipeTo(cut.writable, { signal: abort.signal }).catch(() => { /* cut */ });
  const dropAgent = (error?: Error) => { const e = error ?? new Error('agent went away'); try { cutter?.error(e); } catch { /* already errored */ } abort.abort(e); };
  return { ...fake, stream: { readable: cut.readable, writable: client.writable }, dropAgent };
}
