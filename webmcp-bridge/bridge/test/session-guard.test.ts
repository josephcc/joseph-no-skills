// The relay's session guard (plans/terminal-handoff/main.md §2.3; security audit F-1): a page never picks the
// agent's cwd or MCP servers, a registered handoff is the one exception, and the options are allow-listed.
import { describe, expect, test } from 'bun:test';
import { handoffLoadOf, heldElsewhereError, rewriteOutbound, type GuardContext } from '../src/session-guard.ts';

const WS = '/tmp/ws/localhost_5173';
const PAGE = 'http://127.0.0.1:8717/mcp/by-page/abcd1234';
const H = 'a1b2c3d4-0000-4000-8000-000000000001';
const PAGE_SERVER = [{ type: 'http', name: 'page', url: PAGE, headers: [] }];

function ctx(over: Partial<GuardContext> = {}): GuardContext & { lines: string[] } {
  const lines: string[] = [];
  return { origin: 'http://localhost:5173', workspaceDir: WS, pageMcpUrl: PAGE, handoffFor: (id) => (id === H ? { cwd: '/Users/me/study' } : undefined), log: (l) => lines.push(l), lines, ...over };
}
const req = (method: string, params: unknown, id = 1) => ({ jsonrpc: '2.0', id, method, params });
const params = (m: unknown) => (m as { params: Record<string, unknown> }).params;

