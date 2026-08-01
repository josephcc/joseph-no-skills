import { describe, expect, it } from 'vitest';
import { isSafeHref, planToPrintHtml, renderBlocks, scrubHrefs, stripHighlights } from './print';
import { parsePlan } from './parser';

const render = (raw: string, opts = {}) => planToPrintHtml(raw, opts);
const blocks = (raw: string) => renderBlocks(parsePlan(raw).blocks);

describe('stripHighlights', () => {
  it('keeps the wrapped text and drops the anchor', () => {
    expect(stripHighlights('a <user-highlight comment="c1">span</user-highlight> b')).toBe('a span b');
  });

  it('drops an empty target anchor entirely', () => {
    expect(stripHighlights('text <user-highlight comment="c2"></user-highlight>')).toBe('text ');
  });

  it('leaves a literal tag inside a code fence alone', () => {
    const raw = ['```md', '<user-highlight comment="c1">x</user-highlight>', '```'].join('\n');
    expect(stripHighlights(raw)).toBe(raw);
  });
});

describe('planToPrintHtml', () => {
  it('renders the preamble once, as a header card and not as body text', () => {
    const raw = `**Status:** locked\n**Date:** 2026-08-01\n\n# Title\n\nbody text`;
    const html = render(raw);
    expect(html).toContain('pmetacard');
    // "locked" appears in the card; it must not also appear as a stray body paragraph.
    expect(html.match(/<b>Status:<\/b>/g)).toHaveLength(1);
    expect(html).not.toContain('<p><strong>Status:</strong>');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('body text');
  });

  it('renders a plan with no preamble without dropping the opening prose', () => {
    const html = render('# Title\n\nopening prose');
    expect(html).toContain('opening prose');
  });

  it('emits a self-contained document with the print stylesheet inlined', () => {
    const html = render('# T\n\nx');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('@page');
    expect(html).not.toContain('<link');
  });
});

describe('untrusted fields (answers and comment notes)', () => {
  const answered = (text: string) =>
    [
      '# T',
      '',
      '<open-question id="Q" title="Q?" status="answered">',
      'body',
      `<answer by="user" at="t" chose="other">${text}</answer>`,
      '</open-question>',
    ].join('\n');

  it('escapes raw HTML a user typed into an answer instead of emitting it', () => {
    const html = blocks(answered('<img src=x onerror=alert(1)>'));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes raw HTML in a comment note', () => {
    const html = blocks(
      '# T\n\n<comment id="c1" status="open"><note by="user" at="t"><script>bad()</script></note></comment>',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps a user-typed <Foo> visible rather than swallowing it as a tag', () => {
    expect(blocks(answered('use the <Foo> component'))).toContain('&lt;Foo&gt;');
  });

  it('strips a javascript: link a user wrote in an answer', () => {
    const html = blocks(answered('[click](javascript:alert(1))'));
    expect(html).not.toContain('href="javascript:');
  });

  it('still trusts plan prose, which may contain intentional inline HTML', () => {
    // A decision body is plan prose, not user free-text — the viewer does not escape it.
    const html = blocks('# T\n\n<decision id="D" title="t" status="locked">a <b>bold</b> claim</decision>');
    expect(html).toContain('<b>bold</b>');
  });
});

describe('isSafeHref (allowlist)', () => {
  it('allows relative links, anchors and the safe schemes', () => {
    for (const ok of [
      './other.md',
      '../up/other.md',
      'plain.md',
      '#anchor',
      '/abs/path',
      'https://example.com/a?b=1&c=2',
      'HTTP://EXAMPLE.COM',
      'mailto:a@b.com',
    ]) {
      expect(isSafeHref(ok), ok).toBe(true);
    }
  });

  it('refuses every dangerous scheme and every encoding of it', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java\tscript:alert(1)',
      ' javascript:alert(1)',
      'vbscript:x',
      'data:text/html,x',
      'file:///etc/passwd',
      // a blocklist cannot catch these without decoding every named reference
      'javascript&colon;alert(1)',
      'data&colon;text/html,x',
      '&#106;avascript:alert(1)',
      '&#x6a;avascript:alert(1)',
      '%6Aavascript:alert(1)',
    ]) {
      expect(isSafeHref(bad), bad).toBe(false);
    }
  });

  it('scrubHrefs drops exactly the unsafe ones from rendered HTML', () => {
    expect(scrubHrefs('<a href="javascript&colon;alert(1)">a</a>')).not.toContain('href=');
    expect(scrubHrefs('<a href="https://example.com">a</a>')).toContain('href="https://example.com"');
  });
});

describe('user-authored code spans', () => {
  it('shows a code span the user typed as <Foo>, not as escaped entities', () => {
    const raw = [
      '# T',
      '',
      '<comment id="c1" status="open"><note by="user" at="t">use the `<Foo>` component</note></comment>',
    ].join('\n');
    const html = renderBlocks(parsePlan(raw).blocks);
    expect(html).toContain('<code>&lt;Foo&gt;</code>');
    expect(html).not.toContain('&amp;lt;Foo');
  });

  it('still does not let a code span smuggle a tag out', () => {
    const raw =
      '# T\n\n<comment id="c1" status="open"><note by="user" at="t">`</code><script>x()</script>`</note></comment>';
    const html = renderBlocks(parsePlan(raw).blocks);
    expect(html).not.toContain('<script>');
  });
});

