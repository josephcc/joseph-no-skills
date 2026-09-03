# Review documents and the workbench: who carries what

Every decision about codes, themes, and quotes is the researcher's. Two surfaces carry that
negotiation, and the split between them is the point:

- **The workbench** (`ta.py open`) carries *operations over data*: disputing a coding, accepting a
  code, moving a card, choosing a quote. Each gesture becomes one typed operation in
  `inbox.jsonl`, and `ta.py apply` executes it. Nothing has to be parsed back out of prose.
- **The round documents** (`interactive-plan`) carry *arguments and judgements*: what changed this
  pass, why a code exists and why it is not an existing one, the coding policies that shape future
  passes, the overall story the themes tell. These are prose the researcher edits and comments on,
  and the plan viewer is good at exactly that.

So: documents for arguments, the workbench for operations. A round document links into the
workbench at each code and each new extract; the workbench's inspector shows the agent's argument
beside the definition it is arguing about (the `proposal` field, quoted by the document).

Documents live in `analysis/reviews/` and are named `YYYY-MM-DD-<round>-<n>.plan.md`
(`codebook-3`, `themes-1`, `quotes-1`). They are never deleted; together with
`reviews/*-applied.jsonl` they are the audit trail from a participant's sentence to a published
theme. Load `interactive-plan` for the full tag syntax; lint and launch with:

```bash
cd ~/.claude/skills/interactive-plan/app && bun run lint:plan <abs-path>.plan.md
node ~/.claude/skills/interactive-plan/app/server.mjs <abs-path>.plan.md
```

Rules that hold in every document:

- **Every quote carries its extract id** (`E-0041`) and participant, and is pasted from the
  extract record, so `ta.py verify-quotes` passes on the document itself. Run it before
  launching. The line form the checker understands is
  `> **E-0041** P1 [00:14:22] [did]: "the words"` (the `[did]`/`[intent]` marker only when the
  kind is not `said`); put a blank line between stacked quotes, and a trailing `*(note ...)*` in
  italics is ignored. Keep tag `title=` attributes to four words or fewer — the inline quote
  detector reads a long quoted title as a quotation.
- **Every proposal is a question with real options**, plus a reason. The viewer adds "Other" and
  a freeform box automatically, so list only genuine alternatives. But a question whose answer is
  an operation the workbench can stage belongs *there*, not here.
- **Definitions are highlightable.** Wrap a definition or theme essence you want discussed in a
  `<user-highlight comment="...">`, so the comment thread becomes the record of why it changed.
- **Ids are stable across rounds.** A question about code `control` is `Q-C-control` in every
  round it appears; when answered it becomes `<decision id="D-C-control" from="Q-C-control">`.
- **Counts come from `ta.py coverage`**, pasted, never typed.
- **Links into the workbench** use the printed URL plus a view and a target:
  `?analysis=<abs>&view=codebook&c=trust.stakes`, `&view=transcript&t=T-07&e=E-0142`,
  `&view=themes&th=TH1`. `ta.py open <target>` prints the right one for any id.

---

## The transcript review (no document at all)

`ta.py open T-07` is the review of the coding. It replaces what `annotate` used to be for: the
transcript with every coded span tinted by code family, one chip per extract carrying its id,
kind glyph, codes and context, the definitions in the inspector beside the passage, and delta mode
so a fourth round costs what changed rather than what exists. Every timestamp hovers to the frame
`watch-recording` left beside the transcript, so a `did` claim can be checked against the screen.

Reading the researcher's feedback afterwards: `ta.py inbox` groups it by view. A `recode` or
`set-kind` op is a disputed verdict; a `retrim` is a boundary; a `new-extract` is a passage that
should have been coded; a `comment` op is a question to answer in the thread, never an edit.
`ta.py apply --all` executes them, bumps the codebook once for the pass, and prints `stale`,
`validate` and `verify`.

