import { describe, expect, test } from 'bun:test';
import { ACTIVITY_MAX_ENTRIES, createActivityLog, deepEqual, lookupWidget, pageToolOf, parseJson, resultTextOf, sanitiseToolName, unfence, widgetInstanceOf, widgetInstanceOfCall } from '../src/widgets.ts';
import type { ToolCallItem } from '../src/session-model.ts';

const item = (over: Partial<ToolCallItem>): ToolCallItem => ({ kind: 'tool_call', toolCallId: 'toolu_1', title: 'mcp__page__propose_palette', name: 'mcp__page__propose_palette', status: 'completed', content: [], ...over });
const textContent = (text: string) => [{ type: 'content', content: { type: 'text', text } }];

describe('widgets: routing', () => {
  test('pageToolOf strips the page prefixes, reads the Claude meta as a fallback, ignores other tools', () => {
    expect(pageToolOf({ name: 'mcp__page__get_state' })).toBe('get_state');
    expect(pageToolOf({ name: 'mcp__webmcp__a_b' })).toBe('a_b');
    expect(pageToolOf({ meta: { claudeCode: { toolName: 'mcp__page__x' } } })).toBe('x');
    expect(pageToolOf({ title: 'mcp__page__from_title' })).toBe('from_title');
    expect(pageToolOf({ name: 'Bash' })).toBeUndefined();
    expect(pageToolOf({ name: 'mcp__other__tool' })).toBeUndefined();
    expect(pageToolOf({ name: 'mcp__page__' })).toBeUndefined();
    expect(pageToolOf({})).toBeUndefined();
  });

  test('lookupWidget matches the registered name or its sanitised spelling in either direction', () => {
    expect(sanitiseToolName('a.b c')).toBe('a_b_c');
    const map = { 'a.b': 'dotted', plain: 'plain' };
    expect(lookupWidget(map, 'a.b')).toBe('dotted');
    expect(lookupWidget(map, 'a_b')).toBe('dotted');      // the mirrored spelling the transcript carries
    expect(lookupWidget({ a_b: 'u' }, 'a.b')).toBe('u');  // registered sanitised, asked for raw
    expect(lookupWidget(map, 'plain')).toBe('plain');
    expect(lookupWidget(map, 'missing')).toBeUndefined();
    expect(lookupWidget(undefined, 'plain')).toBeUndefined();
    expect(lookupWidget(map, 'toString')).toBeUndefined();   // prototype members are not widgets
  });
});

