# thematic-analysis: where it came from

**Created:** 2026-09-02, in one Claude Code session in this repo (00:59 to 07:07).
**Transcript:** `~/.claude/projects/-Users-josephc-git-joseph-no-skills/1bc9d723-3c4c-4994-830b-3693c80ead41.jsonl`.
**Plan:** none for the first version. The spec below was typed straight into the terminal and the skill was built from it, then tested the same night on three real exit interviews in the science-kg repo. The two later plans in this folder came from the follow-up sessions listed at the end.
**Commits:** `06217e2` Braun & Clarke thematic analysis for HCI interview studies; `2d7420f` the shared selected state in the plan viewer that this session asked for.

Everything under "Verbatim" is Joseph's own text, copied from the transcript. Everything under "What happened" is a summary written on 2026-10-27 from the same transcript. Real participant data from the study lives only in the science-kg repo and is not reproduced here.

## Verbatim: the brief

00:59
> What do you know about the process of thematic analysis / open coding process for qualitative research.

01:10
> Create a new skill, 'thematic-analysis' based on Braun and Clarke. I've already created the subfolder and included the original pdf, extract it into full text. Do not git track the pdf nor the full text. Create a skill specificaly for HCI-style studies.
>
> The skill should consists of the following broad operations.
>
> # Code book development
>
> The goal is to create a detailed code book of codes and specific definition.
> This would be a iterative process, where I would ask the agent to review additional interview (often using the watch-recording skill) and spot any new codes and mark existing ones.
>
> You should use your interactive-skill tool to negotiate with me what codes should be included, why, and allow me to review them with example quotes, and allow me to adjust the definition of the codes.
>
> Help me keep clean, so that there are no duplicated codes.
>
> Codes could have at most two levels, but not more.
>
> # Apply code book
>
> After we've created the complete codebook by reviewing all interviews (indicates no more interviews were scheduled), we should go through ALL transcripts and tag ALL quotes that matches with one or more codes. This builds a catelogue.
>
> # Theme development and selection
>
> Review all the codes and all the quotes each is assigned to, come up with high-level themes that captures sets of codes to tell an interesting story or observation.
> Use your interactive-tool again to negotiate with me which themes are valid, how to adjust them, and which ones are worth including in a paper.
>
> # Quote selection
>
> Once we've settled on a subset of themes, we should select the most interesting and insightful quotes from the participants to use as examples in the paper.
>
>
> When this skill is loaded, the full text of Braun and Clarke should be in the context to make sure you become a rigor qualitative researcher.
>
> The skill should also define the right data structure to keep track of all the intermedaite data above, allowing you to verify, audit, for things like coverage over all participants, quotes, and any hallucinations, and accurately list all participants that mentioned each code & theme, etc.

01:10, addendum
> Also, you should look into the write-like-joseph skill for example write-ups of user study interview analysis. This should also inform you to create this skill according to my needs

## Verbatim: the prompts that shaped it during the first night

01:46
> install it so i can test it on real interview data

03:15
> /Users/josephc/git/s2/science-kg/plan/evaluation/field_deployment_user_study/exit-interviews/p13  let's try it on this interview recording

03:51
> Can you explain to me what hybrid, semantic, realist mean? I don't really understand your Q-stance around 'Analytic stance'

04:43
> I gave my feedback, and suggested one additional family, rework the plan for me to review again

04:57
> ok done, let's move on to the next participants P15, there will be a total of 8, we've only collected 3 so far

05:40
> ok responded, update the codebook and codes accordingly (is there a way for me to look at the current code book?)

05:48
> fold it into the yes, include coverage.gap in the new family, i've also left comments on the codebook, so review and revise it. Do we have a source of truth codebook?

05:53
> are those in this dir or in my science-kg repo

> fantastic, let's move on to P18

06:04
> Ok I gave my feedback in the plan, revise and check your codes

06:10
> I forgot to ask, when we were building the thematic analysis skill, did you load you skill creation skill?

06:13
> great. Ok, lets review all the codes, do you see things that should be merged or cleaned up?

06:33
> 1. yes
> 2. yes
> 3. I think we can keep what we have now for now
> 4. ok
> 5. rename to prior-knowledge to keep both
>
> Update the codebook based on the above, carefully re-review all three participants with the updated codebook

06:45
> how do i review your codes over the transcripts, what format and files are there in

06:49
> is this already part of the skill or should we add it, looks like its not part of the skill?

06:51
> i think we need to improve the interactive plan skill for this. When i click on a highlighted span, can we put both the highlight and the comment into a 'selected' mode with different colors so i can see them more clearly

06:57
> ok, good, what is the commit plan on the science-kg side

07:04
> commit this new skill too, remember to update the readme first

07:06
> ok good, let's say we finish code book development and coding of all 8 interviews, what would we do next

## What happened

