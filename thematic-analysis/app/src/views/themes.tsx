// Themes as an affinity board.
//
// Assigning codes to themes is card sorting — HCI researchers do it on walls — and the
// document form was a mermaid graph you could read but not move. Columns are themes,
// cards are codes, and the card carries n/N and its kind mix, so a theme about behaviour
// resting on `intent` is visible before anybody writes it down.
import { useMemo, useState } from 'react';
import { loadMermaid } from '../api';
import { KIND_GLYPH, familyIndex } from '../codes';
import { draft } from '../ops';
import { themeWithPatch } from '../overlay';
import { ThemeInspector } from '../inspector/theme';
import type { Nav } from '../app';
import type { Workbench } from '../store';
import type { Code, Extract, Theme } from '../types';

const MISC = 'MISC';

export function ThemesView({ dir, wb, nav }: { dir: string; wb: Workbench; nav: Nav }) {
  const b = wb.bundle!;
  const [drag, setDrag] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [mermaid, setMermaid] = useState<string | null>(null);
  const hues = useMemo(() => familyIndex(b.codes), [b.codes]);
  const themes = useMemo(
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
    wb.stage(draft('assign-theme', drag, { theme: themeId }));
    setDrag(null);
  };

  return (
    <div className="wb-layout wb-layout-2">
      <main className="wb-main">
        <div className="wb-toolbar">
          <span className="wb-tool-title">
            <b>{themes.length}</b> theme(s) · {unplaced.length} code(s) unplaced · codebook v{b.codebook_version}
            {b.frozen ? ' (frozen)' : ''}
          </span>
          {naming ? (
            <span className="wb-inline-form">
              <input
                className="wb-input"
                autoFocus
                placeholder="the claim this theme makes"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                className="wb-btn wb-btn-primary"
                disabled={!newName.trim()}
                onClick={() => {
                  wb.stage(draft('new-theme', null, { name: newName.trim() }));
                  setNewName('');
                  setNaming(false);
                }}
              >
                stage the theme
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
              selected={nav.th === t.id}
              dragging={!!drag}
              onSelect={() => nav.go({ th: t.id })}
              onDrop={() => onDrop(t.id)}
              onDragStart={setDrag}
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
          {/* A theme the researcher just added exists only in the inbox until the agent
              applies it. Showing it as a ghost is what makes "+ theme" feel like it worked. */}
          {wb.patch.newThemes.map((o) => (
            <section key={o.id} className="wb-col wb-col-ghost">
              <header>
                <span className="wb-op-id">{o.id}</span>
                <b>{String((o.args as { name?: string }).name ?? 'new theme')}</b>
                <span className="wb-col-meta">staged · not applied yet</span>
              </header>
              <p className="wb-muted">
                The agent creates it on the next <code>apply</code>; codes can be dragged in after that.
              </p>
            </section>
          ))}
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
                onDragStart={setDrag}
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
          />
        ) : (
          <div className="wb-inspector wb-empty">
            <p>Drag a code into a theme; click a theme's header to write its essence, its story, and its tensions.</p>
            <p className="wb-muted">
              A theme is a claim ("Co-planning afforded steerability"), never a topic ("Trust"), and never an interview question restated.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

// Hoisted out of ThemesView on purpose: a component defined inside another is a new
// component *type* on every render, so React unmounts and remounts the whole board when
// any state changes — which throws away the node you are dragging, mid-drag.
function Card({ code, codes, N, hue, indent = false, onDragStart, onDragEnd, onOpen }: {
  code: Code;
  codes: Code[];
  N: number;
  hue: number;
  indent?: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: () => void;
}) {
  const kids = codes.filter((k) => k.parent === code.id && (k.status === 'accepted' || k.status === 'candidate'));
  return (
    <div
      className={`wb-card ${indent ? 'wb-card-child' : ''}`}
      draggable
      onDragStart={() => onDragStart(code.id)}
      onDragEnd={onDragEnd}
      style={{ ['--hue' as string]: hue }}
      onClick={onOpen}
      title={code.definition}
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
    </div>
  );
}

function Column({ theme, codes, N, hues, selected, dragging, onSelect, onDrop, onDragStart, onDragEnd, onOpenCode }: {
  theme: Theme;
  codes: Code[];
  N: number;
  hues: Record<string, number>;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDrop: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpenCode: (id: string) => void;
}) {
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
          {theme.n}/{theme.N} · {theme.extracts} ex · {theme.in_paper}
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
