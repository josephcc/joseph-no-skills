// In-page anchors: headings get GitHub-style ids, `#q1`-style links find their block, a click
// scrolls there, and resting the pointer on such a link for ¾ s opens a peek — a small window
// onto the rendered plan at the target, with the lines below it, that scrolls and jumps on click.
//
// The peek clones what is already on the page rather than re-rendering markdown, so it shows
// exactly what the reader would see after the jump: cards, tables, highlights, figures. Cloned
// nodes lose their ids (no duplicates in the document) and sit under `inert` (no focus, no
// clicks, no nested hover), so the clone can never act on the plan.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Slugger, fragmentCandidates } from './slug';

const HOVER_DELAY_MS = 750;
const CLOSE_GRACE_MS = 220; // time to move from the link into the peek (or back) without it closing
const CONTENT_BUDGET_PX = 1100; // how much of the live page to clone, measured as laid out
const MAX_ELEMENTS = 60;
const FLASH_MS = 900;

// Heading text without comment markers: a ◆ target appended to a heading is not part of its name.
function headingText(h: Element): string {
  const c = h.cloneNode(true) as Element;
  c.querySelectorAll('.ip-hl-target, .ip-cmark').forEach((n) => n.remove());
  return c.textContent ?? '';
}

/** Give every markdown heading under `root` its GitHub slug as an id, deduplicated across the
 *  whole document in reading order (so two "Notes" sections become `notes` and `notes-1`).
 *  Idempotent: rerun after every render of the plan. */
export function assignHeadingIds(root: HTMLElement): void {
  const slugger = new Slugger();
  root.querySelectorAll('.ip-md :is(h1, h2, h3, h4, h5, h6)').forEach((h) => {
    h.id = slugger.slug(headingText(h));
  });
}

/** The element an in-page href points at, or null. Scoped to `root` so ids that live outside
 *  the plan (comment cards in the rail, say) are never a target. */
export function resolveAnchor(href: string | null | undefined, root: HTMLElement): HTMLElement | null {
  for (const id of fragmentCandidates(href ?? '')) {
    const el = root.querySelector(`#${CSS.escape(id)}`);
    if (el) return el as HTMLElement;
  }
  return null;
}

/** Scroll the target of `href` into view and flash it. Returns false when nothing matched, so a
 *  caller can let the browser handle the link instead. */
export function scrollToAnchor(href: string, root: HTMLElement, behavior: ScrollBehavior = 'smooth'): boolean {
  const el = resolveAnchor(href, root);
  if (!el) return false;
  el.scrollIntoView({ behavior, block: 'start' });
  el.classList.add('ip-anchor-flash');
  setTimeout(() => el.classList.remove('ip-anchor-flash'), FLASH_MS);
  return true;
}

/** A link click: record the fragment in the URL (so Back returns) and scroll. */
export function jumpToAnchor(href: string, root: HTMLElement): boolean {
  if (!resolveAnchor(href, root)) return false;
  history.pushState(null, '', href);
  return scrollToAnchor(href, root);
}

// Elements that follow `el` in reading order, up to (not including) `root`: its later siblings,
// then its parent's later siblings, and so on up.
function* following(el: Element, root: Element): Generator<Element> {
  let cur: Element | null = el;
  while (cur && cur !== root) {
    let sib = cur.nextElementSibling;
    while (sib) {
      yield sib;
      sib = sib.nextElementSibling;
    }
    cur = cur.parentElement;
  }
}

// A wrapper whose children can be taken one at a time without breaking their styling: the
// per-block <div data-block-index>, a markdown container, or a bare <div>. Tables, cards and
// lists are cloned whole or not at all.
function isPlainContainer(el: Element): boolean {
  if (el.tagName !== 'DIV') return false;
  return el.classList.length === 0 || el.classList.contains('ip-md') || el.hasAttribute('data-block-index');
}

const insideMd = (el: Element) => el.parentElement?.closest('.ip-md') != null;

function scrubClone(clone: HTMLElement): void {
  if (clone.id) clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  clone.querySelectorAll('.ip-hl-active, .ip-hl-flash, .ip-anchor-flash').forEach((n) => {
    n.classList.remove('ip-hl-active', 'ip-hl-flash', 'ip-anchor-flash');
  });
  clone.querySelectorAll('[autofocus]').forEach((n) => n.removeAttribute('autofocus'));
}

/** Clone the target and what follows it, until about a screen and a half of live content has
 *  been gathered. Markdown children regain a `.ip-md` wrapper so their styles still apply. */
export function collectPreview(target: HTMLElement, root: HTMLElement): HTMLElement {
  const out = document.createElement('div');
  let group: HTMLElement | null = null;
  let used = 0;
  let count = 0;
  const full = () => used >= CONTENT_BUDGET_PX || count >= MAX_ELEMENTS;
  const push = (el: Element) => {
    const clone = el.cloneNode(true) as HTMLElement;
    scrubClone(clone);
    if (insideMd(el)) {
      if (!group) {
        group = document.createElement('div');
        group.className = 'ip-md';
        out.appendChild(group);
      }
      group.appendChild(clone);
    } else {
      group = null;
      out.appendChild(clone);
    }
    used += el.getBoundingClientRect().height;
    count++;
  };
  const visit = (el: Element) => {
    if (full()) return;
    // A wrapper too big for what is left (a whole later section, say) is entered instead of
    // cloned whole, so the peek ends a few lines in rather than carrying the entire section.
    if (el.getBoundingClientRect().height > CONTENT_BUDGET_PX - used && isPlainContainer(el)) {
      for (const child of el.children) {
        if (full()) return;
        visit(child);
      }
      return;
    }
    push(el);
  };
  push(target);
  for (const el of following(target, root)) {
    if (full()) break;
    visit(el);
  }
  return out;
}

