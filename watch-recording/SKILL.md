---
name: watch-recording
description: "Read and analyze a long video recording — a meeting, user-study session, interview, demo, or screen share — that is far too large to load into context, by pairing its transcript with a grid of timestamp-named frames you open only where the screen matters. Sets the recording folder up (one frame every N seconds plus a readable speaker-attributed transcript), then works through it: attributing every claim to a speaker, separating what people did from what they said they would do, and checking on-screen actions against the frames. Use whenever the user points at a recording (.mp4/.mov/.mkv, with .vtt/.srt captions or none at all — it can transcribe and diarize locally) and asks what happened in it, what someone said or did, or to pull quotes, findings, or evidence out of a call — including writing the whole thing up as a report with cropped frames interleaved as evidence."
argument-hint: [path to the recording folder, plus what you're looking for in it]
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(python3:*), Bash(ffmpeg:*), Bash(ffprobe:*), Bash(whisper-cli:*), Bash(uv:*), Bash(ls:*), Bash(du:*), Bash(magick:*), Bash(command -v:*)
---

# Watch a recording you can't load

A recorded meeting is two artifacts: a video far too large to hand to a model (a one-hour call is
several hundred MB) and a caption file that is cheap to read but **blind to the screen**. Most of
what matters in a working session — the number someone reads aloud, the panel they point at, the
thing they actually clicked — lives in the gap between them.

This skill closes that gap. `setup_meeting_snapshots.py` extracts one frame every N seconds, each
**named after its own timestamp**, and renders the captions as a readable transcript. The
transcript then becomes the index into the video: read a line, take its `[HH:MM:SS]`, floor it to
the interval, open `video-snapshots/HH-MM-SS.jpg`. You read the whole meeting as text and pay for
pixels only where the screen is the point.

> Provenance: this is the workflow that produced a case-study write-up from a 1h12m partner call —
> 364 speaker turns read in full, frames opened wherever the screen carried the argument, five of
> them cropped and inlined as figures. The analysis rules in Step 4 are the mistakes that pass
> made, and they are the reason this is a skill and not just a script. Its one regret is in Step 3:
> it looked at too few frames.

---

## Step 0 — Preconditions

- **A folder** holding the video and its captions. One meeting per folder; the script discovers
  both by extension (largest file wins if several).
- **Captions.** `.vtt` is what you want: it carries `<v Speaker Name>` tags, so the transcript
  comes out speaker-attributed. `.srt` also parses, but has no speaker tags — every turn comes
  back `(unattributed)`, which makes most of Step 4 impossible. If only an `.srt` exists, say so
  before starting: the analysis will be much weaker.
- **ffmpeg + ffprobe** on PATH (`brew install ffmpeg`). Check with `command -v ffmpeg`.
- **No captions at all?** Transcribe locally — see the next section. Ask the user for the
  platform's export first, though: it is strictly better, and free.

### No captions: transcribe locally

A platform export names the people who spoke. Nothing you can compute does. So **always ask for the
export first** — Teams, Zoom and Meet all have one, and pulling it takes the user a minute. Only
fall back when it genuinely does not exist (a QuickTime screen recording, a phone interview, a
partner who never enabled captions).

The fallback runs entirely on this machine — no audio is uploaded anywhere, which is the whole
reason it is local and worth saying out loud to the user:

```bash
python3 ~/.claude/skills/watch-recording/setup_meeting_snapshots.py <recording-dir> --transcribe
```

That chains `transcribe_recording.py`, which does two separate jobs with two separate models:
**whisper.cpp** turns audio into timestamped words, and **pyannote** decides who was speaking when.
Whisper alone cannot do the second job — it has no notion of speakers — and without it every turn
lands `(unattributed)` and Step 4 collapses. Speakers are assigned per *word* and grouped
afterwards, because one natural Whisper segment happily spans a speaker change.

Pass `--speakers N` whenever the user knows the count. It measurably improves the clustering, and
they almost always know.

**Then treat the result as a weaker source than an export, for the rest of the analysis:**

| | |
| --- | --- |
| Labels are `SPEAKER_00`, not names | Map them to people by reading the transcript — self-introductions, who gets addressed by name, who owns which project. **Say which mapping you inferred and what it rests on.** An unmappable speaker stays `SPEAKER_02`; do not guess. |
| Words can be wrong | Whisper mishears names, jargon and product terms especially. Before quoting a line that carries real weight, re-listen to that moment (`--at HH:MM:SS` gets you the frame; the audio is in the source file) or flag the quote as machine-transcribed. |
| Boundaries can be wrong | Diarization splits and merges people imperfectly, most often in crosstalk. A turn that reads oddly — one speaker answering their own question — is usually a mis-split, not a person being strange. |
| **A one-word turn is suspect** | The specific artifact to watch for: a sub-second turn of one or two words, sitting inside another speaker's stretch (`[00:00:14] SPEAKER_01: ask`). It is usually the boundary landing a word late, not an interjection. But it is genuinely ambiguous — real backchannel ("yeah", "right", "no, wait") has the identical shape, and who pushed back matters — so the pipeline leaves these alone rather than smoothing them away. **Treat a one-word island as unverified**: attribute it only after re-listening, and never build a finding about agreement or dissent on one. |
| Say so in the report | State in the write-up that the transcript is machine-generated, and which model produced it. A reader who thinks these are real names and verbatim words will over-trust every quote in it. |

Options worth knowing: `--no-diarize` skips pyannote entirely (needs no `torch`, gives no speakers —
only worth it for a single-speaker recording), `--whisper-model` points at a specific `.bin`, and
`--language auto` handles a non-English call. Run `transcribe_recording.py` directly for the full
set. Run it directly as `uv run ~/.claude/skills/watch-recording/transcribe_recording.py <dir>` —
its dependencies are declared in the script's own PEP 723 header, so there is no `--with` chain to
get right.

**Requirements.** `whisper-cli` (`brew install whisper-cpp`) and, for diarization, `uv` plus a
HuggingFace token (`hf auth login`). The pyannote models are gated: loading one pipeline pulls
**three** separately-gated repos, so accept the conditions on all of them —
[`speaker-diarization-3.1`](https://huggingface.co/pyannote/speaker-diarization-3.1),
[`segmentation-3.0`](https://huggingface.co/pyannote/segmentation-3.0) and
[`speaker-diarization-community-1`](https://huggingface.co/pyannote/speaker-diarization-community-1)
(the last is where pyannote 4.x reads its embedding transform). All free and instant. Accepting only
some means the first run fails partway with a 403 naming a repo you have not accepted yet; the
script prints whichever one it was. A Whisper model is found automatically if one is already on the machine
(including the `large-v3-turbo` that OpenSuperWhisper ships) and downloaded only if none is.
Transcription is not fast — budget a few minutes per hour of audio — so start it and say so.

---

## Step 1 — Set up the folder

```bash
python3 ~/.claude/skills/watch-recording/setup_meeting_snapshots.py <recording-dir>
```

Writes three things next to the video:

| | |
| --- | --- |
| `transcript.md` | Cues merged into speaker turns, each stamped `[HH:MM:SS]`. **Derived — always regenerated.** |
| `video-snapshots/HH-MM-SS.jpg` | One frame every 10s, ≤1568px wide. |
| `README.md` | The folder's own entry point, so a future session that is handed only this directory can work out the lookup rule. **Seeded once, then left alone** — a re-run never eats hand-added notes (`--force` to overwrite). |

Re-runs skip frames that already exist, so interrupting extraction is safe. A one-hour recording is
~360 frames and ~40 MB, a couple of minutes of ffmpeg.

Read the script's own output before moving on. It reports the duration, the cue→turn counts, and —
importantly — whether speech ends long before the video does.

**Offer to gitignore the heavy artifacts.** The video and `video-snapshots/` are large and fully
regenerable; the transcripts are small and worth keeping. If the folder is inside a git repo,
suggest:

```gitignore
# Regenerable from the source recording; too large for git.
**/video-snapshots/
**/*.mp4
```

---

## Step 2 — Read the transcript whole, before any frame

`transcript.md` for a one-hour meeting is ~55 KB — roughly 14k tokens. Read all of it. Do not
grep your way through a recording you have not read; the corrections in Step 4 are exactly the
kind a keyword search cannot make.

Then, before writing anything, **build the roster**. The generated transcript lists speakers and
turn counts; extend that into a table with the column that actually matters:

| speaker | role | did they do the thing you are studying? |
| --- | --- | --- |

Two traps live in this table:

- **A room-mic label is not a person.** Conference systems label by device: `CR01 Cedar (East, 3)`
  was *the room our own team sat in* — several people merged under one name. Never attribute a
  quote from such a label to an individual, and work out whether that label is "them" or "you"
  before quoting it as evidence.
- **Presence is not participation.** In the source meeting, three of the five labels never used
  the system under discussion. One said so outright at `[00:07:46]`. Everything those speakers
  contribute is context or motivation — **never a finding about the thing**. Quarantine it in a
  separate section of your notes so it cannot leak into a claim later.

---

## Step 3 — Open frames, and lean toward opening more

**Be eager here.** The failure mode in practice is looking at too few frames, not too many. A
1568×882 frame costs ~1.8k tokens — thirty of them is ~55k, which is nothing against a modern
context window, and far cheaper than one confidently wrong claim about what someone did. **Budget
in tens, not units.** Across an hour-long working session, twenty to fifty frames is a normal,
healthy read; five means you took the transcript's word for things.

What you cannot do is load the grid: ~360 frames for one hour is ~650k tokens, most of it pictures
of faces. So the discipline is *choosing*, not *rationing*.

Open a frame whenever there is a plausible reason. Deixis (*"this panel"*, *"that number"*), a
figure read aloud, a claimed action, anything you'll cite as evidence that a UI state existed — all
obvious, and you'll reach for them anyway. Three that are less obvious and get skipped:

- **The opening minutes, always.** They are a free window into prior, unrecorded use — see rule 4.
- **Any stretch you are about to characterize.** Before writing "they spent ten minutes on X", look
  at two or three frames from inside it. Cheapest way to catch a summary the transcript supports and
  the screen contradicts.
- **Anything you are about to hedge.** If "appears to", "seems to have", or "presumably" is forming
  in your draft, there is a frame that either settles it or lets you say plainly that nothing does.

Skip frames only where nothing is on screen but people: scheduling, introductions, opinion.

**Open them in batches.** Several `Read` calls in one message cost the same wall-clock as one, so
when a segment matters, pull the frame, the one after it, and the one before it together rather
than iterating one at a time.

**Log every frame as you open it** — filename, why you opened it, what it showed, including the
duds. This becomes the ledger the report closes with (Step 7). Keep it as you go; reconstructing
it at the end is exactly where the frames that disconfirmed something go missing.

### Finding the interesting stretches cheaply

JPEG size tracks visual complexity, so a directory listing localizes the screen-share segments for
free — no images loaded:

```bash
ls -l <dir>/video-snapshots/[0-9]*.jpg | awk '{printf "%s %6.0fKB\n", $9, $5/1024}'
```

In the reference recording: **~9 KB** frames were a blank/ended room, **~46 KB** was the gallery
view of faces, and **90–200 KB** was a busy shared screen. The peak sizes pointed straight at the
densest demo minutes. Use this to choose *where* to look, then use the transcript to choose *when*.

### Two rules about the frames themselves

- **A frame is up to `interval` seconds stale.** It shows the screen at or before the line, never
  after. **Read the next frame too** when the screen is the point — a click and its result almost
  always straddle two frames.
- **Transient interactions do not land in the grid.** A hover, a tooltip, a menu that opened and
  closed inside ten seconds will not be in any frame. The honest label for that is *"setup only —
  the frame shows the precondition, not the act"*, not *"confirmed"*.

### `--at` is for precision in *time* as much as in resolution

```bash
python3 ~/.claude/skills/watch-recording/setup_meeting_snapshots.py <recording-dir> --at 00:19:53
```

This writes `video-snapshots/exact-00-19-53.jpg` at the source resolution and prints the path. The
obvious use is a detail the downscaled grid can't render — small text, a number in a corner.

The **less obvious and more valuable** use is pinning *when* something happened. The grid only
answers to ±`interval`, so "when did that panel open?" has no grid answer better than a ten-second
bracket. Don't hedge to the grid and call it done — **bisect with `--at`** until you have it to the
second:

```
00-08-20.jpg  panel closed  ─┐
00-08-30.jpg  panel open    ─┘   --at 00:08:25 → 00:08:22 → …  converges in 3-4 calls
```

Measured on a real recording: hedging to the grid gave *"roughly 08:22–08:55"*, wrong by two to
three seconds at both ends; four bisecting `--at` calls gave `00:08:21–00:08:57`, correct. If a
timing word like "roughly" or "around" is about to appear in your answer, that is the signal to
bisect instead.

### Check whether anyone was actually driving

Before you characterize a stretch as a demo, confirm the screen was changing. A meeting can sit on
one unchanged screen for fifteen minutes while people talk over it, and the transcript looks
identically busy either way.

Compare **adjacent** frames; a run of low deltas means nobody is driving:

```bash
magick compare -metric RMSE a.jpg b.jpg null:      # prints "<abs> (<normalized>)"
```

On a real recording, adjacent frames over a static screen scored **0.011**; adjacent frames while
someone was clicking scored **0.072**. Calibrate on a pair you know is active before trusting a
number, and compare *adjacent* frames rather than distant ones — faces drift over minutes and will
swamp the signal.

**Never write "identical" or "pixel-identical."** The webcam tiles keep moving, so the files always
differ, and a reviewer who checks a checksum will throw out a true finding because the proof was
oversold. Both arms of a controlled test made exactly this mistake on exactly this recording. The
phrasing that survives contact is *"the shared-screen region is unchanged to within JPEG noise, N×
below a real screen change."*

---

## Step 4 — The analysis rules

These are corrections a real first pass got wrong. Every one of them flattered the subject, which
is the direction this kind of analysis drifts by default.

**1. Modal verbs are not actions.** *"I would probably start with…"*, *"I could look through the
papers"*, *"I know I can go in and see the sources"* — these describe a route the speaker had not
walked. A first pass wrote all three up as things the person did. Before recording any capability
as exercised, check the verb; if it is conditional, either downgrade it to intent or go find a
frame that settles it.

**2. Check who raised the topic first — then go looking for the reaction.** Before writing *"they
found X themselves"*, read the three to five turns **before** the one you are quoting. In the
reference meeting an interviewer had walked the participant through the feature step by step at
`[00:14:08]`–`[00:14:17]`; the participant's contribution was *"Oh, cool."* Discovery and
demonstration read almost identically in a transcript and mean opposite things.

But do not let that become the *organizing* question. Who suggested a thing is a caveat on a claim,
not a category to sort findings into. **The evidence worth having is what the person did and said
once the feature did something** — the judgement they formed, what they accepted, what they pushed
back on, what they went and did next. A prompted action followed by a real reaction is worth more
than an unprompted click followed by nothing. When you catch yourself building a taxonomy of who
initiated what, you have drifted from the thing being studied.

**3. Frames overturn quotes in both directions.** Two conditional quotes were *upgraded* to
confirmed actions when a frame five minutes into the call showed the resulting state already on
screen — the person had done it before the meeting started. A third claim was *downgraded* to
"setup only" when no frame caught the transient interaction. Neither correction was available from
the transcript.

**4. What's on screen at minute five is evidence about what happened before minute five.** The
opening frames of a recording are a free window into prior, unrecorded use: filters already
engaged, panels already open, a state nobody would reach in the first thirty seconds. Look there
early.

**5. Do a second pass with the constraint in force.** Re-read one speaker's turns end to end while
holding the rule you have adopted — *only this person's use counts* — explicitly in mind. Doing
that to 131 turns caught four errors the first, whole-meeting pass had made. A general reading and
a constrained re-reading of the same text are not the same operation.

**6. Say what the evidence shows, separately from what you concluded.** This is the failure mode
that survives everything else. Across a controlled test, agents read frames accurately and then
described their evidence loosely — a true static-screen finding sold as "pixel-identical" files
(false), a true room-mic identification with no frame cited (indefensible), an inference about a
captioner's behaviour stated as an observation (unverifiable). Every one of those was a *correct
conclusion* made attackable by a *wrong proof*.

So keep the two registers apart in the writing. *"`00-08-40.jpg` shows the panel open, reading 323
Papers"* is an observation. *"He was reading the tiles left to right"* is an inference — allowed,
but labelled. If the frame does not show it, write that the frame does not show it; a frame is one
crop of one screen at one instant, not the session. And if a claim rests on something outside your
evidence entirely — what a captioner did, what someone was thinking, what happened off-camera — say
that plainly rather than reaching for a proof that will not hold.

**7. When ordering matters, go back to the raw captions.** `transcript.md` merges each speaker's
consecutive cues into turns, so a turn's timestamp is the start of a *run*, not of the sentence you
are quoting — and overlapping speech is flattened into a tidy sequence that never happened. Any
question of the form *who said it first* or *did they talk over each other* has to be settled in the
`.vtt`, where every cue keeps its own start and end. In testing, the merged transcript ordered two
turns as `00:07:11` then `00:07:17` — sequential, and the wrong story. The cues showed them
overlapping: the participant had begun answering before the other speaker finished.

The same merge has a quieter trap. **A two-word interjection splits one person's sentence into
several turns.** One question in the reference meeting appears at `[00:06:11]`, `[00:06:16]` and
`[00:06:29]` because the room mic emitted *"The."* in the middle of it. Quote across that gap under
a single timestamp and you have invented a citation; cite the range instead.

**8. Grep the captions to prove a negative.** *"Nobody but him ever says 'nest'"* is a strong claim
and costs one command over the whole `.vtt`. When the question is whether anyone cued a term, an
idea, or a feature name, a whole-file grep settles it in a way no amount of reading does — and it
scales to the parts of the recording you never looked at.

```bash
grep -n -i -E 'nest|group|broader|collaps' <recording-dir>/*.vtt
```

**9. Blank frames at the end are the recording.** Meetings routinely keep rolling on an empty room
— the reference call ran 21 minutes past its last word. The script warns about this in
`transcript.md` and `README.md`. It is not a broken extraction, and there is nothing there.

---

## Step 5 — Write it up so every claim can be re-checked

Cite in the transcript's own coordinates. Each claim carries **the timestamp**, and where the
screen was the evidence, **the frame filename** and what it reads:

> Projected the theory onto the canvas and filtered it to its own concept pairs — `00-05-20.jpg`,
> banner reads *"Theory edge filter active"*.

> Hovered a statement to locate it in the graph `[00:14:56]` — **setup only**: `00-13-40.jpg`
> shows the precondition; the hover itself is transient and no frame catches it.

Then:

- **Quote character by character** from `transcript.md`. Do not tidy speech; captions are already
  a lossy pass over what was said, and a paraphrase-of-a-paraphrase is not a quote.
- **Tag every attribution with the speaker's roster status.** A vivid line from someone who never
  touched the thing is motivation, not evidence.
- **Separate what was verified on screen from what was said**, visibly — a column, a tag, anything
  the reader can scan. The distinction is the entire value of having done this.
- If a claim rests on neither a timestamp you can point to nor a frame you actually opened, it is
  not a finding yet.

---

## Step 6 — Deliver the report as an interactive plan

When the ask is *"summarize what happened in the meeting"* or *"write this up"*, the output is not
a chat message. Author it with the **`interactive-plan`** skill and launch the viewer. Load that
skill for the full tag spec; what follows is why the pairing works and what is specific to
recordings.

**Take the report's shape from the user, not from here.** Whoever invokes this skill knows what the
write-up is for — a paper section, a decision memo, notes for a colleague — and will say so, or has
said so already in the surrounding conversation. That context outranks any template. What this step
supplies is the *medium* (a tagged plan they can answer and comment on), the *figure discipline*
below, and the ledger in Step 7. Everything else — sections, ordering, length, what earns a heading
— follows their ask. If they haven't said, ask before writing 40 KB in the wrong shape.

A write-up from a recording arrives in exactly the shapes that skill models:

| what you found | tag |
| --- | --- |
| Something in the recording contradicts what we believed or published | `<finding severity="p0…p3">` |
| A call only the user can make — what to headline, what to cut, whose account to trust | `<open-question>` with real options |
| Something the recording settles | `<decision status="locked" from="Q-…">` |
| A caution on a specific sentence — a stretched attribution, a quote doing more work than it can bear | `<comment>` anchored to a `<user-highlight>` span |

That is the payoff of the pairing: a meeting write-up is mostly *contested claims*, and this format
makes the contest reviewable — the user answers, comments, and locks decisions in the viewer, and
their answers come straight back into the same file for your next pass.

Lint and launch (both from the `interactive-plan` install):

```bash
cd ~/.claude/skills/interactive-plan/app && bun run lint:plan <abs-path-to-report.md>
node ~/.claude/skills/interactive-plan/app/server.mjs <abs-path-to-report.md>
```

### Interleave the frames — do not append them

Put each figure **at its use site**, not in a gallery at the end. The pattern that works is
**quote → image → what the image proves**:

> **[00:07:17] Dana:** these two were separate in the theory when I initially loaded it, but if I
> click on one and go to zoom node, then I can say, let's zoom these out to their broader concept.
>
> `![The canvas after the zoom: an ABC transporters group box containing ABCG2 (5 papers) and
> P-glycoprotein (8 papers, MDR1 ABCB1), with ruxolitinib connected in from the left by increases
> and decreases edges carrying their own source counts.](data:image/webp;base64,…)`
>
> An **ABC transporters** group box holding **ABCG2** (5 papers) and **P-glycoprotein** (8 papers),
> on an 8-concept canvas — and note every node and edge carries its own source count.

Three things that pattern gets right:

- **The image is adjacent to the claim it supports.** A reader checks it without scrolling, which
  is the entire reason to embed rather than cite a filename.
- **The prose reads the evidence out of the image.** Never drop a screenshot and let it speak for
  itself; say what in it is the evidence.
- **The alt text transcribes what is visible** — panel names, the actual numbers, the banner text.
  Write it long (the reference figures run 200–450 characters). It carries the evidence for anyone
  reading the raw `.md`, for the PDF export, and for you on a later pass.

### Crop hard

Frames are screenshots of a live call. They carry participants' faces in the video tiles, and a
shared browser brings bookmarks bars, tab titles, and whatever else was open. Cropping is not
polish — it is what makes the figure *about* the evidence, and it is a privacy control. The
reference figures went from 1568×882 down to **640×190** (one stat row), **478×445** (a chat
panel), **730×710** (an evidence list). Get consent for faces before anything leaves the folder.

```bash
# 1. full-resolution original at the exact moment (the grid is downscaled)
python3 ~/.claude/skills/watch-recording/setup_meeting_snapshots.py <dir> --at 00:07:17

# 2. crop to the evidence
magick <dir>/video-snapshots/exact-00-07-17.jpg -crop 1100x900+420+140 +repage -quality 80 /tmp/fig-zoom.webp
```

**Read the crop back** before embedding it. Getting `+X+Y` right from a downscaled frame is
guesswork on the first try, and a crop that clips the number you are citing is worse than no
figure.

### Embedding: two constraints, learned the hard way

- **`data:` URIs only.** The viewer's catch-all route answers any non-API path with the SPA shell,
  so `![](video-snapshots/x.jpg)` comes back as 401 bytes of `text/html` and renders broken.
- **Inline only — reference-style images never resolve.** Every prose run and every structured
  element body is parsed as its own markdown snippet, so a `[ref]: data:…` definition at the foot
  of the document is never in scope; it renders as literal `![alt][ref]` text. Both the viewer and
  the PDF export behave this way.

**Keep the base64 out of your context.** Five figures were ~86 KB of base64 in a 145 KB plan —
about 22k tokens of pure noise if it passes through you. Author the plan with placeholders and let
the shell splice:

```bash
python3 - <<'PY'
import base64, pathlib
ALT = 'The canvas after the zoom: an ABC transporters group box containing ABCG2 (5 papers)…'
img = base64.b64encode(pathlib.Path('/tmp/fig-zoom.webp').read_bytes()).decode()
plan = pathlib.Path('<abs-path-to-report.md>')
plan.write_text(plan.read_text().replace('[[FIG:zoom]]', f'![{ALT}](data:image/webp;base64,{img})'))
PY
```

Lint after splicing, and check that every `[[FIG:…]]` placeholder is gone. The cost is real — long
lines, a much larger file — so inline a figure for evidence a reader would otherwise take on trust,
not for decoration.

---

## Step 7 — Close with the frame ledger

**Every report ends with a table of every frame you opened.** Not the frames you used — the frames
you *looked at*, including the ones that showed nothing, contradicted your first reading, or turned
out to be the wrong moment. This is the verification affordance: it lets the user check your
sampling rather than only your conclusions, and see immediately whether you looked at three frames
or forty.

```markdown
## Frames read

| frame | line it covers | why I opened it | what it showed | used in |
| --- | --- | --- | --- | --- |
| `00-05-20.jpg` | `[00:05:24]` "I know I can go in and see the sources" | conditional quote — did they actually do it? | theory-edge filter banner already active, 5 min in | §C0, figure |
| `00-05-30.jpg` | next frame after the above | click-and-result straddle check | same state, no new information | — |
| `00-13-40.jpg` | `[00:14:56]` hover to locate a statement | confirm the hover | precondition only; hover is transient, not caught | §C0, downgraded to "setup only" |
| `00-08-40.jpg` | `[00:08:31]` "323 papers, 827 experiments" | verify numbers read aloud | panel confirms; the numbers are wrong at source | §F-3, figure |
| `00-31-10.jpg` | `[00:31:02]` "that number there" | resolve a deictic | gallery view — nothing was shared | not used |
```

Rules for the ledger:

- **Complete every time, whatever the size of the ask.** A three-line answer still gets every frame
  it consulted. Scaling the ledger to the question sounds reasonable and is exactly where omission
  starts: the frames most tempting to leave out of a "quick" answer are the ones that didn't support
  it. Keep the rows terse if the answer is terse — but keep all of them.
- **Duds are the point.** A ledger of only load-bearing frames tells the user nothing about
  selection bias. The `00-31-10.jpg` row above — a deictic that turned out to have no screen behind
  it — is more informative than the rows that worked.
- **Say what the frame showed, not what you concluded overall.** "Panel confirms the numbers" is a
  frame observation; "the pipeline is miscounting" is a finding, and belongs in the finding.
- **Include `exact-*` extractions and crops**, noting which figure each became.
- **Build it as you go** (Step 3), never by reconstruction.
- **Derive any frame count from the ledger; never state one beside it.** A report that says "I
  opened 36 frames" above a table listing 42 has told the reader its own bookkeeping is unreliable,
  which is the one thing the ledger exists to establish. Count the rows.
- If a claim in the report rests on a frame, that frame must have a row. If it does not, either the
  row is missing or the claim is not actually frame-backed — both worth catching before the user
  does.

---

## Reference

### Flags

| flag | what it does |
| --- | --- |
| `--interval N` | Seconds between frames (default 10). Lower for a dense demo, higher for a talking-heads call. **The flooring rule follows this value** — at `--interval 20`, `[00:19:53]` → `00-19-40.jpg`. |
| `--width N` | Frame width in px (default 1568, never upscales). |
| `--quality N` | ffmpeg JPEG `-q:v`, 2 best → 31 worst (default 3). |
| `--at HH:MM:SS` | Extract one full-resolution frame and exit. |
| `--start` / `--end` | Sample only part of the recording. |
| `--transcript-only` | Re-render `transcript.md` without touching frames. |
| `--force` | Re-extract existing frames and overwrite the README. |
| `--jobs N` | Parallel ffmpeg calls (default 8). |
| `--transcribe` | No captions in the folder? Transcribe locally instead of failing. |
| `--no-diarize` | With `--transcribe`: skip speaker labelling (no `torch`; every turn unattributed). |
| `--speakers N` | With `--transcribe`: tell diarization the speaker count. Use it whenever known. |
| `--whisper-model` / `--language` | With `--transcribe`: pick a specific `.bin`, or a non-English language. |

`transcribe_recording.py` takes the same transcription flags plus `--min-speakers` / `--max-speakers`
(when the count is a range, not a number), `-o/--output` to place the `.vtt` somewhere specific, and
`--keep-wav` to retain the decoded audio for re-listening.

It **refuses to run if the folder already holds any `.vtt`/`.srt`** — not just one matching the
video's name. That existing file is probably a real export with real names, and adding a second
transcript beside it is worse than useless: `setup_meeting_snapshots.py` picks the *largest*
transcript in a folder, so the machine one can silently win. `--force` overrides the refusal (and
overwrites), `--output` sidesteps it by saying explicitly where the file should go.

### Why transcription is built the way it is

- **Two models, two jobs.** whisper.cpp produces words; pyannote produces speakers. Whisper has no
  concept of a speaker, so without the second model the attribution analysis in Step 4 is
  impossible, not merely degraded.
- **Speakers are assigned per word, then grouped.** One natural Whisper segment routinely spans a
  speaker change ("…so we shipped it — wait, did we?" is one segment, two people). Whisper runs with
  `-ml 1 -sow` for one segment per word; each word takes the speaker whose turn contains its
  **midpoint** (edges bleed into the neighbour), and cues are formed afterwards. So a cue boundary
  lands where the speaker actually changed.
- **A model already on the machine is reused.** It looks through the usual whisper.cpp locations and
  OpenSuperWhisper's model directory before downloading anything, and skips brew's
  `for-tests-ggml-tiny.bin` stub, which loads happily and emits garbage.
- **pyannote is handed a decoded waveform, not a path.** Its file-decoding stack
  (torchaudio/torchcodec) is a compiled extension that must match the torch ABI exactly and fails
  with an unreadable `.dylib` error when it doesn't. The script already made a known-format WAV with
  ffmpeg, so it reads that with the stdlib and skips the problem.
- **The provenance is written into the `.vtt` itself**, as a `NOTE` naming both models. A transcript
  that gets copied around should carry the fact that its words may be misheard and its speaker
  labels are guesses.

### Why the defaults are what they are

- **1568px** is empirical, not an API limit: shared-screen text (UI labels, body prose, chat) is
  legible at this width and is not at 640px. Wider frames were tested against a real recording and
  read back no better, so the grid stays small — `--at` is the escape hatch.
- **Uniform 10s sampling** is deliberate. A scene-change-driven set would be denser where it
  matters, but the timestamp→filename mapping would no longer be derivable by hand, and that
  mapping is what makes the transcript usable as an index.
- Frames are seeked with input-side `-ss`, one ffmpeg call each, so **a frame's filename is its
  seek target by construction** — no frame-index arithmetic that can drift.

### Tests

The timestamp math, the caption parsing, and the transcription seams are pinned:

```bash
cd ~/.claude/skills/watch-recording && uv run --with pytest python -m pytest tests/ -q
```

They cover the real-world traits that break naive parsers — CRLF exports, speaker names containing
commas and parens, cues wrapped mid-sentence, interleaved speakers, and overlapping cue times — plus
the transcription fallback's own seams: merging a speaker timeline onto word timings, model
discovery, and a **round-trip** proving that a `.vtt` this skill generates parses back through the
same reader a Teams export goes through. No test runs Whisper or pyannote — the models are slow and
big, and the inference is not what breaks.
