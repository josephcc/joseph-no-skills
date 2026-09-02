---
name: thematic-analysis
description: "Run a rigorous Braun & Clarke thematic analysis over interview and user-study transcripts for an HCI paper, as a negotiated, auditable pipeline: build a codebook interview by interview (each new transcript adds candidate codes the user accepts, merges, or rewrites in an interactive review), apply the finished codebook to every transcript to catalogue every matching quote, develop and negotiate themes, and select the quotes that go in the paper. Every quote is copied from the transcript by script and re-verified, so nothing is hallucinated; coverage over participants, codes, and themes is computed, never estimated. Use whenever the user mentions coding interviews, a codebook, open coding, thematic analysis, affinity diagramming of quotes, themes from a user study, 'review this interview and update the codes', 'which participants said X', or picking participant quotes for a paper, even if they don't name the method. Works on transcripts from watch-recording or any `[HH:MM:SS] Speaker: text` file."
argument-hint: [analysis folder or transcript(s), plus which operation: code this interview / apply the codebook / develop themes / pick quotes]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(uv:*), Bash(python3:*), Bash(bun:*), Bash(node:*), Bash(pdftotext:*), Bash(ls:*), Bash(wc:*), Bash(grep:*), Bash(command -v:*)
---

# Thematic analysis, the Braun & Clarke way, for HCI studies

You are the qualitative analyst on an HCI paper: the transcripts are think-alouds, post-task
interviews, formative interviews, and deployment debriefs, and the output is a results section
where every theme is a claim, every claim has participants behind it, and every quote is
verbatim. The researcher makes the decisions. You read everything, propose with evidence, keep
the books, and audit yourself.

Two things make this a skill rather than a prompt. First, the **method**: Braun and Clarke's
six phases and their quality checklist, which you load in full before starting. Second, the
**bookkeeping**: an analysis folder whose data files let coverage, attribution, and verbatim-ness
be *computed*, so the user can check your sampling rather than take your word for it. The
failure modes this guards against are the ones language models actually have with this task:
inventing or smoothing quotes, attributing a line to the wrong person, coding the interviewer,
letting three vivid participants stand in for twelve, and calling an interview question a theme.

Files, all under `~/.claude/skills/thematic-analysis/`:

| | |
|---|---|
| `source/braun-clarke-2006.txt` | The method, full text. Not distributed (copyright); `scripts/extract_source.sh` makes it from the PDF. |
| `references/braun-clarke-digest.md` | Our summary of the paper. Fallback when the full text is absent. |
| `references/data-model.md` | The four data files, field by field. Read before touching `analysis/`. |
| `references/review-templates.md` | The shape of the three negotiation documents (codebook, themes, quotes). |
| `references/writing-up.md` | HCI results-section conventions: claims as headings, n/N, quote hygiene, the method paragraph. |
| `scripts/ta.py` | Bookkeeping and audit CLI. `uv run ~/.claude/skills/thematic-analysis/scripts/ta.py --help`. |

---

## Step 0. Load the method, then state the stance

**Read `~/.claude/skills/thematic-analysis/source/braun-clarke-2006.txt` in full** (about 14k
words) before doing anything else in a session that uses this skill. Not the digest, not your
memory of the paper: the text. The
phases are recursive, the pitfalls are specific, and the 15-point checklist at the end is what
you will audit the analysis against; a paraphrase of a paraphrase is exactly what this skill
exists to prevent in quotes, and the same holds for the method.

If the file is missing, run `bash ~/.claude/skills/thematic-analysis/scripts/extract_source.sh`.
If there is no PDF in `source/` either, tell the user the paper is not distributed with the skill
and ask them to drop it there; meanwhile read `references/braun-clarke-digest.md` and say
plainly that you are working from the digest.

Then, before coding a line, make the decisions Braun and Clarke say are usually left unspoken,
and write them into `study.yaml` under `approach`:

- **inductive, deductive, or hybrid** (most HCI studies are hybrid: the research questions and
  design goals shape what you look for, but codes come from the data);
- **semantic or latent** (HCI results sections are almost always semantic: what participants said
  and did, then interpreted);
- **the epistemology** (realist, unless the user says otherwise);
- **the prevalence unit**: the participant. Report `n/N`, never extract counts, and carry the
  caveat that frequency does not determine value.

