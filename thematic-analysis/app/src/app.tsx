// The workbench shell: one header, seven views, one inspector, one pending drawer.
//
// The five review moments this replaces were each a document or a terminal command:
// reviewing the coding of an interview, reviewing the codebook whole, reading coverage,
// building themes, and picking quotes. They are views here because none of them is a
// linear document — but the round documents stay, and this links back to them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { analysisDir, param } from './api';
import { useWorkbench } from './store';
import { PendingDrawer } from './pending';
import { TranscriptView } from './views/transcript';
import { CodebookView } from './views/codebook';
import { CoverageView } from './views/coverage';
import { ThemesView } from './views/themes';
import { QuotesView } from './views/quotes';
import { StudyView } from './views/study';
import { HistoryView } from './views/history';
import { isThread } from './ops';

export type ViewName = 'transcript' | 'codebook' | 'coverage' | 'themes' | 'quotes' | 'study' | 'history';
const VIEWS: { key: ViewName; label: string; phase: string }[] = [
  { key: 'transcript', label: 'Transcript', phase: 'phase 1–2: is this interview coded right?' },
  { key: 'codebook', label: 'Codebook', phase: 'phase 2: is the codebook one structure?' },
  { key: 'coverage', label: 'Coverage', phase: 'phase 2: who and what did we miss?' },
  { key: 'themes', label: 'Themes', phase: 'phase 3–5: what story do the codes tell?' },
  { key: 'quotes', label: 'Quotes', phase: 'phase 4: which words go in the paper?' },
  { key: 'study', label: 'Study', phase: 'the roster and the analytic stance' },
  { key: 'history', label: 'History', phase: 'memos, the changelog, and what has been applied' },
];

export interface Nav {
  view: ViewName;
  t: string | null;
  e: string | null;
  c: string | null;
  th: string | null;
  go: (patch: Partial<Omit<Nav, 'go'>>) => void;
}

export function App() {
  const dir = analysisDir();
  const wb = useWorkbench(dir);
  const [view, setView] = useState<ViewName>((param('view') as ViewName) ?? 'transcript');
  const [t, setT] = useState<string | null>(param('t'));
  const [e, setE] = useState<string | null>(param('e'));
  const [c, setC] = useState<string | null>(param('c'));
  const [th, setTh] = useState<string | null>(param('th'));
  const [drawer, setDrawer] = useState(false);

  const go = useCallback((patch: Partial<Omit<Nav, 'go'>>) => {
    if (patch.view !== undefined) setView(patch.view);
    if (patch.t !== undefined) setT(patch.t);
    if (patch.e !== undefined) setE(patch.e);
    if (patch.c !== undefined) setC(patch.c);
    if (patch.th !== undefined) setTh(patch.th);
  }, []);
  const nav: Nav = { view, t, e, c, th, go };

  // Keep the URL a deep link, so a round document can point at a code or an extract
  // and a reload lands in the same place.
  useEffect(() => {
    if (!dir) return;
    const q = new URLSearchParams({ analysis: dir, view });
    if (t) q.set('t', t);
    if (e) q.set('e', e);
    if (c) q.set('c', c);
    if (th) q.set('th', th);
    window.history.replaceState(null, '', `?${q}`);
  }, [dir, view, t, e, c, th]);

  // Default to the transcript with the most new extracts: the review actually waiting.
  useEffect(() => {
    if (view !== 'transcript' || t || !wb.bundle) return;
    const rows = [...wb.bundle.transcripts].sort((a, b) => b.new_extracts - a.new_extracts || a.id.localeCompare(b.id));
    if (rows.length) setT(rows[0].id);
  }, [view, t, wb.bundle]);

  const pendingCount = wb.pending.filter((o) => !isThread(o)).length;
  const threadCount = wb.pending.filter((o) => o.op === 'comment').length;
  const applyHint = useMemo(
    () => `uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d ${wb.bundle?.root ?? '<analysis>'} apply --all`,
    [wb.bundle?.root],
  );

  if (!dir)
    return (
      <div className="wb-loading">
        No analysis folder. Open the workbench with{' '}
        <code>uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d &lt;analysis&gt; open</code>.
      </div>
    );
  if (wb.error && !wb.bundle) return <div className="wb-loading wb-error">{wb.error}</div>;
  if (!wb.bundle) return <div className="wb-loading">Reading the analysis folder…</div>;

  const b = wb.bundle;
  const coded = b.transcripts.filter((x) => x.coded_with_version != null).length;
  const staleRows = b.stale.stale;
  const recodeNeeded = staleRows.filter((r) => r.severity === 'recode');

  return (
    <div className="wb-app">
      <header className="wb-header">
        <div className="wb-header-main">
          <h1>{b.study}</h1>
          <div className="wb-chips">
            <span className="wb-chip">
              <b>codebook</b> v{b.codebook_version} {b.frozen ? '· frozen' : ''}
            </span>
            <span className="wb-chip">
              <b>coded</b> {coded}/{b.transcripts.length}
            </span>
            {staleRows.length > 0 && (
              <span
                className={`wb-chip ${recodeNeeded.length ? 'wb-chip-warn' : ''}`}
                title={staleRows.map((r) => `${r.transcript}: ${r.reason}`).join('\n')}
              >
                <b>stale</b> {staleRows.length}
                {recodeNeeded.length ? ` · ${recodeNeeded.length} need a pass` : ' · version only'}
              </span>
            )}
            <span className="wb-chip">
              <b>extracts</b> {b.total_extracts} · {b.N} participants
            </span>
            {b.dupes.length > 0 && (
              <span className="wb-chip" title={b.dupes.map((d) => `${d.a} / ${d.b}: ${d.text}`).join('\n')}>
                <b>dupes</b> {b.dupes.length}
              </span>
            )}
          </div>
        </div>
        <div className="wb-header-side">
          {threadCount > 0 && <span className="wb-threadcount">{threadCount} thread{threadCount > 1 ? 's' : ''}</span>}
          <button className={`wb-pending ${pendingCount ? 'wb-pending-on' : ''}`} onClick={() => setDrawer((d) => !d)}>
            Pending ({pendingCount})
          </button>
        </div>
      </header>

      <nav className="wb-nav">
        {VIEWS.map((v) => (
          <button key={v.key} className={`wb-tab ${view === v.key ? 'wb-tab-on' : ''}`} title={v.phase} onClick={() => go({ view: v.key })}>
            {v.label}
          </button>
        ))}
        <span className="wb-nav-phase">{VIEWS.find((v) => v.key === view)?.phase}</span>
      </nav>

      {wb.toast && <div className="wb-toast">{wb.toast}</div>}

      {view === 'transcript' && <TranscriptView dir={dir} wb={wb} nav={nav} />}
      {view === 'codebook' && <CodebookView dir={dir} wb={wb} nav={nav} />}
      {view === 'coverage' && <CoverageView wb={wb} nav={nav} />}
      {view === 'themes' && <ThemesView dir={dir} wb={wb} nav={nav} />}
      {view === 'quotes' && <QuotesView wb={wb} nav={nav} />}
      {view === 'study' && <StudyView wb={wb} />}
      {view === 'history' && <HistoryView wb={wb} />}

      {drawer && <PendingDrawer ops={wb.pending} onUndo={wb.undo} onClose={() => setDrawer(false)} applyHint={applyHint} />}
    </div>
  );
}
