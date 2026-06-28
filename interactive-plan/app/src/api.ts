// Thin client over the shared file-API daemon. Every call carries the plan's
// absolute path, so one server serves many plans (keyed by ?plan=<abs>).

export interface PlanPayload {
  path: string;
  content: string;
  hash: string;
}

// The plan path comes from the ?plan= URL param the launcher set.
export function planPathFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('plan');
}

export async function loadPlan(planPath: string): Promise<PlanPayload> {
  const r = await fetch(`/api/plan?path=${encodeURIComponent(planPath)}`);
  if (!r.ok) throw new Error(`load failed: ${r.status}`);
  return r.json();
}

export interface SaveResult {
  ok: boolean;
  conflict?: boolean;
  hash?: string;
  currentContent?: string;
  currentHash?: string;
}

export async function savePlan(planPath: string, content: string, baseHash: string): Promise<SaveResult> {
  const r = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: planPath, content, baseHash }),
  });
  if (r.status === 409) {
    const j = await r.json();
    return { ok: false, conflict: true, currentContent: j.currentContent, currentHash: j.currentHash };
  }
  if (!r.ok) throw new Error(`save failed: ${r.status}`);
  const j = await r.json();
  return { ok: true, hash: j.hash };
}

export async function openInEditor(ref: string, planPath: string): Promise<boolean> {
  const r = await fetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref, planPath }),
  });
  return r.ok;
}

// SSE: fires when this plan file changes on disk (D12 live-watch).
export function watchPlan(planPath: string, onChange: (p: { content: string; hash: string }) => void): () => void {
  const es = new EventSource(`/api/events?path=${encodeURIComponent(planPath)}`);
  es.addEventListener('change', (e) => {
    try {
      onChange(JSON.parse((e as MessageEvent).data));
    } catch {
      /* ignore */
    }
  });
  return () => es.close();
}
