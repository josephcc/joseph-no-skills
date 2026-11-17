// The pending drawer: what waits for the agent, with an undo per line.
//
// The researcher's own gestures do not wait — they are carried out at once and recorded in
// the applied log — so what is here is the agent's proposals (accepted by leaving them,
// rejected by undoing them) and the threads. Undo deletes the line; after `apply` a change
// of mind is a new operation, which is why the drawer says who staged what.
import { describe, isThread } from './ops';
import { proposalArgs } from './inspector/proposed-theme';
import type { Op, ThemePreview } from './types';

/** A thread row: opens the extract, code or theme the comment is about, and resolves it in place.
 *  Resolving keeps the conversation in the record; it only takes it off this list. */
function ThreadRow({ o, replies, onOpen, onResolve }: { o: Op; replies: number; onOpen: (o: Op) => void; onResolve: (id: string) => void }) {
  return (
    <li className="wb-op-row">
      <button className="wb-op-open" onClick={() => onOpen(o)} title="open what this thread is about">
        <span className="wb-op-id">{o.id}</span>
        <span className="wb-op-text">{describe(o)}</span>
      </button>
      <span className="wb-op-meta">
        <span className={`wb-op-by wb-by-${o.by}`}>{o.by}</span>
        {replies > 0 && (
          <span className="wb-op-note">
            {replies} repl{replies === 1 ? 'y' : 'ies'}
          </span>
        )}
        <span className="wb-op-actions">
          <button
            className="wb-btn wb-btn-ghost wb-tiny"
            title="Resolve this thread: it stays in the record and leaves the pending list"
            onClick={() => onResolve(o.id)}
          >
            ✓ resolve
          </button>
        </span>
      </span>
    </li>
  );
}

function Row({ o, onUndo, onAccept, onOpen }: { o: Op; onUndo: (id: string) => void; onAccept?: (id: string) => void; onOpen: (o: Op) => void }) {
  const proposal = o.by === 'agent';
  return (
    <li className={`wb-op-row${o.status === 'failed' || o.status === 'stalled' ? ' wb-op-failed' : ''}`}>
      <button className="wb-op-open" onClick={() => onOpen(o)} title="open what this operation is about">
        <span className="wb-op-id">{o.id}</span>
        <span className="wb-op-text">{describe(o)}</span>
      </button>
      <span className="wb-op-meta">
        <span className={`wb-op-by wb-by-${o.by}`}>{o.by}</span>
        {o.note && <span className="wb-op-note">{o.note}</span>}
        <span className="wb-op-actions">
          {proposal && onAccept && (
            <button className="wb-btn wb-btn-primary wb-tiny" title="carry this out now, as your decision" onClick={() => onAccept(o.id)}>
              accept
            </button>
          )}
          <button
            className="wb-btn wb-btn-ghost wb-tiny"
            title={proposal ? 'reject this proposal: it leaves the inbox and nothing changes' : 'Remove this staged operation'}
            onClick={() => onUndo(o.id)}
          >
            {proposal ? 'reject' : 'undo'}
          </button>
        </span>
      </span>
      {o.error && <span className="wb-op-error">{o.error}</span>}
    </li>
  );
}

/** A proposed theme: the whole claim, its essence, and what it would gather and cover, with
 *  the script's numbers — enough to triage here, and a click away from the case itself. The
 *  one-line form hid the name past forty characters and said nothing else. */
function ThemeProposalRow({ o, preview, onUndo, onAccept, onOpen }: {
  o: Op;
  preview: ThemePreview | undefined;
  onUndo: (id: string) => void;
  onAccept: (id: string) => void;
  onOpen: (o: Op) => void;
}) {
  const a = proposalArgs(o);
  const k = preview?.codes.length ?? a.codes.length;
  const unknown = preview?.unknown.length ?? 0;
  const stuck = o.status === 'failed' || o.status === 'stalled' || unknown > 0;
  return (
    <li className={`wb-op-row wb-op-theme${o.status === 'failed' || o.status === 'stalled' ? ' wb-op-failed' : ''}`}>
      <button className="wb-op-open-block" onClick={() => onOpen(o)} title="open it on the Themes board: the story, the extracts, the codes it would gather">
        <span>
          <span className="wb-op-id">{o.id}</span> <span className="wb-muted">new theme</span>
          {a.rq && <span className="wb-col-rq">{a.rq}</span>}
        </span>
        <span className="wb-op-theme-name">{a.name || 'unnamed'}</span>
        {a.essence && <span className="wb-op-theme-essence">{a.essence}</span>}
        <span className="wb-op-theme-meta">
          {k ? `gathers ${k} code${k === 1 ? '' : 's'}` : 'names no codes'}
          {unknown ? ` (${unknown} unknown)` : ''}
          {preview && k ? ` · would cover ${preview.n}/${preview.N} participants · ${preview.extracts} extracts` : ''}
          {' · open it to read the case'}
        </span>
      </button>
      <span className="wb-op-meta">
        <span className={`wb-op-by wb-by-${o.by}`}>{o.by}</span>
        {o.note && <span className="wb-op-note">{o.note}</span>}
        <span className="wb-op-actions">
          <button className="wb-btn wb-btn-primary wb-tiny" disabled={stuck} title="create this theme now, with its codes, as your decision" onClick={() => onAccept(o.id)}>
            accept
          </button>
          <button className="wb-btn wb-btn-ghost wb-tiny" title="reject this proposal: it leaves the inbox and nothing changes" onClick={() => onUndo(o.id)}>
            reject
          </button>
        </span>
      </span>
      {o.error && <span className="wb-op-error">{o.error}</span>}
    </li>
  );
}

export function PendingDrawer({ ops, previews = {}, onUndo, onAccept, onAcceptAll, onOpen, onResolve, onClose, applyHint, onAskReview }: {
  ops: Op[];
  /** What each staged `new-theme` would be, by op id, as ta.py counted it. */
  previews?: Record<string, ThemePreview>;
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
  /** Hand the pass back without leaving the page: sends "review my feedback" to the embedded agent. */
  onAskReview?: () => void;
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
      {onAskReview && (
        <p className="wb-ask-review">
          <button className="wb-btn wb-btn-primary wb-tiny" onClick={onAskReview} title="Sends “review my feedback” to your local Claude in the Agent panel">
            Ask the agent to review my feedback
          </button>
          <span className="wb-muted">the same four commands, run from the panel instead of the terminal</span>
        </p>
      )}
      {actionable.length === 0 && threads.length === 0 && (
        <p className="wb-muted">
          Nothing waiting. Your own edits apply as you make them; what waits here is the agent's proposals, and your threads.
        </p>
      )}
      {proposals.length > 0 && (
        <>
          <h4>
            Proposed by the agent <span className="wb-muted">({proposals.length})</span>
            <button
              className="wb-btn wb-btn-ghost wb-tiny wb-accept-all"
              title="carry out every proposal here, in order, as your decisions"
              onClick={() => onAcceptAll(proposals.filter((o) => o.status !== 'failed' && o.status !== 'stalled').map((o) => o.id))}
            >
              accept all
            </button>
          </h4>
          <ul className="wb-drawer-list">
            {proposals.map((o) =>
              o.op === 'new-theme' ? (
                <ThemeProposalRow key={o.id} o={o} preview={previews[o.id]} onUndo={onUndo} onAccept={onAccept} onOpen={onOpen} />
              ) : (
                <Row key={o.id} o={o} onUndo={onUndo} onAccept={onAccept} onOpen={onOpen} />
              ),
            )}
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
