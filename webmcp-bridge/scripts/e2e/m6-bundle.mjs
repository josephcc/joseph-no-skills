// M6: the plugin's bundled daemon + bundled adapter: ACP handshake through /acp with no model calls (no tokens).
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import * as acp from '@agentclientprotocol/sdk';
import { createWebSocketStream } from '@agentclientprotocol/sdk/experimental/ws-client';
const PORT = 8719; const STATE = '/tmp/webmcp-e2e/state-bundle';
const out = {};
const daemon = spawn(process.execPath, ['plugin/daemon/webmcp-daemon.js', 'serve', '--port', String(PORT), '--state-dir', STATE, '--no-browser', '--allow-origin', 'http://test.local'], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; daemon.stderr.on('data', (d) => { logs += d.toString(); });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
try {
  const stream = createWebSocketStream(`ws://127.0.0.1:${PORT}/acp`, { WebSocket, headers: { Origin: 'http://test.local' } });
  await acp.client({ name: 'm6' }).onNotification(acp.methods.client.session.update, () => {}).connectWith(stream, async (ctx) => {
    const init = await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
    out.agent = init.agentInfo?.name; out.version = init.agentInfo?.version;
    const s = await ctx.request(acp.methods.agent.session.new, { cwd: `${STATE}/workspaces/unknown`, mcpServers: [], _meta: { systemPrompt: 'test', claudeCode: { options: { allowDangerouslySkipPermissions: false } } } });
    out.sessionId = s.sessionId?.slice(0, 8);
    out.healthDuring = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  });
} catch (err) { out.error = String(err?.message ?? err); }
await new Promise((r) => setTimeout(r, 6500));   // past the 5 s disconnect grace
out.healthAfter = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
out.spawnedBundledAdapter = /claude-agent-acp\.js|spawned agent/.test(logs);
out.logTail = logs.split('\n').filter((l) => /acp:/.test(l)).slice(-4);
daemon.kill('SIGTERM');
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
