// Code helpers: one hue per family, lookups, search, and the health counts the
// codebook view uses as filters.
import type { Bundle, Code, Extract } from './types';

/** A stable hue per top-level code, so a family reads the same in every view. */
export function familyIndex(codes: Code[]): Record<string, number> {
  const tops = codes.filter((c) => !c.parent && c.status !== 'merged' && c.status !== 'retired').map((c) => c.id).sort();
  const idx: Record<string, number> = {};
  tops.forEach((id, i) => (idx[id] = i));
  const out: Record<string, number> = {};
  for (const c of codes) out[c.id] = idx[c.parent ?? c.id] ?? idx[c.id] ?? -1;
  return out;
}

export const topOf = (id: string): string => (id.includes('.') ? id.split('.')[0] : id);

export const byId = (codes: Code[]): Record<string, Code> => Object.fromEntries(codes.map((c) => [c.id, c]));

export const liveCodes = (codes: Code[]): Code[] => codes.filter((c) => c.status === 'candidate' || c.status === 'accepted');

/** Codes as a two-level tree, parents in id order with their children under them. */
export function codeTree(codes: Code[]): { parent: Code; children: Code[] }[] {
  const live = liveCodes(codes);
  const tops = live.filter((c) => !c.parent).sort((a, b) => a.id.localeCompare(b.id));
  return tops.map((parent) => ({
    parent,
    children: live.filter((c) => c.parent === parent.id).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

export function searchCodes(codes: Code[], query: string): Code[] {
  const q = query.trim().toLowerCase();
  const live = liveCodes(codes);
  if (!q) return live.slice(0, 40);
  const score = (c: Code): number => {
    const id = c.id.toLowerCase();
    const name = (c.name ?? '').toLowerCase();
    if (id === q) return 0;
    if (id.startsWith(q)) return 1;
    if (id.includes(q)) return 2;
    if (name.startsWith(q)) return 3;
    if (name.includes(q)) return 4;
    if ((c.definition ?? '').toLowerCase().includes(q)) return 5;
    return 99;
  };
  return live
    .map((c) => ({ c, s: score(c) }))
    .filter((r) => r.s < 99)
    .sort((a, b) => a.s - b.s || a.c.id.localeCompare(b.c.id))
    .map((r) => r.c)
    .slice(0, 40);
}

export interface Health {
  key: string;
  label: string;
  ids: string[];
}

/** The cleanup review as a strip of filters: each number is a question about the codebook. */
export function health(bundle: Bundle): Health[] {
  const live = liveCodes(bundle.codes);
  const tops = live.filter((c) => !c.parent);
  const childless = tops.filter((c) => !live.some((k) => k.parent === c.id));
  const parentHeavy = tops.filter((c) => {
    const kids = live.filter((k) => k.parent === c.id);
    return kids.length > 0 && c.direct_extracts > c.child_extracts;
  });
  const onlyChild = tops.filter((c) => {
    const kids = live.filter((k) => k.parent === c.id);
    return kids.length === 1 && c.direct_extracts === 0;
  });
  const thin = live.filter((c) => c.n <= 1);
  const dupeIds = [...new Set(bundle.dupes.flatMap((d) => [d.a, d.b]))];
  const candidates = live.filter((c) => c.status === 'candidate');
  const unreviewed = live.filter((c) => !c.reviewed);
  return [
    { key: 'top', label: 'top-level', ids: tops.map((c) => c.id) },
    { key: 'flat', label: 'no children', ids: childless.map((c) => c.id) },
    { key: 'parent-heavy', label: 'parent holds more than its children', ids: parentHeavy.map((c) => c.id) },
    { key: 'only-child', label: 'one child holds everything', ids: onlyChild.map((c) => c.id) },
    { key: 'thin', label: '≤1 participant', ids: thin.map((c) => c.id) },
    { key: 'dupes', label: 'duplicate suspicion', ids: dupeIds },
    { key: 'candidate', label: 'candidate', ids: candidates.map((c) => c.id) },
    { key: 'unreviewed', label: 'never reviewed', ids: unreviewed.map((c) => c.id) },
  ];
}

/** Extracts carrying a code or any of its children, in transcript order. */
export function extractsForCode(extracts: Extract[], code: Code): Extract[] {
  const fam = new Set(code.family?.length ? code.family : [code.id]);
  return extracts
    .filter((e) => e.codes.some((c) => fam.has(c)))
    .sort((a, b) => a.transcript.localeCompare(b.transcript) || a.line_start - b.line_start);
}

export const KIND_GLYPH: Record<string, string> = { said: '●', did: '▶', intent: '◇' };
export const KIND_LABEL: Record<string, string> = { said: 'said', did: 'did', intent: 'intent' };
