"""Tests for the recording-snapshot environment (setup_meeting_snapshots.py).

Run them with `uv run --with pytest python -m pytest tests/` from the skill
directory, or with any environment that has pytest on it.

The workflow this supports: read a meeting's VTT transcript, and whenever a line
warrants seeing what was on screen, open the pre-extracted frame for that
timestamp. That only works if the timestamp -> filename mapping is exact, so the
mapping and the VTT parsing are pinned here.

Two real-world traits of Teams caption exports drove these cases:
  * the files are CRLF, and speaker names contain commas and parens
    ("CR01 Cedar (East, 3)"), so a naive split on either mangles them;
  * a cue's text is often wrapped across several lines mid-sentence, and
    speakers interleave (one speaker's run is broken up by a two-word
    interjection), so turns must merge by speaker *and* gap.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).parent.parent


def _load(name: str):
  """Import the script by path (the skill directory isn't a package)."""
  sys.path.insert(0, str(SCRIPTS))
  spec = importlib.util.spec_from_file_location(name, SCRIPTS / f'{name}.py')
  assert spec and spec.loader
  mod = importlib.util.module_from_spec(spec)
  # Must be registered before exec: @dataclass resolves annotations through
  # sys.modules[cls.__module__], which is None for an unregistered module.
  sys.modules[name] = mod
  spec.loader.exec_module(mod)
  return mod


mod = _load('setup_meeting_snapshots')


class TestParseTimestamp:
  def test_full_vtt_timestamp(self):
    assert mod.parse_timestamp('00:19:53.091') == pytest.approx(1193.091)

  def test_hours_carry(self):
    assert mod.parse_timestamp('01:01:01.500') == pytest.approx(3661.5)

  def test_no_hours_field(self):
    assert mod.parse_timestamp('19:53.091') == pytest.approx(1193.091)

  def test_no_millis(self):
    assert mod.parse_timestamp('00:19:53') == pytest.approx(1193.0)

  def test_bare_seconds(self):
    assert mod.parse_timestamp('90') == pytest.approx(90.0)

  def test_srt_comma_decimal(self):
    assert mod.parse_timestamp('00:19:53,091') == pytest.approx(1193.091)

  def test_rejects_garbage(self):
    with pytest.raises(ValueError):
      mod.parse_timestamp('not-a-time')


class TestFormatTimestamp:
  def test_zero(self):
    assert mod.format_timestamp(0) == '00:00:00'

  def test_truncates_not_rounds(self):
    """00:19:53.9 must stay in the :53 second, not jump to :54."""
    assert mod.format_timestamp(1193.9) == '00:19:53'

  def test_over_an_hour(self):
    assert mod.format_timestamp(3661) == '01:01:01'


class TestSnapshotName:
  def test_floors_to_interval(self):
    assert mod.snapshot_name(1193.091, 10) == '00-19-50.jpg'

  def test_exact_boundary_is_its_own_frame(self):
    assert mod.snapshot_name(1200.0, 10) == '00-20-00.jpg'

  def test_respects_other_intervals(self):
    assert mod.snapshot_name(1193.091, 30) == '00-19-30.jpg'

  def test_sorts_chronologically_as_text(self):
    names = [mod.snapshot_name(t, 10) for t in (0, 600, 3600, 4320)]
    assert names == sorted(names)
    assert names[0] == '00-00-00.jpg'
    assert names[-1] == '01-12-00.jpg'


VTT = (
  'WEBVTT\r\n'
  '\r\n'
  'NOTE this block is metadata and must be skipped\r\n'
  '\r\n'
  'abc/8-0\r\n'
  '00:00:03.469 --> 00:00:03.549\r\n'
  '<v Dana Ruiz>The.</v>\r\n'
  '\r\n'
  'abc/14-0\r\n'
  '00:00:05.589 --> 00:00:11.075 align:start position:0%\r\n'
  '<v CR01 Cedar (East, 3)>Awesome, thank you. Yeah,\r\n'
  'and then my e-mail you after to get a</v>\r\n'
  '\r\n'
  'abc/14-1\r\n'
  '00:00:11.075 --> 00:00:12.189\r\n'
  '<v CR01 Cedar (East, 3)>copy of that.</v>\r\n'
  '\r\n'
  'abc/15-0\r\n'
  '00:00:12.829 --> 00:00:13.229\r\n'
  '<v.loud Priya Menon>Sounds good.</v>\r\n'
  '\r\n'
  'abc/16-0\r\n'
  '00:10:00.000 --> 00:10:01.000\r\n'
  'no voice tag here\r\n'
)


class TestParseVtt:
  def test_finds_every_cue_and_skips_note_blocks(self):
    cues = mod.parse_vtt(VTT)
    assert len(cues) == 5

  def test_strips_carriage_returns_from_text(self):
    for cue in mod.parse_vtt(VTT):
      assert '\r' not in cue.text
      assert cue.speaker is None or '\r' not in cue.speaker

  def test_speaker_name_with_comma_and_parens_survives(self):
    assert mod.parse_vtt(VTT)[1].speaker == 'CR01 Cedar (East, 3)'

  def test_joins_wrapped_cue_text_into_one_line(self):
    cue = mod.parse_vtt(VTT)[1]
    assert cue.text == 'Awesome, thank you. Yeah, and then my e-mail you after to get a'

  def test_tolerates_cue_settings_after_end_timestamp(self):
    cue = mod.parse_vtt(VTT)[1]
    assert cue.start == pytest.approx(5.589)
    assert cue.end == pytest.approx(11.075)

  def test_strips_voice_span_classes(self):
    assert mod.parse_vtt(VTT)[3].speaker == 'Priya Menon'

  def test_cue_without_voice_tag_has_no_speaker(self):
    cue = mod.parse_vtt(VTT)[4]
    assert cue.speaker is None
    assert cue.text == 'no voice tag here'


class TestEntityUnescaping:
  """WebVTT escapes `&`, `<`, `>` in cue text, and real Teams exports do it.

  Found while auditing the generated-VTT path: the reader never unescaped, so a
  real export's `&amp;` reached transcript.md verbatim.
  """

  def test_ampersand_entity_is_decoded(self):
    vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<v Alice>Q&amp;A time\n'
    assert mod.parse_vtt(vtt)[0].text == 'Q&A time'

  def test_escaped_angle_brackets_survive_the_tag_strip(self):
    """Unescaping before stripping tags would let the tag regex eat the result."""
    vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<v Bob>the &lt;filter&gt; panel\n'
    cue = mod.parse_vtt(vtt)[0]
    assert cue.speaker == 'Bob'
    assert cue.text == 'the <filter> panel'


class TestMergeTurns:
  def test_merges_a_speakers_consecutive_cues(self):
    turns = mod.merge_turns(mod.parse_vtt(VTT), max_gap=2.5)
    room = [t for t in turns if t.speaker == 'CR01 Cedar (East, 3)']
    assert len(room) == 1
    assert room[0].text.endswith('copy of that.')

  def test_merged_turn_spans_first_start_to_last_end(self):
    turns = mod.merge_turns(mod.parse_vtt(VTT), max_gap=2.5)
    room = next(t for t in turns if t.speaker == 'CR01 Cedar (East, 3)')
    assert room.start == pytest.approx(5.589)
    assert room.end == pytest.approx(12.189)

  def test_speaker_change_starts_a_new_turn(self):
    turns = mod.merge_turns(mod.parse_vtt(VTT), max_gap=2.5)
    assert [t.speaker for t in turns[:2]] == ['Dana Ruiz', 'CR01 Cedar (East, 3)']

  def test_long_silence_splits_even_for_same_speaker(self):
    cues = [
      mod.Cue(start=0.0, end=1.0, speaker='A', text='first'),
      mod.Cue(start=600.0, end=601.0, speaker='A', text='much later'),
    ]
    assert len(mod.merge_turns(cues, max_gap=2.5)) == 2

  def test_overlapping_cues_still_merge(self):
    """Interleaved captions can start before the previous cue ends (negative gap)."""
    cues = [
      mod.Cue(start=0.0, end=5.0, speaker='A', text='first'),
      mod.Cue(start=4.0, end=6.0, speaker='A', text='second'),
    ]
    turns = mod.merge_turns(cues, max_gap=2.5)
    assert len(turns) == 1
    assert turns[0].text == 'first second'


class TestFrameTimes:
  def test_starts_at_zero_and_steps_by_interval(self):
    assert mod.frame_times(0, 35, 10) == [0, 10, 20, 30]

  def test_includes_a_frame_on_the_final_boundary(self):
    assert mod.frame_times(0, 40, 10) == [0, 10, 20, 30, 40]

  def test_honours_a_start_offset(self):
    assert mod.frame_times(100, 130, 10) == [100, 110, 120, 130]

  def test_empty_when_end_precedes_start(self):
    assert mod.frame_times(100, 50, 10) == []


class TestRenderTranscript:
  def _render(self, *, duration=4325.5):
    turns = mod.merge_turns(mod.parse_vtt(VTT), max_gap=2.5)
    return mod.render_transcript_md(
      turns,
      meeting_name='meeting-recording-20260713',
      video_name='video.mp4',
      transcript_name='transcript.vtt',
      snapshot_dir='video-snapshots',
      duration=duration,
      interval=10,
      width=1568,
      cue_count=5,
      command='python3 setup_meeting_snapshots.py',
    )

  def test_documents_the_lookup_rule_with_a_worked_example(self):
    md = self._render()
    assert 'video-snapshots' in md
    assert '00-19-50.jpg' in md

  def test_turn_lines_carry_timestamp_and_speaker(self):
    md = self._render()
    assert '[00:00:05] CR01 Cedar (East, 3):' in md

  def test_flags_dead_air_when_video_outruns_the_speech(self):
    """The 2026-07-13 recording keeps rolling 21 min after the last word."""
    md = self._render(duration=4325.5)
    assert 'dead air' in md.lower()

  def test_no_dead_air_note_when_video_ends_with_the_speech(self):
    md = self._render(duration=605.0)
    assert 'dead air' not in md.lower()

  def test_lists_speakers_with_their_turn_counts(self):
    md = self._render()
    assert 'CR01 Cedar (East, 3)' in md
    assert 'Dana Ruiz' in md


class TestRenderReadme:
  """The README is the folder's own entry point: a session handed just this
  directory has to be able to work out the transcript -> frame lookup from it."""

  def _render(self, *, duration=4325.5):
    turns = mod.merge_turns(mod.parse_vtt(VTT), max_gap=2.5)
    return mod.render_readme_md(
      turns,
      meeting_name='meeting-recording-20260713',
      video_name='video.mp4',
      transcript_name='transcript.vtt',
      snapshot_dir='video-snapshots',
      duration=duration,
      interval=10,
      width=1568,
      frame_count=433,
      command='python3 setup_meeting_snapshots.py',
    )

  def test_documents_the_lookup_rule_with_a_worked_example(self):
    md = self._render()
    assert '00-19-50.jpg' in md

  def test_names_every_artifact_in_the_folder(self):
    md = self._render()
    for name in ('video.mp4', 'transcript.vtt', 'transcript.md', 'video-snapshots'):
      assert name in md, name

  def test_gives_the_regeneration_command(self):
    md = self._render()
    assert 'setup_meeting_snapshots.py' in md

  def test_documents_the_exact_frame_escape_hatch(self):
    md = self._render()
    assert '--at' in md

  def test_flags_dead_air_when_video_outruns_the_speech(self):
    assert 'dead air' in self._render(duration=4325.5).lower()

  def test_no_dead_air_note_when_video_ends_with_the_speech(self):
    assert 'dead air' not in self._render(duration=605.0).lower()

  def test_warns_that_the_heavy_artifacts_are_untracked(self):
    """Otherwise a fresh clone looks broken: transcript present, frames absent."""
    assert 'git' in self._render().lower()


class TestSeedReadme:
  """transcript.md is derived data and gets overwritten; the README is prose a
  human may annotate, so a re-run must leave an existing one alone."""

  def test_writes_when_absent(self, tmp_path):
    target = tmp_path / 'README.md'
    assert mod.seed_readme(target, 'body', force=False) is True
    assert target.read_text() == 'body'

  def test_preserves_hand_edits_on_rerun(self, tmp_path):
    target = tmp_path / 'README.md'
    target.write_text('my own notes')
    assert mod.seed_readme(target, 'body', force=False) is False
    assert target.read_text() == 'my own notes'

  def test_force_overwrites(self, tmp_path):
    target = tmp_path / 'README.md'
    target.write_text('my own notes')
    assert mod.seed_readme(target, 'body', force=True) is True
    assert target.read_text() == 'body'


class TestDiscoverInputs:
  def test_picks_the_video_and_transcript_out_of_a_folder(self, tmp_path):
    (tmp_path / 'video.mp4').write_bytes(b'x')
    (tmp_path / 'transcript.vtt').write_text('WEBVTT\n')
    video, transcript = mod.discover_inputs(tmp_path)
    assert video.name == 'video.mp4'
    assert transcript.name == 'transcript.vtt'

  def test_finds_media_under_any_name_or_extension(self, tmp_path):
    (tmp_path / 'Recording of Sync-20260713.mkv').write_bytes(b'x')
    (tmp_path / 'captions.vtt').write_text('WEBVTT\n')
    video, transcript = mod.discover_inputs(tmp_path)
    assert video.suffix == '.mkv'
    assert transcript.suffix == '.vtt'

  def test_errors_when_no_video_present(self, tmp_path):
    (tmp_path / 'transcript.vtt').write_text('WEBVTT\n')
    with pytest.raises(SystemExit):
      mod.discover_inputs(tmp_path)

  def test_ignores_its_own_extracted_snapshots(self, tmp_path):
    """A re-run must not mistake video-snapshots/*.jpg for the source media."""
    (tmp_path / 'video.mp4').write_bytes(b'x')
    (tmp_path / 'transcript.vtt').write_text('WEBVTT\n')
    snaps = tmp_path / 'video-snapshots'
    snaps.mkdir()
    (snaps / '00-00-00.jpg').write_bytes(b'x')
    video, _ = mod.discover_inputs(tmp_path)
    assert video.name == 'video.mp4'

  def test_finds_an_srt_transcript(self, tmp_path):
    """Not every platform exports WebVTT; SRT rides the same cue reader."""
    (tmp_path / 'video.mp4').write_bytes(b'x')
    (tmp_path / 'captions.srt').write_text('1\n')
    _, transcript = mod.discover_inputs(tmp_path)
    assert transcript.suffix == '.srt'

  def test_missing_transcript_is_not_fatal(self, tmp_path):
    """A caption-less recording can still be transcribed, so this returns None.

    It used to exit here, which dead-ended every recording without a platform
    caption export. The caller decides now.
    """
    (tmp_path / 'video.mp4').write_bytes(b'x')
    video, transcript = mod.discover_inputs(tmp_path)
    assert video.name == 'video.mp4'
    assert transcript is None


class TestTranscribeLocally:
  """The chain into transcribe_recording.py.

  The signature matters more than it looks: both scripts pick "the" media out of a
  folder by their own rules, so the video must be passed through explicitly rather
  than re-discovered, or a folder with two recordings yields a transcript of one
  and frames of the other.
  """

  def test_takes_the_resolved_video_not_just_the_folder(self):
    import inspect

    params = list(inspect.signature(mod.transcribe_locally).parameters)
    assert params[:2] == ['folder', 'video']


class TestNoTranscriptError:
  """The message a caption-less recording produces without --transcribe.

  It is the only place the user learns the fallback exists, so it must name the
  command rather than just complaining.
  """

  def test_points_at_the_caption_export_first(self, tmp_path):
    message = mod.no_transcript_error(tmp_path)
    assert 'Teams' in message and 'speaker names' in message

  def test_gives_both_runnable_commands(self, tmp_path):
    message = mod.no_transcript_error(tmp_path)
    assert 'transcribe_recording.py' in message
    assert '--transcribe' in message

  def test_says_the_audio_stays_local(self, tmp_path):
    message = mod.no_transcript_error(tmp_path)
    assert 'leaves this machine' in message


class TestParseSrt:
  """SRT support is incidental -- same block layout, comma decimals, no <v> tags."""

  SRT = (
    '1\r\n'
    '00:00:03,469 --> 00:00:05,000\r\n'
    'The first line,\r\n'
    'wrapped across two.\r\n'
    '\r\n'
    '2\r\n'
    '00:00:07,000 --> 00:00:08,500\r\n'
    'The second line.\r\n'
  )

  def test_reads_cues_despite_the_numeric_index_line(self):
    cues = mod.parse_vtt(self.SRT)
    assert [c.text for c in cues] == ['The first line, wrapped across two.', 'The second line.']

  def test_comma_decimals_parse_as_times(self):
    assert mod.parse_vtt(self.SRT)[0].start == pytest.approx(3.469)

  def test_speakers_are_unattributed_without_voice_tags(self):
    assert all(c.speaker is None for c in mod.parse_vtt(self.SRT))


class TestScriptCommand:
  """Generated docs quote a re-run command; it has to name a real file path."""

  def test_names_this_script(self):
    command = mod.script_command()
    assert command.startswith('python3 ')
    assert command.endswith('setup_meeting_snapshots.py')

  def test_abbreviates_the_home_directory(self):
    """A skill install lives under $HOME; `~` keeps the docs portable."""
    command = mod.script_command()
    assert str(Path.home()) not in command
