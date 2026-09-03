// The operation vocabulary, mirroring OP_SPECS in scripts/ta.py. A gesture in the
// workbench becomes one of these; `ta.py apply` executes it. Keeping the list here
// (rather than free text) is what makes the researcher's meaning survive the trip:
// nothing has to be parsed back out of prose.
import type { Op } from './types';

export type OpName =
  | 'recode' | 'set-kind' | 'set-context' | 'set-note' | 'retrim' | 'drop' | 'new-extract' | 'highlight' | 'mark-reviewed'
  | 'code-status' | 'set-field' | 'reparent' | 'rename-code' | 'merge-code' | 'split-code' | 'new-code'
  | 'reread-request'
  | 'new-theme' | 'assign-theme' | 'set-theme-field' | 'merge-theme' | 'set-tension'
  | 'select-quote' | 'deselect-quote' | 'quote-span'
  | 'set-participant' | 'set-transcript' | 'set-stance' | 'set-rq'
  | 'comment' | 'reply';

export const OP_VIEW: Record<OpName, string> = {
  recode: 'transcript', 'set-kind': 'transcript', 'set-context': 'transcript', 'set-note': 'transcript',
  retrim: 'transcript', drop: 'transcript', 'new-extract': 'transcript', highlight: 'transcript',
  'mark-reviewed': 'transcript',
  'code-status': 'codebook', 'set-field': 'codebook', reparent: 'codebook', 'rename-code': 'codebook',
  'merge-code': 'codebook', 'split-code': 'codebook', 'new-code': 'codebook',
  'reread-request': 'coverage',
  'new-theme': 'themes', 'assign-theme': 'themes', 'set-theme-field': 'themes', 'merge-theme': 'themes',
  'set-tension': 'themes',
  'select-quote': 'quotes', 'deselect-quote': 'quotes', 'quote-span': 'quotes',
  'set-participant': 'study', 'set-transcript': 'study', 'set-stance': 'study', 'set-rq': 'study',
  comment: 'any', reply: 'any',
};

export interface Draft {
  op: OpName;
  target?: string | null;
  args?: Record<string, unknown>;
  note?: string | null;
  view?: string;
  by?: 'user' | 'agent';
}

export const draft = (op: OpName, target: string | null, args: Record<string, unknown> = {}, note?: string): Draft => ({
  op,
  target,
  args,
  note: note ?? null,
  view: OP_VIEW[op],
  by: 'user',
});

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []);
const short = (v: unknown, n = 60): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/** One line describing a staged operation, for the pending drawer and the tooltips. */
export function describe(o: Pick<Op, 'op' | 'target' | 'args' | 'note'>): string {
  const a = (o.args ?? {}) as Record<string, unknown>;
  const t = o.target ?? '';
  switch (o.op) {
    case 'recode': {
      const add = arr(a.add), rm = arr(a.remove), set = arr(a.set);
      if (set.length) return `${t}: codes → ${set.join(', ')}`;
      return `${t}: ${[add.length ? `+${add.join(' +')}` : '', rm.length ? `−${rm.join(' −')}` : ''].filter(Boolean).join(' ')}`;
    }
    case 'set-kind': return `${t}: kind → ${a.kind}`;
    case 'set-context': return `${t}: context → ${short(a.context)}`;
    case 'set-note': return `${t}: note → ${short(a.note)}`;
    case 'retrim': return `${t}: re-trim the span`;
    case 'drop': return `${t}: drop this extract`;
    case 'new-extract': return `new extract in ${a.transcript}:${a.line_start ?? a.lines} (${arr(a.codes).join(', ')}, ${a.kind ?? 'said'})`;
    case 'highlight': return a.reason ? `${t}: ★ ${short(a.reason)}` : `${t}: clear ★`;
    case 'mark-reviewed': return a.transcript ? `mark ${a.transcript} reviewed` : `mark ${arr(a.extracts).length + arr(a.codes).length + arr(a.themes).length} item(s) reviewed`;
    case 'code-status': return `${t} → ${a.status}`;
    case 'set-field': return `${t}.${a.field} reworded`;
    case 'reparent': return a.parent ? `${t} → child of ${a.parent}` : `${t} → top level`;
    case 'rename-code': return `${t} → ${a.new_id}`;
    case 'merge-code': return `merge ${t} into ${a.into}`;
    case 'split-code': return `split ${a.new_id} out of ${t} (${arr(a.extracts).length} extracts)`;
    case 'new-code': return `new code ${a.id}`;
    case 'reread-request': return `re-read ${a.transcript}${a.code ? ` for ${a.code}` : ''}`;
    case 'new-theme': return `new theme “${short(a.name, 40)}”`;
    case 'assign-theme': return `${t} → ${a.theme ?? 'unplaced'}`;
    case 'set-theme-field': return `${t}.${a.field} updated`;
    case 'merge-theme': return `merge ${t} into ${a.into}`;
    case 'set-tension': return `${t}: tensions ${arr(a.add).length ? `+${arr(a.add).join(' +')}` : ''}${arr(a.remove).length ? ` −${arr(a.remove).join(' −')}` : ''}`;
    case 'select-quote': return `${t}: quote ${a.extract}`;
    case 'deselect-quote': return `${t}: drop quote ${a.extract}`;
    case 'quote-span': return a.clear ? `${t}: clear the trim on ${a.extract}` : `${t}: trim ${a.extract} for inline use`;
    case 'set-participant': return `${t}: roster`;
    case 'set-transcript': return `${t}: ${arr(a.participants).join(', ') || a.kind}`;
    case 'set-stance': return `approach.${a.field} → ${short(a.value, 30)}`;
    case 'set-rq': return `${a.id} updated`;
    case 'comment': return `comment on ${t}: ${short(a.text, 50)}`;
    case 'reply': return `reply on ${t}: ${short(a.text, 50)}`;
    default: return `${o.op} ${t}`;
  }
}

export const isThread = (o: Pick<Op, 'op'>) => o.op === 'comment' || o.op === 'reply';

/** Worth showing in the drawer: not yet applied, refused, or stalled by a run that died.
 *  `applying` is excluded — the agent is mid-pass on it. */
export const isPending = (o: Op) =>
  o.status == null || o.status === 'pending' || o.status === 'failed' || o.status === 'stalled';

/** Safe to draw onto the data as if it had happened. A `stalled` operation is exactly the
 *  case where nobody knows whether it took effect, so it stays out: a phantom drop or
 *  recode would have the reviewer deciding against a change that may not exist. */
export const isStaged = (o: Op) => isPending(o) && o.status !== 'stalled';

/** Pending operations that touch a given id, so a row can show it is already staged. */
export function opsFor(pending: Op[], id: string): Op[] {
  return pending.filter((o) => o.target === id || (o.args as { extract?: string })?.extract === id);
}
