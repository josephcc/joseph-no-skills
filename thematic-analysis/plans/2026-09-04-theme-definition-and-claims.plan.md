**Status:** implemented 2026-09-04 · all six phases · revised the same day for direct manipulation (see the end)
**Date:** 2026-09-04
**Scope:** the Themes view: a theme you can work on the moment you create it, then define and argue with — a rule for what belongs, what you mean to write in the paper, agent-proposed codes measured against that rule, a claim summary grounded in the evidence, and the paper draft as registered context
**Related plans:** [the review workbench](2026-09-02-review-workbench.plan.md) (the board, the inbox, the daemon)

# A theme you can define, argue with, and claim from

Today a theme is a name, two sentences of essence, a story paragraph, an RQ, and a pile of codes
someone dragged in. That is enough to *record* a theme and not enough to *develop* one. The gap
shows up in four places at once, and they turn out to be the same gap: **there is no artifact on a
theme that a code assignment can be argued against.**

You name a theme — "Co-planning afforded steerability" — and then the board asks you to sort
thirty-five cards against a claim, from memory, with nothing written down about where its edge is.
The agent cannot help, because it has nothing to help *toward*: no rule to apply, no sense of the
argument you are reaching for, no view of the paper the theme has to land in. So it stays out of
phase 3 entirely, which is the phase where its two real strengths — carrying a criterion back
across the whole corpus, and noticing what you have not looked at — would matter most.

Underneath that sits a plainer problem, found while writing this plan: **a theme you just created
cannot be worked on at all.** `+ theme` stages a proposal, and until the agent applies it the column
is a ghost — you cannot drop a code on it and you cannot open its inspector. The moment you create a
theme is the moment you have the most to say about it: the story you think it tells, where its edge
is, and the four or five codes you already know it rests on. All of that currently waits for a
round-trip, and most of it evaporates.

This plan closes both in one pass: a staged theme becomes **immediately workable**, the theme gains a
**rule** and an **intent**, the board gains a **computed shortlist** of codes that might belong, the
agent gains a **request it can be sent** and a **claim it drafts against the evidence**, and the
analysis folder finally knows where the **paper draft** is.

---

## 1. Where the Themes view falls short

I went through `app/src/views/themes.tsx`, `app/src/inspector/theme.tsx`, the `themes.yaml` schema
in `references/data-model.md`, and Operation C in `SKILL.md`, asking at each point what you have to
hold in your head that the tool could hold for you.

<finding id="F-ghost-theme" title="A newly created theme cannot be worked on until the agent applies it" severity="p0" status="open" effort="medium">
`+ theme` stages a `new-theme` operation; the theme reaches `themes.yaml` only when `apply` runs
(`scripts/ta.py:3073`). Until then the board draws a ghost column (`app/src/views/themes.tsx:159`)
with no `onDragOver`, no `onDrop`, and no `onSelect` — so no code can be dropped on it and its
inspector cannot be opened. Even if the UI allowed the drop, `op_assign_theme` calls
`_need_theme(an, dest)` and would refuse, because the id does not exist yet.

That puts a full hand-back between naming a theme and doing anything with it, at exactly the wrong
moment. Creating a theme is not a bookkeeping act — it is the moment the reading arrives, with the
initial set of codes it rests on and a rough sense of the story. Making that wait for a round-trip
loses the reading and turns the board's most generative gesture into its slowest one.

Precedent that this is fixable rather than fundamental: `op_assign_theme` already materialises the
`MISC` theme on first drop (`ta.py:3106`), so a theme coming into existence on demand is not foreign
to the design.
</finding>

<finding id="F-no-rule" title="A theme has no rule you can apply to a code" severity="p1" status="open" effort="design">
Every code carries `definition`, `include`, and `exclude`, and that is what makes a coding decision
reviewable: `dupes` compares them, `stale` tracks when they move, and the transcript view puts the
definition beside the span so you judge a coding against the rule it should satisfy. A theme
carries `essence` — a two-sentence *summary*, explicitly scoped by Braun and Clarke's "does it fit
in a couple of sentences" test. A summary is not a rule. Nothing on `TH1` says what would
disqualify a code from it, so a proposed assignment can be liked or disliked but not *refused for a
reason*, and two sittings a week apart sort the same card differently.
</finding>

<finding id="F-no-intent" title="Nothing holds what you mean to write" severity="p1" status="open" effort="design">
`story` is documented as the finished analytic narrative — "interprets rather than paraphrases" —
and `theme_block` in `scripts/ta.py:1663` prints it straight into `reports/themes.md`. It is an
output. There is nowhere to put the thing you know on the day you create the theme, which is the
*argument you are reaching for*: I want to say co-planning gave people a handle mid-process, against
the chat baseline, and that this is why the steerability finding is not just a preference finding.
That sentence is written before the evidence is assembled, is allowed to be wrong, and is the single
most useful piece of context anyone — you in a fortnight, a co-author, the agent — could have when
deciding whether a code belongs.
</finding>

<finding id="F-unplaced-wall" title="The board shows placement, never affinity" severity="p1" status="open" effort="medium">
`themes.tsx:36` sorts the unplaced column by parent id and then alphabetically. With a
thirty-five-code codebook that is a wall of near-identical cards, ordered by something with no
bearing on the theme you are looking at. Meanwhile the analysis already computes exactly the signal
that would help: `cooccur_json` (`scripts/ta.py:1146`) knows which codes ride on the same extracts,
with Jaccard and both conditionals, and `participants_for_codes` knows who says what. All of it is
plumbed to the codebook view and none of it reaches the board.
</finding>

<finding id="F-cannot-ask" title="The agent cannot be sent an errand from the board" severity="p2" status="open" effort="small">
`reread-request` is the only "please go and look at this" operation, and it is a coverage-view
gesture about transcripts. From a theme you can stage a `comment`, which the agent answers in prose
in a thread — fine for a question, wrong for a task with a deliverable. So "check I have not missed
a code here" means leaving the workbench, remembering the theme id, and typing it into the terminal,
which is the thing the workbench exists to stop.
</finding>

<finding id="F-paper-invisible" title="The paper draft is not part of the analysis" severity="p1" status="open" effort="small">
`study.yaml` holds the roster, the stance, and the research questions. The research questions are
the *formal* framing; the draft is the *actual* one — what the paper is arguing, in what order,
against which related work, with which vocabulary already committed to. Nothing registers where it
is. `verify-quotes FILE.md` takes the path as an argument every single time and remembers nothing,
so even the one command that already reads the draft has to be told where it lives.
</finding>

<finding id="F-claim-unchecked" title="A theme's prose is never measured against its evidence" severity="p2" status="open" effort="medium">
The inspector warns when a theme has `intent` extracts and no `did` (`inspector/theme.tsx:97`), and
`spread_json` warns at quote time about a theme with no tension and a participant quoted too often.
Between those two there is nothing: the sentence that says what the theme *claims* is free prose,
never held against n/N, never held against the kind mix, never required to have met the tension it
is supposed to survive. That is the sentence that becomes a section heading.
</finding>

