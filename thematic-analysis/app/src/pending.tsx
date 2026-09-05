// The pending drawer: what waits for the agent, with an undo per line.
//
// The researcher's own gestures do not wait — they are carried out at once and recorded in
// the applied log — so what is here is the agent's proposals (accepted by leaving them,
// rejected by undoing them) and the threads. Undo deletes the line; after `apply` a change
// of mind is a new operation, which is why the drawer says who staged what.
import { describe, isThread } from './ops';
import type { Op } from './types';

/** A thread row: opens the extract, code or theme the comment is about, and resolves it in place.
 *  Resolving keeps the conversation in the record; it only takes it off this list. */
function ThreadRow({ o, replies, onOpen, onResolve }: { o: Op; replies: number; onOpen: (o: Op) => void; onResolve: (id: string) => void }) {
  return (
    <li className="wb-op-row">
      <button className="wb-op-open" onClick={() => onOpen(o)} title="open what this thread is about">
        <span className="wb-op-id">{o.id}</span>
        <span className="wb-op-text">{describe(o)}</span>
      </button>
      <span className={`wb-op-by wb-by-${o.by}`}>{o.by}</span>
      {replies > 0 && (
        <span className="wb-muted">
          {replies} repl{replies === 1 ? 'y' : 'ies'}
        </span>
      )}
      <button
        className="wb-btn wb-btn-ghost wb-op-undo"
        title="Resolve this thread: it stays in the record and leaves the pending list"
        onClick={() => onResolve(o.id)}
      >
        ✓ resolve
      </button>
    </li>
  );
}

function Row({ o, onUndo, onAccept, onOpen }: { o: Op; onUndo: (id: string) => void; onAccept?: (id: string) => void; onOpen: (o: Op) => void }) {
  const proposal = o.by === 'agent';
  return (
    <li className={`${o.status === 'failed' || o.status === 'stalled' ? 'wb-op-failed' : ''} wb-op-row`}>
      <button className="wb-op-open" onClick={() => onOpen(o)} title="open what this operation is about">
        <span className="wb-op-id">{o.id}</span>
        <span className="wb-op-text">{describe(o)}</span>
      </button>
      <span className={`wb-op-by wb-by-${o.by}`}>{o.by}</span>
      {o.note && <span className="wb-op-note">{o.note}</span>}
      {o.error && <span className="wb-op-error">{o.error}</span>}
      {proposal && onAccept && (
        <button className="wb-btn wb-btn-primary wb-tiny" title="carry this out now, as your decision" onClick={() => onAccept(o.id)}>
          accept
        </button>
      )}
      <button
        className="wb-btn wb-btn-ghost wb-op-undo"
        title={proposal ? 'reject this proposal: it leaves the inbox and nothing changes' : 'Remove this staged operation'}
        onClick={() => onUndo(o.id)}
      >
        {proposal ? 'reject' : 'undo'}
      </button>
    </li>
  );
}

export function PendingDrawer({ ops, onUndo, onAccept, onAcceptAll, onOpen, onResolve, onClose, applyHint }: {
  ops: Op[];
  onUndo: (id: string) => void;
  /** Accept one proposal: carried out now as the researcher's decision. */
  onAccept: (id: string) => void;
  onAcceptAll: (ids: string[]) => void;
  /** Take the researcher to what the operation is about, so a proposal can be read in context. */
  onOpen: (o: Op) => void;
  /** Resolve a thread from the drawer, without hunting for its card. */
  onResolve: (id: string) => void;
  onClose: () => void;
  applyHint: string;
}) {
  const actionable = ops.filter((o) => !isThread(o));
  // What the agent proposed is the reviewing work; what the researcher staged is already decided.
  // Splitting them is the difference between a list and a queue.
  const proposals = actionable.filter((o) => o.by === 'agent');
  const mine = actionable.filter((o) => o.by !== 'agent');
  const threads = ops.filter((o) => o.op === 'comment');
  return (
    <aside className="wb-drawer">
      <header>
        <b>Waiting for the agent</b>
        <button className="wb-btn wb-btn-ghost" onClick={onClose}>
          Close
        </button>
      </header>
      {actionable.length === 0 && threads.length === 0 && (
        <p className="wb-muted">
          Nothing waiting. Your own edits apply as you make them; what waits here is the agent's proposals, and your threads.
        </p>
      )}
      {proposals.length > 0 && (
        <>
          <h4>
            Proposed by the agent <span className="wb-muted">({proposals.length}) — open each to see what it would change</span>
            <button
              className="wb-btn wb-btn-ghost wb-tiny wb-accept-all"
              title="carry out every proposal here, in order, as your decisions"
              onClick={() => onAcceptAll(proposals.filter((o) => o.status !== 'failed' && o.status !== 'stalled').map((o) => o.id))}
            >
              accept all
            </button>
          </h4>
          <ul className="wb-drawer-list">
            {proposals.map((o) => (
              <Row key={o.id} o={o} onUndo={onUndo} onAccept={onAccept} onOpen={onOpen} />
            ))}
          </ul>
          <p className="wb-muted wb-apply-hint">
            <b>accept</b> carries a proposal out now, as your decision; <b>reject</b> drops it. One you leave standing is applied when you
            hand the pass back and the agent runs:
            <code>{applyHint}</code>
          </p>
        </>
      )}
      {mine.length > 0 && (
        <>
          {proposals.length > 0 && <h4>Staged by you ({mine.length})</h4>}
          <ul className="wb-drawer-list">
            {mine.map((o) => (
              <Row key={o.id} o={o} onUndo={onUndo} onOpen={onOpen} />
            ))}
          </ul>
          <p className="wb-muted wb-apply-hint">
            These wait for the agent; it runs <code>{applyHint}</code> on the next pass.
          </p>
        </>
      )}
      {threads.length > 0 && (
        <>
          <h4>Threads ({threads.length})</h4>
          <ul className="wb-drawer-list">
            {threads.map((o) => (
              <ThreadRow
                key={o.id}
                o={o}
                replies={ops.filter((r) => r.op === 'reply' && r.target === o.id).length}
                onOpen={onOpen}
                onResolve={onResolve}
              />
            ))}
          </ul>
          <p className="wb-muted">
            A thread is a conversation, not an edit: the agent replies, and you resolve it, here or on the card it opens.
          </p>
        </>
      )}
    </aside>
  );
}
