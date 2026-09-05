# Using `thematic-analysis`

A Braun & Clarke thematic analysis of interview transcripts in which **you drive and the agent
supports**. It works as an experienced qualitative analyst would: it reads every transcript,
notices what recurs, and proposes codes and themes with the extracts behind them — as a spread of
options, grounded in your research questions and your draft, not a single verdict. You decide.
Which codes stay, which themes the data supports, which quotes go in, and what the paper argues
are yours.

Each new interview is two jobs done together: it codes the transcript against the codebook you
already have, so this one is comparable with the rest, and it brings you the passages nothing
covered as candidate codes to rule on.

Two things make that practical. **Reviewing**: the coding is drawn on the transcript, every
timestamp opens the frame from the recording, and the codebook is a structure you can take apart —
so checking the work is cheap enough that you actually do it. **Reading everything, every time**:
a code you just wrote gets carried back across all the transcripts, which is how you learn it was
under-applied in the first interview, that it overlaps a code you wrote last week, or that two
participants never triggered it at all.

Nothing it claims about the data is unchecked: quotes are copied out of the transcript by script
and re-verified, and coverage is computed rather than estimated.

`SKILL.md` in this folder is written for the agent. This file is written for you.

---

## The loop

```
    you, in chat ──▶ "P7's session is in recordings/p7, code it"
                          │
                          ▼
    the agent   reads the transcript whole · codes it · proposes candidate codes
                writes the round document · opens the workbench
                          │
                          ▼
    you, in     dispute a coding · accept a code · move a card · pick a quote
    the         every gesture is carried out AT ONCE by the script and logged as yours
    workbench   the agent's proposals wait: leave one standing to accept it, undo to reject
                          │
                          ▼
    you, in chat ──▶ "review my feedback"
                          │
                          ▼
    the agent   ta.py changes    reads what you changed, grouped by view
                ta.py apply --all executes the proposals you left standing, archives the pass
                replies to your threads · re-reads what a new code touches
                          │
                          ▼
    the workbench redraws itself.  You do not reopen it.  ◀── the part people expect to be manual
```

**You never close or reopen the workbench.** It watches the analysis folder and reloads when the
agent writes to it. Leave it open for the whole study; switch to it when you want to review,
switch to chat when you want to hand a pass back.

**Chat is the hand-back, and that is deliberate.** There is no "submit" button. A review is
finished when you say it is, not when the tool decides you have clicked enough. Say
*"review my feedback"* — the agent picks up everything you staged.

**Everything you click changes the analysis — through the script.** The browser never writes an
analysis file itself; it asks the daemon to run `ta.py`, which does at once what `apply` would
have done, and records it in `reviews/*-applied.jsonl` as yours. Change your mind by doing the
opposite: drag the card back, flip the field again. What does *not* happen by itself is the
agent's proposals. They are drawn where they would land — a dashed card on the board, a chosen
quote marked *proposed by the agent* — and wherever one is drawn, and in the Pending drawer, it has
**accept** (carried out now, recorded as your decision) and **reject** (dropped, nothing changes);
the drawer has *accept all*. One you leave standing is applied when you hand the pass back.

**A codebook version is an application, not an edit.** Reword a definition, accept a code, merge
two: the header chip counts them as *unapplied* and nothing is versioned. The version moves when
the codebook is applied to the transcripts — the next coding pass, or an explicit `bump` — and the
edits since become one changelog entry. `stale` measures against the codebook as it stands, so it
still tells you which transcripts the edits reach.

---

## Starting a study

Point the agent at your transcripts (from `watch-recording`, or any file whose turns start with a
speaker label):

> Set up a thematic analysis for the exit interviews in `study/recordings/`.

It creates `study/analysis/` and drafts a roster from the speaker labels it finds. **Then it will
ask you to finish the roster**, and it cannot proceed without you: deciding who counts as a
participant is analytic work, not clerical. A room mic is several people; a colleague who joined
for ten minutes is context, not data.

It will *not* ask you about the analytic stance. Hybrid, semantic, realist, prevalence per
participant is the default, already written into `study.yaml`. Change it in the Study view if this
study really differs.

