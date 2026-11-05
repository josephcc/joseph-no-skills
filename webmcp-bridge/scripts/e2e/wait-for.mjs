// Usage: node scripts/e2e/wait-for.mjs <url-or-file> [substring] [tries]
// URL: waits until it responds 2xx; file: waits until it contains the substring. Prints the matched text.
import { readFileSync, existsSync } from 'node:fs';
const [target, needle = '', tries = '60'] = process.argv.slice(2);
for (let i = 0; i < Number(tries); i++) {
  try {
    if (/^https?:/.test(target)) { const r = await fetch(target); if (r.ok) { console.log(`up: ${target}`); process.exit(0); } }
    else if (existsSync(target)) { const t = readFileSync(target, 'utf8'); if (t.includes(needle)) { console.log(t.trim().split('\n').find((l) => l.includes(needle))); process.exit(0); } }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
console.error(`timeout waiting for ${target} ${needle}`); process.exit(1);
