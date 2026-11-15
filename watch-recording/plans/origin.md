# watch-recording: where it came from

**Created:** 2026-08-25, in a Claude Code session running in the science-kg repo, not this one. The skill was written straight into this repo from there.
**Transcripts:** `~/.claude/projects/-Users-josephc-git-s2-science-kg/34b70fd9-1352-4ed3-ba5e-5ddc880b8e54.jsonl` (2026-08-25, 17:50 to 19:25, the build) and `~/.claude/projects/-Users-josephc-git-joseph-no-skills/ac877a80-d960-4f67-b2f8-54985e1bd1d7.jsonl` (2026-08-26, 06:05 to 17:52, commit, transcription fallback, Codex audit).
**Plan:** none was written. The skill grew out of an existing analysis folder and a skill-creator eval round. The eval outputs are in `watch-recording-workspace/` (gitignored, still on disk).
**Commits:** `56a51c2` read an hour-long recording through its transcript; `6f3030c` transcribe and diarize locally when there are no captions; `a83b6dd`, `375c145` pyannote fixes; `beaf52b` act on the Codex audit.

Everything under "Verbatim" is Joseph's own text, copied from the transcript. Everything under "What happened" is a summary written on 2026-10-27 from the same transcript.

## Verbatim: the brief

2026-08-25 17:50
> Examine how we analyzed a video recorded
> [@/Users/josephc/git/s2/science-kg/plan/evaluation/case-studies/immunology/meeting-recording-20260713/]
> which has transcript and a huge video file. Turn this into a skill in the joseph-no-skills repo so i can use it everywhere and share with my coworkers: /Users/josephc/git/joseph-no-skills
>
> (we created a bunch of images from the video so you can sync with the transcript and selectively load them into your context, the video is too huge to fit)

## Verbatim: the prompts that shaped it

18:09
> Can you also include how to combine this skill and the interactive plan tool to write up a report when asked to summarize what happened in the meeting? We have an example report somewhere for this meeting, where we interleaved screenshots from the meeting when appropriate. We probably want to encourage the skill to do more of this. In this report we also had cropped some screenshots for context, which was also great. one thing that's missing is at the end give a table of all the screenshots the agent had looked at when generating the report and why, for verification. in general the agent should be a little eager to load screenshot context

18:18
> did you use your skill creation skill

18:20
> Yes, please load your skill-creator skill and make sure this is a really well written skill

> full pass

18:50
> What am i looking at on port 3117???

18:53
> what am i suppose to do there?

19:19
> #1, no, focus on their reactions from doing it
> #2 i don't know what you mean
> #3 where is an example write-up i can open in the interactive plan viewer

19:21
> This all looks good, go with your suggestions. When the skill is used, the user will have additional context and instructions guiding what kind of report anyways. make a note of that too

Next day, 2026-08-26, in this repo:

06:05
> commit the watch-recording skill and install it locally

06:07
> wait did we update the readme to include this new skill

06:12
> Will the watch-recording skill try to use local open whisper model to transcribe the video if a transcript is not currently available, if it won't add i

06:35
> I agreed to the license of both, continue

06:44
> so what are we using at the end and why

06:45
> commit, push, make sure its installed locally

07:12
> update readme, commit, push

17:37
> did you run codex audit on this

## What happened

1. The agent read the immunology meeting folder and found two separable things: a mechanism (a script that extracts one frame every 10 seconds, named by timestamp, so a transcript line indexes into the video) and a method that lived only in the write-up plan beside it. That plan recorded a first pass that had got four things wrong, all in the subject's favour: modal verbs written up as actions, "he found it himself" when we had walked him through it, frames overturning quotes in both directions, and a room-mic label standing for several people. Those became the skill's analysis rules.
2. Joseph asked for the report workflow: hand the write-up off as an interactive plan, interleave cropped frames as evidence, end with a ledger of every frame looked at and why, and be eager rather than stingy about opening frames. The agent flipped the frame-budget guidance from rationing to "budget in tens, not units".
3. Asked whether skill-creator had been used, the agent admitted it had built the skill by hand. Joseph asked for a full pass. The agent ran three test prompts against the real July recording, each with and without the skill. It found the baseline could read the answer key (the write-up plan one directory up) and rebuilt the fixture in isolation. Findings: on narrow factual questions the skill did not discriminate; on judgment questions it added rigor artifacts, and the frame ledger was the one thing no baseline produced unprompted. Two places the skill made things worse: it framed the exact-timestamp extraction as a resolution tool rather than a timing tool, and a 14-row ledger on a six-number answer was too much ceremony.
4. Joseph's three calls: drop the agent's new "real, but prompted" category and focus on participants' reactions after using a feature; keep the ledger complete regardless of question size; and note that whoever invokes the skill will supply context about what kind of report they want, which outranks any template. The description optimizer was then run.
5. On 2026-08-26 the skill was committed and installed. Joseph asked whether it would transcribe locally when no captions exist. It would not, so the agent added `transcribe_recording.py`: whisper.cpp for words, pyannote for speakers, assigned per word then grouped, emitting a VTT with speaker tags so a machine transcript flows through the same pipeline as a platform export. Three gated Hugging Face repos had to be accepted by hand. Platform caption exports stay first in the hierarchy because only they carry real names.
6. A Codex audit later that day returned five findings, all real: model-name matching that let a smaller model win, unescaped cue text read back as VTT tags, a transcript collision check that missed a real export, a loose pyannote pin, and a 1.5 GB download before checking whether whisper-cli existed. All five were fixed.
