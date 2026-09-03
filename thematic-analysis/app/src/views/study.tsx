// The roster and the analytic stance, as a form.
//
// This is the first thing you do in a study and the one thing `validate` refuses to run
// without: deciding who counts as a participant is analytic work, not clerical. It was
// YAML; here it is fields. The stance already carries the skill's defaults (hybrid,
// semantic, realist, prevalence per participant), so this is where you disagree with
// them, not where you supply them.
import { useState } from 'react';
import { draft } from '../ops';
import type { Workbench } from '../store';

const ROLES = ['participant', 'interviewer', 'researcher', 'other'];
const STANCE: { key: string; label: string; options?: string[]; hint: string }[] = [
  { key: 'orientation', label: 'orientation', options: ['inductive', 'deductive', 'hybrid'], hint: 'most HCI studies are hybrid: the research questions shape what you look for, the codes come from the data' },
  { key: 'level', label: 'level', options: ['semantic', 'latent'], hint: 'semantic: what participants said and did, then interpreted' },
  { key: 'epistemology', label: 'epistemology', options: ['realist', 'contextualist', 'constructionist'], hint: '' },
  { key: 'prevalence_unit', label: 'prevalence unit', options: ['participant', 'extract'], hint: 'the participant: report n/N, never extract counts' },
];

export function StudyView({ wb }: { wb: Workbench }) {
  const b = wb.bundle!;
  const [notes, setNotes] = useState<string | null>(null);
  const stage = wb.stage;
  return (
    <div className="wb-layout wb-layout-1">
      <main className="wb-main">
        <header className="wb-detail-head">
          <h2>{b.study}</h2>
          <span className="wb-muted">{b.root}</span>
        </header>

        <section>
          <h3>The analytic stance</h3>
          <p className="wb-muted">
            Braun and Clarke ask for these to be decided before coding and stated in the method section. The skill's defaults are already
            here; change one only if this study really differs.
          </p>
          <table className="wb-table">
            <tbody>
              {STANCE.map((f) => (
                <tr key={f.key}>
                  <th>{f.label}</th>
                  <td>
                    <select
                      className="wb-select"
                      value={String(b.approach[f.key] ?? '')}
                      onChange={(e) => stage(draft('set-stance', null, { field: f.key, value: e.target.value }))}
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="wb-muted">{f.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="wb-field">
            <label>notes the method section can reuse</label>
            <textarea
              className="wb-textarea wb-tall"
              value={notes ?? String(b.approach.notes ?? '')}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== null && notes !== String(b.approach.notes ?? '')) stage(draft('set-stance', null, { field: 'notes', value: notes }));
                setNotes(null);
              }}
            />
          </div>
        </section>

        <section>
          <h3>Research questions</h3>
          <ul className="wb-rqs">
            {b.research_questions.map((r) => (
              <li key={r.id}>
                <b>{r.id}</b> {r.text}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>Roster</h3>
          <p className="wb-muted">
            Every speaker label a person has, mapped to the id the paper will use. Speech from anyone whose role is not{' '}
            <b>participant</b> is context, never data, and the script refuses to code it.
          </p>
          <table className="wb-table">
            <thead>
              <tr>
                <th>id</th>
                <th>role</th>
                <th>speaker labels</th>
                <th>group</th>
                <th>extracts</th>
                <th>transcripts</th>
              </tr>
            </thead>
            <tbody>
              {b.roster.map((p) => {
                const row = b.participants.find((x) => x.id === p.id);
                return (
                  <tr key={p.id} className={String(p.id).startsWith('TODO') ? 'wb-warn-row' : ''}>
                    <td>
                      <InlineText value={p.id} onSave={(v) => stage(draft('set-participant', p.id, { id: v }))} />
                    </td>
                    <td>
                      <select
                        className="wb-select"
                        value={p.role ?? ''}
                        onChange={(e) => stage(draft('set-participant', p.id, { role: e.target.value }))}
                      >
                        <option value="">unknown</option>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <InlineText
                        value={(p.speakers ?? []).join(', ')}
                        onSave={(v) => stage(draft('set-participant', p.id, { speakers: v.split(',').map((s) => s.trim()).filter(Boolean) }))}
                      />
                    </td>
                    <td>
                      <InlineText value={p.group ?? ''} onSave={(v) => stage(draft('set-participant', p.id, { group: v }))} />
                    </td>
                    <td>{row?.extracts ?? 0}</td>
                    <td>{row?.transcripts.join(', ') ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section>
          <h3>Transcripts</h3>
          <table className="wb-table">
            <thead>
              <tr>
                <th>id</th>
                <th>path</th>
                <th>participants</th>
                <th>kind</th>
                <th>frames</th>
              </tr>
            </thead>
            <tbody>
              {b.transcripts.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td className="wb-mono">{t.path}</td>
                  <td>
                    <InlineText
                      value={t.participants.join(', ')}
                      onSave={(v) => stage(draft('set-transcript', t.id, { participants: v.split(',').map((s) => s.trim()).filter(Boolean) }))}
                    />
                  </td>
                  <td>{t.kind ?? '—'}</td>
                  <td>{b.transcript_files[t.id]?.frames_dir ? 'yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

function InlineText({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(value);
  if (!editing)
    return (
      <button className="wb-inline-edit" onClick={() => (setD(value), setEditing(true))} title="edit">
        {value || <span className="wb-muted">—</span>}
      </button>
    );
  return (
    <span className="wb-inline-form">
      <input
        className="wb-input"
        autoFocus
        value={d}
        onChange={(e) => setD(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (d !== value) onSave(d);
            setEditing(false);
          }
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => {
          if (d !== value) onSave(d);
          setEditing(false);
        }}
      />
    </span>
  );
}
