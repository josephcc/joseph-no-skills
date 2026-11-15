// What the embedded agent sees of the workbench, as pure functions: the state snapshot that rides
// along with every prompt (and that `get_state` returns), the system-prompt addition for a thread
// started in the browser, and the prompt the drawer's button sends. Nothing here touches React or
// the daemon, so it is testable and the same text reaches terminal Claude through the plugin hook.
import type { HandoffInfo } from 'webmcp-connector';
import type { Bundle, Op } from './types';

export const TA = 'uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d';
export const PAGE_TOOLS = ['get_state', 'list_pending', 'navigate', 'open_pending'] as const;
export const VIEW_NAMES = ['transcript', 'codebook', 'coverage', 'themes', 'quotes', 'study', 'history'] as const;

/** A `?daemon=` pin is honoured only for a loopback WebSocket: a crafted link must not point the page at a remote socket. */
export function loopbackDaemonUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if ((u.protocol === 'ws:' || u.protocol === 'wss:') && (host === '127.0.0.1' || host === 'localhost' || host === '::1') && !u.username && !u.password) return `${u.protocol}//${u.host}`;
  } catch { /* not a URL */ }
  return undefined;
}

/** A study name as one line of plain text for the prompts: no control characters, bounded, quoted by the caller. */
export function plainName(value: unknown, max = 120): string {
  const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** What `navigate` may change: a known view name, or a selection key set to a string or cleared with null. */
export function navigationPatch(input: unknown): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  if (!input || typeof input !== 'object') return patch;
  const o = input as Record<string, unknown>;
  if (typeof o.view === 'string' && (VIEW_NAMES as readonly string[]).includes(o.view)) patch.view = o.view;
  for (const k of ['t', 'e', 'c', 'th', 'cmp'] as const) {
    if (!(k in o)) continue;
    const v = o[k];
    if (v === null) patch[k] = null;
    else if (typeof v === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(v)) patch[k] = v;
  }
  return patch;
}

export interface WorkbenchState {
  analysis: string;
  study: string;
  view: string;
  selection: { transcript: string | null; extract: string | null; code: string | null; theme: string | null; compare: string | null };
  codebook: { version: number; unapplied_changes: number; frozen: boolean };
  transcripts: { total: number; coded: number; stale: number };
  /** What waits in the inbox: the agent's proposals, the researcher's own staged lines (rare), the comment threads. */
  inbox: { proposals: number; mine: number; threads: number };
  drawer_open: boolean;
  page_tools: readonly string[];
}

export interface PendingRow { id: string; by: string; op: string; target: string | null; note: string | null; status: string; view: string; error?: string }

export interface NavLike { view: string; t: string | null; e: string | null; c: string | null; th: string | null; cmp: string | null }

export function buildState(args: { dir: string; bundle: Bundle | null; nav: NavLike; pending: Op[]; drawer: boolean }): WorkbenchState {
  const { dir, bundle: b, nav, pending, drawer } = args;
  const actionable = pending.filter((o) => o.op !== 'comment' && o.op !== 'reply');
  return {
    analysis: dir,
    study: b?.study ?? '',
    view: nav.view,
    selection: { transcript: nav.t, extract: nav.e, code: nav.c, theme: nav.th, compare: nav.cmp },
    codebook: { version: b?.codebook_version ?? 0, unapplied_changes: b?.codebook_pending.length ?? 0, frozen: !!b?.frozen },
    transcripts: { total: b?.transcripts.length ?? 0, coded: b?.transcripts.filter((t) => t.coded_with_version != null).length ?? 0, stale: b?.stale.stale.length ?? 0 },
    inbox: { proposals: actionable.filter((o) => o.by === 'agent').length, mine: actionable.filter((o) => o.by !== 'agent').length, threads: pending.filter((o) => o.op === 'comment').length },
    drawer_open: drawer,
    page_tools: PAGE_TOOLS,
  };
}

