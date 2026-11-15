import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { log } from './log.ts';
import { isSiteOrigin } from './security.ts';

/**
 * A terminal Claude Code session offered to a page (plans/terminal-handoff/main.md §2.2, D-2):
 * the page's embedded chat may `session/load` it, and the relay then runs the agent in the
 * session's own directory instead of the page's workspace. Only a local process registers one
 * (the HTTP route refuses browsers); a page sees the records offered to its origin or to none.
 */
export interface Handoff {
  /** UUID; also the record's key. */
  sessionId: string;
  /** Absolute, existing: the terminal session's working directory. */
  cwd: string;
  /** The page origin the handoff is for; absent = any approved origin. */
  origin?: string;
  title?: string;
  note?: string;
  /** Free-form, for the page to filter on (the thematic-analysis workbench stores its analysis folder). */
  tags?: Record<string, string>;
  offeredAt: string;
  /** The terminal process, when the registrar knows it. */
  pid?: number;
}

/** One row of `claude agents --json`, as far as the registry reads it. */
export interface LiveSession { sessionId: string; pid?: number; kind?: string; status?: string; state?: string; name?: string; cwd?: string }

export interface HandoffView extends Handoff {
  /** The live session holding this id, when the terminal (or a background session, or a page's own agent) still has it open. */
  live: (LiveSession & { heldByPage?: boolean }) | null;
  /** The liveness check could not run (no `claude` on PATH, a timeout): `live` says nothing then. */
  liveUnknown?: true;
}

export type LiveLister = () => Promise<LiveSession[]>;
/** The parent pid of a process (`ps -o ppid=`), or undefined when it is gone. */
export type ParentPidLookup = (pid: number) => Promise<number | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Newest records kept (D-6). */
export const HANDOFF_CAP = 50;
const LIVE_CACHE_MS = 3_000;
const LIVE_TIMEOUT_MS = 3_000;
const TEXT_MAX = 200;

export class HandoffRegistry {
  readonly #file: string;
  #records: Handoff[] = [];
  readonly #lister: LiveLister;
  #live: { at: number; rows: LiveSession[] | null } | undefined;
  #pending: Promise<LiveSession[] | null> | undefined;

  readonly #parentPidOf: ParentPidLookup;

