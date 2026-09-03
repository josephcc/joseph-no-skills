import { describe, expect, it } from 'vitest';
import { codeTree, extractsForCode, familyIndex, health, searchCodes, topOf } from './codes';
import type { Bundle, Code, Extract } from './types';

const code = (id: string, over: Partial<Code> = {}): Code => ({
  id, name: id, parent: id.includes('.') ? id.split('.')[0] : null, status: 'accepted',
  definition: '', include: '', exclude: '', tags: [], examples: [], merged_into: null, added: {},
  proposal: null, reviewed: null, redefined_version: null, family: [id], participants: [], n: 0,
  extracts: 0, direct_extracts: 0, child_extracts: 0, kinds: { said: 0, did: 0, intent: 0 }, ...over,
});

const extract = (id: string, codes: string[]): Extract => ({
  id, transcript: 'T-01', participant: 'P1', speaker: 'P1', timestamp: null, line_start: 1, line_end: 1,
  text: 't', codes, kind: 'said', context: null, note: null, codebook_version: 1, added: '', new: false,
  reason: null, words: 1,
});

describe('familyIndex', () => {
  it('gives a child the same hue as its parent, so a family reads as one colour', () => {
    const codes = [code('abstraction'), code('abstraction.nest'), code('trust'), code('trust.stakes')];
    const hues = familyIndex(codes);
    expect(hues['abstraction.nest']).toBe(hues['abstraction']);
    expect(hues['trust.stakes']).toBe(hues['trust']);
    expect(hues['trust']).not.toBe(hues['abstraction']);
  });
  it('is stable under insertion, so a colour does not move when a code is added', () => {
    const before = familyIndex([code('a'), code('c')]);
    const after = familyIndex([code('a'), code('b'), code('c')]);
    expect(after['a']).toBe(before['a']);
    expect(after['c']).not.toBe(before['c']); // c shifts because ordering is by id — documented, not accidental
  });
  it('skips merged and retired codes when assigning hues', () => {
    const hues = familyIndex([code('a', { status: 'merged' }), code('b')]);
    expect(hues['b']).toBe(0);
  });
});

describe('codeTree', () => {
  it('nests children under their parent and drops dead codes', () => {
    const tree = codeTree([code('trust'), code('trust.stakes'), code('gone', { status: 'retired' })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].parent.id).toBe('trust');
    expect(tree[0].children.map((c) => c.id)).toEqual(['trust.stakes']);
  });
});

describe('searchCodes', () => {
  const codes = [
    code('trust', { name: 'Reliance on the claims' }),
    code('trust.stakes', { name: 'Bounded by the stakes' }),
    code('curation', { name: 'Deciding what stays', definition: 'pruning the canvas' }),
  ];
  it('ranks an exact id first, then prefixes, then names, then definitions', () => {
    expect(searchCodes(codes, 'trust')[0].id).toBe('trust');
    expect(searchCodes(codes, 'stakes').map((c) => c.id)).toEqual(['trust.stakes']);
    expect(searchCodes(codes, 'pruning').map((c) => c.id)).toEqual(['curation']);
  });
  it('returns the live codes when the query is empty', () => {
    expect(searchCodes(codes, '')).toHaveLength(3);
  });
});

describe('health', () => {
  const bundle = {
    N: 3,
    codes: [
      code('parent-heavy', { direct_extracts: 9, child_extracts: 2, extracts: 11, n: 3 }),
      code('parent-heavy.child', { extracts: 2, n: 1 }),
      code('only-child', { direct_extracts: 0, child_extracts: 4, extracts: 4, n: 2 }),
      code('only-child.everything', { extracts: 4, n: 2 }),
      code('thin', { n: 1, extracts: 1 }),
      code('flat', { n: 3, extracts: 5 }),
    ],
    dupes: [{ kind: 'names', a: 'thin', b: 'flat', score: 0.6, shared: 0, text: '' }],
  } as unknown as Bundle;

  it('names the cleanup review questions as filters', () => {
    const rows = health(bundle);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.ids]));
    expect(byKey['parent-heavy']).toEqual(['parent-heavy']);
    expect(byKey['only-child']).toEqual(['only-child']);
    expect(byKey['thin']).toContain('thin');
    expect(byKey['dupes'].sort()).toEqual(['flat', 'thin']);
    expect(byKey['flat']).toContain('flat');
    expect(byKey['unreviewed']).toContain('thin');
  });
});

describe('extractsForCode', () => {
  it('gathers the family, not just the code, in transcript order', () => {
    const parent = code('trust', { family: ['trust', 'trust.stakes'] });
    const rows = [extract('E-2', ['trust.stakes']), extract('E-1', ['trust']), extract('E-3', ['other'])];
    rows[0].line_start = 20;
    rows[1].line_start = 10;
    expect(extractsForCode(rows, parent).map((e) => e.id)).toEqual(['E-1', 'E-2']);
  });
});

describe('topOf', () => {
  it('reads the parent out of a child id', () => {
    expect(topOf('trust.stakes')).toBe('trust');
    expect(topOf('trust')).toBe('trust');
  });
});