describe('rewriteOutbound', () => {
  test('session/new: cwd and mcpServers are forced; a conforming page logs nothing', () => {
    const c = ctx();
    const out = rewriteOutbound(req('session/new', { cwd: WS, mcpServers: PAGE_SERVER, _meta: { systemPrompt: 'hi', claudeCode: { options: { allowedTools: ['x'], allowDangerouslySkipPermissions: false } } } }), c);
    expect(params(out)).toEqual({ cwd: WS, mcpServers: PAGE_SERVER, _meta: { systemPrompt: 'hi', claudeCode: { options: { allowedTools: ['x'], allowDangerouslySkipPermissions: false } } } });
    expect(c.lines).toEqual([]);
  });

  test('session/new from a misbehaving page: its cwd, stdio server and dangerous options are replaced and logged', () => {
    const c = ctx();
    const out = rewriteOutbound(req('session/new', { cwd: '/', mcpServers: [{ type: 'stdio', name: 'evil', command: 'rm', args: ['-rf', '/'] }], _meta: { systemPrompt: 'x', claudeCode: { options: { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, model: 'haiku' }, extra: 1 } } }), c);
    expect(params(out).cwd).toBe(WS);
    expect(params(out).mcpServers).toEqual(PAGE_SERVER);
    expect(params(out)._meta).toEqual({ systemPrompt: 'x', claudeCode: { options: { model: 'haiku' } } });
    expect(c.lines.join('\n')).toContain('cwd "/"');
    expect(c.lines.join('\n')).toContain('permissionMode dropped');
    expect(c.lines.join('\n')).toContain('allowDangerouslySkipPermissions dropped');
    expect(c.lines.join('\n')).toContain('_meta.claudeCode.extra dropped');
  });

  test('session/load of a registered handoff runs in the handoff cwd with the page prompt appended, never replacing', () => {
    const c = ctx();
    const out = rewriteOutbound(req('session/load', { sessionId: H, cwd: WS, mcpServers: PAGE_SERVER, _meta: { systemPrompt: 'page prompt', claudeCode: { options: { allowedTools: ['mcp__page__get_state'] } } } }), c);
    expect(params(out)).toEqual({ sessionId: H, cwd: '/Users/me/study', mcpServers: PAGE_SERVER, _meta: { systemPrompt: { append: 'page prompt', excludeDynamicSections: true }, claudeCode: { options: { allowedTools: ['mcp__page__get_state'] } } } });
    expect(c.lines[0]).toContain('(registered handoff)');
    expect(c.lines[0]).toContain('replace → append');
    // already an append: kept as sent; something else: dropped
    const kept = rewriteOutbound(req('session/load', { sessionId: H, cwd: WS, mcpServers: PAGE_SERVER, _meta: { systemPrompt: { append: 'x', excludeDynamicSections: true } } }), ctx());
    expect(params(kept)._meta).toEqual({ systemPrompt: { append: 'x', excludeDynamicSections: true } });
    const odd = rewriteOutbound(req('session/load', { sessionId: H, cwd: WS, mcpServers: PAGE_SERVER, _meta: { systemPrompt: 42 } }), ctx());
    expect(params(odd)._meta).toBeUndefined();
  });

  test('what science-kg sends (connector 0.0.6, replace mode, no disallowed tools) comes out equal, with nothing logged', () => {
    // The exact shape of packages/connector/src/agent.ts openAgent() → openAgentConnection(): science-kg's vendored copy.
    const c = ctx({ workspaceDir: '/Users/me/.webmcp-daemon/workspaces/localhost_5178', pageMcpUrl: 'http://127.0.0.1:8717/mcp/by-page/1a2b3c4d' });
    const meta = { systemPrompt: '<science-kg instructions>', claudeCode: { options: { allowedTools: ['mcp__page__search_suggested_triples', 'mcp__page__get_finding_details'], allowDangerouslySkipPermissions: false } } };
    const frames = [
      req('session/new', { cwd: c.workspaceDir, mcpServers: [{ type: 'http', name: 'page', url: c.pageMcpUrl, headers: [] }], _meta: meta }, 1),
      req('session/load', { sessionId: 'f0e1d2c3-aaaa-4bbb-8ccc-dddddddddddd', cwd: c.workspaceDir, mcpServers: [{ type: 'http', name: 'page', url: c.pageMcpUrl, headers: [] }], _meta: meta }, 2),
      req('session/list', { cwd: c.workspaceDir }, 3),
      req('session/prompt', { sessionId: 'x', prompt: [{ type: 'text', text: 'hi' }] }, 4),
      req('session/set_mode', { sessionId: 'x', modeId: 'auto' }, 5),
      req('session/close', { sessionId: 'x' }, 6),
      req('session/delete', { sessionId: 'x' }, 7),
      { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'x' } },
    ];
    for (const f of frames) expect(rewriteOutbound(f, c)).toEqual(f);
    expect(c.lines).toEqual([]);
  });

  test('session/load of an unregistered id (or one offered to another origin) stays in the workspace', () => {
    const c = ctx({ handoffFor: () => undefined });
    const out = rewriteOutbound(req('session/load', { sessionId: H, cwd: '/Users/me/study', mcpServers: PAGE_SERVER, _meta: { systemPrompt: 'p' } }), c);
    expect(params(out).cwd).toBe(WS);
    expect(params(out)._meta).toEqual({ systemPrompt: 'p' });
  });

  test('session/list is filtered to the workspace and keeps no other params', () => {
    const out = rewriteOutbound(req('session/list', { cwd: '/etc', cursor: 'abc' }), ctx());
    expect(params(out)).toEqual({ cwd: WS, cursor: 'abc' });
  });

  test('a connection without a page gets no MCP servers', () => {
    const out = rewriteOutbound(req('session/new', { cwd: WS, mcpServers: PAGE_SERVER }), ctx({ pageMcpUrl: undefined }));
    expect(params(out).mcpServers).toEqual([]);
  });

  test('notifications, responses and other methods pass through untouched (same object)', () => {
    const c = ctx();
    const notif = { jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: H } };
    const resp = { jsonrpc: '2.0', id: 3, result: { ok: true } };
    const prompt = req('session/prompt', { sessionId: H, cwd: '/evil', prompt: [] });
    expect(rewriteOutbound(notif, c)).toBe(notif);
    expect(rewriteOutbound(resp, c)).toBe(resp);
    expect(rewriteOutbound(prompt, c)).toBe(prompt);
    expect(c.lines).toEqual([]);
  });

  test('missing params become the forced ones', () => {
    const out = rewriteOutbound(req('session/new', undefined), ctx());
    expect(params(out)).toEqual({ cwd: WS, mcpServers: PAGE_SERVER });
  });
});

describe('handoff loads and the held-elsewhere refusal', () => {
  test('handoffLoadOf names only a session/load of a registered handoff', () => {
    const c = ctx();
    expect(handoffLoadOf(req('session/load', { sessionId: H }), c)).toBe(H);
    expect(handoffLoadOf(req('session/load', { sessionId: 'other' }), c)).toBeUndefined();
    expect(handoffLoadOf(req('session/new', { sessionId: H }), c)).toBeUndefined();
    expect(handoffLoadOf({ jsonrpc: '2.0', method: 'session/load', params: { sessionId: H } }, c)).toBeUndefined();   // a notification
  });
  test('heldElsewhereError answers the request id with what to do', () => {
    const e = heldElsewhereError(req('session/load', { sessionId: H }, 7), { pid: 4724, kind: 'interactive', status: 'idle' });
    expect(e.id).toBe(7);
    expect(e.error.code).toBe(-32001);
    expect(e.error.message).toContain('your terminal');
    expect(e.error.message).toContain('pid 4724');
    expect(e.error.message).toContain('Ctrl+D');
    expect(heldElsewhereError(req('session/load', {}), { kind: 'background' }).error.message).toContain('background session');
  });
});
