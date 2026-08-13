// Turn a plan's `<comment>` threads into real PDF annotations.
//
// PDF has had comments since forever (ISO 32000-1 §12.5): a /Highlight markup annotation over
// the words being discussed, a /Popup holding the remark, and /Text replies chained to it with
// /IRT. Readers surface those in a comments sidebar — which is exactly the shape of a plan's
// `<comment>` + `<note>` thread, so the two map onto each other almost field for field.
//
// The hard part is geometry: annotations are positioned in PDF user space, and nothing in the
// DOM knows where a paragraph lands once the browser has paginated it. So we let the browser
// tell us. Chrome emits one /Link annotation **per line box** for every `<a href>`, each with
// the exact rectangle it laid that fragment out in; `print.ts` wraps each `<user-highlight>` in
// a link to `anchorHref(id)`; this module reads those rectangles back, deletes the links, and
// writes markup annotations in their place. The browser does the layout, we only re-label it.
//
// A highlight that wraps across three lines therefore yields three rectangles — which is also
// precisely what QuadPoints wants, so the annotation follows the text rather than boxing in the
// whole paragraph.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import { anchorId } from './anchor';
import type { CommentBlock } from './types';

/** Just the parts of a `<comment>` an annotation needs — so callers needn't fake a source range. */
export type Thread = Pick<CommentBlock, 'id' | 'status' | 'kind' | 'notes'>;

export interface AnnotateResult {
  bytes: Uint8Array;
  /** Thread ids that became annotations. */
  placed: string[];
  /** Thread ids with no anchor rectangle in the PDF — nothing to attach a comment to. */
  missing: string[];
}

/** A rectangle in PDF user space, normalised so x0<x1 and y0<y1. */
interface Rect {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Annotation colour by comment kind, roughly matching the viewer's rail. Highlights are drawn
// in Multiply blend, so these are the *ink* over white — they need to be light enough to read
// black text through.
const KIND_COLOR: Record<string, [number, number, number]> = {
  error: [1, 0.78, 0.78],
  question: [0.86, 0.83, 1],
  clarify: [1, 0.95, 0.75],
  nit: [0.89, 0.93, 0.94],
};
const DEFAULT_COLOR: [number, number, number] = [1, 0.95, 0.75]; // matches CSS `mark.phl`
const RESOLVED_COLOR: [number, number, number] = [0.85, 0.89, 0.89];

const color = (t: Thread): [number, number, number] =>
  t.status === 'resolved' ? RESOLVED_COLOR : (KIND_COLOR[t.kind ?? ''] ?? DEFAULT_COLOR);

/** `2026-06-28T06:01` -> `D:20260628060100`. Empty when the stamp is unparseable. */
export function pdfDate(at: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(at ?? '');
  return m ? `D:${m[1]}${m[2]}${m[3]}${m[4] ?? '00'}${m[5] ?? '00'}${m[6] ?? '00'}` : '';
}

const author = (by: string) => (by === 'user' ? 'User' : by === 'agent' ? 'Agent' : by || 'Unknown');

/** `/Subj` — what a reader shows as the comment's subject line. */
const subject = (t: Thread) =>
  [t.kind ?? 'comment', t.status === 'resolved' ? 'resolved' : null].filter(Boolean).join(' · ');

/**
 * The URI a link annotation points at, or null.
 *
 * Chrome writes `/A << /S /URI /URI (…) >>`; other producers may use an indirect action dict,
 * hence the lookup rather than a direct `.get`.
 */
function linkUri(ctx: PDFDocument['context'], annot: PDFDict): string | null {
  const subtype = ctx.lookupMaybe(annot.get(PDFName.of('Subtype')), PDFName);
  if (subtype?.asString() !== '/Link') return null;
  const action = ctx.lookupMaybe(annot.get(PDFName.of('A')), PDFDict);
  if (!action) return null;
  const uri = ctx.lookupMaybe(action.get(PDFName.of('URI')), PDFString, PDFHexString);
  return uri ? uri.decodeText() : null;
}

function readRect(ctx: PDFDocument['context'], annot: PDFDict, page: number): Rect | null {
  const arr = ctx.lookupMaybe(annot.get(PDFName.of('Rect')), PDFArray);
  if (!arr || arr.size() < 4) return null;
  const n = (i: number) => ctx.lookup(arr.get(i), PDFNumber).asNumber();
  const [a, b, c, d] = [n(0), n(1), n(2), n(3)];
  return { page, x0: Math.min(a, c), y0: Math.min(b, d), x1: Math.max(a, c), y1: Math.max(b, d) };
}

/** Append to a map of arrays. */
function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Harvest every anchor link's rectangle, and unlink the links from their pages.
 *
 * The links are scaffolding: left in place a reader would see the plan's prose sprinkled with
 * dead links to a `.invalid` host. They are dropped from `/Annots` and stripped of their action
 * rather than deleted outright — Chrome's structure tree points at them, and a dangling
 * reference is a worse trade than an inert object. Stripping `/A` is what actually retires the
 * link: it takes the URL out of the file, so nothing of the scaffolding reaches the recipient.
 */
function harvestAnchors(doc: PDFDocument): Map<string, Rect[]> {
  const ctx = doc.context;
  const found = new Map<string, Rect[]>();
  doc.getPages().forEach((page, pageIndex) => {
    const annots = ctx.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (!annots) return;
    const keep: (PDFRef | PDFDict)[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const entry = annots.get(i);
      const dict = ctx.lookupMaybe(entry, PDFDict);
      const id = dict ? anchorId(linkUri(ctx, dict) ?? '') : null;
      if (!dict || id === null) {
        keep.push(entry as PDFRef | PDFDict);
        continue;
      }
      const rect = readRect(ctx, dict, pageIndex);
      if (rect) push(found, id, rect);
      dict.delete(PDFName.of('A'));
    }
    page.node.set(PDFName.of('Annots'), ctx.obj(keep));
  });
  // Reading order: earliest page, then top of page, then left to right. Chrome already emits
  // them this way; sorting makes the choice of "first rectangle" independent of that.
  for (const [id, rects] of found) {
    rects.sort((p, q) => p.page - q.page || q.y1 - p.y1 || p.x0 - q.x0);
    found.set(id, mergeLines(rects));
  }
  return found;
}

/**
 * Fuse rectangles that sit on the same line into one.
 *
 * A highlight split around a nested link (see `unnestAnchors`) arrives as two rectangles with
 * the link's words in the gap between them. They are one continuous highlight to a reader, so
 * spanning the gap is what they expect to see — and fragments of one comment on one line are
 * always contiguous text, so there is no case where the gap is something else.
 *
 * "Same line" is decided by vertical overlap, not by equal edges: fragments of one line can
 * differ by a fraction of a point when they hold different inline content, while consecutive
 * lines sit edge to edge and overlap not at all.
 */
function mergeLines(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const prev = out[out.length - 1];
    const overlap = prev ? Math.min(prev.y1, r.y1) - Math.max(prev.y0, r.y0) : 0;
    const sameLine =
      prev && prev.page === r.page && overlap > 0.6 * Math.min(prev.y1 - prev.y0, r.y1 - r.y0);
    if (sameLine) {
      prev.x0 = Math.min(prev.x0, r.x0);
      prev.x1 = Math.max(prev.x1, r.x1);
      prev.y0 = Math.min(prev.y0, r.y0);
      prev.y1 = Math.max(prev.y1, r.y1);
    } else out.push({ ...r });
  }
  return out;
}

