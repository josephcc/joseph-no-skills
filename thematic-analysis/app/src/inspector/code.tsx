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
import type { Code, Dupe } from '../types';
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
          stage the rewording
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={() => setEditing(false)}>
          cancel
        </button>
        <CommentComposer label="ask instead" onSubmit={(text) => (onComment(text), setEditing(false))} />
      </div>
      <p className="wb-muted">
        The operation carries the text you edited against, so if the agent reworded it meanwhile, `apply` refuses rather than overwrites.
      </p>
    </div>
  );
}

export function CodeInspector({ code, codes, dupes, wb, N, onCompare, onSplit, onJumpToTheme }: {
  code: Code;
  codes: Code[];
  dupes: Dupe[];
  wb: Workbench;
  N: number;
  onCompare: (other: string) => void;
  onSplit: () => void;
  onJumpToTheme?: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [mergeTo, setMergeTo] = useState('');
  const tops = codes.filter((c) => !c.parent && c.id !== code.id && (c.status === 'accepted' || c.status === 'candidate'));
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
            disabled={code.extracts > 0 || kids.length > 0}
            title={
              code.extracts > 0
                ? `${code.id} still codes ${code.extracts} extract(s); merge it or recode them first`
                : kids.length > 0
                  ? 'it still has live children'
                  : 'retire this code'
            }
            onClick={() => wb.stage(draft('code-status', code.id, { status: 'retired' }))}
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
                stage
              </button>
              <button className="wb-btn wb-btn-ghost" onClick={() => setRenaming(null)}>
                cancel
              </button>
            </span>
          )}
        </div>
        <div className="wb-actions wb-wrap">
          <select className="wb-select" value={mergeTo} onChange={(e) => setMergeTo(e.target.value)}>
            <option value="">merge into / make a child of…</option>
            {tops.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
          <button
            className="wb-btn wb-btn-ghost"
            disabled={!mergeTo}
            onClick={() => (wb.stage(draft('merge-code', code.id, { into: mergeTo })), setMergeTo(''))}
          >
            merge
          </button>
          <button
            className="wb-btn wb-btn-ghost"
            disabled={!mergeTo || !!code.parent}
            onClick={() => (wb.stage(draft('reparent', code.id, { parent: mergeTo })), setMergeTo(''))}
          >
            make a child
          </button>
        </div>
      </div>

      {themesWithIt.length > 0 && (
        <p className="wb-muted">
          in{' '}
          {themesWithIt.map((t) => (
            <button key={t.id} className="wb-btn wb-btn-ghost wb-tiny" onClick={() => onJumpToTheme?.(t.id)}>
              {t.id}
            </button>
          ))}
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
