import { describe, expect, it } from 'vitest';
import { codeWithPatch, pendingPatch, themeWithPatch, withPatch } from './overlay';
import { isPending as isPendingExport } from './ops';
import type { Code, Extract, Op, Theme } from './types';

const extract = (id: string, over: Partial<Extract> = {}): Extract => ({
  id,
  transcript: 'T-01',
  participant: 'P1',
  speaker: 'P1',
  timestamp: '00:01:00',
  line_start: 9,
  line_end: 9,
  text: 'some words from the transcript',
  codes: ['trust'],
  kind: 'said',
  context: null,
  note: null,
  codebook_version: 3,
  added: '2026-09-01',
  new: true,
  reason: 'not reviewed yet',
  words: 5,
  ...over,
});

const op = (o: Partial<Op> & Pick<Op, 'op'>): Op => ({
  id: o.id ?? 'op-0001',
  at: '2026-09-02T10:00',
  by: 'user',
  view: 'transcript',
  target: o.target ?? null,
  args: o.args ?? {},
  note: null,
  status: 'pending',
  ...o,
});

describe('pendingPatch', () => {
  it('applies add and remove to an extract, in staged order', () => {
    const p = pendingPatch(
      [
        op({ id: 'op-0001', op: 'recode', target: 'E-1', args: { add: ['control'] } }),
        op({ id: 'op-0002', op: 'recode', target: 'E-1', args: { remove: ['trust'] } }),
      ],
      [extract('E-1')],
    );
    expect(p.extracts['E-1'].codes).toEqual(['control']);
    expect(p.extracts['E-1'].ops).toHaveLength(2);
    expect(p.countsWillChange).toBe(true);
  });

  it('lets a later `set` override earlier edits', () => {
    const p = pendingPatch(
      [
        op({ id: 'op-0001', op: 'recode', target: 'E-1', args: { add: ['control'] } }),
        op({ id: 'op-0002', op: 'recode', target: 'E-1', args: { set: ['task-fit'] } }),
      ],
      [extract('E-1')],
    );
    expect(p.extracts['E-1'].codes).toEqual(['task-fit']);
  });

  it('marks a drop without removing the row', () => {
    const p = pendingPatch([op({ op: 'drop', target: 'E-1' })], [extract('E-1')]);
    expect(p.extracts['E-1'].dropped).toBe(true);
  });

  it('stamps every extract of a transcript when mark-reviewed names it', () => {
    const p = pendingPatch(
      [op({ op: 'mark-reviewed', args: { transcript: 'T-01' } })],
      [extract('E-1'), extract('E-2'), extract('E-3', { transcript: 'T-02' })],
    );
    expect(p.extracts['E-1'].reviewed).toBe(true);
    expect(p.extracts['E-2'].reviewed).toBe(true);
    expect(p.extracts['E-3']).toBeUndefined();
  });

  it('ignores threads and replies', () => {
    const p = pendingPatch(
      [op({ op: 'comment', target: 'E-1', args: { text: 'really?' } }), op({ op: 'reply', target: 'op-0001', args: { text: 'yes' } })],
      [extract('E-1')],
    );
    expect(p.extracts['E-1']).toBeUndefined();
    expect(p.countsWillChange).toBe(false);
  });

  it('ignores operations already applied', () => {
    const p = pendingPatch([{ ...op({ op: 'drop', target: 'E-1' }), status: 'applied' }], [extract('E-1')]);
    expect(p.extracts['E-1']).toBeUndefined();
  });

  it('collects codebook edits per code', () => {
    const p = pendingPatch(
      [
        op({ op: 'code-status', target: 'trust', args: { status: 'accepted' }, view: 'codebook' }),
        op({ op: 'set-field', target: 'trust', args: { field: 'definition', value: 'a sharper rule' }, view: 'codebook' }),
        op({ op: 'reparent', target: 'trust', args: { parent: 'control' }, view: 'codebook' }),
      ],
      [],
    );
    expect(p.codes.trust.status).toBe('accepted');
    expect(p.codes.trust.definition).toBe('a sharper rule');
    expect(p.codes.trust.parent).toBe('control');
  });

  it('routes theme assignments to the receiving column', () => {
    const p = pendingPatch([op({ op: 'assign-theme', target: 'trust', args: { theme: 'TH1' }, view: 'themes' })], []);
    expect(p.themes.TH1.addCodes).toEqual(['trust']);
  });

  it('treats a re-selected quote as one selection', () => {
    const p = pendingPatch(
      [
        op({ op: 'deselect-quote', target: 'TH1', args: { extract: 'E-1' }, view: 'quotes' }),
        op({ op: 'select-quote', target: 'TH1', args: { extract: 'E-1' }, view: 'quotes' }),
      ],
      [],
    );
    expect(p.themes.TH1.addQuotes).toEqual(['E-1']);
    expect(p.themes.TH1.removeQuotes).toEqual([]);
  });
});