/**
 * Appearance stream for a highlight.
 *
 * Without one, whether anything is drawn on the page comes down to whether the reader
 * synthesises appearances — Preview and Acrobat do, several others show nothing at all. Drawing
 * it ourselves, in Multiply blend so the text still reads through, makes the highlight look the
 * same everywhere.
 */
function highlightAppearance(doc: PDFDocument, rects: Rect[], rgb: [number, number, number]) {
  const bbox = bounds(rects);
  const ops = [
    '/GSip gs',
    `${rgb.map((c) => c.toFixed(4)).join(' ')} rg`,
    ...rects.map((r) => `${r.x0} ${r.y0} ${(r.x1 - r.x0).toFixed(2)} ${(r.y1 - r.y0).toFixed(2)} re`),
    'f',
  ].join('\n');
  return doc.context.register(
    doc.context.flateStream(ops, {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      // BBox in page coordinates with no /Matrix, so form space *is* page space and the
      // rectangles above can be written exactly as the browser reported them.
      BBox: [bbox.x0, bbox.y0, bbox.x1, bbox.y1],
      Resources: {
        ExtGState: { GSip: { Type: 'ExtGState', BM: 'Multiply', CA: 1, ca: 1 } },
      },
      Group: { Type: 'Group', S: 'Transparency', CS: 'DeviceRGB' },
    }),
  );
}

/**
 * A deliberately empty appearance, used to keep reply annotations from drawing anything.
 *
 * A `/Text` annotation with no `/AP` gets a sticky-note icon from most readers — so a thread
 * with three replies stamps three icons on the same word, while a thread with none gets no
 * marker at all. The highlight is the marker; the replies belong in the sidebar, which is also
 * how Acrobat renders its own threads. One empty form, shared by every reply in the document.
 */
function emptyAppearance(doc: PDFDocument, cache: { ref?: PDFRef }): PDFRef {
  cache.ref ??= doc.context.register(
    doc.context.flateStream('', { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 1, 1] }),
  );
  return cache.ref;
}

