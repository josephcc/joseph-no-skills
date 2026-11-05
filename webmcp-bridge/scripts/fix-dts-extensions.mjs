// tsc keeps `.ts`/`.tsx` extensions in emitted declaration files; rewrite them to `.js` so consumers resolve them.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.d.ts') ? [p] : []; });
for (const file of walk(process.argv[2] ?? 'dist')) {
  const src = readFileSync(file, 'utf8');
  const out = src.replace(/(from\s+['"]\.[^'"]*?)\.tsx?(['"])/g, '$1.js$2').replace(/(import\s*\(\s*['"]\.[^'"]*?)\.tsx?(['"]\s*\))/g, '$1.js$2').replace(/(import\s+['"]\.[^'"]*?)\.tsx?(['"])/g, '$1.js$2');
  if (out !== src) writeFileSync(file, out);
}