describe('widgets: instances from transcript items', () => {
  test('a completed item with JSON text: tool, input, text, parsed output, not restored', () => {
    const w = widgetInstanceOf(item({ rawInput: { story: 'warm', options: [1] }, content: textContent('{\n  "card": "p1",\n  "n": 2\n}') }), { sessionId: 's1' });
    expect(w).toMatchObject({ tool: 'propose_palette', id: 'toolu_1', status: 'completed', input: { story: 'warm', options: [1] }, output: { card: 'p1', n: 2 }, source: 'chat', sessionId: 's1', restored: false });
    expect(w.text).toContain('"card": "p1"');
    expect(w.error).toBeUndefined();
  });

  test('plain text results keep text and leave output undefined; rawOutput is the fallback', () => {
    expect(widgetInstanceOf(item({ content: textContent('tool triggered a navigation; no result') }))).toMatchObject({ text: 'tool triggered a navigation; no result', output: undefined });
    expect(resultTextOf(item({ content: [], rawOutput: 'raw string' }))).toBe('raw string');
    expect(resultTextOf(item({ content: [], rawOutput: [{ type: 'text', text: 'from array' }] }))).toBe('from array');
    expect(resultTextOf(item({ content: [], rawOutput: { content: [{ type: 'text', text: 'from object' }] } }))).toBe('from object');
    expect(resultTextOf(item({ content: [], rawOutput: { ok: true } }))).toBe('{"ok":true}');
    expect(resultTextOf(item({ content: [] }))).toBeUndefined();
  });

  test('a failed item carries the error without the adapter code fence; pending items carry nothing yet', () => {
    const failed = widgetInstanceOf(item({ status: 'failed', content: textContent('```\npropose_palette: NotFoundError: no tool named propose_palette\n```') }));
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('propose_palette: NotFoundError: no tool named propose_palette');
    expect(failed.output).toBeUndefined();
    expect(unfence('plain')).toBe('plain');
    expect(unfence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    const pending = widgetInstanceOf(item({ status: 'pending', rawInput: { a: 1 }, content: textContent('ignored while pending') }));
    expect(pending).toMatchObject({ status: 'pending', input: { a: 1 } });
    expect(pending.text).toBeUndefined();
    expect(widgetInstanceOf(item({ status: 'cancelled', content: [] })).error).toBe('cancelled');
  });

  test('replayed items are restored; an explicit flag wins; non-object input becomes {}', () => {
    expect(widgetInstanceOf(item({ replayed: true })).restored).toBe(true);
    expect(widgetInstanceOf(item({ replayed: true }), { restored: false }).restored).toBe(false);
    expect(widgetInstanceOf(item({ rawInput: 'oops' })).input).toEqual({});
    expect(widgetInstanceOf(item({ name: 'Bash', title: 'Bash' })).tool).toBe('Bash');   // not a page tool: the name stands
  });

  test('instances from the page call stream (floating panel)', () => {
    expect(widgetInstanceOfCall({ callId: 'c1', name: 'propose.palette', args: { a: 1 }, phase: 'start' })).toMatchObject({ tool: 'propose_palette', id: 'c1', status: 'in_progress', input: { a: 1 }, source: 'page', restored: false });
    expect(widgetInstanceOfCall({ callId: 'c1', name: 'x', args: {}, phase: 'end', ok: true, result: '{"n":1}' })).toMatchObject({ status: 'completed', text: '{"n":1}', output: { n: 1 } });
    expect(widgetInstanceOfCall({ callId: 'c1', name: 'x', args: {}, phase: 'end', ok: true, result: null })).toMatchObject({ status: 'completed', text: '' });
    expect(widgetInstanceOfCall({ callId: 'c1', name: 'x', args: {}, phase: 'end', ok: false, error: 'Error: boom' })).toMatchObject({ status: 'failed', error: 'Error: boom' });
    expect(widgetInstanceOfCall({ callId: 'c1', name: 'x', args: {}, phase: 'end', ok: false, error: 'AbortError: timeout' }).status).toBe('cancelled');
  });

  test('parseJson never throws and only parses JSON-looking text', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson(' [1, 2] ')).toEqual([1, 2]);
    expect(parseJson('42')).toBe(42);
    expect(parseJson('true')).toBe(true);
    expect(parseJson('not json')).toBeUndefined();
    expect(parseJson('{broken')).toBeUndefined();
    expect(parseJson(undefined)).toBeUndefined();
    expect(parseJson('')).toBeUndefined();
  });

  test('deepEqual ignores key order and undefined members', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, u: undefined }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual('1', 1)).toBe(false);
    expect(deepEqual(NaN, NaN)).toBe(true);
  });
});

