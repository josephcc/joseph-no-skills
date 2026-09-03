**Status:** implemented 2026-09-02 · all four phases · see the implementation record at the end
**Date:** 2026-09-02
**Scope:** a review workbench for `thematic-analysis`: transcript, codebook, coverage, themes, quotes · how feedback flows back to the agent · daemon mechanics · phasing
**Related plans:** `interactive-plan/SPEC.md` (the format the round documents keep using)

# A review workbench for thematic analysis

The plan viewer earns its place in this skill: a per-interview codebook round is a list of
decisions with evidence, and a document of questions is the right shape for it. The other review
moments are not lists of decisions. Reviewing the **whole codebook** is a structural act (compare
siblings, pull up the extracts behind a definition, move things). Reviewing the **coding of a
transcript** is a reading act with dozens of small verdicts, most of them "fine". Reviewing
**themes** is affinity diagramming. Reviewing **quotes** is curating under constraints (spread,
length, said beside did). Each has a natural interface, and none of them is a linear document.

This plan proposes one small web app, the *workbench*, with five views over the analysis folder,
and one channel back to the agent: a typed **inbox** of operations that `ta.py apply` executes.
The per-interview round document stays a plan document, and links into the workbench.

---

## 1. Where the current surfaces fall short

I went through the dry-run round document (604 lines, 13 candidate codes, 23 questions), the
`annotate` output for T-01, and the generated reports, asking at each point what you have to do
to form a judgement and to express it.

<finding id="F-cb-structure" title="The full codebook cannot be seen as a structure" severity="p1" status="open" effort="design">
A codebook after four rounds is two levels deep, twenty to forty codes, with overlaps flagged by
`dupes` and prevalence per code. The cleanup review asks you to compare a parent's direct
extracts against its children, spot a child that is a special case of a sibling, and find two
criteria pointing the same way under different names. All of that is *comparative*: you need two
definitions side by side, the extracts each one holds, and which extracts they share. A linear
document shows one code at a time and pastes three extracts per code; the full list behind a
definition is in `collate`, a terminal away.
</finding>

<finding id="F-cb-actions" title="Codebook edits are structural, not multiple-choice" severity="p1" status="open" effort="design">
Merge into, make a child of, promote, split, rename, retire, reword an include clause: the
natural gestures are drag, select two, edit text. In the plan document each becomes an option in
a question, and anything the options did not anticipate becomes prose in the freeform box that
the agent has to parse into `merge-code` / `recode` arguments. The gap between what you mean and
what gets applied is where mistakes enter.
</finding>

<finding id="F-tr-cards" title="Annotated transcripts hide the coding behind identical cards" severity="p1" status="open" effort="design">
`annotate` makes every extract a margin comment. Thirty extracts is thirty near-identical cards;
the codes, kind, and context are inside the card, so you click to see what a span was coded,
which is the one thing the review is about. Overlapping spans in one turn fall off to ◆ anchors
after the turn. No colour distinguishes families. Kind is a word in a sentence.
</finding>

<finding id="F-tr-feedback" title="Disputing a coding is prose, and boundaries cannot be expressed" severity="p1" status="open" effort="design">
"Should be `trust.stakes`, and kind is `said` not `intent`" is typed into a reply. A boundary
dispute ("stop before *Is that bad?*") cannot be stated precisely enough for `extract --from/--to`
without retyping the words, which the skill forbids. Adding an extract on uncoded speech is a
highlight plus a comment naming codes the user has to remember. The definitions are in another
file, so you judge a coding decision without the rule it should satisfy in view.
</finding>

<finding id="F-delta" title="Every round re-presents everything" severity="p2" status="open" effort="medium">
Round four regenerates T-01's annotated transcript with 40 extracts, 31 of which you reviewed in
round one. Nothing marks what is new since you last looked. The same holds for the codebook
report. The cost of reviewing grows with the study rather than with the round.
</finding>

<finding id="F-axes" title="One axis at a time: by transcript or by code, never both" severity="p2" status="open" effort="medium">
Braun and Clarke's move from phase 2 to 3 is exactly the pivot from reading transcripts to
reading collated extracts per code. Checking that `trust.stakes` means the same thing across
twelve participants is a code-centric read; checking that P7 was coded fairly is a
transcript-centric read. Today the first is a terminal command and the second is a generated
document, and an extract seen in one cannot be opened in the other.
</finding>

<finding id="F-coverage" title="Coverage is a table you read, not a map you act on" severity="p2" status="open" effort="small">
The skill says to read coverage as questions: a code nobody said, a participant with nothing in a
family, a `did` column of zeros. The table answers none of them in place; every follow-up is a
`collate` and a re-read. An empty cell should be clickable and should be able to ask the agent to
re-read that transcript for that code.
</finding>

<finding id="F-themes-quotes" title="Theme and quote rounds are worse fits than the codebook round" severity="p2" status="open" effort="design">
Assigning codes to themes is card-sorting; the document form is a mermaid graph you cannot move.
Quote selection is a multi-select question over four pasted options, with no view of the rest of
the bank, no live attribution spread, and no way to trim a quote to its inline form without
retyping it.
</finding>

---

## 2. What the review process is, and the principles that follow

Your process, as the skill describes it and the field-study run confirmed it: an interview
arrives; the agent codes it and proposes codes; you check the coding *of that interview* (mostly
nodding, disputing a handful), decide the code proposals, and hand back. Every few rounds you
step back and look at the codebook whole. At the end you re-code everything, read coverage,
build themes from collated extracts, and pick quotes. Reviewing is mostly agreement; the
interface should make agreement free and disagreement one gesture.

