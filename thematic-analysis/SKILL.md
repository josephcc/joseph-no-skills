---
name: thematic-analysis
description: "Run a rigorous Braun & Clarke thematic analysis over interview and user-study transcripts for an HCI paper, as a negotiated, auditable pipeline: build a codebook interview by interview (the agent codes each new transcript against the codebook so far and proposes candidates for whatever it does not cover; the researcher accepts, merges, or rewrites them in a local review workbench, and drives every decision), apply the finished codebook to every transcript to catalogue every matching quote, develop and negotiate themes, and select the quotes that go in the paper. Every quote is copied from the transcript by script and re-verified, so nothing is hallucinated; coverage over participants, codes, and themes is computed, never estimated. Use whenever the user mentions coding interviews, a codebook, open coding, thematic analysis, affinity diagramming of quotes, themes from a user study, 'review this interview and update the codes', 'which participants said X', or picking participant quotes for a paper, even if they don't name the method. Works on transcripts from watch-recording or any `[HH:MM:SS] Speaker: text` file."
argument-hint: [analysis folder or transcript(s), plus which operation: code this interview / apply the codebook / develop themes / pick quotes]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(uv:*), Bash(python3:*), Bash(bun:*), Bash(node:*), Bash(pdftotext:*), Bash(ls:*), Bash(wc:*), Bash(grep:*), Bash(command -v:*)
---

# Thematic analysis, the Braun & Clarke way, for HCI studies

You are an experienced qualitative analyst on an HCI paper: the transcripts are think-alouds,
post-task interviews, formative interviews, and deployment debriefs, and the output is a results
section where every theme is a claim, every claim has participants behind it, and every quote is
verbatim.

**The researcher drives the analysis; you support it.** Bring the whole craft — read every
transcript, notice what recurs, propose codes and themes and argue for them. But the decisions
are theirs: which codes stay, which themes the data supports, which quotes go in the paper, what
the paper argues. A proposal is material for their decision, never the decision, and a codebook
you generated and they waved through is not the same object as one they built.

What supporting well looks like:

- **Apply the codebook, and surface what it does not cover.** A new interview is two jobs at
  once: code it against the codebook they already have, so this transcript is comparable with
  every other, and collect the passages nothing fits as candidate codes for them to rule on.
  Neither half is optional — coding only with existing codes hides whatever is new in this
  interview, and proposing new codes without applying the old ones leaves the corpus inconsistent.
- **Propose options, not a verdict.** For a candidate code or a theme, offer a spread rather than
  one answer — the splitter's cut and the lumper's, the reading that follows the research question
  and the reading that complicates it — each with its extracts and a line on what it buys and what
  it costs. One proposal presented as the obvious answer is a decision you took on their behalf.
- **Ground the options in what they are writing.** `study.yaml` carries the research questions and
  there is often a draft; propose against those, and say plainly when a candidate answers no
  research question, because that is worth knowing too.
- **Read everything, every time.** When they write a code, carry it across every transcript and
  report what it should have caught: where it was under-applied, where it overlaps a code they
  already have, which participants it never touched.
- **Keep the books.** Quotes copied by script and re-verified, coverage computed, so their
  sampling can be checked rather than trusted.
- **Put the work somewhere reviewable.** The workbench, so being diligent costs a scroll.

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
| `references/data-model.md` | The data files and the operation inbox, field by field. Read before touching `analysis/`. |
| `references/review-templates.md` | What the workbench carries and what a round document carries, with a template for each round. |
| `references/writing-up.md` | HCI results-section conventions: claims as headings, n/N, quote hygiene, the method paragraph. |
| `scripts/ta.py` | Bookkeeping, audit, and the staged-operation CLI. `uv run ~/.claude/skills/thematic-analysis/scripts/ta.py --help`. |
| `app/` | The review workbench: seven views over one analysis folder, served by a local daemon. `ta.py open` builds it on first run and prints the URL. |

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

Then write the analytic stance into `study.yaml` under `approach`. Braun and Clarke say these
decisions are usually left unspoken; this skill has already made them, so **do not ask** — state
them, and change one only if the user says otherwise or the study is plainly not an HCI user
study:

- **orientation: hybrid.** The research questions and design goals shape what you attend to; the
  codes come from the transcripts.
- **level: semantic.** What participants said they did and valued, then interpreted.
- **epistemology: realist.**
- **prevalence_unit: participant.** Report `n/N`, never extract counts, and carry the caveat that
  frequency does not determine value.

