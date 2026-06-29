import { describe, expect, it } from 'vitest';
import { preprocessHighlights } from './markdown';

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
