import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { annotatePdf, pdfDate, type Thread } from './annotate';
import { anchorHref } from './anchor';

/**
 * A stand-in for what the browser hands us: pages carrying /Link annotations at known
 * rectangles. Chrome emits one per line box, which is exactly what `rects` models here, so
 * these tests exercise the real input shape without needing a headless browser.
 */
async function pdfWithLinks(
  links: { uri: string; page?: number; rect: [number, number, number, number] }[],
  pageCount = 1,
) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([595, 842]);
  for (const link of links) {
    const page = doc.getPages()[link.page ?? 0];
    const ref = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: link.rect,
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(link.uri) },
      }),
    );
    const annots = doc.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (annots) annots.push(ref);
    else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  }
  return doc.save();
}

/**
 * The document as searchable text.
 *
 * pdf-lib saves into compressed object streams, so a plain byte scan finds nothing — re-saving
 * without them is what makes "this string is not in the file" a claim the test can actually make.
 */
async function readable(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
}

/** Every annotation in the saved document, flattened, with the page it sits on. */
async function annotations(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const out: { page: number; dict: PDFDict; subtype: string }[] = [];
  doc.getPages().forEach((page, i) => {
    const annots = doc.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const dict = doc.context.lookupMaybe(annots.get(k), PDFDict);
      if (dict) {
        out.push({
          page: i,
          dict,
          subtype: doc.context.lookup(dict.get(PDFName.of('Subtype')), PDFName).asString(),
        });
      }
    }
  });
  return out;
}

const text = (dict: PDFDict, key: string) => {
  const v = dict.get(PDFName.of(key));
  return v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : undefined;
};
const nums = (doc: PDFDocument, dict: PDFDict, key: string) => {
  const arr = doc.context.lookupMaybe(dict.get(PDFName.of(key)), PDFArray);
  if (!arr) return [];
  return Array.from({ length: arr.size() }, (_, i) => doc.context.lookup(arr.get(i), PDFNumber).asNumber());
};

const thread = (over: Partial<Thread> = {}): Thread => ({
  id: 'c1',
  status: 'open',
  kind: 'clarify',
  notes: [{ by: 'user', at: '2026-06-28T06:01', body: 'why this?' }],
  ...over,
});

describe('pdfDate', () => {
  it('converts a plan stamp, with or without a time', () => {
    expect(pdfDate('2026-06-28T06:01')).toBe('D:20260628060100');
    expect(pdfDate('2026-06-28')).toBe('D:20260628000000');
    expect(pdfDate('2026-06-28T06:01:42')).toBe('D:20260628060142');
  });

  it('returns nothing for a stamp it cannot read, rather than a bogus date', () => {
    expect(pdfDate('sometime tuesday')).toBe('');
    expect(pdfDate('')).toBe('');
  });
});

