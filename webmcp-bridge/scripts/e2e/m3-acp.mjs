// M3 spike: ACP over WebSocket → AcpServer → spawned claude-agent-acp, with the demo page's tools
// passed as an HTTP MCP server, a replaced system prompt, and a per-session tool policy.
// Needs: daemon on 8717 with the demo page connected (hold-page.mjs), claude logged in.
import { createServer } from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import { AcpServer } from '@agentclientprotocol/sdk/experimental/server';
import { createNodeHttpHandler, createNodeWebSocketUpgradeHandler } from '@agentclientprotocol/sdk/experimental/node';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';

const DAEMON = process.env.DAEMON_URL ?? 'http://127.0.0.1:8717';
const PORT = Number(process.env.ACP_PORT ?? 8790);
const MODEL = process.env.ACP_MODEL ?? 'sonnet';
const ADAPTER = new URL('../../node_modules/.bin/claude-agent-acp', import.meta.url).pathname;
const CLAUDE = process.env.CLAUDE_CODE_EXECUTABLE ?? execSync('which claude').toString().trim();
const WORKSPACE = '/tmp/webmcp-e2e/acp-workspace';
mkdirSync(`${WORKSPACE}/.claude`, { recursive: true });
writeFileSync(`${WORKSPACE}/.claude/settings.json`, JSON.stringify({ permissions: { defaultMode: 'default' } }));

const out = { steps: [] };
const t0 = Date.now();
const step = (name, data) => { out.steps.push({ name, at_ms: Date.now() - t0, ...data }); };

// ---- server side: AcpServer relay that spawns one adapter per connection ----
const children = new Set();
const acpServer = new AcpServer({
  createAgent: () => ({
    connect(clientStream) {
      const child = spawn(ADAPTER, [], { cwd: WORKSPACE, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_CODE_EXECUTABLE: CLAUDE, CLAUDE_AGENT_ACP_PROTOCOL: 'v1' } });
      children.add(child);
      child.stderr.on('data', (d) => { const s = d.toString(); if (!/ExperimentalWarning|trace-warnings/.test(s)) out.adapterStderr = ((out.adapterStderr ?? '') + s).slice(-1500); });
      const agentStream = acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
      clientStream.readable.pipeTo(agentStream.writable).catch(() => {});
      agentStream.readable.pipeTo(clientStream.writable).catch(() => {});
      const closed = new Promise((res) => child.once('exit', (code) => { children.delete(child); step('adapter exit', { code }); res(); }));
      return { closed };
    },
  }),
});
const wss = new WebSocketServer({ noServer: true });
const httpHandler = createNodeHttpHandler(acpServer);
const upgrade = createNodeWebSocketUpgradeHandler(acpServer, wss);
const server = createServer((req, res) => (req.url?.startsWith('/acp') ? httpHandler(req, res) : (res.writeHead(404), res.end())));
server.on('upgrade', (req, socket, head) => (req.url?.startsWith('/acp') ? upgrade(req, socket, head) : socket.destroy()));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
step('relay listening', { port: PORT });

// ---- page tools: the daemon's per-page MCP endpoint ----
const pages = await (await fetch(`${DAEMON}/pages`)).json();
if (!pages.length) throw new Error('no page connected to the daemon');
const pageMcpUrl = `${DAEMON}/mcp/by-page/${pages[0].id}`;
const instructions = (await (await fetch(`${DAEMON}/instructions?page=selected&full=1`)).text()) || 'You are embedded in a web page.';

// ---- client side: the browser's role, played by Node ----
const updates = [];
const permissions = [];
let permissionChoice = 'reject_once';
const stream = createWebSocketStream(`ws://127.0.0.1:${PORT}/acp`, { WebSocket });
const text = (upd) => (upd.content?.type === 'text' ? upd.content.text : '');
const run = acp.client({ name: 'm3-spike' })
  .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
    const opts = ctx.params.options.map((o) => ({ id: o.optionId, kind: o.kind, name: o.name }));
    permissions.push({ title: ctx.params.toolCall?.title, kind: ctx.params.toolCall?.kind, options: opts });
    const pick = ctx.params.options.find((o) => o.kind === permissionChoice) ?? ctx.params.options[0];
    return { outcome: { outcome: 'selected', optionId: pick.optionId } };
  })
  .onNotification(acp.methods.client.session.update, (ctx) => { updates.push(ctx.params.update); })
  .connectWith(stream, async (ctx) => {
    const init = await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
    step('initialize', { agent: init.agentInfo?.name, version: init.agentInfo?.version, mcp: init.agentCapabilities?.mcpCapabilities, loadSession: init.agentCapabilities?.loadSession, authMethods: init.authMethods?.map((m) => m.id) });
    const session = await ctx.request(acp.methods.agent.session.new, {
      cwd: WORKSPACE,
      mcpServers: [{ type: 'http', name: 'page', url: pageMcpUrl, headers: [] }],
      _meta: {
        systemPrompt: `${instructions}\n\nSPIKE RULE: end every reply with the word BANANA.`,
        claudeCode: { options: { model: MODEL, disallowedTools: ['Bash', 'Edit', 'WebSearch', 'WebFetch'], allowDangerouslySkipPermissions: false, effort: 'low' } },
      },
    });
    step('session/new', { sessionId: session.sessionId, modes: session.modes?.availableModes?.map((m) => m.id), currentMode: session.modes?.currentModeId });

    const prompt = async (label, textIn) => {
      const before = updates.length;
      const r = await ctx.request(acp.methods.agent.session.prompt, { sessionId: session.sessionId, prompt: [{ type: 'text', text: textIn }] });
      const mine = updates.slice(before);
      const reply = mine.filter((u) => u.sessionUpdate === 'agent_message_chunk').map(text).join('');
      const tools = mine.filter((u) => u.sessionUpdate === 'tool_call').map((u) => ({ title: u.title, name: u.name, kind: u.kind, status: u.status }));
      const toolDone = mine.filter((u) => u.sessionUpdate === 'tool_call_update' && u.status === 'completed').length;
      step(label, { stopReason: r.stopReason, reply: reply.slice(0, 300), tools, toolDone, updateKinds: [...new Set(mine.map((u) => u.sessionUpdate))] });
    };
    await prompt('prompt: pong', 'Reply with exactly one word: pong');
    await prompt('prompt: page tool', 'Using the page tool get_state, what is the current background colour of the page? One short sentence.');
    await prompt('prompt: write file (expect permission request, rejected)', 'Create a file named note.txt in the current directory containing the text hi. Do not ask me; just do it.');
    permissionChoice = 'allow_once';
    await prompt('prompt: bash (disallowed)', 'Run the shell command `ls` and tell me what you see. If you cannot, say why in one sentence.');
    await ctx.notify?.(acp.methods.agent.session.cancel, { sessionId: session.sessionId }).catch?.(() => {});
    return session.sessionId;
  });
try { out.sessionId = await run; } catch (err) { out.error = String(err?.stack ?? err); }
out.permissions = permissions;
out.updateKinds = [...new Set(updates.map((u) => u.sessionUpdate))];
out.noteFileExists = (await import('node:fs')).existsSync(`${WORKSPACE}/note.txt`);
for (const c of children) c.kill('SIGTERM');
await acpServer.close().catch(() => {});
server.close();
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