<decision id="D-principles" title="Seven design principles for the workbench" status="locked" date="2026-09-02">
1. <user-highlight comment="c-p1">**Silence is acceptance.** An extract you scroll past is accepted; a code you leave alone stays. Disputing is one gesture, and the gesture produces a typed operation, not prose.</user-highlight>
2. **Review deltas, not states.** Each view knows what you reviewed and when. New or changed since then is vivid; the rest is present but muted. A round costs what changed, not what exists.
3. **Two axes, one click apart.** Every extract is reachable by transcript (context) and by code (consistency), and jumping between the two keeps your place.
4. **The definition is always in reach.** No coding verdict is asked for without the code's rule visible beside the passage.
5. **Structured feedback, agent in the loop.** Every gesture becomes an operation `ta.py` can apply; freeform comments remain for judgement calls. The agent applies, cascades (`bump`, `stale`, re-read for new codes), and replies. Same turn-taking as the plan viewer.
6. **Numbers are computed, live, by `ta.py`.** The app never re-derives n/N; it asks the script and shows the answer.
7. **One visual language.** Same tokens, header, and comment cards as the plan viewer, so the round document and the workbench read as one tool.
<rationale>
1 and 2 come from the cost structure: a study of twelve interviews produces hundreds of
extracts, and you will look at each several times if the interface makes you. 3 and 4 come
from the method: phase 2 is systematic across the data set, and the check on systematicity is
reading a code across participants with its definition in hand. 5 keeps the skill's invariants
(extracts written only by the script; the researcher decides; the agent keeps the books) and
keeps the agent where it adds value: propagating a definition change to the transcripts coded
before it existed. 6 is the skill's existing rule. 7 is cheap and reduces the learning cost to
near zero.
</rationale>
</decision>

<comment id="c-p1" status="open" kind="question">
  <note by="agent" at="2026-09-02T10:00">This is the load-bearing principle. The alternative is explicit per-extract accept, which gives a cleaner audit record (every extract has a verdict) at the cost of one click per extract. I recommend implicit acceptance with a per-transcript "done" that stamps everything remaining as reviewed, so the record is still complete. Say if you want explicit verdicts.</note>
  <note by="agent" at="2026-09-02T09:10">Settled by your answer to the reviewed-grain question (D-reviewed-grain): the Done button. Suggest resolving.</note>
</comment>

---

## 3. Architecture

### 3.1 One app, five views, one analysis folder

```
thematic-analysis/
├── app/                      Vite + React + express, same shape as interactive-plan/app
│   ├── server.mjs            daemon; ?analysis=<abs analysis dir>; SSE reload on file change
│   └── src/
│       ├── views/            Transcript · Codebook · Coverage · Themes · Quotes (+ Study, History)
│       ├── inspector/        the right-hand pane: extract, code, theme editors
│       └── ops.ts            the inbox operation schema (mirrors scripts/ta.py)
└── scripts/ta.py             + --json on coverage/dupes/collate/stale; + inbox/apply/open
```

The server reads `study.yaml`, `codebook.yaml`, `extracts.jsonl`, `themes.yaml`, `memos.md`, and
the transcripts, and shells out to `ta.py … --json` for anything computed (coverage, dupes,
collate, stale, validate, verify). It **writes one file only**: `analysis/inbox.jsonl`. Everything
else stays under the script's ownership, exactly as today.

When a transcript's folder has `video-snapshots/` beside it (the `watch-recording` layout), the
server also serves those frames, so a `did` extract can show the screen at its timestamp.

<decision id="D-arch" title="Own app under thematic-analysis/app/, own daemon" status="locked" date="2026-09-02" from="Q-arch">
The workbench is its own Vite + React + express app under `thematic-analysis/app/`, with its own
daemon. It copies the plan viewer's CSS tokens and comment-card component rather than importing
across skills, so each skill installs on its own. Section 3.4 sets out how the daemon manages its
port, avoids duplicates, keeps tabs consistent, and what "lint" means for a data-driven page.
<rationale>Chosen over hosting inside the plan viewer's daemon (a hard dependency and TA routes in a general tool) and over a merged viewer package (a large refactor of a skill in daily use).</rationale>
</decision>

### 3.2 The inbox: how feedback gets back

Every gesture in the workbench appends one line to `analysis/inbox.jsonl`:

```json
{"id": "op-0031", "at": "2026-09-02T14:12", "by": "user", "view": "transcript",
 "op": "recode", "target": "E-0042", "args": {"add": ["trust.stakes"], "remove": ["trust.generalised"]},
 "note": null, "status": "pending"}
```

Operations, by view. Each maps onto an existing or new `ta.py` command:

| view | op | ta.py |
|---|---|---|
| transcript | `recode` (add/remove codes), `set-kind`, `set-context`, `retrim` (from/to within the same turn, id kept), `drop`, `new-extract` (transcript, line, from, to, codes, kind), `highlight`, `mark-reviewed`, `comment` | `recode`, `recode --kind`, **`retrim`** (new), `drop`, `extract`, `recode --highlight`, **`mark-reviewed`** (new) |
| codebook | `accept-code`, `retire-code`, `merge-code`, `reparent`, `promote`, `rename-code`, `split-code` (new child + extracts that move), `edit-field` (definition / include / exclude / name, with old and new text), `comment` | existing, plus **`reparent`**, **`split-code`**, **`set-field`** (new) |
| coverage | `reread-request` (transcript × code, with a note) | a memo line + a flag `stale` reports |
| themes | `assign-theme` (code → theme), `new-theme`, `merge-theme`, `set-theme-field` (name / essence / story / rq / in_paper), `set-tension` | hand-edits `themes.yaml` today; **`theme`** subcommand (new) |
| quotes | `select-quote` (theme, extract, position), `deselect-quote`, `quote-span` (an inline trim for the paper, stored on the selection, never altering the extract), `set-tension` | **`theme`** subcommand |

Two new script commands close the loop: `ta.py inbox` lists pending operations grouped by view
with the comments beside them, and `ta.py apply [--all | op-ids]` executes them in order, runs
the cascades (`bump` after any codebook change, `stale` afterwards, `verify` and `validate` at
the end), stamps each line `applied` with the resulting ids, and moves the applied lines to
`reviews/YYYY-MM-DD-applied.jsonl` so the inbox is empty again. A `comment` op is never
"applied"; it is a thread. The agent replies by appending `{"op": "reply", "thread": "op-0031",
…}` and the workbench shows the thread in a drawer; you resolve it, as in the plan viewer.

The workbench shows pending operations **optimistically**: a merged code appears folded, a recoded
span shows its new chips with a small "pending" mark, and a **Pending** drawer lists everything
with an undo per line. Undo before hand-off deletes the line; after `apply` it is a new op.