describe('annotatePdf', () => {
  it('turns an anchored thread into a highlight carrying the note', async () => {
    const pdf = await pdfWithLinks([{ uri: anchorHref('c1'), rect: [100, 700, 300, 714] }]);
    const { bytes, placed, missing } = await annotatePdf(pdf, [thread()]);
    expect(placed).toEqual(['c1']);
    expect(missing).toEqual([]);

    const doc = await PDFDocument.load(bytes);
    const all = await annotations(bytes);
    const hl = all.find((a) => a.subtype === '/Highlight')!;
    expect(hl.page).toBe(0);
    expect(text(hl.dict, 'Contents')).toBe('why this?');
    expect(text(hl.dict, 'T')).toBe('User');
    expect(text(hl.dict, 'Subj')).toBe('clarify');
    expect(text(hl.dict, 'M')).toBe('D:20260628060100');
    // QuadPoints: upper-left, upper-right, lower-left, lower-right of the line box.
    expect(nums(doc, hl.dict, 'QuadPoints')).toEqual([100, 714, 300, 714, 100, 700, 300, 700]);
    expect(nums(doc, hl.dict, 'Rect')).toEqual([100, 700, 300, 714]);
    // Print flag, so the highlight survives being printed on paper.
    expect(doc.context.lookup(hl.dict.get(PDFName.of('F')), PDFNumber).asNumber()).toBe(4);
    // An appearance stream, so readers that don't synthesise one still draw the ink.
    expect(hl.dict.get(PDFName.of('AP'))).toBeDefined();
    expect(all.some((a) => a.subtype === '/Popup')).toBe(true);
  });

  it('removes the anchor links, so the reader never sees one', async () => {
    const pdf = await pdfWithLinks([
      { uri: anchorHref('c1'), rect: [100, 700, 300, 714] },
      { uri: 'https://example.com/real', rect: [100, 600, 200, 614] },
    ]);
    const { bytes } = await annotatePdf(pdf, [thread()]);
    const all = await annotations(bytes);
    const links = all.filter((a) => a.subtype === '/Link');
    // The plan's own outbound link is untouched; only ours is taken away.
    expect(links).toHaveLength(1);
    const action = links[0].dict.get(PDFName.of('A')) as PDFDict;
    expect((action.get(PDFName.of('URI')) as PDFString).decodeText()).toBe('https://example.com/real');
    // The anchor URL must be gone from the *file*, not merely unlinked from the page: the
    // annotation object survives for the structure tree's sake, so its action is stripped.
    expect(await readable(bytes)).not.toContain('interactive-plan.invalid');
  });

  it('covers every line of a wrapped span with its own quad', async () => {
    const pdf = await pdfWithLinks([
      { uri: anchorHref('c1'), rect: [400, 700, 520, 714] },
      { uri: anchorHref('c1'), rect: [80, 686, 520, 700] },
      { uri: anchorHref('c1'), rect: [80, 672, 160, 686] },
    ]);
    const { bytes } = await annotatePdf(pdf, [thread()]);
    const doc = await PDFDocument.load(bytes);
    const hl = (await annotations(bytes)).find((a) => a.subtype === '/Highlight')!;
    expect(nums(doc, hl.dict, 'QuadPoints')).toHaveLength(24); // 3 lines x 8
    // The /Rect bounds all three fragments.
    expect(nums(doc, hl.dict, 'Rect')).toEqual([80, 672, 520, 714]);
  });

  it('spans the gap where a nested link split the anchor, on the same line', async () => {
    const pdf = await pdfWithLinks([
      { uri: anchorHref('c1'), rect: [100, 700, 160, 714] },
      // A link occupied 160..210. Its fragment is also a hair shorter, as Chrome's line boxes
      // are when the inline content differs — so "same line" can't mean "identical edges".
      { uri: anchorHref('c1'), rect: [210, 700.75, 300, 714] },
      { uri: anchorHref('c1'), rect: [80, 686, 140, 700] }, // next line — stays separate
    ]);
    const { bytes } = await annotatePdf(pdf, [thread()]);
    const doc = await PDFDocument.load(bytes);
    const hl = (await annotations(bytes)).find((a) => a.subtype === '/Highlight')!;
    expect(nums(doc, hl.dict, 'QuadPoints')).toEqual([
      100, 714, 300, 714, 100, 700, 300, 700, // the two fragments, fused
      80, 700, 140, 700, 80, 686, 140, 686,
    ]);
  });

  it('chains later notes to the first as replies', async () => {
    const pdf = await pdfWithLinks([{ uri: anchorHref('c1'), rect: [100, 700, 300, 714] }]);
    const { bytes } = await annotatePdf(pdf, [
      thread({
        notes: [
          { by: 'user', at: '2026-06-28T06:01', body: 'why this?' },
          { by: 'agent', at: '2026-06-28T06:05', body: 'because of the join' },
        ],
      }),
    ]);
    const all = await annotations(bytes);
    const parent = all.find((a) => a.subtype === '/Highlight')!;
    const reply = all.find((a) => a.subtype === '/Text')!;
    expect(text(reply.dict, 'Contents')).toBe('because of the join');
    expect(text(reply.dict, 'T')).toBe('Agent');
    expect(reply.dict.get(PDFName.of('RT'))).toBe(PDFName.of('R'));
    // /IRT must resolve to the parent highlight, or a reader can't nest the thread. Compared
    // by /NM, since resolving the reference yields a different object identity each load.
    const doc = await PDFDocument.load(bytes);
    const irt = doc.context.lookup(reply.dict.get(PDFName.of('IRT')), PDFDict);
    expect(text(irt, 'NM')).toBe('ip-c1');
    expect(text(parent.dict, 'NM')).toBe('ip-c1');
  });

  it('keeps a page-straddling span on both pages, but the thread only once', async () => {
    const pdf = await pdfWithLinks(
      [
        { uri: anchorHref('c1'), page: 0, rect: [80, 60, 520, 74] },
        { uri: anchorHref('c1'), page: 1, rect: [80, 760, 300, 774] },
      ],
      2,
    );
    const { bytes } = await annotatePdf(pdf, [thread()]);
    const all = await annotations(bytes);
    const highlights = all.filter((a) => a.subtype === '/Highlight');
    expect(highlights.map((h) => h.page)).toEqual([0, 1]);
    // Only the first carries the remark — a continuation must not list the comment twice.
    expect(highlights.filter((h) => text(h.dict, 'Contents') !== undefined)).toHaveLength(1);
    expect(text(highlights[0].dict, 'Contents')).toBe('why this?');
  });

  it('reports a thread with no anchor instead of dropping it silently', async () => {
    const pdf = await pdfWithLinks([{ uri: anchorHref('c1'), rect: [100, 700, 300, 714] }]);
    const { placed, missing } = await annotatePdf(pdf, [thread(), thread({ id: 'c2' })]);
    expect(placed).toEqual(['c1']);
    expect(missing).toEqual(['c2']);
  });

  it('carries non-ASCII comment text through intact', async () => {
    const body = 'naïve — 日本語 “quoted” 🎉';
    const pdf = await pdfWithLinks([{ uri: anchorHref('c1'), rect: [100, 700, 300, 714] }]);
    const { bytes } = await annotatePdf(pdf, [
      thread({ notes: [{ by: 'user', at: '2026-06-28T06:01', body }] }),
    ]);
    const hl = (await annotations(bytes)).find((a) => a.subtype === '/Highlight')!;
    expect(text(hl.dict, 'Contents')).toBe(body);
  });

  it('marks a resolved thread as resolved and dims it', async () => {
    const pdf = await pdfWithLinks([{ uri: anchorHref('c1'), rect: [100, 700, 300, 714] }]);
    const { bytes } = await annotatePdf(pdf, [thread({ status: 'resolved', kind: 'nit' })]);
    const doc = await PDFDocument.load(bytes);
    const hl = (await annotations(bytes)).find((a) => a.subtype === '/Highlight')!;
    expect(text(hl.dict, 'Subj')).toBe('nit · resolved');
    expect(nums(doc, hl.dict, 'C')).not.toEqual([0.89, 0.93, 0.94]); // not the open `nit` colour
  });

  it('leaves a plan with no comments byte-for-byte unannotated', async () => {
    const pdf = await pdfWithLinks([{ uri: 'https://example.com/real', rect: [100, 600, 200, 614] }]);
    const { bytes, placed } = await annotatePdf(pdf, []);
    expect(placed).toEqual([]);
    expect((await annotations(bytes)).map((a) => a.subtype)).toEqual(['/Link']);
  });
});
