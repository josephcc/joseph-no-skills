import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OriginPolicy } from '../src/security.ts';

describe('OriginPolicy', () => {
  test('pre-approved origins pass; unknown origins are rejected under --no-browser', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'webmcp-'));
    const p = new OriginPolicy(dir, ['http://127.0.0.1:5173'], true, 'http://127.0.0.1:1', () => { throw new Error('must not open'); });
    expect(await p.decide('http://127.0.0.1:5173')).toBe(true);
    expect(await p.decide('https://evil.example')).toBe(false);
  });

  test('approval flow: opener receives the URL, settle resolves, remembered decisions persist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'webmcp-'));
    const opened: string[] = [];
    const p = new OriginPolicy(dir, [], false, 'http://127.0.0.1:1', (url) => opened.push(url));
    const decision = p.decide('https://app.example', 'App');
    await new Promise((r) => setTimeout(r, 5));
    expect(opened).toHaveLength(1);
    const id = new URL(opened[0]!).searchParams.get('id')!;
    expect(p.pending(id)).toEqual({ origin: 'https://app.example', title: 'App' });
    expect(p.settle(id, true, true)).toBe(true);
    expect(await decision).toBe(true);
    expect(p.isAllowed('https://app.example')).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'origins.json'), 'utf8'))).toEqual({ allowed: ['https://app.example'], denied: [] });
    // a second policy instance reads the store back
    const p2 = new OriginPolicy(dir, [], true, 'http://127.0.0.1:1');
    expect(await p2.decide('https://app.example')).toBe(true);
    p2.forget('https://app.example');
    expect(await p2.decide('https://app.example')).toBe(false);
  });

  test('denied + remembered → denied without opening again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'webmcp-'));
    const opened: string[] = [];
    const p = new OriginPolicy(dir, [], false, 'http://127.0.0.1:1', (url) => opened.push(url));
    const d = p.decide('https://x.example');
    await new Promise((r) => setTimeout(r, 5));
    p.settle(new URL(opened[0]!).searchParams.get('id')!, false, true);
    expect(await d).toBe(false);
    expect(await p.decide('https://x.example')).toBe(false);
    expect(opened).toHaveLength(1);
  });
});
