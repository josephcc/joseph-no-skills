// The contract between the print renderer and the PDF annotator, and nothing else.
//
// `print.ts` wraps every `<user-highlight>` in a link to one of these URLs; the browser lays the
// page out and emits a /Link annotation per line box; `annotate.ts` reads those links back to
// learn where on the page each comment's span ended up. Kept in its own module so neither side
// has to import the other (and so the URL shape is defined exactly once).
//
// `.invalid` is reserved by RFC 2606 and can never resolve. The links are deleted from the PDF
// once their rectangles have been harvested, so a reader never sees one — but if annotation ever
// fails halfway, a dead link is a far better outcome than one that goes somewhere real.

export const ANCHOR_ORIGIN = 'https://comment.interactive-plan.invalid/';

/** The href `print.ts` emits for a comment's highlight anchor. */
export const anchorHref = (id: string): string => ANCHOR_ORIGIN + encodeURIComponent(id);

/** The comment id in an anchor href, or null if this isn't one of ours. */
export function anchorId(href: string): string | null {
  if (!href.startsWith(ANCHOR_ORIGIN)) return null;
  const raw = href.slice(ANCHOR_ORIGIN.length);
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return raw || null; // malformed escape — better a wrong-looking id than a dropped comment
  }
}
