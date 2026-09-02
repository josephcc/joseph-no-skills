# Writing up thematic findings for an HCI paper

These are the conventions of CHI/UIST/CSCW qualitative results sections, distilled from
published lab, formative, and deployment studies. They cover *what* a findings section contains
and how quotes and counts are handled. They do not set the prose voice: when the repo is gated
with `.i-am-joseph`, load `write-like-joseph` for the sentences themselves. When it is not, write
in a neutral register and still follow everything below.

## The unit is a claim, not a topic

Each theme heading states what was found, in a sentence a reader could disagree with:
"Co-planning afforded steerability", "Participants preferred chat for open-ended questions",
"Reencountered citations read as relevance, citation counts as quality". A heading like
"Trust" or "Use of the summary feature" is a bucket (Braun & Clarke's pitfall 1 and 2) and a
sign the theme has not been analysed yet. Sub-themes work the same way, one level down.

Where the paper has research questions or design goals, tag headings with them (`(RQ2)`,
`[D1, D3]`) so a reviewer can see each theme paying off something the paper promised.

## The shape of a theme paragraph

1. **The claim**, in one sentence.
2. **Prevalence**, at the participant level, in one of two forms: a fraction (`9/15`, `n = 12`)
   or a phrase with the ids in parentheses ("Four participants (H1, H12, N5, N6) noted...").
   Use the fraction when the theme's weight rests on breadth; use the id list when the reader
   will want to follow individuals across themes. Never both styles for the same theme in the
   same paragraph. Both come from `ta.py coverage`, never from memory.
3. **Evidence**: one to three quotes, short ones inline, longer ones as block quotes (below).
   Vary who is quoted across the section; a section that quotes P3 seven times is reporting
   P3, not a theme.
4. **The tension**, where one exists: the participant who did the opposite, the condition under
   which the pattern broke ("Others preferred continuous execution..."). Braun & Clarke: a
   pattern is rarely complete, and pretending otherwise invites suspicion. `themes.yaml`
   `tensions` holds these; use them.
5. **Interpretation**: what the pattern means for the design, the research question, or prior
   work. This is the sentence that makes it analysis rather than transcription. It should not
   be a moral ("this highlights the importance of...") but a specific consequence.

For `did` extracts, describe the action and then the reaction, and keep them separate from
`said` extracts in the prose ("P4 reran the paper-search step to restrict venues, and then
said ..."). Never let an `intent` extract ("I would probably...") stand in for an action.

## Quotes

- **Verbatim, from the extract record.** Never type a quote from memory, never improve grammar,
  never reorder clauses. If the transcript is machine-generated (whisper), say so once in the
  method and treat any quote that carries weight as needing a re-listen.
- **Editorial marks**: `[...]` for elision, `[square brackets]` for a clarifying insertion or a
  replaced deictic ("[with Cocoa]", "[the plan]"), nothing else. Trailing filler may be cut at
  the edges without a mark; filler in the middle is cut with `[...]`.
- **Attribution**: participant id in parentheses after an inline quote, `(P7)`; after a block
  quote as `– P7` on the same line or the next. No names, no roles that identify, no timestamps in
  the paper (timestamps live in the extract record).
- **Inline vs block**: inline for anything under roughly 25 words, woven into the sentence so the
  sentence still parses; block for longer passages or when the *wording itself* is the evidence.
  A results section that is mostly block quotes has stopped analysing.
- **Do not stack** two quotes making the same point unless the point is that different
  participants said it independently, and then say so.
- **Every quote in the draft must pass `ta.py verify-quotes <draft.md>`** before handback.
  Paste the summary line in the report.

## Counts and the prevalence caveat

Count at the participant level, state the denominator, and say once in the method how
prevalence was counted. Add the caveat that frequency does not determine value (Braun &
Clarke 2006; the point is also made in several HCI papers that cite them) so a reader does not
dismiss a 3/12 theme that answers the research question. Do not present counts of extracts, and
do not compute percentages on n < 20.

## The method paragraph

The results are only as credible as the reader's picture of how they were produced (checklist
items 12 and 13). The paragraph should say:

- what data were analysed (which recordings/transcripts, how transcribed, checked against audio
  or not),
- the method by name with the citation: Braun and Clarke's (reflexive) thematic analysis,
- the stance (`study.yaml` `approach`): inductive or hybrid, semantic or latent,
- who coded, in how many passes, and how the team was involved (discussions, weekly meetings,
  a second coder on a subset),
- that a codebook was developed iteratively across interviews and then applied to all
  transcripts, and where it can be found (appendix, supplement),
- the prevalence unit and the frequency caveat,
- **the agent's role, honestly**: e.g. that an LLM-based assistant proposed candidate codes and
  themes and retrieved supporting extracts, with every code, theme, and quote reviewed and
  decided by the authors, and all quotes verified against transcripts. Disclosure of AI
  assistance is required by most venues now and is also simply true.
- why inter-rater reliability is not reported, if it is not: reflexive thematic analysis treats
  coding as interpretive, and agreement statistics measure shared training rather than
  correctness. McDonald, Schoenebeck & Forte (CSCW 2019, "Reliability and Inter-rater
  Reliability in Qualitative Research") is the standard HCI citation for this. If a
  codebook-style analysis with multiple coders *was* done, report the agreement procedure
  instead.

## The codebook appendix

`ta.py codebook-table` prints a markdown table (code, sub-code, definition, include/exclude,
n/N, one example) ready for an appendix or supplement. Reviewers increasingly ask for it, and
shipping it is the cheapest possible answer to "how do we know these themes are grounded?".

## Before handback

Run, and paste the summary lines of, `ta.py verify`, `ta.py verify-quotes <draft>`, and
`ta.py coverage`. List every theme's n/N beside its heading in the handback note so the author
can check the prose against the numbers. Flag any quote you shortened or inserted brackets into.
