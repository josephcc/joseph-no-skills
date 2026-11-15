// The relay's session guard (plans/terminal-handoff/main.md §2.3; security audit F-1): a page never picks the
// agent's cwd or MCP servers, a registered handoff is the one exception, and the options are allow-listed.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DELETE_REFUSED_CODE, HELD_ELSEWHERE_CODE, encodeProjectPath, handoffLoadOf, heldElsewhereError, recordedCwd, refusedDelete, rewriteOutbound, sessionBelongsToWorkspace, type GuardContext } from '../src/session-guard.ts';

const WS = '/tmp/ws/localhost_5173';
const PAGE = 'http://127.0.0.1:8737/mcp/by-page/abcd1234';
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
    const out = rewriteOutbound(req('session/new', { cwd: WS, mcpServers: PAGE_SERVER, _meta: { systemPrompt: 'hi', claudeCode: { options: { allowedTools: ['mcp__page__x'], allowDangerouslySkipPermissions: false } } } }), c);
    expect(params(out)).toEqual({ cwd: WS, mcpServers: PAGE_SERVER, _meta: { systemPrompt: 'hi', claudeCode: { options: { allowedTools: ['mcp__page__x'], allowDangerouslySkipPermissions: false } } } });
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
    const c = ctx({ workspaceDir: '/Users/me/.webmcp-bridge/workspaces/localhost_5178', pageMcpUrl: 'http://127.0.0.1:8737/mcp/by-page/1a2b3c4d' });
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

  test('a null id is still a request to the SDK, so it is guarded; a guarded method with no id at all is dropped (follow-up audit)', () => {
    const c = ctx();
    const nullId = { jsonrpc: '2.0', id: null, method: 'session/new', params: { cwd: '/evil', systemPrompt: 'x', mcpServers: [{ type: 'stdio', command: 'rm' }] } };
    expect(params(rewriteOutbound(nullId, c))).toEqual({ cwd: WS, mcpServers: PAGE_SERVER });
    const noId = { jsonrpc: '2.0', method: 'session/load', params: { sessionId: H, cwd: '/evil' } };
    expect(rewriteOutbound(noId, c)).toBeUndefined();
    expect(c.lines.join('\n')).toContain('session/load without an id dropped');
    expect(handoffLoadOf(nullId, c)).toBeUndefined();
    expect(handoffLoadOf({ jsonrpc: '2.0', id: null, method: 'session/load', params: { sessionId: H } }, c)).toBe(H);
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
    expect(e.error.code).toBe(HELD_ELSEWHERE_CODE);
    expect([HELD_ELSEWHERE_CODE, DELETE_REFUSED_CODE]).not.toContain(-32002);   // the SDK's client reads -32002 on session/delete as success
    expect(e.error.message).toContain('your terminal');
    expect(e.error.message).toContain('pid 4724');
    expect(e.error.message).toContain('Ctrl+D');
    expect(heldElsewhereError(req('session/load', {}), { kind: 'background' }).error.message).toContain('background session');
  });
});

describe('the guard rebuilds a request from the allowed fields (Codex audit, 2026-11-14)', () => {
  test('a top-level systemPrompt, additionalDirectories and _meta.additionalRoots never reach the adapter', () => {
    const c = ctx();
    const out = rewriteOutbound(req('session/load', { sessionId: H, cwd: WS, mcpServers: PAGE_SERVER, systemPrompt: 'REPLACE ME', additionalDirectories: ['/'], _meta: { systemPrompt: 'page', additionalRoots: ['/etc'], claudeCode: { options: {} } } }), c);
    expect(params(out)).toEqual({ sessionId: H, cwd: '/Users/me/study', mcpServers: PAGE_SERVER, _meta: { systemPrompt: { append: 'page', excludeDynamicSections: true }, claudeCode: { options: {} } } });
    expect(c.lines.join('\n')).toContain('systemPrompt dropped');
    expect(c.lines.join('\n')).toContain('additionalDirectories dropped');
    expect(c.lines.join('\n')).toContain('_meta.additionalRoots dropped');
    const fresh = rewriteOutbound(req('session/new', { cwd: WS, mcpServers: PAGE_SERVER, additionalDirectories: ['/'], anythingElse: 1 }), ctx());
    expect(params(fresh)).toEqual({ cwd: WS, mcpServers: PAGE_SERVER });
  });

  test('allowedTools keeps only the page\'s own tools; disallowedTools only strings; model only a string', () => {
    const c = ctx();
    const out = rewriteOutbound(req('session/new', { cwd: WS, mcpServers: PAGE_SERVER, _meta: { claudeCode: { options: { allowedTools: ['Bash', 'mcp__page__get_state', 'Edit', 42], disallowedTools: ['WebFetch', 7], model: { evil: true } } } } }), c);
    expect(params(out)._meta).toEqual({ claudeCode: { options: { allowedTools: ['mcp__page__get_state'], disallowedTools: ['WebFetch'] } } });
    expect(c.lines.join('\n')).toContain("allowedTools: only the page's own tools kept");
    expect(c.lines.join('\n')).toContain('model dropped');
  });

  test('a JSON-RPC batch is not a request: passed through for the adapter to refuse', () => {
    const batch = [req('session/new', { cwd: '/evil' })];
    expect(rewriteOutbound(batch, ctx())).toBe(batch);
  });
});