---

## 2. A theme you can work on the moment you create it

<decision id="D-staged-refs" title="A staged operation may reference what an earlier staged operation will create" status="superseded" date="2026-09-04" from="F-ghost-theme">
`+ theme` keeps staging a `new-theme` op — nothing reaches `themes.yaml` before you hand the pass
back — but the ghost column becomes a **fully live column**: droppable, selectable, with a working
inspector. The operations you stage against it target the *op id* of the pending `new-theme`
(`op-0031`), and `apply` resolves those references to the theme it creates.
<rationale>The alternative was to have the browser allocate the `TH<n>` id at stage time. That is
less work, but two tabs — or an agent creating a theme mid-pass — collide on the number, and the
dependent operations then orphan. Resolving through the inbox has no id to collide on, and the
plumbing is half-built already: `op_new_theme` records `op["created"] = tid` at `ta.py:3089`.

The third option, having `+ theme` write through to `themes.yaml` immediately via the daemon, was
rejected: it breaks the invariant that nothing reaches the analysis files until the pass is handed
back, which is what makes the pending drawer worth trusting.</rationale>
</decision>

### How the reference resolves

`OP_SPECS` already declares what each operation's target is (`target: "theme" | "code" | "extract"
| "none"`), so the rule is declarative rather than per-operation: **any field declared as a `theme`
target, plus any argument named in a new `refs` key on the spec, may carry an `op-\d+` reference
instead of an id.** That covers `assign-theme`'s `theme`, and the targets of `set-theme-field`,
`set-tension`, `merge-theme`, and the three quote operations — and extends to `new-code` and
`new-extract` later without new machinery.

`apply` gains one step. It already runs the inbox in staged order, so the `new-theme` executes
first; it keeps a `{op id → created id}` map for the pass and rewrites references before dispatching
each later operation.

Two failure paths, both of which have to behave:

- **The referenced operation failed, or was never run.** The dependent operation fails on its own
  with `op-0031 created no theme`, stays in the inbox with its `error`, and blocks nothing else —
  the existing contract for a bad line. Fix the cause, apply again.
- **You undo the `new-theme` while things point at it.** The browser knows how many operations
  reference it, so the undo cascades — root and dependants together, with a count in the
  confirmation — the way discarding a thread already takes its replies (`deleteThreadOp`).

### What the board and the inspector do

`overlay.ts` already collects pending `new-theme` ops into `patch.newThemes` (`overlay.ts:199`). It
gains one job: synthesising a **provisional `Theme`** from the staged operations — id is the op id,
`name` and the prose fields from the `set-theme-field` ops pointing at it, `codes` from the
`assign-theme` ops. `ThemeInspector` then takes it unchanged.

The counts are real, not blank: n/N, the extract count, and the kind mix all derive from the codes
you have dropped in, so the provisional theme tells you what it would hold *while* you are deciding
what it holds. That is most of why dropping codes at creation time is worth having. The column keeps
its `staged · not applied yet` marking throughout, and the inspector says plainly that these edits
travel as one batch on the next hand-back.

<check id="k-lint" status="done">**Do not forget `validate`'s inbox lint.** It currently requires a target to name something that exists, and `preflight` refuses to open the workbench on a validate error (`ta.py:3874`). Unless the lint learns to accept a reference that a pending `new-theme` in the same inbox will satisfy, staging one field edit on a ghost theme locks you out of the workbench entirely.</check>

---

## 3. The shape of a theme

Three of the findings above are one decision: what fields a theme carries, and who writes each one.
The skill's spine is that authorship is legible — `by: user` against `by: agent`, the researcher's
definition against the agent's `proposal` block — so the fields should split the same way.

<open-question id="Q-fields" title="What fields does a theme gain, and what happens to essence and story?" status="answered">
Whatever the shape, the same three jobs have to be done: **a rule** an assignment can be refused
against, **an intent** written early and allowed to be wrong, and **a claim** the agent drafts from
the evidence and you edit. The fork is how many fields that is, and whether the two existing fields
keep their meanings.

Weigh it against two costs. Every field is another box in a pane that is already long, and another
column in `reports/themes.md`. But collapsing two jobs into one field is how `story` ended up
meaning both "what I want to argue" and "the paragraph that ships".

<options select="single">
  <option id="opt-three">**Three new fields; `essence` and `story` keep their jobs.** (recommended)

| field | who writes it | what it is |
|---|---|---|
| `name` | you | the claim, as now |
| `essence` | you | the two-sentence scope test, as now |
| **`definition`** | **you** | **the rule: what belongs under this theme and what does not.** Written the way a code definition is written — as something a second person could apply. `boundary:` holds the near-miss ("not complaints about output quality with no reference to steering — that is TH3") |
| **`intent`** | **you** | **what you mean to write in the paper about this.** Written the day the theme is created, ahead of the evidence, in whatever register you think in |
| **`claim`** | **the agent, staged** | **what the evidence actually supports** — the claim sentence, n/N, the kind mix, and the tension named. Never written without your accepting it |
| `story` | you | the analytic narrative for the write-up, as now, seeded from the accepted `claim` |

The cost is honest: five prose fields on a theme, and the inspector has to collapse. The gain is
that `definition` is a rule the agent's proposals can be *refused* against, and `intent` and `claim`
are the same object from the two ends — what you want to say, and what the data lets you say. Having
both visible at once is the point; the gap between them is the analysis.
  </option>
  <option id="opt-two">**Two new fields; `story` is relabelled to carry the intent.**

`essence` becomes the definition in practice (relabelled "what belongs under this theme", with the
two-sentence counter demoted from a test to a hint). `story` is relabelled "what you want to say in
the paper" and grows from an early intent into the finished narrative in place. `claim` is the one
genuinely new field.

Leaner, and the report path is untouched. The cost is that the early intent and the shipping
paragraph share a box, so the aspiration is overwritten by the prose the day you write the prose —
and the aspiration is exactly what you would want to compare the finished claim against.
  </option>
  <option id="opt-brief">**One `brief` field with headed sections, plus `claim`.**

A single markdown field with conventional headings (`## Rule`, `## What I want to say`, `## Not
this`), edited as one textarea. The inspector renders it; nothing parses it.

Fewest moving parts and maximum freedom in how you write. But nothing structured can be built on it:
`theme fit` cannot weight the rule separately from the intent, `validate` cannot notice a theme with
no rule, and the report cannot lay themes out in a table.
  </option>
</options>

<answer by="user" at="2026-09-04T20:53" chose="opt-brief">

</answer>
</open-question>

<decision id="D-brief" title="One `brief` field the researcher writes, plus an agent-owned `claim`" status="locked" date="2026-09-04" from="Q-fields">
A theme keeps `name`, `essence`, and `story`, and gains **`brief`** — one markdown field, written by
you, with conventional headings you are free to ignore:

```yaml
    brief: |
      ## Rule
      A code belongs here when the participant is acting on, or describing acting on, the agent's
      process while it runs — composing, editing, rerunning, or aborting a step.
      ## Not this
      Judgements of the finished output with no reference to intervening (-> TH3). Wanting to
      intervene without having done so.
      ## What I want to say
      Plan-level interaction changes what steering *is*. Contrast with the chat baseline should be
      explicit and should rest on what people did, not what they preferred.