Also fix the distance between three sets of questions: the research questions, the interview
questions, and the questions guiding coding. If the codebook starts looking like the interview
protocol, stop; that is their pitfall 2.

---

## The analysis folder

One per study, conventionally `<study>/analysis/`, beside the recording folders. Create it once:

```bash
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <study>/analysis init \
    --study "<name>" --transcripts <study>/recordings/*/transcript.md
```

Every `ta.py` command below is shorthand for that full invocation,
`uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> <command>`. Write it out
in full each time: shell variables and functions do not survive between tool calls, and zsh does
not word-split an unquoted variable anyway.

`init` reads the speaker labels out of every transcript and drafts a roster with placeholder ids.
**Finish the roster by hand before anything else**: give each speaker the id the paper will use
(`P1`…, or group-prefixed `H1`/`N1`, `D1` for deployment), set the interviewer and any
researchers to their roles, list each transcript's participants. `validate` refuses placeholders
because deciding who counts as a participant is analytic work, not clerical: a room-mic label is
several people, a colleague who joined for ten minutes is context, and (from `watch-recording`)
presence is not participation.

Read `references/data-model.md` for every field. The rule that matters most: **`extracts.jsonl`
is written only by `ta.py extract`**, which copies the quote out of the transcript at the lines
you name. You never type a quote into any file. You read the transcript with line numbers,
decide the span and the codes, and let the script copy the text, resolve the speaker to a
participant, and stamp the locator. `verify` then re-checks every extract against its transcript
whenever asked.

Transcripts from `watch-recording` are `[HH:MM:SS] Speaker: text`, one turn per line, and are
what the locator format assumes. Other formats work if each turn starts with `Speaker:`. When the
transcript was machine-generated (the `--transcribe` fallback), the `.vtt` says so in a `NOTE`;
carry that into `study.yaml` and into the method paragraph, and re-listen before any quote that
carries weight goes in the paper.

---

## Operation A. Codebook development, one interview at a time

The user will say something like *"P7's session is in `recordings/p7/`, review it and update the
codebook."* Often the folder has just been produced by `watch-recording`; if there is only a
video, load that skill first to get the transcript (and to open frames where a `did` claim needs
checking).

**1. Familiarise (phase 1).** Read the whole transcript, start to finish, before coding a line.
Do not grep for your existing codes; a targeted search finds what you expect and nothing else,
and the codes this pass should add are by definition the ones you did not expect. While reading,
jot memo lines in `memos.md`: hunches, a phrase that might become a code, a tension with an
earlier participant.

**2. Code (phase 2).** Go through the transcript again with the current codebook open. For each
passage that carries meaning relevant to the research questions:

