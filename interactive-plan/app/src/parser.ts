import type {
  Answer,
  Block,
  CheckBlock,
  CommentBlock,
  DecisionBlock,
  Diagnostic,
  FindingBlock,
  KeyVal,
  Note,
  Option,
  ParsedPlan,
  QuestionBlock,
} from './types';

const BLOCK_TAGS = ['open-question', 'decision', 'finding', 'comment', 'check'] as const;
type BlockTagName = (typeof BLOCK_TAGS)[number];

// --- attribute parsing -------------------------------------------------------

export function parseAttrs(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(openTag))) attrs[m[1]] = m[2];
  return attrs;
}

function escapeAttr(v: string): string {
  return v.replace(/"/g, '&quot;');
}

// User-authored bodies (answer text, comment notes) are kept RAW in the model
// but entity-encoded at the file boundary, so a literal structural close tag
// (</note>, </answer>, …) typed by the user can't truncate the block on
// re-parse. decodeEntities reverses it on the way back, keeping the model raw —
// so this is round-trip-stable (no double-encoding) and the render path still
// escapes for display.
export function encodeEntities(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// --- protected regions (code) ------------------------------------------------

interface Range {
  start: number;
  end: number;
}

// Fenced code blocks (``` / ~~~).
export function fenceRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const re = /^([ \t]*)(```+|~~~+)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ranges.push({ start: m.index, end: m.index + m[0].length });
  return ranges;
}

// Inline code spans (`…`), single-line.
function inlineCodeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  const re = /(`+)([^`\n]+?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ranges.push({ start: m.index, end: m.index + m[0].length });
  return ranges;
}

// Regions where tag-like text is literal and must NOT be parsed as a tag.
export function protectedRanges(text: string): Range[] {
  return [...fenceRanges(text), ...inlineCodeRanges(text)];
}

function inAnyRange(idx: number, ranges: Range[]): boolean {
  return ranges.some((r) => idx >= r.start && idx < r.end);
}

// Given the index of a '<' that opens a tag, return the index just past its
// closing '>', skipping any '>' inside double-quoted attribute values.
function scanOpenTagEnd(raw: string, start: number): number {
  let inQuote = false;
  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuote) {
      if (ch === '"') inQuote = false;
    } else if (ch === '"') inQuote = true;
    else if (ch === '>') return i + 1;
  }
  return -1;
}

interface RawBlockTag {
  name: BlockTagName;
  start: number;
  openEnd: number; // index after the opening tag's '>'
  closeIdx: number; // index of the matching '</tag>', or -1 if unclosed
  end: number; // index after the closing tag, or -1
}

// Quote-aware, code-aware scan for the top-level block tags. Tag-like text
// inside attribute values or code regions is skipped.
function scanBlockTags(raw: string, prot: Range[]): RawBlockTag[] {
  const out: RawBlockTag[] = [];
  let i = 0;
  while (i < raw.length) {
    const lt = raw.indexOf('<', i);
    if (lt === -1) break;
    if (inAnyRange(lt, prot)) {
      i = lt + 1;
      continue;
    }
    const m = /^<(open-question|decision|finding|comment|check)\b/.exec(raw.slice(lt, lt + 16));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = m[1] as BlockTagName;
    const openEnd = scanOpenTagEnd(raw, lt);
    if (openEnd === -1) {
      i = lt + 1;
      continue;
    }
    const closeTag = `</${name}>`;
    let from = openEnd;
    let closeIdx = -1;
    for (;;) {
      const idx = raw.indexOf(closeTag, from);
      if (idx === -1) break;
      if (!inAnyRange(idx, prot)) {
        closeIdx = idx;
        break;
      }
      from = idx + closeTag.length;
    }
    if (closeIdx === -1) {
      out.push({ name, start: lt, openEnd, closeIdx: -1, end: -1 });
      i = openEnd;
      continue;
    }
    const end = closeIdx + closeTag.length;
    out.push({ name, start: lt, openEnd, closeIdx, end });
    i = end;
  }
  return out;
}

// --- preamble ----------------------------------------------------------------

function parsePreamble(raw: string): { preamble: KeyVal[]; title: string | null } {
  const preamble: KeyVal[] = [];
  const lines = raw.split('\n');
  let title: string | null = null;
  // A value may wrap onto following lines, which carry no `**Key:**` of their own. Only the
  // lines *immediately* after an entry continue it: a blank line or any structural markdown
  // ends the entry, so unrelated prose or fenced content later in the preamble region is
  // never absorbed into the last key.
  let continuing = false;
  for (const line of lines) {
    const headingMatch = /^#\s+(.*)$/.exec(line);
    if (headingMatch) {
      title = headingMatch[1].trim();
      break;
    }
    const kv = /^\*\*([^:*]+):\*\*\s*(.*)$/.exec(line.trim());
    if (kv) {
      preamble.push({ key: kv[1].trim(), value: kv[2].trim() });
      continuing = true;
      continue;
    }
    const cont = line.trim();
    const structural = /^(-{3,}|\*{3,}|_{3,}|#{1,6}\s|[-*+]\s|\d+\.\s|>|\||```|~~~)/.test(cont);
    if (continuing && cont && !structural) {
      const prev = preamble[preamble.length - 1];
      prev.value = `${prev.value} ${cont}`.trim();
    } else {
      continuing = false;
    }
  }
  return { preamble, title };
}

// --- inner-tag helpers -------------------------------------------------------

// Quote-aware + code-aware scan for a named tag within a slice. A '>' inside a
// quoted attribute value does not end the open tag, and a literal close tag
// inside inline/fenced code is not treated as the real close.
function scanTag(text: string, name: string, prot: Range[]): { start: number; openEnd: number; closeIdx: number; end: number }[] {
  const out: { start: number; openEnd: number; closeIdx: number; end: number }[] = [];
  const closeTag = `</${name}>`;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<' + name, i);
    if (lt === -1) break;
    const after = text[lt + 1 + name.length];
    if (after !== undefined && !/[\s/>]/.test(after)) {
      i = lt + 1;
      continue;
    }
    if (inAnyRange(lt, prot)) {
      i = lt + 1;
      continue;
    }
    const openEnd = scanOpenTagEnd(text, lt);
    if (openEnd === -1) {
      i = lt + 1;
      continue;
    }
    let from = openEnd;
    let closeIdx = -1;
    for (;;) {
      const idx = text.indexOf(closeTag, from);
      if (idx === -1) break;
      if (!inAnyRange(idx, prot)) {
        closeIdx = idx;
        break;
      }
      from = idx + closeTag.length;
    }
    if (closeIdx === -1) {
      i = openEnd;
      continue;
    }
    out.push({ start: lt, openEnd, closeIdx, end: closeIdx + closeTag.length });
    i = closeIdx + closeTag.length;
  }
  return out;
}

