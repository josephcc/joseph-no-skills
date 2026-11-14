import { describe, expect, test } from 'bun:test';
import { errorResult, normaliseResult, sanitiseToolName } from '../src/normalise.ts';

describe('normaliseResult', () => {
  test('null → navigation note', () => {
    expect(normaliseResult(null).content[0]?.text).toContain('navigation');
  });
  test('plain string passes through as text', () => {
    expect(normaliseResult('ok: changed')).toEqual({ content: [{ type: 'text', text: 'ok: changed' }] });
  });
  test('JSON object → pretty text + structuredContent', () => {
    const r = normaliseResult('{"ok":true,"backgroundColor":"teal"}');
    expect(r.structuredContent).toEqual({ ok: true, backgroundColor: 'teal' });
    expect(r.content[0]?.text).toContain('"backgroundColor": "teal"');
  });
  test('MCP-shaped object passes through untouched', () => {
    const r = normaliseResult('{"content":[{"type":"text","text":"hi"}],"isError":false}');
    expect(r).toEqual({ content: [{ type: 'text', text: 'hi' }], isError: false });
  });
  test('arrays and scalars become text', () => {
    expect(normaliseResult('[1,2]').content[0]?.text).toBe('[\n  1,\n  2\n]');
    expect(normaliseResult('42').content[0]?.text).toBe('42');
    expect(normaliseResult('true').content[0]?.text).toBe('true');
  });
  test('errorResult', () => {
    expect(errorResult('get_state', { name: 'NotFoundError', message: 'no page' })).toEqual({ isError: true, content: [{ type: 'text', text: 'get_state: NotFoundError: no page' }] });
  });
  test('sanitiseToolName', () => {
    expect(sanitiseToolName('graph.select node')).toBe('graph_select_node');
    expect(sanitiseToolName('ok_name-1')).toBe('ok_name-1');
  });
});
