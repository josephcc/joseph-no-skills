// Turning a turn's coded spans into renderable segments.
//
// `annotate` had to give up on overlapping spans (the second one became a ◆ marker
// after the turn) because nested markup cannot be expressed in one markdown string.
// Here the turn is plain text with offsets, so overlap is just a segmentation problem:
// every character knows which extracts cover it, and a span carrying two codes can
// show two underlines instead of falling off the end.
import type { Span } from './types';

export interface Segment {
  start: number;
  end: number;
  text: string;
  extracts: string[];
}

export function segmentTurn(text: string, spans: Span[]): Segment[] {
  const placed = spans.filter((s): s is Span & { start: number; end: number } =>
    typeof s.start === 'number' && typeof s.end === 'number' && s.end > s.start,
  );
  if (!placed.length) return text ? [{ start: 0, end: text.length, text, extracts: [] }] : [];
  const bounds = new Set<number>([0, text.length]);
  for (const s of placed) {
    bounds.add(Math.max(0, Math.min(s.start, text.length)));
    bounds.add(Math.max(0, Math.min(s.end, text.length)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (b <= a) continue;
    const covering = placed.filter((s) => s.start <= a && s.end >= b).map((s) => s.extract);
    out.push({ start: a, end: b, text: text.slice(a, b), extracts: covering });
  }
  return out;
}

/** Where a browser text selection sits inside the turn, as offsets ta.py can slice by. */
export function selectionOffsets(root: HTMLElement): { start: number; end: number; text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const text = range.toString();
  if (!text.trim()) return null;
  // Trim whitespace the selection swept up, so the stored span starts on a word.
  const lead = text.length - text.replace(/^\s+/, '').length;
  const trail = text.length - text.replace(/\s+$/, '').length;
  return { start: start + lead, end: start + text.length - trail, text: text.trim() };
}

/** Snap a selection outward to whole words: a quote should not start mid-word. */
export function snapToWords(text: string, start: number, end: number): { start: number; end: number } {
  let a = Math.max(0, Math.min(start, text.length));
  let b = Math.max(a, Math.min(end, text.length));
  while (a > 0 && /\S/.test(text[a - 1])) a--;
  while (b < text.length && /\S/.test(text[b])) b++;
  return { start: a, end: b };
}
