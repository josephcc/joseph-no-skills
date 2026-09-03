// Two codes, side by side, with the extracts they share.
//
// Every `dupes` flag and every "are these the same thing?" moment ends here: the two
// definitions above three columns — only A, both, only B — because a code that is really
// two codes shows up as a full middle column, and a child masquerading as a sibling
// shows up as an empty one.
import { useMemo } from 'react';
import { Md } from '../md';
import { KIND_GLYPH } from '../codes';
import { draft } from '../ops';
import type { Code, Extract } from '../types';
import type { Workbench } from '../store';

export function Compare({ a, b, extracts, wb, onClose }: {
  a: Code;
  b: Code;
  extracts: Extract[];
  wb: Workbench;
  onClose: () => void;
}) {
  // An "only A" row may be coded `A.child`, not `A`. Removing the parent id would leave the
  // child in place and put the extract in both families, so remove what it actually carries.
  const onMove = (e: Extract, to: string, fromFamily: Set<string>) => {
    const remove = e.codes.filter((c) => fromFamily.has(c));
    wb.stage(draft('recode', e.id, { add: [to], remove }, `moved while comparing ${a.id} and ${b.id}`));
  };
  const famA = new Set(a.family?.length ? a.family : [a.id]);
  const famB = new Set(b.family?.length ? b.family : [b.id]);
  const cols = useMemo(() => {
    const onlyA: Extract[] = [];
    const both: Extract[] = [];
    const onlyB: Extract[] = [];
    for (const e of extracts) {
      const inA = e.codes.some((c) => famA.has(c));
      const inB = e.codes.some((c) => famB.has(c));
      if (inA && inB) both.push(e);
      else if (inA) onlyA.push(e);
      else if (inB) onlyB.push(e);
    }
    return { onlyA, both, onlyB };
  }, [extracts, famA, famB]);

  return (
    <div className="wb-compare">
      <header className="wb-cmp-head">
        <h3>
          <code>{a.id}</code> vs <code>{b.id}</code>
        </h3>
        <button className="wb-btn wb-btn-ghost" onClick={() => wb.stage(draft('merge-code', a.id, { into: b.id }, `merged after comparing ${a.id} and ${b.id}`))}>
          merge {a.id} → {b.id}
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={() => wb.stage(draft('merge-code', b.id, { into: a.id }, `merged after comparing ${b.id} and ${a.id}`))}>
          merge {b.id} → {a.id}
        </button>
        {!a.parent && !b.parent && (
          <>
            <button className="wb-btn wb-btn-ghost" onClick={() => wb.stage(draft('reparent', a.id, { parent: b.id }))}>
              {a.id} → child of {b.id}
            </button>
            <button className="wb-btn wb-btn-ghost" onClick={() => wb.stage(draft('reparent', b.id, { parent: a.id }))}>
              {b.id} → child of {a.id}
            </button>
          </>
        )}
        <button className="wb-btn wb-btn-ghost" onClick={onClose}>
          close
        </button>
      </header>
      <div className="wb-cmp-defs">
        <div>
          <b>{a.id}</b> · {a.name}
          <Md source={a.definition} />
          {a.exclude && <p className="wb-muted"><b>exclude:</b> {a.exclude}</p>}
        </div>
        <div>
          <b>{b.id}</b> · {b.name}
          <Md source={b.definition} />
          {b.exclude && <p className="wb-muted"><b>exclude:</b> {b.exclude}</p>}
        </div>
      </div>
      <div className="wb-cmp-cols">
        <section>
          <h4>only {a.id} ({cols.onlyA.length})</h4>
          <ul>{cols.onlyA.map((e) => <Row key={e.id} e={e} move={{ to: b.id, fromFamily: famA }} onMove={onMove} />)}</ul>
        </section>
        <section className="wb-cmp-both">
          <h4>both ({cols.both.length})</h4>
          {cols.both.length > 0 && (
            <p className="wb-muted">
              Extracts carrying both codes. Two codes that always co-occur are one code, or a parent and a child.
            </p>
          )}
          <ul>{cols.both.map((e) => <Row key={e.id} e={e} onMove={onMove} />)}</ul>
        </section>
        <section>
          <h4>only {b.id} ({cols.onlyB.length})</h4>
          <ul>{cols.onlyB.map((e) => <Row key={e.id} e={e} move={{ to: a.id, fromFamily: famB }} onMove={onMove} />)}</ul>
        </section>
      </div>
    </div>
  );
}

// Hoisted for the same reason as the board's cards: a component declared inside another
// is a fresh type on every render, and React throws the subtree away each time.
function Row({ e, move, onMove }: {
  e: Extract;
  move?: { to: string; fromFamily: Set<string> };
  onMove: (e: Extract, to: string, fromFamily: Set<string>) => void;
}) {
  const losing = move ? e.codes.filter((c) => move.fromFamily.has(c)) : [];
  return (
    <li className="wb-cmp-row">
      <span className="wb-op-id">{e.id}</span>
      <span className="wb-cmp-p">{e.participant}</span>
      <span className="wb-cmp-kind">{KIND_GLYPH[e.kind]}</span>
      <span className="wb-cmp-text">{e.text.length > 180 ? e.text.slice(0, 180) + '…' : e.text}</span>
      {move && (
        <button
          className="wb-btn wb-btn-ghost"
          title={`recode: ${losing.map((c) => '−' + c).join(' ')} +${move.to}`}
          onClick={() => onMove(e, move.to, move.fromFamily)}
        >
          → {move.to}
        </button>
      )}
    </li>
  );
}
