import { describe, expect, it } from 'vitest';
import { appendTableTarget, lintPlan, parsePlan, replaceBlock, serializeBlock } from './parser';
import { cellNumber, cellText, nextChecked, numericColumns, rangeIds, visibleRows } from './checkTable';
import type { CheckTableBlock } from './types';

const TABLE = [
  '<check-table id="T-papers" title="Candidate papers" checked="p2">',
  'Tick the papers to keep.',
  '',
  '| id | Title | Venue | Year | Citations |',
  '|----|-------|-------|-----:|----------:|',
  '| p1 | [Sensecape](https://doi.org/1) | UIST | 2023 | 1,120 |',
  '| p2 | Threddy \\| a thread tool | CHI | 2022 | 85 |',
  '| p3 | `Synergi` | UIST | 2023 |  |',
  '',
  'Rows the search missed go below.',
  '</check-table>',
].join('\n');

const table = (raw = TABLE) => parsePlan(raw).blocks.find((b) => b.type === 'check-table') as CheckTableBlock;

describe('<check-table> parsing', () => {
  it('reads columns, row ids, cells, and the checked list', () => {
    const t = table();
    expect(t.id).toBe('T-papers');
    expect(t.title).toBe('Candidate papers');
    expect(t.checked).toEqual(['p2']);
    expect(t.columns.map((c) => c.header)).toEqual(['id', 'Title', 'Venue', 'Year', 'Citations']);
    expect(t.columns.map((c) => c.align)).toEqual([null, null, null, 'right', 'right']);
    expect(t.rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
    expect(t.rows[1].cells[1]).toBe('Threddy | a thread tool'); // escaped pipe, unescaped
    expect(t.before).toContain('Tick the papers to keep.');
    expect(t.after).toContain('Rows the search missed go below.');
  });

  it('is not mistaken for a <check> tag', () => {
    const p = parsePlan(`${TABLE}\n\n<check id="k1" status="todo">a task</check>`);
    expect(p.blocks.filter((b) => b.type === 'check-table')).toHaveLength(1);
    expect(p.blocks.filter((b) => b.type === 'check')).toHaveLength(1);
  });

  it('round-trips byte-for-byte when nothing changed', () => {
    const t = table();
    expect(replaceBlock(TABLE, t.range, serializeBlock(t))).toBe(TABLE);
  });

  it('a tick rewrites only the opening tag', () => {
    const t = table();
    const next = replaceBlock(TABLE, t.range, serializeBlock({ ...t, checked: ['p1', 'p2'] }));
    const before = TABLE.split('\n');
    const after = next.split('\n');
    expect(after[0]).toBe('<check-table id="T-papers" title="Candidate papers" checked="p1,p2">');
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it('drops the attribute when nothing is checked', () => {
    const t = table();
    expect(serializeBlock({ ...t, checked: [] }).split('\n')[0]).toBe(
      '<check-table id="T-papers" title="Candidate papers">',
    );
  });

  it('anchors a comment target in the prose above the table, never in a row', () => {
    const t = table();
    const inner = appendTableTarget(t, 'c9');
    expect(inner).toContain('Tick the papers to keep. <user-highlight comment="c9"></user-highlight>');
    const round = table(TABLE.replace(t.inner, inner));
    expect(round.rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('anchors a target on its own line when the table has no prose above it', () => {
    const raw = TABLE.replace('Tick the papers to keep.\n\n', '');
    const t = table(raw);
    const round = table(raw.replace(t.inner, appendTableTarget(t, 'c9')));
    expect(round.before).toContain('<user-highlight comment="c9"></user-highlight>');
    expect(round.rows).toHaveLength(3);
  });
});

describe('<check-table> lint', () => {
  const msgs = (raw: string) => lintPlan(raw).map((d) => `${d.severity}: ${d.message}`);

  it('passes a valid table', () => {
    expect(lintPlan(TABLE)).toEqual([]);
  });

  it('requires a table inside', () => {
    expect(msgs('<check-table id="T" title="x">just prose</check-table>')).toContain(
      'error: <check-table id="T"> has no markdown table inside it.',
    );
  });

  it('requires a title', () => {
    expect(msgs(TABLE.replace(' title="Candidate papers"', ''))).toContain(
      'error: <check-table> is missing required attribute "title".',
    );
  });

  it('flags duplicate and unstorable row ids, on the row they sit on', () => {
    const raw = TABLE.replace('| p2 |', '| p1 |').replace('| p3 |', '| p 3 |');
    const d = lintPlan(raw).filter((x) => x.severity === 'error');
    expect(d.map((x) => x.message)).toEqual([
      '<check-table id="T-papers"> has two rows with id "p1".',
      `<check-table id="T-papers"> row id "p 3" can't hold spaces, commas or quotes (it is stored in checked="…").`,
      '<check-table id="T-papers"> checked="p2" names no row in the table.',
    ]);
    expect(d[0].line).toBe(7);
    expect(d[1].line).toBe(8);
  });

  it('flags a checked id whose row the agent removed', () => {
    const raw = TABLE.replace('checked="p2"', 'checked="p2,p9"');
    expect(msgs(raw)).toContain('error: <check-table id="T-papers"> checked="p9" names no row in the table.');
  });

  it('warns that a second table gets no checkboxes', () => {
    const raw = TABLE.replace('Rows the search missed', '| a | b |\n|---|---|\n| 1 | 2 |\n\nRows the search missed');
    expect(msgs(raw)).toContain(
      'warning: <check-table id="T-papers"> holds more than one table; only the first gets checkboxes.',
    );
  });
});

describe('check-table view logic', () => {
  const t = table();
  const texts = t.rows.map((r) => r.cells.map(cellText));
  const ids = t.rows.map((r) => r.id);
  const numeric = numericColumns(texts, t.columns.length);

  it('reads cells as rendered text', () => {
    expect(cellText('[Sensecape](https://doi.org/1)')).toBe('Sensecape');
    expect(cellText('`a<b`')).toBe('a<b');
    expect(cellText('x <user-highlight comment="c1">y</user-highlight>')).toBe('x y');
  });

  it('treats counts with separators as numbers, and titles as text', () => {
    expect(cellNumber('1,120')).toBe(1120);
    expect(cellNumber('40%')).toBe(40);
    expect(cellNumber('GPT-4')).toBeNull();
    expect(numeric).toEqual([false, false, false, true, true]);
  });

  it('filters on every search word, in any column', () => {
    expect(visibleRows(texts, ids, new Set(), 'uist 2023', 'all', null, numeric)).toEqual([0, 2]);
    expect(visibleRows(texts, ids, new Set(), 'threddy', 'all', null, numeric)).toEqual([1]);
  });

  it('filters on checked state', () => {
    const on = new Set(['p2']);
    expect(visibleRows(texts, ids, on, '', 'checked', null, numeric)).toEqual([1]);
    expect(visibleRows(texts, ids, on, '', 'unchecked', null, numeric)).toEqual([0, 2]);
  });

  it('sorts numbers numerically and puts empty cells last both ways', () => {
    expect(visibleRows(texts, ids, new Set(), '', 'all', { col: 4, dir: -1 }, numeric)).toEqual([0, 1, 2]);
    expect(visibleRows(texts, ids, new Set(), '', 'all', { col: 4, dir: 1 }, numeric)).toEqual([1, 0, 2]);
  });

  it('keeps table order for ties', () => {
    expect(visibleRows(texts, ids, new Set(), '', 'all', { col: 2, dir: 1 }, numeric)).toEqual([1, 0, 2]);
  });

  it('ranges run in display order, either direction', () => {
    expect(rangeIds(['p3', 'p1', 'p2'], 'p2', 'p3')).toEqual(['p3', 'p1', 'p2']);
    expect(rangeIds(['p3', 'p1', 'p2'], null, 'p1')).toEqual(['p1']);
    expect(rangeIds(['p3', 'p1'], 'p2', 'p1')).toEqual(['p1']);
  });

  it('writes checked ids in table order and keeps ones whose row is gone', () => {
    expect(nextChecked({ ...t, checked: ['p3'] }, ['p1'], true)).toEqual(['p1', 'p3']);
    expect(nextChecked({ ...t, checked: ['p9', 'p2'] }, ['p2'], false)).toEqual(['p9']);
    expect(nextChecked({ ...t, checked: ['p9'] }, ['p1', 'p2'], true)).toEqual(['p1', 'p2', 'p9']);
  });
});
