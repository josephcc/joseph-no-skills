// A minimal ACP agent for tests of the agent picker, of threads and of widgets: echoes prompts back, keeps
// sessions (list/load/close/delete, modes default|acceptEdits|auto) in a JSON file next to its cwd so a
// later process (the daemon spawns one per chat connection) sees the same threads, announces page tool calls
// for `widget:<tool> <json>` prompts and runs them through the daemon's /call endpoint (the page sees the same
// `call` frame the MCP route sends), and asks a form elicitation for `ask-form`. Speaks ACP v1 over stdio.
// The behaviour lives in packages/connector/test/fake-acp-agent.ts (shared with the unit tests).
import { Readable, Writable } from 'node:stream';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { buildFakeAgent } from '../../packages/connector/test/fake-acp-agent.ts';

/** Run a page tool through the daemon: the page endpoint URL from session/new tells us the daemon and the page id. */
async function callPage(session, tool, input) {
  const url = String(session.mcpServers?.[0]?.url ?? '');
  const m = /^(https?:\/\/[^/]+)\/mcp\/by-page\/([^/?#]+)/.exec(url);
  if (!m) throw new Error(`no page endpoint in mcpServers (${url || 'none'})`);
  const res = await fetch(`${m[1]}/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: m[2], name: tool, args: input }) });
  const body = await res.json();
  const text = body?.content?.find((c) => c?.type === 'text')?.text ?? '';
  if (body?.isError) throw new Error(text || `${tool} failed`);
  return text;
}

const { app } = buildFakeAgent({ name: 'echo-agent', persistFile: join(process.cwd(), '.echo-agent-sessions.json'), callPage });
app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
