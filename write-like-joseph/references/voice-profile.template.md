# Voice profile — template

This is the shape of `private/voice-profile.md`, the file the skill reads right after the gate.
The real one is not in the repository: it holds what a corpus of one person's published papers
says about how that person writes, and that is exactly the part of the skill that should not be
public. This template has the same ten headings. Under each: what goes there, how to compute it,
and what the skill does with it. Copy it to `private/voice-profile.md` and fill it in from your
own corpus.

What you need first: `private/examples/<section>/<corpus_id>.md`, one file per published paper
section, in the folders the section map in `SKILL.md` names (`abstract/`, `introduction/`,
`related-work/`, …), each file the verbatim text of that section. Ten papers and about 100k
words were enough for the original; fewer works, with noisier counts. Then:

```bash
cd ~/.claude/skills/write-like-joseph
python3 scripts/voice_check.py --rebuild-baseline        # private/corpus_rates.json: every registry pattern counted over the corpus
python3 scripts/build_profile.py > /tmp/profile-numbers.md   # the numeric sections below, as markdown to paste in
```

Numbers in this template are illustrative thresholds, not anyone's measurements.

## 1. The paper map

Corpus id → paper, venue, year, newest first, and a line saying which papers count as the current
voice (the recent ones, usually). The skill follows one paper's id across section folders when it
writes several sections of a draft, so the map is how it knows which files belong together. If
you keep an index of your own past citations (`private/examples/prior-citations.md`: corpus id,
title, which of your papers cited it), say so here; the citation-discipline rules treat anything
in it as an existing citation.

## 2. The blocklist, grounded in your corpus

One paragraph on how the lists below were made (the corpus size, the date) and the typographic
rules that hold regardless of counts: no em-dashes or double hyphens as sentence punctuation, no
bullet lists or bold inside paper prose. `build_profile.py` reports the corpus's dash rate; keep
it here so the prohibition has a number behind it.

### 3. Tier 1, never-words

Candidate words that your corpus uses **0 to 2 times per 100,000 words**, each with its count.
Any one of them in a draft fails the hand-back: it is a fingerprint, not a style choice. In the
checker these become `class: "ban"`, `group: "t1"` rows (`t1` rows are also counted in figure
captions).

Count every candidate below in your corpus (`build_profile.py` prints the table) and sort:
the ones at or under the threshold come here, the ones you actually use go to Tier 2. The
candidates, the usual LLM-tell vocabulary, in no particular order:

> additionally · akin to · albeit · at once · boasts · bolster · comprehensive · crucial ·
> cutting-edge · delve · effortless(ly) · emerge(d) · empower · enduring · foster · furthermore ·
> garner · groundbreaking · harness · holistic · importantly · in kind · interestingly · interplay ·
> intricate / intricacies · journey · lands / landed (metaphorical) · landscape (metaphorical) ·
> leverage · meticulous(ly) · moreover · multifaceted · myriad · novel · nuanced · outright ·
> paradigm shift · pivotal · plethora · profound · realm · rests on (metaphorical) · robust ·
> seamless(ly) · settled (metaphorical) · showcase · state-of-the-art · synergy · tapestry ·
> testament · transformative · underscore(s) · unlock · utilize · versatile · vibrant · vital

Add words of your own as you catch them in drafts; a word that is 0 in your corpus and shows up in
machine prose about your work belongs here whatever the public lists say.

### 4. Tier 2, your words that LLMs also overuse

The candidates your corpus does use, each with its count, **the sense you use it in** (quote a
phrase from the corpus), and the rate to stay under. These are not banned. Banning them makes
drafts less like you, which is the failure mode of every generic blocklist. In the checker:
`class: "watch"`, `group: "t2"`; the checker warns when a draft runs at double your rate.

### 5. Tier 3, sentence habits absent from your corpus

Generic machine-prose habits, confirmed absent or near-absent in your corpus (search the
examples). The usual list, with the plain fix:

