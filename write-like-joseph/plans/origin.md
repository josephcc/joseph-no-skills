# write-like-joseph: where it came from

**Created:** 2026-08-16, in two back-to-back Claude Code sessions in this repo.
**Transcripts:** `~/.claude/projects/-Users-josephc-git-joseph-no-skills/fb670048-986d-4768-b058-ce4a6b5dfc2c.jsonl` (17:18 to 17:29, abandoned after the first plan draft) and `ad63624a-921c-4b16-8104-2e35339cc35e.jsonl` (17:31 to 19:19, the one that built the skill).
**Plan the agent wrote from the brief:** `write-like-joseph-workspace/plan.md` (gitignored, still on disk).
**Commits:** `7dbca01` paper-writing voice skill, corpus-grounded; `df7ff4c` gate the voice behind a `.i-am-joseph` repo marker.

Everything under "Verbatim" is Joseph's own text, copied from the transcript. Everything under "What happened" is a summary written on 2026-10-27 from the same transcript.

## Verbatim: the brief

Written by hand as `tmp.md` at the repo root, attached to the chat with `@tmp.md`, never committed, deleted afterwards. The first session's copy pointed the paper source at `/Users/josephc/git/josephcc.github.com/source/`; the second, which is the one acted on, pointed at `/Users/josephc/git/joseph/data`. Otherwise identical.

```
# Goal

Create a new skill called 'write-like-joseph' where the goal is use my previous
published paper as an example so that when you are asked to help write a paper,
your writing style is exactly like Joseph Chee Chang. For someone who doesn't know, it
would be indistinguitable from Joseph's writing. NO ONE will suspect you are an
LLM. When you are helping to write a paper - YOU ARE JOSEPH.

# Organization

The organization of this skill is the following:
- In the main skill.md, have a list of word that are frequently used by LLM to make sure we never use them in writing. For example emdashes (---), emerge, delve, ..., etc.
- In an `examples/` folder, we will put a bunch of my previously published papers, organized by sections. For example, `examples/abstract/` `examples/introduction/`
- Each file is named by its unique 'corpus id' so you can cross reference across subfolders. For example, `examples/abstract/1234.md` would be from the same paper as `examples/instroduction/1234.md`
- The examples subfolder should not be git-tracked. We don't want everyone to write like Joseph.


# Populate examples

In this other repo: /Users/josephc/git/joseph/data

We have a bunch of my previous papers to populate the `examples/` folder. ONLY use my recent papers, use my interactive-plan skill to create a check-list for me to pick from them to decide which ones to include.

After I've decided, populate all the subfolders by extracting the different common sections from the paper's full text. Before you do tho, create a list of subfolder topics using your interactive plan skill again for me to decide.
For example, I might want to separate formative study vs quantiattive technical eval vs qualitative interview evaluations.
```

## Verbatim: the prompts that shaped it during the session

Opening moves (17:18 to 17:31): "Do you have a skill creation skill", "invoke the skill creator tool", "Look at the high-level instruction here @tmp.md and start", then in the second session "load your skill-creator skill" and "Follow the instructions here @tmp.md".

17:33
> Some of the recent paper where he is last author were also primarily written by him, so include those also

17:37
> Can you go further back in time so I can select a few more papers

17:40
> Ok I've selected a few more. Some do not have full text, can you extract from the PDFs also in the repo?

17:47
> I've made my selection

18:16
> Now we need to specify a little further on the context loading strategy. How should Claude load these examples? The basic strategy, and arguably the most important, is to ALWAYS load related work when writing about the related work. However, there are also dependencies. For example, the related work in HCI papers are often about framing, so loading the intro and abstract may become important. Another important thing about related work is about differentiating prior work and current work, sometimes that's about method (of the current paper)
>
> We need some guidelines too, for example, the writing skill is ALLOWED to put placeholders when there is a lack of context to remind Joseph that he should figure out how to write a transition, or cite a clostly related paper here, for example.
>
> Also search online on how people 'spot' LLM generated writing, and come up with strategies to avoid writing sentences that will be spotted by the reviewers.

