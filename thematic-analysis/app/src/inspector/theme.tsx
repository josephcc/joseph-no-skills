// The theme inspector: phases 3 to 5 in one pane, ordered as the work is done.
//
// The essence carries Braun and Clarke's scope test — if it will not fit in two
// sentences the theme is doing too much — so the counter is in the label. The brief is the
// researcher's own: the rule a code assignment is judged against, the near-miss, and what
// they mean to write; it is the one field with no counter, no test, and no warning on it,
// because it is allowed to be wrong. Below it sit the agent's proposals — a tray of codes
// with a line of why each, accepted by leaving them staged and rejected by undoing them —
// and the agent's claims, which are its summary of what the evidence supports and are never
// staged for acceptance: the researcher judges those when writing the paper. Tensions are a
// list rather than a field you remember to fill, because a pattern with no exceptions in
// twelve interviews is one you have not looked at hard enough.
import { useState } from 'react';
import { Md } from '../md';
import { KIND_GLYPH } from '../codes';
import { draft, isPending } from '../ops';
import { CommentComposer, ThreadCard, threadsFor } from '../threads';
import type { Claim, Code, Extract, InPaper, Op, Theme } from '../types';
import type { Workbench } from '../store';

const IN_PAPER: InPaper[] = ['undecided', 'headline', 'secondary', 'no'];
const sentences = (s: string) => (s.trim() ? s.trim().split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length : 0);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function Field({ label, value, hint, multiline, tall, placeholder, onSave, onComment }: {
  label: string;
  value: string;
  hint?: string;
  multiline?: boolean;
  tall?: boolean;
  placeholder?: string;
  onSave: (next: string, old: string) => void;
  onComment: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState(value);
  if (!editing)
    return (
      <div className="wb-field">
        <label>
          {label}
          <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => (setD(value), setEditing(true))} title="edit">
            ✎
          </button>
        </label>
        {value ? <Md source={value} /> : <p className="wb-muted">{placeholder ?? 'not written yet'}</p>}
        {hint && <p className="wb-muted">{hint}</p>}
      </div>
    );
  return (
    <div className="wb-field">
      <label>{label}</label>
      {multiline ? (
        <textarea className={`wb-textarea ${tall ? 'wb-tall' : ''}`} autoFocus value={d} onChange={(e) => setD(e.target.value)} />
      ) : (
        <input className="wb-input" autoFocus value={d} onChange={(e) => setD(e.target.value)} />
      )}
      {label.startsWith('essence') && (
        <p className={sentences(d) > 2 ? 'wb-warn' : 'wb-muted'}>
          {sentences(d)} sentence{sentences(d) === 1 ? '' : 's'} — the scope test is that it fits in a couple.
        </p>
      )}
      <div className="wb-actions">
        <button className="wb-btn wb-btn-primary" disabled={d.trim() === value.trim()} onClick={() => (onSave(d.trim(), value), setEditing(false))}>
          save
        </button>
        <button className="wb-btn wb-btn-ghost" onClick={() => setEditing(false)}>
          cancel
        </button>
        <CommentComposer label="ask instead" onSubmit={(text) => (onComment(text), setEditing(false))} />
      </div>
    </div>
  );
}

/** One code the agent proposes for this theme: the case, the numbers, two of its extracts. */
function ProposedCard({ op, code, N, placedIn, extracts, onAccept, onReject, onOpenCode, onJumpToExtract }: {
  op: Op;
  code: Code | undefined;
  N: number;
  placedIn: string[];
  extracts: Extract[];
  onAccept: () => void;
  onReject: () => void;
  onOpenCode: () => void;
  onJumpToExtract: (e: Extract) => void;
}) {
  const why = String((op.args as { why?: string }).why ?? '');
  return (
    <div className="wb-tray-card">
      <header>
        <button className="wb-op-id" onClick={onOpenCode} title="open this code">
          {op.target}
        </button>
        {code && (
          <span className="wb-muted">
            {code.n}/{N} · {code.extracts} ex ·{' '}
            {(['said', 'did', 'intent'] as const).map((k) => `${KIND_GLYPH[k]}${code.kinds[k]}`).join(' ')}
          </span>
        )}
        {placedIn.length > 0 && (
          <span className="wb-warn-inline" title="already gathered by another theme; accepting adds it here as well">
            also in {placedIn.join(', ')}
          </span>
        )}
        <span className="wb-op-id">{op.id}</span>
      </header>
      {why ? <div className="wb-tray-why"><Md source={why} inline /></div> : <p className="wb-muted">no reason given</p>}
      {extracts.slice(0, 2).map((e) => (
        <p key={e.id} className="wb-tray-ex">
          <button className="wb-op-id" onClick={() => onJumpToExtract(e)}>
            {e.id}
          </button>{' '}
          <span className="wb-cl-p">{e.participant}</span>
          <span title={e.kind}>{KIND_GLYPH[e.kind]}</span> {clip(e.text, 140)}
        </p>
      ))}
      <div className="wb-actions">
        <button className="wb-btn wb-btn-primary wb-tiny" title="place it now, as your decision" onClick={onAccept}>
          accept
        </button>
        <button className="wb-btn wb-btn-ghost wb-tiny" title="drop the agent's proposal; nothing changes" onClick={onReject}>
          reject
        </button>
        <span className="wb-muted">or leave it: it is applied when you hand the pass back</span>
      </div>
    </div>
  );
}