`init` seeds exactly this. The kind convention that goes with it: a criterion or action the
participant applied during the study is `did`; `said` is for views and standing attitudes; a modal
verb governing the participant's own hypothetical action is `intent`. Say all of this in the method
paragraph.

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

Read `references/data-model.md` for every field. The script is the only writer of the analysis
files, and that is the safety story: the browser never touches one. **The researcher's own
gestures in the workbench are carried out at once** — the daemon runs `ta.py exec`, the same
handler `apply` uses, under the same lock, and `reviews/<date>-applied.jsonl` records them as
theirs. Only *your* proposals, and their comment threads, wait in `inbox.jsonl` (written only by
the browser) for `ta.py apply`. The rule that matters most: **`extracts.jsonl`
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

`mark-coded` is also where the codebook **version** moves: the version counts applications, not
edits. Codes added or reworded since the last application sit as *pending* changes; the first
transcript coded against them makes the new version (`bump` does the same by hand), and the rest
of the pass shares it. Never bump for an edit.

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

**4. Write the argument, then hand over the workbench.** Two surfaces, and the split matters:
the **workbench** carries operations over data (dispute a coding, accept a code, move a card), the
**round document** carries arguments and judgements (what changed, why this code and not an
existing one, the coding policies). See `references/review-templates.md`.

Write the code's argument into its `proposal` field in `codebook.yaml`
(`why`, `alternatives`, `borderline`, `round`) as well as into the document, so it sits beside the
definition in the inspector where the decision is actually made. **Stage your own structural
proposals as operations** rather than asking about them in prose — a merge belongs where its
evidence is:

```bash
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> stage \
    --op '{"op": "merge-code", "target": "agent-steering", "args": {"into": "control"}, "note": "0.75 extract overlap; see dupes"}'
```

Then author `analysis/reviews/YYYY-MM-DD-codebook-N.plan.md` following Round A (load
`interactive-plan` for the tag syntax): the narrative table, the argument per candidate code with
two or three extracts and a link into the workbench, the definitions you want discussed as
highlights, the coding-policy questions that are *not* operations, and the coverage tables pasted
from `ta.py coverage`. Lint it, run `ta.py verify-quotes` on it.

Finally open both, and say which is which:

```bash
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> open T-07
node ~/.claude/skills/interactive-plan/app/server.mjs <abs-path-to-the-round-document>.plan.md
```

`open` runs a preflight first (`validate`, `verify`, the inbox lint, and whether every extract's
text can still be located in its turn) and refuses to launch on an error, because a page built on
broken data is worse than no page. The transcript view is where the coding is reviewed: spans
tinted by code family, one chip per extract with its id, kind and codes, the definitions beside
the passage, delta mode so only what changed since the last review is vivid, and every timestamp
hovering to the `watch-recording` frame so a `did` can be checked against the screen.

**5. Read what they did, then apply what they left you.** When the user says *"review my
feedback"*:

```bash
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> changes        # what they changed directly
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> inbox          # your proposals left standing, their threads
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> apply --all
uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> changes --ack
```

Their own gestures — a recode, a retrim, a dropped extract, an accepted code, a reworded definition,
a card moved on the board — **were carried out the moment they made them**. `changes` lists them
from the applied log, grouped by view, with the script's result beside each: read them as decisions
to understand (and to re-read transcripts for, when a code moved), never as operations to run.
`inbox` holds what still waits: the proposals you staged that they did not reject — leaving one
standing is acceptance — and the comment threads. `apply` executes those in the order they were
staged, records any codebook change among them as pending, archives every line to
`reviews/<date>-applied.jsonl`, and prints `stale`, `validate` and `verify`. An operation that
cannot be applied — a definition edit written
against wording you have since changed, a retire on a code that still holds extracts, an op naming
an extract that has since been dropped — stays in the inbox with its reason while every other
operation still runs, so one stale line never holds up the rest of the researcher's feedback. Fix
the cause and apply again, or discuss it in the thread. Read the answers in the round document too, convert them to `<decision from=…>` for the next
round, and reply to threads with `ta.py reply op-0031 "..."` (the user resolves them, never you).

Then look at `stale`. A code added or redefined after a transcript was coded means that transcript
gets a pass for that code before the next interview, because Braun and Clarke's phase 2 is
systematic across the *entire* data set, not across the interviews that happened to come after the
code existed. `stale` measures against the codebook as it stands, pending edits included, and
`stale --json` says which codes changed, so the re-read is targeted. That re-read is an application:
its first `mark-coded` turns the pending edits into the next version.

