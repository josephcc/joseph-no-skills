import { describe, expect, it } from 'vitest';
import { OP_VIEW, describe as describeOp, draft, isPending, isThread, opsFor } from './ops';
import type { Op } from './types';

const op = (o: Partial<Op> & Pick<Op, 'op'>): Op => ({
  id: 'op-0001', at: '2026-09-02T10:00', by: 'user', view: 'transcript',
  target: null, args: {}, note: null, status: 'pending', ...o,
});

describe('draft', () => {
  it('tags an operation with the view it came from, so the inbox groups itself', () => {
    expect(draft('merge-code', 'a', { into: 'b' }).view).toBe('codebook');
    expect(draft('select-quote', 'TH1', { extract: 'E-1' }).view).toBe('quotes');
    expect(draft('recode', 'E-1', {}).by).toBe('user');
  });
  it('has a view for every operation name it knows', () => {
    for (const [name, view] of Object.entries(OP_VIEW)) {
      expect(view, name).toBeTruthy();
    }
  });
});

describe('describe', () => {
  it('reads as the sentence the researcher would have typed', () => {
    expect(describeOp(op({ op: 'recode', target: 'E-42', args: { add: ['trust.stakes'], remove: ['trust'] } })))
      .toBe('E-42: +trust.stakes −trust');
    expect(describeOp(op({ op: 'set-kind', target: 'E-42', args: { kind: 'did' } }))).toBe('E-42: kind → did');
    expect(describeOp(op({ op: 'merge-code', target: 'agent-steering', args: { into: 'control' } })))
      .toBe('merge agent-steering into control');
    expect(describeOp(op({ op: 'reparent', target: 'x', args: {} }))).toBe('x → top level');
    expect(describeOp(op({ op: 'reparent', target: 'x', args: { parent: 'trust' } }))).toBe('x → child of trust');
    expect(describeOp(op({ op: 'mark-reviewed', args: { transcript: 'T-07' } }))).toBe('mark T-07 reviewed');
    expect(describeOp(op({ op: 'quote-span', target: 'TH1', args: { extract: 'E-1' } }))).toContain('trim E-1');
  });
  it('shortens long text instead of spilling it', () => {
    const long = 'x'.repeat(200);
    expect(describeOp(op({ op: 'comment', target: 'E-1', args: { text: long } })).length).toBeLessThan(80);
  });
  it('falls back to the raw name for an operation it does not know', () => {
    expect(describeOp(op({ op: 'something-new', target: 'X' }))).toBe('something-new X');
  });
});

describe('pending and threads', () => {
  it('counts a failed operation as still pending, so it is not lost', () => {
    expect(isPending(op({ op: 'drop', status: 'failed' }))).toBe(true);
    expect(isPending(op({ op: 'drop', status: 'applied' }))).toBe(false);
    expect(isPending({ ...op({ op: 'drop' }), status: undefined })).toBe(true);
  });
  it('keeps threads out of the applicable set', () => {
    expect(isThread(op({ op: 'comment' }))).toBe(true);
    expect(isThread(op({ op: 'reply' }))).toBe(true);
    expect(isThread(op({ op: 'recode' }))).toBe(false);
  });
  it('finds the operations staged against one id, including quote targets', () => {
    const inbox = [
      op({ id: 'op-1', op: 'recode', target: 'E-1' }),
      op({ id: 'op-2', op: 'select-quote', target: 'TH1', args: { extract: 'E-1' } }),
      op({ id: 'op-3', op: 'recode', target: 'E-2' }),
    ];
    expect(opsFor(inbox, 'E-1').map((o) => o.id)).toEqual(['op-1', 'op-2']);
  });
});
