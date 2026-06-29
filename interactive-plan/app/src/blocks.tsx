import { useState } from 'react';
import { Markdown } from './markdown';
import { anchoredCommentIds } from './parser';
import type { Block, CheckBlock, DecisionBlock, FindingBlock, QuestionBlock } from './types';

type CommentMeta = Record<string, { status: string; kind: string | null }>;

// Shared per-element comment affordance. With no thread it's a faint 💬 that opens
// the composer (anchoring a ◆ target to this element); with one or more it's a
// solid ◆ that activates the first thread (dimmed if all are resolved).
function CommentMarker({
  ids,
  commentMeta,
  onAdd,
  onActivate,
}: {
  ids: string[];
  commentMeta: CommentMeta;
  onAdd: (e: React.MouseEvent) => void;
  onActivate: (id: string) => void;
}) {
  if (ids.length === 0)
    return (
      <button
        type="button"
        className="ip-cmark ip-cmark-add"
        title="Comment"
        onClick={(e) => {
          e.stopPropagation();
          onAdd(e);
        }}
      >
        💬
      </button>
    );
  const anyOpen = ids.some((id) => commentMeta[id]?.status !== 'resolved');
  return (
    <button
      type="button"
      className={`ip-cmark ${anyOpen ? 'ip-cmark-open' : 'ip-cmark-resolved'}`}
      title="View comment"
      onClick={(e) => {
        e.stopPropagation();
        onActivate(ids[0]);
      }}
    >
      ◆{ids.length > 1 ? <sup>{ids.length}</sup> : null}
    </button>
  );
}

// Props every structured block takes so its rows can host a CommentMarker.
interface Commenting {
  commentMeta: CommentMeta;
  onAddComment: (block: Block, e: React.MouseEvent) => void;
  onActivateComment: (id: string) => void;
}

// ---------------- Check list ----------------

