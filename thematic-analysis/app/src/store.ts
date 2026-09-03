// One place that owns the data: the bundle from ta.py, the pending inbox, and the
// staging calls. Everything else in the app reads from here, so a staged operation and
// a live reload move every view at once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteThreadOp, loadBundle, loadCollate, loadTranscript, setThreadStatus, stageOp, undoOp, watch } from './api';
import type { Bundle, Collate, Op, TranscriptPayload } from './types';
import type { Draft } from './ops';
import { describe, isPending } from './ops';
import { pendingPatch } from './overlay';

export interface Workbench {
  bundle: Bundle | null;
  error: string | null;
  version: number;
  pending: Op[];
  inbox: Op[];
  patch: ReturnType<typeof pendingPatch>;
  toast: string | null;
  say: (msg: string | null) => void;
  reload: () => void;
  stage: (d: Draft) => Promise<Op | null>;
  undo: (id: string) => Promise<void>;
  thread: (id: string, status: 'resolved' | 'pending') => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  reply: (threadId: string, text: string) => Promise<void>;
}

export function useWorkbench(dir: string | null): Workbench {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const say = useCallback((msg: string | null) => {
    setToast(msg);
    if (timer.current) window.clearTimeout(timer.current);
    if (msg) timer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const reload = useCallback(() => {
    if (!dir) return;
    loadBundle(dir)
      .then((b) => {
        setBundle(b);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [dir]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Live reload. A second tab on the same folder therefore sees this tab's staged op,
  // and an `apply` in the terminal refreshes every open view.
  useEffect(() => {
    if (!dir) return;
    return watch(dir, () => {
      setVersion((v) => v + 1);
      reload();
    });
  }, [dir, reload]);

  const inbox = bundle?.inbox ?? [];
  const pending = useMemo(() => inbox.filter(isPending), [inbox]);
  const patch = useMemo(() => pendingPatch(inbox, bundle?.extracts_all ?? []), [inbox, bundle?.extracts_all]);

  const stage = useCallback(
    async (d: Draft): Promise<Op | null> => {
      if (!dir) return null;
      try {
        const op = await stageOp(dir, d as unknown as Record<string, unknown>);
        // Show it at once; the SSE reload will confirm it from the file.
        setBundle((b) => (b ? { ...b, inbox: [...b.inbox, op] } : b));
        // Say so. A gesture that changes nothing visible — a merge, a new theme, a
        // re-trim — is indistinguishable from a broken button without this.
        say(`Staged ${op.id}: ${describe(op)}`);
        return op;
      } catch (e) {
        say(`Could not stage that: ${(e as Error).message}`);
        return null;
      }
    },
    [dir, say],
  );

  const undo = useCallback(
    async (id: string) => {
      if (!dir) return;
      try {
        await undoOp(dir, id);
        setBundle((b) => (b ? { ...b, inbox: b.inbox.filter((o) => o.id !== id) } : b));
      } catch (e) {
        say(`Could not undo ${id}: ${(e as Error).message}`);
      }
    },
    [dir, say],
  );

  const thread = useCallback(
    async (id: string, status: 'resolved' | 'pending') => {
      if (!dir) return;
      try {
        const row = await setThreadStatus(dir, id, status);
        setBundle((b) => (b ? { ...b, inbox: b.inbox.map((o) => (o.id === id ? row : o)) } : b));
      } catch (e) {
        say(`Could not update the thread: ${(e as Error).message}`);
      }
    },
    [dir, say],
  );

  // Distinct from resolving: resolve keeps the conversation as part of the record, this
  // throws it away. Sometimes a question turns out not to be worth asking.
  const deleteThread = useCallback(
    async (id: string) => {
      if (!dir) return;
      try {
        const { removed } = await deleteThreadOp(dir, id);
        const gone = new Set(removed);
        setBundle((b) => (b ? { ...b, inbox: b.inbox.filter((o) => !gone.has(o.id)) } : b));
        say(`Discarded the thread${removed.length > 1 ? ` and its ${removed.length - 1} repl${removed.length === 2 ? 'y' : 'ies'}` : ''}.`);
      } catch (e) {
        say(`Could not discard that thread: ${(e as Error).message}`);
      }
    },
    [dir, say],
  );

  const reply = useCallback(
    async (threadId: string, text: string) => {
      await stage({ op: 'reply', target: threadId, args: { text }, view: 'any', by: 'user' });
    },
    [stage],
  );

  return { bundle, error, version, pending, inbox, patch, toast, say, reload, stage, undo, thread, deleteThread, reply };
}

export function useTranscript(dir: string | null, tid: string | null, version: number) {
  const [payload, setPayload] = useState<TranscriptPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dir || !tid) {
      setPayload(null);
      return;
    }
    let live = true;
    loadTranscript(dir, tid)
      .then((p) => live && (setPayload(p), setError(null)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [dir, tid, version]);
  return { payload, error };
}

export function useCollate(dir: string | null, target: string | null, version: number) {
  const [collate, setCollate] = useState<Collate | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!dir || !target) {
      setCollate(null);
      return;
    }
    let live = true;
    loadCollate(dir, target)
      .then((c) => live && (setCollate(c), setError(null)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [dir, target, version]);
  return { collate, error };
}
