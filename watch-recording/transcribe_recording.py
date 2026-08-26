#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10,<3.14"
# dependencies = [
#   # Pinned to the tested major. 3.x is not merely older: it calls
#   # torchaudio.AudioMetaData, removed in the torchaudio pinned below, so a
#   # resolver that picked it would fail at import.
#   "pyannote.audio>=4,<5",
#   "numpy",
#   # torch and torchaudio must move as a pair: torchaudio ships a compiled
#   # extension linked against one torch ABI, and pyannote imports torchaudio at
#   # import time, so a mismatch is an OSError on a .dylib rather than anything
#   # legible. Left unpinned, the resolver happily takes the newest torchaudio
#   # against an older torch. Bump both together.
#   "torch==2.9.*",
#   "torchaudio==2.9.*",
#   # transformers (via pyannote) still requires the pre-1.0 hub API.
#   "huggingface-hub<1.0",
# ]
# ///
"""Transcribe a recording locally, with speaker labels, into a `.vtt`.

The fallback for when a recording has no caption export. Everything runs on this
machine -- no audio leaves it -- and the output is a WebVTT file with `<v Speaker>`
tags, which is exactly what setup_meeting_snapshots.py already consumes. So a
machine-transcribed recording flows through the same pipeline as a Teams export.

Two models, doing two different jobs:

  * whisper.cpp (`whisper-cli`) turns audio into timestamped words. Run with
    `-ml 1 -sow`, it emits one segment per *word*, which is the resolution the
    speaker merge below needs.
  * pyannote.audio answers "who is speaking when", which Whisper cannot: it has
    no notion of speakers at all. Without this step every turn lands
    `(unattributed)` and the attribution analysis is impossible.

Word-level timings matter because a natural Whisper segment happily spans a
speaker change ("...so we shipped it -- wait, did we?" is one segment, two
people). Assigning speakers per word and *then* grouping means a cue boundary
lands where the speaker actually changed.

Usage:
    uv run transcribe_recording.py <recording-dir>
    python3 transcribe_recording.py <recording-dir> --no-diarize

The dependency set lives in the PEP 723 block above, so `uv run` resolves it with
no --with chain to remember. `--no-diarize` skips pyannote (and the speaker labels
with it), leaving a stdlib-only path needing nothing but ffmpeg and whisper-cli.

Requires: ffmpeg + whisper-cli on PATH, a ggml Whisper model (see MODEL_SEARCH
below -- it looks for one you already have before offering to download), and for
diarization a HuggingFace token with the gated pyannote models accepted.
"""

from __future__ import annotations

import argparse
import json
import os
import html
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path

VIDEO_SUFFIXES = ('.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi')
AUDIO_SUFFIXES = ('.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg')

# Must stay in step with setup_meeting_snapshots.py: these are what that script will
# discover as "the" transcript, and so what this one must not quietly compete with.
TRANSCRIPT_SUFFIXES = ('.vtt', '.srt')

# whisper.cpp wants 16 kHz mono 16-bit PCM and will not resample for us.
WHISPER_SAMPLE_RATE = 16000

# Suffix of the decoded audio `--keep-wav` leaves next to the media. Named here so
# discovery can skip it rather than transcribing its own output on a re-run.
WAV_SIDECAR_SUFFIX = '.16k.wav'

# Where a ggml model might already be sitting. Checked in order, and the first
# hit wins, so an explicit --model or the env var always beats a discovered one.
# The OpenSuperWhisper path is here because that app ships a full large-v3-turbo
# and many Macs already have it -- no reason to download a second 1.5 GB copy.
MODEL_SEARCH = (
  Path.home() / 'Library/Application Support/ru.starmel.OpenSuperWhisper/whisper-models',
  Path('/opt/homebrew/share/whisper-cpp'),
  Path('/usr/local/share/whisper-cpp'),
  Path.home() / '.cache/whisper-cpp',
  Path.home() / '.local/share/whisper-cpp',
)

# Preference order among discovered models: accuracy first. This skill's output is
# direct quotes attributed to real people, so a misheard word becomes a misquote in
# a report -- the cheapest tier that "works" is not good enough.
MODEL_PREFERENCE = (
  'large-v3-turbo',
  'large-v3',
  'large-v2',
  'large',
  'medium.en',
  'medium',
  'small.en',
  'small',
  'base.en',
  'base',
)

