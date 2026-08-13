// Print rendering: a plan .md -> a self-contained, print-ready HTML document.
//
// The viewer is built for interaction — sticky header, floating comment rail, option
// pickers — and none of that belongs in a shared document. This renders the SAME parsed
// plan through a print-first presentation instead: the preamble becomes a header card,
// decisions and findings become callouts, answered questions collapse to the answer.
//
// It deliberately reuses `parsePlan` so the two renderers cannot disagree about what the
// document *contains*; only presentation differs. Anything added to the format needs a case
// here as well as in the React blocks.

import { marked } from 'marked';
import { anchorHref } from './anchor';
import { decodeEntities, parsePlan, protectedRanges } from './parser';
import type { Block, CommentBlock, DecisionBlock, FindingBlock, QuestionBlock } from './types';

marked.setOptions({ gfm: true, breaks: false });

/**
 * How comment threads are carried into the document.
 *
 * - `inline` — printed as note callouts in the flow of the document (the only option before
 *   PDF annotations existed, and the only one that survives being printed on paper).
 * - `annotations` — the callouts are dropped and each thread becomes a real PDF annotation,
 *   anchored to its highlighted span. See `src/annotate.ts`.
 * - `both` — belt and braces: annotations for readers that support them, callouts for the rest.
 * - `none` — dropped entirely.
 */
export type CommentMode = 'inline' | 'annotations' | 'both' | 'none';

/** The mode in effect, honouring the older `noComments` flag. */
export function commentMode(opts: PrintOptions): CommentMode {
  if (opts.noComments) return 'none';
  return opts.comments ?? 'inline';
}

export interface PrintOptions {
  /** How comment threads are rendered. Default `inline`; the CLI defaults to `annotations`. */
  comments?: CommentMode;
  /** Drop comment threads. Predates `comments`; equivalent to `comments: 'none'`, and wins. */
  noComments?: boolean;
  /** Drop unanswered questions — useful when sharing conclusions rather than a live plan. */
  noQuestions?: boolean;
  /** Drop checklists. */
  noChecks?: boolean;
  /**
   * `file://` URL of the plan's directory, emitted as `<base href>`.
   *
   * The CLI renders from a temp directory, so without this a relative image or link in the
   * plan (`![d](./d.png)`) would resolve against the temp dir and silently come out broken.
   */
  baseHref?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Remove `<user-highlight>` anchors, keeping any text they wrap.
 *
 * Comment anchors carry no meaning in print. Uses the parser's own `protectedRanges` so a
 * tag written literally inside a code fence stays literal, matching the viewer.
 */
export function stripHighlights(md: string): string {
  return transformHighlights(md, 'strip');
}

/**
 * What to do with a `<user-highlight>` anchor.
 *
 * - `strip` — drop it, keeping any text it wraps. With no comments printed there is nothing
 *   for it to point at.
 * - `mark` — render the wrapped span as `<mark>`, and an empty ◆ target as a small id marker,
 *   so a printed thread has a referent on the page.
 * - `anchor` — as `mark`, plus a link to `anchorHref(id)`. The link is not for the reader:
 *   the browser turns it into a /Link annotation whose rectangle tells `annotate.ts` exactly
 *   where the span landed, and it is deleted once that rectangle has been read.
 */
export type HighlightMode = 'strip' | 'mark' | 'anchor';

/**
 * Rewrite `<user-highlight>` anchors according to `mode`.
 *
 * Uses the parser's `protectedRanges` so a tag written literally inside a code fence stays
 * literal, matching the viewer. A consequence worth knowing: an anchor written inside a fence
 * is not a real anchor, so its thread has no rectangle and cannot become an annotation.
 */
export function transformHighlights(md: string, mode: HighlightMode): string {
  const prot = protectedRanges(md);
  const inCode = (i: number) => prot.some((r) => i >= r.start && i < r.end);
  const open = /<user-highlight\b[^>]*\bcomment="([^"]+)"[^>]*>/g;
  const close = /<\/user-highlight>/g;
  type Tok = { i: number; len: number; open: boolean; id?: string };
  const toks: Tok[] = [];
  let m: RegExpExecArray | null;
  while ((m = open.exec(md))) {
    if (!inCode(m.index)) toks.push({ i: m.index, len: m[0].length, open: true, id: m[1] });
  }
  while ((m = close.exec(md))) {
    if (!inCode(m.index)) toks.push({ i: m.index, len: m[0].length, open: false });
  }
  if (!toks.length) return md;
  toks.sort((a, b) => a.i - b.i);
  const link = mode === 'anchor';
  let out = '';
  let last = 0;
  // Ids of anchors we opened a link for, so the matching close emits the same number of tags.
  const openLinks: boolean[] = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    out += md.slice(last, t.i);
    if (mode !== 'strip') {
      if (t.open) {
        const id = t.id ?? '';
        const a = link ? `<a class="phla" href="${esc(anchorHref(id))}">` : '';
        // An empty anchor (`◆` target) has its close tag immediately after: render a marker
        // rather than an empty <mark>. It still needs the link — an annotation with no
        // rectangle has nowhere to live, and the marker is the only ink the ◆ leaves behind.
        const next = toks[k + 1];
        const empty = next && !next.open && next.i === t.i + t.len;
        if (empty) {
          out += `${a}<sup class="phlref">${esc(id)}</sup>${link ? '</a>' : ''}`;
          k++; // consume the paired close
        } else {
          out += `${a}<mark class="phl">`;
          openLinks.push(link);
        }
      } else {
        out += openLinks.pop() ? '</mark></a>' : '</mark>';
      }
    }
    last = t.i + t.len;
  }
  return out + md.slice(last);
}