function ClaimCard({ claim, index, theme, extracts, allExtracts, onJumpToExtract, onUseAsStory }: {
  claim: Claim;
  index: number;
  theme: Theme;
  extracts: Extract[];
  allExtracts: Extract[];
  onJumpToExtract: (e: Extract) => void;
  onUseAsStory: () => void;
}) {
  const ev = claim.evidence;
  const tension = claim.tension ? extracts.find((x) => x.id === claim.tension) ?? allExtracts.find((x) => x.id === claim.tension) : undefined;
  // A claim cites extracts by id; the words are rendered here, from the record, never typed into it.
  const cited = [...new Set(claim.text.match(/\bE-\d{4,}\b/g) ?? [])]
    .map((id) => allExtracts.find((x) => x.id === id))
    .filter((e): e is Extract => !!e);
  return (
    <div className="wb-claim">
      <b>{index + 1}.</b> <Md source={claim.text} inline />
      {ev && (
        <span className="wb-claim-evidence">
          {ev.n}/{ev.N} participants · said {ev.said} / did {ev.did} / intent {ev.intent}
          {ev.codes?.length ? ` · ${ev.codes.join(', ')}` : ''}
          {ev.n !== theme.n || ev.N !== theme.N ? ` — now ${theme.n}/${theme.N}` : ''}
        </span>
      )}
      {cited.length > 0 && (
        <div className="wb-claim-cites">
          {cited.map((e) => (
            <span key={e.id} className="wb-claim-cite">
              <button className="wb-op-id" onClick={() => onJumpToExtract(e)}>
                {e.id}
              </button>{' '}
              {e.participant}: {clip(e.text, 90)}
            </span>
          ))}
        </div>
      )}
      <p className="wb-claim-tension">
        <b>tension</b>{' '}
        {tension ? (
          <>
            <button className="wb-op-id" onClick={() => onJumpToExtract(tension)}>
              {tension.id}
            </button>{' '}
            {tension.participant}: {clip(tension.text, 160)}
          </>
        ) : (
          <span className="wb-warn-inline">none named</span>
        )}
      </p>
      <div className="wb-actions">
        <button className="wb-btn wb-btn-ghost wb-tiny" title="make this sentence the opening of the story" onClick={onUseAsStory}>
          use as the story's opening
        </button>
      </div>
    </div>
  );
}

