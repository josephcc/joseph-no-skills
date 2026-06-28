#!/usr/bin/env bun
// Lint a plan .md against the interactive-plan format (SPEC.md).
// Usage: bun lint.ts <plan.md>   (run via `bun run lint:plan <plan.md>`)
import { readFileSync } from 'node:fs';
import { lintPlan } from './src/parser';

const file = process.argv[2];
if (!file) {
  console.error('usage: bun lint.ts <plan.md>');
  process.exit(2);
}

const raw = readFileSync(file, 'utf8');
const diags = lintPlan(raw);

if (diags.length === 0) {
  console.log(`✓ ${file}: valid interactive-plan format`);
  process.exit(0);
}

const errors = diags.filter((d) => d.severity === 'error');
for (const d of diags) {
  console.log(`${d.severity === 'error' ? '✗' : '⚠'} ${file}:${d.line}  ${d.message}`);
}
console.log(`\n${errors.length} error(s), ${diags.length - errors.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
