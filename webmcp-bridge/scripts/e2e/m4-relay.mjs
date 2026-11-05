// M4: ACP through the daemon's own /acp relay (origin-checked), page tools via /mcp/by-page, read-only page tools pre-allowed.
// Needs: daemon on 8717 (new code) with the demo page connected (hold-page.mjs).
import { WebSocket } from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
import * as acpU from '@agentclientprotocol/sdk/unstable';

const DAEMON = process.env.DAEMON_URL ?? 'http://127.0.0.1:8717';
const ORIGIN = process.env.PAGE_ORIGIN ?? 'http://127.0.0.1:5173';
const MODEL = process.env.ACP_MODEL ?? 'sonnet';
const out = { steps: [] }; const t0 = Date.now();
const step = (name, data) => out.steps.push({ name, at_ms: Date.now() - t0, ...data });

const pages = await (await fetch(`${DAEMON}/pages`)).json();
const page = pages.find((p) => p.visible) ?? pages[0];
if (!page) throw new Error('no page connected');
const tools = (await (await fetch(`${DAEMON}/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: page.id, name: 'get_state' }) })).json()) && (await (await fetch(`${DAEMON}/pages`)).json()).find((p) => p.id === page.id);
const health = await (await fetch(`${DAEMON}/health`)).json();
step('page', { id: page.id, tools: page.tools, agentsBefore: health.agents?.length ?? 0 });

// A wrong origin must be refused at the upgrade.
await new Promise((resolve) => {
  const bad = new WebSocket(`ws://127.0.0.1:8717/acp?page=${page.id}`, { headers: { Origin: 'https://evil.example' } });
  bad.on('open', () => { step('bad origin', { result: 'UNEXPECTED open' }); bad.close(); resolve(); });
  bad.on('error', (e) => { step('bad origin', { result: 'refused', message: e.message }); resolve(); });
});

const updates = []; const permissions = [];
const stream = createWebSocketStream(`ws://127.0.0.1:8717/acp?page=${page.id}`, { WebSocket, headers: { Origin: ORIGIN } });
const text = (u) => (u.content?.type === 'text' ? u.content.text : '');
const readOnly = ['get_state'];   // the demo marks get_state readOnlyHint; a real client reads this from the page registry
let sessionId;
try {
  await acp.client({ name: 'm4-relay' })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      permissions.push({ title: ctx.params.toolCall?.title, kinds: ctx.params.options.map((o) => o.kind) });
      const pick = ctx.params.options.find((o) => o.kind === 'reject_once') ?? ctx.params.options[0];
      return { outcome: { outcome: 'selected', optionId: pick.optionId } };
    })
    .onNotification(acp.methods.client.session.update, (ctx) => updates.push(ctx.params.update))
    .connectWith(stream, async (ctx) => {
      const init = await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
      step('initialize', { agent: init.agentInfo?.name });
      const welcomeLike = { cwd: `/tmp/webmcp-e2e/state/workspaces/127.0.0.1_5173` };
      const session = await ctx.request(acp.methods.agent.session.new, {
        cwd: welcomeLike.cwd,
        mcpServers: [{ type: 'http', name: 'page', url: `${DAEMON}/mcp/by-page/${page.id}`, headers: [] }],
        _meta: {
          systemPrompt: 'You are embedded in a demo web page. Use the page tools when asked about the page. End every reply with the word MANGO.',
          claudeCode: { options: { model: MODEL, allowedTools: readOnly.map((n) => `mcp__page__${n}`), disallowedTools: ['Bash', 'Edit', 'Write', 'WebSearch', 'WebFetch'], allowDangerouslySkipPermissions: false, effort: 'low' } },
        },
      });
      sessionId = session.sessionId;
      const models = session.models?.availableModels?.map((m) => m.modelId ?? m.value ?? m.id);
      step('session/new', { sessionId, currentModel: session.models?.currentModelId, models, agents: (await (await fetch(`${DAEMON}/health`)).json()).agents?.length });
      const cheap = session.models?.availableModels?.find((m) => /sonnet/i.test(String(m.modelId ?? m.value ?? m.id)));
      if (cheap && acpU.methods?.agent?.session?.setModel) {
        try { await ctx.request(acpU.methods.agent.session.setModel, { sessionId, modelId: cheap.modelId ?? cheap.value ?? cheap.id }); step('set_model', { to: cheap.modelId ?? cheap.value ?? cheap.id }); }
        catch (e) { step('set_model', { error: String(e.message ?? e) }); }
      } else step('set_model', { skipped: true, hasMethod: !!acpU.methods?.agent?.session?.setModel });
      const prompt = async (label, t) => {
        const before = updates.length;
        const r = await ctx.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: t }] });
        const mine = updates.slice(before);
        step(label, { stopReason: r.stopReason, reply: mine.filter((u) => u.sessionUpdate === 'agent_message_chunk').map(text).join('').slice(0, 200), tools: mine.filter((u) => u.sessionUpdate === 'tool_call').map((u) => u.name ?? u.title), permissionsSoFar: permissions.length });
      };
      await prompt('pong', 'Reply with exactly one word: pong');
      await prompt('read-only page tool (pre-allowed, expect no permission prompt)', 'Use the page tool get_state and tell me the background colour in one short sentence.');
      await prompt('mutating page tool (Manual workspace: a permission prompt, which I reject; a fresh workspace starts in auto and may run it without asking)', 'Set the page background to teal using the page tool. If you are not allowed, say so in one sentence.');
      return sessionId;
    });
} catch (err) { out.error = String(err?.stack ?? err); }
out.permissions = permissions;
out.pageState = await (await fetch(`${DAEMON}/state?page=${page.id}`)).text();
await new Promise((r) => setTimeout(r, 1500));
out.agentsAfterClose = (await (await fetch(`${DAEMON}/health`)).json()).agents;
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