1. The agent loaded skill-creator, read the three existing skills for conventions, extracted the Braun and Clarke PDF to text (both gitignored), and built the skill: a SKILL.md whose step 0 reads the full paper, the four operations from the brief, a `references/` folder with the data model and review templates, and `scripts/ta.py`. The key design choice came from the brief's demand to catch hallucinations: quotes are never typed. `extract` copies text out of the transcript at a named line, resolves the speaker against the roster, refuses interviewer speech, and `verify` re-checks every stored extract. Coverage over participants, codes, and themes is computed. One fresh-agent dry run on a synthetic three-interview study surfaced seven friction points, which were fixed.
2. Joseph installed it and pointed it at the first real exit interview. The agent coded it, proposed candidate codes grouped in families, and opened a codebook review as an interactive plan. Joseph asked what hybrid, semantic, and realist meant; the agent explained Braun and Clarke's three stance choices and why the HCI defaults were pre-filled.
3. Four codebook rounds followed across three participants, each a plan document Joseph answered in the viewer. Along the way he asked for a way to see the current codebook (a regenerated `reports/codebook.md`, with `codebook.yaml` as the source of truth and commented renderings archived before overwrite), a cleanup pass for merges, and a per-transcript view of the coding. That last request produced the `annotate` command, rendering the coded transcript as a plan page with every extract as a commentable highlight. Joseph noticed it was in the script but not in the skill's instructions, so it was documented along with the highlight flag and the archive rule.
4. He asked for the plan viewer to put a clicked highlight and its comment card into one shared selected state, which was done in interactive-plan the same night.
5. Commits in both repos, with a gitignore rule added in science-kg so raw platform transcripts carrying real names never land in git. The session closed with the agent laying out what follows after all interviews are coded: freeze and full pass, theme development, quote selection, and the write-up handoff.

## Later sessions and their plans

- **2026-09-02 to 2026-09-03**, `~/.claude/projects/-Users-josephc-git-joseph-no-skills-thematic-analysis/d8c86ceb-2e5e-4eb8-8098-481eb2928c49.jsonl` (worktree). Plan: `2026-09-02-review-workbench.plan.md`. Opening prompt, verbatim:
  > i think we need better interface than the interactive plan skill for reviewing and giving feedback on the thematic-analysis skill. Using it to inject and iterate on the codebook given each participants has been pretty good. But the following scenarios are less good:
  >
  > 1. reviewing and giving feedback on the full codebook
  > 2. reviewing annotation on a transcript
  >
  > I want better interfaces for the above two, but also brainstorm if we would also need better interfaces for the subsequent theme and quote selection phases, (and am i missing anything?)
  >
  > Brainstorm and plan first, think like an UX expert and deeply consider my process for reviewing them to make things easy to review and the interactions to be smooth

  Then: "Implement the entire plan to the end, run codex audit, you have up to 10 budget. I'm going to bed for 7 hours, so you should burn as many tokens as you can to ensure the quality of the implementation." A day of play-testing bug reports followed, then the user manual and README, a check that nothing from the copyrighted paper or any real participant was tracked, and three prompts that fixed the skill's identity:
  > when you describe the thematic analysis skill, make sure to emphesize that this is NOT an agent-lead AI analysis, this is scaffolding and interface to user to review and drive thematic coding. The agents checks new codes created by the user across all transcript to check for coverage and recall, and let the user review the quotes and select them. The user has the agency, drives the code and theme creation, the narrative and eventually the story in the paper. The skill is mostly [A] better UIs for reviewing the transcripts and video (via screenshots); and [B] deep semantic search across all transcripts so that user can be a lot more deligent

  > let's adjust a little, 'The researcher drives the analysis, you support.' I do still want the agent to propose codes and themes for me to review and make decisions on. It should generate diverse set of options, sometimes based on my paper drafts or RQs I've provided. So the agent IS also the anlyst, just not the driver, but assist.

  > The agent IS a experienced qualitative analyst on a HCI paper. Keep that identity

  Later in the same session: the code-overlap heat map ("with the goal of [A] finding big parent group that should be split into smaller subcodes; and [B] highly overlapped codes that are potential merges"), proposing deletion of a code, visual indicators beyond toasts, and navigating from pending proposals to the view they affect.

- **2026-09-04 to 2026-09-05**, `~/.claude/projects/-Users-josephc-git-joseph-no-skills/50a8e987-2075-43a3-a9b6-ade863a53c41.jsonl`. Plan: `2026-09-04-theme-definition-and-claims.plan.md`. Opening prompt, verbatim:
  > Let's workon the thematic-analysis skill more. Focusing on the Themes view. After I created a theme, allow me to give detailed definition and what I wish to write in the paper about that theme. Then, the agent can propose codes that should go under that theme so I don't miss anything. Based on my title and definition of each theme, and the codes associated with it, also generate a short summary about what I can claim in my paper. If there is a paper draft already, the agent to read the entire paper to capture the high-level framing of the paper.

  The two decisions that changed the architecture, verbatim:
  > I'm confused about Q-signals, what i want is binary + explanation. A list of code that you think should go into a theme, plus a very brief 'why'

  > It should be everything I do, everywhere, but we also don't want to make a new version mark whenever i make small changes to the codebook. ONLY make a version mark when i asked the agent to apply the current codebook to the transcripts. Before that it means im still working on it. application is the what makes a new version

  Then dropping and folding themes, a code in several themes, and the Quotes view additions (codes on each quote, hover for the frame, the theme inspector on the right, trim on selected quotes, explicit accept for agent proposals).