<decision id="D-roundtrip" title="Staged operations, applied by the agent" status="locked" date="2026-09-02" from="Q-roundtrip">
The browser writes only `analysis/inbox.jsonl`. The agent runs `ta.py inbox` and `ta.py apply`
when you hand the pass back; the script remains the only writer of the data files, cascades run
in one place, and the applied log is the audit trail.
<rationale>Same turn-taking as the plan viewer; keeps the moment where the agent notices that three corrections of one kind point at a definition problem.</rationale>
</decision>

### 3.3 Reviewed-state, for delta reviewing

`mark-reviewed` stamps an extract `reviewed: {at, version}`; `recode`/`retrim` set `updated`.
"New since your last review" is then computable: no `reviewed`, or `updated` after it, or a code
on it added/redefined after `reviewed.version`. The same idea applies to codes (`reviewed` on a
code record, set when you accept or leave it alone at a "done" click) and to themes. The stamps
are data, written by the script through `apply`, so a second session or a co-author sees the
same state.

<decision id="D-reviewed-grain" title="A Done button per transcript stamps the untouched extracts" status="locked" date="2026-09-02" from="Q-reviewed-grain">
"Done with T-07" stages one `mark-reviewed` op covering every extract in the transcript you did
not act on. One click per transcript; the reviewed record is complete; silence is acceptance.
The same button exists for the codebook ("Done with this round") and each theme.
</decision>

### 3.4 Daemon, port, tabs, conflicts, and lint

You asked how the plan viewer handles these and what carries over. What it does, from
`interactive-plan/app/server.mjs`:

| concern | plan viewer | workbench |
|---|---|---|
| port | kernel-assigned on `127.0.0.1`; recorded with the pid in `/tmp/interactive-plan-viewer.json` | tries a **fixed default, 47821**, so round documents can link to it; if taken, falls back to kernel-assigned and records whichever it got in `/tmp/ta-workbench.json`. `ta.py open` reads the pidfile, so links from the terminal are always right; links in a round document use the default and the document says so if the daemon reports a different port |
| one daemon | before spawning, `ping` reads the pidfile and hits `/api/status` (800 ms timeout); a live daemon is reused and the new plan is registered with it; a dead pidfile is cleared and a fresh daemon spawned detached, logging to `/tmp/…log` | identical, keyed by analysis folder instead of plan file: `/api/register {analysis}`; `--status` and `--stop` as today |
| many documents | one daemon serves many plans, each tab keyed by `?plan=<abs>` | one daemon serves many analysis folders, each tab keyed by `?analysis=<abs>` |
| the browser's writes | the whole `.md` is rewritten with a `baseHash`; the server returns **409** with the current content if the file changed underneath, and the app shows a conflict banner offering to retry with the user's edit | the browser never rewrites a file. It sends **one op at a time** (`POST /api/inbox {op}`, `DELETE /api/inbox/:id`) and the server appends or removes that line under a per-folder lock. Two tabs, or you and the agent, cannot clobber each other because there is no whole-file write from the browser side |
| live reload | `fs.watch` on the plan, debounced, re-armed across atomic renames, pushed over SSE; the app ignores its own write echoing back by hash | `fs.watch` on the four data files, the inbox, and the transcripts; one SSE stream per tab carrying which file changed. A second tab on the same folder sees your staged op the moment the first tab's append lands, so the Pending drawer is the same everywhere |
| agent edits during review | the skill tells the agent to revise in turns, not while the user is in the viewer | still the rule for `apply`. `apply` moves lines out of the inbox by id, so an op you stage while it runs is not lost; and because the browser holds no whole-file state, an `apply` mid-review only refreshes the view. The one real race, the agent editing `codebook.yaml` while you stage an `edit-field` against an older definition, is caught by recording the `old` text in the op: `apply` refuses an `edit-field` whose `old` no longer matches, and reports it |
| cross-origin | rejects a foreign `Host` or `Origin` on every route | same middleware, copied |
| path trust | a plan path must be an existing `.md`, symlinks resolved; `/api/open` only opens files under the plan's repo | an analysis folder must contain `study.yaml`; transcripts and frames are served only from paths `study.yaml` names or their `video-snapshots/` sibling, symlinks resolved |

**Lint.** The plan viewer needs a linter because the plan is hand-authored markup: unbalanced
tags, duplicate ids, and anchors that resolve nowhere break rendering. The workbench renders
data, so the equivalent checks are the ones `ta.py` already has plus three it lacks. `ta.py open`
runs them as a preflight and refuses to open on an error:

- `validate` and `verify` as they stand (references, roster, verbatim, attribution);
- **span locatable**: every extract's text can be found in its transcript line after the same
  normalisation `annotate` uses. Today an unlocatable span silently becomes a ◆ after the turn;
  it should be a `validate` warning with the extract id;
- **inbox well-formed**: every pending line parses, names an op the schema knows, and points at
  ids that exist;
- **proposal and story markdown**: rendered through `marked` with the same escaping the plan
  viewer applies to user-typed text, so a stray `<` in a definition cannot break the page. No
  lint needed; it is a rendering rule.

`bun run lint:plan` still applies to the Round A, B, and C documents, which remain hand-authored.

---

## 4. The views

Common frame: the plan viewer's dark header carries the study name, codebook version, transcripts
coded / stale, and a **Pending (n)** button. A view switcher (Transcript · Codebook · Coverage ·
Themes · Quotes · Study · History). Right-hand **inspector** pane, 360px, shows whatever is
selected. Deep links: `?analysis=…&view=transcript&t=T-07&e=E-0042`, `&view=code&c=trust.stakes`,
`&view=theme&th=TH1`, so a round document can point at a code or an extract, and the agent can
open a view from the terminal with `ta.py open T-07`.

### 4.1 Transcript: reviewing the coding of one interview (phase 1)