- decide the codes it takes from the live codebook (an extract may take several; code
  inclusively, keeping a little context, but code one speaker's turn at a time);
- decide its **kind**: `said` (a view, experience, or standing practice: "I always open the PDF",
  "I would never cite from the sidebar" is a policy, not a hypothetical), `did` (a specific action,
  observed in a think-aloud or on a frame, or reported as done: "I did it twice on Tuesday"), or
  `intent` (a conditional or future use that has not happened: "I would probably use it for grant
  writing"). This comes from `watch-recording`'s first rule, modal verbs are not actions, and it
  matters because a finding about behaviour cannot rest on `intent`. In a post-interview with no
  frames or logs, `did` means *reported as done*; note that in `study.yaml` and in the method
  paragraph, and check against frames or logs whenever they exist;
- when a passage **runs against** a pattern (P2's "faster is not what I want" beside two
  participants who wanted faster), code it with the same code: the code names what the passage is
  *about*, not which side it takes. Polarity that matters to the story gets a child code
  (`trust.generalised` vs `trust.stakes`) or a `context` note, and the extract goes into the
  theme's `tensions` later. So `n/N` on a code reads "spoke to this", and the theme's story says
  how many were on which side;
- when nothing in the codebook fits, add a **candidate** code to `codebook.yaml` (status
  `candidate`, a definition written as a rule a second coder could apply, include/exclude
  clauses when it borders an existing code, at most two levels), and code the extract with it.

Then write the extracts in one batch:

```bash
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> extract --batch p7-extracts.jsonl
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> mark-coded T-07
```

(each batch line: `{"transcript": "T-07", "lines": "42-43", "codes": "control,control.rerun", "kind": "said", "from": "...", "to": "...", "context": "...", "note": "..."}`, the last five optional)

`extract` refuses interviewer speech, refuses a range that spans two speakers, and folds an
identical quote into the existing record rather than duplicating it. Use `--from/--to` to trim a
long turn to the sentences that matter; never edit the text afterwards. Give `context` whenever
the referent is not in the words (which condition, which feature, which task), because in a
comparative study "I liked it" is worthless without it.

**3. Keep the codebook clean.** Run `ta.py dupes` after every pass. It flags codes with overlapping
names, near-identical extract sets, and strict subsets; each flag is a question for the review,
not a verdict. Two codes that always co-occur are one code, or a parent and child. A code with
one extract after five interviews is a candidate to retire, or the seed of a tension worth
keeping; say which. Never let the list grow past what a reader could hold in mind: forty
top-level codes is a sign of coding topics instead of meanings.

**4. Render the coded transcript.** Before or alongside the review document, write the transcript
with every coded span highlighted:

```bash
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> annotate T-07 -o reviews/annotated/T-07-P7.plan.md
```

It is the transcript itself, turn by turn, with each extract wrapped in a highlight whose thread lists
the codes, kind, context, and note. This is how the user checks the *coding*, as opposed to the
codebook: they read the interview they remember, click a span, and dispute a code, a boundary, or a
kind on the spot, or highlight an uncoded passage that should carry one. Regenerate it after every
recoding pass so it never drifts from `extracts.jsonl`. `--plain` gives the same view as flat
markdown with code lines under each turn.

**5. Negotiate (the review document).** Author `analysis/reviews/YYYY-MM-DD-codebook-N.plan.md`
following Round A in `references/review-templates.md`, using the `interactive-plan` skill (load it
for the tag syntax). For every new candidate code: the definition (highlightable), two or three
extracts with ids and participants, why it is not an existing code, and an `<open-question>`
with real options (accept / accept as child of X / accept with edits / merge into Y / reject).
For every suspected duplicate: a `<finding>` and a question. For every definition you want to
change: the current and proposed text and the extract that forced it. Then the coverage tables,
pasted from `ta.py coverage`. Lint, run `ta.py verify-quotes` on the document, launch the viewer.

**6. Apply the answers.** When the user says *"review my feedback"*: read every `<answer>` and
open `<comment>`; edit `codebook.yaml` (status → `accepted`, definitions as revised); use
`merge-code`, `rename-code`, `recode`, `drop`; record the round with `ta.py bump "<what changed>"`;
convert answered questions into `<decision from=…>` for the next round; reply to comments (the
user resolves them). Then run `ta.py stale`. A code added or redefined after a transcript was coded
means that transcript gets a pass for that code before the next interview, because Braun and
Clarke's phase 2 is systematic across the *entire* data set, not across the interviews that
happened to come after the code existed.

When the user's answer reveals a passage that belongs in the paper (the system predicting an
unpublished result, a sceptic being convinced), flag the extract then and there:
`recode E-0042 --highlight "<why>"`. Highlights are not selections; they surface at the top of the
quote bank so the theme round starts from the moments that struck the researcher while coding.

Comments the user leaves on a *generated* file (`reports/codebook.md`, an annotated transcript) are
feedback on the data files, not edits to them. `report` and `annotate` overwrite their outputs, so
`report` archives any commented file to `reviews/` first and says so; read the comments, apply them
to `codebook.yaml` or the extracts, then regenerate. Say plainly, when asked, that `codebook.yaml` is
the source of truth and everything under `reports/` is a rendering of it.

Repeat per interview. The codebook converges when a new transcript adds extracts but no codes. At
that point, and again before freezing, do a **cleanup review**: read every parent's parent-only
extracts (a parent carrying more than its children is hiding a child), look for a child that is a
special case of a sibling, for two criteria that point the same direction under different names,
and for a family whose one child holds everything (that is one code, not a family). Propose each
merge with the extracts that would move, and let the user decide.

---

## Operation B. Apply the codebook to everything

When the user says no more interviews are scheduled: `ta.py bump "final codebook" --freeze`, then
code **all** transcripts against the frozen codebook, including the ones coded early against a
smaller codebook. `ta.py stale` lists them; every transcript should end at `current`.

This is the pass that turns a set of interesting moments into a catalogue. The instruction from
the paper is to give every data item equal attention and to collate *all* extracts for each code.
So the discipline here is completeness over selectivity: a passage that matches a code gets an
extract even when three participants have already said the same thing better. Prevalence is what
this pass produces, and prevalence computed from a selective pass is a number that looks like
evidence and is not.

Then audit:

```bash
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> validate
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> verify
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> coverage
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> dupes
```

Keep the audit trail. Summary lines go into `memos.md` with the date; when the full output is worth
keeping (a coverage table before and after a re-coding pass, the `dupes` list you acted on), save it
under `analysis/audit/` with a dated name. `reports/` is only for what `report` regenerates.

Read the coverage report as a set of questions. A code nobody said: retire it, or find the
transcript you under-read. A participant with no extracts under any code in a whole family:
re-read their transcript for it specifically. A `did` column of zeros under a code about
behaviour: you have been coding opinions. Fix what the report shows, re-run, and paste the final
tables into `memos.md` with the date. Codebook changes are still possible here, but each one
un-freezes the count and sends you back through `stale`.

---

## Operation C. Theme development and selection

Themes are where the analysis happens; codes only organise. Braun and Clarke's phases 3 to 5:

**Search (phase 3).** For each code family, `ta.py collate <code>` and read every extract, grouped by
participant. Then ask which codes, together, tell one story about a research question. A theme is
a **claim** ("Co-planning afforded steerability", "Reencountered citations read as relevance,
citation counts as quality"), never a topic ("Trust", "Feature X"), and never an interview
question restated. Draft the thematic map as a mermaid graph in the review document; a
`miscellaneous` pile for orphan codes is allowed and temporary. Two levels at most: theme and
sub-theme.

**Review (phase 4).** Level one: `ta.py collate TH1` for each candidate and read it whole. Do the
extracts cohere (Patton's internal homogeneity)? Are the themes distinct from each other
(external heterogeneity)? Level two: re-read every transcript with the map in hand and code what
was missed; this is expected, not a failure. Record for each theme the extracts that
**complicate** it in `tensions`. A pattern without exceptions in twelve interviews is a pattern
you have not looked at hard enough, and the write-up will need the exception anyway.

**Define (phase 5).** For each theme: an `essence` of one or two sentences (their test: if the
scope will not fit in two sentences, the theme is doing too much), a `story` paragraph that
interprets rather than paraphrases (what does the pattern mean, what conditions produced it, why
this framing and not another, what it implies for the design or the research question), the codes
it gathers, and the `rq` it answers. Participants per theme are derived from the extracts, never
typed; `ta.py coverage` prints the n/N.

**Negotiate.** Author `reviews/YYYY-MM-DD-themes-N.plan.md` following Round B: per theme, the
essence (highlightable), the story, codes with n/N, three representative extracts, the tension,
the level-2 result, and questions: headline / secondary / merge with / split / drop, plus a
naming question. End with the overall story: how the themes together answer the research
questions, and in what order. That paragraph is the one most worth the user's edits. Apply the
answers to `themes.yaml` (`status`, `in_paper`, `name`, `essence`).

---

## Operation D. Quote selection and handoff to writing

For each theme with `in_paper` other than `no`, propose the quotes (Round C): vivid,
self-contained, exemplifying the *claim* rather than merely the topic, short enough to weave
inline where possible, with a `did` extract beside a `said` one when the theme is about
behaviour. Watch the attribution spread across the whole paper: a results section that quotes
P3 seven times is a case study of P3. List alternatives so the user can overrule, and ask
separately whether each tension goes in. Write the chosen ids into `selected_extracts` in order.

Then `ta.py report` writes `reports/quote-bank.md`, `themes.md`, `codebook.md` (the appendix
table), `coverage.md`, and `audit.md`. Those files, plus `references/writing-up.md`, are the
handoff to the writing step. If the repo is gated with `.i-am-joseph`, load `write-like-joseph`
for the prose; otherwise write in a neutral register. Either way the conventions in
`writing-up.md` hold: claims as headings, n/N from the report, verbatim quotes with `[...]` and
`[insertions]` only, the method paragraph that says what was done, including what the agent did.

Before handing back any draft: `ta.py verify-quotes <draft.md>`. It finds every block and inline
quote of five or more words, checks each verbatim run against the transcripts, and checks the
attribution. Paste its summary line. A draft with an unmatched quote does not go back to the
user with the quote in it.

---

## Rules that hold in every operation

**Quotes.** Never write a participant's words from memory, in any file, message, or document.
The path is transcript line → `extract` → extract id → wherever it is used. Editorial marks are
`[...]` and `[bracketed insertions]`, nothing else; grammar is not fixed, clauses are not
reordered. If the user asks "what did P4 say about X", the answer is extract ids and their text,
or a fresh read of P4's transcript, never a recollection.

**Attribution.** The roster is the only source of ids. Interviewer and researcher speech is
context; `extract` refuses it by default, and if you override that, say why in the note. Check
who raised a topic first before crediting a participant with it (their "oh, cool" after a
walkthrough is not discovery). In a group session, a line you cannot attribute is not evidence.

**Said, did, intent.** Keep them apart in the data (`kind`) and in the prose. A modal verb is
`intent`. A claimed action becomes `did` only when the transcript or a frame shows it happened.
Themes about behaviour rest on `did`; themes about attitudes rest on `said`; `intent` supports
design implications, not findings.

**Prevalence.** Per participant, `n/N`, from `coverage`, with the caveat. Never a count of extracts
in the paper. Never "many participants" without the number being available on request.

**Completeness over vividness.** Checklist items 2 and 3: every data item gets equal attention, and
themes rest on thorough coding, not on the three most quotable people. When you notice you are
building a theme from the participants you remember, `collate` it and look at who is missing.

**Tensions are data.** Keep the accounts that depart from the pattern, code them, and put them in
`tensions`. The write-up needs them, and a theme that survives its exceptions is stronger.

**The user decides.** Codes, themes, names, definitions, quotes, what goes in the paper: all of it
is negotiated through the review documents. You may recommend, and should, with the evidence
beside the recommendation. You do not accept your own candidate codes.

**Audit before handback, every time.** `validate`, `verify`, and `coverage` at the end of any
pass; `verify-quotes` on any document that contains quotes. Paste the summary lines. If a check
fails, fix the data, not the summary.

**Write memos.** Braun and Clarke start writing in phase 1. `memos.md` is where the reasoning
lives between rounds: why a code exists, which reading you rejected, what to watch for next
time. It is also what makes a second session, or a co-author, able to pick the analysis up.

---

## Reference

```bash
# ta.py = uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir>   (write it out in full)
ta.py init --study NAME --transcripts FILES...   # roster + empty files; then edit study.yaml
ta.py extract T-01 42 --codes a,b --kind said    # one extract; or --batch file.jsonl
ta.py extract T-01 42-43 --codes a --from "the biggest thing" --to "whole prompt."
ta.py recode E-0041 --add trust --remove control --kind did
ta.py drop E-0041 E-0042                         # and say why in memos.md
ta.py mark-coded T-01                            # transcript fully coded with the current codebook
ta.py bump "what changed" [--freeze]             # new codebook version; freeze after the last interview
ta.py merge-code SRC DST --why "..."             # recodes extracts, keeps SRC as merged
ta.py rename-code OLD NEW
ta.py stale                                      # transcripts needing a pass
ta.py validate · verify · coverage · dupes       # the audit
ta.py collate CODE|THEME                         # all extracts, grouped by participant
ta.py annotate T-01 -o reviews/annotated/T-01-P1.plan.md   # the coded transcript, spans highlighted, for the user to review
ta.py recode E-0041 --highlight "why it matters"  # flag a paper-worthy quote (surfaces in the quote bank)
ta.py verify-quotes FILE.md [--quiet]            # every quote in a document is verbatim + attributed
ta.py codebook-table                             # appendix table
ta.py report                                     # reports/{coverage,codebook,themes,quote-bank,audit}.md
```

Tests: `cd ~/.claude/skills/thematic-analysis && uv run --with pytest --with pyyaml python -m pytest tests -q`.
They pin quote copying, verbatim verification, speaker attribution, the two-level rule, duplicate
detection, staleness, and the markdown quote check.

Related skills: `watch-recording` produces the transcripts and settles `did` claims against
frames; `interactive-plan` is the medium for every review round; `write-like-joseph` writes the
results section from `reports/` when the repo is gated.
