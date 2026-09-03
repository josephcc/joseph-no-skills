// Coverage as a map you can act on.
//
// The skill says to read coverage as a set of questions: a code nobody said, a
// participant with nothing in a whole family, a `did` column of zeros under a code about
// behaviour. The table answers none of them in place. Here a cell opens its extracts and
// an empty cell can ask the agent to re-read that transcript for that code — which is
// the completeness rule ("every data item gets equal attention") made clickable.
import { useMemo, useState } from 'react';
import { KIND_GLYPH, familyIndex } from '../codes';
import { draft } from '../ops';
import type { Nav } from '../app';
import type { Workbench } from '../store';
import type { Extract } from '../types';

export function CoverageView({ wb, nav }: { wb: Workbench; nav: Nav }) {
  const b = wb.bundle!;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [cell, setCell] = useState<{ code: string; participant: string } | null>(null);
  const [ask, setAsk] = useState<{ code: string; participant: string } | null>(null);
  const [note, setNote] = useState('');
  const hues = useMemo(() => familyIndex(b.codes), [b.codes]);
  const pids = b.participants.map((p) => p.id);
  const live = b.codes.filter((c) => c.status === 'candidate' || c.status === 'accepted');
  const rows = live.filter((c) => !c.parent || !collapsed[c.parent]);

  const extractsIn = (code: string, participant: string): Extract[] => {
    const ids = new Set(b.cells[code]?.[participant]?.extracts ?? []);
    return b.extracts_all.filter((e) => ids.has(e.id));
  };
  const transcriptsOf = (pid: string) => b.participants.find((p) => p.id === pid)?.transcripts ?? [];

  return (
    <div className="wb-layout wb-layout-2">
      <main className="wb-main wb-scroll-x">
        <header className="wb-detail-head">
          <h2>Coverage</h2>
          <span className="wb-muted">
            {b.total_extracts} extracts · {b.N} participants · codebook v{b.codebook_version}
          </span>
        </header>
        {(b.zero_codes.length > 0 || b.silent_participants.length > 0) && (
          <div className="wb-cov-flags">
            {b.zero_codes.length > 0 && (
              <p className="wb-warn">
                No extracts at all: {b.zero_codes.map((c) => <code key={c}>{c}</code>)}. A code nobody said is a candidate to retire, or a
                transcript you under-read.
              </p>
            )}
            {b.silent_participants.length > 0 && (
              <p className="wb-warn">Participants with no extracts: {b.silent_participants.join(', ')}.</p>
            )}
          </div>
        )}
        <div className="wb-heat-scroll">
        <table className="wb-heat">
          <thead>
            <tr>
              <th className="wb-heat-code">code</th>
              <th className="wb-heat-n">n/N</th>
              {pids.map((p) => (
                <th key={p} className="wb-heat-p" title={`${p} — ${b.participants.find((x) => x.id === p)?.extracts ?? 0} extracts in all`}>
                  {p}
                </th>
              ))}
              <th className="wb-heat-kinds">said/did/intent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const kids = live.filter((k) => k.parent === c.id);
              return (
                <tr key={c.id} className={c.parent ? 'wb-heat-child' : 'wb-heat-parent'}>
                  <th className="wb-heat-code">
                    {!c.parent && kids.length > 0 && (
                      <button className="wb-fold" onClick={() => setCollapsed({ ...collapsed, [c.id]: !collapsed[c.id] })}>
                        {collapsed[c.id] ? '▸' : '▾'}
                      </button>
                    )}
                    <span className="wb-swatch" style={{ ['--hue' as string]: hues[c.id] ?? 0 }} />
                    <button className="wb-heat-link" onClick={() => nav.go({ view: 'codebook', c: c.id })} title={c.definition}>
                      {c.parent ? c.id.split('.')[1] : c.id}
                    </button>
                    {c.status === 'candidate' && <span className="wb-cand">◦</span>}
                  </th>
                  <td className="wb-heat-n">
                    {c.n}/{b.N}
                  </td>
                  {pids.map((p) => {
                    const cellData = b.cells[c.id]?.[p];
                    const n = cellData?.extracts.length ?? 0;
                    const kinds = cellData?.kinds;
                    return (
                      <td
                        key={p}
                        className={`wb-heat-cell wb-heat-${n === 0 ? 'zero' : n < 3 ? 'low' : n < 6 ? 'mid' : 'high'} ${
                          (cell?.code === c.id && cell?.participant === p) || (ask?.code === c.id && ask?.participant === p)
                            ? 'wb-heat-on'
                            : ''
                        }`}
                        title={
                          n
                            ? `${p} · ${c.id}: ${n} extract(s)${kinds ? ` (said ${kinds.said}, did ${kinds.did}, intent ${kinds.intent})` : ''}`
                            : `${p} has nothing under ${c.id} — click to ask for a re-read`
                        }
                        onClick={() => {
                          // One cell is selected at a time: opening either panel closes the other,
                          // so the pane on the right always describes the cell you just clicked.
                          if (n) {
                            setCell({ code: c.id, participant: p });
                            setAsk(null);
                          } else {
                            setAsk({ code: c.id, participant: p });
                            setCell(null);
                            setNote('');
                          }
                        }}
                      >
                        {n ? (
                          <>
                            <b>{n}</b>
                            <span className="wb-heat-glyphs">
                              {kinds ? KIND_GLYPH.said.repeat(Math.min(3, kinds.said)) + KIND_GLYPH.did.repeat(Math.min(3, kinds.did)) + KIND_GLYPH.intent.repeat(Math.min(3, kinds.intent)) : ''}
                            </span>
                          </>
                        ) : (
                          '·'
                        )}
                      </td>
                    );
                  })}
                  <td className="wb-heat-kinds">
                    {c.kinds.said}/{c.kinds.did}/{c.kinds.intent}
                    {c.kinds.did === 0 && c.extracts > 2 && (
                      <span className="wb-warn-inline" title="a code about behaviour with no `did` extract is a code about opinions">
                        no did
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <h3>Transcripts</h3>
        <table className="wb-table">
          <thead>
            <tr>
              <th>transcript</th>
              <th>participants</th>
              <th>extracts</th>
              <th>new</th>
              <th>coded with</th>
              <th>state</th>
            </tr>
          </thead>
          <tbody>
            {b.transcripts.map((t) => (
              <tr key={t.id}>
                <td>
                  <button className="wb-heat-link" onClick={() => nav.go({ view: 'transcript', t: t.id, e: null })}>
                    {t.id}
                  </button>
                </td>
                <td>{t.participants.join(', ')}</td>
                <td>{t.extracts}</td>
                <td>{t.new_extracts || '—'}</td>
                <td>v{t.coded_with_version ?? '—'}</td>
                <td className={t.state === 'current' ? '' : 'wb-warn-inline'}>{t.state}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Participants</h3>
        <table className="wb-table">
          <thead>
            <tr>
              <th>participant</th>
              <th>transcripts</th>
              <th>extracts</th>
              <th>distinct codes</th>
              <th>families never applied to them</th>
            </tr>
          </thead>
          <tbody>
            {b.participants.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.transcripts.join(', ')}</td>
                <td>{p.extracts}</td>
                <td>{p.distinct_codes}</td>
                <td className="wb-missing">
                  {p.missing_top.length ? (
                    p.missing_top.map((c) => (
                      <button key={c} className="wb-mini-token" onClick={() => setAsk({ code: c, participant: p.id })} title="ask for a re-read">
                        {c}
                      </button>
                    ))
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="wb-muted">
          Prevalence is counted per participant. Frequency does not determine value: a 3/12 theme can carry the paper if it answers the
          research question.
        </p>
      </main>

      <aside className="wb-inspector-pane">
        {ask ? (
          <div className="wb-inspector">
            <h3>Ask for a re-read</h3>
            <p>
              {ask.participant} has nothing under <code>{ask.code}</code>.
            </p>
            <p className="wb-muted">
              Either they never spoke to it, or the transcript was under-read. The agent picks this up from the inbox and re-reads before the
              next round; `stale` reports it until it is done.
            </p>
            {transcriptsOf(ask.participant).map((tid) => (
              <div key={tid} className="wb-field">
                <label>{tid}</label>
                <textarea className="wb-textarea wb-small" placeholder="what to look for" value={note} onChange={(e) => setNote(e.target.value)} />
                <button
                  className="wb-btn wb-btn-primary"
                  onClick={() => {
                    wb.stage(draft('reread-request', null, { transcript: tid, code: ask.code, note: note || null }));
                    setNote('');
                    setAsk(null);
                  }}
                >
                  ask for a re-read of {tid}
                </button>
              </div>
            ))}
            <button className="wb-btn wb-btn-ghost" onClick={() => setAsk(null)}>
              cancel
            </button>
          </div>
        ) : cell ? (
          <div className="wb-inspector">
            <h3>
              {cell.participant} · <code>{cell.code}</code>
            </h3>
            <ul className="wb-cov-list">
              {extractsIn(cell.code, cell.participant).map((e) => (
                <li key={e.id}>
                  <button className="wb-op-id" onClick={() => nav.go({ view: 'transcript', t: e.transcript, e: e.id })}>
                    {e.id}
                  </button>{' '}
                  <span title={e.kind}>{KIND_GLYPH[e.kind]}</span> {e.text}
                </li>
              ))}
            </ul>
            <button className="wb-btn wb-btn-ghost" onClick={() => setCell(null)}>
              close
            </button>
          </div>
        ) : (
          <div className="wb-inspector wb-empty">
            <p>Click a cell to read what is behind the number. Click an empty one to ask for a re-read.</p>
            {b.stale.reread_requests.length > 0 && (
              <>
                <h4>Open re-read requests</h4>
                <ul>
                  {b.stale.reread_requests.map((r, i) => (
                    <li key={i}>
                      <b>{r.transcript}</b> {r.code ? <code>{r.code}</code> : null} {r.note}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
