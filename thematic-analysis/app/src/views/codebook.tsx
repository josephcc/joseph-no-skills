// The codebook as a structure, not a list of sections.
//
// The cleanup review asks comparative questions — is this parent hiding a child, is this
// child a special case of its sibling, are these two criteria the same criterion under
// two names — and a linear document can only show one code at a time. Here the tree
// carries prevalence and the duplicate flags, the detail pane is `collate` with the
// definition on top, and the moves are drags rather than options in a question.
import { useEffect, useMemo, useState } from 'react';
import { KIND_GLYPH, extractsForCode, familyIndex, health } from '../codes';
import { codeWithPatch, withPatch } from '../overlay';
import { draft } from '../ops';
import { CodeInspector } from '../inspector/code';
import { Compare } from './compare';
import { OverlapView } from './overlap';
import type { Nav } from '../app';
import type { Workbench } from '../store';
import type { Code, Extract } from '../types';

export function CodebookView({ dir, wb, nav }: { dir: string; wb: Workbench; nav: Nav }) {
  const b = wb.bundle!;
  const [filter, setFilter] = useState<string | null>(null);
  // Seeded from the URL so a merge proposal in the drawer, or a link in a round document, can
  // open the two codes side by side rather than just one of them.
  const [compare, setCompare] = useState<string | null>(nav.cmp);
  useEffect(() => setCompare(nav.cmp), [nav.cmp]);
  const [splitting, setSplitting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [drag, setDrag] = useState<string | null>(null);
  // The tree answers "what is the structure"; the cross-tab answers "is the structure right".
  // Overlap hides the rail because you are scanning a matrix, not navigating a tree.
  const [mode, setMode] = useState<'structure' | 'overlap'>('structure');
  const hues = useMemo(() => familyIndex(b.codes), [b.codes]);
  const patched = useMemo(() => b.codes.map((c) => codeWithPatch(c, wb.patch.codes[c.id])), [b.codes, wb.patch.codes]);
  const live = patched.filter((c) => c.status === 'candidate' || c.status === 'accepted');
  const strip = useMemo(() => health(b, patched), [b, patched]);
  const shownIds = filter ? new Set(strip.find((h) => h.key === filter)?.ids ?? []) : null;
  const selected = nav.c ? patched.find((c) => c.id === nav.c) ?? null : null;
  const other = compare ? patched.find((c) => c.id === compare) ?? null : null;

  const tree = useMemo(() => {
    const tops = live.filter((c) => !c.parent).sort((a, c) => a.id.localeCompare(c.id));
    return tops.map((parent) => ({
      parent,
      children: live.filter((c) => c.parent === parent.id).sort((a, c) => a.id.localeCompare(c.id)),
    }));
  }, [live]);

  const rows = useMemo(() => {
    const out: { code: Code & { pending: boolean }; depth: number }[] = [];
    for (const { parent, children } of tree) {
      const keepParent = !shownIds || shownIds.has(parent.id) || children.some((c) => shownIds.has(c.id));
      if (keepParent) out.push({ code: parent, depth: 0 });
      for (const c of children) if (!shownIds || shownIds.has(c.id) || shownIds.has(parent.id)) out.push({ code: c, depth: 1 });
    }
    return out;
  }, [tree, shownIds]);

  const selectedExtracts = useMemo(
    () => (selected ? extractsForCode(b.extracts_all, selected) : []),
    [b.extracts_all, selected],
  );
  const directExtracts = selectedExtracts.filter((e) => e.codes.includes(selected?.id ?? ''));
  const childExtracts = selectedExtracts.filter((e) => !e.codes.includes(selected?.id ?? ''));

  // A child is shown by the part after its parent's prefix — but only when it has one. A
  // code whose reparenting is still staged keeps its old top-level id, and a child whose id
  // does not follow the convention is a validate warning, not something to render as blank.
  const shortId = (c: Code): string =>
    c.parent && c.id.startsWith(c.parent + '.') ? c.id.slice(c.parent.length + 1) : c.id;

  const drop = (targetId: string | null) => {
    if (!drag || drag === targetId) return setDrag(null);
    wb.stage(draft('reparent', drag, { parent: targetId }));
    setDrag(null);
  };

  const showPair = (a: string, b: string) => {
    nav.go({ c: a });
    setCompare(b);
    setMode('structure');
  };
  const showCode = (id: string) => {
    nav.go({ c: id });
    setCompare(null);
    setMode('structure');
  };

  const modeSwitch = (
    <span className="wb-seg wb-mode">
      <button className={`wb-seg-btn ${mode === 'structure' ? 'wb-seg-on' : ''}`} onClick={() => setMode('structure')}>
        structure
      </button>
      <button
        className={`wb-seg-btn ${mode === 'overlap' ? 'wb-seg-on' : ''}`}
        onClick={() => setMode('overlap')}
        title="which codes are put on the same passage — merges, and codes doing too much"
      >
        overlap
      </button>
    </span>
  );

  if (mode === 'overlap') {
    return (
      <div className="wb-layout wb-layout-1">
        <main className="wb-main">
          {modeSwitch}
          <OverlapView data={b.cooccur} onPair={showPair} onCode={showCode} selected={nav.c ?? null} />
        </main>
      </div>
    );
  }

  return (
    <div className="wb-layout wb-layout-3">
      <aside className="wb-rail">
        <div className="wb-health">
          {strip.map((h) => (
            <button
              key={h.key}
              className={`wb-hbtn ${filter === h.key ? 'wb-hbtn-on' : ''} ${h.ids.length === 0 ? 'wb-hbtn-zero' : ''}`}
              title={`${h.label}: ${h.ids.join(', ') || 'none'}`}
              onClick={() => setFilter(filter === h.key ? null : h.key)}
            >
              <b>{h.ids.length}</b> {h.label}
            </button>
          ))}
        </div>
        <div
          className={`wb-droproot ${drag ? 'wb-droproot-live' : ''}`}
          onDragOver={(e) => drag && e.preventDefault()}
          onDrop={() => drop(null)}
        >
          drop here to promote to top level
        </div>
        <ul className="wb-tree">
          {rows.map(({ code, depth }) => {
            const dupe = b.dupes.some((d) => d.a === code.id || d.b === code.id);
            const patch = wb.patch.codes[code.id];
            const folding = patch?.mergedInto;
            const retiring = patch?.status === 'retired';
            const renaming2 = patch?.renamedTo;
            const splitting2 = patch?.splitInto ?? [];
            return (
              <li
                key={code.id}
                className={`wb-tnode wb-depth-${depth} ${nav.c === code.id ? 'wb-tnode-on' : ''} ${code.pending ? 'wb-tnode-pending' : ''}`}
                draggable
                onDragStart={() => setDrag(code.id)}
                onDragEnd={() => setDrag(null)}
                onDragOver={(e) => drag && depth === 0 && e.preventDefault()}
                onDrop={() => depth === 0 && drop(code.id)}
              >
                <button className="wb-tnode-btn" onClick={() => nav.go({ c: code.id })} title={code.definition}>
                  <span className="wb-tnode-line1">
                    <span className="wb-swatch" style={{ ['--hue' as string]: hues[code.id] ?? 0 }} />
                    {code.status === 'candidate' && <span className="wb-cand" title="candidate">◦</span>}
                    <code className={`wb-tnode-id ${folding || retiring || renaming2 ? 'wb-tnode-going' : ''}`}>{shortId(code)}</code>
                    {folding && <span className="wb-tnode-into" title={`staged: merge into ${folding}`}>→ {folding}</span>}
                    {retiring && <span className="wb-tnode-into" title="staged: retire">retiring</span>}
                    {renaming2 && <span className="wb-tnode-into" title={`staged: rename to ${renaming2}`}>→ {renaming2}</span>}
                    {splitting2.map((n) => (
                      <span key={n} className="wb-tnode-into" title={`staged: split ${n} out of this code`}>
                        ⑂ {n}
                      </span>
                    ))}
                    {dupe && !folding && <span className="wb-dupe" title="in a duplicate suspicion">⚠</span>}
                    {!code.reviewed && !folding && <span className="wb-newdot" title="never reviewed" />}
                  </span>
                  <span className="wb-tnode-line2">
                    <span className="wb-bar" title={`${code.n} of ${b.N} participants`}>
                      <span className="wb-bar-fill" style={{ width: `${b.N ? (code.n / b.N) * 100 : 0}%` }} />
                    </span>
                    <span className="wb-tnode-n">
                      {code.n}/{b.N}
                    </span>
                    <span className="wb-tnode-ex" title={`${code.extracts} extract(s) in this family`}>
                      {code.extracts}
                    </span>
                    <span className="wb-kindbar" title={`said ${code.kinds.said} · did ${code.kinds.did} · intent ${code.kinds.intent}`}>
                      {KIND_GLYPH.said.repeat(Math.min(5, code.kinds.said))}
                      {KIND_GLYPH.did.repeat(Math.min(5, code.kinds.did))}
                      {KIND_GLYPH.intent.repeat(Math.min(5, code.kinds.intent))}
                    </span>
                  </span>
                </button>
                <input
                  type="checkbox"
                  className="wb-tpick"
                  title="pick two codes to compare"
                  checked={picked.includes(code.id)}
                  onChange={(e) =>
                    setPicked(e.target.checked ? [...picked.slice(-1), code.id] : picked.filter((p) => p !== code.id))
                  }
                />
              </li>
            );
          })}
        </ul>
        <div className="wb-actions wb-wrap">
          <button className="wb-btn wb-btn-ghost" disabled={picked.length !== 2} onClick={() => (nav.go({ c: picked[0] }), setCompare(picked[1]))}>
            compare the two picked
          </button>
          <button
            className="wb-btn wb-btn-primary"
            title="stamp every live code as reviewed at this version"
            onClick={() => wb.stage(draft('mark-reviewed', null, { codes: live.map((c) => c.id) })).then(() => wb.say('Codebook marked reviewed.'))}
          >
            Done with this round
          </button>
        </div>
        <p className="wb-muted">Drag a code onto a top-level code to make it a child; drop it above to promote it.</p>
      </aside>

      <main className="wb-main">
        {modeSwitch}
        {other && selected ? (
          <Compare a={selected} b={other} extracts={b.extracts_all} wb={wb} onClose={() => (setCompare(null), setPicked([]))} />
        ) : selected ? (
          <>
            <header className="wb-detail-head">
              <h2>
                <code>{selected.id}</code> {selected.name}
              </h2>
              <span className="wb-muted">
                {directExtracts.length} on this code{childExtracts.length ? `, ${childExtracts.length} on its children` : ''}
              </span>
            </header>
            {splitting ? (
              <SplitForm
                code={selected}
                extracts={directExtracts}
                onCancel={() => setSplitting(false)}
                onSubmit={(newId, name, definition, ids) => {
                  wb.stage(draft('split-code', selected.id, { new_id: newId, name, definition, extracts: ids }));
                  setSplitting(false);
                }}
              />
            ) : null}
            <ExtractList
              title={`Coded to ${selected.id} itself`}
              extracts={directExtracts}
              nav={nav}
              hues={hues}
              wb={wb}
              empty="nothing is coded to the parent directly."
            />
            {childExtracts.length > 0 && (
              <ExtractList
                title="Coded to its children"
                extracts={childExtracts}
                nav={nav}
                hues={hues}
                wb={wb}
                empty=""
              />
            )}
          </>
        ) : (
          <div className="wb-empty">
            <p>Pick a code. The pane shows its definition and every extract that carries it, grouped so you can read one code across all participants.</p>
            <p className="wb-muted">
              That read is the check on consistency: whether the definition was applied the same way in interview nine as in interview two.
            </p>
          </div>
        )}
      </main>

      <aside className="wb-inspector-pane">
        {selected ? (
          <CodeInspector
            code={selected}
            codes={patched}
            dupes={b.dupes}
            wb={wb}
            N={b.N}
            users={directExtracts}
            onCompare={(id) => setCompare(id)}
            onSplit={() => setSplitting(true)}
            onJumpToTheme={(id) => nav.go({ view: 'themes', th: id })}
          />
        ) : (
          <div className="wb-inspector wb-empty">
            <p className="wb-muted">
              {b.dupes.length
                ? `${b.dupes.length} duplicate suspicion(s) to settle. Pick a code to see its neighbours.`
                : 'No duplicate suspicions right now.'}
            </p>
            <p className="wb-muted">Codebook v{b.codebook_version}{b.frozen ? ', frozen' : ''} · {dir}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function ExtractList({ title, extracts, nav, hues, wb, empty }: {
  title: string;
  extracts: Extract[];
  nav: Nav;
  hues: Record<string, number>;
  wb: Workbench;
  empty: string;
}) {
  const byP = new Map<string, Extract[]>();
  for (const e of extracts) byP.set(e.participant, [...(byP.get(e.participant) ?? []), e]);
  // Reading a code across participants is exactly when you notice a stray, so the fix belongs
  // here rather than a trip to the transcript. Taking the last code off an extract is a
  // different act — that is dropping the extract — so it asks first.
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  return (
    <section className="wb-collate">
      <h3>
        {title} <span className="wb-muted">{extracts.length} extract(s), {byP.size} participant(s)</span>
      </h3>
      {!extracts.length && empty && <p className="wb-muted">{empty}</p>}
      {[...byP.entries()].map(([pid, rows]) => (
        <div key={pid} className="wb-collate-group">
          <h4>{pid}</h4>
          <ul>
            {rows.map((raw) => {
              // The row must show what is staged, not what is stored: a chip removed here has to
              // keep its place, struck through, or the click leaves no trace in the view it was
              // made from and the only evidence is a toast that has already gone.
              const e = withPatch(raw, wb.patch.extracts[raw.id]);
              const shown = [...new Set([...raw.codes, ...e.codes])];
              return (
              <li key={e.id} className={`wb-cl-row ${e.dropped ? 'wb-dropped' : ''}`}>
                <button className="wb-op-id" title="open this in its transcript" onClick={() => nav.go({ view: 'transcript', t: e.transcript, e: e.id })}>
                  {e.id}
                </button>
                <span className="wb-cl-kind" title={e.kind}>
                  {KIND_GLYPH[e.kind]}
                </span>
                <span className="wb-cl-codes">
                  {shown.map((c) => {
                    const going = !e.codes.includes(c);
                    const arriving = !raw.codes.includes(c);
                    return (
                      <span
                        key={c}
                        className={`wb-mini-token ${going ? 'wb-mini-going' : ''} ${arriving ? 'wb-mini-new' : ''}`}
                        style={{ ['--hue' as string]: hues[c] ?? 0 }}
                        title={going ? `staged: ${c} comes off ${e.id} — undo it in the pending drawer` : undefined}
                      >
                        {c}
                        {going ? (
                          <span className="wb-mini-flag">staged</span>
                        ) : (
                          <button
                            className="wb-mini-x"
                            title={e.codes.length > 1 ? `take ${c} off ${e.id}` : `${c} is the only code on ${e.id}`}
                            onClick={() =>
                              e.codes.length > 1
                                ? wb.stage(draft('recode', e.id, { remove: [c] }))
                                : setConfirmDrop(e.id)
                            }
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })}
                </span>
                {confirmDrop === e.id && (
                  <span className="wb-cl-confirm wb-warn">
                    that is its only code — drop {e.id}?
                    <button
                      className="wb-btn wb-btn-danger wb-tiny"
                      onClick={() => (wb.stage(draft('drop', e.id, {}, 'last code removed in the codebook review')), setConfirmDrop(null))}
                    >
                      drop it
                    </button>
                    <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => setConfirmDrop(null)}>
                      keep
                    </button>
                  </span>
                )}
                {e.highlight && <span className="wb-echip-star" title={e.highlight}>★</span>}
                {e.new && <span className="wb-new">new</span>}
                <span className="wb-cl-text">{e.text}</span>
              </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function SplitForm({ code, extracts, onSubmit, onCancel }: {
  code: Code;
  extracts: Extract[];
  onSubmit: (newId: string, name: string, definition: string, ids: string[]) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [def, setDef] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  return (
    <div className="wb-split">
      <h3>Split a child out of {code.id}</h3>
      <p className="wb-muted">
        Tick the extracts that belong to the narrower code. They move to the child; the child arrives as a candidate for the next round.
      </p>
      <div className="wb-row">
        <input className="wb-input" placeholder="child id (kebab-case)" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="wb-input" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <textarea className="wb-textarea" placeholder="definition — the rule a second coder would apply" value={def} onChange={(e) => setDef(e.target.value)} />
      <ul className="wb-split-list">
        {extracts.map((e) => (
          <li key={e.id}>
            <label>
              <input
                type="checkbox"
                checked={ids.includes(e.id)}
                onChange={(ev) => setIds(ev.target.checked ? [...ids, e.id] : ids.filter((x) => x !== e.id))}
              />
              <span className="wb-op-id">{e.id}</span> <span className="wb-cl-p">{e.participant}</span> {e.text.slice(0, 140)}
              {e.text.length > 140 ? '…' : ''}
            </label>
          </li>
        ))}
      </ul>
      <div className="wb-actions">
        <button className="wb-btn wb-btn-primary" disabled={!id.trim() || !ids.length} onClick={() => onSubmit(id.trim(), name.trim(), def.trim(), ids)}>
          stage the split ({ids.length} extract{ids.length === 1 ? '' : 's'})
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={onCancel}>
          cancel
        </button>
      </div>
    </div>
  );
}
