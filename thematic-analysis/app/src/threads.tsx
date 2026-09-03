// Comment threads on anything — an extract, a code, a theme, a coverage cell.
//
// Same shape as the plan viewer's cards, and the same asymmetry: either side writes a
// note, only the researcher resolves. A thread is where judgement goes when no typed
// operation would carry it.
import { useState } from 'react';
import { Md } from './md';
import type { Op } from './types';

export interface Thread {
  root: Op;
  replies: Op[];
}

export function threadsFor(inbox: Op[], target?: string): Thread[] {
  const roots = inbox.filter((o) => o.op === 'comment' && (target === undefined || o.target === target));
  return roots.map((root) => ({ root, replies: inbox.filter((o) => o.op === 'reply' && o.target === root.id) }));
}

export function ThreadCard({ thread, onResolve, onReopen, onReply, onDelete }: {
  thread: Thread;
  onResolve: (id: string) => void;
  onReopen: (id: string) => void;
  onReply?: (id: string, text: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [reply, setReply] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { root, replies } = thread;
  const resolved = root.status === 'resolved';
  return (
    <div className={`wb-thread ${resolved ? 'wb-thread-resolved' : ''}`}>
      <header>
        <span className="wb-op-id">{root.id}</span>
        {root.target && <span className="wb-thread-target">on {root.target}</span>}
        {resolved && <span className="wb-thread-tag">resolved by you</span>}
        {onDelete &&
          (confirmDelete ? (
            <span className="wb-del-confirm">
              Discard this thread?
              <button className="wb-btn wb-btn-danger wb-tiny" onClick={() => (onDelete(root.id), setConfirmDelete(false))}>
                Discard
              </button>
              <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button
              className="wb-thread-del"
              title="discard this thread and its replies — resolving keeps it, this does not"
              onClick={() => setConfirmDelete(true)}
            >
              🗑
            </button>
          ))}
      </header>
      <div className={`wb-note wb-by-${root.by}`}>
        <span className="wb-note-meta">
          {root.by} · {root.at}
        </span>
        <Md source={String((root.args as { text?: string }).text ?? '')} />
      </div>
      {replies.map((r) => (
        <div key={r.id} className={`wb-note wb-by-${r.by}`}>
          <span className="wb-note-meta">
            {r.by} · {r.at}
          </span>
          <Md source={String((r.args as { text?: string }).text ?? '')} />
        </div>
      ))}
      <div className="wb-thread-actions">
        {onReply && (
          <>
            <textarea
              className="wb-textarea"
              placeholder="Add to this thread…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <button
              className="wb-btn wb-btn-primary"
              disabled={!reply.trim()}
              onClick={() => {
                onReply(root.id, reply.trim());
                setReply('');
              }}
            >
              Add
            </button>
          </>
        )}
        {resolved ? (
          <button className="wb-btn wb-btn-ghost" onClick={() => onReopen(root.id)}>
            Reopen
          </button>
        ) : (
          <button className="wb-btn wb-btn-ghost" onClick={() => onResolve(root.id)}>
            ✓ Resolve
          </button>
        )}
      </div>
    </div>
  );
}

export function CommentComposer({ label, onSubmit }: { label: string; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="wb-btn wb-btn-ghost" onClick={() => setOpen(true)}>
        💬 {label}
      </button>
    );
  return (
    <div className="wb-composer">
      <textarea className="wb-textarea" autoFocus placeholder="What is the doubt?" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="wb-actions">
        <button
          className="wb-btn wb-btn-primary"
          disabled={!text.trim()}
          onClick={() => {
            onSubmit(text.trim());
            setText('');
            setOpen(false);
          }}
        >
          Leave the thread
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