`annotate` still exists and is still worth writing for a co-author who will not open the
workbench (its plan form exports to PDF through the plan viewer; `--plain` is readable text). It
is a rendering, not the review surface: comments left on it are feedback on the data files, and
`report` archives a commented copy to `reviews/` before regenerating.

---

## Round A: codebook review (after each interview)

Shorter than it used to be. The narrative, the argument per candidate code, and the policy
questions stay; accept / merge / reject / reparent move to the workbench, where the extracts are.

```markdown
**Status:** codebook round 3 · after T-07 (P7)
**Date:** 2026-09-01
**Scope:** 2 new candidate codes · 1 suspected duplicate · 2 definition edits · 6/7 transcripts coded

# Codebook review after P7

Open the workbench beside this document: `ta.py -d <analysis> open T-07`. The coding of T-07 is
reviewed there; this document is the argument for the two new codes and the two policy questions
they raise.

## What changed this pass
| | |
|---|---|
| transcript read | T-07, 214 turns, 61 min |
| extracts added | 23 (18 said · 3 did · 2 intent) |
| existing codes applied | control (5), control.rerun (2), trust (4), ... |
| new candidates | `verification-habit`, `scope-of-delegation` |
| staged for you | 1 merge proposal (`agent-steering` → `control`), in the workbench |
| audit | `validate: 0 error(s)` · `verify: 121 extract(s), 0 not verbatim` · `dupes: 2 suspicion(s)` |
| coverage | see the table at the end |

## New candidate codes

### `verification-habit` · Checking the agent's output against the source
[review it in the workbench](?analysis=…&view=codebook&c=verification-habit)

<user-highlight comment="c-def-verification">**Definition.** Participant describes opening the
underlying document to check a summary or claim the agent produced, as a habit rather than a
reaction to a specific error. *Include:* "I always open the PDF anyway". *Exclude:* checking
triggered by a noticed contradiction (→ `trust.repair`).</user-highlight>

Evidence (3 participants so far; all 9 extracts are in the workbench):

> **E-0142** P7 [00:14:22]: "The summaries were fine but I never trust them fully, I always open the PDF anyway to check the method section."

> **E-0031** P2 [00:01:35]: "I only opened the PDF when the summary contradicted something I already knew."  *(borderline: reactive, not habitual, which is why the exclude clause exists)*

Why a new code and not `trust`: `trust` holds attitudes; this is a behaviour with a different
design implication (a verification affordance vs. a trust calibration one). Alternative
considered: `trust.verification` as a child. This paragraph is also written into the code's
`proposal` field, so it sits beside the definition in the inspector.

Accept, make it a child, or reject it in the workbench — the nine extracts are one click away
there, and the decision is one click. This document does not ask.

<comment id="c-def-verification" status="open" kind="clarify">
  <note by="agent" at="2026-09-01T10:00">The include/exclude line is the part most likely to need your judgement; comment on the exact words.</note>
</comment>

## Coding policies this pass raised
(the questions that are *not* operations: they shape every future pass)

<open-question id="Q-kind-modal-policy" title="Standing policy in a modal" status="open">
P7's "I would never cite something based on the sidebar" is a standing policy phrased as a
hypothetical. `intent` is for a participant's own hypothetical action; a policy is closer to a
view. Which do we call it, consistently?
<options select="single">
  <option id="said">`said` — it is a standing view about their own practice.</option>
  <option id="intent">`intent` — the modal governs their own action; keep the rule mechanical.</option>
  <option id="context">`said`, with the modal noted in `context` so the write-up can quote it carefully.</option>
</options>
</open-question>

## Coverage after this pass
(paste `ta.py coverage`; the clickable version is the workbench's Coverage view)

## Memos from this pass
(2–5 bullets: hunches, tensions, what to watch for in the next interview)
```

After the researcher hands the pass back: `ta.py inbox`, then `ta.py apply --all`; reply to
threads (`ta.py reply op-0031 "..."`); convert answered policy questions into `<decision>` in the
next round's document; run `stale` and re-read the transcripts a new or reworded code touches.

---

## Round B: theme review (after the full coding pass)