/** The deterministic snapshot attached to every prompt (and served to terminal Claude on request). */
export function formatContext(s: WorkbenchState): string {
  const sel = Object.entries(s.selection).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing selected';
  return [
    `Thematic-analysis workbench on ${s.analysis}${plainName(s.study) ? ` (study: "${plainName(s.study)}")` : ''}.`,
    `View: ${s.view}; selection: ${sel}; pending drawer ${s.drawer_open ? 'open' : 'closed'}.`,
    `Codebook v${s.codebook.version}${s.codebook.frozen ? ' (frozen)' : ''}${s.codebook.unapplied_changes ? `, ${s.codebook.unapplied_changes} unapplied change(s)` : ''}; transcripts ${s.transcripts.coded}/${s.transcripts.total} coded${s.transcripts.stale ? `, ${s.transcripts.stale} stale` : ''}.`,
    `Inbox: ${s.inbox.proposals} proposal(s) by the agent left standing, ${s.inbox.mine} staged by the researcher, ${s.inbox.threads} open thread(s). The researcher's own gestures are already applied (ta.py changes lists them).`,
    `Page tools: ${s.page_tools.join(', ')}. Data commands: ${TA} ${s.analysis} <command>.`,
  ].join('\n');
}

export function pendingRows(inbox: Op[]): PendingRow[] {
  return inbox.filter((o) => o.status !== 'resolved').map((o) => ({ id: o.id, by: o.by, op: o.op, target: o.target ?? null, note: o.note ?? null, status: o.status ?? 'pending', view: o.view, ...(o.error ? { error: o.error } : {}) }));
}

/** Appended to Claude Code's own system prompt for a thread started in the browser (a handed-off thread keeps the terminal's). */
export function instructionsFor(dir: string, study: string): string {
  const name = plainName(study);
  return [
    `You are embedded in the thematic-analysis review workbench for the analysis folder ${dir}${name ? ` (study: "${name}")` : ''}, a Braun & Clarke thematic analysis of interview transcripts for an HCI paper.`,
    '',
    'First, unless this thread already loaded it, load the `thematic-analysis` skill with the Skill tool and do what its Step 0 says (read the method in full) before touching the data. Every data command is `' + TA + ' ' + dir + ' <command>`; write it out in full each time.',
    '',
    'The researcher reviews the coding here and drives every decision. Their own gestures (a recode, an accepted code, a moved card) are carried out the moment they make them and recorded in the applied log; only your proposals and the comment threads wait in the inbox. When they ask you to review their feedback, run `changes`, then `inbox`, then `apply --all`, then `changes --ack`, read `stale`, and report what you applied, what you could not and why, and what the re-reads should be.',
    '',
    'A snapshot of what they are looking at (view, selection, inbox counts) arrives with every message. The page tools: `get_state` (the same snapshot as JSON), `list_pending` (the inbox rows), `navigate` (open a view, transcript, extract, code or theme for them), `open_pending` (the drawer). Call `navigate` when you want them to look at something, and say what to look at.',
  ].join('\n');
}

/** The short version the plugin injects into terminal sessions. */
export function summaryFor(dir: string, study: string): string {
  const name = plainName(study);
  return `The thematic-analysis workbench is open on ${dir}${name ? ` ("${name}")` : ''}. Its page tools (get_state, list_pending, navigate, open_pending) show and steer what the researcher sees; the current view and inbox counts arrive with each prompt. Data commands: ${TA} ${dir} <command>.`;
}

export const REVIEW_PROMPT = 'Review my feedback: run `changes`, then `inbox`, then `apply --all`, then `changes --ack` on this analysis folder, read `stale`, and tell me what you applied, what you could not apply and why, and which transcripts need a re-read.';

/** The handoff offered for this analysis folder, newest first; a folder is matched by its `analysis` tag. */
export function handoffForAnalysis(list: HandoffInfo[], dir: string): HandoffInfo | undefined {
  const norm = (p: string) => p.replace(/\/+$/, '');
  return list.find((h) => h.tags?.analysis && norm(h.tags.analysis) === norm(dir));
}
