import { describe, expect, it } from 'vitest';
import { segmentTurn, snapToWords } from './spans';

const span = (extract: string, start: number | null, end: number | null) => ({ extract, start, end });

describe('segmentTurn', () => {
  it('returns the whole turn when nothing is coded', () => {
    expect(segmentTurn('hello there', [])).toEqual([{ start: 0, end: 11, text: 'hello there', extracts: [] }]);
  });

  it('splits a turn into coded and uncoded runs', () => {
    const segs = segmentTurn('abcdefghij', [span('E-1', 2, 5)]);
    expect(segs).toEqual([
      { start: 0, end: 2, text: 'ab', extracts: [] },
      { start: 2, end: 5, text: 'cde', extracts: ['E-1'] },
      { start: 5, end: 10, text: 'fghij', extracts: [] },
    ]);
  });

  it('keeps both extracts on an overlap instead of dropping one', () => {
    // This is what `annotate` could not do: nested markup has no markdown form, so the
    // second span became a marker after the turn. Offsets make it a segmentation.
    const segs = segmentTurn('0123456789', [span('E-1', 0, 6), span('E-2', 4, 10)]);
    expect(segs.map((s) => s.extracts)).toEqual([['E-1'], ['E-1', 'E-2'], ['E-2']]);
    expect(segs[1].text).toBe('45');
  });

  it('handles one span nested inside another', () => {
    const segs = segmentTurn('0123456789', [span('outer', 0, 10), span('inner', 3, 5)]);
    expect(segs.map((s) => s.extracts)).toEqual([['outer'], ['outer', 'inner'], ['outer']]);
  });

  it('ignores unlocatable spans and clamps out-of-range ones', () => {
    expect(segmentTurn('abc', [span('E-1', null, null)])[0].extracts).toEqual([]);
    const segs = segmentTurn('abc', [span('E-1', 1, 99)]);
    expect(segs[segs.length - 1].end).toBe(3);
  });

  it('covers the whole turn with no gaps and no overlaps', () => {
    const text = 'the quick brown fox jumps over the lazy dog';
    const segs = segmentTurn(text, [span('a', 4, 15), span('b', 10, 25), span('c', 30, 39)]);
    expect(segs[0].start).toBe(0);
    expect(segs[segs.length - 1].end).toBe(text.length);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end);
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('drops zero-width spans', () => {
    expect(segmentTurn('abc', [span('E-1', 2, 2)])[0].extracts).toEqual([]);
  });
});

describe('snapToWords', () => {
  const text = 'I always open the PDF anyway to check the method section.';
  it('grows a selection out to whole words', () => {
    const { start, end } = snapToWords(text, 3, 12); // "lways ope"
    expect(text.slice(start, end)).toBe('always open');
  });
  it('leaves a word-aligned selection alone', () => {
    const i = text.indexOf('open');
    const { start, end } = snapToWords(text, i, i + 4);
    expect(text.slice(start, end)).toBe('open');
  });
  it('clamps to the text', () => {
    expect(snapToWords(text, -5, 999)).toEqual({ start: 0, end: text.length });
  });
});
