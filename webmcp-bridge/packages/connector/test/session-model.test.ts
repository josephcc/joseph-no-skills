import { describe, expect, test } from 'bun:test';
import { SessionModel } from '../src/session-model.ts';

const chunk = (role: 'agent' | 'user', text: string) => ({ sessionUpdate: role === 'agent' ? 'agent_message_chunk' : 'user_message_chunk', content: { type: 'text', text } });

describe('SessionModel', () => {
  test('live turn: user prompt, streamed agent text, tool call lifecycle, stop reason', () => {
    const m = new SessionModel();
    m.beginTurn('hi');
    m.applyUpdate(chunk('agent', 'Hel')); m.applyUpdate(chunk('agent', 'lo'));
    m.applyUpdate({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'get_state', kind: 'other', status: 'pending' });
    m.applyUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: { ok: true } });
    m.applyUpdate(chunk('agent', ' done'));
    m.endTurn('end_turn');
    const s = m.snapshot();
    expect(s.turns).toHaveLength(1);
    const kinds = s.turns[0]!.items.map((i) => (i.kind === 'text' ? `${i.role}:${i.text}` : `${i.kind}:${(i as { status?: string }).status}`));
    expect(kinds).toEqual(['user:hi', 'agent:Hello', 'tool_call:completed', 'agent: done']);
    expect(s.turns[0]!.stopReason).toBe('end_turn');
    expect(s.state).toBe('ready');
  });

  test('replayed history splits into turns and ignores non-text user chunks', () => {
    const m = new SessionModel();
    m.applyUpdate(chunk('user', 'first'));
    m.applyUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'resource', resource: { uri: 'page://ui-state', text: 'x' } } });
    m.applyUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'page://ui-state\nCurrent UI state…' } });
    m.applyUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '\n<context uri="page://ui-state">{…}</context>' } });
    m.applyUpdate(chunk('agent', 'answer one'));
    m.applyUpdate(chunk('user', 'second\n<context uri="page://ui-state">{…}</context>'));
    m.applyUpdate(chunk('agent', 'answer two'));
    const s = m.snapshot();
    expect(s.turns).toHaveLength(2);
    expect(s.turns[0]!.items.map((i) => (i as { text: string }).text)).toEqual(['first', 'answer one']);
    expect(s.turns[1]!.items.map((i) => (i as { text: string }).text)).toEqual(['second', 'answer two']);
  });

  test('permission requests are pending until answered', () => {
    const m = new SessionModel();
    const answers: string[] = [];
    m.addPermission({ id: 'p1', title: 'Write x', options: [{ optionId: 'a', name: 'Yes', kind: 'allow_once' }], respond: (id) => answers.push(id) });
    expect(m.snapshot().pendingPermissions).toHaveLength(1);
    m.snapshot().pendingPermissions[0]!.respond('a');
    expect(answers).toEqual(['a']);
    expect(m.snapshot().pendingPermissions).toHaveLength(0);
  });

  test('metadata updates: plan, commands, mode, usage', () => {
    const m = new SessionModel();
    m.applyUpdate({ sessionUpdate: 'plan', entries: [{ content: 'step', priority: 'high', status: 'pending' }] });
    m.applyUpdate({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'help', description: 'h' }] });
    m.applyUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
    m.applyUpdate({ sessionUpdate: 'usage_update', used: 10, size: 100 });
    const s = m.snapshot();
    expect(s.plan[0]!.content).toBe('step'); expect(s.commands[0]!.name).toBe('help'); expect(s.modes?.current).toBe('plan'); expect(s.usage?.used).toBe(10);
  });
});

describe('SessionModel: widgets support', () => {
  const call = (id: string, extra: Record<string, unknown> = {}) => ({ sessionUpdate: 'tool_call', toolCallId: id, title: 'mcp__page__x', name: 'mcp__page__x', kind: 'other', status: 'pending', rawInput: { a: 1 }, _meta: { claudeCode: { toolName: 'mcp__page__x' } }, ...extra });

  test('items applied while replaying are marked replayed; meta is kept and merged', () => {
    const m = new SessionModel();
    m.replaying = true;
    m.applyUpdate(call('t1'));
    m.applyUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '{"ok":1}' } }], _meta: { claudeCode: { toolName: 'mcp__page__x', extra: true } } });
    m.replaying = false;
    m.applyUpdate(call('t2'));
    const items = m.snapshot().turns.flatMap((t) => t.items) as Array<{ toolCallId: string; replayed?: boolean; meta?: Record<string, unknown>; status: string }>;
    expect(items.map((i) => [i.toolCallId, i.replayed ?? false])).toEqual([['t1', true], ['t2', false]]);
    expect(items[0]!.meta).toEqual({ claudeCode: { toolName: 'mcp__page__x', extra: true } });
    expect(items[0]!.status).toBe('completed');
    expect(m.toolCall('t2')?.toolCallId).toBe('t2');
    expect(m.openToolCalls().map((i) => i.toolCallId)).toEqual(['t2']);
    expect(m.toolCall('nope')).toBeUndefined();
  });

  test('elicitations are pending until answered; cancelPending settles permissions and elicitations as cancel', () => {
    const m = new SessionModel();
    const results: unknown[] = [];
    m.addElicitation({ id: 'e1', message: 'Which?', schema: { type: 'object', properties: {} }, respond: (r) => results.push(r) });
    expect(m.snapshot().pendingElicitations).toHaveLength(1);
    expect(m.snapshot().pendingElicitations[0]!.message).toBe('Which?');
    m.snapshot().pendingElicitations[0]!.respond({ action: 'accept', content: { choice: 'a' } });
    expect(results).toEqual([{ action: 'accept', content: { choice: 'a' } }]);
    expect(m.snapshot().pendingElicitations).toHaveLength(0);
    const answers: string[] = [];
    m.addElicitation({ id: 'e2', message: 'Again?', schema: {}, respond: (r) => results.push(r) });
    m.addPermission({ id: 'p1', title: 'Write', options: [{ optionId: 'a', name: 'Yes', kind: 'allow_once' }], respond: (id) => answers.push(id) });
    m.cancelPending();
    expect(results.at(-1)).toEqual({ action: 'cancel' });
    expect(answers).toEqual(['__cancelled__']);
    expect(m.snapshot().pendingElicitations).toHaveLength(0);
    expect(m.snapshot().pendingPermissions).toHaveLength(0);
  });

  test('replayed user text drops the folded widget-activity resource as it drops the ui-state one', () => {
    const m = new SessionModel();
    m.applyUpdate(chunk('user', 'hello\npage://widget-activity\nRecent widget activity:\n- did a thing'));
    m.applyUpdate(chunk('agent', 'hi'));
    m.applyUpdate(chunk('user', 'again\npage://ui-state\n{}\npage://widget-activity\n- x'));
    const texts = m.snapshot().turns.flatMap((t) => t.items).map((i) => (i as { text: string }).text);
    expect(texts).toEqual(['hello', 'hi', 'again']);
  });
});