DEFAULT_DOWNLOAD = 'large-v3-turbo'
MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin'
DOWNLOAD_DIR = Path.home() / '.cache/whisper-cpp'

# A `for-tests-*` model is a few hundred KB of stub weights that brew ships for its
# own test suite. It loads and produces garbage, which is worse than not running.
STUB_PREFIX = 'for-tests-'

# Cue boundaries. Grouping breaks on a speaker change, a pause longer than this,
# or a cue that has simply run long -- mirroring how real caption exports wrap.
CUE_MAX_GAP = 1.0
CUE_MAX_DURATION = 12.0

HF_TOKEN_FILE = Path.home() / '.cache/huggingface/token'
DIARIZATION_MODEL = 'pyannote/speaker-diarization-3.1'

# Loading one pipeline pulls several repos, and which ones changed between
# pyannote majors: 3.x resolves its embeddings from wespeaker-*, while 4.x reaches
# into speaker-diarization-community-1 for xvec_transform.npz. Each is separately
# gated, so a token that opens the pipeline's own repo can still be refused
# downstream. Listed here only as a fallback for when the error names none.
GATED_REPOS = (
  'pyannote/speaker-diarization-3.1',
  'pyannote/segmentation-3.0',
  'pyannote/speaker-diarization-community-1',
)
REPO_RE = re.compile(r'\b(pyannote/[A-Za-z0-9._-]+)')


@dataclass
class Word:
  """One word with its Whisper timings, and the speaker we later attribute it to."""

  start: float
  end: float
  text: str
  speaker: str | None = None

  @property
  def mid(self) -> float:
    """The midpoint, which is what we look up in the diarization timeline.

    Word edges are the least reliable part of Whisper's timings and often bleed
    into the neighbouring speaker's turn; the midpoint sits well inside.
    """
    return (self.start + self.end) / 2


@dataclass
class SpeakerTurn:
  """A stretch of audio pyannote attributes to one speaker."""

  start: float
  end: float
  speaker: str


def require_tool(name: str, install_hint: str) -> None:
  if shutil.which(name) is None:
    sys.exit(f'error: {name} not found on PATH. Install it with `{install_hint}`.')


def discover_video(target: Path) -> Path:
  """Accept a media file, or a folder holding one.

  Video wins over audio outright rather than on size, because the decoded audio
  sidecar this script can leave behind (`--keep-wav`) is several times larger than
  the compressed video it came from -- so "largest file wins" would transcribe our
  own intermediate on the second run.
  """
  if target.is_file():
    return target
  if not target.is_dir():
    sys.exit(f'error: no such file or directory: {target}')

  def candidates(suffixes: tuple[str, ...]) -> list[Path]:
    return [
      p
      for p in sorted(target.iterdir())
      if p.is_file() and p.suffix.lower() in suffixes and not p.name.endswith(WAV_SIDECAR_SUFFIX)
    ]

  for suffixes in (VIDEO_SUFFIXES, AUDIO_SUFFIXES):
    found = candidates(suffixes)
    if found:
      return max(found, key=lambda p: p.stat().st_size)
  sys.exit(
    f'error: no media found in {target} '
    f'(looked for {", ".join(VIDEO_SUFFIXES + AUDIO_SUFFIXES)})'
  )