**The method it follows.** The skill reads Braun & Clarke in full before it starts — from
`source/`, which is gitignored, because the book is not mine to redistribute. Drop your own copy
in and run `scripts/extract_source.sh` once; without it the skill falls back to
`references/braun-clarke-digest.md` and tells you it did, so you always know which one the
analysis was done against.

---

## The four operations

### A. Code an interview — repeat, one interview at a time

> P7's session is in `recordings/p7/`. Read it and update the codebook.

The agent reads the whole transcript before coding a line, codes it against the current codebook,
proposes candidate codes with their evidence and its argument for each, and hands you two things:

- **the workbench**, opened on that transcript — this is where you check the coding;
- **a round document** in the plan viewer — this is where you read *why*, and answer the
  questions that are not operations (a coding policy, the stance, what to watch for next time).

Review the coding in the Transcript view: spans tinted by code family, one chip per extract
carrying its id, kind and codes, definitions beside the passage. Scrolling past an extract accepts
it; **Done with T-07** stamps the rest as reviewed, so the next round costs what changed rather
than what exists. Accept or reject the new codes in the Codebook view, where their extracts are.

![The Transcript view: coded spans tinted by code family with an ordinal on each, a chip under every turn carrying the extract id, kind glyph and codes, and the inspector holding the selected extract, its kind, its codes and the definitions those codes are meant to satisfy](docs/hero.png)

A `did` claim should not rest on what someone remembers saying they did. If the recording went
through `watch-recording`, every timestamp in the transcript carries its frame: hover for the
screen as they spoke, click for full size. The extract inspector shows the same frame for the
extract you are reading, and names which one it used — the nearest at or before the line, never a
guess.

![Hovering a timestamp in the transcript pops the video frame from that moment, captioned with the frame file and the fact that it is the nearest one before that timestamp; the inspector shows the same frame under "the screen as they spoke"](docs/frame-peek.png)

Then: *"review my feedback"*.

A codebook grows crooked if nobody prunes it. Codes stay at most two levels deep, and when a round
adds extracts but no new codes, ask for a **cleanup review**: the agent looks for a parent carrying
more than its children, a child that is a special case of its sibling, and two criteria pointing
the same way under different names, then proposes the merges *with the extracts that would move*.
The Codebook view's health strip counts those shapes for you, and **compare** puts any two codes
side by side with the extracts each one holds.

Its **overlap** tab is the same question asked across the whole codebook at once: a cross-tab of
codes x codes where each cell is the extracts carrying both. Two codes that always travel together
are one code under two names; a code that appears whenever another does, but not the reverse, is a
special case of it and wants to be its child; and a big code whose extracts split cleanly by what
else they carry is a code doing too much. The tab ranks both readings above the matrix, and tells
you when it cannot see — a code whose extracts carry no other code is invisible to overlap, and
those you have to read.

![The Codebook view: the tree of codes with prevalence bars and one staged merge struck through, the compare pane holding two definitions and their exclude clauses above three columns of extracts — only A, both, only B — and the inspector for the code under decision](docs/codebook-compare.png)

### B. Freeze the codebook and code everything

> No more interviews are scheduled. Freeze the codebook and code all the transcripts against it.

Prevalence computed from a selective pass is a number that looks like evidence and is not, so this
pass codes every transcript against the frozen codebook — including the ones coded early, when the
codebook was smaller. Afterwards, review only what it added: the Transcript view's **new only**
filter shows exactly that.

Now the Coverage view is worth reading, because every cell is a fact rather than an artefact of the
order you happened to code in. Click a number to read the extracts behind it; click an *empty* cell
to ask for a re-read of that participant for that code.

![The Coverage view: a participants-by-codes matrix with n/N, a said/did/intent breakdown per code and a selected cell whose extracts are listed beside it, over tables of transcripts and participants](docs/coverage.png)

### C. Develop themes

> Let's do themes.