The board does the moving; the document carries the story. Drop the mermaid graph from the
document body — `ta.py theme mermaid` exports it from `themes.yaml`, so paste that if a co-author
needs the picture, and it can never disagree with the board.

```markdown
**Status:** themes round 1 · codebook v6 frozen · 12/12 transcripts coded
**Date:** 2026-09-14
**Scope:** 5 candidate themes (2 with sub-themes) · 1 miscellaneous pile · 3 codes unplaced

# Candidate themes

The board is at `ta.py -d <analysis> open themes`: the columns are the themes, the cards are the
codes, and each theme's essence, story, tensions and `in_paper` are edited in its inspector. This
document argues for the shape and asks the questions the board cannot.

## TH1 · Co-planning afforded steerability  (RQ1) · 11/12 participants · 47 extracts
[open it](?analysis=…&view=themes&th=TH1)

**The story.** (3–6 sentences of analytic narrative: what the pattern is, what it means, how it
answers RQ1, what conditions produced it, why this framing and not another.)

**Representative extracts** (the full collation is in the inspector)

> **E-0041** P1 [00:14:22]: "..."

> **E-0310** P11 [00:05:48] [did]: "..."  *(reran the search step after restricting venues, then said this)*

**Tension.** P8 and P9 preferred continuous execution and described stepwise control as overhead:
**E-0288** P8: "..." The theme holds if it is about *having* the option, not using it. Both are in
the theme's `tensions`.

**Level-2 check.** Re-read all 12 transcripts for this theme: 2 extracts added (E-0401, E-0402),
none contradicting.

<open-question id="Q-TH1-name" title="TH1: name" status="open">
Alternatives: "Interactive plans as a steering surface" · "Stepwise control over the agent".
Which claim do we want to make in the heading?
</open-question>

(repeat per theme; include / merge / split / drop are moves on the board, not questions here)

## Unplaced codes
`onboarding` (4/12), `pricing` (1/12), `humour` (2/12): candidates for a miscellaneous note, a
limitations sentence, or dropping. Park them in the board's miscellaneous column if they are
staying for now.

## The overall story
One paragraph: what the themes together say about the research questions, and the order in which
they should be told. This is the thing most worth the researcher's edits.
```

Before launching: `ta.py collate TH1` for every theme and actually read it (level 1); re-read
every transcript with the map in hand (level 2) and code what was missed; `validate`, `verify`,
and `verify-quotes` on the document.

---

## Round C: the Quotes view, plus a paragraph

Quote selection happens in `ta.py open quotes`: the whole bank per theme with word counts and an
inline/block mark, the ordered in-the-paper list, a trim tool that slices the inline form out of
the extract's own text, a tension toggle, and the attribution spread updating as you choose.

A Round C document is now optional and short. Write one only when there is something to argue:

```markdown
**Status:** quotes round 1 · 4 themes in paper
**Date:** 2026-09-20

# Quotes: the two calls I would not make alone

Selection is in the workbench (`ta.py -d <analysis> open quotes`). Two decisions need a sentence
of argument rather than a click.

## The P8 counter-example in TH1
Keeping it costs 40 words in a tight section and complicates the claim; dropping it makes the
theme look unanimous, which it is not.

<open-question id="Q-tension-TH1" title="Keep P8's counter-example?" status="open">
<options select="single">
  <option id="keep">Keep it as a block quote — the theme is stronger for surviving it.</option>
  <option id="paraphrase">Keep the point, paraphrased with n/N, no quote.</option>
  <option id="drop">Drop it; the limitations section carries the caveat instead.</option>
</options>
</open-question>

## Attribution
P3 now carries 4 of the 11 quotes. The spread table in the Quotes view has the numbers; I have
flagged two alternatives from P5 and P10 in the bank for TH2 and TH4.
```

After the researcher decides: the selections are already in `themes.yaml` (they were staged and
applied), so run `ta.py report` and hand `reports/quote-bank.md` and `reports/themes.md` to the
writing step.