def find_model(explicit: Path | None) -> Path:
  """Resolve the ggml model: explicit flag, then env var, then the search path.

  Downloading is the last resort and always announced, because it is 1.5 GB.
  """
  if explicit is not None:
    if not explicit.is_file():
      sys.exit(f'error: model not found: {explicit}')
    return explicit

  env = os.environ.get('WHISPER_CPP_MODEL')
  if env:
    path = Path(env).expanduser()
    if not path.is_file():
      sys.exit(f'error: WHISPER_CPP_MODEL points at a missing file: {path}')
    return path

  found: dict[str, Path] = {}
  for directory in MODEL_SEARCH:
    if not directory.is_dir():
      continue
    for candidate in sorted(directory.glob('ggml-*.bin')):
      if candidate.name.startswith(STUB_PREFIX) or STUB_PREFIX in candidate.name:
        continue
      name = candidate.stem.removeprefix('ggml-')
      found.setdefault(name, candidate)

  # Match each tier by prefix, not equality, so a quantized or fine-tuned build of a
  # good tier (`large-v3-turbo-q5_0`) ranks with that tier instead of falling past
  # every entry and losing to an exact match on a worse one (`small`). Tiers are
  # tested in order and the list puts longer names first, so `large-v3-turbo` is
  # considered before `large-v3` and cannot be swallowed by it.
  for tier in MODEL_PREFERENCE:
    matches = [
      path for name, path in found.items() if name == tier or name.startswith(f'{tier}-')
    ]
    if matches:
      # Within one tier, the largest file is the least quantized, so the most accurate.
      return max(matches, key=lambda p: p.stat().st_size)
  # An unrecognized name is still a real model; prefer the largest as a stand-in for
  # the most capable.
  if found:
    return max(found.values(), key=lambda p: p.stat().st_size)

  return download_model(DEFAULT_DOWNLOAD)


def download_model(name: str) -> Path:
  """Fetch a ggml model from the whisper.cpp model repo, resumably enough."""
  DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
  dest = DOWNLOAD_DIR / f'ggml-{name}.bin'
  if dest.is_file():
    return dest
  url = MODEL_URL.format(name=name)
  print(f'no local Whisper model found; downloading {name} to {dest}', file=sys.stderr)
  print(f'  {url}', file=sys.stderr)
  # Stage in a temp file so an interrupted download never looks like a valid model.
  partial = dest.with_suffix('.bin.partial')
  try:
    with urllib.request.urlopen(url) as response, partial.open('wb') as out:
      total = int(response.headers.get('Content-Length') or 0)
      done = 0
      while chunk := response.read(1 << 20):
        out.write(chunk)
        done += len(chunk)
        if total:
          print(f'\r  {done / 1e6:.0f}/{total / 1e6:.0f} MB', end='', file=sys.stderr)
      print('', file=sys.stderr)
  except Exception as exc:  # noqa: BLE001 - any failure here should be fatal and legible
    partial.unlink(missing_ok=True)
    sys.exit(f'error: model download failed: {exc}')
  partial.rename(dest)
  return dest


def extract_audio(video: Path, wav: Path) -> None:
  """Decode to the 16 kHz mono PCM that whisper.cpp requires."""
  require_tool('ffmpeg', 'brew install ffmpeg')
  result = subprocess.run(
    [
      'ffmpeg',
      '-nostdin',
      '-y',
      '-i',
      str(video),
      '-vn',
      '-ac',
      '1',
      '-ar',
      str(WHISPER_SAMPLE_RATE),
      '-c:a',
      'pcm_s16le',
      str(wav),
    ],
    capture_output=True,
    text=True,
  )
  if result.returncode != 0 or not wav.is_file():
    sys.exit(f'error: ffmpeg could not extract audio from {video.name}\n{result.stderr[-800:]}')


def run_whisper(wav: Path, model: Path, language: str, threads: int | None) -> list[Word]:
  """Transcribe to word-level segments via whisper-cli's JSON output."""
  require_tool('whisper-cli', 'brew install whisper-cpp')
  with tempfile.TemporaryDirectory() as tmp:
    stem = Path(tmp) / 'words'
    command = [
      'whisper-cli',
      '-m',
      str(model),
      '-l',
      language,
      # One segment per word: the resolution the speaker merge needs.
      '-ml',
      '1',
      '-sow',
      '-oj',
      '-of',
      str(stem),
      '-pp',
      str(wav),
    ]
    if threads:
      command[1:1] = ['-t', str(threads)]
    print(f'transcribing with {model.name} (this takes a while for a long recording)...', file=sys.stderr)
    result = subprocess.run(command, text=True)
    payload = stem.with_suffix('.json')
    if result.returncode != 0 or not payload.is_file():
      sys.exit(f'error: whisper-cli failed (exit {result.returncode})')
    data = json.loads(payload.read_text(encoding='utf-8'))

  words: list[Word] = []
  for segment in data.get('transcription', []):
    text = segment.get('text', '').strip()
    if not text:
      continue
    offsets = segment.get('offsets') or {}
    start, end = offsets.get('from'), offsets.get('to')
    if start is None or end is None:
      continue
    words.append(Word(start=start / 1000, end=end / 1000, text=text))
  return words