**6. Keep the flagged moments.** When a passage turns out to belong in the paper (the system
predicting an unpublished result, a sceptic being convinced), flag it:
`recode E-0042 --highlight "<why>"` — or the user presses ★ in the transcript view. Highlights are
not selections; they surface at the top of the quote bank and of the Quotes view's bank, so the
theme round starts from the moments that struck the researcher while coding.

`codebook.yaml` is the source of truth and everything under `reports/` is a rendering of it. A
comment the user leaves on a *generated* file (`reports/codebook.md`, an annotated transcript) is
feedback on the data files, not an edit to them: `report` archives any commented file to `reviews/`
before regenerating and says so; read it, apply it, regenerate.

Repeat per interview. The codebook converges when a new transcript adds extracts but no codes. At
that point, and again before freezing, do a **cleanup review** in the Codebook view, whose health
strip is exactly this checklist: read every parent's parent-only extracts (a parent carrying more
than its children is hiding a child), look for a child that is a special case of a sibling, for two
criteria that point the same direction under different names, and for a family whose one child
holds everything (that is one code, not a family). The Compare pane puts two codes side by side
with their extracts in three columns (only A, both, only B), which is the surface for every `dupes`
flag. Stage each merge as a proposal with the extracts that would move, and let the user decide.

The Codebook view's **overlap** tab (`ta.py cooccur`) is the cross-tab behind that checklist: codes
x codes, each cell the extracts carrying both. Read it two ways. A hot cell off the diagonal is a
pair to judge, and the *asymmetry* says which kind: overlapping both ways is one code under two
names (merge), while "90% of B also carries A, but only 30% of A carries B" is a special case
(make B a child, do not merge). A big code whose extracts split cleanly by what else they carry has
a fault line in it, and the facets name the children it wants. Its blind spot is worth stating to
the user rather than hiding: a code whose extracts carry nothing else is invisible to this — the
command says how many of them there are, and those have to be read.

Do a **code-consistency review** in the same pass: pick a code and read every extract under it,
grouped by participant, with the definition on top (the Codebook view's detail pane, or
`ta.py collate <code>`). That read is the check on whether the definition was applied the same way
in interview nine as in interview two — the reflexive-TA answer to the question inter-rater
reliability is usually asked to settle. Where it was not, `recode` the strays or sharpen the
`include`/`exclude` clause and let `stale` send you back.

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

