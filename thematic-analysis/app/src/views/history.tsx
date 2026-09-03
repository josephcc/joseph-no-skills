// How the analysis got here.
//
// The memos, the codebook changelog, and the applied-operation logs, newest first. It is
// the audit trail the skill promises: the path from a participant's sentence to a
// published theme is reconstructible, and a co-author (or you in a month) can read it.
import { Md } from '../md';
import { describe } from '../ops';
import type { Workbench } from '../store';

export function HistoryView({ wb }: { wb: Workbench }) {
  const b = wb.bundle!;
  const applied = b.inbox.filter((o) => o.status === 'applied');
  return (
    <div className="wb-layout wb-layout-2">
      <main className="wb-main">
        <header className="wb-detail-head">
          <h2>History</h2>
          <span className="wb-muted">codebook v{b.codebook_version}{b.frozen ? ' · frozen' : ''}</span>
        </header>
        <section>
          <h3>Codebook changelog</h3>
          <ul className="wb-changelog">
            {[...b.changelog].reverse().map((c, i) => (
              <li key={i}>
                <b>v{c.version}</b> <span className="wb-muted">{c.date}</span> {c.change}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Memos</h3>
          <Md source={b.memos || '_no memos yet_'} />
        </section>
      </main>
      <aside className="wb-inspector-pane">
        <div className="wb-inspector">
          <h3>Applied operation logs</h3>
          {b.applied_logs.length ? (
            <ul>
              {b.applied_logs.map((f) => (
                <li key={f} className="wb-mono">
                  reviews/{f}
                </li>
              ))}
            </ul>
          ) : (
            <p className="wb-muted">Nothing has been applied yet.</p>
          )}
          {applied.length > 0 && (
            <>
              <h4>Still in the inbox, already applied</h4>
              <ul>
                {applied.map((o) => (
                  <li key={o.id}>
                    <span className="wb-op-id">{o.id}</span> {describe(o)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="wb-muted">
            Every applied pass is archived to <span className="wb-mono">reviews/YYYY-MM-DD-applied.jsonl</span>, beside the round documents.
          </p>
        </div>
      </aside>
    </div>
  );
}