def load_waveform(wav: Path):
  """Read our own 16 kHz mono PCM into a torch tensor, shape (1, samples).

  Handing pyannote a pre-loaded waveform instead of a path deliberately skips its
  file-decoding stack (torchaudio/torchcodec), which is a compiled extension whose
  ABI has to match torch exactly and fails with an unreadable .dylib error when it
  does not. We wrote this WAV with ffmpeg, so its format is known and `wave` from
  the stdlib is enough to read it.
  """
  import numpy as np
  import torch

  with wave.open(str(wav), 'rb') as handle:
    if handle.getsampwidth() != 2:
      sys.exit(f'error: expected 16-bit PCM, got {handle.getsampwidth() * 8}-bit')
    channels = handle.getnchannels()
    rate = handle.getframerate()
    raw = handle.readframes(handle.getnframes())

  samples = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
  if channels > 1:
    # Shouldn't happen -- extract_audio forces mono -- but averaging is the right
    # thing if some other WAV is ever passed in.
    samples = samples.reshape(-1, channels).mean(axis=1)
  return torch.from_numpy(samples.copy()).unsqueeze(0), rate


def load_pipeline(token: str):
  """Build the pyannote pipeline, tolerating both of its auth keyword names.

  pyannote.audio 4.x renamed `use_auth_token` to `token`. Supporting both means
  the skill is not pinned to whichever major happens to resolve.
  """
  from pyannote.audio import Pipeline

  errors: list[str] = []
  for keyword in ('token', 'use_auth_token'):
    try:
      pipeline = Pipeline.from_pretrained(DIARIZATION_MODEL, **{keyword: token})
    except TypeError as exc:
      # Wrong keyword for this version: try the other before giving up.
      errors.append(f'{keyword}: {exc}')
      continue
    except Exception as exc:  # noqa: BLE001 - re-raised below with guidance
      raise RuntimeError(str(exc)) from exc
    if pipeline is not None:
      return pipeline
    errors.append(f'{keyword}: from_pretrained returned None')
  raise RuntimeError('; '.join(errors))


def gate_help(message: str = '') -> str:
  """Instructions for an unaccepted gated model, naming the repos actually refused.

  Worth the parsing: a valid token is not sufficient, and the distinction is
  invisible from the API -- repo *metadata* reads fine without access, so only
  fetching a file reveals the conditions were never accepted. And the repo that
  gets refused is often not the one you asked for, because loading a pipeline
  pulls its segmentation and embedding models from separate gated repos.
  """
  named = [repo for repo in dict.fromkeys(REPO_RE.findall(message)) if repo]
  repos = named or list(GATED_REPOS)
  listed = '\n'.join(f'    https://huggingface.co/{repo}' for repo in repos)
  return (
    '  These are gated models, and a valid token is not enough on its own -- the\n'
    '  conditions have to be accepted by your account. While logged in, open:\n'
    f'{listed}\n'
    '  accept the conditions on each, then re-run. They are free and instant.\n'
    '  Note that one pipeline pulls several repos, so a second run can be refused\n'
    '  by a different one; accept whichever it names.\n'
    '  Or pass --no-diarize to transcribe now without speaker labels.'
  )


def extract_turns(output) -> list[SpeakerTurn]:
  """Pull speaker turns out of whatever shape the pipeline returned.

  pyannote 4.x returns a `DiarizeOutput` holding two Annotations; 3.x returned a
  bare Annotation. Prefer `exclusive_speaker_diarization`, which pyannote
  documents as "adapted to downstream transcription" because it has no
  overlapping turns -- and a word can only be given to one speaker, so a
  timeline where two turns cover the same instant makes the choice arbitrary.
  """
  annotation = getattr(output, 'exclusive_speaker_diarization', None)
  if annotation is None:
    annotation = getattr(output, 'speaker_diarization', None)
  if annotation is None:
    annotation = output
  if not hasattr(annotation, 'itertracks'):
    sys.exit(
      f'error: unexpected diarization result of type {type(output).__name__}.\n'
      '  This usually means pyannote changed its return shape. Re-run under uv so\n'
      "  the version pinned in this script's PEP 723 header is used."
    )
  turns = [
    SpeakerTurn(start=segment.start, end=segment.end, speaker=label)
    for segment, _, label in annotation.itertracks(yield_label=True)
  ]
  turns.sort(key=lambda t: t.start)
  return turns


