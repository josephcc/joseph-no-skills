// The pending drawer: everything staged, with an undo per line.
//
// The browser writes only inbox.jsonl, so this is the whole of what the researcher has
// said and the agent has not yet applied. Undo before hand-off deletes the line; after
// `apply` it would be a new operation, which is why the drawer says who staged what.
import { describe, isThread } from './ops';
import type { Op } from './types';

export function PendingDrawer({ ops, onUndo, onClose, applyHint }: {
  ops: Op[];
  onUndo: (id: string) => void;
  onClose: () => void;
  applyHint: string;
}) {
  const actionable = ops.filter((o) => !isThread(o));
  const threads = ops.filter((o) => o.op === 'comment');
  return (
    <aside className="wb-drawer">
      <header>
        <b>Staged for the agent</b>
        <button className="wb-btn wb-btn-ghost" onClick={onClose}>
          Close
        </button>
      </header>
      {actionable.length === 0 && threads.length === 0 && (
        <p className="wb-muted">
          Nothing staged. Dispute a coding, accept a code, or move a card, and it lands here as one typed operation.
        </p>
      )}
      {actionable.length > 0 && (
        <>
          <ul className="wb-drawer-list">
            {actionable.map((o) => (
              <li key={o.id} className={o.status === 'failed' || o.status === 'stalled' ? 'wb-op-failed' : undefined}>
                <span className="wb-op-id">{o.id}</span>
                <span className="wb-op-text">{describe(o)}</span>
                <span className={`wb-op-by wb-by-${o.by}`}>{o.by}</span>
                {o.error && <span className="wb-op-error">{o.error}</span>}
                <button className="wb-btn wb-btn-ghost wb-op-undo" title="Remove this staged operation" onClick={() => onUndo(o.id)}>
                  undo
                </button>
              </li>
            ))}
          </ul>
          <p className="wb-muted wb-apply-hint">
            Nothing is applied until you hand the pass back. Then the agent runs:
            <code>{applyHint}</code>
          </p>
        </>
      )}
      {threads.length > 0 && (
        <>
          <h4>Threads ({threads.length})</h4>
          <ul className="wb-drawer-list">
            {threads.map((o) => (
              <li key={o.id}>
                <span className="wb-op-id">{o.id}</span>
                <span className="wb-op-text">{describe(o)}</span>
              </li>
            ))}
          </ul>
          <p className="wb-muted">A thread is a conversation, not an edit: the agent replies, and you resolve it.</p>
        </>
      )}
    </aside>
  );
}