The Themes view is a board: codes are cards, themes are columns, dragging moves a card. Every
column ends in a dashed **+ add a code here too** foot: drop a card there (or hold ⌥ while dropping
anywhere on the column) to *add* the code to a second theme instead — it stays where it was, the
card says "also in TH3", and its extracts count toward both. The code's own inspector has the same
move as *place here too*. A theme you create exists at once, and so does everything you do to it — drop the codes
you already know it rests on, write its brief, ask for what you might be missing. A theme that did not work out is
dropped from its inspector (or folded into another): its codes return to unplaced, its record is
kept, and a strip under the board restores it with one click.

Each theme's inspector holds, in the order the work is done: its name and essence (with the
two-sentence scope test); its **brief** — the rule for what belongs, the near-miss that does not,
and what you mean to write in the paper, in whatever headings you like, written early and allowed
to be wrong; the codes the agent proposes for it, each with a line of why, its n/N and two of its
extracts, accepted by leaving them staged and rejected with one click, and the agent's case for
what it left out; the story, the research question and the in-the-paper call; the agent's
**claims** — two to four sentences it thinks the evidence supports, each with an evidence line the
script computed and the tension it survives, yours to judge when you write rather than to accept;
and the tensions, the accounts that complicate the theme, which the write-up needs.

Two buttons under the proposals — *ask for candidate codes*, *ask for claims* — stage an errand.
On the next hand-back the agent reads every live code against your brief (not the ones it
remembers: the script enumerates them) and comes back with a list of what belongs and a line each
on why, plus about five near misses and the clause of your brief that excluded each. A near miss
you disagree with is the fastest way to find out your boundary is wrong.

Above the board sits **what the paper argues**, as the agent read it from the draft you registered
(`ta.py paper --add <path>`; it reads the whole draft, not a summary). Open it, and correct it in
place if the reading is off — before any theme is proposed against it.

![The Themes view: theme columns holding code cards, two of them dashed and marked proposed by the agent; the paper's framing open above the board; and the inspector for a theme showing its brief under Rule / Not this / What I want to say headings, the agent's proposed codes with a line of why each, and its candidate claims with their computed evidence and the tension each survives](docs/themes.png)

### D. Pick the quotes

> Pick the quotes for the themes going in the paper.

The Quotes view shows the whole bank per theme — each extract with its codes (the theme's own
solid, any other it carries dimmed, so a quote that is only here through a tangential code reads
as such; a code filter narrows the bank to one), its timestamp with the recording's frame one hover
away where `watch-recording` left frames (click it to open the transcript there), word counts and
an inline/block mark — the ordered list of what is going in, the attribution spread updating as
you choose, and on the right the theme's own inspector, the same one the board shows (brief, the
agent's proposals and claims, story, tensions), so the story is written with the evidence in view — so
"a results section that quotes P3 seven times is a case study of P3" is caught while you are
choosing rather than afterwards. To shorten a quote, select the words: the script cuts them out of
the stored extract, so the paper's version is still transcript text and still verifies.