The Coverage view is that report as a map: participants × codes, each cell clickable to the
extracts behind it, and an **empty** cell clickable to stage a re-read request ("re-read T-04 for
`trust.stakes`"). Those arrive in the inbox, are recorded in `study.yaml`, and `stale` reports them
until `ta.py reread <T> --done` closes them.

Then hand back a **delta review**, not the whole corpus again: the only thing worth the
researcher's time after this pass is what it added. `ta.py open T-04` with the transcript view's
"new only" filter shows exactly that, because every extract they have already seen carries a
`reviewed` stamp.

---

## Operation C. Theme development and selection

Themes are where the analysis happens; codes only organise. Braun and Clarke's phases 3 to 5 —
with the researcher naming, defining and deciding, and you carrying each theme's rule back across
every code and drafting what the evidence supports.

**Read the paper first.** `ta.py paper` says which draft(s) are registered (`paper --add <path>`
registers one; the path is stored relative to the analysis folder). Read every registered draft
**in full** before any theme work in a session. The research questions are the formal framing; the
draft is the actual one — what the paper argues, in what order, against which related work, with
which words already committed to — and a theme is drafted against it. Then write what you took as
one paragraph, `paper --framing "..."`: it sits above the board, where the researcher corrects a
misreading *before* you propose anything on the strength of it. `paper --digest` (title, abstract,
headings, every sentence that touches an RQ or a theme by name) is the cheap refresher between
full reads, not a substitute for one. No draft registered: say so, and work from `study.yaml`'s
research questions.

**Search (phase 3).** For each code family, `ta.py collate <code>` and read every extract, grouped by
participant. Then ask which codes, together, tell one story about a research question. A theme is
a **claim** ("Co-planning afforded steerability", "Reencountered citations read as relevance,
citation counts as quality"), never a topic ("Trust", "Feature X"), and never an interview
question restated. A `miscellaneous` pile for orphan codes is allowed and temporary. Two levels at
most: theme and sub-theme.

The researcher usually creates the theme themself, on the board (`+ theme`), at the moment the
reading arrives — and **it exists at once**: they drop the codes they know it rests on, write its
**brief**, and ask you for the codes they might be missing, each gesture carried out immediately
and logged (`changes` lists them). The brief is theirs: the rule for what belongs (written the way a code
definition is), the near-miss that does not, and what they mean to write in the paper. It is
written early and allowed to be wrong, and it is what your proposals are judged against.

**Service the errands.** `apply` ends by listing open theme errands (`theme request` lists them
too; the inbox does as well). For each theme that asked for **codes**:

1. `ta.py theme fit TH4` — every live code the theme does not gather, with how often it rides along
   on the theme's extracts, how much of the theme's cast it shares, how much its wording shares
   with the brief, its kind mix, and where it currently sits. **It is a recall check, not a
   shortlist**: its job is to make sure you looked at all thirty-five codes rather than the six you
   remember. Read the extracts behind each row (`collate CODE`) against the brief. A code that never
   rides along can still belong; one that always does can still be a different claim.
2. For each code that belongs, stage one assignment with **one line of why** — the reason this code
   satisfies this brief, not a summary of the code:

   ```bash
   uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> stage \
       --op '{"op": "assign-theme", "target": "graph-overwhelm", "args": {"theme": "TH4", "why": "the participant'"'"'s next move is set by the graph'"'"'s size — the rule'"'"'s first clause"}}'
   ```

   It appears on the board as a card marked *proposed by the agent* and in the theme's inspector
   with your line, its n/N, two of its extracts, and a reject button; leaving it staged is
   acceptance. A code already gathered by another theme may still be proposed — stage it with
   `"add": true` in `args`, so accepting **adds** it here rather than moving it (without `add`, an
   assignment is a move, which is what a drag on the board means); the card says where it sits,
   `validate` warns, and `coverage` prints the extracts then counted twice — including a child
   reached through its parent in one theme and placed directly in another. Say so in the round
   document when two themes' n/N rest on the same sentences.
3. Record the **near misses** — about five, each with the clause of the brief that excluded it —
   and the other defensible boundary where one genuinely exists (the tight reading and the
   inclusive one, with what each takes and costs):

   ```bash
   uv run ~/.claude/skills/thematic-analysis/scripts/ta.py -d <analysis-dir> theme propose TH4 \
       --near-miss coverage "about what the corpus lacks, not how much of it is on the canvas" \
       --reading "The inclusive reading takes coverage.gap too: ... It costs the theme its edge against TH1." \
       --round 1 --close-request
   ```

   A rejection the researcher disagrees with is the fastest sign the brief's boundary is wrong,
   which is why the near misses earn their five lines.

For each theme that asked for **claims** — and for any theme that has a brief, codes, and a
tension when the round document is being written:

4. `ta.py theme claim TH4 --file claims.json --replace` — **two to four candidate claims**, each a
   sentence a reader could disagree with, each naming the tension it survives (`{"text": ...,
   "tension": "E-0113"}`). Different claims cut the same evidence differently — the strong-but-
   narrow one and the safe-but-flat one — and seeing them together is what makes the researcher's
   choice a choice. Cite extracts by id in the text; **never quote** — the command refuses a
   quotation, and the inspector and `reports/themes.md` render the words from the record. The
   evidence line (n/N, the kind mix, the codes) is computed by the script at write time; never
   type one. The command refuses a theme with no tension: record one first (`theme tension TH4
   --add E-...`). Claims are **your field**: written directly, rewritten freely when the evidence
   moves (`theme claim TH4 --check`; `validate` says when they have gone stale), and never staged
   for acceptance. The researcher judges them when writing the paper.

Then `ta.py theme request TH4 --done` for anything `--close-request` did not close.

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
it gathers, and the `rq` it answers. The accepted claim is the natural opening of the story — the
inspector has a button for exactly that. Participants per theme are derived from the extracts,
never typed; `ta.py coverage` prints the n/N.

**Negotiate.** The Themes view (`ta.py open themes`) is the board: columns are themes, cards are
codes with their n/N and kind mix, and dragging a card moves it — at once, and only out of the
column it left. A code may sit in more than one theme: the researcher drops the card on a column's
*+ add a code here too* foot, or ⌥-drops it, or uses *place here too* in the code's inspector; the
card then says "also in TH3", and its extracts count toward each theme. Above the board sits the paper's framing as you read it, correctable in place.
Each theme's inspector holds, in the order the work is done: name, essence (with the two-sentence
counter), the brief, the tray of your proposed codes and your case for the edge, the story, the
RQ, `in_paper`, your claims with their evidence lines, and the tensions list they drag extracts
into. `ta.py theme mermaid` exports the map from `themes.yaml`, so the picture in a document can
never disagree with the board.

Then author `reviews/YYYY-MM-DD-themes-N.plan.md` following Round B for what the board cannot
carry: per theme the story paragraph, three representative extracts, the tension and what it does
to the claim, the level-2 result, and the naming question. End with the overall story — how the
themes together answer the research questions, and in what order, against the framing the draft
already commits to. That paragraph is the one most worth the user's edits. Include / merge / split
/ drop are moves on the board, not questions in prose.

---

## Operation D. Quote selection and handoff to writing

Selection happens in the Quotes view (`ta.py open quotes`): the whole bank per theme with word
counts and an inline/block mark, flagged extracts first, the ordered in-the-paper list, and the
attribution spread updating as the user chooses. Prepare it rather than replacing it: flag the
candidates with `--highlight` during coding, and say in a short Round C document only what needs an
argument (whether a tension goes in, an attribution call you would not make alone).

The criteria to apply while preparing, and to say out loud: vivid, self-contained, exemplifying the
*claim* rather than merely the topic, short enough to weave inline where possible, with a `did`
extract beside a `said` one when the theme is about behaviour. Watch the spread across the whole
paper: a results section that quotes P3 seven times is a case study of P3.

An inline quote that needs trimming is trimmed by the script, never retyped:
`ta.py theme trim TH1 E-0041 --from "..." --to "..."` (or a text selection in the Quotes view)
slices the shorter form out of the extract's own stored text and records it in `quote_spans`. The
extract is untouched, the quote bank prints the trim and what it was cut from, and `verify-quotes`
still passes.

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
is negotiated in the workbench and the round documents. You may recommend, and should, with the
evidence beside the recommendation — as a `proposal` field on the code and a staged operation they
can accept in one click. You do not accept your own candidate codes, and you do not resolve their
comment threads. A theme's `claims` are the one field that is yours to write rather than theirs to
accept — they are your summary of what the evidence supports, kept current as it moves — and even
there, which claim the paper makes is decided when they write it.

**Their gestures are decisions; yours are proposals.** Nothing the researcher does in the workbench
waits for you: the daemon carries it out at once and the applied log records it. What waits is what
you staged, which they **accept** (carried out at once as their decision, `proposed_by: agent` in
the log — `changes` shows it as an acceptance), **reject** (undone), or leave standing for `apply`.
So a pass begins with `changes`, not `inbox`, and you never "apply" something they did — it is
done; understand it, and follow it where it leads.

**Propose as an operation, argue in prose.** Anything the script can do — merge, reparent, split,
accept, retire, recode, select a quote — is staged with `ta.py stage` so the decision happens where
the evidence is. Anything that needs judgement — why this code exists, what the theme means, which
of two coding policies to adopt — goes in the round document, where it can be commented on. Never
ask a question whose answer you would then have to parse back into a command.

**Silence is acceptance, and the record still has to be complete.** An extract the user scrolls
past is accepted; "Done with T-07" stamps everything they left alone as reviewed. **A reviewed
extract is locked against your own hand:** `recode`, `retrim` and `drop` on one stage a `by: agent`
proposal in the inbox instead of editing, so the change waits for their click beside the extract.
`--force` overrides that, only when they asked for the edit in so many words; it drops the stamp so
the change comes back as new in their next pass rather than wearing their verification. An extract
*they* changed counts as reviewed. Never stamp on their behalf outside that button.

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
ta.py recode E-0041 --add trust --remove control --kind did   # on a reviewed extract: stages a proposal; --force edits
ta.py retrim E-0041 --from "being able" --to "that step."    # re-cut the span, same id, still verbatim
ta.py drop E-0041 E-0042                         # and say why in memos.md
ta.py mark-coded T-01                            # transcript fully coded; pending edits become the next version here
ta.py mark-reviewed --transcript T-01            # the researcher has seen this coding (the Done button)
ta.py bump ["label"] [--freeze]                  # mark an application by hand: pending edits become a version; never for an edit

# the codebook, structurally
ta.py new-code ID "definition" --parent P        # a candidate code
ta.py code-status ID accepted|candidate|retired
ta.py set-field ID definition "..." --old "..."  # reword; refuses if it moved since you read it
ta.py reparent ID --to PARENT | --root
ta.py split-code PARENT child --extracts E-1 E-2 --definition "..."
ta.py merge-code SRC DST --why "..."             # recodes extracts, keeps SRC as merged
ta.py rename-code OLD NEW

# the paper the themes have to land in
ta.py paper                                      # what is registered, and the framing
ta.py paper --add ../paper/main.tex              # register a draft; then read it in full
ta.py paper --framing "..."                      # one paragraph: what the paper argues, shown above the board
ta.py paper --digest | --check                   # the refresher between full reads · verify-quotes over every draft

# themes and quotes
ta.py theme new "A claim, not a topic" --rq RQ1 [--brief "..."]
ta.py theme assign CODE --to TH1 | --misc | --unplaced
ta.py theme set TH1 essence|brief|story|name|rq|in_paper|status "..."
ta.py theme fit TH1 [--json]                     # every live code against the theme: the recall check before proposing
ta.py stage --op '{"op": "assign-theme", "target": CODE, "args": {"theme": "TH1", "why": "...", "add": true}}'   # a proposal, with its line; `add` keeps it where it also sits
ta.py theme propose TH1 --near-miss CODE "why not" ... --reading "..." [--round N] [--close-request]
ta.py theme claim TH1 --file claims.json [--replace] | --check | --clear   # 2–4 claims; evidence computed here; refuses quotes
ta.py theme request [TH1] [--codes] [--claims] [--done]   # the errands asked from the board
ta.py theme merge TH2 TH1 · theme drop TH3 [--why "..."]   # fold one theme into another · drop one: codes unplaced, record kept; `theme set TH3 status candidate` restores
ta.py theme tension TH1 --add E-0099
ta.py theme select TH1 --add E-0041 --at 0      # the quotes, in order
ta.py theme trim TH1 E-0041 --from "..." --to "..."   # the inline form, sliced from the extract
ta.py theme mermaid                              # the map, drawn from themes.yaml
ta.py reread T-04 --code trust --note "..."      # ask for a re-read; --done to close it

# the audit
ta.py validate · verify · coverage · dupes · stale       # add --json for the workbench's copy
ta.py collate CODE|THEME [--json]                # all extracts, grouped by participant
ta.py verify-quotes [FILE.md] [--quiet]          # every quote in a document is verbatim + attributed; default: the registered draft(s)
ta.py codebook-table                             # appendix table
ta.py report                                     # reports/{coverage,codebook,themes,quote-bank,audit}.md
ta.py annotate T-01 -o reviews/annotated/T-01-P1.plan.md   # the coded transcript as text/PDF, for a co-author
ta.py recode E-0041 --highlight "why it matters"  # flag a paper-worthy quote (surfaces in the quote bank)

# the review workbench
ta.py open [T-07 | E-0042 | trust.stakes | TH1 | codebook | coverage | themes | quotes | study | history]
ta.py serve --status | --stop                    # the daemon (one, shared, on port 47821 if free)
ta.py changes [--ack]                            # what the researcher changed directly since you last acknowledged
ta.py inbox [--json]                             # your proposals they left standing, and their threads
ta.py apply --all [--dry-run]                    # execute those, cascade, archive to reviews/
ta.py exec --op '{...}'                          # carry out an operation at once (what the daemon runs for their gestures)
ta.py stage --op '{"op": "merge-code", ...}'      # propose an operation for them to accept
ta.py reply op-0031 "..."                        # answer a comment thread (they resolve it)
ta.py bundle · transcript T-01 --json            # the payloads the workbench reads
```

Tests: `cd ~/.claude/skills/thematic-analysis && uv run --with pytest --with pyyaml python -m pytest tests -q`
(102) and `cd ~/.claude/skills/thematic-analysis/app && bun run test` (51). They pin quote copying,
verbatim verification, speaker attribution, the two-level rule, duplicate detection, staleness, the
markdown quote check, the operation schema, `apply`'s cascades and refusals, the reviewed-state
computation (by codebook revision), span segmentation, the pending overlay, `exec` and the applied
log, `changes`, versions that move only on application, the theme fit, claims (tension required,
quotes refused, evidence drift), the paper registration and digest, and the double-placement warning.

Related skills: `watch-recording` produces the transcripts and the frames that settle `did` claims;
`interactive-plan` is the medium for the narrative half of every review round, and the workbench
copies its visual language on purpose; `write-like-joseph` writes the results section from
`reports/` when the repo is gated.