def run_diarization(
  wav: Path,
  *,
  speakers: int | None,
  min_speakers: int | None,
  max_speakers: int | None,
) -> list[SpeakerTurn]:
  """Ask pyannote who is speaking when.

  Imported lazily so `--no-diarize` needs neither torch nor pyannote installed.
  """
  try:
    import torch
  except Exception:  # noqa: BLE001 - a broken wheel raises more than ImportError
    sys.exit(
      'error: diarization needs pyannote.audio and torch, which are declared in this\n'
      "  script's PEP 723 header. Run it under uv so they are fetched on demand:\n"
      '    uv run transcribe_recording.py <dir>\n'
      '  Or pass --no-diarize to transcribe without speaker labels.'
    )
  try:
    import pyannote.audio  # noqa: F401
  except Exception as exc:  # noqa: BLE001 - see below
    # Deliberately broad. A version-mismatched install does not fail with
    # ImportError: pyannote 3.x against a modern torchaudio raises AttributeError
    # on `torchaudio.AudioMetaData` at import time, and a torch/torchaudio ABI
    # mismatch raises OSError on a .dylib. Letting any of those through as a
    # traceback tells the user nothing about what to do.
    sys.exit(
      f'error: torch is installed but pyannote.audio is not usable:\n'
      f'    {type(exc).__name__}: {exc}\n'
      '  This is almost always a version mismatch. Run under uv so the pinned set\n'
      "  in this script's PEP 723 header is used, rather than whatever is on PATH:\n"
      '    uv run transcribe_recording.py <dir>\n'
      '  Or pass --no-diarize to transcribe without speaker labels.'
    )

  token = os.environ.get('HF_TOKEN') or os.environ.get('HUGGING_FACE_HUB_TOKEN')
  if not token and HF_TOKEN_FILE.is_file():
    token = HF_TOKEN_FILE.read_text(encoding='utf-8').strip()
  if not token:
    sys.exit(
      'error: no HuggingFace token found.\n'
      '  Run `hf auth login` (or set HF_TOKEN), then accept the model conditions:\n'
      + gate_help()
    )

  print(f'diarizing with {DIARIZATION_MODEL}...', file=sys.stderr)
  try:
    pipeline = load_pipeline(token)
  except RuntimeError as exc:
    message = str(exc)
    # A 403 here means the token works but the conditions were never accepted --
    # by far the most common way this fails, and the least self-explanatory.
    gated = '403' in message or 'gated' in message.lower() or 'authorized' in message.lower()
    if gated or 'Could not download' in message:
      refused = REPO_RE.findall(message)
      what = refused[0] if refused else DIARIZATION_MODEL
      sys.exit(f'error: access to {what} was refused.\n{gate_help(message)}')
    sys.exit(f'error: could not load {DIARIZATION_MODEL}: {message}\n{gate_help(message)}')

  # Apple Silicon: MPS is markedly faster than CPU here, but some pyannote ops
  # still fall back, so a failure to move must not be fatal.
  if torch.backends.mps.is_available():
    try:
      pipeline.to(torch.device('mps'))
    except Exception as exc:  # noqa: BLE001 - CPU is a correct, if slower, fallback
      print(f'note: staying on CPU ({exc})', file=sys.stderr)

  constraints = {}
  if speakers:
    constraints['num_speakers'] = speakers
  else:
    if min_speakers:
      constraints['min_speakers'] = min_speakers
    if max_speakers:
      constraints['max_speakers'] = max_speakers

  waveform, rate = load_waveform(wav)
  return extract_turns(pipeline({'waveform': waveform, 'sample_rate': rate}, **constraints))