function bounds(rects: Rect[]) {
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    y0: Math.min(...rects.map((r) => r.y0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    y1: Math.max(...rects.map((r) => r.y1)),
  };
}

/** QuadPoints: per rectangle, upper-left, upper-right, lower-left, lower-right. */
const quadPoints = (rects: Rect[]) =>
  rects.flatMap((r) => [r.x0, r.y1, r.x1, r.y1, r.x0, r.y0, r.x1, r.y0]);

function addToPage(doc: PDFDocument, pageIndex: number, ref: PDFRef) {
  const page = doc.getPages()[pageIndex];
  const annots = doc.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
  if (annots) annots.push(ref);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
}

/**
 * Attach `threads` to `pdf` as PDF comments, using the anchor links `print.ts` left behind.
 *
 * Threads whose anchor produced no rectangle — an anchor written inside a code fence, or a
 * `<comment>` an agent wrote without one — are reported in `missing` rather than dropped
 * silently, since a lost comment is the one failure here nobody would notice.
 */
export async function annotatePdf(pdf: Uint8Array, threads: Thread[]): Promise<AnnotateResult> {
  const doc = await PDFDocument.load(pdf);
  const anchors = harvestAnchors(doc);
  const placed: string[] = [];
  const missing: string[] = [];
  const blank: { ref?: PDFRef } = {};

  for (const thread of threads) {
    const rects = anchors.get(thread.id);
    if (!rects?.length || !thread.notes.length) {
      missing.push(thread.id);
      continue;
    }
    const rgb = color(thread);
    // A span broken across a page boundary can't be one annotation — annotations belong to a
    // page. The thread lives on the first page; later pages get a plain highlight with no
    // /Contents, so the reader shows the ink without listing the comment twice.
    const byPage = new Map<number, Rect[]>();
    for (const r of rects) push(byPage, r.page, r);
    const [homePage, ...spillPages] = [...byPage.keys()];
    const home = byPage.get(homePage)!;
    const box = bounds(home);
    const page = doc.getPages()[homePage];
    const pageRef = page.ref;
    const [first, ...replies] = thread.notes;
    const at = pdfDate(first.at);

    const parent = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      P: pageRef,
      Rect: [box.x0, box.y0, box.x1, box.y1],
      QuadPoints: quadPoints(home),
      C: rgb,
      F: 4, // Print — a comment that vanishes when the file is printed isn't much of a comment
      T: PDFHexString.fromText(author(first.by)),
      Contents: PDFHexString.fromText(first.body),
      Subj: PDFHexString.fromText(subject(thread)),
      NM: PDFString.of(`ip-${thread.id}`),
      AP: { N: highlightAppearance(doc, home, rgb) },
      ...(at ? { M: PDFString.of(at), CreationDate: PDFString.of(at) } : {}),
    });
    const parentRef = doc.context.register(parent);
    addToPage(doc, homePage, parentRef);

    // The popup is where the reader shows the thread. Parked in the right margin beside the
    // anchor and closed by default, so opening the PDF isn't a wall of open notes.
    const pageWidth = page.getWidth();
    const popupRef = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Popup',
        P: pageRef,
        Parent: parentRef,
        Rect: [
          Math.max(0, pageWidth - 220),
          Math.max(0, box.y0 - 120),
          Math.max(20, pageWidth - 20),
          Math.max(20, box.y0),
        ],
        Open: false,
        F: 28, // Print | NoZoom | NoRotate, as Acrobat writes them
      }),
    );
    parent.set(PDFName.of('Popup'), popupRef);
    addToPage(doc, homePage, popupRef);

    for (const [i, spillPage] of spillPages.entries()) {
      const cont = byPage.get(spillPage)!;
      const cb = bounds(cont);
      addToPage(
        doc,
        spillPage,
        doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Highlight',
            P: doc.getPages()[spillPage].ref,
            Rect: [cb.x0, cb.y0, cb.x1, cb.y1],
            QuadPoints: quadPoints(cont),
            C: rgb,
            F: 4,
            NM: PDFString.of(`ip-${thread.id}-cont${i}`),
            AP: { N: highlightAppearance(doc, cont, rgb) },
          }),
        ),
      );
    }

    // Replies: /IRT + /RT /R is how every PDF reviewer represents a thread. They draw nothing
    // (see emptyAppearance) but still carry their text, so a reader that doesn't understand
    // threading lists them flat rather than losing them.
    for (const [i, note] of replies.entries()) {
      const rat = pdfDate(note.at);
      addToPage(
        doc,
        homePage,
        doc.context.register(
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Text',
            P: pageRef,
            Rect: [box.x1, box.y0, box.x1 + 18, box.y0 + 18],
            Name: 'Comment',
            AP: { N: emptyAppearance(doc, blank) },
            IRT: parentRef,
            RT: 'R',
            C: rgb,
            F: 4,
            Open: false,
            T: PDFHexString.fromText(author(note.by)),
            Contents: PDFHexString.fromText(note.body),
            Subj: PDFHexString.fromText(subject(thread)),
            NM: PDFString.of(`ip-${thread.id}-r${i}`),
            ...(rat ? { M: PDFString.of(rat), CreationDate: PDFString.of(rat) } : {}),
          }),
        ),
      );
    }
    placed.push(thread.id);
  }

  return { bytes: await doc.save(), placed, missing };
}
