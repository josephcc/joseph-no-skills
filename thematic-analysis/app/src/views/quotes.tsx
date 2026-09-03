// Choosing the quotes, under the constraints that actually bind.
//
// The document form of this was a multi-select over four pasted options: no view of the
// rest of the bank, an attribution table computed before you chose, and no way to say
// "this clause, inline" without retyping the words. Here the bank is whole, the spread
// updates as you pick, and a trim is a selection the script slices out of the extract —
// so the paper's shorter quote is still transcript text and `verify-quotes` still passes.
import { useMemo, useState } from 'react';
import { KIND_GLYPH } from '../codes';
import { draft } from '../ops';
import { themeWithPatch } from '../overlay';
import { snapToWords } from '../spans';
import type { Nav } from '../app';
import type { Workbench } from '../store';
import type { Extract } from '../types';

const INLINE_MAX = 25;

export function QuotesView({ wb, nav }: { wb: Workbench; nav: Nav }) {
  const b = wb.bundle!;
  const [filterP, setFilterP] = useState('');
  const [starOnly, setStarOnly] = useState(false);
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState<'order' | 'short'>('order');
  const [trimming, setTrimming] = useState<{ theme: string; extract: Extract } | null>(null);
  const themes = useMemo(
    () => b.themes.map((t) => themeWithPatch(t, wb.patch.themes[t.id])).filter((t) => t.status !== 'merged' && t.status !== 'dropped' && t.in_paper !== 'no'),
    [b.themes, wb.patch.themes],
  );
  const theme = nav.th ? themes.find((t) => t.id === nav.th) ?? themes[0] ?? null : themes[0] ?? null;

  const bank = useMemo(() => {
    if (!theme) return [] as Extract[];
    const fam = new Set(theme.family?.length ? theme.family : theme.codes);
    for (const cid of theme.codes) {
      const c = b.codes.find((x) => x.id === cid);
      for (const f of c?.family ?? []) fam.add(f);
    }
    // Flagged extracts first — those are the moments that struck the researcher during
    // coding — then either the order they were said in (keeps the context of a session) or
    // shortest first (hunting for something that will weave inline).
    return b.extracts_all
      .filter((e) => e.codes.some((c) => fam.has(c)))
      .filter((e) => (!filterP || e.participant === filterP) && (!kind || e.kind === kind) && (!starOnly || e.highlight))
      .sort(
        (x, y) =>
          Number(!!y.highlight) - Number(!!x.highlight) ||
          (sort === 'short'
            ? x.words - y.words
            : x.participant.localeCompare(y.participant) || x.transcript.localeCompare(y.transcript) || x.line_start - y.line_start),
      );
  }, [theme, b.extracts_all, b.codes, filterP, kind, starOnly, sort]);

  // The spread is the check the skill states: a results section that quotes P3 seven
  // times is a case study of P3. It counts the selections as they stand, staged ops
  // included, so the constraint binds while you choose rather than afterwards.
  const spread = useMemo(() => {
    const per: Record<string, { theme: string; extract: string }[]> = {};
    for (const t of themes) {
      for (const eid of t.selected_extracts) {
        const e = b.extracts_all.find((x) => x.id === eid);
        if (!e) continue;
        (per[e.participant] ??= []).push({ theme: t.id, extract: eid });
      }
    }
    return per;
  }, [themes, b.extracts_all]);

  if (!themes.length)
    return (
      <div className="wb-loading">
        No theme is marked for the paper yet. Set a theme's <b>in the paper</b> in the Themes view first.
      </div>
    );
  if (!theme) return <div className="wb-loading">Pick a theme.</div>;

  const selected = theme.selected_extracts
    .map((id) => b.extracts_all.find((e) => e.id === id))
    .filter((e): e is Extract => !!e);
  const kinds = selected.reduce<Record<string, number>>((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {});
  const availableDid = bank.filter((e) => e.kind === 'did').length;

  return (
    <div className="wb-layout wb-layout-2">
      <main className="wb-main">
        <div className="wb-toolbar">
          <select className="wb-select" value={theme.id} onChange={(e) => nav.go({ th: e.target.value })}>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.name} ({t.in_paper})
              </option>
            ))}
          </select>
          <select className="wb-select" value={filterP} onChange={(e) => setFilterP(e.target.value)}>
            <option value="">all participants</option>
            {b.participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
                {spread[p.id]?.length ? ` · ${spread[p.id].length} quoted` : ''}
              </option>
            ))}
          </select>
          <select className="wb-select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">said · did · intent</option>
            <option value="said">said only</option>
            <option value="did">did only</option>
            <option value="intent">intent only</option>
          </select>
          <select className="wb-select" value={sort} onChange={(e) => setSort(e.target.value as 'order' | 'short')}>
            <option value="order">in the order they were said</option>
            <option value="short">shortest first</option>
          </select>
          <button
            className={`wb-btn ${starOnly ? 'wb-btn-primary' : 'wb-btn-ghost'}`}
            title="only the extracts flagged as paper-worthy during coding"
            onClick={() => setStarOnly((v) => !v)}
          >
            ★ only
          </button>
        </div>

        <div className="wb-quotes">
          <section className="wb-bank">
            <h3>
              The bank <span className="wb-muted">{bank.length} extract(s) carrying {theme.id}'s codes</span>
            </h3>
            <ul>
              {bank.map((e) => {
                const chosen = theme.selected_extracts.includes(e.id);
                return (
                  <li key={e.id} className={`wb-bank-row ${chosen ? 'wb-bank-chosen' : ''}`}>
                    <div className="wb-bank-meta">
                      <button className="wb-op-id" onClick={() => nav.go({ view: 'transcript', t: e.transcript, e: e.id })}>
                        {e.id}
                      </button>
                      <b>{e.participant}</b>
                      <span title={e.kind}>{KIND_GLYPH[e.kind]}</span>
                      <span className={e.words <= INLINE_MAX ? 'wb-inline-ok' : 'wb-block-only'}>
                        {e.words} words · {e.words <= INLINE_MAX ? 'fits inline' : 'block quote'}
                      </span>
                      {e.highlight && <span className="wb-echip-star" title={e.highlight}>★</span>}
                      {(spread[e.participant]?.length ?? 0) > 2 && (
                        <span className="wb-warn-inline" title="already quoted several times across the paper">
                          {spread[e.participant].length}× quoted
                        </span>
                      )}
                    </div>
                    <blockquote>{e.text}</blockquote>
                    {e.context && <p className="wb-muted">context: {e.context}</p>}
                    <div className="wb-actions">
                      {chosen ? (
                        <button className="wb-btn wb-btn-ghost" onClick={() => wb.stage(draft('deselect-quote', theme.id, { extract: e.id }))}>
                          remove from the paper
                        </button>
                      ) : (
                        <button className="wb-btn wb-btn-primary" onClick={() => wb.stage(draft('select-quote', theme.id, { extract: e.id }))}>
                          use in the paper
                        </button>
                      )}
                      <button className="wb-btn wb-btn-ghost" onClick={() => setTrimming({ theme: theme.id, extract: e })}>
                        trim for inline use
                      </button>
                      {!theme.tensions.includes(e.id) ? (
                        <button className="wb-btn wb-btn-ghost" onClick={() => wb.stage(draft('set-tension', theme.id, { add: [e.id] }))}>
                          mark as the tension
                        </button>
                      ) : (
                        <span className="wb-tension-tag">tension</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="wb-selected">
            <h3>
              In the paper <span className="wb-muted">{selected.length} quote(s), in order</span>
            </h3>
            {availableDid > 0 && !kinds.did && (
              <p className="wb-warn">
                {availableDid} `did` extract(s) available and none selected. A theme about behaviour wants an action beside the opinions.
              </p>
            )}
            <ol className="wb-sel-list">
              {selected.map((e, i) => {
                const trim = theme.quote_spans[e.id];
                return (
                  <li key={e.id}>
                    <div className="wb-bank-meta">
                      <span className="wb-op-id">{e.id}</span>
                      <b>{e.participant}</b>
                      <span title={e.kind}>{KIND_GLYPH[e.kind]}</span>
                      {trim && <span className="wb-trimmed">trimmed to {trim.words} words</span>}
                      {theme.tensions.includes(e.id) && <span className="wb-tension-tag">tension</span>}
                    </div>
                    <blockquote>{trim ? trim.text : e.text}</blockquote>
                    <div className="wb-actions">
                      <button
                        className="wb-btn wb-btn-ghost wb-tiny"
                        disabled={i === 0}
                        onClick={() => wb.stage(draft('select-quote', theme.id, { extract: e.id, at: i - 1 }))}
                      >
                        ↑
                      </button>
                      <button
                        className="wb-btn wb-btn-ghost wb-tiny"
                        disabled={i === selected.length - 1}
                        onClick={() => wb.stage(draft('select-quote', theme.id, { extract: e.id, at: i + 1 }))}
                      >
                        ↓
                      </button>
                      {trim && (
                        <button
                          className="wb-btn wb-btn-ghost wb-tiny"
                          onClick={() => wb.stage(draft('quote-span', theme.id, { extract: e.id, clear: true }))}
                        >
                          untrim
                        </button>
                      )}
                      <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => wb.stage(draft('deselect-quote', theme.id, { extract: e.id }))}>
                        remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            {!selected.length && <p className="wb-muted">Nothing chosen yet.</p>}
          </section>
        </div>

        <section className="wb-spreadtable">
          <h3>Attribution spread</h3>
          <table className="wb-table">
            <thead>
              <tr>
                <th>participant</th>
                {themes.map((t) => (
                  <th key={t.id}>{t.id}</th>
                ))}
                <th>total</th>
              </tr>
            </thead>
            <tbody>
              {b.participants.map((p) => {
                const rows = spread[p.id] ?? [];
                return (
                  <tr key={p.id} className={rows.length > 3 ? 'wb-over' : rows.length === 0 ? 'wb-none' : ''}>
                    <td>{p.id}</td>
                    {themes.map((t) => (
                      <td key={t.id}>{rows.filter((r) => r.theme === t.id).length || '·'}</td>
                    ))}
                    <td>
                      <b>{rows.length}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* The spread table above already shows who is over- or under-quoted, and it counts
              staged selections too. So only show ta.py's warnings that the table cannot: a
              theme with no `did` quote, a theme with no tension, a selection gone missing. */}
          {b.spread.warnings.filter((w) => w.kind !== 'unquoted' && w.kind !== 'over-quoted').length > 0 && (
            <ul className="wb-hints">
              {b.spread.warnings
                .filter((w) => w.kind !== 'unquoted' && w.kind !== 'over-quoted')
                .map((w, i) => (
                  <li key={i} className="wb-hint">
                    ⚠ {w.text}
                  </li>
                ))}
            </ul>
          )}
          <p className="wb-muted">
            Counted from what is on disk plus what you have staged. The warnings are the skill's: nobody should carry the section alone, and
            a behavioural claim wants a `did` beside the `said`.
          </p>
        </section>
      </main>

      <aside className="wb-inspector-pane">
        {trimming ? (
          <TrimPane
            extract={trimming.extract}
            existing={theme.quote_spans[trimming.extract.id]?.text}
            onCancel={() => setTrimming(null)}
            onSubmit={(start, end) => {
              wb.stage(draft('quote-span', theme.id, { extract: trimming.extract.id, start, end }));
              setTrimming(null);
            }}
          />
        ) : (
          <div className="wb-inspector">
            <h3>{theme.id}</h3>
            <p>{theme.name}</p>
            <p className="wb-muted">{theme.essence}</p>
            <p className="wb-insp-num">
              {theme.n}/{theme.N} participants · {theme.extracts} extracts · {selected.length} quote(s) ·{' '}
              {(['said', 'did', 'intent'] as const).map((k) => `${KIND_GLYPH[k]}${kinds[k] ?? 0}`).join(' ')}
            </p>
            <p className="wb-muted">
              Pick for the claim, not the topic. Short enough to weave inline where you can; a `did` beside a `said` when the theme is about
              behaviour; and watch who is already carrying the section.
            </p>
            <p className="wb-muted">
              Participants not quoted anywhere: {b.participants.filter((p) => !(spread[p.id] ?? []).length).map((p) => p.id).join(', ') || 'none'}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function TrimPane({ extract, existing, onSubmit, onCancel }: {
  extract: Extract;
  existing?: string;
  onSubmit: (start: number, end: number) => void;
  onCancel: () => void;
}) {
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const capture = () => {
    const sel = window.getSelection();
    const host = document.getElementById('trim-source');
    if (!sel || sel.isCollapsed || !host || !host.contains(sel.anchorNode)) return;
    const r = sel.getRangeAt(0);
    const before = r.cloneRange();
    before.selectNodeContents(host);
    before.setEnd(r.startContainer, r.startOffset);
    const start = before.toString().length;
    const snapped = snapToWords(extract.text, start, start + r.toString().length);
    setRange(snapped);
  };
  const preview = range ? extract.text.slice(range.start, range.end) : existing ?? '';
  return (
    <div className="wb-inspector">
      <h3>Trim {extract.id} for inline use</h3>
      <p className="wb-muted">
        Select the words that go in the sentence. The script cuts them out of the stored extract, so the quote is still transcript text and
        the full extract stays untouched.
      </p>
      <blockquote id="trim-source" className="wb-insp-quote" onMouseUp={capture}>
        {extract.text}
      </blockquote>
      {preview && (
        <div className="wb-field">
          <label>the quote as it would read ({preview.trim().split(/\s+/).length} words)</label>
          <blockquote className="wb-trim-preview">{preview}</blockquote>
        </div>
      )}
      <div className="wb-actions">
        <button className="wb-btn wb-btn-primary" disabled={!range} onClick={() => range && onSubmit(range.start, range.end)}>
          stage the trim
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={onCancel}>
          cancel
        </button>
      </div>
    </div>
  );
}