def attribute_words(words: list[Word], turns: list[SpeakerTurn]) -> None:
  """Label each word with a speaker, in place.

  A word's midpoint usually lands inside exactly one turn. When it lands in a
  gap -- pyannote leaves silence unlabelled -- fall back to the turn with the
  most overlap, and failing that the nearest one, so a word is only left
  unattributed when there is no diarization at all.
  """
  if not turns:
    return
  for word in words:
    mid = word.mid
    containing = next((t for t in turns if t.start <= mid <= t.end), None)
    if containing is not None:
      word.speaker = containing.speaker
      continue

    def overlap(turn: SpeakerTurn) -> float:
      return min(word.end, turn.end) - max(word.start, turn.start)

    best = max(turns, key=overlap)
    if overlap(best) > 0:
      word.speaker = best.speaker
      continue
    word.speaker = min(turns, key=lambda t: min(abs(t.start - mid), abs(t.end - mid))).speaker


def group_cues(words: list[Word]) -> list[tuple[float, float, str | None, str]]:
  """Collapse attributed words into cues, breaking where a caption export would."""
  cues: list[tuple[float, float, str | None, str]] = []
  start = end = 0.0
  speaker: str | None = None
  buffer: list[str] = []

  def flush() -> None:
    if buffer:
      cues.append((start, end, speaker, ' '.join(buffer)))

  for word in words:
    if not buffer:
      start, end, speaker, buffer = word.start, word.end, word.speaker, [word.text]
      continue
    changed = word.speaker != speaker
    gap = word.start - end
    too_long = word.end - start > CUE_MAX_DURATION
    if changed or gap > CUE_MAX_GAP or too_long:
      flush()
      start, end, speaker, buffer = word.start, word.end, word.speaker, [word.text]
      continue
    buffer.append(word.text)
    end = word.end
  flush()
  return cues


def format_vtt_time(seconds: float) -> str:
  """Seconds -> `HH:MM:SS.mmm`, the WebVTT cue-timing format."""
  if seconds < 0:
    seconds = 0.0
  total_ms = int(round(seconds * 1000))
  hours, rest = divmod(total_ms, 3_600_000)
  minutes, rest = divmod(rest, 60_000)
  secs, millis = divmod(rest, 1000)
  return f'{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}'


def render_vtt(cues: list[tuple[float, float, str | None, str]], *, source: str, model: str) -> str:
  """Write WebVTT with `<v Speaker>` tags, recording in a NOTE where this came from.

  The NOTE is not decoration. A reader -- human or agent -- needs to know these
  words came out of a model and may be misheard, and that any speaker label is a
  `SPEAKER_00`-style audio-clustering guess rather than a name from a platform
  export. Without that, every quote in the transcript reads as verbatim and
  attributed.
  """
  diarized = any(speaker for _, _, speaker, _ in cues)
  provenance = [
    f'Machine-generated by transcribe_recording.py from {source}.',
    f'Transcription: whisper.cpp / {model}.',
  ]
  if diarized:
    provenance.append(f'Speaker labels: {DIARIZATION_MODEL} -- audio-clustering guesses,')
    provenance.append('not names. Map them to people by reading the transcript.')
  else:
    provenance.append('No diarization: every turn is unattributed.')
  provenance.append('Words may be misheard; verify any quote against the audio before')
  provenance.append('attributing it to a person.')

  lines = ['WEBVTT', '', 'NOTE', *provenance, '']
  for index, (start, end, speaker, text) in enumerate(cues, start=1):
    lines.append(str(index))
    lines.append(f'{format_vtt_time(start)} --> {format_vtt_time(end)}')
    # Escape the *text* only, never the `<v ...>` tag we are emitting. Whisper can
    # transcribe spoken angle brackets ("use vector<int>"), and unescaped they read
    # back as a VTT tag and get stripped -- losing words from a transcript whose
    # whole purpose is quoting people accurately.
    body = html.escape(text, quote=False)
    lines.append(f'<v {speaker}>{body}' if speaker else body)
    lines.append('')
  return '\n'.join(lines)


