#!/usr/bin/env bun
// Print the rows the user ticked in a plan's <check-table>s, so the agent takes the pick
// from the file rather than matching ids against a long table by eye.
// Usage: bun checked.ts <plan.md> [table-id] [--unchecked]   (run via `bun run checked …`)
//   no table id: one line per table — id, checked/total, title
//   a table id:  its checked rows (or the unchecked ones) as a JSON array, one object per
//                row keyed by column header, each cell's markdown exactly as authored
import { readFileSync } from 'node:fs';
import { parsePlan } from './src/parser';
import type { CheckTableBlock } from './src/types';

const args = process.argv.slice(2);
const unchecked = args.includes('--unchecked');
const [file, tableId] = args.filter((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: bun checked.ts <plan.md> [table-id] [--unchecked]');
  process.exit(2);
}

const tables = parsePlan(readFileSync(file, 'utf8')).blocks.filter(
  (b): b is CheckTableBlock => b.type === 'check-table',
);

if (!tableId) {
  if (!tables.length) console.log(`no <check-table> in ${file}`);
  for (const t of tables) {
    const on = new Set(t.checked);
    console.log(`${t.id}\t${t.rows.filter((r) => on.has(r.id)).length}/${t.rows.length} checked\t${t.title}`);
  }
  process.exit(0);
}

const t = tables.find((x) => x.id === tableId);
if (!t) {
  console.error(`no <check-table id="${tableId}"> in ${file}; it has: ${tables.map((x) => x.id).join(', ') || 'none'}`);
  process.exit(1);
}
const on = new Set(t.checked);
const missing = t.checked.filter((id) => !t.rows.some((r) => r.id === id));
if (missing.length) console.error(`checked ids with no row in the table: ${missing.join(', ')}`);
const rows = t.rows
  .filter((r) => on.has(r.id) !== unchecked)
  .map((r) => Object.fromEntries(t.columns.map((c, i) => [c.header, r.cells[i] ?? ''])));
console.log(JSON.stringify(rows, null, 2));
