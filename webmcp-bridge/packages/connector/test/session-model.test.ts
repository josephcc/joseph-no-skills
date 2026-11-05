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