/**
 * Split an anchor link around any link nested inside it.
 *
 * `<a>` cannot contain `<a>`. When a highlighted span contains a markdown link, the browser
 * silently closes our anchor at the inner one — so the annotation's rectangle stops at the link
 * and the rest of the span goes uncovered. Closing and reopening around the inner link keeps
 * both: the real link stays clickable, and the highlight comes back as further rectangles,
 * which is exactly what QuadPoints wants anyway.
 */
export function unnestAnchors(html: string): string {
  if (!html.includes('<a class="phla"')) return html;
  const tag = /<a\b[^>]*>|<\/a>/g;
  let out = '';
  let last = 0;
  let open: string | null = null; // our anchor's opening tag, while we are inside one
  let suspended = false; // ...and currently interrupted by an inner link
  let m: RegExpExecArray | null;
  while ((m = tag.exec(html))) {
    out += html.slice(last, m.index);
    last = m.index + m[0].length;
    const isClose = m[0] === '</a>';
    if (!open) {
      out += m[0];
      if (!isClose && m[0].startsWith('<a class="phla"')) open = m[0];
    } else if (!isClose) {
      out += `</a>${m[0]}`; // step out of ours, let the inner link have its own
      suspended = true;
    } else if (suspended) {
      out += `</a>${open}`; // inner link done — resume ours
      suspended = false;
    } else {
      out += m[0];
      open = null;
    }
  }
  // Reopening right before the span ends (or an inner link starting it) leaves an empty anchor,
  // which would be a link annotation with no text under it.
  return (out + html.slice(last)).replace(/<a class="phla"[^>]*><\/a>/g, '');
}

let highlightMode: HighlightMode = 'strip'; // set per render, from the comment mode
const md2html = (md: string) => {
  const html = marked.parse(transformHighlights(md ?? '', highlightMode)) as string;
  return highlightMode === 'anchor' ? unnestAnchors(html) : html;
};
/** Inline markdown (no wrapping <p>), for titles and checkbox labels. */
const inline2html = (md: string) => marked.parseInline(stripHighlights(md ?? '')) as string;

const SAFE_SCHEMES = /^(https?|mailto)$/i;