```
┌ header: Skim study · codebook v4 · 6/7 coded · 1 stale                       Pending (3) ┐
│ Transcript ▾  T-07 · P7 · 61 min · 23 extracts · 9 new since v3                          │
│ filters: [all codes ▾] [said did intent] [new only ●] [★]      legend: ▮reading ▮trust ▮…│
├──────────┬──────────────────────────────────────────────────────┬────────────────────────┤
│ T-01 P1  │ [00:14:22] P7                                        │ E-0142 · new           │
│ T-02 P2  │ The summaries were fine but ▮I never trust them      │ ▮ trust.verification   │
│ …        │ fully, I always open the PDF anyway to check the     │   Checking the agent's │
│ T-07 P7 ●│ method section.▮ It's a habit from reviewing.        │   output against source│
│  9 new   │ ┌ E-0142 ● said · trust.verification · ctx: summaries│   definition… include… │
│          │ └ E-0143 ▶ did  · reading-path.omitted              │ kind  (●said)(▶did)(◇int)│
│          │                                                      │ codes [trust.verif. ×]  │
│          │ [00:14:58] INT   (interviewer, context)              │       [+ add code…]     │
│          │ Did you open it for every paper, or…                 │ context: summaries…    │
│          │                                                      │ span   [adjust]        │
│          │ [00:15:10] P7                                        │ frame  ▣ 00-14-20.jpg  │
│          │ Every one. ▮I even checked the one that turned out   │        ◂ ▸  (did check)│
│          │ to be right.▮                                        │ ★ paper-worthy  · drop │
│          │ ┌ E-0144 ▶ did · trust.spot-check                    │ comment…               │
│          │   ⚠ 2 codes in this family on adjacent turns         │ [accept → next]  j / k │
└──────────┴──────────────────────────────────────────────────────┴────────────────────────┘
```

What it does, in the order you use it:

- **Read the interview you remember.** Turns render as in the transcript; interviewer turns are
  greyed and cannot be coded (the script refuses them anyway), but can be commented. Speaker
  labels resolve to roster ids. Coded spans are tinted by **code family** (one hue per top-level
  code, children as shades); a span with two codes shows two underlines rather than a ◆ after the
  turn. Under each coded turn, one **chip per extract**: id, kind glyph (● said, ▶ did, ◇ intent),
  codes, context. The chip is the review: you see the verdict without clicking.
- **Delta mode.** Extracts reviewed in earlier rounds are muted; new ones are vivid, and the left
  rail shows the count per transcript. "New only" hides everything else.
- **Dispute in one gesture.** Click a chip (or `j`/`k` through extracts) and the inspector shows
  the extract with the **definition of each code beside it** (principle 4), a three-segment kind
  toggle (`1`/`2`/`3`), codes as removable tokens with an **add-code search** that previews
  definitions and lists children, context and note fields, ★ highlight with a reason, and drop.
  Every change is an inbox op.
- **Adjust the boundary without retyping.** "Adjust span" lets you re-select text inside the same
  turn; the app computes `from`/`to` as the first and last words of the selection and stages a
  `retrim`. The words never pass through you or the model.
- **Code what was missed.** Select uncoded participant speech, a popover offers codes (searchable,
  definitions on hover) and a kind, and stages `new-extract` with the exact locator. The span
  renders immediately as pending.
- **See the screen at any moment.** If `video-snapshots/` exists beside the transcript, every
  timestamp is a hover target: a popup shows the frame at or just before that time; a click opens
  it full screen with ◂ ▸ to step through neighbours. The inspector shows the same frame for the
  selected extract. Nothing is verified for you; the frame is there so you can check a `did`
  claim yourself, the `watch-recording` rule made one hover (D-frames).
- **Consistency hints.** Small ⚠ chips from `dupes` and from simple rules (two codes of one family
  on adjacent turns; a `did` with no frame check; a candidate code used here) so a reviewer's eye
  lands where the agent was least sure.
- **Jump the axis.** Every code chip has "see all N extracts" which opens the Codebook view at
  that code with this extract highlighted; the back button returns to this position.
- **Finish.** "Done with T-07" stamps the untouched extracts reviewed (Q-reviewed-grain), and shows
  a summary of what you staged.

Keyboard, because thirty extracts should take five minutes: `j`/`k` next/previous extract, `1`/`2`/`3`
kind, `a` accept and advance, `c` comment, `x` drop, `s` star, `/` add code, `n` next new only,
`Esc` back to reading.

<decision id="D-frames" title="Frames in phase 1: hover any timestamp for the frame, click for full screen, no verification buttons" status="locked" date="2026-09-02" from="Q-frames">
Every `[HH:MM:SS]` timestamp in the transcript view, coded or not, is a hover target: hovering
shows a popup with the frame at or just before that time from the recording folder's
`video-snapshots/`; clicking opens it full screen with ◂ ▸ to step through neighbouring frames and
the timestamp of each shown. Frames are served by the daemon from their path
(`GET /api/frame?analysis=…&t=T-07&at=00:14:22` resolves to the nearest file and streams it, with the
same stay-inside-the-recording-folder check the plan viewer applies to `/api/open`); nothing is
embedded as a data URI. There are no "verified" or "not visible" buttons: the frame is an
affordance for you to check a `did` yourself, and if you want to record what you saw, the
extract's note field is there.
<rationale>Your answer: go beyond the extract inspector to every timestamp; load by path, through the daemon if needed; no automatic verification, just the affordance (comment c2).</rationale>
</decision>

### 4.2 Codebook: reviewing the structure (phase 2)

```
┌ Codebook ▾ · v4 · 19 codes (7 top-level) · 2 candidates · 3 ⚠ dupes · 1 stale transcript ┐
│ health: [top-level 7] [parents w/ direct extracts 2] [≤1 participant 3] [dupes 3] [new 2]   │
├──────────────────────────┬───────────────────────────────────────┬─────────────────────────┤
│ ▾ reading-path  ████ 7/7 │ trust.stakes                          │ neighbours (dupes)      │
│    reordered    ██   4/7 │ Reliance bounded by the stakes…  ✎    │ trust.verifiability     │
│    omitted      █    3/7 │ status accepted · v2 · 5/7 · 9 extracts│  shares 4 of 9 extracts│
│ ▾ trust         ████ 7/7 │ ●●●●●●▶▶◇   said 6 · did 2 · intent 1 │  [compare]  [merge →]  │
│    spot-check   ███  5/7 │ ─────────────────────────────────────  │                        │
│    generalised  ███  5/7 │ Definition ✎ (inline edit or comment)  │ agent's proposal        │
│  ● stakes       ██   5/7 │ Participant limits reliance on a claim│ "why not trust.spot-…"  │
│    verifiab. ⚠  ██   4/7 │ by what they would do with it…         │ alternatives considered │
│  ◦ unexamined   █    1/7 │ include: … exclude: … (→ verifiability)│                        │
│ two-modes       ███  6/7 │ ─────────────────────────────────────  │ actions                │
│ highlights-… ⚠  ███  6/7 │ Extracts by participant (collate)      │ accept · retire        │
│ sidebar-as-nav  ██   4/7 │ P1 E-0005 ◇ "…never cite…"  [→T-01]   │ merge into… · child of…│
│ ◦ = candidate            │ P2 E-0013 ● "…"             [→T-02]   │ promote · split · rename│
│ drag to reparent/reorder │ P4 … (grouped, all of them, foldable) │ comment                │
└──────────────────────────┴───────────────────────────────────────┴─────────────────────────┘
```

