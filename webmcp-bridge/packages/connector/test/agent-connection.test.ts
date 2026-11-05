import { describe, expect, test } from 'bun:test';
import { openAgentConnection, type ThreadInfo } from '../src/agent-connection.ts';
import { startFakeAgent, type FakeAgentOptions } from './fake-acp-agent.ts';
import type { SessionModel } from '../src/session-model.ts';

const CWD = '/tmp/fake-workspace';
async function open(agentOpts: FakeAgentOptions = {}, connOpts: Partial<Parameters<typeof openAgentConnection>[0]> = {}) {
  const fake = startFakeAgent(agentOpts);
  const conn = await openAgentConnection({ stream: fake.stream, agentId: 'fake', cwd: CWD, mcpServers: [], meta: { systemPrompt: 'test' }, readOnlyTools: ['mcp__page__get_state'], ...connOpts });
  return { fake, conn };
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const texts = (m: SessionModel) => m.snapshot().turns.flatMap((t) => t.items).filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
const methods = (fake: { calls: Array<{ method: string }> }) => fake.calls.map((c) => c.method);
const byId = (threads: ThreadInfo[], id: string) => threads.find((t) => t.id === id);

describe('AgentConnection', () => {
  test('1. a new thread starts in the default mode when the agent offers it', async () => {
    const { fake, conn } = await open();
    const h = await conn.openThread();
    expect(methods(fake).filter((m) => m === 'session/set_mode')).toHaveLength(1);
    expect(fake.calls.find((c) => c.method === 'session/set_mode')?.params.modeId).toBe('auto');
    expect(h.model.snapshot().modes?.current).toBe('auto');
    expect(fake.store.get(h.sessionId)?.mode).toBe('auto');
    expect(conn.supportsThreads).toBe(true);
    expect(conn.active).toBe(h);
    conn.close();
  });

  test('1b. no set_mode when the agent lacks that mode, has no modes, or the default is null', async () => {
    const a = await open({ modes: ['default', 'plan'] });
    const h1 = await a.conn.openThread();
    expect(methods(a.fake)).not.toContain('session/set_mode');
    expect(h1.model.snapshot().modes?.current).toBe('default');
    a.conn.close();
    const b = await open({ modes: null });
    await b.conn.openThread();
    expect(methods(b.fake)).not.toContain('session/set_mode');
    b.conn.close();
    const c = await open({}, { defaultMode: null });
    await c.conn.openThread();
    expect(methods(c.fake)).not.toContain('session/set_mode');
    c.conn.close();
  });

  test('2. listThreads: stored threads newest first with titles; a live unstored thread stays on top; titles patch in', async () => {
    const { conn } = await open();
    const first = await conn.openThread();
    expect(conn.threads).toHaveLength(1);
    expect(conn.threads[0]!.state).toBe('ready');
    expect(conn.threads[0]!.title).toBeUndefined();
    await first.prompt('hello one');
    expect(byId(conn.threads, first.sessionId)?.title).toBe('hello one');   // from session_info_update
    await tick();
    const second = await conn.openThread();
    await second.prompt('hello two');
    const list = await conn.listThreads();
    expect(list.map((t) => t.id)).toEqual([second.sessionId, first.sessionId]);
    expect(list.map((t) => t.state)).toEqual(['ready', 'stored']);
    expect(list[1]!.title).toBe('hello one');
    const third = await conn.openThread();
    const t3 = byId(conn.threads, third.sessionId)!;
    expect(conn.threads[0]!.id).toBe(third.sessionId);
    expect(t3.state).toBe('ready'); expect(t3.active).toBe(true); expect(t3.title).toBeUndefined();
    conn.close();
  });

  test('3. switching away from an idle thread closes it; loading replays into a fresh model', async () => {
    const { fake, conn } = await open();
    const actives: Array<string | undefined> = [];
    conn.onActiveChange((h) => actives.push(h?.sessionId));
    const a = await conn.openThread();
    await a.prompt('first message');
    const b = await conn.openThread();
    await tick();
    expect(fake.calls.filter((c) => c.method === 'session/close').map((c) => c.params.sessionId)).toEqual([a.sessionId]);
    expect(a.model.snapshot().state).toBe('closed');
    expect(fake.loaded.has(a.sessionId)).toBe(false);
    const a2 = await conn.openThread(a.sessionId);
    expect(a2).not.toBe(a);
    expect(a2.model).not.toBe(a.model);
    expect(texts(a2.model)).toEqual(['first message', 'echo: first message']);
    expect(a2.model.snapshot().modes?.current).toBe('auto');   // the mode stored with the thread, not re-set
    expect(fake.calls.filter((c) => c.method === 'session/set_mode')).toHaveLength(2);   // one per new thread, none for the load
    await tick();   // the previous thread is released after the switch, without blocking it
    expect(fake.calls.filter((c) => c.method === 'session/close').map((c) => c.params.sessionId)).toEqual([a.sessionId, b.sessionId]);
    expect(actives).toEqual([a.sessionId, b.sessionId, a.sessionId]);
    expect(await conn.openThread(a.sessionId)).toBe(a2);   // already active: same handle, no load
    expect(fake.calls.filter((c) => c.method === 'session/load')).toHaveLength(1);
    conn.close();
  });

  test('4. keep-while-prompting: a thread mid-turn stays live in the background and is closed after its turn', async () => {
    const { fake, conn } = await open();
    const a = await conn.openThread();
    const turn = a.prompt('slow question');
    await tick();
    const b = await conn.openThread();
    expect(methods(fake)).not.toContain('session/close');
    expect(byId(conn.threads, a.sessionId)?.state).toBe('prompting');
    expect(byId(conn.threads, b.sessionId)?.active).toBe(true);
    fake.release(a.sessionId);
    const r = await turn;
    expect(r.stopReason).toBe('end_turn');
    expect(texts(a.model)).toEqual(['slow question', 'echo: slow question']);
    expect(texts(b.model)).toEqual([]);
    await tick();
    expect(fake.calls.filter((c) => c.method === 'session/close').map((c) => c.params.sessionId)).toEqual([a.sessionId]);
    expect(byId(conn.threads, a.sessionId)?.state).toBe('stored');
    conn.close();
  });

  test('4b. switching back to a background thread keeps it (no reload, no close)', async () => {
    const { fake, conn } = await open();
    const a = await conn.openThread();
    const turn = a.prompt('slow one');
    await tick();
    await conn.openThread();
    const again = await conn.openThread(a.sessionId);
    expect(again).toBe(a);
    fake.release(a.sessionId);
    await turn;
    await tick();
    expect(methods(fake)).not.toContain('session/load');
    expect(fake.calls.filter((c) => c.method === 'session/close').map((c) => c.params.sessionId)).not.toContain(a.sessionId);
    expect(a.model.snapshot().state).toBe('ready');
    conn.close();
  });

  test('4c. close policy: switching cancels and closes the previous thread at once', async () => {
    const { fake, conn } = await open({}, { switchPolicy: 'close' });
    const a = await conn.openThread();
    const turn = a.prompt('slow one');
    await tick();
    await conn.openThread();
    await tick();
    expect(fake.calls.filter((c) => c.method === 'session/close').map((c) => c.params.sessionId)).toEqual([a.sessionId]);
    const r = await turn;
    expect(r.stopReason).toBe('cancelled');
    expect(a.model.snapshot().state).toBe('closed');
    conn.close();
  });

  test('5. a permission request lands in its own thread and marks it needs-permission', async () => {
    const { conn } = await open();
    const a = await conn.openThread();
    const turn = a.prompt('please ask me first');
    await tick();
    expect(a.model.snapshot().pendingPermissions).toHaveLength(1);
    expect(byId(conn.threads, a.sessionId)?.state).toBe('needs-permission');
    const b = await conn.openThread();   // switch away while a waits: it stays live
    expect(b.model.snapshot().pendingPermissions).toHaveLength(0);
    expect(byId(conn.threads, a.sessionId)?.state).toBe('needs-permission');
    a.model.snapshot().pendingPermissions[0]!.respond('yes');
    const r = await turn;
    expect(r.stopReason).toBe('end_turn');
    expect(texts(a.model)).toEqual(['please ask me first', 'note written']);
    conn.close();
  });

  test('5b. read-only page tools are auto-approved without touching the model', async () => {
    const { conn } = await open();
    const a = await conn.openThread();
    const turn = a.prompt('ask');   // the fake names its tool "Write": not read-only here
    await tick();
    expect(a.model.snapshot().pendingPermissions).toHaveLength(1);
    a.model.snapshot().pendingPermissions[0]!.respond('no');
    await turn;
    conn.close();
    const { conn: c2 } = await open({}, { readOnlyTools: ['Write'] });
    const b = await c2.openThread();
    const r = await b.prompt('ask again');
    expect(r.stopReason).toBe('end_turn');
    expect(texts(b.model)).toEqual(['ask again', 'note written']);
    c2.setAutoAllowReadOnly(false);
    const turn2 = b.prompt('ask once more');
    await tick();
    expect(b.model.snapshot().pendingPermissions).toHaveLength(1);
    b.model.snapshot().pendingPermissions[0]!.respond('no');
    await turn2;
    c2.close();
  });

  test('6. deleteThread removes a stored thread, closing it first when live; refuses while prompting', async () => {
    const { fake, conn } = await open();
    const a = await conn.openThread();
    await a.prompt('to be deleted');
    const b = await conn.openThread();
    await b.prompt('stays');
    expect((await conn.listThreads()).map((t) => t.id).sort()).toEqual([a.sessionId, b.sessionId].sort());
    await conn.deleteThread(a.sessionId);
    expect(conn.threads.map((t) => t.id)).toEqual([b.sessionId]);
    expect(fake.store.has(a.sessionId)).toBe(false);
    const turn = b.prompt('slow');
    await tick();
    await expect(conn.deleteThread(b.sessionId)).rejects.toThrow(/stop the thread/);
    fake.release(b.sessionId);
    await turn;
    await conn.deleteThread(b.sessionId);
    expect(conn.active).toBeUndefined();
    expect(b.model.snapshot().state).toBe('closed');
    expect(methods(fake).filter((m) => m === 'session/delete')).toHaveLength(2);
    conn.close();
  });

  test('7. an agent without loadSession or list has no threads; loading rejects; the rest works', async () => {
    const { conn } = await open({ loadSession: false, list: false, close: false, delete: false });
    expect(conn.supportsThreads).toBe(false);
    expect(conn.supportsDelete).toBe(false);
    const a = await conn.openThread();
    await a.prompt('hi');
    expect(texts(a.model)).toEqual(['hi', 'echo: hi']);
    await expect(conn.openThread('nope')).rejects.toThrow(/cannot resume/);
    expect(conn.active).toBe(a);   // a failed open leaves the active thread alone
    await expect(conn.deleteThread(a.sessionId)).rejects.toThrow(/cannot delete/);
    expect(await conn.listThreads()).toHaveLength(1);
    conn.close();
  });

  test('8. closing the connection ends every thread; a dropped connection reports an error', async () => {
    const { conn } = await open();
    const a = await conn.openThread();
    const closes: Array<string | undefined> = [];
    conn.onClose((r) => closes.push(r));
    conn.close();
    expect(conn.closed).toBe(true);
    expect(a.model.snapshot().state).toBe('closed');
    expect(conn.active).toBeUndefined();
    expect(closes).toEqual([undefined]);
    await expect(conn.openThread()).rejects.toThrow(/closed/);
    const second = await open();
    const b = await second.conn.openThread();
    const dropped: Array<string | undefined> = [];
    second.conn.onClose((r) => dropped.push(r));
    second.fake.dropAgent(new Error('boom'));   // the agent's end goes away
    await tick(50);
    expect(second.conn.closed).toBe(true);
    expect(b.model.snapshot().state).toBe('error');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatch(/closed/);
  });
});

describe('connectAgent (compat)', () => {
  test('resumes a stored thread, falls back to a new one, and close() closes the connection', async () => {
    const { connectAgent } = await import('../src/agent.ts');
    const fake = startFakeAgent();
    const page = fakePage();
    const h1 = await connectAgent(page, { stream: fake.stream });
    await h1.prompt('remember me');
    const id = h1.sessionId;
    expect(h1.model.snapshot().modes?.current).toBe('auto');
    h1.close();
    expect(h1.connection.closed).toBe(true);
    const fake2 = startFakeAgent();
    for (const s of fake.store.values()) fake2.store.set(s.id, s);   // same "disk"
    const h2 = await connectAgent(page, { stream: fake2.stream, resumeSessionId: id });
    expect(h2.sessionId).toBe(id);
    expect(texts(h2.model)).toEqual(['remember me', 'echo: remember me']);
    h2.close();
    const fake3 = startFakeAgent();
    const h3 = await connectAgent(page, { stream: fake3.stream, resumeSessionId: 'missing' });
    expect(h3.sessionId).not.toBe('missing');
    expect(h3.model.snapshot().state).toBe('ready');
    h3.close();
  });
});

function fakePage(): any {
  return {
    status: { state: 'connected', acpUrl: 'ws://127.0.0.1:1/acp?page=x', workspaceDir: CWD, mcpUrl: 'http://127.0.0.1:1/mcp/by-page/x', attempts: 0, toolCount: 0 },
    settings: { instructions: 'test prompt' },
    modelContext: { getTools: async () => [] },
    usingShim: true,
  };
}