/**
 * Is this href safe to keep in a user-authored field?
 *
 * An **allowlist**, deliberately. A blocklist cannot work without a DOM: `javascript&colon;x`
 * and `&#106;avascript:x` both reach the browser as `javascript:`, and there are ~2000 named
 * character references to decode. So instead: no scheme (relative link or anchor) is fine,
 * an http/https/mailto scheme is fine, and anything else — including anything still carrying
 * an entity or percent-escape where the scheme would be — is refused rather than guessed at.
 */
export function isSafeHref(href: string): boolean {
  const s = decodeEntities(href)
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/[\s\u0000-\u0020]/g, '');
  // Only the part before the first /, ? or # can carry a scheme; an `&` in a query string is
  // ordinary, an `&` before that point means an entity we could not fully decode.
  const head = s.split(/[/?#]/, 1)[0] ?? '';
  if (/[&%]/.test(head)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  return scheme ? SAFE_SCHEMES.test(scheme[1]) : true;
}

/** Drop unsafe hrefs from rendered HTML (the viewer's `scrubLinks`, without a DOM). */
export function scrubHrefs(html: string): string {
  return html.replace(/href="([^"]*)"/gi, (whole, href: string) =>
    isSafeHref(href) ? whole : 'data-unsafe-href-removed=""',
  );
}

/**
 * Undo the *extra* escaping inside code spans, matching the viewer's `decodeUserCode`.
 *
 * User text is escaped before `marked` sees it, so marked re-escapes the `&` of `&lt;` inside
 * code and an answer mentioning `` `<Foo>` `` would print as literal `&lt;Foo&gt;`. Turning
 * `&amp;` back into `&` restores the display without un-escaping any tag: `<` stays `&lt;`.
 */
function decodeCodeSpans(html: string): string {
  return html.replace(
    /(<code[^>]*>)([\s\S]*?)(<\/code>)/gi,
    (_m, open: string, inner: string, close: string) => open + inner.replace(/&amp;/g, '&') + close,
  );
}

/**
 * Render *user-authored* text — comment notes and freeform answers.
 *
 * The viewer deliberately treats these as untrusted (`<Markdown … escapeHtml />`) while plan
 * prose is trusted; print must honour the same boundary. Escaping also stops a user who typed
 * `<Foo>` in an answer from having it silently swallowed as a tag.
 */
function userMd2html(md: string): string {
  const escaped = esc(stripHighlights(md ?? '')).replace(/&quot;/g, '"');
  return decodeCodeSpans(scrubHrefs(marked.parse(escaped) as string));
}

function badge(text: string, cls: string) {
  return `<span class="pb pb-${cls}">${esc(text)}</span>`;
}

function decision(d: DecisionBlock): string {
  const meta = [d.date, d.from ? `from ${d.from}` : null, d.supersedes ? `supersedes ${d.supersedes}` : null]
    .filter(Boolean)
    .join(' · ');
  return [
    `<section class="pcall pcall-${d.status}">`,
    `<div class="phead">${badge(d.status, d.status)}<span class="pid">${esc(d.id)}</span>`,
    meta ? `<span class="pmeta">${esc(meta)}</span>` : '',
    `</div>`,
    `<h4>${inline2html(d.title)}</h4>`,
    md2html(d.body),
    d.rationale ? `<div class="pwhy"><b>Why</b>${md2html(d.rationale)}</div>` : '',
    `</section>`,
  ].join('');
}

function finding(f: FindingBlock): string {
  const meta = [f.status, f.effort ? `effort: ${f.effort}` : null].filter(Boolean).join(' · ');
  return [
    `<section class="pcall pcall-${f.severity}">`,
    `<div class="phead">${badge(f.severity, f.severity)}<span class="pid">${esc(f.id)}</span>`,
    `<span class="pmeta">${esc(meta)}</span></div>`,
    `<h4>${inline2html(f.title)}</h4>`,
    md2html(f.body),
    `</section>`,
  ].join('');
}

