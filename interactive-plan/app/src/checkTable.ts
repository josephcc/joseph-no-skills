// The logic behind the viewer's check table — search, sort, ranges, and the
// `checked` list written back to the file — kept out of the component so it can
// be tested without a DOM.
import { marked } from 'marked';
import type { CheckTableBlock } from './types';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** A cell's text as a reader sees it (markdown rendered, tags dropped): what search and sort compare. */
export function cellText(md: string): string {
  const html = marked.parseInline(md.replace(/<user-highlight\b[^>]*>|<\/user-highlight>/g, '')) as string;
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
    .trim();
}

/** The cell as a number, if it is one: `1,234`, `12.5`, `-3`, `40%`. Otherwise null. */
export function cellNumber(text: string): number | null {
  const s = text.replace(/[,\s]/g, '').replace(/%$/, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : null;
}

/** A column sorts as numbers when every non-empty cell in it is one (years, citation counts). */
export function numericColumns(texts: string[][], ncols: number): boolean[] {
  return Array.from({ length: ncols }, (_, c) => {
    const vals = texts.map((r) => r[c] ?? '').filter((v) => v !== '');
    return vals.length > 0 && vals.every((v) => cellNumber(v) !== null);
  });
}

export type Show = 'all' | 'checked' | 'unchecked';
export interface Sort {
  col: number;
  dir: 1 | -1;
}

/**
 * The rows to display, as indices into the table: those that pass the show filter and contain
 * every search word (in any column), in sort order. Empty cells sort last in both directions,
 * and ties keep table order.
 */
export function visibleRows(
  texts: string[][],
  ids: string[],
  checked: Set<string>,
  query: string,
  show: Show,
  sort: Sort | null,
  numeric: boolean[],
): number[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const idx = texts
    .map((_, i) => i)
    .filter((i) => {
      if (show === 'checked' && !checked.has(ids[i])) return false;
      if (show === 'unchecked' && checked.has(ids[i])) return false;
      const hay = texts[i].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  if (!sort) return idx;
  const { col, dir } = sort;
  return idx.sort((a, b) => {
    const x = texts[a][col] ?? '';
    const y = texts[b][col] ?? '';
    if (!x || !y) return x === y ? a - b : x ? -1 : 1;
    const d = numeric[col]
      ? cellNumber(x)! - cellNumber(y)!
      : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
    return d * dir || a - b;
  });
}

/** The ids from `from` to `to` inclusive, in display order; just `to` when `from` isn't shown. */
export function rangeIds(shown: string[], from: string | null, to: string): string[] {
  const a = from == null ? -1 : shown.indexOf(from);
  const b = shown.indexOf(to);
  if (a === -1 || b === -1) return [to];
  return shown.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * The `checked` list after setting `ids` to `on`, in table order so a toggle is a small,
 * readable diff. An id that names no row (one the agent removed) is kept at the end rather
 * than dropped: it is the user's pick, and the linter flags it for the agent.
 */
export function nextChecked(t: CheckTableBlock, ids: string[], on: boolean): string[] {
  const set = new Set(t.checked);
  for (const id of ids) {
    if (on) set.add(id);
    else set.delete(id);
  }
  const rowIds = new Set(t.rows.map((r) => r.id));
  return [
    ...new Set([
      ...t.rows.map((r) => r.id).filter((id) => set.has(id)),
      ...t.checked.filter((id) => !rowIds.has(id) && set.has(id)),
    ]),
  ];
}
