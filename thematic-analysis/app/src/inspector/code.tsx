// The code inspector: the rule, the argument for it, and the structural moves.
//
// A definition is editable in place (the edit carries the text it was made against, so
// the agent can refuse a stale one) or commentable when the wording needs judgement
// first. The agent's case for a candidate — why not an existing code, what else it
// considered — sits beside the definition rather than only in the round document.
import { useState } from 'react';
import { Md } from '../md';
import { KIND_GLYPH } from '../codes';
import { draft } from '../ops';
import { CommentComposer, ThreadCard, threadsFor } from '../threads';
import type { Code, Dupe, Extract } from '../types';
import type { Workbench } from '../store';

function EditableField({ label, value, onSave, onComment, multiline = true }: {
  label: string;
  value: string;
  onSave: (next: string, old: string) => void;
  onComment: (text: string) => void;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(value);
  if (!editing)
    return (
      <div className="wb-field">
        <label>
          {label}
          <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => (setD(value), setEditing(true))} title="reword this">
            ✎
          </button>
        </label>
        {value ? <Md source={value} /> : <p className="wb-muted">not written yet</p>}
      </div>
    );
  return (
    <div className="wb-field">
      <label>{label}</label>
      {multiline ? (
        <textarea className="wb-textarea" autoFocus value={d} onChange={(e) => setD(e.target.value)} />
      ) : (
        <input className="wb-input" autoFocus value={d} onChange={(e) => setD(e.target.value)} />
      )}
      <div className="wb-actions">
        <button
          className="wb-btn wb-btn-primary"
          disabled={d.trim() === value.trim()}
          onClick={() => {
            onSave(d.trim(), value);
            setEditing(false);
          }}
        >
          save the rewording
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={() => setEditing(false)}>
          cancel
        </button>
        <CommentComposer label="ask instead" onSubmit={(text) => (onComment(text), setEditing(false))} />
      </div>
      <p className="wb-muted">
        The edit carries the text you edited against, so if the agent reworded it meanwhile, the script refuses rather than overwrites.
      </p>
    </div>
  );
}