function question(q: QuestionBlock): string {
  const parts = [`<section class="pcall pcall-q">`];
  parts.push(
    `<div class="phead">${badge(q.status === 'answered' ? 'answered' : 'open question', q.status === 'answered' ? 'answered' : 'open')}` +
      `<span class="pid">${esc(q.id)}</span></div>`,
  );
  parts.push(`<h4>${inline2html(q.title)}</h4>`);
  parts.push(md2html(q.body));
  const a = q.answer;
  if (a) {
    // Answered: show only what was chosen. Reprinting every rejected option turns a
    // settled decision back into an open menu for the reader.
    const chosen = q.options.filter((o) => a.chose.includes(o.id));
    const label = a.chose.includes('other') ? 'Other' : chosen.map((o) => o.id).join(', ');
    parts.push(`<div class="pans"><b>Answer${label ? ` — ${esc(label)}` : ''}</b>`);
    for (const o of chosen) parts.push(md2html(o.body));
    if (a.text.trim()) parts.push(userMd2html(a.text));
    parts.push(`</div>`);
  } else if (q.options.length) {
    parts.push('<ul class="popts">');
    for (const o of q.options) parts.push(`<li><b>${esc(o.id)}</b> ${md2html(o.body)}</li>`);
    parts.push('</ul>');
  }
  parts.push(`</section>`);
  return parts.join('');
}

function comment(c: CommentBlock): string {
  const notes = c.notes
    .map((n) => `<div class="pnote"><b>${esc(n.by)}</b> ${userMd2html(n.body)}</div>`)
    .join('');
  return [
    `<section class="pcall pcall-note">`,
    `<div class="phead">${badge(c.status === 'resolved' ? 'resolved' : (c.kind ?? 'comment'), 'note')}`,
    `<span class="pid">${esc(c.id)}</span></div>`,
    notes,
    `</section>`,
  ].join('');
}

/** Consecutive checks render as one checklist, matching the viewer. */
function checklist(items: { id: string; status: string; label: string }[]): string {
  const rows = items
    .map(
      (c) =>
        `<li class="${c.status === 'done' ? 'pdone' : ''}">` +
        `<span class="pbox">${c.status === 'done' ? '&#10003;' : ''}</span>${inline2html(c.label)}</li>`,
    )
    .join('');
  return `<ul class="pchecks">${rows}</ul>`;
}

/** Highlight handling implied by a comment mode: anchors exist to be pointed at. */
const highlightModeFor = (m: CommentMode): HighlightMode =>
  m === 'none' ? 'strip' : m === 'inline' ? 'mark' : 'anchor';

export function renderBlocks(blocks: Block[], opts: PrintOptions = {}): string {
  const mode = commentMode(opts);
  highlightMode = highlightModeFor(mode);
  const inlineComments = mode === 'inline' || mode === 'both';
  const out: string[] = [];
  let pending: { id: string; status: string; label: string }[] = [];
  const flush = () => {
    if (pending.length) {
      out.push(checklist(pending));
      pending = [];
    }
  };
  for (const b of blocks) {
    if (b.type !== 'check') flush();
    switch (b.type) {
      case 'markdown':
        out.push(md2html(b.text));
        break;
      case 'decision':
        out.push(decision(b));
        break;
      case 'finding':
        out.push(finding(b));
        break;
      case 'question':
        if (!(opts.noQuestions && b.status !== 'answered')) out.push(question(b));
        break;
      case 'comment':
        if (inlineComments) out.push(comment(b));
        break;
      case 'check':
        if (!opts.noChecks) pending.push({ id: b.id, status: b.status, label: b.label });
        break;
    }
  }
  flush();
  return out.join('\n');
}

