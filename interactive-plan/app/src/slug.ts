// GitHub-style heading ids, so `[x](#export-a-pdf-to-share)` points at `## Export a PDF to share`
// the same way it does on github.com. Pure string helpers; the DOM side lives in peek.tsx.

// Mirrors github-slugger: lowercase, drop everything that is not a letter, mark, number,
// connector punctuation (underscore), hyphen or space, then spaces become hyphens. Two
// spaces (around a stripped em dash, say) give two hyphens — GitHub does the same, so a link
// copied from a GitHub render still resolves here.
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Hands out unique slugs for one document: a repeated heading gets `-1`, `-2`, … like GitHub. */
export class Slugger {
  private used = new Set<string>();
  private counts = new Map<string, number>();

  slug(text: string): string {
    const raw = slugify(text);
    const base = /[\p{L}\p{N}]/u.test(raw) ? raw : 'section'; // a heading of only symbols still needs a real id
    let s = base;
    let n = this.counts.get(base) ?? 0;
    while (this.used.has(s)) s = `${base}-${++n}`;
    this.counts.set(base, n);
    this.used.add(s);
    return s;
  }
}

// Element ids an in-page href may mean, most literal first. `#q1` is the way a plan names a
// question/decision/finding/check(-table), and the viewer renders those as `id="block-q1"`;
// `#Open Questions` typed loosely still finds the slugged heading.
export function fragmentCandidates(href: string): string[] {
  if (!href.startsWith('#')) return [];
  let frag = href.slice(1);
  try {
    frag = decodeURIComponent(frag);
  } catch {
    /* a stray % — match it literally */
  }
  if (!frag) return [];
  const out = [frag];
  if (!frag.startsWith('block-')) out.push(`block-${frag}`);
  const s = slugify(frag);
  if (s && !out.includes(s)) out.push(s);
  return out;
}
