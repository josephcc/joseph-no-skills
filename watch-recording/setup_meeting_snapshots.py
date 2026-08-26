#!/usr/bin/env python3
"""Set up a recording so an LLM can "watch" it through its transcript.

A recorded meeting is two artifacts: a video too large to hand to a model, and a
timestamped caption file that is cheap to read but blind to the screen share.
This script bridges them. It extracts one frame every N seconds, named after its
timestamp, and renders the transcript as readable markdown. The transcript is
then the index into the video: read a line, take its `[HH:MM:SS]`, floor it to
the interval, and open `video-snapshots/HH-MM-SS.jpg` to see what was on screen
while it was said.

Usage:
    python3 setup_meeting_snapshots.py <meeting-dir>
    python3 setup_meeting_snapshots.py <meeting-dir> --at 00:19:53

Frames are extracted with input-side `-ss`, one ffmpeg call per timestamp, so a
frame's filename is its seek target by construction -- there is no frame-index
arithmetic to drift. Uniform sampling is deliberate: the mapping stays derivable
by hand from any timestamp, which a scene-change-driven set would not be.

Requires ffmpeg/ffprobe on PATH (`brew install ffmpeg`). Stdlib only, so it runs
under a bare `python3` as well as `uv run`.
"""

from __future__ import annotations

import argparse
import html
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

VIDEO_SUFFIXES = ('.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi')
# `.srt` parses through the same cue reader (the timestamp parser takes its comma
# decimals), but SRT carries no `<v Speaker>` tags, so every turn comes back
# unattributed. Prefer a `.vtt` export whenever the platform offers one.
TRANSCRIPT_SUFFIXES = ('.vtt', '.srt')
SNAPSHOT_DIRNAME = 'video-snapshots'

# 1568px is chosen empirically, not from an API limit: at this width the text in
# a shared screen -- UI labels, body prose, chat -- is legible, and at 640 it is
# not. Wider frames were tested and read back no better, so the extra bytes
# aren't worth it. Use `--at` for a full-resolution frame when a specific detail
# actually matters.
DEFAULT_WIDTH = 1568
DEFAULT_INTERVAL = 10
DEFAULT_QUALITY = 3

# Consecutive cues from one speaker separated by more than this are treated as
# separate turns rather than one run-on paragraph.
TURN_MAX_GAP = 2.5

# Trailing silence worth warning about: recordings routinely keep rolling on an
# empty room long after the last word.
DEAD_AIR_THRESHOLD = 60.0

TIMESTAMP_RE = re.compile(r'^(?:(?P<h>\d+):)?(?:(?P<m>\d{1,2}):)?(?P<s>\d{1,2}(?:[.,]\d+)?)$')
CUE_TIME_RE = re.compile(r'(\S+)\s*-->\s*(\S+)')
VOICE_RE = re.compile(r'<v(?:\.[^\s>]*)*\s+([^>]*)>')
TAG_RE = re.compile(r'</?[^>]+>')


@dataclass
class Cue:
  """One VTT cue: a timestamped, possibly line-wrapped fragment of speech."""

  start: float
  end: float
  speaker: str | None
  text: str


@dataclass
class Turn:
  """Consecutive cues from one speaker, collapsed into a single paragraph."""

  start: float
  end: float
  speaker: str | None
  text: str


def script_command() -> str:
  """How to re-run this script, as a command to paste into the generated docs.

  The README and transcript tell a future reader how to regenerate the folder,
  and the right answer depends on where this file was installed -- a skill
  directory, a repo's `scripts/`, a bare download. Derive it instead of pinning
  one. Symlinks are deliberately left unresolved so an install symlinked into
  `~/.claude/skills/` prints that path rather than the checkout behind it.
  """
  path = Path(os.path.abspath(__file__))
  try:
    path = Path('~') / path.relative_to(Path.home())
  except ValueError:
    pass
  return f'python3 {path}'


def parse_timestamp(value: str) -> float:
  """Parse `HH:MM:SS.mmm`, `MM:SS`, `SS`, or the SRT comma variant, to seconds."""
  match = TIMESTAMP_RE.match(value.strip())
  if not match:
    raise ValueError(f'unrecognized timestamp: {value!r}')
  parts = [match.group('h'), match.group('m'), match.group('s')]
  # A two-field time is MM:SS, not HH:MM -- shift it into the right columns.
  present = [p for p in parts if p is not None]
  while len(present) < 3:
    present.insert(0, '0')
  hours, minutes, seconds = present
  return int(hours) * 3600 + int(minutes) * 60 + float(seconds.replace(',', '.'))