- Openers "It is important / worth noting that", "Notably,", a bare "Importantly,", "In today's …",
  "In the era of …", "With the rise of …". Cut them; start from the content.
- "not only X but also Y", and the rule-of-three flourish ("clear, concise, and compelling").
- "serves as", "acts as", "plays a … role in", "is a testament to"; and importance-verbs standing in
  for "is": "stands as", "functions as", "represents", "marks". Write "is".
- Empty amplifiers: "significantly enhances", "greatly improves", "vast potential". Keep
  "significant" for statistics.
- Closing a paragraph with a moral ("This highlights the importance of …"). End on the finding.
- Elegant variation: cycling synonyms ("the system… the tool… the platform…") to avoid repeating a
  noun. Repeat the noun; call the system by its name.

In the checker: `class: "watch"`, `group: "t3"`.

### 6. Tier 3b, measured sentence habits

Habits that pass a word grep and still read as machine prose. Each row: the habit, its rate in
your corpus and in a machine draft of your own work, per 10,000 words, whether it is P0 (fails
the hand-back when significantly above your rate), and the fix. These come from an audit: take a
full draft you rejected as machine-sounding, run `voice_check.py --all` on it, and keep the rows
where the draft's rate is a multiple of yours. The habits the original audit found, which are
worth measuring for anyone:

- "every" as an intensifier ("every concept", "at every level"). Write "each", "all", or drop it.
- Clause-joining colons, "X: Y" where Y is a full clause. A period, or "since / because / where /
  in which / so that". List and quotation colons are fine; the checker's heuristic separates them.
- "rather than" at density. "instead of", "and not", or two sentences.
- Sentence-initial "Both" / "Neither". Name the two things.
- What-clefts ("What we changed is…", "What he kept returning to were…"). Say who did what.
- Contrastive tails and antitheses: ", not X"; "not X but Y"; "The issue is not that X, but that
  Y"; the semicolon antithesis. State the positive claim; let the contrast follow with "However,"
  or "while".
- "Where X, here Y" parallel openers. "While", or two sentences.
- Aphoristic abstract-noun topic sentences ("Discovery and triage were one act."). Start the
  sentence from the participants or from "we" and put the observation in it.
- Epigram closers and section hand-offs ("…is the question the field study takes up"). End on the
  finding; point forward only when needed.

Also list here the moves of yours a machine draft under-uses (section 7 is where you find them);
in the checker those are `class: "move"` rows, and the checker reports their under-use as LOW.

## 7. What you write instead

A table: banned word → the words your corpus actually uses in that slot, with counts
(`build_profile.py` gives the counts; the mapping is yours to draw). Then your most common
sentence openers in order (the builder prints them): these, and your top trigrams, are your
"moves", the positive half of the profile and the part a blocklist alone can never supply.

## 8. Sentence length

The distribution over your corpus: median, mean, p10, p25, p75, p90, p95, and the share of
sentences in bands (1–9, 10–14, 15–19, 20–24, 25–29, 30–34, 35–39, 40–49, 50+ words), overall
and per section type. Then one paragraph on what to do with it: how often a short sentence lands
a point, how long the long tail really is, which sections run long. The checker compares a
draft's median, tails and flat paragraphs against these numbers. `build_profile.py` prints the
tables; headings and block-quoted participant speech are excluded, list items count as sentences.

## 9. Word frequencies and trigrams

The head of each distribution (the builder's default is the top 80 words and top 30 trigrams,
counted within sentence boundaries), followed by what the head says about the voice: which
content words come first, whether the prose is first-person plural, how modal verbs are
weighted, which fixed frames report methods. The idioms that recur here are the voice's
signature; put them in the registry as `move` rows.

## 10. Register notes

Six to ten reminders that the examples show on every page: person and number, how openings
ground, how citations sit in sentences, how numbers and participant quotes are reported, how
sentence length varies, how hedging sounds. Reminders, not a substitute for reading the examples
each time.
