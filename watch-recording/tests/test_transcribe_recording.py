"""Tests for the local transcription fallback (transcribe_recording.py).

Run them with `uv run --with pytest python -m pytest tests/` from the skill
directory, or with any environment that has pytest on it.

Nothing here runs Whisper or pyannote: the models are hundreds of MB and slow,
and what actually breaks is not the inference. It is the seams around it --
merging a speaker timeline onto word timings, and emitting a VTT the *other*
script can read back. So those are what is pinned, including a round-trip
through the real parser in setup_meeting_snapshots.py.

The load-bearing assumption being tested: a machine-transcribed recording must
flow through exactly the same pipeline as a Teams caption export. If render_vtt
and parse_vtt ever disagree, the fallback silently produces an empty transcript.
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


tr = _load('transcribe_recording')
snap = _load('setup_meeting_snapshots')


def word(start, end, text, speaker=None):
  return tr.Word(start=start, end=end, text=text, speaker=speaker)


def turn(start, end, speaker):
  return tr.SpeakerTurn(start=start, end=end, speaker=speaker)


class TestFormatVttTime:
  def test_zero(self):
    assert tr.format_vtt_time(0) == '00:00:00.000'

  def test_millisecond_precision(self):
    assert tr.format_vtt_time(1.234) == '00:00:01.234'

  def test_hours_carry(self):
    assert tr.format_vtt_time(3661.5) == '01:01:01.500'

  def test_rounds_rather_than_truncates(self):
    """Cue times are a duration, not a frame lookup, so rounding is right here."""
    assert tr.format_vtt_time(0.9996) == '00:00:01.000'

  def test_clamps_negatives(self):
    """Whisper occasionally emits a tiny negative start; VTT has no such thing."""
    assert tr.format_vtt_time(-0.5) == '00:00:00.000'


class TestWordMidpoint:
  def test_midpoint_is_between_the_edges(self):
    assert word(2.0, 4.0, 'hi').mid == 3.0


class TestAttributeWords:
  def test_word_inside_a_turn_takes_its_speaker(self):
    words = [word(1.0, 2.0, 'hello')]
    tr.attribute_words(words, [turn(0.0, 5.0, 'SPEAKER_00')])
    assert words[0].speaker == 'SPEAKER_00'

  def test_speaker_change_is_picked_up_word_by_word(self):
    """The whole reason for word-level timings: one Whisper segment, two people."""
    words = [word(0.5, 1.0, 'yes'), word(6.0, 6.5, 'no')]
    tr.attribute_words(
      words, [turn(0.0, 2.0, 'SPEAKER_00'), turn(5.0, 8.0, 'SPEAKER_01')]
    )
    assert [w.speaker for w in words] == ['SPEAKER_00', 'SPEAKER_01']

  def test_midpoint_decides_when_a_word_straddles_a_boundary(self):
    """Word edges bleed into the neighbouring turn; the midpoint does not."""
    words = [word(1.5, 2.5, 'overlap')]
    tr.attribute_words(
      words, [turn(0.0, 2.1, 'SPEAKER_00'), turn(2.1, 5.0, 'SPEAKER_01')]
    )
    assert words[0].speaker == 'SPEAKER_00'

  def test_word_in_an_unlabelled_gap_falls_back_to_overlap(self):
    """pyannote leaves silence unlabelled, so midpoints can land nowhere."""
    words = [word(2.0, 3.5, 'mumble')]
    tr.attribute_words(
      words, [turn(0.0, 2.2, 'SPEAKER_00'), turn(4.0, 6.0, 'SPEAKER_01')]
    )
    assert words[0].speaker == 'SPEAKER_00'

  def test_word_with_no_overlap_at_all_takes_the_nearest_turn(self):
    words = [word(10.0, 10.5, 'stray')]
    tr.attribute_words(
      words, [turn(0.0, 1.0, 'SPEAKER_00'), turn(11.0, 12.0, 'SPEAKER_01')]
    )
    assert words[0].speaker == 'SPEAKER_01'

  def test_no_turns_leaves_every_word_unattributed(self):
    """--no-diarize, or a diarization that found nothing: must not invent a speaker."""
    words = [word(1.0, 2.0, 'hello')]
    tr.attribute_words(words, [])
    assert words[0].speaker is None


class TestGroupCues:
  def test_consecutive_words_from_one_speaker_become_one_cue(self):
    words = [
      word(0.0, 0.4, 'we', 'SPEAKER_00'),
      word(0.4, 0.9, 'shipped', 'SPEAKER_00'),
      word(0.9, 1.2, 'it', 'SPEAKER_00'),
    ]
    cues = tr.group_cues(words)
    assert len(cues) == 1
    assert cues[0][2] == 'SPEAKER_00'
    assert cues[0][3] == 'we shipped it'

  def test_cue_spans_first_start_to_last_end(self):
    words = [word(1.0, 1.5, 'a', 'S0'), word(1.5, 2.75, 'b', 'S0')]
    start, end, _, _ = tr.group_cues(words)[0]
    assert (start, end) == (1.0, 2.75)

  def test_speaker_change_breaks_the_cue(self):
    words = [word(0.0, 0.5, 'yes', 'S0'), word(0.5, 1.0, 'no', 'S1')]
    cues = tr.group_cues(words)
    assert [c[2] for c in cues] == ['S0', 'S1']

  def test_long_pause_breaks_even_within_one_speaker(self):
    words = [word(0.0, 0.5, 'first', 'S0'), word(9.0, 9.5, 'second', 'S0')]
    assert len(tr.group_cues(words)) == 2

  def test_short_pause_does_not_break(self):
    words = [word(0.0, 0.5, 'first', 'S0'), word(0.9, 1.4, 'second', 'S0')]
    assert len(tr.group_cues(words)) == 1

  def test_a_long_monologue_is_split_into_readable_cues(self):
    """One speaker talking for a minute must not become a single wall-of-text cue."""
    words = [word(i * 0.5, i * 0.5 + 0.4, f'w{i}', 'S0') for i in range(120)]
    cues = tr.group_cues(words)
    assert len(cues) > 1
    assert all(end - start <= tr.CUE_MAX_DURATION + 1 for start, end, _, _ in cues)

  def test_no_words_yields_no_cues(self):
    assert tr.group_cues([]) == []


class TestRenderVtt:
  def _cues(self):
    return [
      (0.0, 2.0, 'SPEAKER_00', 'So where did we land on the filter?'),
      (2.0, 4.5, 'SPEAKER_01', 'I would start by turning it off.'),
    ]

  def test_starts_with_the_webvtt_header(self):
    out = tr.render_vtt(self._cues(), source='call.mp4', model='ggml-large-v3-turbo')
    assert out.startswith('WEBVTT')

  def test_speakers_become_voice_tags(self):
    out = tr.render_vtt(self._cues(), source='call.mp4', model='ggml-large-v3-turbo')
    assert '<v SPEAKER_00>So where did we land on the filter?' in out

  def test_names_both_models_it_used(self):
    out = tr.render_vtt(self._cues(), source='call.mp4', model='ggml-large-v3-turbo')
    assert 'whisper.cpp' in out and 'pyannote' in out

  def test_warns_that_quotes_need_verifying(self):
    """A misheard word becomes a misquote attributed to a real person."""
    out = tr.render_vtt(self._cues(), source='call.mp4', model='ggml-large-v3-turbo')
    assert 'misheard' in out
    assert 'not names' in out

  def test_undiarized_output_says_so_instead_of_claiming_pyannote(self):
    cues = [(0.0, 2.0, None, 'no speaker here')]
    out = tr.render_vtt(cues, source='call.mp4', model='ggml-base.en')
    assert 'No diarization' in out
    assert 'pyannote/speaker-diarization' not in out

  def test_undiarized_note_does_not_discuss_speaker_labels(self):
    """There are none, so mentioning them only muddies what the file contains."""
    cues = [(0.0, 2.0, None, 'no speaker here')]
    out = tr.render_vtt(cues, source='call.mp4', model='ggml-base.en')
    assert 'not names' not in out

  def test_both_variants_still_warn_about_misheard_words(self):
    plain = tr.render_vtt([(0.0, 1.0, None, 'x')], source='a.mp4', model='m')
    labelled = tr.render_vtt([(0.0, 1.0, 'SPEAKER_00', 'x')], source='a.mp4', model='m')
    assert 'misheard' in plain and 'misheard' in labelled

  def test_undiarized_cue_has_no_voice_tag(self):
    cues = [(0.0, 2.0, None, 'no speaker here')]
    out = tr.render_vtt(cues, source='call.mp4', model='ggml-base.en')
    assert '<v ' not in out.split('NOTE')[-1].split('\n\n', 1)[-1]


class TestExtractTurns:
  """Unwrapping the pipeline result, which changed shape between pyannote majors.

  Testable without the model because the only thing that matters is the shape:
  4.x returns a DiarizeOutput wrapping two Annotations, 3.x returned a bare one.
  """

  class FakeSegment:
    def __init__(self, start, end):
      self.start, self.end = start, end

  class FakeAnnotation:
    def __init__(self, tracks):
      self._tracks = tracks

    def itertracks(self, yield_label=False):
      for start, end, label in self._tracks:
        yield TestExtractTurns.FakeSegment(start, end), None, label

  def test_reads_a_bare_annotation(self):
    """pyannote 3.x handed back the Annotation itself."""
    out = tr.extract_turns(self.FakeAnnotation([(0.0, 1.0, 'S0')]))
    assert [(t.start, t.end, t.speaker) for t in out] == [(0.0, 1.0, 'S0')]

  def test_prefers_the_exclusive_annotation(self):
    """A word gets exactly one speaker, so overlapping turns make it arbitrary."""

    class FakeOutput:
      exclusive_speaker_diarization = TestExtractTurns.FakeAnnotation([(0.0, 1.0, 'EXCLUSIVE')])
      speaker_diarization = TestExtractTurns.FakeAnnotation([(0.0, 1.0, 'OVERLAPPING')])

    assert tr.extract_turns(FakeOutput()).pop().speaker == 'EXCLUSIVE'

  def test_falls_back_to_the_plain_annotation(self):
    class FakeOutput:
      exclusive_speaker_diarization = None
      speaker_diarization = TestExtractTurns.FakeAnnotation([(2.0, 3.0, 'S1')])

    assert tr.extract_turns(FakeOutput()).pop().speaker == 'S1'

  def test_sorts_turns_chronologically(self):
    """Attribution scans this timeline, and pyannote does not promise an order."""
    out = tr.extract_turns(self.FakeAnnotation([(5.0, 6.0, 'S1'), (0.0, 1.0, 'S0')]))
    assert [t.start for t in out] == [0.0, 5.0]

  def test_an_unrecognized_shape_exits_with_advice(self):
    """Better a clear message than an AttributeError deep in the call stack."""
    with pytest.raises(SystemExit):
      tr.extract_turns(object())


class TestGateHelp:
  """The gated-model message, which is the most likely thing a user ever sees.

  Loading one pipeline pulls several separately-gated repos, and which ones
  changed between pyannote 3.x and 4.x -- so the message reads the failure rather
  than reciting a hardcoded list that goes stale.
  """

  def test_names_the_repo_the_error_actually_blamed(self):
    message = (
      'Could not download xvec_transform.npz from '
      'pyannote/speaker-diarization-community-1.'
    )
    out = tr.gate_help(message)
    assert 'pyannote/speaker-diarization-community-1' in out

  def test_does_not_recite_unrelated_repos_when_one_is_named(self):
    """Sending someone to accept a licence that was not the problem wastes a trip."""
    message = 'Could not download config.yaml from pyannote/segmentation-3.0.'
    out = tr.gate_help(message)
    assert 'pyannote/segmentation-3.0' in out
    assert 'community-1' not in out

  def test_lists_every_known_repo_when_the_error_names_none(self):
    out = tr.gate_help('some opaque failure')
    for repo in tr.GATED_REPOS:
      assert repo in out

  def test_deduplicates_a_repo_mentioned_repeatedly(self):
    message = 'pyannote/segmentation-3.0 failed; retry pyannote/segmentation-3.0'
    out = tr.gate_help(message)
    assert out.count('https://huggingface.co/pyannote/segmentation-3.0') == 1

  def test_warns_that_a_rerun_can_be_refused_by_a_different_repo(self):
    """Accepting one licence and re-running often surfaces the next gate."""
    out = tr.gate_help('pyannote/segmentation-3.0')
    assert 'different one' in out

  def test_always_offers_the_no_diarize_escape(self):
    assert '--no-diarize' in tr.gate_help('anything')

  def test_says_a_token_alone_is_insufficient(self):
    """The failure is invisible from the API, so this has to be spelled out."""
    assert 'not enough on its own' in tr.gate_help('anything')


class TestBrokenInstallGuards:
  """A mismatched pyannote/torch install must produce advice, not a traceback.

  This is not hypothetical: pyannote 3.x against a modern torchaudio raises
  AttributeError at import time, and a torch/torchaudio ABI mismatch raises
  OSError on a .dylib -- neither is an ImportError.
  """

  def test_import_guard_catches_more_than_importerror(self):
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(tr.run_diarization))
    caught = [
      handler.type.id
      for handler in ast.walk(tree)
      if isinstance(handler, ast.ExceptHandler) and isinstance(handler.type, ast.Name)
    ]
    assert 'ImportError' not in caught, 'ImportError alone misses AttributeError/OSError'
    assert 'Exception' in caught


class TestCueTextEscaping:
  """Found by audit: spoken angle brackets were read back as VTT tags and dropped."""

  def test_spoken_angle_brackets_are_escaped(self):
    out = tr.render_vtt([(0.0, 1.0, 'S0', 'use vector<int>')], source='a.mp4', model='m')
    assert '&lt;int&gt;' in out

  def test_the_voice_tag_itself_is_not_escaped(self):
    """Escaping our own tag would make the speaker unreadable to the parser."""
    out = tr.render_vtt([(0.0, 1.0, 'SPEAKER_00', 'hi')], source='a.mp4', model='m')
    assert '<v SPEAKER_00>hi' in out

  def test_ampersand_is_escaped(self):
    out = tr.render_vtt([(0.0, 1.0, None, 'Q&A')], source='a.mp4', model='m')
    assert 'Q&amp;A' in out

  def test_text_that_looks_like_a_voice_tag_cannot_forge_a_speaker(self):
    """Otherwise transcribed text could invent an attribution out of nothing."""
    out = tr.render_vtt([(0.0, 1.0, None, '<v Impostor>hello')], source='a.mp4', model='m')
    parsed = snap.parse_vtt(out)[0]
    assert parsed.speaker is None
    assert parsed.text == '<v Impostor>hello'


class TestRefusesToCompeteWithAnExistingTranscript:
  """Found by audit: it would add `recording.vtt` beside a real `captions.vtt`.

  setup_meeting_snapshots.py picks the *largest* transcript in a folder, so the
  machine transcript could silently win over an export that has real names.
  """

  def test_transcript_suffixes_match_the_readers(self):
    assert tr.TRANSCRIPT_SUFFIXES == snap.TRANSCRIPT_SUFFIXES


class TestRoundTripThroughTheRealParser:
  """The contract: what this script writes, setup_meeting_snapshots.py must read.

  These two halves are developed independently, and a silent disagreement here
  produces an empty transcript.md rather than an error -- so it is pinned.
  """

  def _vtt(self):
    words = [
      word(0.0, 0.5, 'So'),
      word(0.5, 1.0, 'where'),
      word(1.0, 1.4, 'did'),
      word(1.4, 1.9, 'we'),
      word(1.9, 2.4, 'land?'),
      word(6.0, 6.4, 'I'),
      word(6.4, 7.0, 'would'),
      word(7.0, 7.6, 'start'),
      word(7.6, 8.0, 'there.'),
    ]
    turns = [turn(0.0, 3.0, 'SPEAKER_00'), turn(5.5, 9.0, 'SPEAKER_01')]
    tr.attribute_words(words, turns)
    return tr.render_vtt(
      tr.group_cues(words), source='call.mp4', model='ggml-large-v3-turbo'
    )

  def test_generated_vtt_parses_back_into_cues(self):
    cues = snap.parse_vtt(self._vtt())
    assert len(cues) == 2

  def test_speakers_survive_the_round_trip(self):
    cues = snap.parse_vtt(self._vtt())
    assert [c.speaker for c in cues] == ['SPEAKER_00', 'SPEAKER_01']

  def test_text_survives_the_round_trip(self):
    cues = snap.parse_vtt(self._vtt())
    assert cues[0].text == 'So where did we land?'
    assert cues[1].text == 'I would start there.'

  def test_timings_survive_the_round_trip(self):
    cues = snap.parse_vtt(self._vtt())
    assert cues[0].start == pytest.approx(0.0)
    assert cues[1].end == pytest.approx(8.0)

  def test_the_note_block_is_not_read_as_speech(self):
    """The provenance NOTE must not leak into the transcript as a spoken turn."""
    cues = snap.parse_vtt(self._vtt())
    assert not any('Machine-generated' in c.text for c in cues)

  def test_it_merges_into_turns_downstream(self):
    turns_out = snap.merge_turns(snap.parse_vtt(self._vtt()))
    assert [t.speaker for t in turns_out] == ['SPEAKER_00', 'SPEAKER_01']

  def test_a_timestamp_still_maps_onto_the_frame_grid(self):
    """The point of the whole skill: a cue time floors to a frame filename."""
    cues = snap.parse_vtt(self._vtt())
    assert snap.snapshot_name(cues[1].start, 10) == '00-00-00.jpg'


class TestDiscoverVideo:
  def test_accepts_a_file_directly(self, tmp_path):
    media = tmp_path / 'call.mp4'
    media.write_bytes(b'x')
    assert tr.discover_video(media) == media

  def test_finds_the_largest_media_in_a_folder(self, tmp_path):
    (tmp_path / 'clip.mp4').write_bytes(b'x')
    (tmp_path / 'full.mp4').write_bytes(b'x' * 100)
    assert tr.discover_video(tmp_path).name == 'full.mp4'

  def test_accepts_audio_only_recordings(self, tmp_path):
    """A phone or dictation recording has no video track but transcribes fine."""
    (tmp_path / 'interview.m4a').write_bytes(b'x')
    assert tr.discover_video(tmp_path).suffix == '.m4a'

  def test_video_beats_a_larger_audio_file(self, tmp_path):
    """Decoded audio dwarfs the compressed video it came from.

    16 kHz mono PCM of an hour is ~115 MB where the source .mp4 may be 40 MB, so
    picking purely on size transcribes the wrong file.
    """
    (tmp_path / 'meeting.mp4').write_bytes(b'x' * 10)
    (tmp_path / 'loud.wav').write_bytes(b'x' * 10_000)
    assert tr.discover_video(tmp_path).name == 'meeting.mp4'

  def test_ignores_its_own_extracted_wav(self, tmp_path):
    """--keep-wav leaves a sidecar; a re-run must not transcribe that instead."""
    (tmp_path / 'meeting.mp4').write_bytes(b'x')
    (tmp_path / f'meeting{tr.WAV_SIDECAR_SUFFIX}').write_bytes(b'x' * 10_000)
    assert tr.discover_video(tmp_path).name == 'meeting.mp4'

  def test_sidecar_alone_is_not_a_recording(self, tmp_path):
    """With the source gone, the leftover sidecar must not stand in for it."""
    (tmp_path / f'meeting{tr.WAV_SIDECAR_SUFFIX}').write_bytes(b'x')
    with pytest.raises(SystemExit):
      tr.discover_video(tmp_path)

  def test_errors_on_an_empty_folder(self, tmp_path):
    with pytest.raises(SystemExit):
      tr.discover_video(tmp_path)

  def test_errors_on_a_missing_path(self, tmp_path):
    with pytest.raises(SystemExit):
      tr.discover_video(tmp_path / 'nope')


class TestFindModel:
  """Model discovery, which must never quietly pick something useless.

  MODEL_SEARCH is patched in every case: these must pass on a machine with no
  models installed and on one with several.
  """

  @pytest.fixture(autouse=True)
  def _no_downloads(self, monkeypatch):
    """A test must never trigger a 1.5 GB fetch."""
    monkeypatch.setattr(
      tr, 'download_model', lambda name: (_ for _ in ()).throw(AssertionError('downloaded'))
    )
    monkeypatch.delenv('WHISPER_CPP_MODEL', raising=False)

  def test_explicit_path_wins(self, tmp_path, monkeypatch):
    monkeypatch.setattr(tr, 'MODEL_SEARCH', ())
    model = tmp_path / 'ggml-small.bin'
    model.write_bytes(b'x')
    assert tr.find_model(model) == model

  def test_explicit_missing_path_is_fatal(self, tmp_path, monkeypatch):
    monkeypatch.setattr(tr, 'MODEL_SEARCH', ())
    with pytest.raises(SystemExit):
      tr.find_model(tmp_path / 'nope.bin')

  def test_env_var_is_honoured(self, tmp_path, monkeypatch):
    monkeypatch.setattr(tr, 'MODEL_SEARCH', ())
    model = tmp_path / 'ggml-medium.bin'
    model.write_bytes(b'x')
    monkeypatch.setenv('WHISPER_CPP_MODEL', str(model))
    assert tr.find_model(None) == model

  def test_prefers_the_most_accurate_available(self, tmp_path, monkeypatch):
    """Quotes go into reports about real people, so accuracy beats speed."""
    for name in ('base.en', 'large-v3-turbo', 'small'):
      (tmp_path / f'ggml-{name}.bin').write_bytes(b'x')
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (tmp_path,))
    assert tr.find_model(None).name == 'ggml-large-v3-turbo.bin'

  def test_falls_down_the_preference_list(self, tmp_path, monkeypatch):
    for name in ('base.en', 'small'):
      (tmp_path / f'ggml-{name}.bin').write_bytes(b'x')
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (tmp_path,))
    assert tr.find_model(None).name == 'ggml-small.bin'

  def test_skips_the_brew_test_stub(self, tmp_path, monkeypatch):
    """`for-tests-ggml-tiny.bin` loads and emits garbage -- worse than failing."""
    (tmp_path / 'for-tests-ggml-tiny.bin').write_bytes(b'x')
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (tmp_path,))
    with pytest.raises(AssertionError, match='downloaded'):
      tr.find_model(None)

  def test_earlier_search_directory_wins(self, tmp_path, monkeypatch):
    first, second = tmp_path / 'a', tmp_path / 'b'
    for directory in (first, second):
      directory.mkdir()
      (directory / 'ggml-large-v3-turbo.bin').write_bytes(b'x')
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (first, second))
    assert tr.find_model(None).parent == first

  def test_quantized_good_tier_beats_an_exact_worse_tier(self, tmp_path, monkeypatch):
    """Found by audit: exact-name matching made a quantized large lose to `small`.

    Tiers are matched by prefix now, so `large-v3-turbo-q5_0` ranks with
    `large-v3-turbo` instead of falling past every entry to the first exact hit.
    """
    (tmp_path / 'ggml-large-v3-turbo-q5_0.bin').write_bytes(b'x' * 100)
    (tmp_path / 'ggml-small.bin').write_bytes(b'x' * 10)
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (tmp_path,))
    assert tr.find_model(None).name == 'ggml-large-v3-turbo-q5_0.bin'

  def test_a_longer_tier_is_not_swallowed_by_its_own_prefix(self):
    """`large-v3` is a prefix of `large-v3-turbo`, so order in the list matters."""
    assert tr.MODEL_PREFERENCE.index('large-v3-turbo') < tr.MODEL_PREFERENCE.index('large-v3')

  def test_full_precision_wins_over_quantized_within_a_tier(self, tmp_path, monkeypatch):
    (tmp_path / 'ggml-large-v3-turbo.bin').write_bytes(b'x' * 500)
    (tmp_path / 'ggml-large-v3-turbo-q5_0.bin').write_bytes(b'x' * 100)
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (tmp_path,))
    assert tr.find_model(None).name == 'ggml-large-v3-turbo.bin'

  def test_unrecognized_model_name_still_usable(self, tmp_path, monkeypatch):
    """A quantized or fine-tuned build is a real model, just not on the list."""
    (tmp_path / 'ggml-large-v3-turbo-q5_0.bin').write_bytes(b'x' * 10)
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (tmp_path,))
    assert tr.find_model(None).name == 'ggml-large-v3-turbo-q5_0.bin'

  def test_downloads_only_as_a_last_resort(self, tmp_path, monkeypatch):
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (tmp_path,))
    with pytest.raises(AssertionError, match='downloaded'):
      tr.find_model(None)

  def test_missing_search_directories_are_skipped(self, tmp_path, monkeypatch):
    """The OpenSuperWhisper path won't exist on most machines."""
    monkeypatch.setattr(tr, 'MODEL_SEARCH', (tmp_path / 'absent',))
    with pytest.raises(AssertionError, match='downloaded'):
      tr.find_model(None)