```

Nothing parses it. The inspector renders it as markdown and edits it as one textarea; the agent
reads it whole.
<rationale>My objection to this option when I wrote it — that `theme fit` needs the rule weighted
separately from the intent, and the claim checked against the rule — **has been overtaken by
D-proposal-shape.** There is no longer a scored shortlist to weight anything for. The agent reads the
brief as prose and judges, which is what prose is for. What is genuinely lost is small: `validate`
cannot tell a theme with no rule from a theme with a short one, and `reports/themes.md` cannot lay
the parts out in separate columns.</rationale>
</decision>

<decision id="D-claim-owned" title="`claim` is the agent's field; you judge it at writing time, not by accepting it" status="locked" date="2026-09-04" from="c1">
`claim` is not a negotiated field and does not go through the accept-or-reject flow. The agent writes
it directly on each pass, marked `by: agent`, and rewrites it freely as the evidence moves. Your
review of it happens when you write the paper, not as a click on the board.

Consequences: no `old`-text refusal on it (the agent is the only writer, so there is nothing to
clobber), no staged proposal in the pending drawer, and `validate` treats it as derived rather than
authored — a `claim` on a theme whose extracts have changed is *stale*, not *wrong*.
<rationale>Your words: "I like the claim field to be agent owned, its the agents summary of what
potential claims there are in a theme, I will review them and be the judge of which is warranted when
I write the paper." That is a different object from a theme's name or rule, and making you accept it
would be ceremony over a thing you have said you will judge later anyway.

This supersedes D-authorship, which you marked wontfix.</rationale>
</decision>

<open-question id="Q-claim-count" title="One claim per theme, or several candidates?" status="answered">
Q-claim-shape settled the *shape* — a claim sentence, a computed evidence line, the tension named.
Your comment on it says "what potential **claims** there are in a theme … I will be the judge of
which is warranted", which reads as more than one.

<options select="single">
  <option id="opt-claim-several">**Two to four candidate claims per theme, each with its own evidence line and tension.** (recommended) Different claims from the same theme cut the evidence differently — the strong-but-narrow one that rests on 5/12 and the safe-but-flat one that rests on 11/12 — and seeing them together is what makes the choice a choice. Matches how the agent is meant to propose everywhere else in this skill: a spread, not a verdict. Costs more generated prose per theme.
  </option>
  <option id="opt-claim-one">**One claim, the strongest the agent can defend.** A single sentence to react to; you rewrite it if it is wrong. Less to read; hides the trade-off you would have wanted to see, which is usually between reach and prevalence.
  </option>
  <option id="opt-claim-one-plus">**One claim, plus a line naming the alternative reading it beat.** A compromise: the recommendation is unambiguous and the road not taken is still on the page, but the alternative gets no evidence line of its own, so you cannot weigh it without asking.
  </option>
</options>

<answer by="user" at="2026-09-04T21:10" chose="opt-claim-several">

</answer>
</open-question>

<open-question id="Q-in-ui-agent" title="Does the workbench ever call a model itself?" status="answered">
Everything in this plan keeps the current shape: the daemon runs `ta.py`, so every judgement — the
code proposals, the claim, reading the paper — waits for you to hand the pass back in chat. Pressing
"ask for candidate codes" stages an errand and nothing visibly happens. That is worth deciding
deliberately rather than inheriting.

<options select="single">
  <option id="opt-ui-batch">**No. Keep the batch rhythm.** (recommended for this plan) The board is for authoring and reviewing; the model runs in the chat session where you can watch it reason, interrupt it, and argue with it. Errands accumulate and are serviced in one pass, the way codebook rounds already work. The cost is that the board's most interesting buttons are inert until you switch context.
  </option>
  <option id="opt-ui-headless">**Yes — the daemon shells out to `claude -p` for one scoped task per button.** The tray fills while you are still looking at the theme. Genuinely better as an interaction, and a substantially different tool: the workbench needs model access, the reasoning happens outside the transcript, and a proposal you did not watch being derived is one you have less reason to trust. Its own plan, not a phase of this one.
  </option>
  <option id="opt-ui-nudge">**No model, but close the loop.** The board shows a standing count of pending errands and the exact command to run, and the chat session can be told to watch the inbox and service errands as they appear. No new trust boundary; removes the "did I remember to hand it back" problem, which is most of the friction.
  </option>
</options>

<answer by="user" at="2026-09-04T21:09" chose="opt-ui-batch">
We will change this in the future, but not today
</answer>
</open-question>

<decision id="D-authorship" title="The claim is always staged, never written directly" status="wontfix" date="2026-09-04">
The agent writes `claim` only through a `set-theme-field` operation carrying `by: agent`, so it
lands in the proposals half of the pending drawer (`app/src/pending.tsx:65`) and reaches
`themes.yaml` only when you hand the pass back. The same rule the codebook already runs on
candidate codes: the agent does not accept its own proposals. <user-highlight comment="c1"></user-highlight>
<rationale>
A theme's claim is the sentence that becomes a section heading. A generated one that
appeared in the file without a click is exactly the "codebook the agent generated and he waved
through" failure the skill is built to avoid.
</rationale>
</decision>

---

## 4. Proposing the codes that belong

What you want back is a list: *these codes belong in this theme, and here is a line each on why.*
Not a score, not a ranked panel to interpret — a verdict, card by card, that you accept or reject.

That is a judgement, so it needs a model, and it lands on a hand-back. What the script contributes
is not a ranking you read but a **guarantee about what the agent looked at**: `ta.py theme fit TH1`
enumerates every live code against the theme, carrying the co-occurrence and participant-overlap
numbers already computed for the codebook view (`cooccur_json`, `scripts/ta.py:1146`). Its job is to
make the agent's pass cover all thirty-five codes rather than the six it happens to remember. Its
output goes into the agent's context. It has no panel on the board.

<decision id="D-two-speeds" title="A live computed shortlist; agent proposals on the next pass" status="superseded" date="2026-09-04">
The daemon runs `ta.py`, not a model, so nothing in the browser can call the agent. Rather than
pretend otherwise: `theme fit` re-ranks live in the inspector, and asking for the agent's reading
stages a request it services when you hand the pass back — the `reread-request` pattern
(`scripts/ta.py:3058`), which already records into `study.yaml` and surfaces in the bundle.
<rationale>
Naming the latency in the design beats hiding it behind a spinner that resolves in
twenty minutes. And most of the value of "did I miss one" is in the ranking, which is instant.

**Superseded by D-proposal-shape**: the half about *how the agent is asked* survives intact; the
half about a live scored shortlist in the inspector does not, because a ranking is not what the
proposal should look like.
</rationale>
</decision>

<decision id="D-proposal-shape" title="A binary list with a line of why, not a ranking" status="locked" date="2026-09-04" from="Q-signals">
The agent returns **a list of codes it thinks belong in the theme, each with a very brief why** —
one line, the reason this code satisfies this theme's rule. No score, no columns, no ordering to
interpret.

Each proposal is a staged `assign-theme` carrying its `why`, rendered as a card in the theme's
inspector with the code's n/N, its current placement if it sits elsewhere, and a preview of two of
its extracts. Accepting is leaving it staged; rejecting is undoing it. That reuses the accept and
reject machinery the codebook's candidate codes already run on, so there is nothing new to learn.

Asking for the list still works the way D-two-speeds described: a `theme-request` staged from the
board, serviced on the next hand-back, on the `reread-request` pattern (`scripts/ta.py:3058`).

`ta.py theme fit` survives as the agent's own recall check — enumerate every live code, do not
propose from memory — and prints to the terminal or `--json` into the agent's context. It gets no
route on the daemon and no panel in the inspector.
<rationale>Answered in conversation, 2026-09-04: "what i want is binary + explanation. A list of code
that you think should go into a theme, plus a very brief 'why'."

A scored shortlist asks you to do the judging twice — once on the numbers and again on the extracts —
and the numbers are the weaker of the two readings. The agent has read the transcripts; it should say
what it thinks and defend it in a line, which is also the form you can most quickly disagree
with.</rationale>
</decision>

<open-question id="Q-pool" title="Which codes may be proposed for a theme?" status="answered">
The unplaced column is the obvious pool. It is also, in my experience of the dry-run boards, the
*least* likely place for the code you missed: a code you missed is usually one you already sorted,
into the neighbouring theme or into `miscellaneous`, on a reading you have since changed.

<options select="single">
  <option id="opt-unplaced">**Unplaced only.** The shortlist offers cards from the unplaced column and nowhere else. Simplest, and a drag is unambiguous — the code moves. Never surfaces the code sitting in the wrong theme.
  </option>
  <option id="opt-plus-misc">**Unplaced plus `miscellaneous`.** The parking pile is explicitly temporary, so treating it as a source is uncontroversial, and it catches the "I'll deal with this later" miss. Still silent about the neighbouring theme.
  </option>
  <option id="opt-everything">**Every live code, with its current placement shown.** (recommended) The shortlist ranks all of them and badges each with where it currently sits. Proposing one that lives in TH3 is a *challenge* to TH3, which is precisely the phase-4 question of whether two themes are distinct, arriving at the moment it is answerable. Needs the next question settled, because accepting it means either moving the code or having it in two places.
  </option>
</options>

<answer by="user" at="2026-09-04T20:55" chose="opt-everything">

</answer>
</open-question>

<open-question id="Q-double" title="May one code belong to two themes?" status="answered">
`themes.yaml` has never forbidden it — `codes:` is a list per theme and nothing cross-checks — and
`theme_family` would happily count an extract under both. The board half-assumes exclusivity:
`themes.tsx:34` builds one flat `placed` set, so a code in two themes simply leaves the unplaced
column and shows up in two columns.

It matters for prevalence. A code counted under two themes means an extract counted under two
themes, and two themes that each claim P4 on the strength of the same sentence are not as
independent as their n/N suggests.

<options select="single">
  <option id="opt-exclusive">**Exclusive.** A code lives in one theme; `assign-theme` moves it and `validate` errors on a double placement. Prevalence stays clean and the board's semantics match its behaviour. Loses the genuine case where one code legitimately feeds two claims.
  </option>
  <option id="opt-allowed-flagged">**Allowed, flagged, and reported.** (recommended) A code may sit in two themes; `validate` warns, the card shows both, and `coverage` prints the extracts double-counted so the overlap is visible wherever the n/N is. Matches how the codebook already treats overlap — `cooccur` reports it rather than forbidding it.
  </option>
  <option id="opt-allowed-silent">**Allowed and silent.** No warning, no report. Least work, and the least defensible number in the paper.
  </option>
</options>

<answer by="user" at="2026-09-04T20:55" chose="opt-allowed-flagged">

</answer>
</open-question>

<open-question id="Q-signals" title="What does the fit ranking actually measure?" status="answered">
**Answered by rejecting the premise** — see D-proposal-shape. The options below asked how to score a
shortlist; what the proposal should be is a list with a reason each, and the computed signals belong
in the agent's context rather than on the board. Kept for the record.

The score has to be legible — a shortlist you cannot interrogate is an oracle, and the reason the
codebook view shows Jaccard and both conditionals rather than one number is that you asked for the
working.

<options select="single">
  <option id="opt-cooccur">**Co-occurrence only.** Rank by how many of the candidate code's extracts also carry a code already in the theme, with the two conditionals shown. One signal, entirely explainable, already computed. Blind to a code that belongs to the theme's claim but never shares an extract with it — which is common when the theme spans phases of a task.</option>
  <option id="opt-three-signals">**Co-occurrence + participant overlap + lexical overlap with the rule.** (recommended) Three columns, shown separately and never summed into a single score: how often it rides along, how much of the same cast it draws on, and how much its name and definition share with the theme's `definition` and `intent`. The third is what makes writing the rule immediately useful — you type the boundary, and the shortlist reorders under it.</option>
  <option id="opt-semantic">**The three signals, plus an agent pass over every extract of every candidate.** The corpus-wide semantic recall — the agent reads the actual extracts behind the top candidates rather than their labels, and says which ones satisfy the rule. Strictly better recall and the only way to catch a code whose *label* is unrelated but whose extracts are on point. It is a real token cost per theme, and it belongs to the hand-back half, not the live half — so this option is really "make it the default of the agent's pass" rather than a change to the ranking.</option>
</options>

<answer by="user" at="2026-09-04T21:10">
Binary plus explanation: a list of codes that should go into the theme, and a very brief why for
each. Not a ranking. (Given in conversation; recorded here.)
</answer>
</open-question>

<open-question id="Q-rejected" title="Does the agent also say what it left out?" status="answered">
The list of codes that belong is the deliverable. The open half is whether anything is said about the
codes that do not — which is the difference between "here are six codes" and "I checked all
thirty-five and here are the six, plus the four I nearly included."

<options select="single">
  <option id="opt-rej-near">**The near misses only.** (recommended) Up to about five codes the agent seriously considered and did not propose, each with the one clause of your rule that excluded it. Bounded, readable, and it is where a disagreement about the theme's edge actually surfaces — a rejection you disagree with tells you your `boundary` is wrong.
  </option>
  <option id="opt-rej-none">**Nothing.** Just the codes that belong. Shortest to read, and the `theme fit` enumeration is still the guarantee that the agent looked at everything. You would find a miss the next time you read the board rather than in the proposal.
  </option>
  <option id="opt-rej-all">**Every live code, in or out, with a reason.** Complete and auditable; thirty-five lines per theme, most of them obvious, which is how a list stops being read.
  </option>
</options>

<answer by="user" at="2026-09-04T20:59" chose="opt-rej-near">

</answer>
</open-question>

### The agent's side of it

For each theme it is asked about, the agent reads the rule, the intent, the paper framing, and the
extracts behind the shortlist, and stages:

- one `assign-theme` per code it would place, `by: agent`, with a new optional `why` argument
  carrying **one line** — the reason this code satisfies this theme's rule. Rendered as a tray of
  proposed cards, each with its n/N, its current placement if it has one, and a preview of two
  extracts; accepted by leaving it staged, rejected by undoing it;
- the near misses, if <user-highlight comment="c-rejected"></user-highlight>Q-rejected lands that way;
- a **second reading** where one genuinely exists — the tight boundary and the inclusive one, each
  with the codes it takes and the trade-off, as a comment thread on the theme. Per the standing rule
  that a single proposal offered as the obvious answer is a decision taken on your behalf. This is a
  thread, not a second tray: it is an argument about the theme's edge, not more cards to sort.

---

## 5. The claim summary

<open-question id="Q-claim-shape" title="What shape is the generated claim?" status="answered">
The purpose is a sentence you could put in the paper, plus enough attached for you to see instantly
whether it is overreach.

<options select="single">
  <option id="opt-structured">**A headline sentence, a required evidence line, and the tension.** (recommended)

```
claim: >
  Co-planning gave participants a handle on the agent mid-process, not merely a better
  result: they intervened at step boundaries they could see, and read the ability to
  intervene as the difference from chat.
