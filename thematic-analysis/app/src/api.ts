// Thin client over the workbench daemon. Every call carries the analysis folder, so
// one daemon serves many studies (keyed by ?analysis=<abs>).
import type { Bundle, Collate, Op, TranscriptPayload } from './types';

export const param = (k: string): string | null => new URLSearchParams(window.location.search).get(k);
export const analysisDir = (): string | null => param('analysis');

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `${r.status}`);
  return r.json() as Promise<T>;
}

async function send<T>(method: string, url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `${r.status}`);
  return r.json() as Promise<T>;
}

const q = (dir: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ analysis: dir, ...extra }).toString();

export const loadBundle = (dir: string) => get<Bundle>(`/api/data?${q(dir)}`);
export const loadTranscript = (dir: string, t: string) => get<TranscriptPayload>(`/api/transcript?${q(dir, { t })}`);
export const loadCollate = (dir: string, target: string) => get<Collate>(`/api/collate?${q(dir, { target })}`);
export const loadMermaid = (dir: string) => get<{ mermaid: string }>(`/api/mermaid?${q(dir)}`);
export const loadAudit = (dir: string) =>
  get<{ validate: { errors: string[]; warnings: string[] }; verify: { checked: number; errors: string[]; warnings: string[] } }>(
    `/api/audit?${q(dir)}`,
  );

/** Stage one operation. The browser writes nothing else, ever. */
export const stageOp = (dir: string, op: Omit<Op, 'id' | 'at' | 'status'> | Record<string, unknown>) =>
  send<Op>('POST', '/api/inbox', { analysis: dir, op });
export const undoOp = (dir: string, id: string) => send<{ removed: string[] }>('DELETE', '/api/inbox', { analysis: dir, id });
/** Discard a whole thread — the root and every reply on it. Resolving keeps it; this does not. */
export const deleteThreadOp = (dir: string, id: string) =>
  send<{ removed: string[] }>('DELETE', '/api/inbox', { analysis: dir, id, withReplies: true });
export const setThreadStatus = (dir: string, id: string, status: 'resolved' | 'pending') =>
  send<Op>('PATCH', '/api/inbox', { analysis: dir, id, status });
export const openInEditor = (dir: string, t: string, line: number) =>
  send<{ ok: boolean }>('POST', '/api/open', { analysis: dir, t, line });

export const frameUrl = (dir: string, t: string, at: { file?: string; at?: string }) =>
  `/api/frame?${q(dir, { t, ...(at.file ? { file: at.file } : {}), ...(at.at ? { at: at.at } : {}) })}`;

/** Live reload: the daemon says which file moved; the page refetches what depends on it. */
export function watch(dir: string, onChange: (files: string[]) => void): () => void {
  const es = new EventSource(`/api/events?${q(dir)}`);
  es.addEventListener('change', (e) => {
    try {
      onChange((JSON.parse((e as MessageEvent).data) as { files: string[] }).files ?? []);
    } catch {
      onChange([]);
    }
  });
  return () => es.close();
}