function extractFirst(inner: string, tag: string): { open: string; body: string; full: string } | null {
  const occ = scanTag(inner, tag, protectedRanges(inner))[0];
  if (!occ) return null;
  return {
    open: inner.slice(occ.start, occ.openEnd),
    body: inner.slice(occ.openEnd, occ.closeIdx),
    full: inner.slice(occ.start, occ.end),
  };
}

function extractAll(inner: string, tag: string): { open: string; body: string }[] {
  const prot = protectedRanges(inner);
  return scanTag(inner, tag, prot).map((o) => ({
    open: inner.slice(o.start, o.openEnd),
    body: inner.slice(o.openEnd, o.closeIdx),
  }));
}

// --- per-tag parsing ---------------------------------------------------------

function parseQuestion(open: string, inner: string, range: Range): QuestionBlock {
  const a = parseAttrs(open);
  let body = inner;
  let select: 'single' | 'multi' | null = null;
  const options: Option[] = [];

  const optionsBlock = extractFirst(inner, 'options');
  if (optionsBlock) {
    const oa = parseAttrs(optionsBlock.open);
    select = oa.select === 'multi' ? 'multi' : 'single';
    for (const opt of extractAll(optionsBlock.body, 'option')) {
      options.push({ id: parseAttrs(opt.open).id ?? '', body: opt.body.trim() });
    }
    body = body.replace(optionsBlock.full, '');
  }

  let answer: Answer | null = null;
  const answerBlock = extractFirst(inner, 'answer');
  if (answerBlock) {
    const aa = parseAttrs(answerBlock.open);
    answer = {
      by: aa.by ?? 'user',
      at: aa.at ?? '',
      chose: (aa.chose ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      text: decodeEntities(answerBlock.body.trim()),
    };
    body = body.replace(answerBlock.full, '');
  }

  return {
    type: 'question',
    id: a.id ?? '',
    title: a.title ?? '',
    status: a.status === 'answered' ? 'answered' : 'open',
    body: body.trim(),
    select,
    options,
    answer,
    range,
  };
}

function parseDecision(open: string, inner: string, range: Range): DecisionBlock {
  const a = parseAttrs(open);
  let body = inner;
  let rationale: string | null = null;
  const r = extractFirst(inner, 'rationale');
  if (r) {
    rationale = r.body.trim();
    body = body.replace(r.full, '');
  }
  const status = a.status as DecisionBlock['status'];
  return {
    type: 'decision',
    id: a.id ?? '',
    title: a.title ?? '',
    status: ['proposed', 'locked', 'superseded', 'wontfix'].includes(status) ? status : 'proposed',
    date: a.date ?? null,
    from: a.from ?? null,
    supersedes: a.supersedes ?? null,
    body: body.trim(),
    rationale,
    range,
  };
}

function parseFinding(open: string, inner: string, range: Range): FindingBlock {
  const a = parseAttrs(open);
  const sev = a.severity as FindingBlock['severity'];
  const status = a.status as FindingBlock['status'];
  return {
    type: 'finding',
    id: a.id ?? '',
    title: a.title ?? '',
    severity: ['p0', 'p1', 'p2', 'p3'].includes(sev) ? sev : 'p3',
    status: ['open', 'fixed', 'wontfix', 'deferred', 'partial'].includes(status) ? status : 'open',
    effort: a.effort ?? null,
    body: inner.trim(),
    range,
  };
}

function parseComment(open: string, inner: string, range: Range): CommentBlock {
  const a = parseAttrs(open);
  const notes: Note[] = extractAll(inner, 'note').map((n) => {
    const na = parseAttrs(n.open);
    return { by: na.by ?? 'user', at: na.at ?? '', body: decodeEntities(n.body.trim()) };
  });
  const kind = a.kind as CommentBlock['kind'];
  return {
    type: 'comment',
    id: a.id ?? '',
    status: a.status === 'resolved' ? 'resolved' : 'open',
    kind: ['error', 'clarify', 'question', 'nit'].includes(kind ?? '') ? kind : null,
    resolvedBy: a['resolved-by'] ?? null,
    resolvedAt: a['resolved-at'] ?? null,
    notes,
    range,
  };
}

function parseCheck(open: string, inner: string, range: Range): CheckBlock {
  const a = parseAttrs(open);
  return {
    type: 'check',
    id: a.id ?? '',
    status: a.status === 'done' ? 'done' : 'todo',
    label: inner.trim(),
    range,
  };
}

// --- main parse --------------------------------------------------------------

export function parsePlan(raw: string): ParsedPlan {
  const { preamble, title } = parsePreamble(raw);
  const prot = protectedRanges(raw);
  const blocks: Block[] = [];
  let cursor = 0;

  for (const t of scanBlockTags(raw, prot)) {
    if (t.closeIdx === -1) continue; // unclosed: leave as markdown (linter reports it)
    if (t.start > cursor) {
      const text = raw.slice(cursor, t.start);
      if (text.trim()) blocks.push({ type: 'markdown', text, range: { start: cursor, end: t.start } });
    }
    const open = raw.slice(t.start, t.openEnd);
    const inner = raw.slice(t.openEnd, t.closeIdx);
    const range = { start: t.start, end: t.end };
    if (t.name === 'open-question') blocks.push(parseQuestion(open, inner, range));
    else if (t.name === 'decision') blocks.push(parseDecision(open, inner, range));
    else if (t.name === 'finding') blocks.push(parseFinding(open, inner, range));
    else if (t.name === 'check') blocks.push(parseCheck(open, inner, range));
    else blocks.push(parseComment(open, inner, range));
    cursor = t.end;
  }
  if (cursor < raw.length) {
    const text = raw.slice(cursor);
    if (text.trim()) blocks.push({ type: 'markdown', text, range: { start: cursor, end: raw.length } });
  }

  return { preamble, title, blocks, raw };
}

// --- serialization (round-trip) ---------------------------------------------

export function serializeQuestion(q: QuestionBlock): string {
  const attrs = [`id="${escapeAttr(q.id)}"`, `title="${escapeAttr(q.title)}"`, `status="${q.status}"`].join(' ');
  let s = `<open-question ${attrs}>\n${q.body}\n`;
  if (q.select) {
    s += `\n<options select="${q.select}">\n`;
    // close tag on its own line so an option body ending in a fenced code
    // block can't glue ``` and </option> together (which protectedRanges would
    // then swallow).
    for (const o of q.options) s += `  <option id="${escapeAttr(o.id)}">${o.body}\n  </option>\n`;
    s += `</options>\n`;
  }
  if (q.answer) {
    const aAttrs = [`by="${q.answer.by}"`, `at="${q.answer.at}"`];
    if (q.answer.chose.length) aAttrs.push(`chose="${escapeAttr(q.answer.chose.join(','))}"`);
    s += `\n<answer ${aAttrs.join(' ')}>\n${encodeEntities(q.answer.text)}\n</answer>\n`;
  }
  s += `</open-question>`;
  return s;
}

export function serializeDecision(d: DecisionBlock): string {
  const attrs = [`id="${escapeAttr(d.id)}"`, `title="${escapeAttr(d.title)}"`, `status="${d.status}"`];
  if (d.date) attrs.push(`date="${escapeAttr(d.date)}"`);
  if (d.from) attrs.push(`from="${escapeAttr(d.from)}"`);
  if (d.supersedes) attrs.push(`supersedes="${escapeAttr(d.supersedes)}"`);
  let s = `<decision ${attrs.join(' ')}>\n${d.body}\n`;
  if (d.rationale) s += `<rationale>\n${d.rationale}\n</rationale>\n`;
  s += `</decision>`;
  return s;
}

export function serializeFinding(f: FindingBlock): string {
  const attrs = [
    `id="${escapeAttr(f.id)}"`,
    `title="${escapeAttr(f.title)}"`,
    `severity="${f.severity}"`,
    `status="${f.status}"`,
  ];
  if (f.effort) attrs.push(`effort="${escapeAttr(f.effort)}"`);
  return `<finding ${attrs.join(' ')}>\n${f.body}\n</finding>`;
}

export function serializeComment(c: CommentBlock): string {
  const attrs = [`id="${escapeAttr(c.id)}"`, `status="${c.status}"`];
  if (c.kind) attrs.push(`kind="${c.kind}"`);
  if (c.resolvedBy) attrs.push(`resolved-by="${escapeAttr(c.resolvedBy)}"`);
  if (c.resolvedAt) attrs.push(`resolved-at="${escapeAttr(c.resolvedAt)}"`);
  let s = `<comment ${attrs.join(' ')}>\n`;
  for (const n of c.notes) s += `  <note by="${n.by}" at="${escapeAttr(n.at)}">${encodeEntities(n.body)}</note>\n`;
  s += `</comment>`;
  return s;
}

// One line so the round-trip is byte-stable and a label can't accidentally
// introduce a structural newline. The label markdown is kept verbatim.
export function serializeCheck(c: CheckBlock): string {
  return `<check id="${escapeAttr(c.id)}" status="${c.status}">${c.label}</check>`;
}

export function serializeBlock(b: Block): string {
  switch (b.type) {
    case 'question':
      return serializeQuestion(b);
    case 'decision':
      return serializeDecision(b);
    case 'finding':
      return serializeFinding(b);
    case 'comment':
      return serializeComment(b);
    case 'check':
      return serializeCheck(b);
    case 'markdown':
      return b.text;
  }
}

// Replace one block's source span with regenerated source. Everything outside
// [start,end) stays byte-identical.
export function replaceBlock(raw: string, range: { start: number; end: number }, replacement: string): string {
  return raw.slice(0, range.start) + replacement + raw.slice(range.end);
}

// --- highlight anchoring ------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Wrap the `occ`-th (0-based) whitespace-tolerant occurrence of `selText` in
// `field` with a <user-highlight comment="id"> span. Matches inside code
// (inline/fenced) are skipped — wrapping there would corrupt the code. Returns
// null when there aren't `occ`+1 matches (caller then falls back to a target),
// which is what makes anchoring precise: the viewer counts how many copies of
// the selected phrase precede the selection and asks for exactly that one,
// instead of always grabbing the first match.
export function wrapNthOccurrence(field: string, selText: string, occ: number, id: string): string | null {
  const norm = selText.trim();
  if (!norm) return null;
  const prot = protectedRanges(field);
  const re = new RegExp(escapeRegExp(norm).replace(/\s+/g, '\\s+'), 'g');
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(field))) {
    const at = m.index;
    if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-length loops
    if (inAnyRange(at, prot)) continue;
    if (count === occ)
      return (
        field.slice(0, at) +
        `<user-highlight comment="${id}">` +
        m[0] +
        `</user-highlight>` +
        field.slice(at + m[0].length)
      );
    count++;
  }
  return null;
}