def main() -> None:
  parser = argparse.ArgumentParser(
    description='Transcribe a recording locally with whisper.cpp and label speakers '
    'with pyannote, writing a .vtt that setup_meeting_snapshots.py can consume.'
  )
  parser.add_argument('target', type=Path, help='recording folder, or a media file')
  parser.add_argument('--model', type=Path, help='path to a ggml Whisper model (.bin)')
  parser.add_argument('--language', default='en', help="spoken language, or 'auto' (default: en)")
  parser.add_argument('--threads', type=int, help='threads for whisper.cpp (default: its own)')
  parser.add_argument(
    '--no-diarize',
    action='store_true',
    help='skip speaker labelling: no pyannote/torch needed, every turn unattributed',
  )
  parser.add_argument('--speakers', type=int, help='exact number of speakers, if known')
  parser.add_argument('--min-speakers', type=int, help='lower bound on speaker count')
  parser.add_argument('--max-speakers', type=int, help='upper bound on speaker count')
  parser.add_argument('-o', '--output', type=Path, help='output .vtt (default: next to the media)')
  parser.add_argument(
    '--force', action='store_true', help='overwrite an existing .vtt for this recording'
  )
  parser.add_argument('--keep-wav', action='store_true', help='keep the extracted 16 kHz wav')
  args = parser.parse_args()

  media = discover_video(args.target.expanduser().resolve())
  out_vtt = args.output or media.with_suffix('.vtt')

  # Never clobber a real caption export: it has true speaker names, which this
  # script cannot reproduce, so overwriting it is a strict downgrade.
  if out_vtt.exists() and not args.force:
    sys.exit(
      f'error: {out_vtt.name} already exists. Refusing to overwrite a transcript.\n'
      '  Pass --force if you really mean to replace it.'
    )

  # Nor sit *beside* one under a different name. setup_meeting_snapshots.py picks the
  # largest transcript in a folder, so adding `recording.vtt` next to an existing
  # `captions.vtt` can silently promote the machine transcript over the real export --
  # exactly backwards. Skipped when an explicit --output says where this should go.
  if not args.force and args.output is None:
    existing = [
      path
      for path in sorted(media.parent.iterdir())
      if path.is_file() and path.suffix.lower() in TRANSCRIPT_SUFFIXES
    ]
    if existing:
      names = ', '.join(path.name for path in existing)
      sys.exit(
        f'error: {media.parent} already has a transcript: {names}\n'
        '  That is very likely a real caption export, which carries real speaker\n'
        '  names this script cannot reproduce -- so transcribing would be a\n'
        '  downgrade, and the new file could win on size and be used instead.\n'
        '  Use that transcript, or pass --force / --output to override.'
      )

  # Check the hard prerequisites first: find_model can fall through to a 1.5 GB
  # download, and discovering only afterwards that whisper-cli is absent wastes it.
  require_tool('ffmpeg', 'brew install ffmpeg')
  require_tool('whisper-cli', 'brew install whisper-cpp')

  model = find_model(args.model)
  print(f'media: {media.name}', file=sys.stderr)
  print(f'model: {model}', file=sys.stderr)

  wav_target = media.with_suffix(WAV_SIDECAR_SUFFIX) if args.keep_wav else None
  with tempfile.TemporaryDirectory() as tmp:
    wav = wav_target or Path(tmp) / 'audio.wav'
    extract_audio(media, wav)
    words = run_whisper(wav, model, args.language, args.threads)
    if not words:
      sys.exit('error: transcription produced no words (is there any speech in this recording?)')

    if args.no_diarize:
      print('warning: --no-diarize, so every turn will be (unattributed).', file=sys.stderr)
      turns: list[SpeakerTurn] = []
    else:
      turns = run_diarization(
        wav,
        speakers=args.speakers,
        min_speakers=args.min_speakers,
        max_speakers=args.max_speakers,
      )
      if not turns:
        print('warning: diarization found no speaker turns; leaving cues unattributed.', file=sys.stderr)

  attribute_words(words, turns)
  cues = group_cues(words)
  out_vtt.write_text(render_vtt(cues, source=media.name, model=model.stem), encoding='utf-8')

  found = sorted({t.speaker for t in turns})
  print(f'{len(words)} words -> {len(cues)} cues', file=sys.stderr)
  print(f'speakers: {", ".join(found) if found else "none (unattributed)"}', file=sys.stderr)
  print(out_vtt)
  if found:
    print(
      'note: speaker labels are SPEAKER_NN, not names. Map them to people by reading '
      'the transcript (self-introductions, who is addressed) before attributing quotes.',
      file=sys.stderr,
    )


if __name__ == '__main__':
  main()
