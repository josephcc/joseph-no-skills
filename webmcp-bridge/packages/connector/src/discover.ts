/**
 * Finding the daemon without a fixed port (plans/daemon-port-discovery/main.md D-4):
 * walk the candidate ports in order and take the first that answers `GET /id`
 * with the daemon's identity. A port that refuses, times out, or answers
 * anything else is a stranger and is skipped, so no WebSocket upgrade and no
 * approval prompt ever reaches a foreign service.
 */
import { CANDIDATE_PORTS, DAEMON_NAME, PROTOCOL_VERSION, type DaemonIdentity } from './protocol.ts';

export interface DiscoveredDaemon {
  port: number;
  httpBase: string;
  wsBase: string;
  identity: DaemonIdentity;
}

export interface DiscoverOptions {
  /** Default 127.0.0.1. */
  host?: string;
  /** The ports to walk, in order. Default CANDIDATE_PORTS. */
  candidates?: readonly number[];
  /** Per-port budget for `GET /id`. Default 300 ms. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const PROBE_TIMEOUT_MS = 300;

/** `GET /id` on one port: the daemon's identity, or null for no answer, a stranger, or a timeout. */
export async function identifyDaemon(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS, fetchImpl: typeof fetch = fetch): Promise<DaemonIdentity | null> {
  try {
    const r = await fetchImpl(`http://${host}:${port}/id`, { mode: 'cors', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const body = (await r.json()) as Partial<DaemonIdentity> | null;
    // Ours, and speaking our protocol: a daemon of another version on an earlier candidate is passed over.
    return body && body.daemon === DAEMON_NAME && body.protocol === PROTOCOL_VERSION ? (body as DaemonIdentity) : null;
  } catch {
    return null;
  }
}

/** The first candidate port that identifies as the daemon, in list order; null when none does. */
export async function discoverDaemon(options: DiscoverOptions = {}): Promise<DiscoveredDaemon | null> {
  const host = options.host ?? '127.0.0.1';
  const candidates = options.candidates ?? CANDIDATE_PORTS;
  for (const port of candidates) {
    const identity = await identifyDaemon(host, port, options.timeoutMs ?? PROBE_TIMEOUT_MS, options.fetchImpl ?? fetch);
    if (identity) return { port, httpBase: `http://${host}:${port}`, wsBase: `ws://${host}:${port}`, identity };
  }
  return null;
}