export const PRINT_CSS = `
@page { size: A4; margin: 16mm 15mm 18mm; }
:root { --ink:#1a1f26; --accent:#0a6c74; --accent-d:#0a2b30; --wash:#f4f9fa; --line:#d7e3e5; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.55 -apple-system, "Helvetica Neue", Arial, sans-serif; color: var(--ink);
       margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 10px; color: var(--accent-d); letter-spacing: -.2px; }
h2 { font-size: 13pt; margin: 18px 0 7px; color: var(--accent); border-bottom: 1px solid var(--line);
     padding-bottom: 4px; break-after: avoid; }
h3 { font-size: 11pt; margin: 16px 0 6px; color: #22333a; break-after: avoid; }
p { margin: 8px 0; } ul, ol { margin: 8px 0 8px 18px; padding: 0; } li { margin: 3px 0; }
blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid var(--line); color: #46555e; }
strong { color: var(--accent-d); }
a { color: var(--accent); text-decoration: none; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; font-size: 9pt; }
thead { display: table-header-group; }  /* repeat headers when a table spans pages */
tr { break-inside: avoid; }
th { background: var(--accent); color: #fff; text-align: left; padding: 5px 8px; font-weight: 600; }
td { padding: 4px 8px; border-bottom: 1px solid #e4ebed; vertical-align: top; }
tr:nth-child(even) td { background: #fafcfc; }
code { font: 9pt "SF Mono", Menlo, monospace; background: #eef4f5; padding: 1px 4px;
       border-radius: 3px; color: #0a4f55; }
pre { background: #f7fafa; border: 1px solid #dde7e9; border-radius: 4px; padding: 10px 12px;
      font: 9pt "SF Mono", Menlo, monospace; overflow: hidden; break-inside: avoid; }
pre code { background: none; padding: 0; }
.pmetacard { border-left: 3px solid var(--accent); background: var(--wash); padding: 10px 14px;
             margin: 0 0 20px; }
.pmetacard div { margin: 2px 0; font-size: 9.5pt; color: #33424d; }
.pmetacard b { color: var(--accent); }
.pcall { border: 1px solid var(--line); border-left-width: 4px; border-radius: 4px;
         background: #fcfdfd; padding: 10px 14px; margin: 12px 0; break-inside: avoid; }
.pcall > *:first-child { margin-top: 0; } .pcall > *:last-child { margin-bottom: 0; }
.pcall-locked { border-color: var(--accent); background: var(--wash); }
.pcall-proposed { border-left-color: #7aa7ad; }
.pcall-superseded, .pcall-wontfix { opacity: .62; }
.pcall-p0 { border-left-color: #c8102e; } .pcall-p1 { border-left-color: #ff8a3d; }
.pcall-p2 { border-left-color: #e0b400; } .pcall-p3 { border-left-color: #9bb0b5; }
.pcall-q { border-left-color: #6d5bd0; } .pcall-note { border-left-color: #9bb0b5; background:#fbfbfc; }
.phead { display: flex; align-items: baseline; gap: 7px; margin-bottom: 5px; }
.pid { font: 8.5pt "SF Mono", Menlo, monospace; color: #7d8f96; }
.pmeta { font-size: 8.5pt; color: #7d8f96; }
.pb { display: inline-block; font-size: 7.5pt; font-weight: 700; letter-spacing: .6px;
      text-transform: uppercase; padding: 2px 7px; border-radius: 3px; color: #fff; background: #7d8f96; }
.pb-locked { background: var(--accent); } .pb-proposed { background: #7aa7ad; }
.pb-p0 { background: #c8102e; } .pb-p1 { background: #ff8a3d; color: #3a1500; }
.pb-p2 { background: #ffd24d; color: #3a2e00; } .pb-p3 { background: #cdd8db; color: #3c4a4f; }
.pb-open { background: #6d5bd0; } .pb-answered { background: var(--accent); }
.pcall h4 { margin: 0 0 5px; font-size: 11.5pt; color: var(--accent-d); }
.pwhy, .pans { margin-top: 8px; padding-top: 7px; border-top: 1px dashed #b9d3d6; font-size: 9.5pt; }
.pwhy b, .pans b { color: var(--accent); }
.popts { list-style: none; margin: 6px 0 0; } .popts > li { margin: 5px 0; padding-left: 10px;
  border-left: 2px solid #e4ebed; }
.popts > li > b { font: 8.5pt "SF Mono", Menlo, monospace; color: #7d8f96; }
.pnote { margin: 5px 0; font-size: 9.5pt; } .pnote b { color: var(--accent); }
mark.phl { background: #fff3bf; color: inherit; padding: 0 1px; border-radius: 2px; }
/* The anchor is machinery, not a link — it must leave no trace on the page. Its only job is to
   make the browser emit a /Link annotation whose rectangle annotate.ts can read. */
a.phla { color: inherit; text-decoration: none; }
/* When the annotation layer will paint the span itself, the CSS fill has to get out of the way:
   two colours multiplied together turn a grey "resolved" thread olive. The rule stays visible
   so a reader with no annotation support still sees which words the remark is about. */
.ip-annotated mark.phl { background: none; padding: 0; border-bottom: 1px solid #e8c95a; }
sup.phlref { font-size: 7pt; color: var(--accent); background: #eef4f5; padding: 0 3px;
             border-radius: 2px; margin-left: 1px; }
.pchecks { list-style: none; margin: 8px 0; }
.pchecks li { display: flex; gap: 7px; align-items: baseline; margin: 3px 0; }
.pbox { flex: 0 0 11px; height: 11px; border: 1px solid #9bb0b5; border-radius: 2px;
        font-size: 8pt; line-height: 10px; text-align: center; color: var(--accent); }
.pdone { color: #7d8f96; text-decoration: line-through; }
`;