// What the caption names: the heading itself; a card's or row's title with its id (`D-2 ·
// Viewer uses…`); or the fragment as written.
function targetTitle(target: HTMLElement, href: string): string {
  if (/^H[1-6]$/.test(target.tagName)) return headingText(target).trim();
  const t = target.querySelector('.ip-drow-title, .ip-frow-title, .ip-card-head h3, h1, h2, h3, h4, h5, h6');
  if (!t) return decodeURIComponent(href.replace(/^#/, ''));
  const id = target.querySelector('.ip-id')?.textContent?.trim();
  const name = headingText(t).trim();
  return id ? `${id} · ${name}` : name;
}

interface Peek {
  href: string;
  title: string;
  html: string;
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

function placePeek(link: HTMLElement): Pick<Peek, 'left' | 'width' | 'top' | 'bottom' | 'maxHeight'> {
  const r = link.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 12;
  const gap = 6;
  const width = Math.min(600, vw - 2 * margin);
  const below = vh - r.bottom - margin;
  const above = r.top - margin;
  const placeAbove = below < 220 && above > below;
  const maxHeight = Math.max(140, Math.min(360, (placeAbove ? above : below) - gap));
  const left = Math.min(Math.max(margin, r.left), vw - width - margin);
  return placeAbove
    ? { left, width, bottom: vh - r.top + gap, maxHeight }
    : { left, width, top: r.bottom + gap, maxHeight };
}

/** Mount once, next to the plan's <main>. `resetKey` closes the peek when the plan re-renders
 *  (its clone would be stale). */
export function AnchorPeek({ root, resetKey }: { root: React.RefObject<HTMLElement>; resetKey: unknown }) {
  const [peek, setPeek] = useState<Peek | null>(null);
  const [more, setMore] = useState(false);
  const isOpen = useRef(false);
  isOpen.current = peek != null;
  const boxRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const hovered = useRef<HTMLAnchorElement | null>(null);
  const timers = useRef<{ open?: number; close?: number }>({});

  const close = useCallback(() => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    hovered.current = null;
    setPeek(null);
  }, []);
  const cancelClose = useCallback(() => window.clearTimeout(timers.current.close), []);
  const scheduleClose = useCallback(() => {
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(close, CLOSE_GRACE_MS);
  }, [close]);

  useEffect(() => close(), [resetKey, close]);

  useEffect(() => {
    const main = root.current;
    if (!main) return;
    if (!window.matchMedia('(hover: hover)').matches) return; // touch: no hover, no peek

    const open = (link: HTMLAnchorElement) => {
      // The pointer may have left while the page was still gliding (trackpad inertia) — the
      // scroll didn't cancel the timer, so check the link is really still under the pointer.
      if (!link.isConnected || !link.matches(':hover')) return;
      const href = link.getAttribute('href') ?? '';
      const target = resolveAnchor(href, main);
      if (!target) return;
      const html = collectPreview(target, main).innerHTML;
      setPeek({ href, title: targetTitle(target, href), html, ...placePeek(link) });
    };
    const onOver = (e: MouseEvent) => {
      const link = (e.target as Element).closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      if (!link || !main.contains(link)) return;
      if (link === hovered.current) {
        cancelClose(); // back onto the link from the peek
        return;
      }
      window.clearTimeout(timers.current.open);
      window.clearTimeout(timers.current.close);
      hovered.current = link;
      setPeek(null);
      timers.current.open = window.setTimeout(() => open(link), HOVER_DELAY_MS);
    };
    const onOut = (e: MouseEvent) => {
      const link = hovered.current;
      if (!link || !link.contains(e.target as Node)) return;
      const to = e.relatedTarget as Node | null;
      if (to && (link.contains(to) || boxRef.current?.contains(to))) return;
      window.clearTimeout(timers.current.open);
      scheduleClose();
    };
    // Scrolling the page moves the link out from under an open peek, so close it. A pending one
    // is left alone: the scroll is often the tail of the glide that brought the link under the
    // pointer, and the peek measures the link's position only when it opens. Scrolling inside
    // the peek is fine.
    const onScroll = (e: Event) => {
      if (!isOpen.current || boxRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      close();
    };
    main.addEventListener('mouseover', onOver);
    main.addEventListener('mouseout', onOut);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      main.removeEventListener('mouseover', onOver);
      main.removeEventListener('mouseout', onOut);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      close();
    };
  }, [root, close, cancelClose, scheduleClose]);

  // The clone must not be focusable or clickable; `inert` is not in React 18's prop types, so
  // it is set by hand. Also learn whether there is more to scroll, to show the fade.
  useLayoutEffect(() => {
    docRef.current?.setAttribute('inert', '');
    const body = bodyRef.current;
    setMore(!!body && body.scrollHeight > body.clientHeight + 1);
  }, [peek]);

  if (!peek) return null;
  const { left, width, top, bottom, maxHeight } = peek;
  return (
    <div
      className={`ip-peek ${more ? 'ip-peek-more' : ''}`}
      ref={boxRef}
      style={{ left, width, top, bottom, maxHeight }}
      role="tooltip"
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
      onClick={() => {
        const main = root.current;
        if (main) jumpToAnchor(peek.href, main);
        close();
      }}
    >
      <div className="ip-peek-cap">
        <span className="ip-peek-arrow" aria-hidden="true">
          ↳
        </span>
        <b title={peek.title}>{peek.title}</b>
        <span className="ip-peek-hint">click to go there</span>
      </div>
      <div className="ip-peek-body" ref={bodyRef}>
        <div className="ip-peek-doc" ref={docRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: peek.html }} />
      </div>
    </div>
  );
}