- **The tree is the codebook.** Status (candidate ◦ / accepted / merged, folded), an n/N bar, an
  extract count, a kind mini-bar, ⚠ from `dupes`, and "new this round". Drag a code onto another
  to make it a child (`reparent`); drag to the root to promote; multi-select two and press merge.
- **The detail pane is `collate` with the definition on top.** Every extract for the code, grouped
  by participant, each with a jump to its transcript position and a quick recode/move. The
  parent's *direct* extracts are separated from its children's, which is the cleanup-review
  question ("a parent carrying more than its children is hiding a child") answered by layout.
- **Edit the words, or comment on them.** Definition, include, exclude, and name are inline
  editable; saving stages `edit-field` with old and new text. Selecting words and pressing comment
  starts a thread instead (Q-def-edit). The agent's rationale for a candidate (why not an existing
  code, alternatives considered) sits beside the definition, read from a new `proposal` field the
  agent writes into `codebook.yaml` when it proposes the code (Q-proposal-home).
- **Compare.** Two codes side by side: both definitions, then three columns of extracts (only A ·
  both · only B), each extract with move-to-A / move-to-B / keep-both. Header buttons: merge A into
  B, make A a child of B. This is the surface for every `dupes` flag and for every "are these the
  same thing" moment.
- **Split.** From a code, tick the extracts that belong to a new child, name it, and stage
  `split-code`; the child appears as a candidate under the parent with those extracts moved.
- **Health strip as filters.** Each number filters the tree to the codes it counts; the strip is
  the cleanup review's checklist.
- **The agent's structural proposals appear in place.** When the agent proposes "merge
  `agent-steering` into `control`", it stages that op itself with `by: agent, status: proposed`.
  The tree shows the proposal as a ghost (the merge previewed), and you accept or reject it
  with one click, with the evidence (the Compare view) one click away. Round documents keep the
  narrative; the operation itself lives where the evidence is.

<decision id="D-def-edit" title="Definitions: inline edit and comment threads, both" status="locked" date="2026-09-02" from="Q-def-edit">
Definition, include, exclude, and name are inline editable; saving stages `edit-field` with old
and new text. Selecting words and pressing comment starts a thread instead, for changes you want
the agent's judgement on first. The applied log keeps both the wording change and, when there
was one, the thread behind it.
</decision>

<decision id="D-proposal-home" title="The agent's argument for a code lives in a proposal field in codebook.yaml" status="locked" date="2026-09-02" from="Q-proposal-home">
`proposal: {why, alternatives, round, borderline: [extract ids]}` is written when the agent
proposes a code, shown beside the definition in the inspector, and kept as history after
acceptance. The Round A document quotes it rather than being its only home.
</decision>

### 4.3 Coverage: the audit as a map (phase 2, small)

A heatmap, participants × codes (families collapsible), each cell the extract count with kind
glyphs; row and column totals are the n/N the paper will cite. Click a cell and the inspector
shows those extracts (collate filtered to one participant), each with a jump to the transcript.
Click an **empty** cell and you can stage `reread-request` ("re-read T-04 for `trust.stakes`"),
which the agent sees in the inbox and acts on before the next round; `stale` reports it until
done. A column of zeros in the `did` glyph under a code about behaviour is visible at a glance,
which is the check the skill asks you to make by reading a table. Transcript staleness and
codebook version per transcript sit in a side strip.

<decision id="D-coverage-in-scope" title="Coverage heatmap is in scope for phase 2" status="locked" date="2026-09-02">
It is small (one component over `coverage --json`) and it is the surface for "completeness over
vividness": the rule that themes rest on thorough coding, not on the three most quotable people.
<rationale>
Every follow-up the coverage table invites is a `collate` plus a transcript re-read today; a clickable cell makes each one a click, and the re-read request closes the loop with the agent.
</rationale>
</decision>

### 4.4 Themes: an affinity board (phase 3)

```
┌ Themes ▾ · codebook v6 frozen · 12/12 coded · 5 candidate themes · 3 codes unplaced        ┐
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────┬──────────────────┤
│ TH1 11/12    │ TH2 9/12     │ TH3 7/12     │ misc         │ unplaced    │ TH1 inspector    │
│ Co-planning  │ Chat for     │ Trust was    │              │ onboarding  │ name ✎           │
│ afforded     │ open-ended,  │ earned by    │ humour 2/12  │ 4/12        │ essence ✎ (2 sent.)│
│ steerability │ plans for…   │ checking     │              │ pricing 1/12│ story ✎ (markdown) │
│ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │              │             │ rq [RQ1 ▾]       │
│ │control   │ │ │task-fit  │ │ │trust     │ │              │             │ in paper         │
│ │11/12 ●●▶ │ │ │ 8/12     │ │ │ 9/12     │ │              │             │ (undecided)(head)│
│ ├──────────┤ │ └──────────┘ │ ├──────────┤ │              │             │ (secondary)(no)  │
│ │control.  │ │              │ │trust.    │ │              │             │ codes: 3 · 47 ex.│
│ │rerun 7/12│ │              │ │spot-check│ │              │             │ tensions (2) ✎   │
│ └──────────┘ │              │ └──────────┘ │              │             │ collate ▾ P1… P12│
│ + sub-theme  │              │              │              │             │ level-2 check ▾  │
└──────────────┴──────────────┴──────────────┴──────────────┴─────────────┴──────────────────┘
```

