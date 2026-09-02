"""Pins the seams of ta.py that would fail silently: quote copying, verbatim
verification, attribution, the two-level rule, duplicate detection, and the
quote check over a markdown document. Run:

    cd ~/.claude/skills/thematic-analysis && uv run --with pytest --with pyyaml python -m pytest tests -q
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import ta  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def study(tmp_path: Path) -> ta.Analysis:
    """A rostered two-interview analysis folder with three accepted codes."""
    root = tmp_path / "analysis"
    root.mkdir()
    for p in ("p1", "p2"):
        shutil.copytree(FIX / p, tmp_path / p)
    rc = ta.main(["-d", str(root), "init", "--study", "fixture", "--transcripts", str(tmp_path / "p1/transcript.md"), str(tmp_path / "p2/transcript.md")])
    assert rc == 0
    an = ta.Analysis(root)
    an.study["participants"] = [
        {"id": "INT", "role": "interviewer", "speakers": ["Joseph Chang"]},
        {"id": "P1", "role": "participant", "speakers": ["Alice Example"]},
        {"id": "P2", "role": "participant", "speakers": ["Bob Sample"]},
    ]
    an.study["transcripts"][0]["participants"] = ["P1"]
    an.study["transcripts"][1]["participants"] = ["P2"]
    an.save_study()
    an.codebook["codes"] = [
        {"id": "control", "name": "Sense of control over the agent", "status": "accepted", "definition": "Participant describes steering, fixing, or redirecting the agent's work.", "parent": None},
        {"id": "control.rerun", "name": "Rerunning or editing a step", "status": "accepted", "definition": "Specifically editing/rerunning a plan step.", "parent": "control"},
        {"id": "trust", "name": "Trust in generated summaries", "status": "accepted", "definition": "Whether and how the participant verifies AI summaries.", "parent": None},
    ]
    an.save_codebook()
    return ta.Analysis(root)


def run(an: ta.Analysis, *argv) -> int:
    return ta.main(["-d", str(an.root), *argv])


def test_init_rosters_speakers_with_placeholders(study: ta.Analysis, tmp_path: Path):
    fresh = ta.Analysis(tmp_path / "fresh")
    ta.main(["-d", str(fresh.root), "init", "--transcripts", str(tmp_path / "p1/transcript.md")])
    fresh = ta.Analysis(fresh.root)
    ids = {p["id"] for p in fresh.study["participants"]}
    assert ids == {"TODO-joseph-chang", "TODO-alice-example"}
    assert all(p["role"] == "unknown" for p in fresh.study["participants"])
    errors, _ = ta.validate(fresh)
    assert any("placeholder" in e for e in errors)


def test_extract_copies_text_and_attributes_by_speaker(study: ta.Analysis):
    assert run(study, "extract", "T-01", "9", "--codes", "control.rerun") == 0
    an = ta.Analysis(study.root)
    ex = an.extracts[0]
    assert ex["id"] == "E-0001"
    assert ex["participant"] == "P1" and ex["speaker"] == "Alice Example"
    assert ex["timestamp"] == "00:00:19"
    assert ex["text"].startswith("Sure. Honestly the biggest thing")
    assert ex["codes"] == ["control.rerun"]
    assert ta.verify(an) == ([], [])


def test_extract_trims_with_from_to(study: ta.Analysis):
    assert run(study, "extract", "T-01", "9", "--codes", "control", "--from", "being able", "--to", "that step.") == 0
    an = ta.Analysis(study.root)
    assert an.extracts[0]["text"] == "being able to go back to a step and rerun just that step."
    assert ta.verify(an) == ([], [])


def test_extract_refuses_interviewer_speech(study: ta.Analysis):
    with pytest.raises(SystemExit, match="interviewer/researcher speech"):
        run(study, "extract", "T-01", "7", "--codes", "control")


def test_extract_refuses_range_spanning_speakers(study: ta.Analysis):
    with pytest.raises(SystemExit, match="span speakers"):
        run(study, "extract", "T-01", "9-11", "--codes", "control")


def test_extract_dedupes_identical_quote_and_merges_codes(study: ta.Analysis, capsys):
    run(study, "extract", "T-02", "7", "--codes", "control")
    run(study, "extract", "T-02", "7", "--codes", "trust")
    an = ta.Analysis(study.root)
    assert len(an.extracts) == 1
    assert an.extracts[0]["codes"] == ["control", "trust"]


def test_verify_catches_tampered_text_and_wrong_participant(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    an = ta.Analysis(study.root)
    an.extracts[0]["text"] = "Sure. Honestly the biggest thing was being able to go back and re-run everything."
    an.save_extracts()
    errors, _ = ta.verify(ta.Analysis(study.root))
    assert len(errors) == 1 and "NOT found verbatim" in errors[0]

    an = ta.Analysis(study.root)
    an.extracts[0]["text"] = "Sure. Honestly the biggest thing was being able to go back to a step and rerun just that step."
    an.extracts[0]["participant"] = "P2"
    an.save_extracts()
    errors, _ = ta.verify(ta.Analysis(study.root))
    assert len(errors) == 1 and "attributed to P2" in errors[0]


def test_verify_flags_wrong_locator(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    an = ta.Analysis(study.root)
    an.extracts[0]["line_start"] = an.extracts[0]["line_end"] = 13
    an.save_extracts()
    errors, _ = ta.verify(ta.Analysis(study.root))
    assert len(errors) == 1 and "NOT at lines 13-13" in errors[0]


def test_codes_have_at_most_two_levels(study: ta.Analysis):
    an = study
    an.codebook["codes"].append({"id": "control.rerun.twice", "name": "x", "status": "candidate", "definition": "d", "parent": "control.rerun"})
    an.save_codebook()
    errors, _ = ta.validate(ta.Analysis(an.root))
    assert any("at most two levels" in e for e in errors)


def test_dupes_flags_overlapping_names_and_extract_sets(study: ta.Analysis):
    an = study
    an.codebook["codes"].append({"id": "agent-control", "name": "Control over the agent", "status": "candidate", "definition": "d", "parent": None})
    an.save_codebook()
    run(study, "extract", "T-01", "9", "--codes", "control,agent-control")
    run(study, "extract", "T-01", "13", "--codes", "control,agent-control")
    run(study, "extract", "T-02", "7", "--codes", "control,agent-control")
    notes = ta.find_dupes(ta.Analysis(an.root))
    assert any("names overlap" in n and "agent-control" in n for n in notes)
    assert any("extracts overlap" in n for n in notes)


def test_merge_code_recodes_extracts_and_bumps_version(study: ta.Analysis):
    an = study
    an.codebook["codes"].append({"id": "agent-control", "name": "Control over the agent", "status": "candidate", "definition": "d", "parent": None})
    an.save_codebook()
    run(study, "extract", "T-02", "7", "--codes", "agent-control")
    assert run(study, "merge-code", "agent-control", "control", "--why", "same idea") == 0
    an = ta.Analysis(study.root)
    assert an.extracts[0]["codes"] == ["control"]
    assert an.code("agent-control")["status"] == "merged" and an.code("agent-control")["merged_into"] == "control"
    assert an.codebook["version"] == 2
    assert an.resolve_code("agent-control") == "control"


def test_intent_kind_and_coverage_counts_per_participant(study: ta.Analysis):
    run(study, "extract", "T-01", "15", "--codes", "control", "--kind", "intent")
    run(study, "extract", "T-01", "19", "--codes", "trust")
    run(study, "extract", "T-02", "13", "--codes", "trust")
    run(study, "mark-coded", "T-01")
    rep = ta.coverage_report(ta.Analysis(study.root))
    assert "| `trust` Trust in generated summaries | accepted | P1, P2 | 2/2 |" in rep
    assert "| `control` Sense of control over the agent | accepted | P1 | 1/2 | 1 | 0/0/1 |" in rep
    assert "| T-02 | P2 | 1 | - | uncoded |" in rep
    assert "| T-01 | P1 | 2 | 1 | current |" in rep


def test_stale_after_bump(study: ta.Analysis):
    run(study, "mark-coded", "T-01")
    run(study, "mark-coded", "T-02")
    assert run(study, "stale") == 0
    run(study, "bump", "added a code after P2", "--freeze")
    assert run(study, "stale") == 1
    assert ta.Analysis(study.root).codebook["frozen"] is True


def test_verify_quotes_accepts_editorial_marks_and_flags_fabrication(study: ta.Analysis, tmp_path: Path):
    draft = tmp_path / "draft.md"
    draft.write_text(
        "P1 valued rerunning: \"being able to go back to a step and rerun just that step. [...] I would have to redo the whole prompt\" (P1).\n\n"
        "> It felt safer. When it does something wrong there's a concrete step I can point at [in the plan] and fix, instead of digging through a conversation. - P2\n\n"
        "P2 also said \"the plan view made me feel like a real researcher again\" (P2).\n\n"
        "> I did it twice on Tuesday. The second time I removed the search step entirely because it kept pulling in robotics papers - P2\n",
        encoding="utf-8",
    )
    rc = ta.main(["-d", str(study.root), "verify-quotes", str(draft)])
    assert rc == 1
    quotes = ta.find_quotes_in_markdown(draft.read_text())
    assert [q["attributed"] for q in quotes] == ["P1", "P2", "P2", "P2"]
    # segments: the fabricated inline quote has no match; the last blockquote is P1's words presented as P2's
    segs = ta.quote_segments(quotes[1]["text"])
    assert segs == ["It felt safer. When it does something wrong there's a concrete step I can point at", "and fix, instead of digging through a conversation"]
    assert ta.locate_segment(ta.Analysis(study.root), "made me feel like a real researcher") == []
    hits = ta.locate_segment(ta.Analysis(study.root), "I did it twice on Tuesday")
    assert hits and hits[0][1] == "P1"


def test_themes_validate_selected_extracts_belong_to_theme_codes(study: ta.Analysis):
    run(study, "extract", "T-01", "19", "--codes", "trust")
    an = ta.Analysis(study.root)
    an.themes["themes"] = [{
        "id": "TH1", "name": "Control is the point", "status": "candidate", "in_paper": "undecided",
        "essence": "Participants valued steering the agent step by step. It mattered more than output quality.",
        "codes": ["control"], "selected_extracts": ["E-0001"],
    }]
    an.save_themes()
    errors, warnings = ta.validate(ta.Analysis(an.root))
    assert errors == []
    assert any("carries none of the theme's codes" in w for w in warnings)
    report = ta.themes_report(ta.Analysis(an.root))
    assert "TH1 · Control is the point" in report


def test_quote_finder_splits_stacked_blockquotes_and_skips_attributes(study: ta.Analysis, tmp_path: Path):
    doc = tmp_path / "review.plan.md"
    doc.write_text(
        '<open-question id="Q-1" title="Accept the code about going back to a step and rerunning it?" status="open">\n'
        '> **E-0001** P1 [00:00:19]: "Sure. Honestly the biggest thing was being able to go back to a step and rerun just that step."\n'
        '> **E-0002** P1 [00:01:10] [did]: "I did it twice on Tuesday. The second time I removed the search step entirely because it kept pulling in robotics papers"\n'
        '> **E-0005** P2 [00:00:12] *(said)*: "It felt safer. When it does something wrong there\'s a concrete step I can point at and fix" *(borderline: reactive)*\n',
        encoding="utf-8",
    )
    quotes = ta.find_quotes_in_markdown(doc.read_text())
    assert [q["attributed"] for q in quotes] == ["P1", "P1", "P2"]
    assert quotes[2]["text"].startswith("It felt safer") and quotes[2]["text"].endswith("point at and fix")
    assert ta.main(["-d", str(study.root), "verify-quotes", str(doc), "--quiet"]) == 0


def test_yaml_syntax_error_is_a_message_not_a_traceback(study: ta.Analysis):
    (study.root / "codebook.yaml").write_text("codes: [\n  - id: x\n", encoding="utf-8")
    with pytest.raises(SystemExit, match="codebook.yaml: not valid YAML"):
        ta.main(["-d", str(study.root), "validate"])


def test_annotate_wraps_each_extract_in_a_highlight_with_matching_comment(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control", "--from", "being able", "--to", "that step.")
    run(study, "extract", "T-01", "9", "--codes", "control.rerun", "--from", "With the chat tool", "--to", "whole prompt.")
    run(study, "extract", "T-01", "13", "--codes", "control.rerun", "--kind", "did")
    md = ta.annotate(ta.Analysis(study.root), "T-01")
    assert md.count("<user-highlight") == 3 and md.count("</user-highlight>") == 3
    assert md.count('<comment id="x-E-') == 3
    assert '<user-highlight comment="x-E-0001">being able to go back to a step and rerun just that step.</user-highlight>' in md
    assert "[00:00:04] Joseph Chang:" in md  # interviewer turns present, unhighlighted
    plain = ta.annotate(ta.Analysis(study.root), "T-01", plan=False)
    assert "↳ E-0003 [did] control.rerun" in plain