// Append an empty highlight "target" (rendered as a clickable ◆ marker) to a
// field, before any trailing whitespace so the field's block structure is
// preserved. This is the universal anchor for things a span can't reliably wrap
// — repeated/short phrases, or structured elements (decisions, findings, …).
export function appendTarget(field: string, id: string): string {
  const trail = /\s*$/.exec(field)?.[0] ?? '';
  const core = field.slice(0, field.length - trail.length);
  const sep = core && !/\s$/.test(core) ? ' ' : '';
  return `${core}${sep}<user-highlight comment="${id}"></user-highlight>${trail}`;
}

// Strip every <user-highlight comment="id"> anchor for one comment id, keeping
// the wrapped inner text (a target's inner is empty, so it vanishes). Opens are
// paired to closes with a stack so nested highlights survive — only the targeted
// id's own tags are removed. Used when deleting a comment thread.
export function removeHighlight(raw: string, id: string): string {
  const prot = protectedRanges(raw);
  const inCode = (i: number) => inAnyRange(i, prot);
  type Tok = { i: number; len: number; open: boolean; id?: string };
  const toks: Tok[] = [];
  const openRe = /<user-highlight\b[^>]*\bcomment="([^"]+)"[^>]*>/g;
  const closeRe = /<\/user-highlight>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(raw))) if (!inCode(m.index)) toks.push({ i: m.index, len: m[0].length, open: true, id: m[1] });
  while ((m = closeRe.exec(raw))) if (!inCode(m.index)) toks.push({ i: m.index, len: m[0].length, open: false });
  toks.sort((a, b) => a.i - b.i);
  const stack: Tok[] = [];
  const cut: { start: number; end: number }[] = [];
  for (const t of toks) {
    if (t.open) stack.push(t);
    else {
      const o = stack.pop();
      if (o && o.id === id) {
        cut.push({ start: o.i, end: o.i + o.len });
        cut.push({ start: t.i, end: t.i + t.len });
      }
    }
  }
  if (!cut.length) return raw;
  cut.sort((a, b) => b.start - a.start); // splice from the end so offsets stay valid
  let out = raw;
  for (const c of cut) out = out.slice(0, c.start) + out.slice(c.end);
  return out;
}