- **Cards are codes; columns are themes.** Drag a code between themes (`assign-theme`), into
  `misc` (allowed and temporary, as the skill says), or leave it unplaced. A code card shows n/N
  and the kind mix, so a theme about behaviour resting on ◇ intent is visible before it is written.
  Sub-themes are nested columns, two levels at most.
- **A theme's inspector is phase 4 and 5 in one pane.** Editable name, essence with a
  two-sentence counter (their scope test), story as markdown, RQ, `in_paper` as a segmented
  control, tensions as a list you drag extracts into from the collate list. Below, the collated
  extracts of the theme grouped by participant: level one (do they cohere) is reading this list;
  the level-two result (what the re-read of all transcripts added) is a filter, "added in level 2".
- **The map draws itself.** A mermaid export of the board for the round document, so the graph in
  the document and the board never disagree.
- **The narrative stays a document.** The Round B document keeps the overall story paragraph, the
  order of telling, and the naming questions; those are prose you edit and the plan viewer is good
  at that. The board handles the moving.

<decision id="D-themes-board" title="Themes are a drag board" status="locked" date="2026-09-02" from="Q-themes-board">
Codes are cards, themes are columns, sub-themes are nested columns (two levels at most), with
`misc` and `unplaced` columns; drag stages `assign-theme`. Phase 3.
</decision>

### 4.5 Quotes: curating under constraints (phase 4)

Per theme in the paper: on the left the **bank**, every extract carrying the theme's codes,
agent's shortlist first with its one-line reasons, then the rest; filters for participant, kind,
★, and length; each row shows word count and whether it fits inline (under ~25 words) or needs a
block. On the right, **In the paper**, an ordered list you drag into and reorder, with a
**trim** tool: select the words within the extract that go inline and stage `quote-span`; the
extract is untouched and the paper's quote is `[...]`-derivable from it, so `verify-quotes` still
passes. A toggle marks a selection as the theme's **tension** rather than its exemplar. Along the
bottom, the **attribution spread**: participants × themes, live, with warnings the skill states
(one participant quoted more than three times across the paper; a theme about behaviour with no
`did` quote; participants quoted nowhere). `ta.py report` then writes the quote bank from
`selected_extracts` as today.

<decision id="D-quotes-view" title="A dedicated Quotes view replaces the Round C document" status="locked" date="2026-09-02" from="Q-quotes-view">
The full bank per theme, an ordered in-the-paper list, a trim tool that records a `quote-span`
without retyping words, a tension toggle, and a live attribution spread with the skill's
warnings. A short Round C document survives only for prose judgements the agent wants to argue.
Phase 4.
</decision>

### 4.6 Small views

- **Study.** The roster as a form: speaker labels → participant id, role, group; the analytic
  stance fields; research questions. Replaces hand-editing `study.yaml` on day one, where
  `validate` currently refuses placeholders until you do.
- **History.** `memos.md`, the codebook changelog, and the applied-ops files, newest first, so a
  co-author (or you in a month) can read how the codebook got here.

---

## 5. Review moments you did not list

Working through the pipeline turned up these beyond the two you named and the two you asked about:

1. **Code-consistency review** (one code across all participants). It is how you check that a
   definition is being applied the same way in interview nine as in interview two, the
   reflexive-TA stand-in for inter-rater reliability. It is the Codebook view's detail pane, and it
   deserves to be a named step in `SKILL.md` at each cleanup review.
2. **Delta review after Operation B.** After the frozen codebook is applied to everything, the
   only thing worth your time is the extracts added in that pass. The reviewed-state makes this a
   filter rather than a re-read of twelve transcripts.
3. **Coverage gaps as requests**, above.
4. **`did` <user-highlight comment="c2">verification</user-highlight> against frames**, above. The skill states the rule; nothing today makes it
   easy to follow during review. Decided: the frame on hover at every timestamp, and you do the
   verifying (D-frames).
5. **Roster and <user-highlight comment="c3">stance</user-highlight>**, above. The roster is the first thing you do and today it is YAML; it
   becomes the Study form. The stance stops being a question at all (D-stance-default).

<decision id="D-stance-default" title="The analytic stance is a skill default: hybrid, semantic, realist, prevalence per participant" status="locked" date="2026-09-02">
The stance you chose for the study this was built against becomes the skill's default, written into
`SKILL.md` Step 0: orientation **hybrid** (research questions and design goals shape what is
attended to, codes come from the transcripts), level **semantic** (what participants said they
did and valued, then interpreted), epistemology **realist**, prevalence unit **participant**
(n/N, never extract counts, with the caveat that frequency does not determine value). The agent
writes these into `study.yaml` and the method paragraph without asking; `init` seeds them (today
it seeds `inductive`); the Round A template drops the `Q-stance` question. The agent asks only if
the user says otherwise or the study is plainly not an HCI user study. The kind convention
travels with it: a rule the participant actually acted on while using the system is `did`,
`said` is for views and standing attitudes, and a modal governing the participant's own
hypothetical action is `intent`.
<rationale>Your comment c3: what you picked for the study this was built against should be the default, specified in SKILL.md so it is never asked again. The dry-run notes had already flagged that `init` seeds inductive while the guidance says hybrid.</rationale>
</decision>
6. **Tensions**, as a first-class list per theme rather than a field you remember to fill.
7. **The draft.** After writing, `verify-quotes` checks the results section; a view that renders
   the draft with each quote linked to its extract and its transcript position, and each n/N
   checked against `coverage`, would be the last review. Out of scope for this plan, noted so the
   inbox schema does not preclude it.

---

## 6. The round trip, end to end

1. Agent codes T-07, writes extracts by batch, proposes candidate codes with `proposal` fields,
   stages its structural proposals as `by: agent` ops, authors the Round A document (shorter: the
   narrative, the stance questions, links into the workbench per code and per new extract), runs
   the audit, and prints `ta.py open T-07` (workbench) and the plan-viewer URL.
2. You review the transcript (delta mode), dispute what you dispute, star the moments that struck
   you, press Done; you open the Codebook view for the two candidates, accept one, split the other,
   reword an include clause; you answer the stance question in the round document.
3. You say "review my feedback". The agent runs `ta.py inbox`, reads the ops and the threads,
   runs `ta.py apply --all` (or holds back an op it wants to discuss), replies to threads, runs
   `stale` and re-reads the transcripts the new code touches, converts the round document's
   answered questions to decisions, and reports the audit lines.