![The Quotes view: the bank of every extract carrying the theme's codes with word counts and inline-or-block marks, the ordered list of what is going in the paper, and the theme panel reporting which participants are not quoted anywhere](docs/quotes.png)

### Then the write-up

> Write the results section from the themes.

`ta.py report` hands the writing step a verified quote bank, the themes with their n/N, the
codebook appendix, and an audit. Every quote in any draft can be re-checked against the
transcripts with `verify-quotes`.

It writes to HCI conventions, which live in `references/writing-up.md`: themes stated as claims and
tagged with the research question they answer, prevalence given per participant with the
"frequency does not determine value" caveat attached, rules for when a quote is inline and when it
is a block, a method paragraph that discloses the agent's role, and why a reflexive TA does not
report inter-rater reliability.

---

## Two surfaces, and which is for what

|  | The workbench | The round document |
|---|---|---|
| carries | **operations over data** — dispute a coding, accept a code, move a card, choose a quote | **arguments and judgements** — why this code exists, what the theme means, which coding policy to adopt |
| you | click, drag, select | read, answer, comment |
| opens with | `ta.py … open` | the `interactive-plan` viewer |
| written to | the analysis files, by the script, as you click (the agent's proposals wait in `inbox.jsonl`) | the `.plan.md` itself, by your answers |

If a question could be answered by a click, it belongs in the workbench. If answering it needs a
sentence, it belongs in the document. The agent should never ask you something in prose that it
would then have to translate back into a command.

---

## What is in the analysis folder

```
analysis/
├── study.yaml        who the participants are, the analytic stance, the paper draft and its framing
├── codebook.yaml     the codes, their definitions, and the changelog   ← the source of truth
├── extracts.jsonl    every coded passage, verbatim, with its locator   ← written only by ta.py
├── themes.yaml       the themes, their briefs, the codes they gather, the agent's claims, the chosen quotes
├── inbox.jsonl       the agent's proposals and your threads, waiting  ← written only by the browser
├── memos.md          dated notes written during the analysis
├── reviews/          every round document, and the log of every change: yours at once, the agent's per pass
└── reports/          generated: quote bank, themes, coverage, codebook, audit
```

`codebook.yaml` is the source of truth; everything in `reports/` is a rendering of it. If you
leave comments on a rendered file, the agent archives that copy before regenerating, so the
feedback is never lost — but the place to say it is the workbench or the round document.

---

## Things you can say at any point

- *"Which participants said something about X?"* — answered from the extracts, with ids, never
  from memory.
- *"What did P4 actually say about the sidebar?"* — extract ids and their exact text, or a fresh
  read of the transcript.
- *"Is this theme carried by everyone or by three people?"* — from `coverage`, as n/N.
- *"Re-read T-04 for `trust.stakes`, I think we missed it there."* — or click the empty cell in
  the Coverage view, which stages the same request.
- *"Which codes belong in TH4 that I haven't put there?"* — or press *ask for candidate codes* in
  the theme's inspector; the answer is a list with a line of why each, plus the near misses.
- *"What can I actually claim from TH4?"* — or *ask for claims*: two to four candidate claims,
  each with the n/N and kind mix computed, and the account that complicates it.
- *"Here is the paper draft, read it before we do themes."* — `paper --add`, read in full, and its
  framing written above the board for you to correct.
- *"Show me the audit."* — validate, verify, coverage and duplicate suspicions, printed.

---

## Running it yourself

You rarely need to, but:

```bash
# open the workbench on an analysis folder (a transcript, code, theme or view name also works)
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <study>/analysis open T-07

# is the daemon up? where? stop it
node ~/.claude/skills/thematic-analysis/app/server.mjs --status
node ~/.claude/skills/thematic-analysis/app/server.mjs --stop

# what have I changed since the agent last looked? what is it still waiting on?
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <study>/analysis changes
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <study>/analysis inbox
```

One workbench daemon serves every study, on port 47821 when it is free. It stays alive between
sessions; that is not a leak.

---

## When something looks wrong

**A button seemed to do nothing.** Read the toast. Every gesture is carried out at once and says
so — *Applied: control → TH4*. If the script refused it (a recode that would leave an extract with
no codes, a rewording of text the agent changed meanwhile, a claim that quotes), the toast says
why, now, rather than a failed row turning up a pass later.

**codebook v12 · 3 unapplied → v13.** Edits to the codebook are pending until it is applied to
the transcripts; the next coding pass (or `bump`) makes the version. You never version an edit.

**The page looks stale after the agent worked.** It reloads on its own, within a second. If it
does not, the daemon may have been restarted under it; reload the tab.

**"stale · 3 need a pass".** A code was added or reworded after those transcripts were coded, so
Braun & Clarke's phase 2 says they need another look for that code. The agent handles it on the
next pass; `stale` names which codes changed.

**An operation refused.** It keeps its reason in the inbox and the rest of the pass still runs.
Retiring a code that still holds extracts, or rewording a definition the agent has since changed,
are the common ones. Fix the cause and hand back again.

**Something is marked `stalled`.** An `apply` died holding it. It is deliberately *not* retried,
because whether it took effect is a question about your data, not one to guess at. Check, then
tell the agent to apply it by id, or discard it.