// The distinct comment ids anchored within a field (span or target), in order.
// Lets a structured block show a marker for the comments that point at it.
export function anchoredCommentIds(field: string): string[] {
  const prot = protectedRanges(field);
  const re = /<user-highlight\b[^>]*\bcomment="([^"]+)"[^>]*>/g;
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(field))) if (!inAnyRange(m.index, prot)) ids.push(m[1]);
  return [...new Set(ids)];
}


// --- lint --------------------------------------------------------------------

function lineOf(raw: string, idx: number): number {
  return raw.slice(0, Math.max(0, idx)).split('\n').length;
}

function countOutside(raw: string, re: RegExp, prot: Range[]): number {
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) if (!inAnyRange(m.index, prot)) n++;
  return n;
}

export function lintPlan(raw: string): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const prot = protectedRanges(raw);

  // 1. block tags: every real open has a matching close, and no same-named
  // block nests inside another (a forgotten close pairs with the next block's
  // close and silently swallows it — catch that).
  const tags = scanBlockTags(raw, prot);
  for (const t of tags) {
    if (t.closeIdx === -1) {
      diags.push({ line: lineOf(raw, t.start), severity: 'error', message: `Unclosed <${t.name}> tag.` });
      continue;
    }
    const innerSlice = raw.slice(t.openEnd, t.closeIdx);
    const innerProt = protectedRanges(innerSlice);
    const reNested = new RegExp(`<${t.name}\\b`, 'g');
    let nm: RegExpExecArray | null;
    while ((nm = reNested.exec(innerSlice))) {
      if (!inAnyRange(nm.index, innerProt)) {
        diags.push({
          line: lineOf(raw, t.start),
          severity: 'error',
          message: `Likely unclosed <${t.name}> — a nested <${t.name}> opening was found inside it (missing close tag?).`,
        });
        break;
      }
    }
  }

  // 1b. raw attribute validation — unknown attrs, missing required, bad enums.
  // Done on the raw opening tag (not the post-default model) so typos like
  // severty="p1" or statuz="fixed" are caught instead of silently defaulting.
  const ATTR_RULES: Record<
    string,
    { allowed: string[]; required: string[]; enums: Record<string, string[]> }
  > = {
    'open-question': { allowed: ['id', 'title', 'status'], required: ['id', 'title'], enums: { status: ['open', 'answered'] } },
    decision: {
      allowed: ['id', 'title', 'status', 'date', 'from', 'supersedes'],
      required: ['id', 'title', 'status'],
      enums: { status: ['proposed', 'locked', 'superseded', 'wontfix'] },
    },
    finding: {
      allowed: ['id', 'title', 'severity', 'status', 'effort'],
      required: ['id', 'title', 'severity'],
      enums: { severity: ['p0', 'p1', 'p2', 'p3'], status: ['open', 'fixed', 'wontfix', 'deferred', 'partial'] },
    },
    comment: {
      allowed: ['id', 'status', 'kind', 'resolved-by', 'resolved-at'],
      required: ['id'],
      enums: { status: ['open', 'resolved'], kind: ['error', 'clarify', 'question', 'nit'] },
    },
    check: { allowed: ['id', 'status'], required: ['id'], enums: { status: ['todo', 'done'] } },
  };
  for (const t of tags) {
    if (t.closeIdx === -1) continue;
    const rule = ATTR_RULES[t.name];
    const a = parseAttrs(raw.slice(t.start, t.openEnd));
    const ln = lineOf(raw, t.start);
    for (const req of rule.required)
      if (!(req in a)) diags.push({ line: ln, severity: 'error', message: `<${t.name}> is missing required attribute "${req}".` });
    for (const k of Object.keys(a))
      if (!rule.allowed.includes(k)) diags.push({ line: ln, severity: 'warning', message: `<${t.name}> has unknown attribute "${k}".` });
    for (const [k, vals] of Object.entries(rule.enums))
      if (a[k] !== undefined && !vals.includes(a[k]))
        diags.push({ line: ln, severity: 'error', message: `<${t.name}> ${k}="${a[k]}" is not one of ${vals.join('|')}.` });
  }

  // Tag-like text inside a block tag's own attributes (e.g. title="…<finding>…")
  // is not a tag either — treat those open-tag spans as protected for the
  // inline-tag checks below.
  const protAll: Range[] = [...prot, ...tags.map((t) => ({ start: t.start, end: t.openEnd }))];

  // 1c. child-tag attribute validation (so e.g. <options select="mulit"> is
  // caught instead of silently parsing as single-select).
  const CHILD_RULES: Record<string, { allowed: string[]; required: string[]; enums: Record<string, string[]> }> = {
    options: { allowed: ['select'], required: ['select'], enums: { select: ['single', 'multi'] } },
    option: { allowed: ['id'], required: ['id'], enums: {} },
    answer: { allowed: ['by', 'at', 'chose'], required: ['by'], enums: { by: ['user', 'agent'] } },
    note: { allowed: ['by', 'at'], required: ['by'], enums: { by: ['user', 'agent'] } },
    'user-highlight': { allowed: ['comment'], required: ['comment'], enums: {} },
    rationale: { allowed: [], required: [], enums: {} },
  };
  for (const [name, rule] of Object.entries(CHILD_RULES)) {
    for (const occ of scanTag(raw, name, protAll)) {
      const a = parseAttrs(raw.slice(occ.start, occ.openEnd));
      const ln = lineOf(raw, occ.start);
      for (const req of rule.required)
        if (!(req in a)) diags.push({ line: ln, severity: 'error', message: `<${name}> is missing required attribute "${req}".` });
      for (const k of Object.keys(a))
        if (!rule.allowed.includes(k)) diags.push({ line: ln, severity: 'warning', message: `<${name}> has unknown attribute "${k}".` });
      for (const [k, vals] of Object.entries(rule.enums))
        if (a[k] !== undefined && !vals.includes(a[k]))
          diags.push({ line: ln, severity: 'error', message: `<${name}> ${k}="${a[k]}" is not one of ${vals.join('|')}.` });
    }
  }

  // 2. inline / child tags balance (outside code + attribute regions)
  for (const tag of ['options', 'option', 'answer', 'rationale', 'note', 'user-highlight']) {
    const opens = countOutside(raw, new RegExp(`<${tag}\\b`, 'g'), protAll);
    const closes = countOutside(raw, new RegExp(`</${tag}>`, 'g'), protAll);
    if (opens !== closes)
      diags.push({ line: 1, severity: 'error', message: `Unbalanced <${tag}>: ${opens} open vs ${closes} close.` });
  }

  const plan = parsePlan(raw);

  // 3. unique, present ids
  const ids = new Map<string, number>();
  const idLine = new Map<string, number>();
  const commentIds = new Set<string>();
  const commentLine = new Map<string, number>();
  for (const b of plan.blocks) {
    if (b.type === 'markdown') continue;
    if (!b.id) {
      diags.push({ line: lineOf(raw, b.range.start), severity: 'error', message: `<${b.type}> is missing an id.` });
      continue;
    }
    ids.set(b.id, (ids.get(b.id) ?? 0) + 1);
    if (!idLine.has(b.id)) idLine.set(b.id, lineOf(raw, b.range.start));
    if (b.type === 'comment') {
      commentIds.add(b.id);
      commentLine.set(b.id, lineOf(raw, b.range.start));
    }
  }
  for (const [id, n] of ids)
    if (n > 1) diags.push({ line: idLine.get(id) ?? 1, severity: 'error', message: `Duplicate id "${id}" used ${n} times.` });

  // 4. questions: title present; answers reference real option ids
  for (const b of plan.blocks) {
    if (b.type !== 'question') continue;
    if (!b.title)
      diags.push({ line: lineOf(raw, b.range.start), severity: 'warning', message: `<open-question id="${b.id}"> has no title.` });
    if (b.answer && b.select) {
      const valid = new Set([...b.options.map((o) => o.id), 'other']);
      for (const c of b.answer.chose)
        if (!valid.has(c))
          diags.push({
            line: lineOf(raw, b.range.start),
            severity: 'error',
            message: `Question "${b.id}" answer chose="${c}" — no such option id.`,
          });
      if (b.select === 'single' && b.answer.chose.length > 1)
        diags.push({
          line: lineOf(raw, b.range.start),
          severity: 'error',
          message: `Question "${b.id}" is select="single" but the answer chose ${b.answer.chose.length} options.`,
        });
    }
  }

  // 5. every <user-highlight comment="x"> resolves to a <comment id="x"> (outside code)
  const hlRe = /<user-highlight\b[^>]*\bcomment="([^"]+)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = hlRe.exec(raw))) {
    if (inAnyRange(m.index, protAll)) continue;
    if (!commentIds.has(m[1]))
      diags.push({
        line: lineOf(raw, m.index),
        severity: 'error',
        message: `<user-highlight comment="${m[1]}"> has no matching <comment id="${m[1]}">.`,
      });
  }

  // 6. comments with no anchoring highlight (warning — may be intentional)
  const anchored = new Set<string>();
  const hl2 = /<user-highlight\b[^>]*\bcomment="([^"]+)"/g;
  while ((m = hl2.exec(raw))) if (!inAnyRange(m.index, protAll)) anchored.add(m[1]);
  for (const id of commentIds)
    if (!anchored.has(id))
      diags.push({
        line: commentLine.get(id) ?? 1,
        severity: 'warning',
        message: `<comment id="${id}"> has no <user-highlight> anchor (orphaned?).`,
      });

  return diags;
}
