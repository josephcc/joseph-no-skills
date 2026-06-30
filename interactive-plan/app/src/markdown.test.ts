import { describe, expect, it } from 'vitest';
import { preprocessHighlights, resolvePlanHref } from './markdown';

const NO_META: Record<string, { status: string; kind: string | null }> = {};

describe('preprocessHighlights', () => {
  it('wraps NESTED highlights as nested marks (both survive)', () => {
    const md = 'a <user-highlight comment="x">foo <user-highlight comment="y">bar</user-highlight> baz</user-highlight> z';
    const out = preprocessHighlights(md, NO_META);
    expect(out).toContain('data-comment="x"');
    expect(out).toContain('data-comment="y"');
    expect((out.match(/<mark /g) || []).length).toBe(2);
    expect((out.match(/<\/mark>/g) || []).length).toBe(2);
    expect(out).not.toContain('user-highlight'); // every tag converted
  });

  it('wraps a single highlight', () => {
    const out = preprocessHighlights('see <user-highlight comment="c1">this</user-highlight> here', NO_META);
    expect(out).toBe('see <mark class="ip-hl" data-comment="c1">this</mark> here');
  });

  it('leaves highlights inside inline code literal', () => {
    const md = 'example: `<user-highlight comment="x">y</user-highlight>` stays literal';
    const out = preprocessHighlights(md, NO_META);
    expect(out).toContain('`<user-highlight comment="x">y</user-highlight>`');
    expect(out).not.toContain('<mark');
  });

  it('renders an empty highlight as a clickable ◆ target marker', () => {
    const out = preprocessHighlights('decision body <user-highlight comment="c2"></user-highlight>', NO_META);
    expect(out).toBe('decision body <mark class="ip-hl ip-hl-target" data-comment="c2">◆</mark>');
  });

  it('applies kind/resolved styling from comment meta', () => {
    const out = preprocessHighlights('<user-highlight comment="c1">x</user-highlight>', {
      c1: { status: 'resolved', kind: 'error' },
    });
    expect(out).toContain('ip-hl-resolved');
    expect(out).toContain('data-kind="error"');
  });
});

describe('resolvePlanHref', () => {
  const BASE = '/Users/j/proj/notebook/hci/main.md';
  const enc = (p: string) => `?plan=${encodeURIComponent(p)}`;

  it('resolves a sibling .md link against the current plan dir', () => {
    expect(resolvePlanHref('new-domains.md', BASE)).toBe(enc('/Users/j/proj/notebook/hci/new-domains.md'));
  });
  it('resolves a parent (../) .md link', () => {
    expect(resolvePlanHref('../main.md', BASE)).toBe(enc('/Users/j/proj/notebook/main.md'));
    expect(resolvePlanHref('../pathway/main.md', BASE)).toBe(enc('/Users/j/proj/notebook/pathway/main.md'));
  });
  it('preserves a #fragment', () => {
    expect(resolvePlanHref('main.md#chi-paper', BASE)).toBe(enc('/Users/j/proj/notebook/hci/main.md') + '#chi-paper');
  });
  it('accepts an absolute fs path to a .md file', () => {
    expect(resolvePlanHref('/abs/other.md', BASE)).toBe(enc('/abs/other.md'));
  });
  it('ignores external URLs, in-page anchors, and non-.md targets', () => {
    expect(resolvePlanHref('https://example.com/x.md', BASE)).toBeNull();
    expect(resolvePlanHref('mailto:a@b.com', BASE)).toBeNull();
    expect(resolvePlanHref('#section', BASE)).toBeNull();
    expect(resolvePlanHref('notes.txt', BASE)).toBeNull();
    expect(resolvePlanHref('', BASE)).toBeNull();
  });
  it('skips a relative link when there is no base plan path', () => {
    expect(resolvePlanHref('new-domains.md', null)).toBeNull();
    expect(resolvePlanHref('/abs/other.md', null)).toBe(enc('/abs/other.md')); // absolute still works
  });
});
