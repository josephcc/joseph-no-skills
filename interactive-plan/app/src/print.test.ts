import { describe, expect, it } from 'vitest';
import { planToPrintHtml, renderBlocks, stripHighlights } from './print';
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