4. The workbench reloads on the file change (SSE, as the plan viewer does). Pending is empty; the
   codebook shows v5; T-07 shows zero new.

The `annotate` command stays (its `--plain` form is useful text; its plan form still gives a PDF
via the plan viewer for a co-author who will not open the workbench) but the skill stops calling
it the review surface.





<comment id="c3" status="open" kind="clarify">
  <note by="user" at="2026-09-02T08:04">what i picked for the study this was built against should become the default of the skill, specify in the SKILL.md so you do not ever need to ask again</note>
  <note by="agent" at="2026-09-02T09:10">Read from that study's `study.yaml`: hybrid · semantic · realist · prevalence per participant, plus the round-1 kind convention. Recorded as D-stance-default, and section 7 now lists the SKILL.md, `init`, and template changes. Suggest resolving.</note>
</comment><comment id="c2" status="open" kind="clarify">
  <note by="user" at="2026-09-02T08:03">no auto verification, just the affordance (hover show frame) i commented before so I can verify myself</note>
  <note by="agent" at="2026-09-02T09:10">Dropped the verified / not-visible buttons. D-frames now reads: hover any timestamp for the frame, click for full screen, served by path through the daemon, no data URIs, nothing verified for you. Suggest resolving.</note>
</comment><decision id="D-roundA" title="Round A stays a plan document, shorter, with deep links" status="locked" date="2026-09-02" from="Q-roundA">
The document keeps the narrative (what changed, memos), the per-code argument (quoting the
`proposal` field), and the policy questions that are not operations. Each candidate code's
section ends with a link into the workbench at that code; each new extract mentioned links to
its transcript position. Accept, reparent, merge, split, and reject happen in the workbench.
Documents carry arguments; the workbench carries operations over data.
</decision>

---

## 7. Changes to `ta.py` and the references

- `--json` on `coverage`, `dupes`, `collate`, `stale`, `validate`, `verify`; one computation, two renderings.
- New: `inbox`, `apply`, `open`, `retrim`, `reparent`, `split-code`, `set-field`, `mark-reviewed`, a `theme` subcommand (assign / field / tension / select), `serve` (start or find the daemon; `open` uses it).
- Extract fields: `reviewed {at, version}`, `updated`. Code fields: `proposal {why, alternatives, round}`, `reviewed`. Theme: `quote_spans` (inline trims per selected extract).
- `data-model.md`: the fields above, `inbox.jsonl`, `reviews/*-applied.jsonl`.
- `review-templates.md`: Round A′ becomes the workbench transcript view; Round A shortened with links; Round B keeps the narrative and drops the mermaid (exported from the board); Round C is replaced by the Quotes view plus a one-paragraph document for the tension decisions.
- `SKILL.md`: Step 0 states the default stance (D-stance-default) and stops asking for it; Operation A steps 4 to 6 rewritten around `open` / `inbox` / `apply`; the code-consistency review named in the cleanup step; a rule that the agent stages structural proposals as ops; the kind convention from that study written out.
- `init` seeds `approach` with the default stance instead of `inductive`; `review-templates.md` drops the `Q-stance` question from Round A.
- Server: `/api/frame` (nearest frame at or before a timestamp, served by path), `/api/inbox` append and delete under a per-folder lock, `/api/events` per analysis folder, the port and pidfile behaviour of section 3.4.
- `validate`: a warning for an extract whose span cannot be located in its transcript line; `open`: the preflight of section 3.4.
- Tests: inbox schema round-trip, `apply` cascades (bump, stale, id stability under `retrim` and `split-code`), `--json` shapes, reviewed-state computation.

---

## 8. Phasing

| phase | ships | why this order |
|---|---|---|
| 1 | daemon (3.4) + Transcript view with frames on hover (D-frames) + inbox + `inbox`/`apply`/`open`/`retrim`/`mark-reviewed` + `--json` + stance default in `SKILL.md`/`init` | the review you do after every interview; the inbox is the foundation for everything else |
| 2 | Codebook view (tree, detail, compare, split) + Coverage heatmap + Study form + `reparent`/`split-code`/`set-field` + agent-staged proposals | the review you asked for first; needs the inbox and the collate pane from phase 1 |
| 3 | Themes board + `theme` subcommand + mermaid export | after Operation B, once |
| 4 | Quotes view + `quote_spans` + spread warnings | last step before writing |

Each phase ends with the skill documents updated and the tests green, and with a dry run on the
field-study folder (116 extracts, four rounds) so the design is checked against real density,
not the three-interview fixture.

<decision id="D-phase-order" title="Phase 1 is the transcript view" status="locked" date="2026-09-02" from="Q-phase-order">
Transcript first, codebook second, as tabled in section 8. The inbox, `apply`, `open`, and the
daemon ship with phase 1.
</decision>

<decision id="D-anything-else" title="Two additions from the inline comments on section 5" status="locked" date="2026-09-02" from="Q-anything-else">
Frames on every timestamp with no automatic verification (D-frames), and the analytic stance
becomes a skill default the agent never asks about again (D-stance-default).
</decision>

---

## Implementation record — 2026-09-02

All four phases are built. What shipped, against the plan:

| phase | planned | built |
|---|---|---|
| 1 | daemon, transcript view with frames on hover, inbox, `inbox`/`apply`/`open`/`retrim`/`mark-reviewed`, `--json`, stance default | done, plus `stage` (agent proposals), `reply`, `bundle`, `transcript --json`, `serve` |
| 2 | codebook tree/detail/compare/split, coverage heatmap, study form, `reparent`/`split-code`/`set-field`, agent-staged proposals | done, plus a health strip that turns the cleanup review into eight filters, and `new-code`/`code-status`/`reread` |
| 3 | themes board, `theme` subcommand, mermaid export | done |
| 4 | quotes view, `quote_spans`, spread warnings | done |

Files: `app/` (server.mjs + 20 source files, ~3,600 lines), `scripts/ta.py` (1,532 → 3,600 lines),
`tests/test_ta.py` (52 tests), `app/src/*.test.ts` (41 tests). `SKILL.md`,
`references/data-model.md`, `references/review-templates.md`, the repo README and `install.sh` are
updated.

Decisions the build made that the plan left open:

- **The reviewed-state is a fact, not a timestamp comparison.** An edit the researcher makes counts
  as a review of that extract; an edit the agent makes *clears* the stamp so it comes back as new.
  The first draft compared `updated` against `reviewed.at`, which silently failed when both
  happened in the same minute.
- **`stale` distinguishes `recode` from `version-only`.** A bump that changed no code's meaning
  marks transcripts stale but needs no re-read, and saying so stops the signal crying wolf.
- **`child_extracts` is computed by `ta.py`.** The tree, the detail pane and the inspector were
  quoting two different "extracts on its children" numbers (code applications vs. distinct
  extracts); now the script emits both halves of one partition.
- **`validate` expands a theme's codes to their families** before warning that a selected quote
  carries none of them. A quote coded only to a child of a theme's code does belong to the theme.
- **The frame affordance is a hover on every timestamp**, with the inspector showing the frame for
  the selected extract inline. No verification buttons, per D-frames.

Three bugs the interaction pass caught, worth recording because none was visible in a screenshot:

1. `server.mjs` imported `express` at the top of the file, so a first run failed before it could
   install its own dependencies. The import is lazy now; the first run installs, builds, and starts
   in about four seconds.
2. The themes board defined its card and column components *inside* the view, so every state
   change (including picking up a card) remounted the whole board and threw away the node being
   dragged. Both are hoisted; `compare.tsx` had the same shape.
3. A code shown as a child of a *pending* reparent rendered with a blank label, because the label
   stripped everything before the first dot and the id has not been renamed yet.

## Codex audit — 2026-09-02

Five runs (`gpt-5.5`, `xhigh`), each auditing the working tree against this plan: an initial
audit plus four follow-ups on the fixes. Twenty-nine findings, all triaged against the code, all
real, all fixed. The severity trend is the useful part: 4×P1 + 6×P2, then 2×P1 + 4×P2, then
2×P1 + 2×P2, then 4×P2 + 1×P3, then 4×P2 — the last two rounds found no P1 and no new class of
problem, only narrower cases inside the concurrency story.

**Codex verdicts, in order:**
1. "The workbench implements the broad shape of the plan, but the load-bearing apply path has failure, versioning, and locking bugs that can break the review loop or corrupt/duplicate operations."
2. "The patch still has unsafe apply/daemon concurrency windows and a version-stamping bug that can hide future review work."
3. "The fix set addresses the main stale-claim and dispatcher-lock design, but there are still correctness gaps."
4. "The fix set addresses the intended areas but still leaves concurrency and id-allocation edge cases."
5. "The fix set addresses the intended areas but still leaves concurrency and id-allocation edge cases that can break the stated lock and operation-id guarantees."

None of the five reports produced the `VERDICT:`/`ISSUES:` footer the brief asked for; the
sentence above each report's finding list is its verdict.

**What changed in response, by theme:**

*The apply pass.* It now claims the operations it will run under the inbox lock, works outside it,
and settles against a fresh read — so a second pass cannot take the same ops, the daemon cannot
rewrite them away, and an op staged mid-pass survives. The byte-offset re-append it used at first
is gone; every writer does a full read-modify-write under the lock. A malformed operation fails on
its own instead of blocking the researcher's other feedback (`apply --force` was removed as
unnecessary), and its reason stays in the inbox.

*Versioning.* A pass bumps the codebook once and every stamp written during it — `reviewed` on an
extract, `added` on a new code — is corrected to the version the pass actually ended at. Two
merges no longer bump twice; a no-op edit does not bump at all. Without this, pressing "Done with
T-07" in the same pass as a definition edit left all 42 extracts still marked new, and a pass
whose only codebook op turned out to be a no-op left a stamp pointing at a version that never
happened, which would have hidden the next real edit from the delta check.

*One writer at a time.* Every command that rewrites a data file holds `analysis/.apply.lock` for
its whole run and re-reads the files after taking it — decided once, in `main`, for the whole
`WRITING_COMMANDS` set, including `init --force` on an existing folder. A lock is stolen only when
it is stale *and* its owner is dead; stealing renames rather than deletes (atomic, so of two
contenders only one wins); a lock is released only by the process whose token is in it. The daemon
mirrors the same protocol for the inbox lock, and understands a lockfile from the earlier version.

*Recovery without guessing.* A claim an `apply` died holding is not retried. If its id already
reached an applied log the row is cleared; otherwise it becomes `stalled`, and `inbox`, the pending
drawer, and the apply output all say that it may or may not have taken effect. `apply --all` skips
it; naming its id re-runs it. A stalled operation is listed but never drawn onto the data, because
a phantom drop would have the researcher deciding against a change that may not exist.

*Never losing a line or an id.* An inbox line that will not parse is kept whole and re-emitted
verbatim by both writers, and both id counters scan it, so a truncated `{"id":"op-0042"…` neither
disappears on the next rewrite nor gets handed out again. A resolved thread is archived with its
replies, recomputed from a fresh read so one the researcher reopens mid-pass stays open, and
archiving happens inside the settle lock so an id is always visible in one file or the other.

*Handler guards.* A quote trim whose end marker is missing is refused rather than silently trimming
to the end of the extract; a theme merge carries the inline trims of the selections that move; a
re-trim refuses offsets measured in a different turn than the extract's own — enforced in the
script, and the button is not even offered in the UI unless the selection lies in that turn.

*The views.* Child codes are cards on the themes board (they were filtered out, so `trust.stakes`
could not be themed without hand-editing YAML). The Compare pane's move now removes the codes an
extract actually carries from the source family, not the family's parent id — otherwise moving an
`A.child` row left it in both families.

**Deferred / not actioned:** nothing. Every finding was accepted.

**The residual risk, stated plainly:** the locks are advisory files shared by two cooperating
local tools, not a distributed consensus. A determined adversary, or a machine where pids are
recycled inside fifteen minutes while a writer is suspended, can still defeat them. The protocol
makes the realistic races safe, refuses rather than guesses when it cannot tell, and names the
file to delete when something goes wrong; `references/data-model.md` says so in those words.

Codex's full final messages: `/tmp/codex-audit-20260902-024321-report.md`,
`-030312-`, `-031816-`, `-033156-`, `-034304-report.md` (this session's runs).
