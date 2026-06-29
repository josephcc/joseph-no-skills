import { describe, expect, it } from 'vitest';
import {
  anchoredCommentIds,
  appendTarget,
  lintPlan,
  parsePlan,
  removeHighlight,
  replaceBlock,
  serializeBlock,
  serializeComment,
  wrapNthOccurrence,
} from './parser';
import type { CommentBlock, QuestionBlock } from './types';

describe('parsePlan', () => {
  it('parses preamble and title', () => {
    const raw = `**Status:** open\n**Date:** 2026-06-27\n\n---\n\n# Hello\n\nbody`;
    const p = parsePlan(raw);
    expect(p.preamble).toContainEqual({ key: 'Status', value: 'open' });
    expect(p.title).toBe('Hello');
  });

  it('does NOT parse tags inside fenced code blocks (F-3)', () => {
    const raw = ['# T', '', '```xml', '<decision id="D1" title="x" status="locked">nope</decision>', '```', '', 'real text'].join('\n');
    const p = parsePlan(raw);
    expect(p.blocks.find((b) => b.type === 'decision')).toBeUndefined();
    // the fenced text survives inside a markdown block
    expect(p.blocks.some((b) => b.type === 'markdown' && b.text.includes('<decision'))).toBe(true);
  });

  it('parses a question with options and round-trips through serialize', () => {
    const raw = `<open-question id="Q-A" title="Name" status="open">\nWhat name?\n\n<options select="single">\n  <option id="a">Alpha</option>\n  <option id="b">Beta</option>\n</options>\n</open-question>`;
    const p = parsePlan(raw);
    const q = p.blocks[0] as QuestionBlock;
    expect(q.type).toBe('question');
    expect(q.id).toBe('Q-A');
    expect(q.select).toBe('single');
    expect(q.options.map((o) => o.id)).toEqual(['a', 'b']);
    expect(q.body).toContain('What name?');
    // re-serialize and re-parse: stable
    const round = parsePlan(serializeBlock(q)).blocks[0] as QuestionBlock;
    expect(round.options.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('parses a decision with rationale and a comment with notes', () => {
    const raw =
      `<decision id="D1" title="Pick A" status="locked" date="2026-06-27" from="Q-A">\nWe pick A.\n<rationale>\nBecause.\n</rationale>\n</decision>\n\n` +
      `<comment id="c1" status="open" kind="clarify">\n  <note by="user" at="t1">why?</note>\n  <note by="agent" at="t2">because</note>\n</comment>`;
    const p = parsePlan(raw);
    const d = p.blocks.find((b) => b.type === 'decision');
    const c = p.blocks.find((b) => b.type === 'comment');
    expect(d).toBeDefined();
    expect(c && c.type === 'comment' && c.notes.length).toBe(2);
  });

  it('answering a question updates only that block (non-destructive)', () => {
    const raw = `intro text\n\n<open-question id="Q-A" title="N" status="open">\nPick?\n<options select="single">\n  <option id="a">A</option>\n</options>\n</open-question>\n\ntail text`;
    const p = parsePlan(raw);
    const q = { ...(p.blocks.find((b) => b.type === 'question') as QuestionBlock) };
    q.status = 'answered';
    q.answer = { by: 'user', at: 'now', chose: ['a'], text: 'go with A' };
    const out = replaceBlock(raw, q.range, serializeBlock(q));
    expect(out.startsWith('intro text')).toBe(true);
    expect(out.endsWith('tail text')).toBe(true);
    expect(out).toContain('chose="a"');
    const re = parsePlan(out).blocks.find((b) => b.type === 'question') as QuestionBlock;
    expect(re.status).toBe('answered');
    expect(re.answer?.chose).toEqual(['a']);
  });
});

describe('lintPlan', () => {
  it('flags duplicate ids', () => {
    const raw = `<finding id="F1" title="a" severity="p1" status="open">x</finding>\n<finding id="F1" title="b" severity="p2" status="open">y</finding>`;
    expect(lintPlan(raw).some((d) => /Duplicate id/.test(d.message))).toBe(true);
  });

  it('flags a highlight with no matching comment', () => {
    const raw = `# T\n\nsome <user-highlight comment="cZ">span</user-highlight> here`;
    expect(lintPlan(raw).some((d) => /no matching <comment/.test(d.message))).toBe(true);
  });

  it('passes a well-formed doc', () => {
    const raw = `# T\n\ntext <user-highlight comment="c1">x</user-highlight>\n\n<comment id="c1" status="open"><note by="user" at="t">hi</note></comment>`;
    expect(lintPlan(raw).filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('flags an unclosed block tag (swallow case)', () => {
    const raw = `<finding id="F1" title="a" severity="p1" status="open">missing close\n\n<finding id="F2" title="b" severity="p2" status="open">y</finding>`;
    expect(lintPlan(raw).some((d) => /Unclosed|nested/i.test(d.message))).toBe(true);
  });

  it('flags single-select with multiple chosen options', () => {
    const raw = `<open-question id="Q" title="t" status="answered">\nq\n<options select="single">\n  <option id="a">A</option>\n  <option id="b">B</option>\n</options>\n<answer by="user" at="t" chose="a,b">both</answer>\n</open-question>`;
    expect(lintPlan(raw).some((d) => /select="single"/.test(d.message))).toBe(true);
  });
});

describe('quote/code-aware inner parsing', () => {
  it('a > inside an inner-tag attribute value does not truncate the tag', () => {
    const raw = `<open-question id="Q" title="t" status="open">\nq\n<options select="single">\n  <option id="a>b">X</option>\n</options>\n</open-question>`;
    const q = parsePlan(raw).blocks.find((b) => b.type === 'question') as QuestionBlock;
    expect(q.options[0].id).toBe('a>b');
    expect(q.options[0].body).toBe('X');
  });

  it('a literal close tag inside inline code is not treated as the real close', () => {
    const raw = '<open-question id="Q" title="t" status="open">\nq\n<options select="single">\n  <option id="a">use `</option>` to close</option>\n</options>\n</open-question>';
    const q = parsePlan(raw).blocks.find((b) => b.type === 'question') as QuestionBlock;
    expect(q.options[0].body).toContain('to close');
  });

  it('an option body ending in a fenced code block round-trips (close tag on its own line)', () => {
    const q: QuestionBlock = {
      type: 'question',
      id: 'Q',
      title: 't',
      status: 'open',
      body: 'q',
      select: 'single',
      options: [{ id: 'a', body: 'pick:\n```ts\nconst x = 1;\n```' }],
      answer: null,
      range: { start: 0, end: 0 },
    };
    const round = parsePlan(serializeBlock(q)).blocks.find((b) => b.type === 'question') as QuestionBlock;
    expect(round.options).toHaveLength(1);
    expect(round.options[0].id).toBe('a');
  });
});

describe('lint raw attributes', () => {
  it('flags unknown attributes and missing required ones', () => {
    const raw = `<finding id="F1" title="t" severty="p1" status="open">x</finding>`;
    const d = lintPlan(raw);
    expect(d.some((x) => /unknown attribute "severty"/.test(x.message))).toBe(true);
    expect(d.some((x) => /missing required attribute "severity"/.test(x.message))).toBe(true);
  });

  it('flags an out-of-enum value instead of silently defaulting', () => {
    const raw = `<finding id="F1" title="t" severity="p9" status="open">x</finding>`;
    expect(lintPlan(raw).some((x) => /severity="p9" is not one of/.test(x.message))).toBe(true);
  });

  it('flags a misspelled child enum value (options select)', () => {
    const raw = `<open-question id="Q" title="t" status="open">\nq\n<options select="mulit">\n  <option id="a">A</option>\n</options>\n</open-question>`;
    expect(lintPlan(raw).some((d) => /select="mulit" is not one of/.test(d.message))).toBe(true);
  });
});

describe('highlight anchoring', () => {
  it('wraps the requested occurrence, not the first (the "optionally" bug)', () => {
    const field = 'you may optionally do X, or optionally do Y';
    const out = wrapNthOccurrence(field, 'optionally', 1, 'c1')!;
    // the SECOND "optionally" is wrapped; the first is untouched
    expect(out).toBe('you may optionally do X, or <user-highlight comment="c1">optionally</user-highlight> do Y');
  });

  it('matches whitespace-tolerantly and skips matches inside inline code', () => {
    const field = 'set `optionally` then optionally run';
    // occ 0 should skip the code-span copy and wrap the prose one
    const out = wrapNthOccurrence(field, 'optionally', 0, 'c1')!;
    expect(out).toBe('set `optionally` then <user-highlight comment="c1">optionally</user-highlight> run');
  });

  it('returns null when the occurrence index is out of range (caller falls back to a target)', () => {
    expect(wrapNthOccurrence('only one here', 'one', 1, 'c1')).toBeNull();
  });

  it('appendTarget adds an empty highlight before trailing whitespace', () => {
    expect(appendTarget('a decision body\n', 'c2')).toBe('a decision body <user-highlight comment="c2"></user-highlight>\n');
  });

  it('anchoredCommentIds finds span + target ids, de-duplicated', () => {
    const field =
      'x <user-highlight comment="c1">a</user-highlight> y <user-highlight comment="c1"></user-highlight> <user-highlight comment="c2"></user-highlight>';
    expect(anchoredCommentIds(field)).toEqual(['c1', 'c2']);
  });

  it('removeHighlight strips a span (keeping text) and a target (removing it), only for the id', () => {
    const raw =
      'see <user-highlight comment="c1">this span</user-highlight> and end <user-highlight comment="c2"></user-highlight>';
    expect(removeHighlight(raw, 'c1')).toBe('see this span and end <user-highlight comment="c2"></user-highlight>');
    expect(removeHighlight(raw, 'c2')).toBe('see <user-highlight comment="c1">this span</user-highlight> and end ');
  });

  it('removeHighlight keeps inner text of a nested highlight when removing the outer', () => {
    const raw = 'a <user-highlight comment="x">foo <user-highlight comment="y">bar</user-highlight></user-highlight> z';
    expect(removeHighlight(raw, 'x')).toBe('a foo <user-highlight comment="y">bar</user-highlight> z');
  });
});

describe('user-text encode/decode at the file boundary', () => {
  it('a literal structural close tag in a note body survives round-trip', () => {
    const c: CommentBlock = {
      type: 'comment',
      id: 'c1',
      status: 'open',
      kind: null,
      resolvedBy: null,
      resolvedAt: null,
      notes: [{ by: 'user', at: 't', body: 'use </note> & <ok> carefully' }],
      range: { start: 0, end: 0 },
    };
    const round = parsePlan(serializeComment(c)).blocks.find((b) => b.type === 'comment') as CommentBlock;
    expect(round.notes).toHaveLength(1);
    expect(round.notes[0].body).toBe('use </note> & <ok> carefully');
  });
});
