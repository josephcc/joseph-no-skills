// A minimal ACP agent for tests of the agent picker and of threads: echoes prompts back and keeps
// sessions (list/load/close/delete, modes default|acceptEdits|auto) in a JSON file next to its cwd so a
// later process (the daemon spawns one per chat connection) sees the same threads. Speaks ACP v1 over stdio.
// The behaviour lives in packages/connector/test/fake-acp-agent.ts (shared with the unit tests).
import { Readable, Writable } from 'node:stream';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { buildFakeAgent } from '../../packages/connector/test/fake-acp-agent.ts';

const { app } = buildFakeAgent({ name: 'echo-agent', persistFile: join(process.cwd(), '.echo-agent-sessions.json') });
app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