evidence: 9/12 participants · said 31 / did 14 / intent 6 · TH1 codes: control,
  control.rerun, execution-mode
tension: E-0099 (P7) reversed this once the plan exceeded six steps — the handle became
  a review burden. The claim holds for short plans and is qualified beyond them.
```

The evidence line is computed by the script, never typed, so it cannot drift from `coverage`. The
tension line is refused if `tensions` is empty — which turns a nagging warning into a step of the
work.
  </option>
  <option id="opt-paragraph">**One short paragraph, free-form.** The agent writes three or four sentences that interpret the theme and mention the numbers in prose. Reads better; nothing computed can be checked against it, and the numbers are then typed, which is the failure mode this skill exists to prevent.
  </option>
  <option id="opt-both">**Both: the structured block, plus a paragraph draft of the write-up.** The block is the check; the paragraph is a head start on `story`. More generated prose to review per theme, and a risk that the paragraph gets waved through because the block above it looked rigorous.
  </option>
</options>

<answer by="user" at="2026-09-04T20:56" chose="opt-structured">

</answer>
</open-question>

<decision id="D-claim-quotes" title="A claim cites extract ids; the script renders the words" status="proposed" date="2026-09-04">
The claim may reference evidence only by extract id. Where it needs the words, the inspector and
`reports/themes.md` render them from `extracts.jsonl`. The standing rule — never write a
participant's words from memory, in any file — applies to generated claims with no exception, and
citing by id is what lets `verify` re-check a claim as easily as a quote.
</decision>

<open-question id="Q-claim-lint" title="Should a claim be lintable, and how hard?" status="answered">
There are checks a script can genuinely make against a claim, and a line past which it would be
guessing at prose.

<options select="single">
  <option id="opt-lint-computed">**Only what is computed.** (recommended) `validate` warns when: a theme has a `claim` and no `tensions`; the claim's stored evidence line disagrees with the current `coverage` (the data moved under it); a claim exists on a theme whose extracts include no `did` while `in_paper` is `headline`. All three are facts about the data, not readings of the sentence.
  </option>
  <option id="opt-lint-prose">**Computed checks plus a prose check for behavioural language.** Additionally flag a claim containing "did", "used", "switched", "intervened" on a theme with zero `did` extracts. Catches the exact overreach the skill worries about most; will also fire on "participants said they did", and a check that cries wolf gets ignored.
  </option>
  <option id="opt-lint-none">**No linting.** The computed evidence line sits beside the claim in the inspector and you read them together. Nothing to tune, nothing to suppress.
  </option>
</options>

<answer by="user" at="2026-09-04T20:57" chose="opt-lint-computed">
I'm not really paying attention to the did tag that much
</answer>
</open-question>

---

## 6. The paper draft as registered context

<open-question id="Q-paper" title="How is the draft registered, and how much of it does the agent read?" status="answered">
You asked for the whole paper, to capture the high-level framing. The question is where that
instruction is recorded so it survives the session, and whether every subsequent pass pays for it
again.

<options select="single">
  <option id="opt-paper-full">**`study.yaml` gains `paper:`; the agent reads it in full at the start of every theme operation, and writes down what it took.** (recommended)

```yaml
paper:
  - path: ../paper/main.tex
  - path: ../paper/related-work.tex
