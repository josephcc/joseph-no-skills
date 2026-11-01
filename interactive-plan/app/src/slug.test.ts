import { describe, expect, it } from 'vitest';
import { Slugger, fragmentCandidates, slugify } from './slug';

describe('slugify', () => {
  it('matches the id GitHub gives a heading', () => {
    expect(slugify('Export a PDF to share')).toBe('export-a-pdf-to-share');
    expect(slugify('1. Open questions')).toBe('1-open-questions');
    expect(slugify('`<check-table>` — pick rows')).toBe('check-table--pick-rows');
    expect(slugify('  Status / Date  ')).toBe('status--date');
    expect(slugify('snake_case stays')).toBe('snake_case-stays');
    expect(slugify('Überblick für Ärzte')).toBe('überblick-für-ärzte');
  });
  it('keeps nothing but the hyphen for a heading of symbols, as GitHub does', () => {
    expect(slugify('◆ ✓')).toBe('-');
    expect(slugify('✓')).toBe('');
  });
});

describe('Slugger', () => {
  it('numbers repeated headings the way GitHub does', () => {
    const s = new Slugger();
    expect(s.slug('Notes')).toBe('notes');
    expect(s.slug('Notes')).toBe('notes-1');
    expect(s.slug('Notes')).toBe('notes-2');
    expect(s.slug('Other')).toBe('other');
  });
  it('never hands out an id that an earlier numbered one already took', () => {
    const s = new Slugger();
    expect(s.slug('Notes 1')).toBe('notes-1');
    expect(s.slug('Notes')).toBe('notes');
    expect(s.slug('Notes')).toBe('notes-2'); // notes-1 is taken
  });
  it('falls back to a usable id for a symbol-only heading', () => {
    const s = new Slugger();
    expect(s.slug('◆')).toBe('section');
    expect(s.slug('◆ ✓')).toBe('section-1');
  });
});

describe('fragmentCandidates', () => {
  it('tries the literal id, then the block- form, then the slug', () => {
    expect(fragmentCandidates('#export-a-pdf-to-share')).toEqual([
      'export-a-pdf-to-share',
      'block-export-a-pdf-to-share',
    ]);
    expect(fragmentCandidates('#Q-1')).toEqual(['Q-1', 'block-Q-1', 'q-1']);
    expect(fragmentCandidates('#block-Q-1')).toEqual(['block-Q-1', 'block-q-1']);
  });
  it('decodes a percent-encoded fragment and slugs loosely typed text', () => {
    expect(fragmentCandidates('#Open%20questions')).toEqual(['Open questions', 'block-Open questions', 'open-questions']);
  });
  it('is empty for a bare # or a non-fragment href', () => {
    expect(fragmentCandidates('#')).toEqual([]);
    expect(fragmentCandidates('?plan=x')).toEqual([]);
    expect(fragmentCandidates('https://a.b/#x')).toEqual([]);
  });
});
