// The inspector for a theme the agent proposed and that does not exist yet.
//
// A `new-theme` proposal used to be one truncated line in the drawer and a dead click on the
// board: the theme had no column, so there was nothing to open, and the case for it lived in
// a round document the drawer could only name. A proposal the researcher cannot read in place
// is one they cannot accept, so this pane shows the whole case: the name as a claim, the
// essence and the story, the codes it would gather with their numbers and definitions, what it
// would cover (counted by the script, never here), the extracts it was argued on and the one
// that complicates it — and exactly two things to do about it.
import { useState } from 'react';
import { Md } from '../md';
import { KIND_GLYPH, familyIndex } from '../codes';
import { CommentComposer, ThreadCard, threadsFor } from '../threads';
import type { Extract, Op, ThemePreview } from '../types';
import type { Workbench } from '../store';

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

/** The proposal's arguments as the agent staged them, each with a safe default. */
export function proposalArgs(op: Pick<Op, 'args'>) {
  const a = (op.args ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
  return {
    name: s('name'), rq: s('rq'), essence: s('essence'), story: s('story'), brief: s('brief'),
    codes: list(a.codes), examples: list(a.examples), tensions: list(a.tensions),
  };
}

function Quote({ e, tension, onJump }: { e: Extract; tension?: boolean; onJump: (e: Extract) => void }) {
  return (
    <blockquote className={`wb-insp-quote wb-insp-quote-staged ${tension ? 'wb-insp-quote-tension' : ''}`}>
      <p className="wb-quote-head">
        <button className="wb-op-id" onClick={() => onJump(e)} title="open it in the transcript">
          {e.id}
        </button>{' '}
        <span className="wb-cl-p">{e.participant}</span>
        {e.timestamp && <span className="wb-muted"> [{e.timestamp}]</span>}{' '}
        <span title={e.kind}>{KIND_GLYPH[e.kind]}</span>
        {e.highlight && <span title={e.highlight}> ★</span>}
      </p>
      {e.text}
    </blockquote>
  );
}

export function ProposedThemeInspector({ op, preview, wb, onJumpToExtract, onOpenCode, onAccepted, onRejected }: {
  op: Op;
  preview: ThemePreview | undefined;
  wb: Workbench;
  onJumpToExtract: (e: Extract) => void;
  onOpenCode: (cid: string) => void;
  /** The theme now exists under this id: open it. */
  onAccepted: (created: string) => void;
  onRejected: () => void;
}) {
  const b = wb.bundle!;
  const [confirming, setConfirming] = useState(false);
  const a = proposalArgs(op);
  const hues = familyIndex(b.codes);
  const codes = Object.fromEntries(b.codes.map((c) => [c.id, c]));
  const byId = new Map(b.extracts_all.map((e) => [e.id, e]));
  const rq = b.research_questions.find((r) => r.id === a.rq);
  const ids = preview?.codes ?? a.codes.filter((c) => codes[c]);
  const unknown = preview?.unknown ?? a.codes.filter((c) => !codes[c]);
  // Where a code already sits, so what accepting would count twice is visible before the click.
  const placedIn = (cid: string) =>
    b.themes.filter((t) => t.status !== 'merged' && t.status !== 'dropped' && t.codes.includes(cid)).map((t) => t.id);
  const examples = a.examples.map((id) => byId.get(id)).filter((e): e is Extract => !!e);
  const tensions = a.tensions.map((id) => byId.get(id)).filter((e): e is Extract => !!e);
  // A proposal that names no extracts is still argued on something: the ★ ones it would gather stand in.
  const fam = new Set(preview?.family ?? ids);
  const fallback = examples.length ? [] : b.extracts_all.filter((e) => e.highlight && e.codes.some((c) => fam.has(c))).slice(0, 2);
  const threads = threadsFor(wb.inbox, op.id);
  const stuck = op.status === 'failed' || op.status === 'stalled' || unknown.length > 0;
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
  return (
    <div className="wb-inspector wb-inspector-staged">
      <header className="wb-insp-head">
        <span className="wb-staged">proposed</span>
        <span className="wb-op-id">{op.id}</span>
        <span className="wb-insp-who">new theme · by the agent · {op.at}</span>
      </header>
      {op.error && <p className="wb-op-error">{op.error}</p>}

      <p className="wb-muted wb-why-new">
        Not a theme yet: the agent proposed it. Accept it and the script creates the theme now, with these codes placed in it, as your
        decision; reject it and nothing changes; leave it and it is applied when you hand the pass back.
      </p>
      <div className="wb-actions">
        <button
          className="wb-btn wb-btn-primary"
          disabled={stuck}
          title={stuck ? 'this proposal cannot be applied as it stands' : 'create it now, with its codes, as your decision'}
          onClick={() =>
            void wb.accept(op.id).then((r) => {
              if (r && typeof r === 'object' && r.created) onAccepted(r.created);
            })
          }
        >
          accept this theme
        </button>
        {!confirming && (
          <button className="wb-btn wb-btn-ghost" onClick={() => setConfirming(true)}>
            reject
          </button>
        )}
      </div>
      {confirming && (
        <div className="wb-actions">
          <span className="wb-warn">Reject this proposed theme? It leaves the inbox; nothing else changes.</span>
          <button
            className="wb-btn wb-btn-danger"
            onClick={() => {
              void wb.undo(op.id);
              setConfirming(false);
              onRejected();
            }}
          >
            Reject it
          </button>
          <button className="wb-btn wb-btn-ghost" onClick={() => setConfirming(false)}>
            Keep it
          </button>
        </div>
      )}

      <h3 className="wb-proposal-name">{a.name || <span className="wb-muted">unnamed</span>}</h3>
      {a.rq && (
        <p className="wb-muted wb-proposal-rq">
          <b>{a.rq}</b>
          {rq ? ` · ${rq.text}` : ''}
        </p>
      )}

      <div className="wb-field">
        <label>essence</label>
        {a.essence ? <Md source={a.essence} /> : <p className="wb-muted">not written</p>}
      </div>
      {a.story && (
        <div className="wb-field">
          <label>the story</label>
          <Md source={a.story} />
        </div>
      )}
      {a.brief && (
        <div className="wb-field">
          <label>brief</label>
          <Md source={a.brief} />
        </div>
      )}

      <div className="wb-field">
        <label>codes it would gather</label>
        <p className="wb-muted wb-proposal-cover">
          {n(ids.length, 'code')}
          {preview ? ` · would cover ${preview.n}/${preview.N} participants${preview.participants.length ? ` (${preview.participants.join(', ')})` : ''} · ${n(preview.extracts, 'extract')}` : ''}
        </p>
        {(preview?.renamed ?? []).map((r) => (
          <p key={r.from} className="wb-muted wb-proposal-cover">
            <code>{r.from}</code> was merged into <code>{r.to}</code> since this was proposed; that is what it would gather.
          </p>
        ))}
        {ids.length === 0 && unknown.length === 0 && (
          <p className="wb-muted">
            The proposal names no codes. Ask the agent for them below, or accept the theme and drop the codes in yourself.
          </p>
        )}
        {ids.map((cid) => {
          const c = codes[cid];
          if (!c) return null;
          const also = placedIn(cid);
          return (
            <details key={cid} className="wb-def">
              <summary>
                <span className="wb-swatch" style={{ ['--hue' as string]: hues[cid] ?? 0 }} />
                <button
                  className="wb-op-id"
                  title="open this code"
                  onClick={(ev) => {
                    ev.preventDefault();
                    onOpenCode(cid);
                  }}
                >
                  {cid}
                </button>
                <span className="wb-def-name">{c.name}</span>
                <span className="wb-muted wb-def-n">
                  {c.n}/{b.N} · {c.extracts} ex · {(['said', 'did', 'intent'] as const).map((k) => `${KIND_GLYPH[k]}${c.kinds[k]}`).join(' ')}
                </span>
                {also.length > 0 && (
                  <span className="wb-warn-inline" title="already gathered by another theme; accepting adds it here as well, and its extracts then count toward each">
                    also in {also.join(', ')}
                  </span>
                )}
              </summary>
              <Md source={c.definition || '_no definition yet_'} />
            </details>
          );
        })}
        {unknown.map((cid) => (
          <p key={cid} className="wb-op-error">
            no code {cid} — it cannot be accepted until the agent fixes the proposal
          </p>
        ))}
      </div>

      {(examples.length > 0 || fallback.length > 0) && (
        <div className="wb-field">
          <label>{examples.length ? 'the extracts it was argued on' : 'two of the ★ extracts it would gather'}</label>
          {(examples.length ? examples : fallback).map((e) => (
            <Quote key={e.id} e={e} onJump={onJumpToExtract} />
          ))}
        </div>
      )}
      {tensions.length > 0 && (
        <div className="wb-field">
          <label>what complicates it</label>
          {tensions.map((e) => (
            <Quote key={e.id} e={e} tension onJump={onJumpToExtract} />
          ))}
        </div>
      )}
      {op.note && (
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
          label="ask about this theme, or say what it should claim or gather instead"
          onSubmit={(text) => wb.stage({ op: 'comment', target: op.id, args: { text }, view: 'themes', by: 'user' })}
        />
        <p className="wb-muted">
          A proposal cannot be edited: accept it and reshape it on the board, or say here what you would rather it claimed. The agent
          reads the thread beside the proposal, and it follows the theme once one exists.
        </p>
      </div>
    </div>
  );
}