describe('widgets: activity log', () => {
  test('notes are trimmed, capped per entry, by count and by size; since() and format() are oldest first', () => {
    let clock = 1_000;
    const log = createActivityLog({ now: () => clock, maxChars: 400 });
    const seen: number[] = [];
    log.onChange((e) => seen.push(e.length));
    log.note('   ');
    expect(log.entries).toHaveLength(0);
    log.note('  Applied   option 2 ', { tool: 'propose_palette', id: 'toolu_1' });
    expect(log.entries[0]).toMatchObject({ at: 1_000, text: 'Applied option 2', tool: 'propose_palette', id: 'toolu_1' });
    clock = 2_000;
    log.note('x'.repeat(500));
    expect(log.entries[1]!.text).toHaveLength(300);
    expect(log.entries).toHaveLength(2);   // 16 + 300 chars plus overhead still fits the 400-char cap
    clock = 3_000;
    log.note('y'.repeat(10));
    expect(log.entries.map((e) => e.text[0])).toEqual(['x', 'y']);   // over the cap: the oldest went first, the rest stays
    expect(log.since(1_500).map((e) => e.at)).toEqual([2_000, 3_000]);
    expect(log.since(2_500).map((e) => e.at)).toEqual([3_000]);
    expect(log.since(5_000)).toEqual([]);
    for (let i = 0; i < ACTIVITY_MAX_ENTRIES + 5; i++) { clock = 10_000 + i; log.note(`n${i}`); }
    expect(log.entries.length).toBeLessThanOrEqual(ACTIVITY_MAX_ENTRIES);
    expect(log.entries.at(-1)!.text).toBe(`n${ACTIVITY_MAX_ENTRIES + 4}`);
    const text = log.format(log.entries.slice(-3));
    expect(text.split('\n')).toHaveLength(3);
    expect(text).toMatch(/^- 1970-01-01T00:00:10\.0\d\dZ n\d+\n/);
    expect(log.format(log.entries.slice(-3), { maxChars: 40 }).split('\n')).toHaveLength(1);   // trimmed from the oldest end
    expect(log.format([])).toBe('');
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('widgets: elicitation form helpers', () => {
  test('booleans start false and submit as false; defaults apply; empty answers are left out; numbers are numbers', async () => {
    const { elicitationInitialValues, elicitationContent, elicitationMissing } = await import('../src/react/widgets.tsx');
    const schema = { type: 'object', required: ['confirm', 'choice', 'count'], properties: {
      confirm: { type: 'boolean', title: 'Proceed?' },
      choice: { type: 'string', oneOf: [{ const: 'a', title: 'A' }, { const: 'b', title: 'B' }] },
      choice_custom: { type: 'string', title: 'Other' },
      count: { type: 'integer', default: 3 },
      tags: { type: 'array', items: { anyOf: [{ const: 'x' }, { const: 'y' }] }, default: 'x' },
    } };
    const initial = elicitationInitialValues(schema);
    expect(initial).toEqual({ confirm: false, count: 3, tags: ['x'] });
    expect(elicitationMissing(schema, initial)).toEqual(['choice']);                       // a required boolean is never missing
    expect(elicitationMissing(schema, { ...initial, choice: 'b' })).toEqual([]);
    expect(elicitationContent(schema, { ...initial, choice: 'b', choice_custom: '', count: '7' })).toEqual({ confirm: false, choice: 'b', count: 7, tags: ['x'] });
    expect(elicitationContent({ type: 'object' }, { stray: 1 })).toEqual({});
    const nulls = { type: 'object', required: ['n', 'b', 'list'], properties: { n: { type: 'integer', default: null }, b: { type: 'boolean', default: null }, list: { type: 'array', default: null } } };
    expect(elicitationInitialValues(nulls)).toEqual({ b: false });                  // a null default is no default (audit 2, finding 1)
    expect(elicitationMissing(nulls, { n: null, list: null, b: false })).toEqual(['n', 'list']);
    expect(elicitationContent(nulls, { n: null, b: false })).toEqual({ b: false });
  });
});

describe('widgets: persisted state keys', () => {
  test('the sweep forgets only this agent\'s vanished threads, keeps other agents, page cards and listed threads, drops legacy keys', async () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } };
    try {
      const { widgetStateKey, threadScope, sweepWidgetState, clearWidgetState, PAGE_SCOPE } = await import('../src/react/widgets.tsx');
      const o = 'http://127.0.0.1:5173';
      const keys = {
        claudeKept: widgetStateKey(o, threadScope('claude', 's1'), 'toolu_1'),
        claudeGone: widgetStateKey(o, threadScope('claude', 's2'), 'toolu_2'),
        echo: widgetStateKey(o, threadScope('echo', 's9'), 'toolu_3'),
        page: widgetStateKey(o, PAGE_SCOPE, 'call-1'),
        legacy: `webmcp-connector:widget:${o}:s2:toolu_9`,
        otherOrigin: widgetStateKey('http://other', threadScope('claude', 'zz'), 'toolu_4'),
      };
      for (const k of Object.values(keys)) store.set(k, '{}');
      store.set('unrelated', '1');
      sweepWidgetState(o, 'claude', ['s1']);
      expect([...store.keys()].sort()).toEqual([keys.claudeKept, keys.echo, keys.otherOrigin, keys.page, 'unrelated'].sort());
      clearWidgetState(o, threadScope('claude', 's1'));
      expect(store.has(keys.claudeKept)).toBe(false);
      expect(store.has(keys.echo)).toBe(true);
      expect(threadScope('a:b/c', 'id')).toBe('a_b_c/id');
    } finally { delete (globalThis as any).localStorage; }
  });
});

describe('widgets: placement specs', () => {
  test('resolveWidget accepts a bare component or a spec and fills the defaults', async () => {
    const { resolveWidget } = await import('../src/react/widgets.tsx');
    const C = () => null;
    expect(resolveWidget({ a: C }, 'a')).toEqual({ Component: C, placement: 'inline', latestOnly: false });
    expect(resolveWidget({ 'b.c': { component: C, placement: 'end', latestOnly: true } }, 'b_c')).toEqual({ Component: C, placement: 'end', latestOnly: true });
    expect(resolveWidget({ d: { component: C } }, 'd')).toEqual({ Component: C, placement: 'inline', latestOnly: false });
    expect(resolveWidget({ a: C }, 'zzz')).toBeUndefined();
    expect(resolveWidget(undefined, 'a')).toBeUndefined();
  });
});
