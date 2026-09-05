// Themes as an affinity board.
//
// Assigning codes to themes is card sorting — HCI researchers do it on walls — and the
// document form was a mermaid graph you could read but not move. Columns are themes,
// cards are codes, and the card carries n/N and its kind mix, so a theme about behaviour
// resting on `intent` is visible before anybody writes it down.
//
// Every gesture here is the researcher's own decision, and is carried out at once: `+ theme`
// creates the theme, a drop moves the card, a field edit lands — so the moment the reading
// arrives is the moment it can be written down. What waits are the agent's proposals, drawn
// as dashed cards until they are accepted (by leaving them) or rejected. Above the board sits
// the agent's reading of the paper draft, because a theme is drafted against what the paper
// argues, and a misreading there has to be visible before a proposal is made on the strength
// of it.
import { useMemo, useState } from 'react';
import { loadMermaid } from '../api';
import { KIND_GLYPH, familyIndex } from '../codes';
import { draft } from '../ops';
import { themeWithPatch } from '../overlay';
import { ThemeInspector } from '../inspector/theme';
import { Md } from '../md';
import type { Nav } from '../app';
import type { Workbench } from '../store';
import type { Code, Extract, Op, Theme } from '../types';

const MISC = 'MISC';
type Shown = Theme & { pending?: boolean };