  constructor(stateDir: string, lister: LiveLister, parentPidOf: ParentPidLookup = psParentPid) {
    mkdirSync(stateDir, { recursive: true });
    this.#file = join(stateDir, 'handoffs.json');
    this.#lister = lister;
    this.#parentPidOf = parentPidOf;
    try {
      const raw = JSON.parse(readFileSync(this.#file, 'utf8')) as unknown;
      if (Array.isArray(raw)) this.#records = raw.filter((r) => validateHandoff(r) === null).map((r) => normalise(r as Handoff));
    } catch { /* first run */ }
  }

  /** Validates and stores a record (newest first); a record with the same session id is replaced. Throws with the reason. */
  offer(input: unknown): Handoff {
    const problem = validateHandoff(input);
    if (problem) throw new Error(problem);
    const rec = normalise(input as Handoff);
    this.#records = [rec, ...this.#records.filter((r) => r.sessionId !== rec.sessionId)].slice(0, HANDOFF_CAP);
    this.#save();
    return rec;
  }

  forget(sessionId: string): boolean {
    const before = this.#records.length;
    const key = sessionId.toLowerCase();
    this.#records = this.#records.filter((r) => r.sessionId !== key);
    if (this.#records.length === before) return false;
    this.#save();
    return true;
  }

  /** Ids are stored lower-cased; a lookup normalises too, so a page cannot slip past a check by re-casing a UUID. */
  get(sessionId: string): Handoff | undefined { const key = sessionId.toLowerCase(); return this.#records.find((r) => r.sessionId === key); }

  /** The record a page at `origin` may load under that id: offered to that origin, or to none. */
  forOrigin(sessionId: string, origin: string): Handoff | undefined {
    const h = this.get(sessionId);
    return h && (!h.origin || h.origin === origin) ? h : undefined;
  }

  /** Records a page at `origin` may see; no origin (a local caller) sees them all. */
  visibleTo(origin?: string): Handoff[] {
    return origin === undefined ? [...this.#records] : this.#records.filter((r) => !r.origin || r.origin === origin);
  }

  all(): Handoff[] { return [...this.#records]; }

  /**
   * The records with their live state from `claude agents --json` (cached for a few seconds). A live row whose
   * parent is one of the daemon's own agent processes (`ownAdapterPids`) is marked `heldByPage`: a page has it open.
   */
  async withLiveness(records: Handoff[], ownAdapterPids: readonly number[] = []): Promise<HandoffView[]> {
    const rows = await this.#liveRows();
    return Promise.all(records.map(async (r) => {
      if (rows === null) return { ...r, live: null, liveUnknown: true as const };
      return { ...r, live: await this.#holderOf(rows, r.sessionId, ownAdapterPids) };
    }));
  }

  /** The process holding a session, with a holder that is not one of the daemon's own agents taking precedence: the live list can carry one id more than once. */
  async #holderOf(rows: LiveSession[], sessionId: string, ownAdapterPids: readonly number[]): Promise<(LiveSession & { heldByPage: boolean }) | null> {
    const matches = rows.filter((s) => s.sessionId === sessionId.toLowerCase());
    if (!matches.length) return null;
    const flagged = await Promise.all(matches.map(async (s) => ({ ...s, heldByPage: await this.#isOurs(s, ownAdapterPids) })));
    return flagged.find((s) => !s.heldByPage) ?? flagged[0]!;
  }

  /**
   * The process holding `sessionId` right now (a terminal, a background session, a page's agent), or null.
   * `fresh` skips the cache: a decision to refuse a load must not rest on a three-second-old listing.
   */
  async liveHolder(sessionId: string, opts: { fresh?: boolean; ownAdapterPids?: readonly number[] } = {}): Promise<(LiveSession & { heldByPage: boolean }) | null> {
    if (opts.fresh && !this.#pending) this.#live = undefined;
    const rows = await this.#liveRows();
    return rows ? this.#holderOf(rows, sessionId, opts.ownAdapterPids ?? []) : null;
  }

  async #isOurs(live: LiveSession, ownAdapterPids: readonly number[]): Promise<boolean> {
    if (!live.pid || !ownAdapterPids.length) return false;
    try { const parent = await this.#parentPidOf(live.pid); return parent !== undefined && ownAdapterPids.includes(parent); } catch { return false; }
  }

  async #liveRows(): Promise<LiveSession[] | null> {
    if (this.#live && Date.now() - this.#live.at < LIVE_CACHE_MS) return this.#live.rows;
    if (!this.#pending) {
      this.#pending = this.#lister().then(
        (rows) => { this.#live = { at: Date.now(), rows }; return rows; },
        (err) => { log.warn(`handoffs: liveness check failed: ${String((err as Error)?.message ?? err)}`); this.#live = { at: Date.now(), rows: null }; return null; },
      ).finally(() => { this.#pending = undefined; });
    }
    return this.#pending;
  }

  #save() {
    try { writeFileSync(this.#file, JSON.stringify(this.#records, null, 2) + '\n'); }
    catch (err) { log.warn(`handoffs: could not write ${this.#file}: ${String(err)}`); }
  }
}

/** null when the input is a valid handoff record; otherwise the first problem, for a 400. */
export function validateHandoff(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'expected a JSON object';
  const h = input as Record<string, unknown>;
  if (typeof h.sessionId !== 'string' || !UUID_RE.test(h.sessionId)) return 'sessionId must be a UUID';
  if (typeof h.cwd !== 'string' || !isAbsolute(h.cwd)) return 'cwd must be an absolute path';
  try { if (!statSync(h.cwd).isDirectory()) return 'cwd is not a directory'; } catch { return 'cwd does not exist'; }
  if (h.origin !== undefined && (typeof h.origin !== 'string' || !isSiteOrigin(h.origin))) return 'origin must be an http(s) site origin';
  for (const k of ['title', 'note'] as const) if (h[k] !== undefined && typeof h[k] !== 'string') return `${k} must be a string`;
  if (h.pid !== undefined && (typeof h.pid !== 'number' || !Number.isInteger(h.pid) || h.pid <= 0)) return 'pid must be a positive integer';
  if (h.tags !== undefined) {
    if (!h.tags || typeof h.tags !== 'object' || Array.isArray(h.tags)) return 'tags must be an object of strings';
    for (const [k, v] of Object.entries(h.tags as Record<string, unknown>)) if (typeof v !== 'string' || k.length > 64) return 'tags must be an object of strings';
  }
  return null;
}

function normalise(h: Handoff): Handoff {
  const clip = (s?: string) => (typeof s === 'string' ? s.slice(0, TEXT_MAX) : undefined);
  const tags = h.tags ? Object.fromEntries(Object.entries(h.tags).slice(0, 16).map(([k, v]) => [k, String(v).slice(0, 512)])) : undefined;
  return {
    sessionId: h.sessionId.toLowerCase(), cwd: h.cwd,
    ...(h.origin ? { origin: h.origin } : {}), ...(clip(h.title) ? { title: clip(h.title) } : {}), ...(clip(h.note) ? { note: clip(h.note) } : {}),
    ...(tags && Object.keys(tags).length ? { tags } : {}),
    offeredAt: typeof h.offeredAt === 'string' && !Number.isNaN(Date.parse(h.offeredAt)) ? h.offeredAt : new Date().toISOString(),
    ...(h.pid ? { pid: h.pid } : {}),
  };
}

/** `ps -o ppid= -p <pid>`: the parent of a live session's process, so the daemon can tell its own agents' sessions apart. */
export function psParentPid(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 2_000 }, (err, stdout) => {
      if (err) { resolve(undefined); return; }
      const n = Number.parseInt(String(stdout).trim(), 10);
      resolve(Number.isInteger(n) && n > 0 ? n : undefined);
    });
  });
}

/** `claude agents --json`: every interactive and background session on this machine, with pid, cwd and status. */
export function claudeAgentsLister(claude: () => string | undefined): LiveLister {
  return () => new Promise((resolve, reject) => {
    const bin = claude() ?? 'claude';
    execFile(bin, ['agents', '--json'], { timeout: LIVE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: process.env }, (err, stdout) => {
      if (err) { reject(err); return; }
      try {
        const raw = JSON.parse(stdout) as unknown;
        if (!Array.isArray(raw)) { reject(new Error('claude agents --json did not return an array')); return; }
        resolve(raw.filter((r) => r && typeof r === 'object' && typeof (r as { sessionId?: unknown }).sessionId === 'string').map((r) => {
          const s = r as Record<string, unknown>;
          return { sessionId: String(s.sessionId).toLowerCase(), ...(typeof s.pid === 'number' ? { pid: s.pid } : {}), ...(typeof s.kind === 'string' ? { kind: s.kind } : {}), ...(typeof s.status === 'string' ? { status: s.status } : {}), ...(typeof s.state === 'string' ? { state: s.state } : {}), ...(typeof s.name === 'string' ? { name: s.name } : {}), ...(typeof s.cwd === 'string' ? { cwd: s.cwd } : {}) };
        }));
      } catch (e) { reject(e); }
    });
  });
}