export function CodeInspector({ code, codes, dupes, wb, N, users, onCompare, onSplit, onJumpToTheme }: {
  code: Code;
  codes: Code[];
  dupes: Dupe[];
  wb: Workbench;
  N: number;
  /** the extracts actually carrying this code — what retiring it has to deal with */
  users: Extract[];
  onCompare: (other: string) => void;
  onSplit: () => void;
  onJumpToTheme?: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [mergeTo, setMergeTo] = useState('');
  const [alsoIn, setAlsoIn] = useState('');
  const [retiring, setRetiring] = useState(false);
  const [orphanPlan, setOrphanPlan] = useState<'drop' | ''>('');
  // A code already staged to be merged away or retired is not a legal target: staging a merge
  // into it builds a cycle the researcher never decided, and `apply` would settle it by inbox
  // order — first op wins, second fails with "target is merged".
  const goingAway = (id: string) => {
    const patch = wb.patch.codes[id];
    return !!patch?.mergedInto || patch?.status === 'retired';
  };
  const tops = codes.filter(
    (c) => !c.parent && c.id !== code.id && (c.status === 'accepted' || c.status === 'candidate') && !goingAway(c.id),
  );
  // ...and a code that is itself on its way out cannot take a merge or a reparent either.
  const leaving = goingAway(code.id);

  // Why "make a child" may be refused. The rule is *not* "this code already has a parent" — a
  // childless child moves between parents freely, and the tree's drag already allows it. It is
  // the two-level ceiling (a code with children cannot go under another) and an id collision at
  // the destination, which is what `op_reparent` actually enforces.
  const orphans = users.filter((e) => (e.codes ?? []).length <= 1);
  const myKids = codes.filter((c) => c.parent === code.id).map((c) => c.id);
  const childBase = code.id.includes('.') ? code.id.slice(code.id.indexOf('.') + 1) : code.id;
  const collidesWith = mergeTo && codes.some((c) => c.id === `${mergeTo}.${childBase}`) ? `${mergeTo}.${childBase}` : null;
  const childBlocked = leaving
    ? 'this code is staged to be folded away'
    : myKids.length
      ? `it has child code(s) ${myKids.join(', ')} — moving it under another code would make three levels`
      : collidesWith
        ? `${collidesWith} already exists; rename one of them first, or merge instead`
        : code.parent === mergeTo
          ? `already a child of ${mergeTo}`
          : null;
  const kids = codes.filter((c) => c.parent === code.id && c.status !== 'merged' && c.status !== 'retired');
  const neighbours = dupes.filter((d) => d.a === code.id || d.b === code.id);
  const threads = threadsFor(wb.inbox, code.id);
  const childTotal = code.child_extracts;
  const themesWithIt = (wb.bundle?.themes ?? []).filter((t) => t.codes.includes(code.id));

  return (
    <div className="wb-inspector">
      <header className="wb-insp-head">
        <code className="wb-insp-id">{code.id}</code>
        <span className={`wb-status wb-status-${code.status}`}>{code.status}</span>
        {!code.reviewed && <span className="wb-new">never reviewed</span>}
      </header>
      <p className="wb-insp-num">
        {code.n}/{N} participants · {code.extracts} extracts
        {kids.length > 0 && ` (${code.direct_extracts} on the parent itself, ${childTotal} on its ${kids.length} child${kids.length > 1 ? 'ren' : ''})`}
        {' · '}
        {(['said', 'did', 'intent'] as const).map((k) => `${KIND_GLYPH[k]}${code.kinds[k]}`).join(' ')}
      </p>
      {kids.length > 0 && code.direct_extracts > childTotal && (
        <p className="wb-warn">
          The parent carries more than its children put together. That usually means a child is hiding inside it.
        </p>
      )}

      <EditableField
        label="name"
        value={code.name}
        multiline={false}
        onSave={(v, old) => wb.stage(draft('set-field', code.id, { field: 'name', value: v, old }))}
        onComment={(text) => wb.stage({ op: 'comment', target: code.id, args: { text }, view: 'codebook', by: 'user' })}
      />
      <EditableField
        label="definition — the rule a second coder would apply"
        value={code.definition}
        onSave={(v, old) => wb.stage(draft('set-field', code.id, { field: 'definition', value: v, old }))}
        onComment={(text) => wb.stage({ op: 'comment', target: code.id, args: { text }, view: 'codebook', by: 'user' })}
      />
      <EditableField
        label="include"
        value={code.include}
        onSave={(v, old) => wb.stage(draft('set-field', code.id, { field: 'include', value: v, old }))}
        onComment={(text) => wb.stage({ op: 'comment', target: code.id, args: { text }, view: 'codebook', by: 'user' })}
      />
      <EditableField
        label="exclude"
        value={code.exclude}
        onSave={(v, old) => wb.stage(draft('set-field', code.id, { field: 'exclude', value: v, old }))}
        onComment={(text) => wb.stage({ op: 'comment', target: code.id, args: { text }, view: 'codebook', by: 'user' })}
      />

      {code.proposal && (
        <div className="wb-proposal">
          <h4>The agent's case for this code</h4>
          {code.proposal.why && <Md source={code.proposal.why} />}
          {code.proposal.alternatives && (
            <p className="wb-muted">
              <b>alternatives considered:</b> {code.proposal.alternatives}
            </p>
          )}
          {code.proposal.borderline?.length ? (
            <p className="wb-muted">
              <b>borderline:</b> {code.proposal.borderline.join(', ')}
            </p>
          ) : null}
          {code.proposal.round && <p className="wb-muted">proposed in round {String(code.proposal.round)}</p>}
        </div>
      )}

      {neighbours.length > 0 && (
        <div className="wb-field">
          <label>neighbours worth a look</label>
          <ul className="wb-neighbours">
            {neighbours.map((d, i) => {
              const other = d.a === code.id ? d.b : d.a;
              return (
                <li key={i}>
                  <code>{other}</code> <span className="wb-muted">{d.text}</span>
                  <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => onCompare(other)}>
                    compare
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="wb-field">
        <label>decide</label>
        <div className="wb-actions wb-wrap">
          {code.status === 'candidate' && (
            <button className="wb-btn wb-btn-primary" onClick={() => wb.stage(draft('code-status', code.id, { status: 'accepted' }))}>
              accept into the codebook
            </button>
          )}
          {code.status === 'accepted' && (
            <button className="wb-btn wb-btn-ghost" onClick={() => wb.stage(draft('code-status', code.id, { status: 'candidate' }))}>
              back to candidate
            </button>
          )}
          <button
            className="wb-btn wb-btn-ghost"
            disabled={kids.length > 0}
            title={kids.length > 0 ? 'it still has live child code(s); move or retire those first' : 'retire this code'}
            onClick={() => (users.length === 0 ? wb.stage(draft('code-status', code.id, { status: 'retired' })) : setRetiring(true))}
          >
            retire
          </button>
          <button className="wb-btn wb-btn-ghost" onClick={onSplit}>
            split a child out
          </button>
          {code.parent ? (
            <button className="wb-btn wb-btn-ghost" onClick={() => wb.stage(draft('reparent', code.id, { parent: null }))}>
              promote to top level
            </button>
          ) : null}
          {renaming === null ? (
            <button className="wb-btn wb-btn-ghost" onClick={() => setRenaming(code.id)}>
              rename
            </button>
          ) : (
            <span className="wb-inline-form">
              <input className="wb-input" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
              <button
                className="wb-btn wb-btn-primary"
                disabled={!renaming.trim() || renaming === code.id}
                onClick={() => {
                  wb.stage(draft('rename-code', code.id, { new_id: renaming.trim() }));
                  setRenaming(null);
                }}
              >
                rename
              </button>
              <button className="wb-btn wb-btn-ghost" onClick={() => setRenaming(null)}>
                cancel
              </button>
            </span>
          )}
        </div>
        {retiring && users.length > 0 && (
          <div className="wb-retire">
            {/* Retiring a code that still labels passages would orphan them, so the question is
                never "may I retire this" but "where do its extracts go". Most survive untouched
                because they carry another code; only the ones carrying this code alone need a
                decision, and that decision is the researcher's. */}
            <label>retire {code.id}</label>
            <p className="wb-muted">
              {users.length} extract(s) carry it. Retiring recodes each of them and then retires the code, at once — one
              operation each in the log.
            </p>
            <ul className="wb-retire-list">
              {users.map((e) => {
                const alone = (e.codes ?? []).length <= 1;
                return (
                  <li key={e.id} className={alone ? 'wb-retire-alone' : ''}>
                    <code>{e.id}</code> <span className="wb-muted">{e.participant}</span>{' '}
                    {alone ? (
                      <span className="wb-warn">carries only this code</span>
                    ) : (
                      <span className="wb-muted">
                        keeps {(e.codes ?? []).filter((c) => c !== code.id).join(', ')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {orphans.length > 0 && (
              <div className="wb-field">
                <label>{orphans.length} would be left with no code</label>
                <div className="wb-actions wb-wrap">
                  <button
                    className={`wb-btn ${orphanPlan === 'drop' ? 'wb-btn-primary' : 'wb-btn-ghost'}`}
                    onClick={() => setOrphanPlan(orphanPlan === 'drop' ? '' : 'drop')}
                  >
                    drop those extracts
                  </button>
                  <span className="wb-muted">
                    or close this, open each in its transcript, and give it another code first.
                  </span>
                </div>
              </div>
            )}
            <div className="wb-actions wb-wrap">
              <button
                className="wb-btn wb-btn-danger"
                disabled={orphans.length > 0 && orphanPlan !== 'drop'}
                onClick={() => {
                  for (const e of users) {
                    if ((e.codes ?? []).length <= 1) wb.stage(draft('drop', e.id, {}, `only code was ${code.id}, retired`));
                    else wb.stage(draft('recode', e.id, { remove: [code.id] }));
                  }
                  wb.stage(draft('code-status', code.id, { status: 'retired' }));
                  setRetiring(false);
                  setOrphanPlan('');
                }}
              >
                retire it, recoding those
              </button>
              <button
                className="wb-btn wb-btn-ghost"
                title="hand the judgement back: the agent rehomes or drops them and reports"
                onClick={() => {
                  wb.stage({
                    op: 'comment',
                    target: code.id,
                    args: {
                      text:
                        `Proposing we retire \`${code.id}\`. ${users.length} extract(s) carry it` +
                        (orphans.length
                          ? `, and ${orphans.map((e) => e.id).join(', ')} carr${orphans.length > 1 ? 'y' : 'ies'} no other code. ` +
                            'Find them a better home if one exists, drop them if the passage is not data, and come back to me on any that is a real judgement call.'
                          : ', all of which carry another code. Recode them and retire it.'),
                    },
                    view: 'codebook',
                    by: 'user',
                  });
                  setRetiring(false);
                  setOrphanPlan('');
                }}
              >
                propose it instead
              </button>
              <button className="wb-btn wb-btn-ghost" onClick={() => (setRetiring(false), setOrphanPlan(''))}>
                cancel
              </button>
            </div>
          </div>
        )}

        <div className="wb-move">
          <label>move or fold this code</label>
          {leaving ? (
            <p className="wb-warn">
              The agent has proposed folding this code away. Undo that proposal in the pending drawer before moving it anywhere else.
            </p>
          ) : (
            <>
              <select
                className="wb-select"
                value={mergeTo}
                onChange={(e) => setMergeTo(e.target.value)}
                aria-label="destination code"
              >
                <option value="">pick a destination…</option>
                {tops.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}
                  </option>
                ))}
              </select>
              {/* Two verbs, one destination — and they are not variations of each other: one
                  destroys a code, the other moves it. Spelling out the consequence with the real
                  ids and counts is the whole point; a person should not have to remember which
                  button discards a definition. */}
              <div className="wb-move-opt">
                <button
                  className="wb-btn wb-btn-ghost"
                  disabled={!mergeTo}
                  onClick={() => (wb.stage(draft('merge-code', code.id, { into: mergeTo })), setMergeTo(''))}
                >
                  fold into {mergeTo || '…'}
                </button>
                <p className="wb-muted">
                  {mergeTo ? (
                    <>
                      <code>{code.id}</code> stops existing. Its {code.direct_extracts} extract(s) are recoded to{' '}
                      <code>{mergeTo}</code>, and <b>{mergeTo}&rsquo;s definition governs them</b> — this code&rsquo;s
                      definition is not carried over.
                    </>
                  ) : (
                    'Folds this code away: its extracts move, its definition does not.'
                  )}
                </p>
              </div>
              <div className="wb-move-opt">
                <button
                  className="wb-btn wb-btn-ghost"
                  disabled={!mergeTo || !!childBlocked}
                  onClick={() => (wb.stage(draft('reparent', code.id, { parent: mergeTo })), setMergeTo(''))}
                >
                  make a child of {mergeTo || '…'}
                </button>
                <p className={childBlocked && mergeTo ? 'wb-warn' : 'wb-muted'}>
                  {childBlocked && mergeTo ? (
                    <>Cannot: {childBlocked}.</>
                  ) : mergeTo ? (
                    <>
                      Keeps its definition and its {code.direct_extracts} extract(s); its id becomes{' '}
                      <code>
                        {mergeTo}.{childBase}
                      </code>
                      . The same move as dragging it onto <code>{mergeTo}</code> in the tree.
                    </>
                  ) : (
                    'Moves this code under another, keeping its definition. Dragging it in the tree does the same.'
                  )}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="wb-field">
        <label>themes</label>
        <p className="wb-muted">
          {themesWithIt.length > 0 ? 'in ' : 'in no theme yet '}
          {themesWithIt.map((t) => (
            <button key={t.id} className="wb-btn wb-btn-ghost wb-tiny" onClick={() => onJumpToTheme?.(t.id)}>
              {t.id}
            </button>
          ))}
        </p>
        {/* A code may sit in several themes; its extracts then count toward each, and the board
            says so on the card. This is the same move as ⌥-dropping the card on the board. */}
        <div className="wb-actions wb-wrap">
          <select className="wb-select" value={alsoIn} onChange={(e) => setAlsoIn(e.target.value)} aria-label="place in another theme too">
            <option value="">{themesWithIt.length ? 'place here too…' : 'place in…'}</option>
            {(wb.bundle?.themes ?? [])
              .filter((t) => t.status !== 'merged' && t.status !== 'dropped' && !t.codes.includes(code.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.name}
                </option>
              ))}
          </select>
          <button
            className="wb-btn wb-btn-ghost"
            disabled={!alsoIn}
            title={alsoIn ? `${code.id} joins ${alsoIn} and stays where it is; its extracts count toward each` : 'pick a theme'}
            onClick={() => {
              wb.stage(draft('assign-theme', code.id, { theme: alsoIn, add: true }));
              setAlsoIn('');
            }}
          >
            {themesWithIt.length ? 'place here too' : 'place it'}
          </button>
        </div>
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
          label="ask about this code"
          onSubmit={(text) => wb.stage({ op: 'comment', target: code.id, args: { text }, view: 'codebook', by: 'user' })}
        />
      </div>

      <p className="wb-muted wb-provenance">
        added in v{code.added?.version ?? '?'} {code.added?.date ? `on ${code.added.date}` : ''}
        {code.added?.source ? ` · ${code.added.source}` : ''}
        {code.redefined_version ? ` · reworded at v${code.redefined_version}` : ''}
      </p>
    </div>
  );
}