describe('comment anchors', () => {
  const raw = [
    '# T',
    '',
    'a claim with a <user-highlight comment="c1">highlighted span</user-highlight> in it',
    'and a target <user-highlight comment="c2"></user-highlight>',
    '',
    '<comment id="c1" status="open"><note by="user" at="t">why this?</note></comment>',
  ].join('\n');

  it('keeps the anchor visible when comments are printed, so a remark has a referent', () => {
    const html = planToPrintHtml(raw);
    expect(html).toContain('<mark class="phl">highlighted span</mark>');
    expect(html).toContain('<sup class="phlref">c2</sup>');
    expect(html).toContain('why this?');
  });

  it('drops the anchors when comments are omitted — nothing left to point at', () => {
    const html = planToPrintHtml(raw, { noComments: true });
    expect(html).not.toContain('<mark');
    // the class name also appears in the inlined stylesheet, so assert on the element
    expect(html).not.toContain('<sup class="phlref"');
    expect(html).toContain('highlighted span'); // the text itself survives
  });
});

describe('content before the title', () => {
  it('keeps ordinary prose that sits between the preamble and the title', () => {
    const raw = `**Status:** open\n\nan intro paragraph before the heading\n\n# T\n\nbody`;
    const html = planToPrintHtml(raw);
    expect(html).toContain('an intro paragraph before the heading');
    // ...while still showing the preamble only in the header card
    expect(html.match(/<b>Status:<\/b>/g)).toHaveLength(1);
  });

  it('drops a wrapped preamble continuation from the body, not just the first line', () => {
    const raw = `**Verdict:** a long verdict that\nwraps onto a second line\n\n# T\n\nbody`;
    const html = planToPrintHtml(raw);
    expect(html).toContain('wraps onto a second line'); // present in the card
    expect(html).not.toContain('<p>wraps onto a second line'); // not repeated as body
  });
});

describe('base href', () => {
  it('emits a base element so relative assets resolve at the plan directory', () => {
    const html = planToPrintHtml('# T\n\n![d](./d.png)', { baseHref: 'file:///plans/' });
    expect(html).toContain('<base href="file:///plans/">');
  });

  it('omits it when not supplied', () => {
    expect(planToPrintHtml('# T\n\nx')).not.toContain('<base');
  });
});

describe('block rendering', () => {
  it('renders a decision with its status badge, title and rationale', () => {
    const html = blocks(
      '# T\n\n<decision id="D1" title="Keep Opus" status="locked" date="2026-08-01">\nWe keep it.\n<rationale>Cheaper models lose evidence.</rationale>\n</decision>',
    );
    expect(html).toContain('pcall-locked');
    expect(html).toContain('>locked<');
    expect(html).toContain('Keep Opus');
    expect(html).toContain('We keep it.');
    expect(html).toContain('Cheaper models lose evidence.');
  });

  it('renders a finding with its severity', () => {
    const html = blocks('# T\n\n<finding id="F-1" title="Broken" severity="p1" status="open">detail</finding>');
    expect(html).toContain('pcall-p1');
    expect(html).toContain('Broken');
    expect(html).toContain('detail');
  });

  it('shows only the chosen option for an answered question', () => {
    const raw = [
      '# T',
      '',
      '<open-question id="Q-A" title="Which?" status="answered">',
      'Pick one.',
      '<options select="single">',
      '  <option id="keep">Keep it as is.</option>',
      '  <option id="drop">Throw it away.</option>',
      '</options>',
      '<answer by="user" at="2026-08-01T00:00" chose="keep">agreed</answer>',
      '</open-question>',
    ].join('\n');
    const html = blocks(raw);
    expect(html).toContain('Keep it as is.');
    expect(html).toContain('agreed');
    // The rejected option must not reappear — a settled question should not read as a menu.
    expect(html).not.toContain('Throw it away.');
  });

  it('lists the options for an unanswered question, and can omit it entirely', () => {
    const raw = [
      '# T',
      '',
      '<open-question id="Q-B" title="Open one" status="open">',
      'Body.',
      '<options select="single">',
      '  <option id="a">Alpha choice.</option>',
      '</options>',
      '</open-question>',
    ].join('\n');
    expect(blocks(raw)).toContain('Alpha choice.');
    expect(planToPrintHtml(raw, { noQuestions: true })).not.toContain('Alpha choice.');
  });

  it('groups consecutive checks into one checklist and marks done items', () => {
    const raw = [
      '# T',
      '',
      '<check id="k1" status="done">first thing</check>',
      '<check id="k2" status="todo">second thing</check>',
    ].join('\n');
    const html = blocks(raw);
    expect(html.match(/<ul class="pchecks">/g)).toHaveLength(1);
    expect(html).toContain('pdone');
    expect(html).toContain('first thing');
    expect(html).toContain('second thing');
  });

  it('omits comment threads when asked', () => {
    const raw =
      '# T\n\n<comment id="c1" status="open" kind="nit"><note by="user" at="t">a remark</note></comment>';
    expect(blocks(raw)).toContain('a remark');
    expect(planToPrintHtml(raw, { noComments: true })).not.toContain('a remark');
  });

  it('renders tables so they can paginate with repeated headers', () => {
    const html = render('# T\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('display: table-header-group');
  });
});
