import type { PageConnection } from './types.ts';

/**
 * A terminal Claude Code session offered to this page (plans/terminal-handoff/main.md): the chat
 * can open it with `openThread(sessionId)` and the daemon runs the agent in the session's own
 * directory, so the thread continues where the terminal left it.
 */
export interface HandoffInfo {
  sessionId: string;
  /** The terminal session's working directory. */
  cwd: string;
  origin?: string;
  title?: string;
  note?: string;
  tags?: Record<string, string>;
  /** ISO time the terminal offered it. */
  offeredAt: string;
  pid?: number;
  /** The process still holding the session (a terminal or a background session): loading it is refused until that closes. */
  live: { pid?: number; kind?: string; status?: string; state?: string; name?: string; /** a page's own agent holds it (this tab, or another) */ heldByPage?: boolean } | null;
  /** The daemon could not check (no `claude` on its PATH, a timeout). */
  liveUnknown?: true;
}

/** The handoffs the daemon lists for this page; empty when the daemon reports none or predates them. */
export async function listHandoffs(page: PageConnection): Promise<HandoffInfo[]> {
  const url = page.status.handoffsUrl;
  if (!url) return [];
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`handoffs: HTTP ${r.status}`);
  const body = (await r.json()) as { handoffs?: HandoffInfo[] };
  return Array.isArray(body.handoffs) ? body.handoffs : [];
}

/** Withdraw a handoff from the list. The session itself is untouched (`claude --resume` still finds it). */
export async function forgetHandoff(page: PageConnection, sessionId: string): Promise<void> {
  const url = page.status.handoffsUrl;
  if (!url) throw new Error('the daemon offers no handoffs');
  const target = new URL(url);
  target.pathname = '/handoffs/forget'; target.search = '';
  const r = await fetch(target.href, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }) });
  if (!r.ok) throw new Error(`handoffs: HTTP ${r.status}`);
}

/** A handoff's display name: its title, else the session's directory name. */
export function handoffLabel(h: HandoffInfo): string {
  if (h.title) return h.title;
  const dir = h.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return dir ? `terminal thread in ${dir}` : `terminal thread ${h.sessionId.slice(0, 6)}`;
}

/** The CLI refuses to resume a session another process still holds; say what to do about it. */
export function explainLoadError(message: string): string {
  if (/Ctrl\+D/.test(message)) return message;   // the daemon already said what to do
  return /running in the background|claude attach|claude stop|another terminal|already running|still open in/i.test(message)
    ? `${message} Close that terminal session (Ctrl+D) and try again; the thread is kept.`
    : message;
}