18:32
> on 3, can we actually look through my writing and find what phrase I typically use in replacement of the words in the blocklist

18:47
> more instructions - cite real papers, always check your writing against the actual paper to make sure everything is factual. If you are bending / extending / gernealizing from a paper, ask joseph to check if the genrealization is valid, show evidence and reasoning for him to check.
>
> You can cite papers that joseph's has already cited before. You can cite new papers, when you really need to. When you introduce a new citation to the write up, make sure joseph is aware so he can come check and make sure he likes the paper that you've cited and how you've cited it

18:57
> no, you've misunderstood me, not prior citations from my prior papers, i mean in the document that joseph's is actively writing. You should also be aware that he might have multiple files for the same paper, so any in those are also count as 'existing'

19:00
> so we don't need the prior citation list right?

> no wait, actually that's not a bad idea, anything i've cited before should also count

19:05
> Anything else before we commit?

19:07
> the write-like-joseph skill should be gated with .i-am-joseph at the root of the repo

19:19
> commit to main

## What happened

1. The agent loaded skill-creator, read the brief, and opened an interactive plan with a checklist of 29 papers that had full text on disk, marking first- and last-author papers as recommended. Joseph asked for older papers too; 11 pre-2022 papers were added, most needing PDF extraction. PyMuPDF garbled the two-column layout, so the agent switched to pdftotext. Ten papers were confirmed.
2. A second round proposed the `examples/` taxonomy from the papers' real section headings. Joseph approved 14 subfolders (the 13 proposed plus `example-user-scenario`). Ten parallel agents extracted 109 verbatim section files. One extraction hit a content filter because the paper quoted raw crowdsourced dataset items; the retry replaced quoted data with a placeholder.
3. SKILL.md was drafted with the identity framing, a read-the-examples-first workflow, a word blocklist, and register notes. Joseph then added the context-loading strategy (related work always loads, with a dependency table for intro, abstract, and the current draft's method), placeholders as an allowed output, and web research on how reviewers spot LLM prose.
4. Joseph asked for the blocklist to be grounded in his own corpus rather than guessed. A frequency audit over the ~102k-word corpus un-banned words he actually uses (leverage, novel, comprehensive, Additionally) and produced a "what Joseph writes instead" table with counts.
5. Citation discipline went through three turns: first the agent built an index of references from his past papers; Joseph corrected that "existing" means cited anywhere in the paper project being written; then he reversed and kept both. Final model: citations in the active draft and in his published bibliography are free, anything else is new and gets reported for vetting.
6. Committed, README and install.sh updated, then the `.i-am-joseph` gate was added on request and committed separately. The eval round skill-creator asks for was never run.

## Later sessions that changed the skill

- **2026-09-01 to 2026-09-07**, `95d6c6af-03bc-473f-9045-bb2765a8ee28.jsonl`. Prompts, verbatim: "Let's improve the write-like-joseph skill. I think its fantastic that in the skill file we have corpus count and sentences level patterns. Can we additional count my sentence length in all the examples and record the distribution in the skill file." Then "Also calculate raw word distributions. Only include the head of the distribution in the skill file", "longer head, double the number of words", "now bigrams and trie grams", "remove the bigrams, they are not informative". On 2026-09-07 Joseph pasted a handoff note from a paper audit asking to fold four ad hoc voice-audit scripts into one checker inside the skill. That became `scripts/voice_check.py`; its plan is `private/plans/2026-09-07-voice-check.plan.md`.
- **2026-10-03**, `0ba3d1e1-39f5-457f-b37b-eec5cebee222.jsonl`. The brief to move the voice profile into an untracked `private/` directory and rewrite git history so no commit ever contained it. That brief is quoted verbatim in section 0 of `private/plans/2026-10-03-private-voice-profile.plan.md`. Commit `4250947`.
