// Pending operations, shown optimistically.
//
// Nothing here recomputes a number: n/N, prevalence, and the kind mix always come from
// ta.py (principle 6), and a staged op that would change them says so instead of
// guessing. What is overlaid is what the researcher just typed or clicked — the codes on
// an extract, a reworded definition, a code's new parent — so the page reflects their
// intent while the data file still says what it said before `apply`.
import type { Code, Extract, Op, Theme } from './types';
import { isStaged, isThread } from './ops';

export interface ExtractPatch {
  codes?: string[];
  kind?: string;
  context?: string | null;
  note?: string | null;
  highlight?: string | null;
  dropped?: boolean;
  /** A staged re-trim, with the offsets it will cut to, so the transcript can show it. */
  retrim?: { start: number; end: number };
  reviewed?: boolean;
  ops: Op[];
}

export interface CodePatch {
  status?: string;
  name?: string;
  definition?: string;
  include?: string;
  exclude?: string;
  parent?: string | null;
  mergedInto?: string;
  renamedTo?: string;
  splitInto?: string[];
  ops: Op[];
}

export interface ThemePatch {
  name?: string;
  essence?: string;
  story?: string;
  rq?: string;
  in_paper?: string;
  status?: string;
  addCodes: string[];
  removeCodes: string[];
  addQuotes: string[];
  removeQuotes: string[];
  addTensions: string[];
  removeTensions: string[];
  trims: string[];
  ops: Op[];
}

