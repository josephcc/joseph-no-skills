import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspaces } from '../src/workspace.ts';

describe('Workspaces', () => {
  test('a new workspace starts embedded chats in auto mode with bypass disabled, and never rewrites an existing settings file (D-37)', () => {
    const state = mkdtempSync(join(tmpdir(), 'webmcp-ws-'));
    const ws = new Workspaces(state);
    const page = { slug: '127.0.0.1_5173', origin: 'http://127.0.0.1:5173', title: 'Demo' };
    const dir = ws.ensure(page);
    const settings = join(dir, '.claude', 'settings.json');
    const first = JSON.parse(readFileSync(settings, 'utf8'));
    expect(first.permissions.defaultMode).toBe('auto');
    expect(first.permissions.disableBypassPermissionsMode).toBe('disable');
    writeFileSync(settings, JSON.stringify({ permissions: { defaultMode: 'default' } }));
    ws.ensure(page);
    expect(JSON.parse(readFileSync(settings, 'utf8')).permissions.defaultMode).toBe('default');
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('http://127.0.0.1:5173');
  });
});
