import { useEffect, useRef } from 'react';
import { marked } from 'marked';
import { decodeEntities, protectedRanges } from './parser';

marked.setOptions({ gfm: true, breaks: false });

const escapeHtmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Turn <user-highlight comment="x">y</user-highlight> into a styled inline <mark>
// that marked passes through untouched — but NOT inside code (fenced or inline),
// where the tag is meant to stay literal.
export function preprocessHighlights(
  md: string,
  kinds: Record<string, { status: string; kind: string | null }>,
): string {
  const prot = protectedRanges(md);
  const inCode = (i: number) => prot.some((r) => i >= r.start && i < r.end);
  // Collect open/close tokens (outside code) and replace them POSITIONALLY, so
  // nested/overlapping highlights survive — e.g. commenting on a span that
  // already contains a highlight. A paired non-greedy regex matched the outer
  // open with the inner close and silently dropped the inner highlight.
  type Tok = { i: number; len: number; open: boolean; id?: string };
  const toks: Tok[] = [];
  const openRe = /<user-highlight\b[^>]*\bcomment="([^"]+)"[^>]*>/g;
  const closeRe = /<\/user-highlight>/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(md))) if (!inCode(m.index)) toks.push({ i: m.index, len: m[0].length, open: true, id: m[1] });
  while ((m = closeRe.exec(md))) if (!inCode(m.index)) toks.push({ i: m.index, len: m[0].length, open: false });
  if (!toks.length) return md;
  toks.sort((a, b) => a.i - b.i);
  let out = '';
  let last = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    out += md.slice(last, t.i);
    if (t.open) {
      const meta = kinds[t.id!];
      const cls = ['ip-hl'];
      if (meta?.status === 'resolved') cls.push('ip-hl-resolved');
      const kindAttr = meta?.kind ? ` data-kind="${meta.kind}"` : '';
      // An empty highlight (open immediately followed by its close) is a
      // "target": render a single clickable ◆ marker instead of an empty span.
      const next = toks[k + 1];
      if (next && !next.open && next.i === t.i + t.len) {
        out += `<mark class="${cls.join(' ')} ip-hl-target" data-comment="${t.id}"${kindAttr}>◆</mark>`;
        last = next.i + next.len;
        k++; // consume the paired close
        continue;
      }
      out += `<mark class="${cls.join(' ')}" data-comment="${t.id}"${kindAttr}>`;
    } else {
      out += '</mark>';
    }
    last = t.i + t.len;
  }
  out += md.slice(last);
  return out;
}

// path.ext:line (optionally :line-range and :col). Extension starts with a
// letter but may contain digits (e.g. .j2, .mjs) — so ontology.j2:123 linkifies.
const CODE_REF = /([A-Za-z0-9_./-]+\.[A-Za-z][A-Za-z0-9]{0,5}):(\d+)(?:-\d+)?(?::\d+)?/g;

function linkifyCodeRefs(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el && el !== root) {
        const t = el.tagName;
        // Linkify refs in inline `code` (the common `file.ts:123` form) but NOT
        // in fenced blocks (<pre>) — those are example code — or existing links.
        if (t === 'PRE' || t === 'A') return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      CODE_REF.lastIndex = 0; // /g .test() advances lastIndex; reset per node
      return CODE_REF.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const targets: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) targets.push(n as Text);
  for (const text of targets) {
    const frag = document.createDocumentFragment();
    let last = 0;
    const s = text.nodeValue ?? '';
    CODE_REF.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CODE_REF.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const a = document.createElement('a');
      a.className = 'ip-coderef';
      a.dataset.ref = m[0];
      a.textContent = m[0];
      a.title = `Open ${m[0]} in editor`;
      frag.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    text.parentNode?.replaceChild(frag, text);
  }
}

function decorateCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement as HTMLElement;
    if (pre.dataset.decorated) return;
    pre.dataset.decorated = '1';
    const langClass = [...code.classList].find((c) => c.startsWith('language-'));
    if (langClass) pre.dataset.lang = langClass.replace('language-', '');
    const btn = document.createElement('button');
    btn.className = 'ip-copy';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      navigator.clipboard?.writeText(code.textContent ?? '');
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1200);
    });
    pre.appendChild(btn);
  });
}

// Neutralize dangerous URL schemes in links generated from user-authored
// markdown (e.g. [x](javascript:…)) — relevant only for the escapeHtml path.
function scrubLinks(root: HTMLElement): void {
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (/^\s*(javascript|data|vbscript):/i.test(href)) a.removeAttribute('href');
  });
}

// In escaped user content, code spans get double-escaped: escapeHtmlText turns
// `<` into `&lt;`, then marked re-escapes the `&` inside the code span. Decode
// the code element's text back so `<Foo>` displays as typed. Using textContent
// (not innerHTML) keeps this XSS-safe.
function decodeUserCode(root: HTMLElement): void {
  root.querySelectorAll('code').forEach((c) => {
    c.textContent = decodeEntities(c.textContent ?? '');
  });
}

export function Markdown({
  source,
  commentMeta = {},
  escapeHtml = false,
}: {
  source: string;
  commentMeta?: Record<string, { status: string; kind: string | null }>;
  escapeHtml?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // escapeHtml = user-authored text (comment notes, answers): escape tags so raw
  // HTML can't inject; trusted plan prose goes through the highlight preprocessor.
  const html = escapeHtml
    ? (marked.parse(escapeHtmlText(source)) as string)
    : (marked.parse(preprocessHighlights(source, commentMeta)) as string);
  useEffect(() => {
    if (!ref.current) return;
    if (escapeHtml) decodeUserCode(ref.current);
    linkifyCodeRefs(ref.current);
    decorateCodeBlocks(ref.current);
    if (escapeHtml) scrubLinks(ref.current);
  }, [html, escapeHtml]);
  return <div className="ip-md" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
