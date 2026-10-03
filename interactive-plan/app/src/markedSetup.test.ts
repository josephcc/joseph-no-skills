import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { configureMarked } from './markedSetup';

configureMarked();

describe('configureMarked: strikethrough needs a double tilde', () => {
  it('leaves a LaTeX non-breaking space literal', () => {
    const html = marked.parse('see Table~\\ref{tab:a}. Then more text (Table~\\ref{tab:b}).') as string;
    expect(html).not.toContain('<del>');
    expect(html).toContain('Table~\\ref{tab:a}');
    expect(html).toContain('Table~\\ref{tab:b}');
  });

  it('leaves a single-tilde pair literal', () => {
    const html = marked.parse('a ~b~ c') as string;
    expect(html).not.toContain('<del>');
    expect(html).toContain('~b~');
  });

  it('still strikes a double-tilde span', () => {
    const html = marked.parse('a ~~gone~~ c') as string;
    expect(html).toContain('<del>gone</del>');
  });

  it('nests inline markdown inside a strikethrough', () => {
    const html = marked.parse('~~gone **for good**~~') as string;
    expect(html).toContain('<del>gone <strong>for good</strong></del>');
  });

  it('is idempotent', () => {
    configureMarked();
    configureMarked();
    expect(marked.parse('x ~y~ z ~~w~~') as string).toContain('~y~ z <del>w</del>');
  });
});
