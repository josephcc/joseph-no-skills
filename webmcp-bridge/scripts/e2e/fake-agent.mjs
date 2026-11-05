// A minimal ACP agent for tests of the agent picker: echoes prompts back. Speaks ACP v1 over stdio.
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
const sessions = new Map();
const app = acp.agent({ name: 'echo-agent' })
  .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false }, agentInfo: { name: 'echo-agent', title: 'Echo', version: '0' } }))
  .onRequest(acp.methods.agent.session.new, (ctx) => { const id = `echo-${Date.now()}`; sessions.set(id, ctx.params.cwd); return { sessionId: id }; })
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    const text = ctx.params.prompt.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
    await ctx.client.notify(acp.methods.client.session.update, { sessionId: ctx.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `echo: ${text}` } } });
    return { stopReason: 'end_turn' };
  })
  .onNotification(acp.methods.agent.session.cancel, () => {});
app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