export function ThemesView({ dir, wb, nav }: { dir: string; wb: Workbench; nav: Nav }) {
  const b = wb.bundle!;
  // The card being dragged, and the column it left: a code may sit in several themes, so a drop
  // moves this card's membership and no other.
  const [drag, setDrag] = useState<{ code: string; from: string | null } | null>(null);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [mermaid, setMermaid] = useState<string | null>(null);
  const hues = useMemo(() => familyIndex(b.codes), [b.codes]);
  const themes = useMemo<Shown[]>(
    () => b.themes.map((t) => themeWithPatch(t, wb.patch.themes[t.id])).filter((t) => t.status !== 'merged' && t.status !== 'dropped'),
    [b.themes, wb.patch.themes],
  );
  // Cards are codes, children included: a theme can gather `trust.spot-check` without its
  // parent, and `themes.yaml` has always allowed that. Children follow their parent in the
  // unplaced column, so a 35-code codebook still reads as a structure.
  const live = b.codes.filter((c) => c.status === 'candidate' || c.status === 'accepted');
  const placed = new Set(themes.flatMap((t) => t.codes));
  const unplaced = live
    .filter((c) => !placed.has(c.id))
    .sort(
      (a, c) =>
        (a.parent ?? a.id).localeCompare(c.parent ?? c.id) ||
        Number(!!a.parent) - Number(!!c.parent) ||
        a.id.localeCompare(c.id),
    );
  const selected = nav.th ? themes.find((t) => t.id === nav.th) ?? null : null;
  const errands =
    themes.reduce((n, t) => n + t.requests.filter((r) => r.status !== 'done').length, 0) +
    Object.values(wb.patch.themes).reduce((n, p) => n + p.requests.length, 0);

  const extractsOf = (t: Theme): Extract[] => {
    const fam = new Set(t.family?.length ? t.family : t.codes);
    for (const cid of t.codes) {
      const c = b.codes.find((x) => x.id === cid);
      for (const f of c?.family ?? []) fam.add(f);
    }
    return b.extracts_all
      .filter((e) => e.codes.some((c) => fam.has(c)))
      .sort((x, y) => x.participant.localeCompare(y.participant) || x.line_start - y.line_start);
  };

  const onDrop = (themeId: string | null) => {
    if (!drag) return;
    if (drag.from !== themeId) wb.stage(draft('assign-theme', drag.code, { theme: themeId, ...(drag.from ? { from: drag.from } : {}) }));
    setDrag(null);
  };

  return (
    <div className="wb-layout wb-layout-2">
      <main className="wb-main">
        <div className="wb-toolbar">
          <span className="wb-tool-title">
            <b>{themes.length}</b> theme(s) · {unplaced.length} code(s) unplaced · codebook v{b.codebook_version}
            {b.frozen ? ' (frozen)' : ''}
            {errands > 0 ? ` · ${errands} errand(s) for the agent` : ''}
          </span>
          {naming ? (
            <span className="wb-inline-form">
              <input
                className="wb-input"
                autoFocus
                placeholder="the claim this theme makes"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setNaming(false);
                  if (e.key === 'Enter' && newName.trim()) {
                    wb.stage(draft('new-theme', null, { name: newName.trim() })).then((o) => o?.created && nav.go({ th: o.created }));
                    setNewName('');
                    setNaming(false);
                  }
                }}
              />
              <button
                className="wb-btn wb-btn-primary"
                disabled={!newName.trim()}
                onClick={() => {
                  // The theme exists as soon as the script has written it; open its inspector so
                  // the brief can be written while the reading is fresh.
                  wb.stage(draft('new-theme', null, { name: newName.trim() })).then((o) => o?.created && nav.go({ th: o.created }));
                  setNewName('');
                  setNaming(false);
                }}
              >
                create the theme
              </button>
              <button className="wb-btn wb-btn-ghost" onClick={() => setNaming(false)}>
                cancel
              </button>
            </span>
          ) : (
            <button className="wb-btn wb-btn-ghost" onClick={() => setNaming(true)}>
              + theme
            </button>
          )}
          <button
            className="wb-btn wb-btn-ghost"
            onClick={() => loadMermaid(dir).then((m) => setMermaid(m.mermaid)).catch((e: Error) => wb.say(e.message))}
            title="the map, drawn from themes.yaml, for the round document"
          >
            mermaid
          </button>
        </div>
        {!b.frozen && (
          <p className="wb-muted">
            The codebook is not frozen yet. Themes built on a moving codebook move with it; freeze it after the last interview.
          </p>
        )}
        <Framing wb={wb} />
        {mermaid && (
          <div className="wb-mermaid">
            <header>
              <b>Thematic map</b>
              <button className="wb-btn wb-btn-ghost" onClick={() => navigator.clipboard?.writeText(mermaid).then(() => wb.say('Copied.'))}>
                copy
              </button>
              <button className="wb-btn wb-btn-ghost" onClick={() => setMermaid(null)}>
                close
              </button>
            </header>
            <pre>{mermaid}</pre>
          </div>
        )}
        <div className="wb-board">
          {[...themes.filter((t) => t.id !== MISC), ...themes.filter((t) => t.id === MISC)].map((t) => (
            <Column
              key={t.id}
              theme={t}
              codes={b.codes}
              N={b.N}
              hues={hues}
              proposed={wb.patch.themes[t.id]?.proposedCodes ?? {}}
              selected={nav.th === t.id}
              dragging={!!drag}
              onSelect={() => nav.go({ th: t.id })}
              onDrop={() => onDrop(t.id)}
              onDragStart={(cid) => setDrag({ code: cid, from: t.id })}
              onDragEnd={() => setDrag(null)}
              onOpenCode={(cid) => nav.go({ view: 'codebook', c: cid })}
            />
          ))}
          {/* The miscellaneous pile is allowed and temporary (phase 3). It only needs its own
              drop zone until the theme exists; after that its column is the drop zone. */}
          {!themes.some((t) => t.id === MISC) && (
            <section
              className={`wb-col wb-col-misc ${drag ? 'wb-col-live' : ''}`}
              onDragOver={(e) => drag && e.preventDefault()}
              onDrop={() => onDrop(MISC)}
            >
              <header>
                <b>miscellaneous</b>
                <span className="wb-col-meta">allowed, and temporary</span>
              </header>
              <p className="wb-muted">drop a code here to park it</p>
            </section>
          )}
          <section
            className={`wb-col wb-col-unplaced ${drag ? 'wb-col-live' : ''}`}
            onDragOver={(e) => drag && e.preventDefault()}
            onDrop={() => onDrop(null)}
          >
            <header>
              <b>unplaced</b>
              <span className="wb-col-meta">{unplaced.length}</span>
            </header>
            {unplaced.map((c) => (
              <Card
                key={c.id}
                code={c}
                indent={!!c.parent}
                codes={b.codes}
                N={b.N}
                hue={hues[c.id] ?? 0}
                onDragStart={(cid) => setDrag({ code: cid, from: null })}
                onDragEnd={() => setDrag(null)}
                onOpen={() => nav.go({ view: 'codebook', c: c.id })}
              />
            ))}
          </section>
        </div>
      </main>

      <aside className="wb-inspector-pane">
        {selected ? (
          <ThemeInspector
            theme={selected}
            extracts={extractsOf(selected)}
            wb={wb}
            rqs={b.research_questions}
            onJumpToExtract={(e) => nav.go({ view: 'transcript', t: e.transcript, e: e.id })}
            onOpenCode={(cid) => nav.go({ view: 'codebook', c: cid })}
          />
        ) : (
          <div className="wb-inspector wb-empty">
            <p>Drag a code into a theme; click a theme's header to write its brief, its essence, its story, and its tensions.</p>
            <p className="wb-muted">
              A theme is a claim ("Co-planning afforded steerability"), never a topic ("Trust"), and never an interview question restated.
            </p>
            <p className="wb-muted">
              Everything you do here happens at once — a theme you create is a column, a card you drop has moved. Write the brief while
              the reading is fresh, then ask the agent for the codes you might be missing; its proposals come back as dashed cards.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/** What the paper argues, as the agent read it — above the board, so every theme is drafted
 *  against a visible framing rather than a remembered one, and a misreading is corrected here
 *  before anything is proposed on the strength of it. */
function Framing({ wb }: { wb: Workbench }) {
  const b = wb.bundle!;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const shown = wb.patch.framing ?? b.framing;
  const [d, setD] = useState(shown);
  if (!b.paper.length && !shown) {
    return (
      <p className="wb-muted">
        No paper draft is registered. <code>ta.py paper --add &lt;path&gt;</code> names one; the agent then reads it in full at the start of
        theme work and writes what the paper argues here, so the themes are drafted against it.
      </p>
    );
  }
  return (
    <section className="wb-framing">
      <header onClick={() => setOpen((v) => !v)}>
        <b>What the paper argues{shown ? '' : ' — not yet written'}</b>
        {wb.patch.framing !== undefined && <span className="wb-staged">staged</span>}
        <span className="wb-framing-drafts">
          {b.paper.map((p) => `${p.path}${p.exists ? (p.words != null ? ` · ${p.words}w` : '') : ' · missing'}`).join(' · ') || 'no draft registered'}
        </span>
        <span className="wb-muted">{open ? '▾' : '▸'}</span>
      </header>
      {open && !editing && (
        <div className="wb-framing-body">
          {shown ? <Md source={shown} /> : <p className="wb-muted">The agent writes this after reading the draft(s) in full: <code>ta.py paper --framing "..."</code>.</p>}
          <div className="wb-actions">
            <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => (setD(shown), setEditing(true))}>
              ✎ correct it
            </button>
          </div>
        </div>
      )}
      {open && editing && (
        <div className="wb-framing-body">
          <textarea className="wb-textarea wb-tall" autoFocus value={d} onChange={(e) => setD(e.target.value)} />
          <div className="wb-actions">
            <button
              className="wb-btn wb-btn-primary"
              disabled={d.trim() === shown.trim()}
              onClick={() => {
                // `old` is the text this edit was made against — the staged one when there is one —
                // so two corrections staged in a row apply in order instead of the second being refused.
                wb.stage(draft('set-framing', null, { value: d.trim(), old: shown }));
                setEditing(false);
              }}
            >
              save the correction
            </button>
            <button className="wb-btn wb-btn-ghost" onClick={() => setEditing(false)}>
              cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Hoisted out of ThemesView on purpose: a component defined inside another is a new
// component *type* on every render, so React unmounts and remounts the whole board when
// any state changes — which throws away the node you are dragging, mid-drag.
function Card({ code, codes, N, hue, indent = false, proposedBy, onDragStart, onDragEnd, onOpen }: {
  code: Code;
  codes: Code[];
  N: number;
  hue: number;
  indent?: boolean;
  /** The agent's `assign-theme` behind this card, when it is a proposal rather than a decision. */
  proposedBy?: Op;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const kids = codes.filter((k) => k.parent === code.id && (k.status === 'accepted' || k.status === 'candidate'));
  const why = proposedBy ? String((proposedBy.args as { why?: string }).why ?? '') : '';
  return (
    <div
      className={`wb-card ${indent ? 'wb-card-child' : ''} ${proposedBy ? 'wb-card-proposed' : ''}`}
      draggable
      onDragStart={() => onDragStart(code.id)}
      onDragEnd={onDragEnd}
      style={{ ['--hue' as string]: hue }}
      onClick={onOpen}
      title={proposedBy ? `proposed by the agent${why ? `: ${why}` : ''}` : code.definition}
    >
      <b title={code.id}>
        {code.parent && code.id.startsWith(code.parent + '.') ? code.id.slice(code.parent.length + 1) : code.id}
      </b>
      <span className="wb-card-n">
        {code.n}/{N}
      </span>
      <span className="wb-card-kinds">
        {KIND_GLYPH.said.repeat(Math.min(4, code.kinds.said))}
        {KIND_GLYPH.did.repeat(Math.min(4, code.kinds.did))}
        {KIND_GLYPH.intent.repeat(Math.min(4, code.kinds.intent))}
      </span>
      {kids.length > 0 && <span className="wb-card-kids">+{kids.length} child{kids.length > 1 ? 'ren' : ''}</span>}
      {proposedBy && <span className="wb-card-tag">proposed by the agent</span>}
    </div>
  );
}

function Column({ theme, codes, N, hues, proposed, selected, dragging, onSelect, onDrop, onDragStart, onDragEnd, onOpenCode }: {
  theme: Shown;
  codes: Code[];
  N: number;
  hues: Record<string, number>;
  proposed: Record<string, Op>;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDrop: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpenCode: (id: string) => void;
}) {
  const open = theme.requests.filter((r) => r.status !== 'done').length;
  return (
    <section
      className={`wb-col ${selected ? 'wb-col-on' : ''} ${dragging ? 'wb-col-live' : ''}`}
      onDragOver={(e) => dragging && e.preventDefault()}
      onDrop={onDrop}
    >
      <header onClick={onSelect}>
        <span className="wb-op-id">{theme.id}</span>
        <b>{theme.name}</b>
        <span className="wb-col-meta">
          {`${theme.n}/${theme.N} · ${theme.extracts} ex · ${theme.in_paper}`}
          {open ? ` · ${open} errand${open > 1 ? 's' : ''}` : ''}
          {theme.claims.length ? ` · ${theme.claims.length} claim${theme.claims.length > 1 ? 's' : ''}${theme.claims_stale.length ? ' (stale)' : ''}` : ''}
        </span>
      </header>
      {theme.codes.map((cid) => {
        const c = codes.find((x) => x.id === cid);
        return c ? (
          <Card
            key={cid}
            code={c}
            codes={codes}
            N={N}
            hue={hues[cid] ?? 0}
            indent={!!c.parent}
            proposedBy={proposed[cid]}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onOpen={() => onOpenCode(cid)}
          />
        ) : null;
      })}
      {!theme.codes.length && <p className="wb-muted">drop a code here</p>}
    </section>
  );
}