// A run of consecutive <check> tags, rendered as interactive checkbox rows.
// Toggling flips the block's `status` (todo↔done) through the normal block-edit
// path — id-addressed, no positional matching. Clicking the box toggles; the
// label stays plain text (not a <label>) so code-ref links remain clickable and
// selecting it doesn't toggle the box. Each row carries a CommentMarker that
// anchors a ◆ target to its label, so a check is commentable like any block.
export function CheckList({
  checks,
  commenting,
  onToggle,
}: {
  checks: CheckBlock[];
  commenting: Commenting;
  onToggle: (c: CheckBlock) => void;
}) {
  return (
    <div className="ip-checklist">
      {checks.map((c) => (
        <div key={c.id} className={`ip-check ip-check-${c.status}`} id={`block-${c.id}`}>
          <input
            type="checkbox"
            className="ip-check-box"
            checked={c.status === 'done'}
            onChange={() => onToggle(c)}
            aria-label={`Toggle: ${c.label.replace(/<[^>]+>/g, '').replace(/[#*`]/g, '').slice(0, 80)}`}
          />
          <div className="ip-check-label">
            <Markdown source={c.label} commentMeta={commenting.commentMeta} />
          </div>
          <CommentMarker
            ids={anchoredCommentIds(c.label)}
            commentMeta={commenting.commentMeta}
            onAdd={(e) => commenting.onAddComment(c, e)}
            onActivate={commenting.onActivateComment}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------- Question ----------------

export function QuestionCard({
  q,
  commenting,
  onAnswer,
}: {
  q: QuestionBlock;
  commenting: Commenting;
  onAnswer: (q: QuestionBlock, chose: string[], text: string) => void;
}) {
  const [editing, setEditing] = useState(q.status !== 'answered');
  const [selected, setSelected] = useState<Set<string>>(new Set(q.answer?.chose ?? []));
  const [text, setText] = useState(q.answer?.text ?? '');

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(q.select === 'multi' ? prev : []);
      if (prev.has(id) && q.select === 'multi') next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOptions = q.select ? [...q.options, { id: 'other', body: 'Other…' }] : [];

  // Minimal validation: a freeform question needs text; a choice question needs
  // a selection, and picking "Other" needs the freeform text filled in.
  const otherSelected = selected.has('other');
  const canSave = q.select ? selected.size > 0 && (!otherSelected || text.trim() !== '') : text.trim() !== '';

  return (
    <section className={`ip-card ip-question ip-status-${q.status}`} id={`block-${q.id}`} data-qid={q.id}>
      <header className="ip-card-head">
        <span className="ip-badge ip-badge-question">Question</span>
        <span className="ip-id">{q.id}</span>
        <h3>{q.title}</h3>
        <span className={`ip-badge ip-pill-${q.status}`}>{q.status}</span>
        <CommentMarker
          ids={anchoredCommentIds(q.body)}
          commentMeta={commenting.commentMeta}
          onAdd={(e) => commenting.onAddComment(q, e)}
          onActivate={commenting.onActivateComment}
        />
      </header>
      <div className="ip-card-body">
        <Markdown source={q.body} commentMeta={commenting.commentMeta} />

        {q.status === 'answered' && !editing ? (
          <div className="ip-answer-view">
            <div className="ip-answer-label">Your answer</div>
            {q.answer?.chose.length ? (
              <div className="ip-answer-chose">
                {q.answer.chose.map((c) => (
                  <span key={c} className="ip-chip">
                    {q.options.find((o) => o.id === c)?.id ?? c}
                  </span>
                ))}
              </div>
            ) : null}
            {q.answer?.text ? <Markdown source={q.answer.text} escapeHtml /> : null}
            <button className="ip-btn ip-btn-ghost" onClick={() => setEditing(true)}>
              Change answer
            </button>
          </div>
        ) : (
          <div className="ip-answer-edit">
            {allOptions.map((o) => (
              <label key={o.id} className={`ip-option ${selected.has(o.id) ? 'ip-option-on' : ''}`}>
                <input
                  type={q.select === 'multi' ? 'checkbox' : 'radio'}
                  name={`q-${q.id}`}
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                />
                <div className="ip-option-body">
                  <Markdown source={o.body} />
                </div>
              </label>
            ))}
            <textarea
              className="ip-textarea"
              placeholder={q.select ? 'Add a note, or your "Other" answer…' : 'Your answer…'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="ip-actions">
              <button
                className="ip-btn ip-btn-primary"
                disabled={!canSave}
                onClick={() => {
                  onAnswer(q, [...selected], text.trim());
                  setEditing(false);
                }}
              >
                Save answer
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------- Decision stack ----------------

const DECISION_NEXT: Record<string, { label: string; status: DecisionBlock['status'] }[]> = {
  proposed: [
    { label: 'Lock', status: 'locked' },
    { label: "Won't do", status: 'wontfix' },
  ],
  locked: [
    { label: 'Reopen', status: 'proposed' },
    { label: 'Supersede', status: 'superseded' },
  ],
  superseded: [{ label: 'Reopen', status: 'proposed' }],
  wontfix: [{ label: 'Reopen', status: 'proposed' }],
};

function DecisionRow({
  d,
  commenting,
  onStatus,
}: {
  d: DecisionBlock;
  commenting: Commenting;
  onStatus: (d: DecisionBlock, status: DecisionBlock['status']) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ip-drow ip-status-${d.status}`} id={`block-${d.id}`}>
      <div className="ip-drow-head">
        <button className="ip-drow-toggle" onClick={() => setOpen((o) => !o)}>
          <span className="ip-id">{d.id}</span>
          <span className={`ip-badge ip-pill-${d.status}`}>{d.status}</span>
          <span className="ip-drow-title">{d.title}</span>
          {d.from ? <span className="ip-from">from {d.from}</span> : null}
          <span className="ip-caret">{open ? '▾' : '▸'}</span>
        </button>
        <CommentMarker
          ids={anchoredCommentIds(d.body)}
          commentMeta={commenting.commentMeta}
          onAdd={(e) => commenting.onAddComment(d, e)}
          onActivate={commenting.onActivateComment}
        />
      </div>
      {open && (
        <div className="ip-drow-body">
          <Markdown source={d.body} commentMeta={commenting.commentMeta} />
          {d.rationale && (
            <details className="ip-rationale">
              <summary>Rationale</summary>
              <Markdown source={d.rationale} />
            </details>
          )}
          <div className="ip-actions">
            {(DECISION_NEXT[d.status] ?? []).map((a) => (
              <button key={a.status} className="ip-btn ip-btn-ghost" onClick={() => onStatus(d, a.status)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DecisionStack({
  decisions,
  commenting,
  onStatus,
}: {
  decisions: DecisionBlock[];
  commenting: Commenting;
  onStatus: (d: DecisionBlock, status: DecisionBlock['status']) => void;
}) {
  return (
    <section className="ip-card ip-decisions">
      <header className="ip-card-head">
        <span className="ip-badge ip-badge-decision">Decisions</span>
        <span className="ip-count">{decisions.length}</span>
      </header>
      <div className="ip-dstack">
        {decisions.map((d) => (
          <DecisionRow key={d.id} d={d} commenting={commenting} onStatus={onStatus} />
        ))}
      </div>
    </section>
  );
}

// ---------------- Finding matrix ----------------

const SEV_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 };

export function FindingMatrix({
  findings,
  commenting,
  onStatus,
}: {
  findings: FindingBlock[];
  commenting: Commenting;
  onStatus: (f: FindingBlock, status: FindingBlock['status']) => void;
}) {
  const [sevFilter, setSevFilter] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...findings]
    .filter((f) => sevFilter === 'all' || f.severity === sevFilter)
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  return (
    <section className="ip-card ip-findings">
      <header className="ip-card-head">
        <span className="ip-badge ip-badge-finding">Findings</span>
        <span className="ip-count">{findings.length}</span>
        <select className="ip-select" value={sevFilter} onChange={(e) => setSevFilter(e.target.value)}>
          <option value="all">all severities</option>
          {['p0', 'p1', 'p2', 'p3'].map((s) => (
            <option key={s} value={s}>
              {s.toUpperCase()}
            </option>
          ))}
        </select>
      </header>
      <div className="ip-fmatrix">
        {rows.map((f) => (
          <div className={`ip-frow ip-sev-${f.severity} ip-fstatus-${f.status}`} key={f.id} id={`block-${f.id}`}>
            <div className="ip-frow-head">
              <button className="ip-frow-toggle" onClick={() => setOpen((o) => (o === f.id ? null : f.id))}>
                <span className={`ip-sev ip-sev-${f.severity}`}>{f.severity.toUpperCase()}</span>
                <span className="ip-id">{f.id}</span>
                <span className="ip-frow-title">{f.title}</span>
                <span className={`ip-badge ip-pill-${f.status}`}>{f.status}</span>
              </button>
              <CommentMarker
                ids={anchoredCommentIds(f.body)}
                commentMeta={commenting.commentMeta}
                onAdd={(e) => commenting.onAddComment(f, e)}
                onActivate={commenting.onActivateComment}
              />
            </div>
            {open === f.id && (
              <div className="ip-frow-body">
                <Markdown source={f.body} commentMeta={commenting.commentMeta} />
                <div className="ip-actions">
                  <label className="ip-inline-label">status</label>
                  <select
                    className="ip-select"
                    value={f.status}
                    onChange={(e) => onStatus(f, e.target.value as FindingBlock['status'])}
                  >
                    {['open', 'partial', 'fixed', 'deferred', 'wontfix'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