/**
 * Drop the preamble region from the leading markdown.
 *
 * `parsePlan` reports the preamble as metadata but leaves its text in the first markdown
 * block, so rendering both the header card and that block would print it twice.
 */
function trimPreambleText(raw: string): string {
  const lines = raw.split('\n');
  const kept: string[] = [];
  let inPreamble = true;
  let continuing = false;
  for (const line of lines) {
    if (!inPreamble) {
      kept.push(line);
      continue;
    }
    if (/^#\s+/.test(line)) {
      inPreamble = false;
      kept.push(line);
      continue;
    }
    const t = line.trim();
    if (/^\*\*([^:*]+):\*\*/.test(t)) {
      continuing = true;
      continue; // a preamble entry — shown in the header card instead
    }
    const structural = /^(-{3,}|\*{3,}|_{3,}|#{1,6}\s|[-*+]\s|\d+\.\s|>|\||```|~~~)/.test(t);
    if (continuing && t && !structural) continue; // its wrapped continuation
    continuing = false;
    // Ordinary prose before the title is real content — the viewer renders it, so must we.
    kept.push(line);
  }
  return kept.join('\n');
}

/** Full standalone HTML document for a plan. */
export function planToPrintHtml(raw: string, opts: PrintOptions = {}): string {
  highlightMode = highlightModeFor(commentMode(opts));
  const plan = parsePlan(raw);
  const meta = plan.preamble.length
    ? `<div class="pmetacard">${plan.preamble
        .map((kv) => `<div><b>${esc(kv.key)}:</b> ${inline2html(kv.value)}</div>`)
        .join('')}</div>`
    : '';
  const blocks = plan.preamble.length
    ? plan.blocks.map((b, i) =>
        i === 0 && b.type === 'markdown' ? { ...b, text: trimPreambleText(b.text) } : b,
      )
    : plan.blocks;
  const body = renderBlocks(blocks, opts);
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    opts.baseHref ? `<base href="${esc(opts.baseHref)}">` : '',
    `<title>${esc(plan.title ?? 'plan')}</title>`,
    `<style>${PRINT_CSS}</style></head>`,
    // Tells the stylesheet that annotations will paint the highlights, so it shouldn't.
    `<body${highlightMode === 'anchor' ? ' class="ip-annotated"' : ''}>`,
    meta,
    body,
    '</body></html>',
  ].join('');
}