export interface Patch {
  extracts: Record<string, ExtractPatch>;
  codes: Record<string, CodePatch>;
  themes: Record<string, ThemePatch>;
  newExtracts: Op[];
  newCodes: Op[];
  newThemes: Op[];
  rereads: Op[];
  countsWillChange: boolean;
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function pendingPatch(inbox: Op[], extracts: Extract[]): Patch {
  const patch: Patch = { extracts: {}, codes: {}, themes: {}, newExtracts: [], newCodes: [], newThemes: [], rereads: [], countsWillChange: false };
  const byId = new Map(extracts.map((e) => [e.id, e]));
  const ex = (id: string): ExtractPatch => (patch.extracts[id] ??= { ops: [] });
  const co = (id: string): CodePatch => (patch.codes[id] ??= { ops: [] });
  const th = (id: string): ThemePatch => (patch.themes[id] ??= {
    addCodes: [], removeCodes: [], addQuotes: [], removeQuotes: [], addTensions: [], removeTensions: [], trims: [], ops: [],
  });

  // Staged order is the researcher's order, so a later op overrides an earlier one.
  for (const o of inbox.filter((x) => isStaged(x) && !isThread(x))) {
    const a = (o.args ?? {}) as Record<string, unknown>;
    const t = o.target ?? '';
    switch (o.op) {
      case 'recode': {
        const p = ex(t);
        const base = p.codes ?? byId.get(t)?.codes ?? [];
        let next = new Set(base);
        if (a.set) next = new Set(arr(a.set));
        for (const c of arr(a.add)) next.add(c);
        for (const c of arr(a.remove)) next.delete(c);
        p.codes = [...next].sort();
        p.ops.push(o);
        patch.countsWillChange = true;
        break;
      }
      case 'set-kind': {
        const p = ex(t);
        p.kind = str(a.kind);
        p.ops.push(o);
        patch.countsWillChange = true;
        break;
      }
      case 'set-context': {
        const p = ex(t);
        p.context = (str(a.context) ?? null) || null;
        p.ops.push(o);
        break;
      }
      case 'set-note': {
        const p = ex(t);
        p.note = (str(a.note) ?? null) || null;
        p.ops.push(o);
        break;
      }
      case 'highlight': {
        const p = ex(t);
        p.highlight = a.reason ? String(a.reason) : null;
        p.ops.push(o);
        break;
      }
      case 'retrim': {
        const p = ex(t);
        if (typeof a.start === 'number' && typeof a.end === 'number') p.retrim = { start: a.start, end: a.end };
        p.ops.push(o);
        break;
      }
      case 'drop': {
        const p = ex(t);
        p.dropped = true;
        p.ops.push(o);
        patch.countsWillChange = true;
        break;
      }
      case 'new-extract':
        patch.newExtracts.push(o);
        patch.countsWillChange = true;
        break;
      case 'mark-reviewed': {
        for (const id of arr(a.extracts)) ex(id).reviewed = true;
        if (a.transcript) {
          for (const e of extracts) if (e.transcript === a.transcript) ex(e.id).reviewed = true;
        }
        break;
      }
      case 'code-status': {
        const p = co(t);
        p.status = str(a.status);
        p.ops.push(o);
        break;
      }
      case 'set-field': {
        const p = co(t);
        const field = str(a.field);
        if (field === 'definition' || field === 'include' || field === 'exclude' || field === 'name') p[field] = str(a.value) ?? '';
        p.ops.push(o);
        break;
      }
      case 'reparent': {
        const p = co(t);
        p.parent = (str(a.parent) ?? null) || null;
        p.ops.push(o);
        break;
      }
      case 'rename-code': {
        const p = co(t);
        p.renamedTo = str(a.new_id);
        p.ops.push(o);
        break;
      }
      case 'merge-code': {
        const p = co(t);
        p.mergedInto = str(a.into);
        p.ops.push(o);
        patch.countsWillChange = true;
        break;
      }
      case 'split-code': {
        const p = co(t);
        p.splitInto = [...(p.splitInto ?? []), String(a.new_id ?? '')];
        p.ops.push(o);
        patch.countsWillChange = true;
        break;
      }
      case 'new-code':
        patch.newCodes.push(o);
        break;
      case 'new-theme':
        patch.newThemes.push(o);
        break;
      case 'assign-theme': {
        const dest = (str(a.theme) ?? null) || null;
        if (dest) {
          const p = th(dest);
          p.addCodes.push(t);
          p.ops.push(o);
        }
        // Leaving a theme is shown on the theme that loses the card, when we know it.
        for (const [tid, p] of Object.entries(patch.themes)) {
          if (tid !== dest && p.addCodes.includes(t)) p.addCodes = p.addCodes.filter((c) => c !== t);
        }
        patch.countsWillChange = true;
        break;
      }
      case 'set-theme-field': {
        const p = th(t);
        const field = str(a.field);
        if (field === 'name' || field === 'essence' || field === 'story' || field === 'rq' || field === 'in_paper' || field === 'status')
          p[field] = str(a.value) ?? '';
        p.ops.push(o);
        break;
      }
      case 'select-quote': {
        const p = th(t);
        p.addQuotes.push(String(a.extract ?? ''));
        p.removeQuotes = p.removeQuotes.filter((x) => x !== String(a.extract ?? ''));
        p.ops.push(o);
        break;
      }
      case 'deselect-quote': {
        const p = th(t);
        p.removeQuotes.push(String(a.extract ?? ''));
        p.addQuotes = p.addQuotes.filter((x) => x !== String(a.extract ?? ''));
        p.ops.push(o);
        break;
      }
      case 'quote-span': {
        const p = th(t);
        p.trims.push(String(a.extract ?? ''));
        p.ops.push(o);
        break;
      }
      case 'set-tension': {
        const p = th(t);
        p.addTensions.push(...arr(a.add));
        p.removeTensions.push(...arr(a.remove));
        p.ops.push(o);
        break;
      }
      case 'reread-request':
        patch.rereads.push(o);
        break;
      default:
        break;
    }
  }
  return patch;
}

/** An extract as the researcher has just left it (data + their staged edits). */
export function withPatch(e: Extract, p?: ExtractPatch): Extract & { pending: boolean; dropped: boolean } {
  if (!p) return { ...e, pending: false, dropped: false };
  return {
    ...e,
    codes: p.codes ?? e.codes,
    kind: (p.kind as Extract['kind']) ?? e.kind,
    context: p.context !== undefined ? p.context : e.context,
    note: p.note !== undefined ? p.note : e.note,
    highlight: p.highlight === null ? undefined : p.highlight ?? e.highlight,
    pending: p.ops.length > 0,
    dropped: !!p.dropped,
  };
}

export function codeWithPatch(c: Code, p?: CodePatch): Code & { pending: boolean } {
  if (!p) return { ...c, pending: false };
  return {
    ...c,
    status: (p.status as Code['status']) ?? c.status,
    name: p.name ?? c.name,
    definition: p.definition ?? c.definition,
    include: p.include ?? c.include,
    exclude: p.exclude ?? c.exclude,
    parent: p.parent !== undefined ? p.parent : c.parent,
    pending: p.ops.length > 0,
  };
}

export function themeWithPatch(t: Theme, p?: ThemePatch): Theme & { pending: boolean } {
  if (!p) return { ...t, pending: false };
  const codes = [...new Set([...t.codes.filter((c) => !p.removeCodes.includes(c)), ...p.addCodes])];
  const quotes = [...new Set([...t.selected_extracts.filter((e) => !p.removeQuotes.includes(e)), ...p.addQuotes])];
  const tensions = [...new Set([...t.tensions.filter((e) => !p.removeTensions.includes(e)), ...p.addTensions])];
  return {
    ...t,
    name: p.name ?? t.name,
    essence: p.essence ?? t.essence,
    story: p.story ?? t.story,
    rq: p.rq ?? t.rq,
    in_paper: (p.in_paper as Theme['in_paper']) ?? t.in_paper,
    status: (p.status as Theme['status']) ?? t.status,
    codes,
    selected_extracts: quotes,
    tensions,
    pending: p.ops.length > 0,
  };
}
