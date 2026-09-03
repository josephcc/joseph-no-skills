// The extract inspector: one passage, its verdict, and the rule it should satisfy.
//
// Every control here stages one typed operation. That is the whole point of the
// workbench: "should be `trust.stakes`, and the kind is `said` not `intent`" stops being
// prose the agent has to parse and becomes two operations it can apply.
import { useState } from 'react';
import { CodePicker } from '../codepicker';
import { FramePeek } from '../frames';
import { Md } from '../md';
import { KIND_GLYPH, familyIndex } from '../codes';
import { draft } from '../ops';
import { CommentComposer, ThreadCard, threadsFor } from '../threads';
import type { Code, Extract, FrameRow, Op, Kind } from '../types';
import type { Workbench } from '../store';

const KINDS: Kind[] = ['said', 'did', 'intent'];

export function ExtractInspector({
  dir, extract, codes, allCodes, wb, frames, transcriptId, onJumpToCode, onRetrim, retrimming, onOpenFrame, dropped, pending,
}: {
  dir: string;
  extract: Extract;
  codes: Record<string, Code>;
  allCodes: Code[];
  wb: Workbench;
  frames: FrameRow[];
  transcriptId: string;
  onJumpToCode: (id: string) => void;
  onRetrim: () => void;
  retrimming: boolean;
  onOpenFrame: (file: string) => void;
  dropped: boolean;
  pending: Op[];
}) {
  const [adding, setAdding] = useState(false);
  const [context, setContext] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [star, setStar] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const hues = familyIndex(allCodes);
  const threads = threadsFor(wb.inbox, extract.id);
  const stage = wb.stage;

  return (
    <div className={`wb-inspector ${dropped ? 'wb-dropped' : ''}`}>
      <header className="wb-insp-head">
        <span className="wb-op-id">{extract.id}</span>
        <span className="wb-insp-who">
          {extract.participant} · {extract.timestamp ?? '—'} · {extract.words} words
        </span>
        {extract.new && (
          <span className="wb-new" title={extract.reason ?? ''}>
            new
          </span>
        )}
        {pending.length > 0 && <span className="wb-staged">{pending.length} staged</span>}
      </header>

      {dropped && <p className="wb-warn">Staged to be dropped. Undo it in the pending drawer to keep it.</p>}
      {extract.reason && <p className="wb-muted wb-why-new">{extract.reason}</p>}

      <blockquote className="wb-insp-quote">{extract.text}</blockquote>

      <div className="wb-field">
        <label>kind</label>
        <div className="wb-seg">
          {KINDS.map((k, i) => (
            <button
              key={k}
              className={`wb-seg-btn ${extract.kind === k ? 'wb-seg-on' : ''}`}
              title={`${k} — press ${i + 1}`}
              onClick={() => stage(draft('set-kind', extract.id, { kind: k }))}
            >
              {KIND_GLYPH[k]} {k}
            </button>
          ))}
        </div>
      </div>
      <p className="wb-muted wb-kind-note">
        A modal verb is <b>intent</b>, not action. A finding about behaviour cannot rest on intent.
      </p>

      <div className="wb-field">
        <label>codes</label>
        <div className="wb-tokens">
          {extract.codes.map((cid) => (
            <span key={cid} className="wb-token" style={{ ['--hue' as string]: hues[cid] ?? 0 }}>
              <button className="wb-token-id" title="see every extract for this code" onClick={() => onJumpToCode(cid)}>
                {cid}
              </button>
              <button
                className="wb-token-x"
                title="remove this code"
                onClick={() => stage(draft('recode', extract.id, { remove: [cid] }))}
              >
                ×
              </button>
            </span>
          ))}
          {!adding && (
            <button className="wb-btn wb-btn-ghost wb-add-code" onClick={() => setAdding(true)} title="add a code (press /)">
              + code
            </button>
          )}
        </div>
        {adding && (
          <CodePicker
            codes={allCodes}
            exclude={extract.codes}
            onCancel={() => setAdding(false)}
            onPick={(id) => {
              stage(draft('recode', extract.id, { add: [id] }));
              setAdding(false);
            }}
          />
        )}
      </div>

      {extract.codes.map((cid) => {
        const c = codes[cid];
        if (!c) return null;
        return (
          <details key={cid} className="wb-def" open={extract.codes.length === 1}>
            <summary>
              <span className="wb-swatch" style={{ ['--hue' as string]: hues[cid] ?? 0 }} />
              <code>{cid}</code> {c.name}
              {c.status === 'candidate' && <span className="wb-cand" title="candidate code">◦</span>}
            </summary>
            <Md source={c.definition || '_no definition yet_'} />
            {c.include && (
              <p className="wb-muted">
                <b>include:</b> {c.include}
              </p>
            )}
            {c.exclude && (
              <p className="wb-muted">
                <b>exclude:</b> {c.exclude}
              </p>
            )}
          </details>
        );
      })}

      <div className="wb-field">
        <label>context</label>
        <textarea
          className="wb-textarea wb-small"
          placeholder="which condition, feature, or task this is about"
          value={context ?? extract.context ?? ''}
          onChange={(e) => setContext(e.target.value)}
          onBlur={() => {
            if (context !== null && context !== (extract.context ?? '')) stage(draft('set-context', extract.id, { context }));
            setContext(null);
          }}
        />
      </div>

      <div className="wb-field">
        <label>note</label>
        <textarea
          className="wb-textarea wb-small"
          placeholder="anything the codes do not carry"
          value={note ?? extract.note ?? ''}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== null && note !== (extract.note ?? '')) stage(draft('set-note', extract.id, { note }));
            setNote(null);
          }}
        />
      </div>

      {frames.length > 0 && (
        <div className="wb-field">
          <label>the screen as they spoke</label>
          <FramePeek dir={dir} t={transcriptId} frames={frames} ts={extract.timestamp} onOpen={onOpenFrame} inline />
          <p className="wb-muted">
            Hover any timestamp in the transcript for its frame; click for full screen. Nothing is verified for you.
          </p>
        </div>
      )}

      <div className="wb-field">
        <label>span</label>
        <button
          className={`wb-btn ${retrimming ? 'wb-btn-primary' : 'wb-btn-ghost'}`}
          onClick={onRetrim}
          title="select the words inside this turn, then re-trim"
        >
          {retrimming ? 'selecting the new boundary…' : 'adjust the boundary'}
        </button>
        <p className="wb-muted">
          {retrimming
            ? 'Now select the words to keep, inside this extract’s own turn. The button in the bar at the bottom stages it.'
            : 'Select the words in the turn and re-trim: the text is cut out of the transcript by the script, never retyped.'}
        </p>
      </div>

      <div className="wb-field">
        <label>paper-worthy</label>
        {extract.highlight ? (
          <p className="wb-star-on">
            ★ {extract.highlight}{' '}
            <button className="wb-btn wb-btn-ghost" onClick={() => stage(draft('highlight', extract.id, { reason: '' }))}>
              clear
            </button>
          </p>
        ) : star === null ? (
          <button className="wb-btn wb-btn-ghost" onClick={() => setStar('')} title="press s">
            ★ flag this quote
          </button>
        ) : (
          <div>
            <input
              className="wb-input"
              autoFocus
              placeholder="why it struck you"
              value={star}
              onChange={(e) => setStar(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && star.trim()) {
                  stage(draft('highlight', extract.id, { reason: star.trim() }));
                  setStar(null);
                }
                if (e.key === 'Escape') setStar(null);
              }}
            />
            <p className="wb-muted">Highlights surface above the per-theme selections in the quote bank.</p>
          </div>
        )}
      </div>

      {extract.hints && extract.hints.length > 0 && (
        <ul className="wb-hints">
          {extract.hints.map((h, i) => (
            <li key={i} className={`wb-hint wb-hint-${h.kind}`}>
              ⚠ {h.text}
            </li>
          ))}
        </ul>
      )}

      <div className="wb-field wb-row">
        {confirmDrop ? (
          <>
            <span className="wb-warn">Drop {extract.id}?</span>
            <button
              className="wb-btn wb-btn-danger"
              onClick={() => {
                stage(draft('drop', extract.id, {}, 'dropped in the transcript review'));
                setConfirmDrop(false);
              }}
            >
              Drop it
            </button>
            <button className="wb-btn wb-btn-ghost" onClick={() => setConfirmDrop(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="wb-btn wb-btn-ghost" onClick={() => setConfirmDrop(true)} title="press x">
            drop this extract
          </button>
        )}
      </div>

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
          label="ask about this coding"
          onSubmit={(text) => stage({ op: 'comment', target: extract.id, args: { text }, view: 'transcript', by: 'user' })}
        />
      </div>
    </div>
  );
}
