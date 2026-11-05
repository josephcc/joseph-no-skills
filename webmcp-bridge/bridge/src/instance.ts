/**
 * One daemon per state directory, on the first free candidate port
 * (plans/daemon-port-discovery/main.md D-2, D-3).
 *
 * `daemon.json` in the state directory is both the discovery record (the hooks,
 * `status`, `stop` and the MCP relay read the port from it) and the lock: a
 * starter probes for a live instance first, then creates the file exclusively
 * before listening and fills the port in once it has one. A file whose pid is
 * dead, or whose port does not answer `GET /id` with our identity, is stale and
 * is removed.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DAEMON_NAME, PROTOCOL_VERSION, type DaemonIdentity } from 'webmcp-protocol';

export interface DaemonRecord {
  pid: number;
  /** null while the daemon is between claiming the file and listening. */
  port: number | null;
  startedAt: string;
  version: string;
  instance?: string;
}

export class AlreadyRunningError extends Error {
  readonly pid: number;
  readonly port: number;
  constructor(pid: number, port: number, host: string, legacy = false) {
    super(`already running on ${host}:${port} (pid ${pid})${legacy ? '; it predates port discovery: restart it (webmcp-daemon stop, then the plugin or the login item starts the new one)' : ''}`);
    this.name = 'AlreadyRunningError';
    this.pid = pid;
    this.port = port;
  }
}

export class AllPortsTakenError extends Error {
  readonly ports: readonly number[];
  constructor(ports: readonly number[], host: string) {
    super(`every candidate port is taken on ${host} (${ports.join(', ')}); free one, or pin another with --port <n> / WEBMCP_DAEMON_PORT`);
    this.name = 'AllPortsTakenError';
    this.ports = ports;
  }
}

export const daemonFilePath = (stateDir: string): string => join(stateDir, 'daemon.json');

export function readDaemonRecord(stateDir: string): DaemonRecord | null {
  try {
    const raw = JSON.parse(readFileSync(daemonFilePath(stateDir), 'utf8')) as Partial<DaemonRecord>;
    if (typeof raw.pid !== 'number') return null;
    return { pid: raw.pid, port: typeof raw.port === 'number' ? raw.port : null, startedAt: String(raw.startedAt ?? ''), version: String(raw.version ?? ''), ...(raw.instance ? { instance: String(raw.instance) } : {}) };
  } catch {
    return null;
  }
}

/** Creates the record exclusively; false when another starter got there first. */
export function claimDaemonFile(stateDir: string, record: DaemonRecord): boolean {
  try {
    writeFileSync(daemonFilePath(stateDir), JSON.stringify(record), { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export function updateDaemonFile(stateDir: string, record: DaemonRecord): void {
  writeFileSync(daemonFilePath(stateDir), JSON.stringify(record));
}

export function removeDaemonFile(stateDir: string): void {
  try { unlinkSync(daemonFilePath(stateDir)); } catch { /* already gone */ }
}

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** `GET /id` on a port: our identity, or null for no answer, a stranger, or a timeout. */
export async function identify(host: string, port: number, timeoutMs = 500): Promise<DaemonIdentity | null> {
  try {
    const r = await fetch(`http://${host}:${port}/id`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const body = (await r.json()) as Partial<DaemonIdentity>;
    // Ours, and speaking our protocol; a daemon of another version on a candidate port is passed over.
    return body.daemon === DAEMON_NAME && body.protocol === PROTOCOL_VERSION ? (body as DaemonIdentity) : null;
  } catch {
    return null;
  }
}

/** A daemon from before `/id` existed: its `/health` carries its pid, which the record must match. */
async function legacyHealthPid(host: string, port: number, timeoutMs = 500): Promise<number | null> {
  try {
    const r = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const body = (await r.json()) as { ok?: boolean; pid?: number };
    return body.ok === true && typeof body.pid === 'number' ? body.pid : null;
  } catch {
    return null;
  }
}

/**
 * The instance already serving this state directory, if any. A record whose pid
 * is dead is stale and removed. A live pid with no port yet (a start in
 * progress) or a port that does not answer is given `waitMs` to come up before
 * it is treated as stale too. The port must answer as the recorded instance
 * (`/id`), so a reused pid plus some other daemon on that port is not mistaken
 * for ours; a record without an instance id is from a daemon older than `/id`,
 * which still counts when its `/health` carries the recorded pid (an upgrade
 * must not start a second daemon beside it).
 */
export async function findRunningDaemon(stateDir: string, host: string, { waitMs = 2000 }: { waitMs?: number } = {}): Promise<{ pid: number; port: number; legacy?: boolean } | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const rec = readDaemonRecord(stateDir);
    if (!rec) { if (existsSync(daemonFilePath(stateDir))) removeDaemonFile(stateDir); return null; }
    if (!pidAlive(rec.pid)) { removeDaemonFile(stateDir); return null; }
    if (rec.port !== null) {
      if (rec.instance) {
        // Ours only when the port answers as the recorded instance: a reused pid plus some other daemon on
        // that port must not pass.
        const id = await identify(host, rec.port);
        if (id && id.instance === rec.instance) return { pid: rec.pid, port: rec.port };
      } else if ((await legacyHealthPid(host, rec.port)) === rec.pid) {
        // A record from before /id: only its own /health, carrying the recorded pid, proves it (Codex audit 2).
        return { pid: rec.pid, port: rec.port, legacy: true };
      }
    }
    if (Date.now() >= deadline) { removeDaemonFile(stateDir); return null; }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The first candidate a listener can bind on `host`, by trying each. */
export async function pickPort(candidates: readonly number[], host: string): Promise<{ port: number; index: number }> {
  for (let index = 0; index < candidates.length; index++) {
    const port = candidates[index]!;
    if (await portFree(port, host)) return { port, index };
  }
  throw new AllPortsTakenError(candidates, host);
}

export function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

/**
 * Read-only lookup for clients (the MCP relay, the CLI): the record's port when
 * it answers as the daemon, else the first candidate that does, else null.
 * Never removes a record: only a starter decides what is stale.
 */
export async function locateDaemon(stateDir: string, host: string, candidates: readonly number[], timeoutMs = 300): Promise<number | null> {
  const rec = readDaemonRecord(stateDir);
  if (rec && rec.port !== null && pidAlive(rec.pid) && (await identify(host, rec.port, timeoutMs))) return rec.port;
  for (const port of candidates) if (await identify(host, port, timeoutMs)) return port;
  return null;
}