def format_timestamp(seconds: float) -> str:
  """Seconds -> `HH:MM:SS`, truncated so a time never names a later second."""
  total = int(seconds)
  return f'{total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}'


def format_duration(seconds: float) -> str:
  """Seconds -> a short human duration like `1h12m05s` or `21m18s`."""
  total = int(seconds)
  hours, minutes, secs = total // 3600, total % 3600 // 60, total % 60
  if hours:
    return f'{hours}h{minutes:02d}m{secs:02d}s'
  return f'{minutes}m{secs:02d}s'


def snapshot_name(seconds: float, interval: int) -> str:
  """Timestamp -> the filename of the frame covering it (floored to `interval`)."""
  floored = int(seconds // interval) * interval
  return format_timestamp(floored).replace(':', '-') + '.jpg'


def frame_times(start: float, end: float, interval: int) -> list[int]:
  """Every sampling instant in `[start, end]`, aligned to the interval grid."""
  first = int(start // interval) * interval
  if first < start:
    first += interval
  return list(range(first, int(end) + 1, interval))


def parse_vtt(text: str) -> list[Cue]:
  """Parse a WebVTT file into cues, tolerating CRLF, NOTE blocks and cue settings."""
  cues: list[Cue] = []
  for block in re.split(r'\r?\n\s*\r?\n', text.replace('\r\n', '\n')):
    lines = [line.strip() for line in block.strip().split('\n') if line.strip()]
    if not lines or lines[0].startswith(('WEBVTT', 'NOTE', 'STYLE', 'REGION')):
      continue
    timed = next((i for i, line in enumerate(lines) if '-->' in line), None)
    if timed is None:
      continue
    match = CUE_TIME_RE.search(lines[timed])
    if not match:
      continue
    try:
      start, end = parse_timestamp(match.group(1)), parse_timestamp(match.group(2))
    except ValueError:
      continue
    payload = ' '.join(lines[timed + 1 :])
    voice = VOICE_RE.search(payload)
    speaker = voice.group(1).strip() if voice else None
    # Strip real VTT tags first, then unescape -- in that order. WebVTT escapes
    # `&`, `<` and `>` in cue text (real Teams exports do this), so unescaping first
    # would turn `&lt;filter&gt;` into `<filter>` and the tag strip would then eat it.
    body = ' '.join(html.unescape(TAG_RE.sub('', payload)).split())
    if body:
      cues.append(Cue(start=start, end=end, speaker=speaker, text=body))
  return cues


def merge_turns(cues: list[Cue], max_gap: float = TURN_MAX_GAP) -> list[Turn]:
  """Collapse each speaker's consecutive cues into one turn.

  Cues arrive fragmented mid-sentence and can overlap (a negative gap) when
  speakers talk over each other, so the gap test is one-sided on purpose.
  """
  turns: list[Turn] = []
  for cue in cues:
    prev = turns[-1] if turns else None
    if prev and prev.speaker == cue.speaker and cue.start - prev.end <= max_gap:
      prev.text = f'{prev.text} {cue.text}'
      prev.end = max(prev.end, cue.end)
      continue
    turns.append(Turn(start=cue.start, end=cue.end, speaker=cue.speaker, text=cue.text))
  return turns


def render_transcript_md(
  turns: list[Turn],
  *,
  meeting_name: str,
  video_name: str,
  transcript_name: str,
  snapshot_dir: str,
  duration: float,
  interval: int,
  width: int,
  cue_count: int,
  command: str,
) -> str:
  """Render the readable transcript, headed by the snapshot-lookup instructions."""
  speech_start = turns[0].start if turns else 0.0
  speech_end = turns[-1].end if turns else 0.0
  counts: dict[str, int] = {}
  for turn in turns:
    key = turn.speaker or '(unattributed)'
    counts[key] = counts.get(key, 0) + 1

  out = [
    f'# {meeting_name} — transcript',
    '',
    f'<!-- Generated by `{command}`. Do not hand-edit:',
    '     a re-run overwrites this file. -->',
    '',
    f'- Video: `{video_name}` — {format_duration(duration)}',
    f'- Transcript: `{transcript_name}` — {cue_count} cues merged into {len(turns)} turns',
    f'- Speech runs {format_timestamp(speech_start)} → {format_timestamp(speech_end)}',
    f'- Snapshots: `{snapshot_dir}/HH-MM-SS.jpg`, one every {interval}s, {width}px wide',
    '',
    '## Seeing the screen at any line',
    '',
    'See [`README.md`](README.md) for the full guide to this folder.',
    '',
    f"Take a line's `[HH:MM:SS]`, floor the seconds to the nearest {interval}, and open",
    f'`{snapshot_dir}/HH-MM-SS.jpg`. So `[00:19:53]` → `{snapshot_dir}/00-19-50.jpg`.',
    '',
    f'A frame can be up to {interval}s stale relative to the line, so when the screen is',
    'the point, read the following frame too. For an exact moment, or for full resolution:',
    '',
    '```bash',
    f'{command} <meeting-dir> --at {format_timestamp(speech_start)}',
    '```',
    '',
  ]

  dead_air = duration - speech_end
  if dead_air > DEAD_AIR_THRESHOLD:
    out += [
      f'> **Note:** the recording runs {format_duration(dead_air)} past the last word — dead air',
      '> on an empty room. Frames after '
      f'`{snapshot_name(speech_end, interval)}` are expected to be blank.',
      '',
    ]

  out += ['## Speakers', '']
  out += [
    f'- {name} — {count} turns' for name, count in sorted(counts.items(), key=lambda kv: -kv[1])
  ]
  out += ['', '## Transcript', '']
  for turn in turns:
    who = turn.speaker or '(unattributed)'
    out.append(f'[{format_timestamp(turn.start)}] {who}: {turn.text}')
    out.append('')
  return '\n'.join(out).rstrip() + '\n'


def render_readme_md(
  turns: list[Turn],
  *,
  meeting_name: str,
  video_name: str,
  transcript_name: str,
  snapshot_dir: str,
  duration: float,
  interval: int,
  width: int,
  frame_count: int,
  command: str,
) -> str:
  """Render the folder's README: how to read this meeting without the video."""
  speech_end = turns[-1].end if turns else 0.0
  # Illustrative timestamps, not quotes from this meeting -- two of them, so the
  # flooring rule is visible rather than inferred from a single case.
  example = '00:19:53'
  example_frame = snapshot_name(parse_timestamp(example), interval)
  example_late = '00:20:07'
  late_frame = snapshot_name(parse_timestamp(example_late), interval)

  out = [
    f'# {meeting_name}',
    '',
    'A recording, set up so it can be read without opening the video.',
    '**Start with [`transcript.md`](transcript.md).**',
    '',
    '| file | what it is |',
    '| --- | --- |',
    '| `transcript.md` | The meeting, readable: cues merged into speaker turns. Generated. |',
    f'| `{transcript_name}` | The raw caption export. Source of `transcript.md`. |',
    f'| `{video_name}` | The recording, {format_duration(duration)}. Too large to open directly. |',
    f'| `{snapshot_dir}/` | {frame_count} frames, one every {interval}s, {width}px wide. |',
    '',
    '## Seeing the screen behind a line',
    '',
    'When someone shares their screen, what is on it is often the actual',
    'content — and a transcript is blind to it. That is what the snapshots',
    'are for.',
    '',
    "Take a line's `[HH:MM:SS]` from `transcript.md`, floor the seconds to the",
    f'nearest {interval}, and open `{snapshot_dir}/HH-MM-SS.jpg`:',
    '',
    '```',
    f'[{example}] → {snapshot_dir}/{example_frame}',
    f'[{example_late}] → {snapshot_dir}/{late_frame}',
    '```',
    '',
    f'A frame can be up to {interval}s stale relative to the line, so when the',
    'screen *is* the point, read the next frame too — a click and its result',
    'usually straddle two frames.',
    '',
    'For an exact moment, or for full resolution (the grid is downscaled):',
    '',
    '```bash',
    f'{command} <path-to>/{meeting_name} --at {example}',
    '```',
    '',
  ]

  dead_air = duration - speech_end
  if dead_air > DEAD_AIR_THRESHOLD:
    out += [
      '## About this recording',
      '',
      f'> The video runs {format_duration(dead_air)} past the last word — dead air on an',
      f'> empty room. Frames after `{snapshot_name(speech_end, interval)}` are blank, which is',
      '> the recording, not a broken extraction.',
      '',
    ]

  out += [
    '## Regenerating, and adding a new meeting',
    '',
    f'`{video_name}` and `{snapshot_dir}/` are large and both regenerable, so they are',
    'worth keeping **out of git** — a fresh clone then has the transcripts but no',
    'frames. Rebuild them:',
    '',
    '```bash',
    f'{command} <path-to>/{meeting_name}',
    '```',
    '',
    'The same command sets up a *new* meeting: drop the video and its captions into a',
    'new folder, point the script at it, and it writes `transcript.md`, a copy of this',
    'README, and the frame grid. Re-runs skip frames that already exist, and leave an',
    'edited README alone (`--force` to overwrite).',
    '',
    f'Frames are capped at {width}px wide because that is where shared-screen text',
    'measured legible — UI labels, body prose and chat read cleanly at this width and',
    'not at 640px. Wider frames were tested and read back no better, so the grid stays',
    'small; reach for `--at` when a specific detail actually matters.',
  ]
  return '\n'.join(out).rstrip() + '\n'


def seed_readme(path: Path, content: str, *, force: bool) -> bool:
  """Write the README unless one is already there. Returns True if written.

  Unlike `transcript.md`, which is derived data and always regenerated, the
  README is prose someone may annotate with meeting-specific context -- a
  re-run must not silently eat those edits.
  """
  if path.exists() and not force:
    return False
  path.write_text(content, encoding='utf-8')
  return True


def _require_tool(name: str) -> None:
  if shutil.which(name) is None:
    sys.exit(f'error: {name} not found on PATH. Install it with `brew install ffmpeg`.')


def probe_video(video: Path) -> tuple[float, int]:
  """Return the video's `(duration_seconds, width_px)` via ffprobe."""
  _require_tool('ffprobe')
  result = subprocess.run(
    [
      'ffprobe',
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      str(video),
    ],
    capture_output=True,
    text=True,
    check=False,
  )
  if result.returncode != 0:
    sys.exit(f'error: ffprobe failed on {video}:\n{result.stderr.strip()}')
  values = [line for line in result.stdout.split() if line]
  if len(values) < 2:
    sys.exit(f'error: could not read duration/width from {video}')
  return float(values[1]), int(values[0])


def extract_frame(
  video: Path, seconds: float, out_path: Path, *, scale_width: int | None, quality: int
) -> bool:
  """Extract the single frame at `seconds`. Returns False if ffmpeg failed."""
  # `-ss` before `-i` seeks on the input (fast, and accurate since ffmpeg 2.1),
  # so the frame written is the one at `seconds` -- which is what names the file.
  cmd = [
    'ffmpeg',
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    f'{seconds:.3f}',
    '-i',
    str(video),
    '-frames:v',
    '1',
    '-q:v',
    str(quality),
  ]
  if scale_width is not None:
    cmd += ['-vf', f'scale={scale_width}:-2']
  cmd += ['-y', str(out_path)]
  result = subprocess.run(cmd, capture_output=True, text=True, check=False)
  if result.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
    print(f'  ! {out_path.name} failed: {result.stderr.strip()[:200]}', file=sys.stderr)
    return False
  return True


def discover_inputs(folder: Path) -> tuple[Path, Path | None]:
  """Find the video and transcript in a meeting folder (largest wins if several).

  The transcript is optional here, unlike the video: a recording with no caption
  export can still be transcribed locally (see transcribe_recording.py), so the
  caller decides whether a missing one is fatal.
  """
  if not folder.is_dir():
    sys.exit(f'error: not a directory: {folder}')

  def pick(suffixes: tuple[str, ...]) -> Path | None:
    # Top level only, so previously extracted snapshots are never candidates.
    found = [p for p in sorted(folder.iterdir()) if p.is_file() and p.suffix.lower() in suffixes]
    if not found:
      return None
    return max(found, key=lambda p: p.stat().st_size)

  video = pick(VIDEO_SUFFIXES)
  if video is None:
    sys.exit(f'error: no video found in {folder} (looked for {", ".join(VIDEO_SUFFIXES)})')
  return video, pick(TRANSCRIPT_SUFFIXES)


def transcribe_locally(folder: Path, video: Path, *, extra_args: list[str]) -> Path:
  """Shell out to transcribe_recording.py, then re-discover the .vtt it wrote.

  Kept as a subprocess rather than an import because that script optionally pulls
  in torch/pyannote, and this one is deliberately stdlib-only. Running it under
  `uv` when available means the heavy deps are fetched on demand instead of being
  a hard requirement of the skill.
  """
  script = Path(__file__).resolve().parent / 'transcribe_recording.py'
  if not script.is_file():
    sys.exit(f'error: {script.name} is missing from the skill directory')

  diarizing = '--no-diarize' not in extra_args
  if diarizing and shutil.which('uv'):
    # `uv run <script>` reads that script's PEP 723 header, so the pinned torch /
    # pyannote set is resolved there rather than duplicated in this command.
    command = ['uv', 'run', str(script)]
  else:
    command = [sys.executable, str(script)]
  # Pass the resolved video, not the folder: both scripts pick "the" media out of a
  # directory by their own rules, and a folder holding more than one would let them
  # disagree -- producing a transcript of a different recording than the frames.
  command += [str(video), *extra_args]

  print(f'no transcript found in {folder.name}; transcribing {video.name} locally', file=sys.stderr)
  print('  ' + ' '.join(command), file=sys.stderr)
  if subprocess.run(command).returncode != 0:
    sys.exit('error: local transcription failed (see above)')

  _, transcript = discover_inputs(folder)
  if transcript is None:
    sys.exit('error: transcription reported success but wrote no .vtt')
  return transcript


def no_transcript_error(folder: Path) -> str:
  """The message for a recording with no captions and no --transcribe."""
  script = Path(__file__).resolve().parent / 'transcribe_recording.py'
  return (
    f'error: no transcript found in {folder} '
    f'(looked for {", ".join(TRANSCRIPT_SUFFIXES)})\n'
    '\n'
    '  A caption export is much better than a machine transcript: it carries real\n'
    '  speaker names. Try the platform first -- Teams, Zoom and Meet all export one.\n'
    '\n'
    '  Otherwise transcribe locally (nothing leaves this machine):\n'
    f'    python3 {script} {folder}\n'
    '  or let this script chain it for you:\n'
    f'    python3 {Path(__file__).resolve()} {folder} --transcribe'
  )


def main() -> None:
  parser = argparse.ArgumentParser(
    description='Extract timestamp-named frames from a meeting recording and '
    'render its transcript as markdown, so a transcript line can be traced to '
    'what was on screen.',
    formatter_class=argparse.RawDescriptionHelpFormatter,
    epilog=__doc__,
  )
  parser.add_argument('meeting_dir', type=Path, help='folder holding the video + captions')
  parser.add_argument(
    '--interval',
    type=int,
    default=DEFAULT_INTERVAL,
    help=f'seconds between snapshots (default {DEFAULT_INTERVAL})',
  )
  parser.add_argument(
    '--width',
    type=int,
    default=DEFAULT_WIDTH,
    help=f'snapshot width in px; never upscales (default {DEFAULT_WIDTH})',
  )
  parser.add_argument(
    '--quality',
    type=int,
    default=DEFAULT_QUALITY,
    help=f'ffmpeg JPEG -q:v, 2=best 31=worst (default {DEFAULT_QUALITY})',
  )
  parser.add_argument('--jobs', type=int, default=8, help='parallel ffmpeg calls')
  parser.add_argument('--start', default='0', help='first timestamp to sample')
  parser.add_argument('--end', default=None, help='last timestamp to sample')
  parser.add_argument(
    '--at',
    default=None,
    help='extract one full-resolution frame at this timestamp and exit',
  )
  parser.add_argument('--force', action='store_true', help='re-extract existing frames')
  parser.add_argument(
    '--transcript-only',
    action='store_true',
    help='re-render the markdown transcript without touching frames',
  )
  transcribe = parser.add_argument_group(
    'local transcription',
    'For a recording with no caption export. Runs whisper.cpp + pyannote on this '
    'machine via transcribe_recording.py; nothing is uploaded.',
  )
  transcribe.add_argument(
    '--transcribe',
    action='store_true',
    help='if no captions are found, transcribe the audio locally instead of failing',
  )
  transcribe.add_argument(
    '--no-diarize',
    action='store_true',
    help='transcribe without speaker labels (no pyannote/torch); every turn unattributed',
  )
  transcribe.add_argument(
    '--speakers', type=int, help='tell diarization the exact number of speakers, if known'
  )
  transcribe.add_argument(
    '--whisper-model', type=Path, help='ggml Whisper model to transcribe with (.bin)'
  )
  transcribe.add_argument(
    '--language', default=None, help="spoken language for transcription, or 'auto'"
  )
  args = parser.parse_args()

  folder = args.meeting_dir.resolve()
  video, transcript = discover_inputs(folder)
  snapshot_dir = folder / SNAPSHOT_DIRNAME

  # `--at` only pulls one frame, so it runs happily on a recording with no
  # captions at all -- check for a transcript after this branch, not before.
  if args.at is not None:
    _require_tool('ffmpeg')
    seconds = parse_timestamp(args.at)
    snapshot_dir.mkdir(exist_ok=True)
    out = snapshot_dir / ('exact-' + format_timestamp(seconds).replace(':', '-') + '.jpg')
    if not extract_frame(video, seconds, out, scale_width=None, quality=2):
      sys.exit(1)
    print(out)
    return

  if transcript is None:
    if not args.transcribe:
      sys.exit(no_transcript_error(folder))
    passthrough: list[str] = []
    if args.no_diarize:
      passthrough.append('--no-diarize')
    if args.speakers:
      passthrough += ['--speakers', str(args.speakers)]
    if args.whisper_model:
      passthrough += ['--model', str(args.whisper_model)]
    if args.language:
      passthrough += ['--language', args.language]
    transcript = transcribe_locally(folder, video, extra_args=passthrough)

  duration, source_width = probe_video(video)
  cues = parse_vtt(transcript.read_text(encoding='utf-8', errors='replace'))
  turns = merge_turns(cues)
  if not cues:
    print(f'warning: no cues parsed from {transcript.name}', file=sys.stderr)

  out_md = folder / 'transcript.md'
  out_md.write_text(
    render_transcript_md(
      turns,
      meeting_name=folder.name,
      video_name=video.name,
      transcript_name=transcript.name,
      snapshot_dir=SNAPSHOT_DIRNAME,
      duration=duration,
      interval=args.interval,
      width=min(args.width, source_width),
      cue_count=len(cues),
      command=script_command(),
    ),
    encoding='utf-8',
  )
  print(f'{video.name}: {format_duration(duration)}, {source_width}px wide')
  print(f'{transcript.name}: {len(cues)} cues → {len(turns)} turns')
  print(f'wrote {out_md.relative_to(folder)}')

  start = parse_timestamp(args.start)
  end = parse_timestamp(args.end) if args.end else duration
  times = frame_times(start, min(end, duration), args.interval)

  # Seeded from the frame plan, not the directory, so the count is right even
  # under --transcript-only (nothing extracted yet) and on a fresh clone.
  readme = folder / 'README.md'
  wrote_readme = seed_readme(
    readme,
    render_readme_md(
      turns,
      meeting_name=folder.name,
      video_name=video.name,
      transcript_name=transcript.name,
      snapshot_dir=SNAPSHOT_DIRNAME,
      duration=duration,
      interval=args.interval,
      width=min(args.width, source_width),
      frame_count=len(times),
      command=script_command(),
    ),
    force=args.force,
  )
  print(f'wrote {readme.name}' if wrote_readme else f'{readme.name} exists, left as-is')

  if args.transcript_only:
    return

  _require_tool('ffmpeg')
  snapshot_dir.mkdir(exist_ok=True)
  scale_width = args.width if source_width > args.width else None

  pending = [
    (t, snapshot_dir / snapshot_name(t, args.interval))
    for t in times
    if args.force
    or not (snapshot_dir / snapshot_name(t, args.interval)).exists()
    or (snapshot_dir / snapshot_name(t, args.interval)).stat().st_size == 0
  ]
  skipped = len(times) - len(pending)
  print(
    f'extracting {len(pending)} frames every {args.interval}s'
    + (f' ({skipped} already present)' if skipped else '')
  )

  failures = 0
  with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
    futures = {
      pool.submit(
        extract_frame, video, t, path, scale_width=scale_width, quality=args.quality
      ): path
      for t, path in pending
    }
    # Consume in submission order for a stable progress readout.
    for done, future in enumerate(futures, start=1):
      if not future.result():
        failures += 1
      if done % 50 == 0 or done == len(pending):
        print(f'  {done}/{len(pending)} frames')

  # `[0-9]*` counts the interval grid only, skipping any `exact-*` one-offs.
  grid = list(snapshot_dir.glob('[0-9]*.jpg'))
  total = len(grid)
  size_mb = sum(p.stat().st_size for p in grid) / 1e6
  print(f'{SNAPSHOT_DIRNAME}/: {total} frames, {size_mb:.0f} MB')
  if failures:
    sys.exit(f'error: {failures} frame(s) failed to extract')


if __name__ == '__main__':
  main()