export function ThemeInspector({ theme, extracts, wb, onJumpToExtract, onOpenCode, rqs }: {
  theme: Theme & { pending?: boolean };
  extracts: Extract[];
  wb: Workbench;
  onJumpToExtract: (e: Extract) => void;
  onOpenCode?: (id: string) => void;
  rqs: { id: string; text: string }[];
}) {
  const b = wb.bundle!;
  const [foldInto, setFoldInto] = useState('');
  const [confirmDrop, setConfirmDrop] = useState(false);
  const others = b.themes.filter((t) => t.id !== theme.id && t.status !== 'merged' && t.status !== 'dropped');
  const comment = (text: string) => wb.stage({ op: 'comment', target: theme.id, args: { text }, view: 'themes', by: 'user' });
  const threads = threadsFor(wb.inbox, theme.id);
  const tension = new Set(theme.tensions);
  const kinds = extracts.reduce<Record<string, number>>((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {});
  const patch = wb.patch.themes[theme.id];

  // The agent's proposals for this theme: pending `assign-theme` ops it staged, pointing here.
  const proposals = wb.pending.filter(
    (o) => o.op === 'assign-theme' && o.by === 'agent' && isPending(o) && String((o.args as { theme?: string }).theme ?? '') === theme.id,
  );
  const placedElsewhere = (cid: string) => b.themes.filter((t) => t.id !== theme.id && t.codes.includes(cid) && t.status !== 'merged' && t.status !== 'dropped').map((t) => t.id);
  const extractsOfCode = (cid: string) => {
    const c = b.codes.find((x) => x.id === cid);
    const fam = new Set(c?.family?.length ? c.family : [cid]);
    return b.extracts_all.filter((e) => e.codes.some((x) => fam.has(x)));
  };
  // Errands: the ones on disk (open), and the ones staged in this pass.
  const openRequests = theme.requests.filter((r) => r.status !== 'done');
  const stagedRequests = patch?.requests ?? [];
  const askedFor = (kind: 'codes' | 'claims') =>
    openRequests.some((r) => r.kind === kind || r.kind === 'both') || stagedRequests.some((k) => k === kind || k === 'both');

  return (
    <div className="wb-inspector">
      <header className="wb-insp-head">
        <span className="wb-op-id">{theme.id}</span>
        <span className={`wb-status wb-status-${theme.status}`}>{theme.status}</span>
        {theme.pending && <span className="wb-staged">staged</span>}
      </header>
      <p className="wb-insp-num">
        {theme.n}/{theme.N} participants · {theme.extracts} extracts · {theme.codes.length} code(s) ·{' '}
        {(['said', 'did', 'intent'] as const).map((k) => `${KIND_GLYPH[k]}${kinds[k] ?? 0}`).join(' ')}
      </p>
      {(kinds.did ?? 0) === 0 && (kinds.intent ?? 0) > 0 && (
        <p className="wb-warn">
          Nothing here is a <b>did</b>. A theme about behaviour cannot rest on intent; check whether this is a claim about attitudes.
        </p>
      )}

      <Field
        label="name — a claim, not a topic"
        value={theme.name}
        multiline={false}
        onSave={(v, old) => wb.stage(draft('set-theme-field', theme.id, { field: 'name', value: v, old }))}
        onComment={comment}
      />
      <Field
        label={`essence (${sentences(theme.essence)} sentence${sentences(theme.essence) === 1 ? '' : 's'})`}
        value={theme.essence}
        onSave={(v, old) => wb.stage(draft('set-theme-field', theme.id, { field: 'essence', value: v, old }))}
        onComment={comment}
        multiline
      />
      <Field
        label="brief — the rule, the near-miss, and what you want to say"
        value={theme.brief}
        placeholder="Not written yet. What belongs here and what does not; what you mean to argue in the paper. Written early, allowed to be wrong."
        hint="Headings such as ## Rule, ## Not this, ## What I want to say are a convention, not a schema; nothing parses it. The agent reads it whole before proposing codes or drafting claims."
        onSave={(v, old) => wb.stage(draft('set-theme-field', theme.id, { field: 'brief', value: v, old }))}
        onComment={comment}
        multiline
        tall
      />

      <div className="wb-field">
        <label>codes the agent proposes ({proposals.length})</label>
        {proposals.length === 0 && (
          <p className="wb-muted">
            {askedFor('codes')
              ? 'Asked for; the agent proposes them on the next pass, each with a line of why.'
              : 'None yet. Ask below, and the agent reads every live code against the brief on the next pass — a list of what belongs, with a line of why each, and the near misses it left out.'}
          </p>
        )}
        <div className="wb-tray">
          {proposals.map((o) => (
            <ProposedCard
              key={o.id}
              op={o}
              code={b.codes.find((c) => c.id === o.target)}
              N={b.N}
              placedIn={placedElsewhere(String(o.target))}
              extracts={extractsOfCode(String(o.target))}
              onAccept={() => void wb.accept(o.id)}
              onReject={() => wb.undo(o.id)}
              onOpenCode={() => onOpenCode?.(String(o.target))}
              onJumpToExtract={onJumpToExtract}
            />
          ))}
        </div>
        {theme.proposal && (theme.proposal.near_misses?.length || theme.proposal.second_reading) ? (
          <div className="wb-case">
            <h4>The agent's case for the edge{theme.proposal.round ? ` · round ${String(theme.proposal.round)}` : ''}</h4>
            {theme.proposal.near_misses?.length ? (
              <>
                <p className="wb-muted">Considered and not proposed — a rejection you disagree with is the fastest sign the brief's boundary is wrong:</p>
                <ul>
                  {theme.proposal.near_misses.map((m) => (
                    <li key={m.code}>
                      <button className="wb-op-id" onClick={() => onOpenCode?.(m.code)}>
                        {m.code}
                      </button>{' '}
                      <Md source={m.why_not} inline />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {theme.proposal.second_reading && (
              <>
                <p className="wb-muted">
                  <b>The other defensible boundary:</b>
                </p>
                <Md source={theme.proposal.second_reading} />
              </>
            )}
          </div>
        ) : null}
        <div className="wb-errands">
          {openRequests.map((r, i) => (
            <span key={`open-${i}`} className="wb-errand" title={r.note ?? undefined}>
              asked for {r.kind} · {r.asked}
            </span>
          ))}
          {stagedRequests.map((k, i) => (
            <span key={`staged-${i}`} className="wb-errand wb-errand-staged">
              asking for {k}…
            </span>
          ))}
          <button
            className="wb-btn wb-btn-ghost wb-tiny"
            disabled={askedFor('codes')}
            title="ask the agent: on its next pass it proposes the codes that belong here, with a line of why each"
            onClick={() => wb.stage(draft('theme-request', theme.id, { kind: 'codes' }))}
          >
            ask for candidate codes
          </button>
          <button
            className="wb-btn wb-btn-ghost wb-tiny"
            disabled={askedFor('claims')}
            title="ask the agent: on its next pass it drafts two to four candidate claims against the evidence"
            onClick={() => wb.stage(draft('theme-request', theme.id, { kind: 'claims' }))}
          >
            ask for claims
          </button>
        </div>
      </div>

      <Field
        label="story — what the pattern means, not what it says"
        value={theme.story}
        onSave={(v, old) => wb.stage(draft('set-theme-field', theme.id, { field: 'story', value: v, old }))}
        onComment={comment}
        multiline
      />

      <div className="wb-field">
        <label>answers</label>
        <select
          className="wb-select"
          value={theme.rq ?? ''}
          onChange={(e) => wb.stage(draft('set-theme-field', theme.id, { field: 'rq', value: e.target.value }))}
        >
          <option value="">—</option>
          {rqs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id}
            </option>
          ))}
        </select>
        {theme.rq && <p className="wb-muted">{rqs.find((r) => r.id === theme.rq)?.text}</p>}
      </div>

      <div className="wb-field">
        <label>in the paper</label>
        <div className="wb-seg">
          {IN_PAPER.map((v) => (
            <button
              key={v}
              className={`wb-seg-btn ${theme.in_paper === v ? 'wb-seg-on' : ''}`}
              onClick={() => wb.stage(draft('set-theme-field', theme.id, { field: 'in_paper', value: v }))}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-field">
        <label>decide</label>
        <div className="wb-actions wb-wrap">
          <select className="wb-select" value={foldInto} onChange={(e) => setFoldInto(e.target.value)} aria-label="fold into">
            <option value="">fold into…</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.name}
              </option>
            ))}
          </select>
          <button
            className="wb-btn wb-btn-ghost"
            disabled={!foldInto}
            title={foldInto ? `${theme.id}'s codes, tensions and quotes move into ${foldInto}; ${theme.id} keeps its record as merged` : 'pick a destination'}
            onClick={() => {
              wb.stage(draft('merge-theme', theme.id, { into: foldInto }));
              setFoldInto('');
            }}
          >
            fold into {foldInto || '…'}
          </button>
          {confirmDrop ? (
            <span className="wb-inline-form">
              <span className="wb-warn">
                Drop {theme.id}? Its {theme.codes.length} code(s) return to unplaced; the brief, claims and tensions stay in the record as
                dropped, and the strip under the board can restore it.
              </span>
              <button
                className="wb-btn wb-btn-danger"
                onClick={() => {
                  wb.stage(draft('drop-theme', theme.id, {}));
                  setConfirmDrop(false);
                }}
              >
                drop it
              </button>
              <button className="wb-btn wb-btn-ghost" onClick={() => setConfirmDrop(false)}>
                keep
              </button>
            </span>
          ) : (
            <button className="wb-btn wb-btn-ghost" onClick={() => setConfirmDrop(true)} title="drop this theme; its record is kept and can be restored">
              drop this theme
            </button>
          )}
        </div>
      </div>

      <div className="wb-field">
        <label>claims ({theme.claims.length}) — the agent's summary of what the evidence supports</label>
        {theme.claims_stale.length > 0 && (
          <p className="wb-warn">
            Stale, not wrong — the evidence moved under them: {theme.claims_stale.join('; ')}. The agent rewrites them on the next pass.
          </p>
        )}
        {theme.claims.length === 0 ? (
          <p className="wb-muted">
            {askedFor('claims')
              ? 'Asked for; the agent drafts them on the next pass.'
              : 'None yet. Two to four candidate claims, each with a computed evidence line and the tension it survives. You judge which is warranted when you write; nothing here needs accepting.'}
          </p>
        ) : (
          <>
            {theme.claims.map((cl, i) => (
              <ClaimCard
                key={i}
                claim={cl}
                index={i}
                theme={theme}
                extracts={extracts}
                allExtracts={b.extracts_all}
                onJumpToExtract={onJumpToExtract}
                onUseAsStory={() =>
                  wb.stage(
                    draft('set-theme-field', theme.id, {
                      field: 'story',
                      value: theme.story.trim() ? `${cl.text}\n\n${theme.story}` : cl.text,
                      old: theme.story,
                    }),
                  )
                }
              />
            ))}
            {theme.claims_written && (
              <p className="wb-claims-meta">
                written by the {theme.claims_written.by} · {theme.claims_written.at} · codebook v{theme.claims_written.version}. Not a decision awaiting
                you: the write-up decides which is warranted.
              </p>
            )}
          </>
        )}
      </div>

      <div className="wb-field">
        <label>tensions ({theme.tensions.length}) — the accounts that complicate it</label>
        {theme.tensions.length === 0 && (
          <p className="wb-muted">
            None yet. A theme that survives its exceptions is stronger, the write-up needs them, and the agent will not draft a claim without one.
          </p>
        )}
        <ul className="wb-tension-list">
          {theme.tensions.map((eid) => {
            const e = extracts.find((x) => x.id === eid) ?? b.extracts_all.find((x) => x.id === eid);
            return (
              <li key={eid}>
                <button className="wb-op-id" onClick={() => e && onJumpToExtract(e)}>
                  {eid}
                </button>{' '}
                {e ? `${e.participant}: ${clip(e.text, 120)}` : 'missing'}
                <button className="wb-btn wb-btn-ghost wb-tiny" onClick={() => wb.stage(draft('set-tension', theme.id, { remove: [eid] }))}>
                  remove
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="wb-field">
        <label>its extracts, by participant</label>
        <ul className="wb-theme-extracts">
          {extracts.map((e) => (
            <li key={e.id} className={tension.has(e.id) ? 'wb-is-tension' : ''}>
              <button className="wb-op-id" onClick={() => onJumpToExtract(e)}>
                {e.id}
              </button>
              <span className="wb-cl-p">{e.participant}</span>
              <span title={e.kind}>{KIND_GLYPH[e.kind]}</span>
              <span className="wb-cl-text">{clip(e.text, 160)}</span>
              {!tension.has(e.id) && (
                <button
                  className="wb-btn wb-btn-ghost wb-tiny"
                  title="this one complicates the theme"
                  onClick={() => wb.stage(draft('set-tension', theme.id, { add: [e.id] }))}
                >
                  tension
                </button>
              )}
              {e.highlight && <span className="wb-echip-star" title={e.highlight}>★</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="wb-field">
        <label>threads</label>
        {threads.map((th) => (
          <ThreadCard
            key={th.root.id}
            thread={th}
            onResolve={(id) => wb.thread(id, 'resolved')}
            onReopen={(id) => wb.thread(id, 'pending')}
            onReply={(id, text) => wb.reply(id, text)}
            onDelete={(id) => wb.deleteThread(id)}
          />
        ))}
        <CommentComposer label="ask about this theme" onSubmit={comment} />
      </div>
    </div>
  );
}
