// One place that owns the data: the bundle from ta.py, the pending inbox, and the calls that
// change things. Everything else in the app reads from here, so a gesture and a live reload
// move every view at once.
//
// Two kinds of gesture leave this file. A *thread* (a comment or a reply) is a conversation
// with the agent, so it is staged in the inbox for the agent to answer. Everything else the
// researcher does is a decision, and a decision is carried out at once: the daemon runs the
// same `ta.py` handler `apply` would use, under the same lock, and the applied log records it
// as theirs. The agent's proposals are the other thing in the inbox, and the only thing the
// researcher accepts (by leaving them) or rejects (by undoing them).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteThreadOp, execOp, loadBundle, loadCollate, loadTranscript, setThreadStatus, stageOp, undoOp, watch } from './api';
import type { Applied } from './api';
import type { Bundle, Collate, Op, TranscriptPayload } from './types';
import type { Draft } from './ops';
import { describe, isPending, isThread } from './ops';
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
  reload: () => Promise<void>;
  /** Carry out a gesture: a thread is staged for the agent; anything else is applied at once. */
  stage: (d: Draft) => Promise<Applied | null>;
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
  // Gestures the daemon is carrying out right now. They are drawn as if staged until the file
  // comes back changed, so a card lands where it was dropped without waiting for the round trip.
  const [inflight, setInflight] = useState<Op[]>([]);
  const timer = useRef<number | null>(null);
  const seq = useRef(0);
  // Gestures run one at a time, in the order they were made. A composite gesture (retire a code:
  // recode each extract, then retire) fires several in a row, and the script holds one lock —
  // unqueued they would race for it and half-apply.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const say = useCallback((msg: string | null) => {
    setToast(msg);
    if (timer.current) window.clearTimeout(timer.current);
    if (msg) timer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const reload = useCallback((): Promise<void> => {
    if (!dir) return Promise.resolve();
    return loadBundle(dir)
      .then((b) => {
        setBundle(b);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [dir]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live reload. A second tab on the same folder therefore sees this tab's gesture, and an
  // `apply` in the terminal refreshes every open view.
  useEffect(() => {
    if (!dir) return;
    return watch(dir, () => {
      setVersion((v) => v + 1);
      void reload();
    });
  }, [dir, reload]);

  const inbox = bundle?.inbox ?? [];
  const pending = useMemo(() => inbox.filter(isPending), [inbox]);
  const patch = useMemo(() => pendingPatch([...inbox, ...inflight], bundle?.extracts_all ?? []), [inbox, inflight, bundle?.extracts_all]);

  const stage = useCallback(
    async (d: Draft): Promise<Applied | null> => {
      if (!dir) return null;
      if (isThread(d) || d.by === 'agent') {
        try {
          const op = await stageOp(dir, d as unknown as Record<string, unknown>);
          // Show it at once; the SSE reload will confirm it from the file.
          setBundle((b) => (b ? { ...b, inbox: [...b.inbox, op] } : b));
          say(`Staged ${op.id}: ${describe(op)}`);
          return op;
        } catch (e) {
          say(`Could not stage that: ${(e as Error).message}`);
          return null;
        }
      }
      const temp: Op = {
        id: `inflight-${++seq.current}`,
        at: '',
        by: 'user',
        view: d.view ?? 'any',
        op: d.op,
        target: d.target ?? null,
        args: d.args ?? {},
        note: d.note ?? null,
        status: 'pending',
      };
      setInflight((l) => [...l, temp]);
      const run = async (): Promise<Applied | null> => {
        try {
          const { applied } = await execOp(dir, d as unknown as Record<string, unknown>);
          // Refetch before the placeholder goes, so a card never flickers back to where it was.
          await reload();
          setInflight((l) => l.filter((o) => o.id !== temp.id));
          const row = applied[0];
          say(row?.result ? `Applied: ${row.result}` : `Applied: ${describe(temp)}`);
          return row ?? null;
        } catch (e) {
          setInflight((l) => l.filter((o) => o.id !== temp.id));
          // The reason is the script's — a recode that would leave no codes, a definition that
          // moved — and it arrives now, not as a failed row found a pass later. Callers get
          // `null`, and must not announce success on it.
          say(`Could not apply that: ${(e as Error).message}`);
          return null;
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next;
      return next;
    },
    [dir, say, reload],
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