describe('withPatch', () => {
  it('returns the stored extract untouched when nothing is staged', () => {
    const e = extract('E-1');
    expect(withPatch(e)).toEqual({ ...e, pending: false, dropped: false });
  });

  it('shows the edit the researcher made, without changing the counts', () => {
    const p = pendingPatch([op({ op: 'set-kind', target: 'E-1', args: { kind: 'did' } })], [extract('E-1')]);
    const shown = withPatch(extract('E-1'), p.extracts['E-1']);
    expect(shown.kind).toBe('did');
    expect(shown.pending).toBe(true);
    expect(shown.words).toBe(5); // still the stored number, not a recomputed one
  });

  it('clears a highlight when the staged reason is empty', () => {
    const p = pendingPatch([op({ op: 'highlight', target: 'E-1', args: { reason: '' } })], [extract('E-1', { highlight: 'vivid' })]);
    expect(withPatch(extract('E-1', { highlight: 'vivid' }), p.extracts['E-1']).highlight).toBeUndefined();
  });
});

describe('codeWithPatch / themeWithPatch', () => {
  const code: Code = {
    id: 'trust', name: 'Trust', parent: null, status: 'candidate', definition: 'old', include: '', exclude: '',
    tags: [], examples: [], merged_into: null, added: {}, proposal: null, reviewed: null, redefined_version: null,
    family: ['trust'], participants: ['P1'], n: 1, extracts: 3, direct_extracts: 3, child_extracts: 0, kinds: { said: 3, did: 0, intent: 0 },
  };
  const theme: Theme = {
    id: 'TH1', name: 'A claim', parent: null, status: 'candidate', in_paper: 'undecided', rq: null, essence: '', story: '',
    codes: ['trust'], family: ['trust'], tensions: [], selected_extracts: ['E-1'], quote_spans: {}, reviewed: null,
    participants: ['P1'], n: 1, N: 3, extracts: 3,
  };

  it('overlays a definition edit but keeps the computed numbers', () => {
    const p = pendingPatch([op({ op: 'set-field', target: 'trust', args: { field: 'definition', value: 'new' } })], []);
    const shown = codeWithPatch(code, p.codes.trust);
    expect(shown.definition).toBe('new');
    expect(shown.n).toBe(1);
    expect(shown.extracts).toBe(3);
  });

  it('adds and removes theme members without duplicating them', () => {
    const p = pendingPatch(
      [
        op({ op: 'assign-theme', target: 'trust', args: { theme: 'TH1' } }),
        op({ op: 'select-quote', target: 'TH1', args: { extract: 'E-2' } }),
        op({ op: 'deselect-quote', target: 'TH1', args: { extract: 'E-1' } }),
        op({ op: 'set-tension', target: 'TH1', args: { add: ['E-9'] } }),
      ],
      [],
    );
    const shown = themeWithPatch(theme, p.themes.TH1);
    expect(shown.codes).toEqual(['trust']);
    expect(shown.selected_extracts).toEqual(['E-2']);
    expect(shown.tensions).toEqual(['E-9']);
    expect(shown.pending).toBe(true);
  });
});

// ---------------------------------------------- what the Codex audit changed
describe('the compare move, after the audit', () => {
  it('names the codes an extract actually carries, not the family parent', () => {
    // The regression: an "only A" row coded `A.child` had `remove: ['A']` staged, which
    // left the child in place and put the extract in both families.
    const famA = new Set(['trust', 'trust.stakes']);
    const e = extract('E-1', { codes: ['trust.stakes', 'curation'] });
    expect(e.codes.filter((c) => famA.has(c))).toEqual(['trust.stakes']);
  });
});

describe('a staged operation that is in flight', () => {
  it('is not offered for undo, because the agent is applying it', () => {
    const applying = { ...op({ op: 'recode', target: 'E-1' }), status: 'applying' };
    expect(isPendingExport(applying)).toBe(false);
  });
});

describe('a stalled operation', () => {
  it('shows in the drawer but never on the data', () => {
    // Nobody knows whether a stalled drop took effect, so drawing it as done would have
    // the reviewer deciding against a change that may not exist.
    const stalled = { ...op({ id: 'op-9', op: 'drop', target: 'E-1' }), status: 'stalled' };
    expect(isPendingExport(stalled)).toBe(true);
    const p = pendingPatch([stalled], [extract('E-1')]);
    expect(p.extracts['E-1']).toBeUndefined();
  });
});
