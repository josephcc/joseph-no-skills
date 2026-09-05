// The inspector for an extract that has been staged but not applied.
//
// It exists because the alternative was a dead click: you code a passage, the span appears,
// you click it to check what you tagged it with, and nothing happens. A staged extract has
// no record in `extracts.jsonl` yet, so there is nothing for the normal inspector to show —
// but there is plenty to say, and exactly one thing to do about it.
import { useState } from 'react';
import { Md } from '../md';
import { KIND_GLYPH, familyIndex } from '../codes';
import { CommentComposer, ThreadCard, threadsFor } from '../threads';
import type { Code, Op } from '../types';
import type { Workbench } from '../store';

export interface StagedExtract {
  id: string;
  op: string;
  start: number;
  end: number;
  codes: string[];
  kind: string;
}

export function StagedInspector({ staged, text, codes, allCodes, transcriptId, line, op, wb, onAccept, onUndo, onClose }: {
  staged: StagedExtract;
  text: string;
  codes: Record<string, Code>;
  allCodes: Code[];
  transcriptId: string;
  line: number;
  op: Op | undefined;
  wb: Workbench;
  /** Accept the proposal: the extract is cut from the transcript now, as the researcher's decision. */
  onAccept: () => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const hues = familyIndex(allCodes);
  // Threads hang off the operation's id: the extract has no id of its own yet, and `apply`
  // retargets them to the real one once it exists.
  const threads = threadsFor(wb.inbox, staged.op);
  return (
    <div className="wb-inspector wb-inspector-staged">
      <header className="wb-insp-head">
        <span className="wb-staged">staged</span>
        <span className="wb-op-id">{staged.op}</span>
        <span className="wb-insp-who">
          {transcriptId}:{line} · {text.trim().split(/\s+/).length} words
        </span>
      </header>

      <p className="wb-muted wb-why-new">
        Not an extract yet: the agent proposed it. Accept it and the script cuts these words out of the transcript now and gives it an
        id; leave it and that happens on the next <code>apply</code>; reject it and nothing changes.
      </p>
      <div className="wb-actions">
        <button className="wb-btn wb-btn-primary" title="cut it from the transcript now, as your decision" onClick={() => (onAccept(), onClose())}>
          accept this extract
        </button>
      </div>

      <blockquote className="wb-insp-quote wb-insp-quote-staged">{text}</blockquote>

      <div className="wb-field">
        <label>kind</label>
        <p className="wb-staged-value">
          {KIND_GLYPH[staged.kind]} {staged.kind}
        </p>
      </div>

      <div className="wb-field">
        <label>codes</label>
        <div className="wb-tokens">
          {staged.codes.map((cid) => (
            <span key={cid} className="wb-token" style={{ ['--hue' as string]: hues[cid] ?? 0 }}>
              <span className="wb-token-id">{cid}</span>
            </span>
          ))}
        </div>
      </div>

      {staged.codes.map((cid) => {
        const c = codes[cid];
        if (!c) return null;
        return (
          <details key={cid} className="wb-def" open={staged.codes.length === 1}>
            <summary>
              <span className="wb-swatch" style={{ ['--hue' as string]: hues[cid] ?? 0 }} />
              <code>{cid}</code> {c.name}
            </summary>
            <Md source={c.definition || '_no definition yet_'} />
          </details>
        );
      })}

      {op?.note && (
        <p className="wb-muted">
          <b>note:</b> {op.note}
        </p>
      )}

      <div className="wb-field">
        <label>threads</label>
        {threads.map((th) => (
          <ThreadCard
            key={th.root.id}
            thread={th}
            onResolve={(id) => wb.thread(id, 'resolved')}
            onReopen={(id) => wb.thread(id, 'pending')}
            onReply={(id, text) => wb.reply(id, text)}
            onDelete={(id) => wb.deleteThread(id)}
          />
        ))}
        <CommentComposer
          label="ask about this, or propose a code"
          onSubmit={(text) => wb.stage({ op: 'comment', target: staged.op, args: { text }, view: 'transcript', by: 'user' })}
        />
        <p className="wb-muted">
          The codes on a staged extract cannot be edited, but this is where to say what you would rather it
          carried — including a code that does not exist yet. The agent reads it beside the passage.
        </p>
      </div>

      <div className="wb-field">
        <label>reject it</label>
        <p className="wb-muted">
          A proposal cannot be edited — reject it and code the passage yourself with the codes you want.
        </p>
        {confirming ? (
          <div className="wb-actions">
            <span className="wb-warn">Reject this proposed extract?</span>
            <button
              className="wb-btn wb-btn-danger"
              onClick={() => {
                onUndo();
                setConfirming(false);
                onClose();
              }}
            >
              Reject it
            </button>
            <button className="wb-btn wb-btn-ghost" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button className="wb-btn wb-btn-ghost" onClick={() => setConfirming(true)}>
            reject this proposed extract
          </button>
        )}
      </div>
    </div>
  );
}
