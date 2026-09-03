// The theme inspector: phases 4 and 5 in one pane.
//
// The essence carries Braun and Clarke's scope test — if it will not fit in two
// sentences the theme is doing too much — so the counter is in the label. The story is
// interpretation, not paraphrase. Tensions are a list rather than a field you remember
// to fill, because a pattern with no exceptions in twelve interviews is one you have not
// looked at hard enough.
import { useState } from 'react';
import { Md } from '../md';
import { KIND_GLYPH } from '../codes';
import { draft } from '../ops';
import { CommentComposer, ThreadCard, threadsFor } from '../threads';
import type { Extract, InPaper, Theme } from '../types';
import type { Workbench } from '../store';

const IN_PAPER: InPaper[] = ['undecided', 'headline', 'secondary', 'no'];
const sentences = (s: string) => (s.trim() ? s.trim().split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length : 0);

function Field({ label, value, hint, multiline, onSave, onComment }: {
  label: string;
  value: string;
  hint?: string;
  multiline?: boolean;
  onSave: (next: string, old: string) => void;
  onComment: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(value);
  if (!editing)
    return (
      <div className="wb-field">
        <label>
          {label}
          <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => (setD(value), setEditing(true))}>
            ✎
          </button>
        </label>
        {value ? <Md source={value} /> : <p className="wb-muted">not written yet</p>}
        {hint && <p className="wb-muted">{hint}</p>}
      </div>
    );
  return (
    <div className="wb-field">
      <label>{label}</label>
      {multiline ? (
        <textarea className="wb-textarea wb-tall" autoFocus value={d} onChange={(e) => setD(e.target.value)} />
      ) : (
        <input className="wb-input" autoFocus value={d} onChange={(e) => setD(e.target.value)} />
      )}
      {label.startsWith('essence') && (
        <p className={sentences(d) > 2 ? 'wb-warn' : 'wb-muted'}>
          {sentences(d)} sentence{sentences(d) === 1 ? '' : 's'} — the scope test is that it fits in a couple.
        </p>
      )}
      <div className="wb-actions">
        <button className="wb-btn wb-btn-primary" disabled={d.trim() === value.trim()} onClick={() => (onSave(d.trim(), value), setEditing(false))}>
          stage it
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={() => setEditing(false)}>
          cancel
        </button>
        <CommentComposer label="ask instead" onSubmit={(text) => (onComment(text), setEditing(false))} />
      </div>
    </div>
  );
}

export function ThemeInspector({ theme, extracts, wb, onJumpToExtract, rqs }: {
  theme: Theme & { pending?: boolean };
  extracts: Extract[];
  wb: Workbench;
  onJumpToExtract: (e: Extract) => void;
  rqs: { id: string; text: string }[];
}) {
  const comment = (text: string) => wb.stage({ op: 'comment', target: theme.id, args: { text }, view: 'themes', by: 'user' });
  const threads = threadsFor(wb.inbox, theme.id);
  const tension = new Set(theme.tensions);
  const kinds = extracts.reduce<Record<string, number>>((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {});
  return (
    <div className="wb-inspector">
      <header className="wb-insp-head">
        <span className="wb-op-id">{theme.id}</span>
        <span className={`wb-status wb-status-${theme.status}`}>{theme.status}</span>
        {theme.pending && <span className="wb-staged">staged</span>}
      </header>
      <p className="wb-insp-num">
        {theme.n}/{theme.N} participants · {theme.extracts} extracts · {theme.codes.length} code(s) ·{' '}
        {(['said', 'did', 'intent'] as const).map((k) => `${KIND_GLYPH[k]}${kinds[k] ?? 0}`).join(' ')}
      </p>
      {(kinds.did ?? 0) === 0 && (kinds.intent ?? 0) > 0 && (
        <p className="wb-warn">
          Nothing here is a <b>did</b>. A theme about behaviour cannot rest on intent; check whether this is a claim about attitudes.
        </p>
      )}

      <Field
        label="name — a claim, not a topic"
        value={theme.name}
        multiline={false}
        onSave={(v, old) => wb.stage(draft('set-theme-field', theme.id, { field: 'name', value: v, old }))}
        onComment={comment}
      />
      <Field
        label={`essence (${sentences(theme.essence)} sentence${sentences(theme.essence) === 1 ? '' : 's'})`}
        value={theme.essence}
        onSave={(v, old) => wb.stage(draft('set-theme-field', theme.id, { field: 'essence', value: v, old }))}
        onComment={comment}
        multiline
      />
      <Field
        label="story — what the pattern means, not what it says"
        value={theme.story}
        onSave={(v, old) => wb.stage(draft('set-theme-field', theme.id, { field: 'story', value: v, old }))}
        onComment={comment}
        multiline
      />

      <div className="wb-field">
        <label>answers</label>
        <select
          className="wb-select"
          value={theme.rq ?? ''}
          onChange={(e) => wb.stage(draft('set-theme-field', theme.id, { field: 'rq', value: e.target.value }))}
        >
          <option value="">—</option>
          {rqs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        {theme.rq && <p className="wb-muted">{rqs.find((r) => r.id === theme.rq)?.text}</p>}
      </div>

      <div className="wb-field">
        <label>in the paper</label>
        <div className="wb-seg">
          {IN_PAPER.map((v) => (
            <button
              key={v}
              className={`wb-seg-btn ${theme.in_paper === v ? 'wb-seg-on' : ''}`}
              onClick={() => wb.stage(draft('set-theme-field', theme.id, { field: 'in_paper', value: v }))}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-field">
        <label>tensions ({theme.tensions.length}) — the accounts that complicate it</label>
        {theme.tensions.length === 0 && (
          <p className="wb-muted">
            None yet. A theme that survives its exceptions is stronger, and the write-up needs them.
          </p>
        )}
        <ul className="wb-tension-list">
          {theme.tensions.map((eid) => {
            const e = extracts.find((x) => x.id === eid) ?? wb.bundle?.extracts_all.find((x) => x.id === eid);
            return (
              <li key={eid}>
                <button className="wb-op-id" onClick={() => e && onJumpToExtract(e)}>
                  {eid}
                </button>{' '}
                {e ? `${e.participant}: ${e.text.slice(0, 120)}${e.text.length > 120 ? '…' : ''}` : 'missing'}
                <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => wb.stage(draft('set-tension', theme.id, { remove: [eid] }))}>
                  remove
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="wb-field">
        <label>its extracts, by participant</label>
        <ul className="wb-theme-extracts">
          {extracts.map((e) => (
            <li key={e.id} className={tension.has(e.id) ? 'wb-is-tension' : ''}>
              <button className="wb-op-id" onClick={() => onJumpToExtract(e)}>
                {e.id}
              </button>
              <span className="wb-cl-p">{e.participant}</span>
              <span title={e.kind}>{KIND_GLYPH[e.kind]}</span>
              <span className="wb-cl-text">{e.text.slice(0, 160)}{e.text.length > 160 ? '…' : ''}</span>
              {!tension.has(e.id) && (
                <button
                  className="wb-btn wb-btn-ghost wb-tiny"
                  title="this one complicates the theme"
                  onClick={() => wb.stage(draft('set-tension', theme.id, { add: [e.id] }))}
                >
                  tension
                </button>
              )}
              {e.highlight && <span className="wb-echip-star" title={e.highlight}>★</span>}
            </li>
          ))}
        </ul>
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
        <CommentComposer label="ask about this theme" onSubmit={comment} />
      </div>
    </div>
  );
}
