// Reviewing the coding of one interview.
//
// The old surface for this was `annotate`: the transcript with every extract as a
// margin comment, so the codes — the one thing the review is about — were hidden behind
// a click, and two spans on one turn became a ◆ marker after it. Here the coding is on
// the page: spans tinted by family, one chip per extract carrying its id, kind glyph and
// codes, and delta mode so round four costs what changed rather than what exists.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openInEditor } from '../api';
import { KIND_GLYPH, familyIndex } from '../codes';
import { CodePicker } from '../codepicker';
import { FrameLightbox, FramePeek, frameAt } from '../frames';
import { draft } from '../ops';
import { segmentTurn, selectionOffsets, snapToWords } from '../spans';
import { withPatch } from '../overlay';
import { ExtractInspector } from '../inspector/extract';
import { StagedInspector } from '../inspector/staged';
import { useTranscript } from '../store';
import type { Workbench } from '../store';
import type { Nav } from '../app';
import type { Extract, Kind, Turn } from '../types';

type Sel = { turn: Turn; start: number; end: number; text: string };
/** A new extract the researcher staged: drawn from the operation, not from the data file. */
type PendingSpan = { id: string; op: string; start: number; end: number; codes: string[]; kind: string };

export function TranscriptView({ dir, wb, nav }: { dir: string; wb: Workbench; nav: Nav }) {
  const { payload, error } = useTranscript(dir, nav.t, wb.version);
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ said: true, did: true, intent: true });
  const [newOnly, setNewOnly] = useState(false);
  const [starOnly, setStarOnly] = useState(false);
  const [codeFilter, setCodeFilter] = useState<string>('');
  const [sel, setSel] = useState<Sel | null>(null);
  const [coding, setCoding] = useState<Sel | null>(null);
  const [retrimming, setRetrimming] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Hovering either half of a pair lights the other: with three extracts under one turn,
  // nothing else says which chip belongs to which span.
  const [hovered, setHovered] = useState<string | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const bundle = wb.bundle!;
  const allCodes = bundle.codes;
  const hues = useMemo(() => familyIndex(allCodes), [allCodes]);
  const frames = payload?.frames.frames ?? [];

  // Extracts as the researcher has just left them (data + staged edits).
  const shown = useMemo(() => {
    const out = new Map<string, Extract & { pending: boolean; dropped: boolean }>();
    for (const e of payload?.extracts ?? []) out.set(e.id, withPatch(e, wb.patch.extracts[e.id]));
    return out;
  }, [payload?.extracts, wb.patch.extracts]);

  const visible = useCallback(
    (e: Extract & { pending: boolean; dropped: boolean }): boolean => {
      if (!kinds[e.kind]) return false;
      if (newOnly && !e.new) return false;
      if (starOnly && !e.highlight) return false;
      if (codeFilter && !e.codes.some((c) => c === codeFilter || c.startsWith(codeFilter + '.'))) return false;
      return true;
    },
    [kinds, newOnly, starOnly, codeFilter],
  );

  // A new extract exists only in the inbox until the agent applies it, so the transcript
  // has to draw it from the staged operation — otherwise coding a passage looks like
  // nothing happened, which is exactly what it looked like.
  const pendingNew = useMemo(() => {
    const byLine = new Map<number, PendingSpan[]>();
    for (const o of wb.patch.newExtracts) {
      const a = (o.args ?? {}) as Record<string, unknown>;
      if (String(a.transcript) !== nav.t) continue;
      if (typeof a.start !== 'number' || typeof a.end !== 'number') continue; // from/to form: no offsets to draw
      const line = Number(a.line_start ?? 0);
      const row: PendingSpan = {
        id: `pending:${o.id}`,
        op: o.id,
        start: a.start,
        end: a.end,
        codes: Array.isArray(a.codes) ? a.codes.map(String) : [],
        kind: String(a.kind ?? 'said'),
      };
      byLine.set(line, [...(byLine.get(line) ?? []), row]);
    }
    return byLine;
  }, [wb.patch.newExtracts, nav.t]);

  const order = useMemo(
    () => (payload?.extracts ?? []).map((e) => shown.get(e.id)!).filter(visible).map((e) => e.id),
    [payload?.extracts, shown, visible],
  );
  const selected = nav.e ? shown.get(nav.e) ?? null : null;
  const selectedStaged = useMemo(() => {
    if (!nav.e?.startsWith('pending:')) return null;
    for (const [line, rows] of pendingNew) {
      const row = rows.find((r) => r.id === nav.e);
      if (row) return { row, line };
    }
    return null;
  }, [nav.e, pendingNew]);

  const select = useCallback((id: string | null) => nav.go({ e: id }), [nav]);
  const move = useCallback(
    (d: number) => {
      if (!order.length) return;
      const i = nav.e ? order.indexOf(nav.e) : -1;
      const next = order[Math.max(0, Math.min(order.length - 1, i + d))] ?? order[0];
      select(next);
      document.getElementById(`chip-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    [order, nav.e, select],
  );

  // Thirty extracts should take five minutes, so the whole pass is reachable from the
  // keyboard: j/k to walk, 1/2/3 for the kind, a to accept and advance, x to drop.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const cur = nav.e ? shown.get(nav.e) : null;
      switch (ev.key) {
        case 'j': ev.preventDefault(); move(1); break;
        case 'k': ev.preventDefault(); move(-1); break;
        case 'a': ev.preventDefault(); move(1); break;
        case 'n': ev.preventDefault(); setNewOnly((v) => !v); break;
        case '1': case '2': case '3': {
          if (!cur) return;
          ev.preventDefault();
          const k = (['said', 'did', 'intent'] as Kind[])[Number(ev.key) - 1];
          wb.stage(draft('set-kind', cur.id, { kind: k }));
          break;
        }
        case 'x': {
          if (!cur) return;
          ev.preventDefault();
          wb.stage(draft('drop', cur.id, {}, 'dropped in the transcript review'));
          break;
        }
        case 'Escape': ev.preventDefault(); select(null); setSel(null); setCoding(null); setRetrimming(false); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, nav.e, shown, wb, select]);

  // A selection inside a participant turn is either a new extract or a re-trim of the
  // selected one; both travel as offsets into the same normalised turn text ta.py gave
  // us, so the words are cut from the transcript and never retyped.
  const captureSelection = useCallback(
    (turn: Turn) => {
      const host = document.getElementById(`turn-${turn.index}`);
      if (!host) return;
      const off = selectionOffsets(host);
      if (!off) {
        setSel(null);
        return;
      }
      const snapped = snapToWords(turn.text, off.start, off.end);
      setSel({ turn, start: snapped.start, end: snapped.end, text: turn.text.slice(snapped.start, snapped.end) });
    },
    [],
  );

  if (error) return <div className="wb-loading wb-error">{error}</div>;
  if (!nav.t) return <div className="wb-loading">Pick a transcript.</div>;
  if (!payload) return <div className="wb-loading">Reading {nav.t}…</div>;

  const t = payload.transcript;
  const codeOptions = allCodes.filter((c) => c.status === 'candidate' || c.status === 'accepted');

  return (
    <div className="wb-layout wb-layout-3">
      <aside className="wb-rail">
        <h3>Transcripts</h3>
        <ul className="wb-tlist">
          {bundle.transcripts.map((row) => (
            <li key={row.id}>
              <button
                className={`wb-tbtn ${row.id === nav.t ? 'wb-tbtn-on' : ''}`}
                onClick={() => nav.go({ t: row.id, e: null })}
              >
                <span className="wb-tid">{row.id}</span>
                <span className="wb-tp">{row.participants.join(', ') || '—'}</span>
                <span className="wb-tmeta">
                  {row.extracts} ex
                  {row.new_extracts > 0 && <b className="wb-new"> {row.new_extracts} new</b>}
                </span>
                {row.state !== 'current' && <span className="wb-tstate">{row.state}</span>}
              </button>
            </li>
          ))}
        </ul>
        {bundle.stale.reread_requests.length > 0 && (
          <>
            <h4>Re-reads asked for</h4>
            <ul className="wb-rereads">
              {bundle.stale.reread_requests.map((r, i) => (
                <li key={i}>
                  <b>{r.transcript}</b> {r.code ? <code>{r.code}</code> : null} {r.note}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className="wb-main" ref={mainRef}>
        <div className="wb-toolbar">
          <span className="wb-tool-title">
            <b>{t.id}</b> · {t.participants.join(', ')} · {t.turns} turns · {payload.stats.extracts} extracts
            {payload.stats.new > 0 && <b className="wb-new"> · {payload.stats.new} new</b>}
            {frames.length > 0 ? (
              <span className="wb-tool-frames" title={`from ${payload.frames.dir}`}>
                {' '}· ▣ {frames.length} frames
              </span>
            ) : (
              <span className="wb-tool-frames" title="watch-recording writes video-snapshots/ beside the transcript">
                {' '}· no frames beside this transcript
              </span>
            )}
          </span>
          <select className="wb-select" value={codeFilter} onChange={(e) => setCodeFilter(e.target.value)}>
            <option value="">all codes</option>
            {codeOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}
              </option>
            ))}
          </select>
          <span className="wb-seg">
            {(['said', 'did', 'intent'] as Kind[]).map((k) => (
              <button
                key={k}
                className={`wb-seg-btn ${kinds[k] ? 'wb-seg-on' : ''}`}
                onClick={() => setKinds({ ...kinds, [k]: !kinds[k] })}
              >
                {KIND_GLYPH[k]} {payload.stats.kinds[k]}
              </button>
            ))}
          </span>
          <button className={`wb-btn ${newOnly ? 'wb-btn-primary' : 'wb-btn-ghost'}`} onClick={() => setNewOnly((v) => !v)} title="press n">
            new only
          </button>
          <button className={`wb-btn ${starOnly ? 'wb-btn-primary' : 'wb-btn-ghost'}`} onClick={() => setStarOnly((v) => !v)}>
            ★ only
          </button>
          <button
            className="wb-btn wb-btn-primary"
            title="stamp every extract you did not act on as reviewed"
            onClick={() =>
              wb.stage(draft('mark-reviewed', null, { transcript: t.id })).then(() => wb.say(`${t.id}: the rest of the coding is marked reviewed.`))
            }
          >
            Done with {t.id}
          </button>
          <button className="wb-btn wb-btn-ghost" onClick={() => openInEditor(dir, t.id, 1).catch(() => wb.say('Could not open the editor.'))}>
            open the file
          </button>
        </div>

        {payload.stats.unlocated.length > 0 && (
          <p className="wb-warn">
            {payload.stats.unlocated.length} extract(s) cannot be placed on their turn ({payload.stats.unlocated.join(', ')}): re-trim them so
            the span can be highlighted.
          </p>
        )}

        <div className="wb-legend">
          {codeOptions
            .filter((c) => !c.parent)
            .map((c) => (
              <span key={c.id} className="wb-legend-item">
                <span className="wb-swatch" style={{ ['--hue' as string]: hues[c.id] ?? 0 }} />
                {c.id}
              </span>
            ))}
        </div>

        <div className="wb-turns">
          {payload.turns.map((turn) => {
            const isParticipant = turn.role === 'participant';
            const spans = turn.spans
              .filter((s) => {
                const e = shown.get(s.extract);
                return e && !e.dropped && visible(e);
              })
              // A staged re-trim has not been applied, but the researcher asked for it: show
              // the span where it will be, or the gesture looks like it did nothing.
              .map((s) => {
                const staged = wb.patch.extracts[s.extract]?.retrim;
                return staged ? { ...s, start: staged.start, end: staged.end } : s;
              });
            const staged = pendingNew.get(turn.line) ?? [];
            const stagedById = new Map(staged.map((p) => [p.id, p]));
            const allSpans = [...spans, ...staged.map((p) => ({ extract: p.id, start: p.start, end: p.end }))];
            // ①②③ in reading order, on the span and on its chip. Passive correspondence:
            // it works without hovering anything, and without relying on the family hue.
            const ordinal = new Map<string, number>();
            [...allSpans]
              .filter((sp) => typeof sp.start === 'number')
              .sort((x, y) => (x.start as number) - (y.start as number))
              .forEach((sp, i) => ordinal.set(sp.extract, i + 1));
            const segs = segmentTurn(turn.text, allSpans);
            const chips = turn.spans.map((s) => shown.get(s.extract)).filter((e): e is Extract & { pending: boolean; dropped: boolean } => !!e && visible(e));
            const unplaced = turn.spans.filter((s) => s.start === null).map((s) => s.extract);
            return (
              <div
                key={turn.index}
                className={`wb-turn ${isParticipant ? '' : 'wb-turn-context'} ${
                  retrimming && selected && turn.line <= selected.line_start && turn.end_line >= selected.line_start
                    ? 'wb-turn-retrim'
                    : ''
                }`}
              >
                <div className="wb-turn-head">
                  {frames.length > 0 ? (
                    // A frame behind a timestamp has to *look* like it is there: the ▣ marker is
                    // the affordance, and a button rather than a span so it is reachable by tab
                    // and reveals the frame on focus as well as on hover.
                    <button
                      className="wb-ts"
                      title={`the screen at ${turn.timestamp ?? 'this moment'} — hover to peek, click for full screen`}
                      onClick={() => {
                        const f = frameAt(frames, turn.timestamp);
                        if (f) setLightbox(f.file);
                      }}
                    >
                      [{turn.timestamp ?? '—'}]
                      <span className="wb-ts-mark" aria-hidden="true">▣</span>
                      <FramePeek dir={dir} t={t.id} frames={frames} ts={turn.timestamp} onOpen={(file) => setLightbox(file)} />
                    </button>
                  ) : (
                    <span className="wb-ts wb-ts-plain">[{turn.timestamp ?? '—'}]</span>
                  )}
                  <span className="wb-who">{turn.participant ?? turn.speaker}</span>
                  {!isParticipant && <span className="wb-role">{turn.role} · context, never data</span>}
                  <button
                    className="wb-line"
                    title="open this line in the editor"
                    onClick={() => openInEditor(dir, t.id, turn.line).catch(() => wb.say('Could not open the editor.'))}
                  >
                    :{turn.line}
                  </button>
                </div>
                <p
                  id={`turn-${turn.index}`}
                  className="wb-turn-text"
                  onMouseUp={() => isParticipant && captureSelection(turn)}
                >
                  {segs.map((seg, i) =>
                    seg.extracts.length === 0 ? (
                      <span key={i}>{seg.text}</span>
                    ) : (
                      <mark
                        key={i}
                        onMouseEnter={() => setHovered(seg.extracts[0])}
                        onMouseLeave={() => setHovered(null)}
                        className={`wb-hl ${seg.extracts.length > 1 ? 'wb-hl-multi' : ''} ${
                          seg.extracts.includes(nav.e ?? '') ? 'wb-hl-on' : ''
                        } ${seg.extracts.some((id) => stagedById.has(id)) ? 'wb-hl-staged' : ''} ${
                          hovered && seg.extracts.includes(hovered) ? 'wb-hl-linked' : ''
                        } ${seg.extracts.some((id) => shown.get(id)?.new) ? 'wb-hl-new' : 'wb-hl-old'}`}
                        style={{
                          ['--hue' as string]:
                            hues[stagedById.get(seg.extracts[0])?.codes[0] ?? shown.get(seg.extracts[0])?.codes[0] ?? ''] ?? 0,
                        }}
                        title={seg.extracts
                          .map((id) => {
                            const p = stagedById.get(id);
                            if (p) return `staged (${p.op}) · ${p.kind} · ${p.codes.join(', ')} — not applied yet`;
                            const e = shown.get(id);
                            return e ? `${id} · ${e.kind} · ${e.codes.join(', ')}` : id;
                          })
                          .join('\n')}
                        onClick={() => select(seg.extracts[0])}
                      >
                        {seg.extracts
                          .filter((id) => allSpans.some((sp) => sp.extract === id && sp.start === seg.start))
                          .map((id) => (
                            <span key={id} className="wb-hl-n" aria-hidden="true">
                              {ordinal.get(id)}
                            </span>
                          ))}
                        {seg.text}
                      </mark>
                    ),
                  )}
                </p>
                {staged.length > 0 && (
                  <div className="wb-chips-row">
                    {staged.map((p) => (
                      <button
                        key={p.id}
                        id={`chip-${p.id}`}
                        className={`wb-echip wb-echip-staged ${nav.e === p.id ? 'wb-echip-on' : ''} ${
                          hovered === p.id ? 'wb-echip-linked' : ''
                        }`}
                        style={{ ['--hue' as string]: hues[p.codes[0]] ?? 0 }}
                        title={`staged as ${p.op}; the agent creates it on the next apply`}
                        onMouseEnter={() => setHovered(p.id)}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => select(p.id)}
                      >
                        <span className="wb-echip-n">{ordinal.get(p.id)}</span>
                        <span className="wb-echip-id">new</span>
                        <span className="wb-echip-kind">{KIND_GLYPH[p.kind]}</span>
                        <span className="wb-echip-codes">{p.codes.join(' · ')}</span>
                      </button>
                    ))}
                  </div>
                )}
                {chips.length > 0 && (
                  <div className="wb-chips-row">
                    {chips.map((e) => (
                      <button
                        key={e.id}
                        id={`chip-${e.id}`}
                        className={`wb-echip ${nav.e === e.id ? 'wb-echip-on' : ''} ${e.new ? 'wb-echip-new' : ''} ${
                          e.dropped ? 'wb-echip-dropped' : ''
                        } ${e.pending ? 'wb-echip-pending' : ''} ${hovered === e.id ? 'wb-echip-linked' : ''}`}
                        style={{ ['--hue' as string]: hues[e.codes[0]] ?? 0 }}
                        onMouseEnter={() => setHovered(e.id)}
                        onMouseLeave={() => setHovered(null)}
                        onClick={() => select(e.id)}
                      >
                        {ordinal.has(e.id) && <span className="wb-echip-n">{ordinal.get(e.id)}</span>}
                        <span className="wb-echip-id">{e.id}</span>
                        <span className="wb-echip-kind" title={e.kind}>
                          {KIND_GLYPH[e.kind]}
                        </span>
                        <span className="wb-echip-codes">{e.codes.join(' · ')}</span>
                        {e.context && <span className="wb-echip-ctx">ctx: {e.context}</span>}
                        {e.highlight && <span className="wb-echip-star">★</span>}
                        {e.hints && e.hints.length > 0 && (
                          <span className="wb-echip-hint" title={e.hints.map((h) => h.text).join('\n')}>
                            ⚠{e.hints.length}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {unplaced.length > 0 && (
                  <div className="wb-chips-row">
                    {unplaced.map((id) => (
                      <button key={id} className="wb-echip wb-echip-unplaced" onClick={() => select(id)}>
                        {id} · text not found in this turn
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      <aside className="wb-inspector-pane">
        {selectedStaged ? (
          <StagedInspector
            staged={selectedStaged.row}
            text={(payload.turns.find((tn) => tn.line === selectedStaged.line)?.text ?? '').slice(
              selectedStaged.row.start,
              selectedStaged.row.end,
            )}
            codes={payload.codes}
            allCodes={allCodes}
            transcriptId={t.id}
            line={selectedStaged.line}
            op={wb.inbox.find((o) => o.id === selectedStaged.row.op)}
            wb={wb}
            onUndo={() => wb.undo(selectedStaged.row.op)}
            onClose={() => select(null)}
          />
        ) : selected ? (
          <ExtractInspector
            dir={dir}
            extract={selected}
            codes={payload.codes}
            allCodes={allCodes}
            wb={wb}
            frames={frames}
            transcriptId={t.id}
            dropped={selected.dropped}
            pending={wb.patch.extracts[selected.id]?.ops ?? []}
            onJumpToCode={(cid) => nav.go({ view: 'codebook', c: cid })}
            onRetrim={() => {
              setRetrimming((on) => !on);
              setSel(null);
            }}
            retrimming={retrimming}
            onOpenFrame={(file) => setLightbox(file)}
          />
        ) : (
          <div className="wb-inspector wb-empty">
            <p>
              Click a span or a chip to see the extract with the definitions it is meant to satisfy. <kbd>j</kbd>/<kbd>k</kbd> walks the
              coding, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> sets the kind, <kbd>x</kbd> drops, <kbd>n</kbd> shows only what is new.
            </p>
            <p className="wb-muted">
              Scrolling past an extract accepts it. “Done with {t.id}” stamps the rest as reviewed, so the next round costs what changed.
            </p>
          </div>
        )}
      </aside>

      {retrimming && selected && !sel && (
        <div className="wb-selbar wb-selbar-mode">
          <span className="wb-selquote">
            Re-trimming <b>{selected.id}</b> — select the words to keep, inside its own turn (line {selected.line_start}).
          </span>
          <button className="wb-btn wb-btn-ghost" onClick={() => setRetrimming(false)}>
            cancel
          </button>
        </div>
      )}

      {sel && (
        <div className="wb-selbar">
          <span className="wb-selquote">“{sel.text.slice(0, 90)}{sel.text.length > 90 ? '…' : ''}”</span>
          {retrimming && selected ? (
            sel.turn.line <= selected.line_start && sel.turn.end_line >= selected.line_start ? (
              <button
                className="wb-btn wb-btn-primary"
                onClick={() => {
                  // The turn travels with the offsets: ta.py refuses them if they were
                  // measured anywhere but the extract's own turn, where they mean nothing.
                  wb.stage(draft('retrim', selected.id, { start: sel.start, end: sel.end, turn_line: sel.turn.line }));
                  setRetrimming(false);
                  setSel(null);
                }}
              >
                re-trim {selected.id} to the selection
              </button>
            ) : (
              <span className="wb-selnote">
                that selection is in another turn — select inside {selected.id}'s own turn (line {selected.line_start})
              </span>
            )
          ) : (
            <button className="wb-btn wb-btn-primary" onClick={() => setCoding(sel)}>
              code this passage
            </button>
          )}
          <button className="wb-btn wb-btn-ghost" onClick={() => (setSel(null), setRetrimming(false))}>
            cancel
          </button>
        </div>
      )}

      {coding && (
        <div className="wb-modal" onClick={() => setCoding(null)}>
          <div className="wb-modal-inner" onClick={(e) => e.stopPropagation()}>
            <h3>Code a passage {coding.turn.participant} did not have coded</h3>
            <blockquote className="wb-insp-quote">{coding.text}</blockquote>
            <NewExtractForm
              codes={codeOptions}
              onCancel={() => setCoding(null)}
              onSubmit={(codeIds, kind) => {
                wb.stage(
                  draft('new-extract', null, {
                    transcript: t.id,
                    line_start: coding.turn.line,
                    line_end: coding.turn.end_line,
                    start: coding.start,
                    end: coding.end,
                    codes: codeIds,
                    kind,
                  }),
                );
                setCoding(null);
                setSel(null);
              }}
            />
          </div>
        </div>
      )}

      {lightbox && <FrameLightbox dir={dir} t={t.id} frames={frames} file={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function NewExtractForm({ codes, onSubmit, onCancel }: {
  codes: import('../types').Code[];
  onSubmit: (codes: string[], kind: Kind) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [kind, setKind] = useState<Kind>('said');
  return (
    <div>
      <div className="wb-tokens">
        {picked.map((id) => (
          <span key={id} className="wb-token">
            <span className="wb-token-id">{id}</span>
            <button className="wb-token-x" onClick={() => setPicked(picked.filter((p) => p !== id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <CodePicker codes={codes} exclude={picked} onPick={(id) => setPicked([...picked, id])} placeholder="which code does this passage take?" />
      <div className="wb-field">
        <label>kind</label>
        <div className="wb-seg">
          {(['said', 'did', 'intent'] as Kind[]).map((k) => (
            <button key={k} className={`wb-seg-btn ${kind === k ? 'wb-seg-on' : ''}`} onClick={() => setKind(k)}>
              {KIND_GLYPH[k]} {k}
            </button>
          ))}
        </div>
      </div>
      <div className="wb-actions">
        <button className="wb-btn wb-btn-primary" disabled={!picked.length} onClick={() => onSubmit(picked, kind)}>
          stage the extract
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={onCancel}>
          cancel
        </button>
      </div>
      <p className="wb-muted">
        The script copies these words out of the transcript at the offsets you selected; nothing is retyped, and `verify` re-checks it.
      </p>
    </div>
  );
}