framing: >                     # written by the agent after reading, shown atop the Themes board
  The paper argues that plan-level interaction changes what steering *is* — from re-prompting
  to intervening — and positions this against instruction-following work that treats steering
  as prompt quality. Results are ordered: what people could now do, what it cost them, where
  it broke down. Section 5 already commits to the words "steerability" and "intervention".
```

Reading it in full is the ask, and it is cheap next to a set of transcripts. `framing` is the
durable residue: a second session, or a co-author, gets the reading without re-deriving it, and
because it sits above the board every theme is drafted against a visible framing rather than a
remembered one. `ta.py paper` prints what is registered, the word counts, and a diff-friendly digest
(title, abstract, headings, and every sentence mentioning a theme name) for the cheap refresher
between full reads. It also gives `verify-quotes` a default target, so the drafts get checked
without being named each time.
  </option>
  <option id="opt-paper-digest">**Registered the same way, but the digest is the default read; the full read happens when you ask for it or when `framing` is empty.** Cheaper per pass. The risk is that the framing goes stale silently — a paper is rewritten most in exactly the week you are developing themes.
  </option>
  <option id="opt-paper-glob">**Register a folder, not files.** `paper: ../paper/` and the script globs `*.tex`/`*.md`, ordered by `\input` order where it can find it. Survives a paper that gets split into more files; picks up reviewer-response drafts and old versions unless excluded.
  </option>
</options>

<answer by="user" at="2026-09-04T20:59" chose="opt-paper-full">

</answer>
</open-question>

<decision id="D-framing-visible" title="The framing sits above the board, not in a file the agent alone reads" status="proposed" date="2026-09-04">
Whatever the reading strategy, the agent's summary of the paper's framing is displayed at the top of
the Themes view, collapsed, editable, and staged like any other field. If the agent has
misread what the paper is arguing, that is a thing you must be able to see and correct *before* it
proposes anything — not something you infer from a bad proposal three themes later.
</decision>

---

## 7. What is settled

Answered in the viewer, recommended option taken in each case, no elaboration needed beyond the
option text: **Q-pool** — the agent may propose from every live code, badged with where it currently
sits. **Q-double** — a code may sit in two themes; `validate` warns and `coverage` prints the
double-counted extracts. **Q-rejected** — the agent reports its near misses, about five, each with
the clause of your rule that excluded it. **Q-claim-shape** — the claim is a sentence, a computed
evidence line, and the tension named. **Q-paper** — `paper:` in `study.yaml`, read in full at the
start of theme work, with the agent's `framing` summary stored and shown above the board.

<decision id="D-claim-lint" title="Two computed checks on a claim; nothing about `did`" status="locked" date="2026-09-04" from="Q-claim-lint">
`validate` warns when a theme has a `claim` and no `tensions`, and when a claim's stored evidence
line disagrees with current `coverage` — the data moved under it. Both are facts about the data.

The third check I proposed — a claim on a `headline` theme whose extracts contain no `did` — is
**dropped**, on your note that you are not paying much attention to that tag.
<rationale>Worth flagging separately, since it is outside this plan: the `did` tag already drives the
inspector's "Nothing here is a *did*" banner (`inspector/theme.tsx:97`) and `spread`'s `no-did-quote`
warning at quote-selection time. If the distinction is not doing work for you, those two are noise
and should be toned down in their own pass.</rationale>
</decision>

---

## 8. What changes, concretely

### `themes.yaml`

New keys per theme (D-brief, D-claim-owned). Whether `claims` holds one entry or several is <user-highlight comment="c-fields"></user-highlight>Q-claim-count:

```yaml
  - id: TH1
    name: Co-planning afforded steerability
    essence: >  …unchanged…
    brief: |                           # yours: one markdown field, headings optional, nothing parses it
      ## Rule
      A code belongs here when the participant is acting on, or describing acting on, the agent's
      process while it runs — composing, editing, rerunning, or aborting a step.
      ## Not this
      Judgements of the finished output with no reference to intervening (-> TH3).
      ## What I want to say
      Plan-level interaction changes what steering *is*; the contrast with chat should be explicit.
    claims:                            # the agent's, written directly, never staged for acceptance
      - text: >  …
        evidence: {n: 9, N: 12, said: 31, did: 14, intent: 6, computed: 2026-09-04}
        tension: E-0099
      written: {by: agent, at: …, version: 6}
    story: |  …unchanged: the narrative that ships…