describe('session/delete', () => {
  test('is refused unless the session is one of the page\'s own threads', () => {
    const owned = ctx({ ownsSession: (id) => id === 'f0e1d2c3-aaaa-4bbb-8ccc-dddddddddddd' });
    expect(refusedDelete(req('session/delete', { sessionId: 'f0e1d2c3-aaaa-4bbb-8ccc-dddddddddddd' }, 9), owned)).toBeUndefined();
    const refused = refusedDelete(req('session/delete', { sessionId: H }, 9), owned) as { id: unknown; error: { code: number; message: string } };
    expect(refused.id).toBe(9);
    expect(refused.error.code).toBe(DELETE_REFUSED_CODE);
    expect(refused.error.message).toContain('never deleted');
    expect((refusedDelete(req('session/delete', { sessionId: H }, 9), ctx({ ownsSession: undefined })) as { error: { code: number } }).error.code).toBe(DELETE_REFUSED_CODE);   // no way to tell → refused
    // a registered handoff is refused even when the ownership check would pass (a colliding project directory)
    const colliding = ctx({ ownsSession: () => true, isHandoff: (id) => id === H });
    expect((refusedDelete(req('session/delete', { sessionId: H }, 9), colliding) as { error: { code: number } }).error.code).toBe(DELETE_REFUSED_CODE);
    expect(refusedDelete(req('session/delete', { sessionId: 'f0e1d2c3-aaaa-4bbb-8ccc-dddddddddddd' }, 9), colliding)).toBeUndefined();
    expect(refusedDelete(req('session/close', { sessionId: H }), owned)).toBeUndefined();
    // a null id is answered (with a null id); no id at all is dropped rather than forwarded as a notification
    expect((refusedDelete({ jsonrpc: '2.0', id: null, method: 'session/delete', params: { sessionId: H } }, owned) as { id: unknown }).id).toBeNull();
    expect(refusedDelete({ jsonrpc: '2.0', method: 'session/delete', params: { sessionId: H } }, owned)).toBe('drop');
  });

  test('sessionBelongsToWorkspace needs the file under the workspace\'s project directory AND the recorded cwd to match', () => {
    const cfg = mkdtempSync(join(tmpdir(), 'webmcp-guard-cfg-'));
    try {
      const ws = '/Users/me/.webmcp-bridge/workspaces/localhost_47821';
      const dir = join(cfg, 'projects', ws.replace(/[^a-zA-Z0-9]/g, '-'));
      mkdirSync(dir, { recursive: true });
      const line = (cwd: string) => JSON.stringify({ type: 'user', cwd, sessionId: 'x', message: { role: 'user', content: 'hi "cwd":"/decoy"' } }) + '\n';
      writeFileSync(join(dir, 'f0e1d2c3-aaaa-4bbb-8ccc-dddddddddddd.jsonl'), '{"type":"permission-mode","permissionMode":"auto"}\n' + line(ws));
      writeFileSync(join(dir, 'a1a1a1a1-aaaa-4bbb-8ccc-dddddddddddd.jsonl'), line('/Users/me/.webmcp-bridge/workspaces/localhost.47821'));   // same project dir name, another cwd
      writeFileSync(join(dir, 'b2b2b2b2-aaaa-4bbb-8ccc-dddddddddddd.jsonl'), '{"type":"mode","mode":"x"}\n');   // no cwd recorded
      expect(sessionBelongsToWorkspace('F0E1D2C3-AAAA-4BBB-8CCC-DDDDDDDDDDDD', ws, cfg)).toBe(true);
      expect(sessionBelongsToWorkspace('a1a1a1a1-aaaa-4bbb-8ccc-dddddddddddd', ws, cfg)).toBe(false);
      expect(sessionBelongsToWorkspace('b2b2b2b2-aaaa-4bbb-8ccc-dddddddddddd', ws, cfg)).toBe(false);
      expect(sessionBelongsToWorkspace(H, ws, cfg)).toBe(false);
      expect(sessionBelongsToWorkspace('../../etc/passwd', ws, cfg)).toBe(false);
      expect(recordedCwd(join(dir, 'f0e1d2c3-aaaa-4bbb-8ccc-dddddddddddd.jsonl'))).toBe(ws);
      expect(recordedCwd(join(dir, 'missing.jsonl'))).toBeUndefined();
    } finally { rmSync(cfg, { recursive: true, force: true }); }
  });

  test('a workspace reached through a symlink: the transcript sits under the real path\'s project directory and is still the page\'s', () => {
    const base = mkdtempSync(join(tmpdir(), 'webmcp-guard-sym-'));
    try {
      const real = join(base, 'real', 'workspaces', 'localhost_47821'); mkdirSync(real, { recursive: true });
      mkdirSync(join(base, 'link')); symlinkSync(join(base, 'real'), join(base, 'link', 'state'));
      const viaLink = join(base, 'link', 'state', 'workspaces', 'localhost_47821');
      const resolved = realpathSync(real);   // what a process started there reports as its cwd
      const cfg = join(base, 'cfg'); const dir = join(cfg, 'projects', encodeProjectPath(resolved)); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'c3c3c3c3-aaaa-4bbb-8ccc-dddddddddddd.jsonl'), JSON.stringify({ type: 'user', cwd: resolved }) + '\n');
      expect(sessionBelongsToWorkspace('c3c3c3c3-aaaa-4bbb-8ccc-dddddddddddd', viaLink, cfg)).toBe(true);
      expect(sessionBelongsToWorkspace('c3c3c3c3-aaaa-4bbb-8ccc-dddddddddddd', join(base, 'real', 'workspaces', 'other'), cfg)).toBe(false);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  test('a long workspace path whose hash suffix differs from ours is still found by its 200-character prefix', () => {
    const cfg = mkdtempSync(join(tmpdir(), 'webmcp-guard-long-'));
    try {
      const ws = '/w/' + 'z'.repeat(230);
      const prefix = ws.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200);
      const other = join(cfg, 'projects', `${prefix}-differenthash`); mkdirSync(other, { recursive: true });
      writeFileSync(join(other, 'd4d4d4d4-aaaa-4bbb-8ccc-dddddddddddd.jsonl'), JSON.stringify({ type: 'user', cwd: ws }) + '\n');
      expect(sessionBelongsToWorkspace('d4d4d4d4-aaaa-4bbb-8ccc-dddddddddddd', ws, cfg)).toBe(true);
      // the same file under a prefix-matching directory but recorded for another cwd is not the workspace's
      writeFileSync(join(other, 'e5e5e5e5-aaaa-4bbb-8ccc-dddddddddddd.jsonl'), JSON.stringify({ type: 'user', cwd: ws + 'q' }) + '\n');
      expect(sessionBelongsToWorkspace('e5e5e5e5-aaaa-4bbb-8ccc-dddddddddddd', ws, cfg)).toBe(false);
    } finally { rmSync(cfg, { recursive: true, force: true }); }
  });

  test('encodeProjectPath matches the adapter: sanitised, and hashed past 200 characters', () => {
    expect(encodeProjectPath('/Users/me/.webmcp-bridge/workspaces/localhost_47821')).toBe('-Users-me--webmcp-bridge-workspaces-localhost-47821');
    const long = '/a/' + 'x'.repeat(260);
    const enc = encodeProjectPath(long);
    expect(enc.length).toBeLessThan(220);
    expect(enc.startsWith('-a-' + 'x'.repeat(197))).toBe(true);
    expect(enc).toMatch(/-[0-9a-z]+$/);
    expect(encodeProjectPath(long + 'y')).not.toBe(enc);
  });
});
