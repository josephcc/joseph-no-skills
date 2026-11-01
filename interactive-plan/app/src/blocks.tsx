import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { Markdown, linkifyCodeRefs, preprocessHighlights, rewritePlanLinks } from './markdown';
import { anchoredCommentIds } from './parser';
import { cellText, nextChecked, numericColumns, rangeIds, visibleRows, type Show, type Sort } from './checkTable';
import type { Block, CheckBlock, CheckTableBlock, DecisionBlock, FindingBlock, QuestionBlock } from './types';

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

// ---------------- Check table ----------------

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A <check-table>: the body's markdown table with a checkbox on every row. Each tick
// saves at once, writing the `checked` attribute through the block-edit path (the body
// is untouched). Search, the show filter, and sorting are view state only. Shift-click
// ticks a range of the rows on screen, and the header box ticks every row on screen;
// either one offers an Undo, since a mis-click there can undo many picks at once.
export function CheckTable({
  t,
  commenting,
  onChecked,
}: {
  t: CheckTableBlock;
  commenting: Commenting;
  onChecked: (t: CheckTableBlock, checked: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [sort, setSort] = useState<Sort | null>(null);
  const [undo, setUndo] = useState<{ label: string; checked: string[] } | null>(null);
  const anchor = useRef<string | null>(null); // the last row clicked, where a shift-click range starts
  const shift = useRef(false);
  const allBox = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);

  // Rendering every cell is the costly part of a long table, and a tick changes only the
  // tag's attribute, so key this on the body (and the comment states it highlights with).
  const metaKey = JSON.stringify(commenting.commentMeta);
  const cells = useMemo(() => {
    const meta = commenting.commentMeta;
    const html = (md: string) => marked.parseInline(preprocessHighlights(md, meta)) as string;
    const text = t.rows.map((r) => t.columns.map((_, i) => cellText(r.cells[i] ?? '')));
    const longest = t.columns.map((_, i) => Math.max(0, ...text.map((r) => r[i].length)));
    return {
      head: t.columns.map((c) => html(c.header)),
      html: t.rows.map((r) => t.columns.map((_, i) => html(r.cells[i] ?? ''))),
      text,
      numeric: numericColumns(text, t.columns.length),
      // Same width classes as prose tables, so a phone keeps long columns readable.
      width: longest.map((n) => (n > 60 ? 'ip-col-wide' : n > 20 ? 'ip-col-mid' : 'ip-col-short')),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.inner, metaKey]);

  useEffect(() => setUndo(null), [t.inner]);

  const on = new Set(t.checked);
  const ids = t.rows.map((r) => r.id);
  const shown = visibleRows(cells.text, ids, on, query, show, sort, cells.numeric);
  const shownIds = shown.map((i) => ids[i]);
  const nOn = ids.filter((id) => on.has(id)).length;
  const shownOn = shownIds.filter((id) => on.has(id)).length;
  const allOn = shown.length > 0 && shownOn === shown.length;

  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = shownOn > 0 && !allOn;
  });

  // Cells come in as HTML strings, so give them what the Markdown component gives prose:
  // clickable code refs and plan links. Paper links open in a new tab, keeping the viewer.
  // Idempotent, and React leaves an unchanged cell's DOM alone, so it is safe every render.
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    linkifyCodeRefs(root);
    rewritePlanLinks(root);
    root.querySelectorAll('a[href^="http"]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
  });

  function set(rowIds: string[], value: boolean) {
    const changing = rowIds.filter((id) => on.has(id) !== value).length;
    setUndo(changing > 1 ? { label: `${value ? 'Checked' : 'Unchecked'} ${plural(changing, 'row')}`, checked: t.checked } : null);
    onChecked(t, nextChecked(t, rowIds, value));
  }

  function onRow(id: string) {
    const rowIds = shift.current ? rangeIds(shownIds, anchor.current, id) : [id];
    shift.current = false;
    anchor.current = id;
    set(rowIds, !on.has(id));
  }

  // Numbers sort high-to-low first (most cited, newest), text A-Z; a third click restores table order.
  function onSort(col: number) {
    const first = cells.numeric[col] ? -1 : 1;
    setSort((s) => (s?.col !== col ? { col, dir: first } : s.dir === first ? { col, dir: first === 1 ? -1 : 1 } : null));
  }

  const align = (i: number) => t.columns[i].align ?? undefined;
  const justify = (i: number) =>
    t.columns[i].align === 'right' ? 'flex-end' : t.columns[i].align === 'center' ? 'center' : undefined;

  return (
    <section className="ip-card ip-ctable" id={`block-${t.id}`}>
      <header className="ip-card-head">
        <span className="ip-badge ip-badge-table">Table</span>
        <span className="ip-id">{t.id}</span>
        <h3>{t.title}</h3>
        <span className="ip-count">
          {nOn} / {ids.length} checked
        </span>
        <CommentMarker
          ids={anchoredCommentIds(t.inner)}
          commentMeta={commenting.commentMeta}
          onAdd={(e) => commenting.onAddComment(t, e)}
          onActivate={commenting.onActivateComment}
        />
      </header>
      <div className="ip-card-body">
        {t.before.trim() ? <Markdown source={t.before} commentMeta={commenting.commentMeta} /> : null}
        {t.columns.length ? (
          <>
            <div className="ip-ct-tools">
              <input
                type="search"
                className="ip-ct-search"
                placeholder="Filter rows…"
                aria-label="Filter rows"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select className="ip-select" value={show} onChange={(e) => setShow(e.target.value as Show)}>
                <option value="all">all rows</option>
                <option value="checked">checked</option>
                <option value="unchecked">unchecked</option>
              </select>
              {shown.length !== ids.length ? <span className="ip-inline-label">{shown.length} shown</span> : null}
              {undo ? (
                <span className="ip-ct-undo">
                  {undo.label}
                  <button
                    className="ip-btn ip-btn-ghost"
                    onClick={() => {
                      onChecked(t, undo.checked);
                      setUndo(null);
                    }}
                  >
                    Undo
                  </button>
                </span>
              ) : null}
            </div>
            <div className="ip-ct-scroll">
              <table className="ip-ct">
                <thead>
                  <tr>
                    <th className="ip-ct-box">
                      <label>
                        <input
                          type="checkbox"
                          ref={allBox}
                          checked={allOn}
                          disabled={!shown.length}
                          onChange={() => set(shownIds, !allOn)}
                          title={allOn ? 'Uncheck every row shown' : 'Check every row shown'}
                          aria-label={allOn ? 'Uncheck every row shown' : 'Check every row shown'}
                        />
                      </label>
                    </th>
                    {t.columns.map((_, i) => (
                      <th
                        key={i}
                        className={cells.width[i]}
                        aria-sort={sort?.col === i ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                      >
                        <button
                          type="button"
                          className="ip-ct-sort"
                          style={{ justifyContent: justify(i) }}
                          onClick={() => onSort(i)}
                          title="Sort"
                        >
                          <span dangerouslySetInnerHTML={{ __html: cells.head[i] }} />
                          <span className="ip-ct-arrow">{sort?.col === i ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody ref={body}>
                  {shown.map((ri) => {
                    const id = ids[ri];
                    const isOn = on.has(id);
                    return (
                      <tr key={ri} className={isOn ? 'ip-ct-on' : undefined}>
                        <td className="ip-ct-box">
                          {/* Shift is read on mousedown: the change event a label click
                              produces doesn't reliably carry modifier keys. Suppressing the
                              default there stops shift-click from selecting text. */}
                          <label
                            onMouseDown={(e) => {
                              shift.current = e.shiftKey;
                              if (e.shiftKey) e.preventDefault();
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isOn}
                              onChange={() => onRow(id)}
                              aria-label={`Check ${cells.text[ri][1] || id}`}
                            />
                          </label>
                        </td>
                        {t.columns.map((_, ci) => (
                          <td
                            key={ci}
                            className={`${cells.width[ci]}${ci === 0 ? ' ip-ct-id' : ''}`}
                            style={{ textAlign: align(ci) }}
                            dangerouslySetInnerHTML={{ __html: cells.html[ri][ci] }}
                          />
                        ))}
                      </tr>
                    );
                  })}
                  {shown.length ? null : (
                    <tr>
                      <td className="ip-ct-empty" colSpan={t.columns.length + 1}>
                        No rows match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="ip-ct-empty">No table in this block yet.</p>
        )}
        {t.after.trim() ? <Markdown source={t.after} commentMeta={commenting.commentMeta} /> : null}
      </div>
    </section>
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
                {q.answer.chose.map((c) => {
                  // Show the option's full text, not just its id: the id is the stable handle
                  // for the file, but a reader wants to see what was actually chosen.
                  const opt = q.options.find((o) => o.id === c);
                  return (
                    <div key={c} className="ip-answer-option">
                      <span className="ip-chip">{c === 'other' ? 'Other' : c}</span>
                      {opt ? (
                        <div className="ip-option-body">
                          <Markdown source={opt.body} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
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