```

### Operations

| op | change |
|---|---|
| *(every op with a `theme` target)* | may carry an `op-\d+` reference in place of an id, resolved by `apply` (D-staged-refs). `OP_SPECS` gains a `refs` key naming the arguments that may also carry one — `assign-theme.theme` to begin with |
| `assign-theme` | gains optional `why` — the agent's case, rendered on the proposed card |
| `set-theme-field` | `THEME_FIELDS` (`scripts/ta.py:3130`) gains `brief`. `claims` is *not* in the set — it is agent-owned and written by `ta.py theme claim`, never staged (D-claim-owned) |
| `theme-request` | **new.** `target: theme`, `args: {kind: "codes" \| "claim" \| "both", note}` — the errand from the board; recorded like `reread-request` and surfaced in the bundle so the agent picks it up on the next pass |

### Commands

```bash
ta.py theme fit TH1 [--json]                         # every live code against the theme: the agent's recall check
ta.py theme claim TH1 --check                        # recompute the evidence line; report drift
ta.py paper [--digest] [--check]                     # what is registered; the digest; verify-quotes over it
ta.py theme request TH1 --codes --claim              # the CLI half of the errand, for symmetry
ta.py inbox --json                                   # now prints each op's resolved target beside its raw one
```

### The inspector

Ordered as the work is done, with everything below `intent` collapsed until it has content:

1. **name** · **essence** — as now.
2. **brief** — one tall markdown box: the rule, the near-miss, and what you want to say. The only
   field on the pane with no counter, no test, and no warning on it. It is allowed to be wrong.
4. **codes the agent proposes** — a tray of cards, each with its one-line `why`, its n/N, where it
   currently sits if it is placed elsewhere, and two of its extracts. Drag into the column to accept,
   undo to reject. Empty until a pass has run, with a footer button that stages the errand.
5. **claims** — the agent's, read-only, each with its computed evidence line and the tension it
   names, over a *copy into `story`* affordance. Marked as the agent's summary, not a decision
   awaiting you.
6. **tensions**, **its extracts**, **threads** — as now.

### `reports/themes.md` and the write-up

`theme_block` gains the definition, the intent, and the claim above the story, and
`references/writing-up.md` gains the rule that a section's opening claim comes from the accepted
`claim` block rather than being written fresh — so the sentence in the paper and the sentence the
evidence was checked against are the same sentence.

---

## 9. Phasing

<check id="k-staged" status="done">**Phase 1 — the staged theme is workable.** Reference resolution in `apply` and the `refs` key on `OP_SPECS`; the inbox lint that accepts a pending reference; the provisional `Theme` in `overlay.ts`; the ghost column made droppable and selectable; cascading undo. This one ships on its own — it is worth having before any new field exists.</check>
<check id="k1" status="done">**Phase 2 — the brief.** `themes.yaml` schema, `THEME_FIELDS` gains `brief`, the inspector's markdown box, `theme_block`, `references/data-model.md`. Nothing generated yet; you can write a brief and the report prints it.</check>
<check id="k2" status="done">**Phase 3 — the recall check.** `ta.py theme fit` and its `--json`: every live code against the theme, with the co-occurrence and participant numbers. Terminal and agent context only — no daemon route, no panel.</check>
<check id="k3" status="done">**Phase 4 — the errand and the proposals.** `theme-request`, `assign-theme --why`, the proposed-cards tray, the second-reading thread, and the near misses if Q-rejected takes them.</check>
<check id="k4" status="done">**Phase 5 — the paper and the claims.** `paper:` in `study.yaml`, `ta.py paper`, the framing banner, `ta.py theme claim` writing the agent-owned block, the two computed lint checks, `verify-quotes` defaulting to the registered drafts.</check>
<check id="k5" status="done">**Phase 6 — SKILL.md.** Operation C rewritten around this loop; the reference block; the README screenshot of the new inspector.</check>

Tests to add alongside: a `new-theme` + `assign-theme` + `set-theme-field` batch staged against one
op id and applied in a single pass; the same batch when the `new-theme` fails, asserting the
dependants fail cleanly and stay in the inbox; the inbox lint accepting a pending reference and still
rejecting a dangling one; the fit ranking on the two-participant fixture (a code that co-occurs, one
that shares only participants, one that shares only vocabulary); `validate` catching a claim whose
evidence line has drifted from `coverage`; `theme-request` round-tripping through `apply`; the
double-placement rule from <user-highlight comment="c-double"></user-highlight>Q-double, whichever way it goes; and an `assign-theme` carrying `why`
surviving `apply` into the changelog.

<comment id="c-fields" status="open" kind="question">
  <note by="agent" at="2026-09-04T10:00">This is the question the rest of the plan hangs on — the shortlist weights the rule separately from the intent, and the claim is checked against the rule, so opt-brief would cost both of those. Worth answering first.</note>
  <note by="agent" at="2026-09-04T21:40">Withdrawing that objection: D-proposal-shape removed the scored shortlist, so there is nothing left that needed the rule and the intent in separate fields. `opt-brief` costs almost nothing now — `validate` cannot distinguish a theme with no rule from one with a terse rule, and the report cannot column them. Both fine. Recorded as D-brief.</note>
</comment>

<comment id="c-double" status="open" kind="clarify">
  <note by="agent" at="2026-09-04T10:00">Q-pool's recommended option (propose from every live code) only makes sense if this one lands on "allowed, flagged" or on "exclusive with an explicit move". If you want strict exclusivity *and* a proposal that touches another theme, accepting it should stage the removal from the old theme in the same operation — say so and I will spec that instead.</note>
  <note by="agent" at="2026-09-04T21:40">Resolved by your answers: Q-pool took opt-everything and Q-double took opt-allowed-flagged, which is the consistent pair. A proposed code that already lives in TH3 is therefore an *addition*, not a move, and the card says so — with `validate` warning on the double placement and `coverage` printing what gets counted twice. Suggest closing this thread.</note>
</comment>


<comment id="c1" status="open" kind="clarify">
  <note by="user" at="2026-09-04T20:54">I think I like the claim field to be agent owned, its the agents summary of what potential claims there are in a theme, I will review them and be the judge of which is warranted when I write the paper</note>
</comment>
<comment id="c-rejected" status="open" kind="question">
  <note by="agent" at="2026-09-04T21:10">The only piece of the proposal still open after D-proposal-shape. My instinct is the near misses earn their place — a rejection you disagree with is the fastest way to find out your `boundary` clause is wrong — but it is five more lines to read per theme, every theme, so it is your call.</note>
</comment>

---

## Implementation record (2026-09-04)

Built in one pass, every decision as locked. Verified end to end against a copy of the playtest
study (37 codes, 3 participants, 116 extracts) in the real workbench, not only in the test suites.

**Phase 1 — the staged theme is workable.** `OP_SPECS` gained a `refs` key (`assign-theme.theme`,
`merge-theme.into`); any theme-target op may carry an `op-NNNN` reference. `apply` resolves
references before dispatch from an `{op id → created id}` map seeded from every applied log, so a
reference outlives the pass that created its theme, and records what it rewrote in `resolved_refs`.
A dangling reference fails that one operation (`op-0031 created no theme yet …`) and blocks nothing
else. The inbox lint (`validate_op`) accepts a reference a pending `new-theme` will satisfy, so
`open` still launches with a field edit staged on a ghost theme. In the browser the ghost column is
a real `Column` — droppable, selectable — over a provisional `Theme` assembled by `overlay.ts` from
the ops pointing at the op id, with n/N and the extract count derived from the codes dropped in (the
one number the browser computes, since `ta.py` cannot count a theme that does not exist).
`+ theme` selects the new column at once. Undoing a `new-theme` cascades to its dependants after a
confirm with the count; the daemon's `DELETE /api/inbox` gained `withDependants`. Found and fixed on
the way: a *candidate* theme with no essence was a `validate` error, which meant `+ theme` put the
analysis in an error state until a sentence was written; it is now an error only for an accepted
theme.

**Phase 2 — the brief.** `brief` in `THEME_FIELDS`, `new-theme --brief`, rendered as markdown in
the inspector with no counter and no warning, printed by `theme_block`.

**Phase 3 — the recall check.** `ta.py theme fit TH1 [--json]`: every live code the theme does not
gather, with co-occurrence on the theme's extracts, shared participants, wording overlap with the
brief, kind mix, and current placement. Terminal and agent context only; no daemon route.

**Phase 4 — the errand and the proposals.** `theme-request` op (`kind: codes | claims | both`),
recorded on the theme, listed by `stale`, `inbox`, `apply`'s summary and `theme request`;
`assign-theme --why`, with the line written to `memos.md` on apply; the proposed-cards tray (why,
n/N, current placement, two extracts, reject); `theme propose` for the near misses and the second
reading, rendered as *The agent's case for the edge*.

**Phase 5 — the paper and the claims.** `paper:` and `framing` in `study.yaml`; `ta.py paper`
(`--add`, `--framing`, `--digest`, `--check`); `verify-quotes` defaults to the registered drafts;
the framing banner above the board, correctable via a `set-framing` op with an old-text refusal.
`ta.py theme claim` writes two to four agent-owned claims, refuses a theme with no tension and any
text containing a quotation, computes the evidence line at write time; `claims_stale` says when the
evidence has moved (`validate`, the inspector, `theme claim --check`). `validate` also warns on a
code gathered by two themes and `coverage` prints the overlap.

**Phase 6 — the docs.** SKILL.md Operation C rewritten around the loop (read the paper in full,
write the framing, service the errands with `fit` → proposals with a why → near misses → claims),
reference block, the rules' one exception (claims are the agent's field); `data-model.md`;
the manual; Round B; `writing-up.md`; a new `docs/themes.png`.

Tests: 98 Python (13 new), 52 bun (6 new); typecheck and build clean.

Out of scope, deliberately: the `did`-based warnings that already exist elsewhere (the inspector
banner, `spread`'s `no-did-quote`) — flagged in D-claim-lint's rationale for a pass of their own;
and the unplaced column counting the children of placed parents as unplaced, which predates this
plan.

## Codex audit — 2026-09-04

**Codex verdict:** The changes implement most of the planned surface, but several edge cases contradict the stated semantics: assignments still move codes despite allowed double-placement, the fit handoff can target the wrong theme, and staged op references/errands can be hidden or orphaned.
**Issue counts (Codex's):** P0:0 P1:1 P2:7 P3:0 (eight findings; the report used the `review` subcommand's list form rather than the ISSUES line)

**Changes made in response:**
- `scripts/ta.py` `op_assign_theme` — `assign-theme` gained an `add` argument: a plain assignment is still a move (what a drag on the board means), `add: true` keeps the code where it also sits. Agent proposals for a code placed elsewhere use it; SKILL.md, the fit footer and data-model.md say so (finding 1, P1).
- `scripts/ta.py` `cmd_theme_fit` — the handoff example names the theme it was run on, not TH1 (finding 2).
- `scripts/ta.py` `bundle_json` + `app/src/ops.ts` `resolveRefs` + `app/src/store.ts` — the bundle carries `created_refs` from the applied logs and the store re-points a leftover `op-NNNN` reference to the theme it created, so a dependant staged against a ghost that an earlier pass applied alone shows on the real column (finding 3).
- `app/src/store.ts` — a `new-theme` undo always cascades on the server; the confirm dialog uses the count this tab knows (finding 4).
- `app/src/views/themes.tsx` — a framing correction records `old` as the text it was edited against, the staged one included (finding 5).
- `scripts/ta.py` `close_theme_request` — servicing one half of a `both` errand narrows it to the other half instead of closing it; `theme request --done --kind` does the same (finding 6).
- `scripts/ta.py` `cmd_theme_claim` — refuses any double-quoted run of two or more words and blockquote lines, not only five-word quotations (finding 7).
- `scripts/ta.py` `codes_in_several_themes` — overlap is computed over what each theme gathers, children included, with a child implied by a shared parent left out, and `shared_code_note` says how each theme reaches it (finding 8; the e2e study had exactly this case: `abstraction` in TH1, `abstraction.too-fine` in TH4).
- Tests: five new pytest cases and two new vitest cases pin each of the above.

**Deferred / not actioned:**
- none — every finding was verified against the code and found real; Codex's suggested remedy for finding 1 (stop removing on assignment) was not taken as written, since a drag must stay a move; the explicit `add` carries the other meaning.

Codex's full final message saved at `/tmp/codex-audit-20260904-164845-report.md` (this run).

---

## Revision (2026-09-04, later): direct manipulation, and versions that count applications

Working the built board, Joseph asked why his own gestures were proposals: dragging a card back and
forth minted an `op-*` per twitch, and a theme he had just created — still provisional — never
reached the Quotes tab. The staging model was right for the agent's proposals (they need his
acceptance) and for the agent's follow-up work, and wrong for his decisions, which need neither.
This supersedes D-staged-refs and part of the review-workbench plan's inbox-only rule.

<decision id="D-direct-manipulation" title="Everything the researcher does is carried out at once; only the agent's proposals and the threads wait" status="locked" date="2026-09-04">
Every gesture the researcher makes in any view — a recode, a retrim, a drop, a new extract, Done, an
accepted code, a merge, a rewording, a theme created, a card dragged, a field written, a quote
picked, a roster edit, an errand — runs at once. The daemon calls `ta.py exec`, which uses the same
handler `apply` would, under the same `.apply.lock`, and archives the row to
`reviews/<date>-applied.jsonl` as `by: user`. The browser still writes no analysis file. The inbox
holds only what waits: the agent's proposals (accepted by leaving them, rejected by undo) and the
comment threads. The agent reads the researcher's changes with `ta.py changes` (by op id, no clock)
and acknowledges them with `--ack`. Undo of a gesture is doing the opposite. In the browser, a
gesture in flight is drawn through the same overlay proposals use until the file comes back, so a
drop lands without waiting for the round trip; a refusal from the script (a recode that would leave
no codes, a rewording of moved text) surfaces as the toast, now, not as a failed row a pass later.
<rationale>Joseph, on the built board: "Shouldn't these interaction be directly manipulations
rather than staging proposed changes?" and then "It should be everything I do, everywhere". Staging
exists so that proposals can be accepted and so that codebook changes can be batched with the
agent's follow-up; his own decisions have nobody to accept them and nothing to batch — so staging
bought latency, a log of fidgeting, and 300 lines of overlay faking direct manipulation.</rationale>
</decision>

<decision id="D-version-is-application" title="The codebook version counts applications, never edits" status="locked" date="2026-09-04">
Editing a code — rewording, accepting, merging, renaming, adding — records a *pending* change on
the codebook and ticks its `revision`; the `version` does not move. The version moves when the
codebook is applied to the transcripts: `bump` marks it, and the first `mark-coded` after edits
does it for you, folding the pending changes into one changelog entry that the rest of the pass
shares. Edits are stamped with the version they *will* carry, so `stale` still names the
transcripts they reach. Because two edits in one editing session now share a version, the delta
review ("new since you reviewed it") compares codebook *revisions* instead — `reviewed`,
`redefined_revision` and `added.revision` carry them; records from before carry only a version,
which is read as its revision.
<rationale>"We also don't want to make a new version mark whenever i make small changes to the
codebook. ONLY make a version mark when i asked the agent to apply the current codebook to the
transcripts. Before that it means im still working on it. application is the what makes a new
version." Direct manipulation without this would have bumped the version on every keystroke and
marked every transcript stale each time.</rationale>
</decision>

**What was removed.** With `+ theme` creating the theme, nothing is provisional, so the reference
machinery built that morning — `op-NNNN` targets, `refs` on `OP_SPECS`, resolution in `apply` from
the applied logs, the inbox-lint exception, the browser's provisional theme, the cascading undo —
was deleted rather than left as dead weight. F-ghost-theme is fixed by this instead, and the Quotes
tab sees a new theme at once because it exists at once. The essence-as-warning-for-candidates
change stays: it was right on its own.

**Implementation record.** `ta.py`: `exec`, `changes [--ack]`, `run_op` (validate → handler →
save → archive, shared by the CLI and the daemon), `mark_application`, `next_version`,
`codebook_revision`, `pending`, `bump` and `mark-coded` re-specified, `stale` against the codebook
as it stands, `apply` and the CLI merge/rename no longer bump, revision stamps throughout the delta
review. Daemon: `POST /api/do`. Browser: `store.stage` executes everything but threads and agent
drafts, with an in-flight overlay; provisional theme, `resolveRefs`, cascade removed; header chip
counts unapplied changes and names the version they will make; drawer copy rewritten around what
waits. Docs: SKILL.md (the analysis folder, step 2 and 5 of Operation A, the rules, the reference),
the manual, data-model, review templates. Tests: 102 Python, 51 bun; typecheck and build clean.

## Codex audit (second) — 2026-09-04, on the direct-manipulation revision

**Codex verdict:** The patch implements much of the intended direct-manipulation model, including taking the apply lock before reload, but several changed paths still allow record/log corruption or misleading application state.
**Issue counts (Codex's):** P0:0 P1:3 P2:2 P3:0 (five findings, list form)

**Changes made in response:**
- `scripts/ta.py` `run_op` — the op id is spent and the row archived under `.inbox.lock`, the lock every inbox writer takes, so a comment staged while a gesture is in flight cannot receive the same id (finding 1, P1 — an id collision would have corrupted the log `changes --ack` and `apply` cleanup read).
- `app/src/store.ts` + `app/server.mjs` — gestures run one at a time, in order, both per tab and per analysis folder in the daemon; `main` lets `exec` wait up to 20 s for a running `apply` instead of failing at once (finding 2, P1 — the retire flow could half-apply).
- `scripts/ta.py` `op_assign_theme`, `themes.tsx`, `overlay.ts`, `ops.ts` — a drag carries the column it left (`from`) and moves only that membership; the CLI without `from` keeps un-placing everywhere (finding 3, P1 — dragging one card would have deleted a code's other theme memberships).
- `app/src/views/transcript.tsx` — the Done button announces success only on an applied row (finding 4).
- `SKILL.md` — the Operation C paragraph that still described the ghost-theme model rewritten around immediate creation (finding 5).
- Tests: two new pytest cases (lock held while the id is spent; `from` semantics), two new vitest cases.

**Deferred / not actioned:**
- none.

Codex's full final message saved at `/tmp/codex-audit-20260904-184736-report.md` (this run).
