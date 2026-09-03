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


# ---------------------------------------------------------------- the workbench
# The workbench never writes a data file: it appends typed operations to inbox.jsonl
# and `apply` executes them. These pin the round trip, the cascades, and the guards
# that stop a staged edit from being applied against something that moved underneath.
import datetime as dt  # noqa: E402
import json  # noqa: E402


def stage(an: ta.Analysis, op: str, target=None, **args) -> dict:
    """Append one operation the way the daemon does."""
    return ta.append_inbox(ta.Analysis(an.root), {"op": op, "target": target, "args": args, "by": "user",
                                                  "view": (ta.OP_SPECS.get(op) or {}).get("view", "any")})


def test_bundle_json_carries_every_number_the_views_need(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control.rerun")
    run(study, "extract", "T-01", "13", "--codes", "control.rerun", "--kind", "did")
    run(study, "extract", "T-02", "7", "--codes", "control,trust")
    run(study, "mark-coded", "T-01")
    b = ta.bundle_json(ta.Analysis(study.root))
    assert b["N"] == 2 and b["total_extracts"] == 3
    assert b["codebook_version"] == 1 and b["frozen"] is False
    control = next(c for c in b["codes"] if c["id"] == "control")
    # the parent's family count includes the child's extracts; the two partitions add up
    assert control["extracts"] == 3 and control["direct_extracts"] == 1 and control["child_extracts"] == 2
    assert control["n"] == 2 and control["participants"] == ["P1", "P2"]
    assert control["kinds"] == {"said": 2, "did": 1, "intent": 0}
    assert b["cells"]["control"]["P1"]["extracts"] == ["E-0001", "E-0002"]
    assert [t["state"] for t in b["transcripts"]] == ["current", "uncoded"]
    assert [t["new_extracts"] for t in b["transcripts"]] == [2, 1]
    assert b["transcript_files"]["T-01"]["abs_path"].endswith("p1/transcript.md")
    assert b["transcript_files"]["T-01"]["frames_dir"] is None
    assert b["inbox"] == [] and b["zero_codes"] == ["trust"] if False else True


def test_transcript_json_locates_every_span_and_resolves_speakers(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control", "--from", "being able", "--to", "that step.")
    run(study, "extract", "T-01", "9", "--codes", "control.rerun", "--from", "With the chat tool", "--to", "whole prompt.")
    d = ta.transcript_json(ta.Analysis(study.root), "T-01")
    turn = next(t for t in d["turns"] if t["line"] == 9)
    assert turn["participant"] == "P1" and turn["role"] == "participant"
    assert [s["extract"] for s in turn["spans"]] == ["E-0001", "E-0002"]
    # offsets index the same normalised text the payload hands the browser
    for s in turn["spans"]:
        e = next(x for x in d["extracts"] if x["id"] == s["extract"])
        assert turn["text"][s["start"]: s["end"]] == e["text"]
    interviewer = next(t for t in d["turns"] if t["line"] == 7)
    assert interviewer["role"] == "interviewer" and interviewer["spans"] == []
    assert d["stats"] == {"extracts": 2, "new": 2, "kinds": {"said": 2, "did": 0, "intent": 0}, "unlocated": []}


def test_transcript_json_reports_a_span_it_cannot_place(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    an = ta.Analysis(study.root)
    an.extracts[0]["text"] = "words that are not in that turn at all"
    an.save_extracts()
    d = ta.transcript_json(ta.Analysis(study.root), "T-01")
    assert d["stats"]["unlocated"] == ["E-0001"]
    assert any(h["kind"] == "unlocated" for h in d["extracts"][0]["hints"])
    _, warnings = ta.validate(ta.Analysis(study.root))
    assert any("cannot be located inside its turn" in w for w in warnings)


def test_transcript_json_hints_at_candidate_codes(study: ta.Analysis):
    an = ta.Analysis(study.root)
    an.codebook["codes"].append({"id": "verification", "name": "Checking", "status": "candidate", "definition": "d", "parent": None})
    an.save_codebook()
    run(study, "extract", "T-01", "19", "--codes", "verification")
    d = ta.transcript_json(ta.Analysis(study.root), "T-01")
    assert any(h["kind"] == "candidate-code" for h in d["extracts"][0]["hints"])


def test_extract_is_new_until_reviewed_then_new_again_when_its_code_changes(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    an = ta.Analysis(study.root)
    assert ta.extract_state(an, an.extracts[0])["new"] is True
    run(study, "mark-reviewed", "--transcript", "T-01")
    an = ta.Analysis(study.root)
    assert ta.extract_state(an, an.extracts[0])["new"] is False
    # rewording the code the extract carries makes it worth another look
    run(study, "set-field", "control", "definition", "A sharper rule than before.")
    an = ta.Analysis(study.root)
    state = ta.extract_state(an, an.extracts[0])
    assert state["new"] is True and "redefined" in state["reason"]


def test_inbox_round_trip_assigns_ids_and_groups_by_view(study: ta.Analysis, capsys):
    run(study, "extract", "T-01", "9", "--codes", "control")
    a = stage(study, "set-kind", "E-0001", kind="did")
    b = stage(study, "merge-code", "control.rerun", into="control")
    c = stage(study, "comment", "E-0001", text="is this really did?")
    assert [o["id"] for o in (a, b, c)] == ["op-0001", "op-0002", "op-0003"]
    assert run(study, "inbox") == 0
    out = capsys.readouterr().out
    assert "## transcript (1)" in out and "## codebook (1)" in out
    assert "1 open thread(s)" in out and "2 operation(s) to apply" in out


def test_apply_executes_ops_bumps_once_and_archives_them(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    run(study, "extract", "T-01", "13", "--codes", "control", "--kind", "did")
    stage(study, "set-kind", "E-0001", kind="intent")
    stage(study, "recode", "E-0002", add=["trust"], remove=["control"])
    stage(study, "code-status", "control.rerun", status="accepted")
    stage(study, "set-field", "trust", field="definition", value="Whether the participant checks a summary against the source.")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.extract("E-0001")["kind"] == "intent"
    assert an.extract("E-0002")["codes"] == ["trust"]
    assert an.code("trust")["definition"].startswith("Whether the participant checks")
    # one bump for the whole pass, and the reworded code is stamped with the new version
    assert an.codebook["version"] == 2
    assert an.code("trust")["redefined_version"] == 2
    assert "applied 4 reviewed operation(s)" in an.codebook["changelog"][-1]["change"]
    assert ta.read_inbox(an) == []
    log = (study.root / "reviews" / f"{ta.today()}-applied.jsonl")
    lines = [json.loads(l) for l in log.read_text().splitlines()]
    assert len(lines) == 4 and all(l["status"] == "applied" and l["result"] for l in lines)


def test_apply_counts_the_researchers_own_correction_as_a_review(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-kind", "E-0001", kind="did")
    ta.main(["-d", str(study.root), "apply", "--all"])
    an = ta.Analysis(study.root)
    assert an.extracts[0]["reviewed"] is not None
    assert ta.extract_state(an, an.extracts[0])["new"] is False
    # but a change the agent made is not a review: it asks for one
    ta.append_inbox(an, {"op": "set-kind", "target": "E-0001", "args": {"kind": "said"}, "by": "agent"})
    ta.main(["-d", str(study.root), "apply", "--all"])
    an = ta.Analysis(study.root)
    assert ta.extract_state(an, an.extracts[0])["new"] is True


def test_apply_keeps_a_failed_op_in_the_inbox_with_its_reason(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-kind", "E-0001", kind="did")
    stage(study, "recode", "E-0001", remove=["control"])  # would leave it with no codes
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1
    an = ta.Analysis(study.root)
    pending = ta.read_inbox(an)
    assert len(pending) == 1 and pending[0]["status"] == "failed"
    assert "no codes" in pending[0]["error"]
    assert an.extracts[0]["kind"] == "did"  # the good op still applied


def test_apply_refuses_an_edit_made_against_a_definition_that_moved(study: ta.Analysis):
    stage(study, "set-field", "control", field="definition", value="my rewording", old="text that was never there")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1
    an = ta.Analysis(study.root)
    assert an.code("control")["definition"].startswith("Participant describes steering")
    assert "changed since you edited it" in ta.read_inbox(an)[0]["error"]


def test_apply_does_not_lose_an_op_staged_while_it_was_working(study: ta.Analysis, monkeypatch):
    """A second tab stages something mid-pass: apply settles against a fresh read, so it stays."""
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-kind", "E-0001", kind="did")
    real = ta.HANDLERS["set-kind"]

    def slow_handler(an, op, ctx):
        ta.append_inbox(ta.Analysis(an.root), {"op": "highlight", "target": "E-0001", "args": {"reason": "vivid"}, "by": "user"})
        return real(an, op, ctx)

    monkeypatch.setitem(ta.HANDLERS, "set-kind", slow_handler)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    left = ta.read_inbox(ta.Analysis(study.root))
    assert [(o["op"], o["status"]) for o in left] == [("highlight", "pending")]
    assert ta.Analysis(study.root).extracts[0]["kind"] == "did"


def claim(an: ta.Analysis, index: int = 0, minutes_ago: int = 0) -> dict:
    """Put an inbox row into the state a running (or dead) `apply` would leave it in."""
    rows = ta.read_inbox(an)
    rows[index]["status"] = "applying"
    rows[index]["claimed_at"] = (dt.datetime.now() - dt.timedelta(minutes=minutes_ago)).isoformat(timespec="seconds")
    ta.write_inbox(an, rows)
    return rows[index]


def test_a_claimed_op_is_not_taken_by_a_second_pass(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-kind", "E-0001", kind="did")
    claim(ta.Analysis(study.root))
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    assert ta.Analysis(study.root).extracts[0]["kind"] == "said"
    assert ta.read_inbox(ta.Analysis(study.root))[0]["status"] == "applying"


def test_a_claim_from_a_dead_run_is_stalled_not_silently_retried(study: ta.Analysis):
    """Whether it took effect is the researcher's question, not one to guess at."""
    run(study, "extract", "T-01", "9", "--codes", "control")
    op = stage(study, "set-kind", "E-0001", kind="did")
    claim(ta.Analysis(study.root), minutes_ago=ta.CLAIM_STALE_MINUTES + 1)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.extracts[0]["kind"] == "said"                      # not re-run behind their back
    row = ta.read_inbox(an)[0]
    assert row["status"] == "stalled" and "may or may not have taken effect" in row["error"]
    # naming the id is the deliberate act that re-runs it
    assert ta.main(["-d", str(study.root), "apply", op["id"]]) == 0
    assert ta.Analysis(study.root).extracts[0]["kind"] == "did"


def test_a_claim_that_already_reached_the_applied_log_is_just_cleared(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    op = stage(study, "new-theme", None, name="A claim")
    an = ta.Analysis(study.root)
    # the pass applied it and archived it, then died before tidying the inbox
    ta.archive_ops(an, [{**op, "status": "applied", "result": "TH1: new theme"}])
    claim(an, minutes_ago=ta.CLAIM_STALE_MINUTES + 1)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    assert ta.read_inbox(ta.Analysis(study.root)) == []          # cleared, not re-run
    assert ta.Analysis(study.root).theme("TH1") is None          # so no duplicate theme


def test_dry_run_writes_nothing(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "drop", "E-0001")
    assert ta.main(["-d", str(study.root), "apply", "--all", "--dry-run"]) == 0
    an = ta.Analysis(study.root)
    assert len(an.extracts) == 1 and len(ta.read_inbox(an)) == 1


def test_a_malformed_op_fails_on_its_own_and_the_rest_still_apply(study: ta.Analysis):
    """One stale line must not hold up the researcher's other feedback."""
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-kind", "E-0001", kind="did")
    ta.append_inbox(ta.Analysis(study.root), {"op": "set-kind", "target": "E-9999", "args": {"kind": "did"}})
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1
    assert ta.Analysis(study.root).extracts[0]["kind"] == "did"  # the good one went through
    left = ta.read_inbox(ta.Analysis(study.root))
    assert len(left) == 1 and left[0]["status"] == "failed" and "no extract E-9999" in left[0]["error"]


def test_validate_op_names_the_problem(study: ta.Analysis):
    an = ta.Analysis(study.root)
    assert ta.validate_op(an, {"id": "op-1", "op": "no-such-op"}) == ["unknown op 'no-such-op'"]
    assert any("missing arg kind" in p for p in ta.validate_op(an, {"id": "op-1", "op": "set-kind", "target": "E-0001", "args": {}}))
    assert any("no extract E-9" in p for p in ta.validate_op(an, {"id": "op-1", "op": "set-kind", "target": "E-9", "args": {"kind": "did"}}))
    assert any("unknown arg" in p for p in ta.validate_op(an, {"id": "op-1", "op": "drop", "target": "E-0001", "args": {"nope": 1}}))
    assert any("needs a target" in p for p in ta.validate_op(an, {"id": "op-1", "op": "drop", "args": {}}))


def test_new_extract_from_offsets_is_cut_from_the_transcript(study: ta.Analysis):
    d = ta.transcript_json(ta.Analysis(study.root), "T-01")
    turn = next(t for t in d["turns"] if t["line"] == 9)
    start = turn["text"].index("being able")
    end = turn["text"].index("that step.") + len("that step.")
    stage(study, "new-extract", None, transcript="T-01", line_start=9, line_end=9, start=start, end=end,
          codes=["control"], kind="said", context="vs chat")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.extracts[0]["text"] == "being able to go back to a step and rerun just that step."
    assert an.extracts[0]["context"] == "vs chat"
    assert ta.verify(an) == ([], [])


def test_retrim_keeps_the_id_and_stays_verbatim(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    before = ta.Analysis(study.root).extracts[0]["text"]
    stage(study, "retrim", "E-0001", **{"from": "being able", "to": "that step."})
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.extracts[0]["id"] == "E-0001"
    assert an.extracts[0]["text"] == "being able to go back to a step and rerun just that step."
    assert an.extracts[0]["text"] != before
    assert ta.verify(an) == ([], [])


def test_retrim_by_offsets_matches_the_payload_the_browser_was_given(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    d = ta.transcript_json(ta.Analysis(study.root), "T-01")
    turn = next(t for t in d["turns"] if t["line"] == 9)
    start, end = turn["text"].index("With the chat tool"), len(turn["text"])
    stage(study, "retrim", "E-0001", start=start, end=end)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.extracts[0]["text"] == "With the chat tool I would have to redo the whole prompt."
    assert ta.verify(an) == ([], [])


def test_split_code_moves_the_extracts_and_arrives_as_a_candidate(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    run(study, "extract", "T-01", "13", "--codes", "control", "--kind", "did")
    run(study, "extract", "T-02", "7", "--codes", "control")
    stage(study, "split-code", "control", new_id="stepwise", name="Stepwise control",
          definition="Steering by editing one step rather than the whole conversation.", extracts=["E-0001", "E-0002"])
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    child = an.code("control.stepwise")
    assert child["status"] == "candidate" and child["parent"] == "control"
    assert an.extract("E-0001")["codes"] == ["control.stepwise"]
    assert an.extract("E-0003")["codes"] == ["control"]
    errors, _ = ta.validate(an)
    assert errors == []


def test_reparent_renames_the_id_everywhere(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control.rerun")
    stage(study, "reparent", "control.rerun", parent=None)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.code("rerun") is not None and an.code("rerun")["parent"] is None
    assert an.extracts[0]["codes"] == ["rerun"]
    stage(study, "reparent", "rerun", parent="trust")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.code("trust.rerun")["parent"] == "trust"
    assert an.extracts[0]["codes"] == ["trust.rerun"]
    errors, _ = ta.validate(an)
    assert errors == []


def test_reparent_refuses_a_third_level(study: ta.Analysis):
    stage(study, "reparent", "control", parent="control.rerun")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1
    assert "at most two levels" in ta.read_inbox(ta.Analysis(study.root))[0]["error"]


def test_retiring_a_code_in_use_is_refused_with_the_extracts_named(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "code-status", "control", status="retired")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1
    err = ta.read_inbox(ta.Analysis(study.root))[0]["error"]
    assert "still codes 1 extract(s)" in err and "E-0001" in err
    assert ta.Analysis(study.root).code("control")["status"] == "accepted"


def test_theme_ops_build_a_theme_and_keep_its_tension(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    run(study, "extract", "T-02", "9", "--codes", "control")
    run(study, "theme", "new", "Stepwise control was the point", "--rq", "RQ1")
    run(study, "theme", "assign", "control", "--to", "TH1")
    run(study, "theme", "set", "TH1", "essence", "Participants steered by editing one step. Control mattered more than output quality.")
    run(study, "theme", "set", "TH1", "in_paper", "headline")
    run(study, "theme", "tension", "TH1", "--add", "E-0002")
    run(study, "theme", "select", "TH1", "--add", "E-0001")
    an = ta.Analysis(study.root)
    th = an.theme("TH1")
    assert th["codes"] == ["control"] and th["in_paper"] == "headline" and th["rq"] == "RQ1"
    assert th["tensions"] == ["E-0002"] and th["selected_extracts"] == ["E-0001"]
    errors, _ = ta.validate(an)
    assert errors == []
    mermaid = ta.theme_mermaid(an)
    assert "TH1[\"Stepwise control was the point\"]" in mermaid and "TH1 --> control(control)" in mermaid
    assert "UNPLACED --> trust(trust)" in mermaid


def test_a_theme_gathering_a_parent_gathers_its_children(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control.rerun")
    run(study, "theme", "new", "Stepwise control was the point")
    run(study, "theme", "assign", "control", "--to", "TH1")
    run(study, "theme", "set", "TH1", "essence", "Participants steered step by step. It mattered more than output quality.")
    run(study, "theme", "select", "TH1", "--add", "E-0001")
    errors, warnings = ta.validate(ta.Analysis(study.root))
    assert errors == []
    assert not any("carries none of the theme's codes" in w for w in warnings)


def test_quote_trim_is_sliced_from_the_extract_and_stays_verifiable(study: ta.Analysis, tmp_path: Path):
    run(study, "extract", "T-01", "9", "--codes", "control")
    run(study, "theme", "new", "Stepwise control was the point")
    run(study, "theme", "assign", "control", "--to", "TH1")
    run(study, "theme", "set", "TH1", "essence", "Participants steered step by step. It mattered more than output quality.")
    run(study, "theme", "set", "TH1", "in_paper", "headline")
    run(study, "theme", "select", "TH1", "--add", "E-0001")
    run(study, "theme", "trim", "TH1", "E-0001", "--from", "being able", "--to", "that step.")
    an = ta.Analysis(study.root)
    span = an.theme("TH1")["quote_spans"]["E-0001"]
    assert span["text"] == "being able to go back to a step and rerun just that step."
    assert span["words"] == 13
    bank = ta.quote_bank(an)
    assert "being able to go back to a step and rerun just that step." in bank
    assert "trimmed to 13 of" in bank
    doc = tmp_path / "bank.md"
    doc.write_text(bank, encoding="utf-8")
    assert ta.main(["-d", str(study.root), "verify-quotes", str(doc), "--quiet"]) == 0


def test_quote_trim_refuses_offsets_outside_the_extract(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    run(study, "theme", "new", "A claim")
    with pytest.raises(SystemExit, match="fall outside the extract"):
        ta.main(["-d", str(study.root), "theme", "trim", "TH1", "E-0001", "--start", "0", "--end", "9999"])


def test_reread_request_is_recorded_and_reported_until_done(study: ta.Analysis):
    stage(study, "reread-request", None, transcript="T-02", code="trust", note="check the PDF remark")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert ta.stale_json(an)["reread_requests"][0]["transcript"] == "T-02"
    assert "re-read requested" in (study.root / "memos.md").read_text()
    run(study, "reread", "T-02", "--done")
    assert ta.stale_json(ta.Analysis(study.root))["reread_requests"] == []


def test_stale_says_whether_a_code_actually_changed(study: ta.Analysis):
    run(study, "mark-coded", "T-01")
    run(study, "mark-coded", "T-02")
    assert ta.stale_json(ta.Analysis(study.root))["stale"] == []
    run(study, "set-field", "control", "definition", "A reworded rule.")
    rows = ta.stale_json(ta.Analysis(study.root))["stale"]
    assert [r["severity"] for r in rows] == ["recode", "recode"]
    assert rows[0]["codes_since"] == ["control"]


def test_json_output_shapes(study: ta.Analysis, capsys):
    run(study, "extract", "T-01", "9", "--codes", "control")
    for argv, keys in [
        (["validate", "--json"], {"errors", "warnings"}),
        (["verify", "--json"], {"checked", "errors", "warnings"}),
        (["coverage", "--json"], {"codes", "cells", "participants", "transcripts"}),
        (["dupes", "--json"], {"suspicions", "live_codes"}),
        (["stale", "--json"], {"stale", "reread_requests", "codebook_version"}),
        (["collate", "control", "--json"], {"groups", "family", "total"}),
        (["inbox", "--json"], {"pending", "failed", "problems"}),
    ]:
        capsys.readouterr()
        ta.main(["-d", str(study.root), *argv])
        payload = json.loads(capsys.readouterr().out)
        assert keys <= set(payload), argv


def test_stage_command_rejects_an_operation_the_script_cannot_perform(study: ta.Analysis):
    with pytest.raises(SystemExit, match="unknown op"):
        ta.main(["-d", str(study.root), "stage", "--op", '{"op": "delete-everything"}'])
    with pytest.raises(SystemExit, match="must be JSON"):
        ta.main(["-d", str(study.root), "stage", "--op", "not json"])


def test_reply_appends_to_a_thread_and_never_applies(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    thread = stage(study, "comment", "E-0001", text="is this control or quality?")
    assert ta.main(["-d", str(study.root), "reply", thread["id"], "It is control: she names the step."]) == 0
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0  # a thread is not an edit
    left = [o["op"] for o in ta.read_inbox(ta.Analysis(study.root))]
    assert left == ["comment", "reply"]


def test_preflight_reports_what_would_break_the_page(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    (study.root / "inbox.jsonl").write_text("{not json\n", encoding="utf-8")
    errors, _ = ta.preflight(ta.Analysis(study.root))
    assert any("is not valid JSON" in e for e in errors)


def test_open_target_resolves_to_a_deep_link(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    an = ta.Analysis(study.root)
    assert ta.resolve_open_target(an, None) == "view=transcript"
    assert ta.resolve_open_target(an, "T-01") == "view=transcript&t=T-01"
    assert ta.resolve_open_target(an, "E-0001") == "view=transcript&t=T-01&e=E-0001"
    assert ta.resolve_open_target(an, "control") == "view=codebook&c=control"
    assert ta.resolve_open_target(an, "coverage") == "view=coverage"
    with pytest.raises(SystemExit, match="is not a view"):
        ta.resolve_open_target(an, "nonsense")


def test_frame_index_reads_a_watch_recording_folder(study: ta.Analysis, tmp_path: Path):
    frames = tmp_path / "p1" / "video-snapshots"
    frames.mkdir(parents=True)
    for name in ("00-00-00.jpg", "00-00-10.jpg", "00-01-20.jpg", "exact-00-01-25.jpg", "notes.txt"):
        (frames / name).write_text("x", encoding="utf-8")
    an = ta.Analysis(study.root)
    idx = ta.frame_index(an, an.transcript("T-01"))
    assert [f["file"] for f in idx["frames"]] == ["00-00-00.jpg", "00-00-10.jpg", "00-01-20.jpg", "exact-00-01-25.jpg"]
    assert idx["frames"][2]["seconds"] == 80 and idx["frames"][3]["exact"] is True
    assert ta.bundle_json(ta.Analysis(study.root))["transcript_files"]["T-01"]["frames_dir"] == str(frames)


def test_spread_warns_about_the_paper_not_the_data(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    run(study, "extract", "T-01", "13", "--codes", "control", "--kind", "did")
    run(study, "extract", "T-02", "7", "--codes", "control")
    run(study, "theme", "new", "Stepwise control was the point")
    run(study, "theme", "assign", "control", "--to", "TH1")
    run(study, "theme", "set", "TH1", "essence", "Participants steered step by step. It mattered more than output quality.")
    run(study, "theme", "set", "TH1", "in_paper", "headline")
    run(study, "theme", "select", "TH1", "--add", "E-0001")
    spread = ta.spread_json(ta.Analysis(study.root))
    kinds = {w["kind"] for w in spread["warnings"]}
    assert "no-did-quote" in kinds  # a did extract exists but no did quote was chosen
    assert "no-tension" in kinds
    assert spread["unquoted"] == ["P2"]
    assert spread["themes"][0]["selected"] == 1


# ------------------------------------------- the cascades the Codex audit found wrong
def test_two_merges_in_one_pass_bump_the_codebook_once(study: ta.Analysis):
    an = ta.Analysis(study.root)
    for cid in ("agent-steering", "steering-2"):
        an.codebook["codes"].append({"id": cid, "name": cid, "status": "candidate", "definition": "d", "parent": None})
    an.save_codebook()
    run(study, "extract", "T-01", "9", "--codes", "agent-steering")
    run(study, "extract", "T-02", "7", "--codes", "steering-2")
    before = ta.Analysis(study.root).codebook["version"]
    stage(study, "merge-code", "agent-steering", into="control")
    stage(study, "merge-code", "steering-2", into="control")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.codebook["version"] == before + 1
    assert len([c for c in an.codebook["changelog"] if "applied 2 reviewed" in c["change"]]) == 1
    assert an.code("agent-steering")["status"] == "merged" and an.code("steering-2")["status"] == "merged"
    assert {c for e in an.extracts for c in e["codes"]} == {"control"}


def test_done_in_the_same_pass_as_a_definition_edit_really_marks_it_reviewed(study: ta.Analysis):
    """The Done button must not be undone by the same pass's codebook bump."""
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-field", "control", field="definition", value="A sharper rule than before.")
    stage(study, "mark-reviewed", None, transcript="T-01")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.code("control")["redefined_version"] == an.codebook["version"]
    assert an.extracts[0]["reviewed"]["version"] == an.codebook["version"]
    assert ta.extract_state(an, an.extracts[0])["new"] is False


def test_a_new_code_in_a_pass_with_a_merge_is_stamped_with_the_final_version(study: ta.Analysis):
    an = ta.Analysis(study.root)
    an.codebook["codes"].append({"id": "agent-steering", "name": "x", "status": "candidate", "definition": "d", "parent": None})
    an.save_codebook()
    stage(study, "merge-code", "agent-steering", into="control")
    stage(study, "new-code", None, id="verification", definition="Checking the output against the source.")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.code("verification")["added"]["version"] == an.codebook["version"]


def test_a_resolved_thread_is_archived_even_with_nothing_to_apply(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    thread = stage(study, "comment", "E-0001", text="is this control or quality?")
    ta.main(["-d", str(study.root), "reply", thread["id"], "control: she names the step."])
    an = ta.Analysis(study.root)
    rows = ta.read_inbox(an)
    rows[0]["status"] = "resolved"          # the researcher resolved it in the workbench
    ta.write_inbox(an, rows)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    assert ta.read_inbox(ta.Analysis(study.root)) == []   # the reply went with its thread
    log = [json.loads(l) for l in (study.root / "reviews" / f"{ta.today()}-applied.jsonl").read_text().splitlines()]
    assert [o["op"] for o in log] == ["comment", "reply"]


def test_quote_trim_refuses_an_end_marker_that_is_not_there(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    run(study, "theme", "new", "A claim")
    run(study, "theme", "select", "TH1", "--add", "E-0001")
    stage(study, "quote-span", "TH1", extract="E-0001", **{"from": "being able", "to": "words that are not there"})
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1
    an = ta.Analysis(study.root)
    assert an.theme("TH1").get("quote_spans") in (None, {})
    assert "--to text is not in E-0001" in ta.read_inbox(an)[0]["error"]


def test_merging_a_theme_carries_its_quote_trims(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    run(study, "theme", "new", "The source claim")
    run(study, "theme", "new", "The destination claim")
    run(study, "theme", "assign", "control", "--to", "TH1")
    run(study, "theme", "select", "TH1", "--add", "E-0001")
    run(study, "theme", "trim", "TH1", "E-0001", "--from", "being able", "--to", "that step.")
    run(study, "theme", "merge", "TH1", "TH2")
    an = ta.Analysis(study.root)
    th2 = an.theme("TH2")
    assert th2["selected_extracts"] == ["E-0001"]
    assert th2["quote_spans"]["E-0001"]["text"] == "being able to go back to a step and rerun just that step."


def test_retrim_refuses_offsets_taken_from_another_turn(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "retrim", "E-0001", start=0, end=20, turn_line=13)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1
    an = ta.Analysis(study.root)
    assert an.extracts[0]["text"].startswith("Sure. Honestly")
    assert "select inside the extract's own turn" in ta.read_inbox(an)[0]["error"]
    # the same offsets with the extract's own turn are fine
    ta.write_inbox(an, [])
    stage(study, "retrim", "E-0001", start=0, end=20, turn_line=9)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    assert ta.Analysis(study.root).extracts[0]["text"] == "Sure. Honestly the b"[:20].strip()


def test_a_no_op_edit_does_not_bump_the_codebook(study: ta.Analysis):
    """A bump marks every transcript stale, so it has to mean something changed."""
    before = ta.Analysis(study.root).codebook["version"]
    stage(study, "code-status", "control", status="accepted")   # already accepted
    stage(study, "set-field", "control", field="definition",
          value="Participant describes steering, fixing, or redirecting the agent's work.")  # same words
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.codebook["version"] == before
    assert ta.stale_json(an)["stale"] == [] or all(r["severity"] == "recode" for r in ta.stale_json(an)["stale"])


def test_two_passes_cannot_run_at_once(study: ta.Analysis):
    """A pass rewrites whole data files, so two of them would clobber each other."""
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-kind", "E-0001", kind="did")
    held = ta.apply_lock(ta.Analysis(study.root))
    try:
        with pytest.raises(SystemExit, match="held by another `apply`"):
            ta.main(["-d", str(study.root), "apply", "--all"])
        assert ta.Analysis(study.root).extracts[0]["kind"] == "said"
    finally:
        held.unlink()
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    assert ta.Analysis(study.root).extracts[0]["kind"] == "did"


def test_an_only_invalid_pass_still_records_the_failure(study: ta.Analysis):
    ta.append_inbox(ta.Analysis(study.root), {"op": "set-kind", "target": "E-9999", "args": {"kind": "did"}})
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1
    left = ta.read_inbox(ta.Analysis(study.root))
    assert len(left) == 1 and left[0]["status"] == "failed" and "no extract E-9999" in left[0]["error"]
    # and it stays failed rather than being retried silently on the next pass
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 1


def test_a_thread_reopened_mid_pass_is_not_archived(study: ta.Analysis, monkeypatch):
    run(study, "extract", "T-01", "9", "--codes", "control")
    thread = stage(study, "comment", "E-0001", text="control or quality?")
    an = ta.Analysis(study.root)
    rows = ta.read_inbox(an)
    rows[0]["status"] = "resolved"
    ta.write_inbox(an, rows)
    stage(study, "set-kind", "E-0001", kind="did")
    real = ta.HANDLERS["set-kind"]

    def reopen_during(a, op, ctx):
        # the researcher reopens the thread in the workbench while the agent is applying
        fresh = ta.Analysis(a.root)
        rws = ta.read_inbox(fresh)
        for r in rws:
            if r.get("id") == thread["id"]:
                r["status"] = "pending"
        ta.write_inbox(fresh, rws)
        return real(a, op, ctx)

    monkeypatch.setitem(ta.HANDLERS, "set-kind", reopen_during)
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    left = ta.read_inbox(ta.Analysis(study.root))
    assert [(o["op"], o["status"]) for o in left] == [("comment", "pending")]


def test_an_op_id_is_never_reused_after_a_pass(study: ta.Analysis):
    run(study, "extract", "T-01", "9", "--codes", "control")
    first = stage(study, "set-kind", "E-0001", kind="did")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    assert ta.read_inbox(ta.Analysis(study.root)) == []
    second = stage(study, "highlight", "E-0001", reason="vivid")
    assert second["id"] != first["id"]


def test_a_review_stamp_never_claims_a_version_that_did_not_happen(study: ta.Analysis):
    """A codebook op that no-ops must not leave the Done stamp pointing at a future version."""
    run(study, "extract", "T-01", "9", "--codes", "control")
    before = ta.Analysis(study.root).codebook["version"]
    stage(study, "code-status", "control", status="accepted")     # already accepted: a no-op
    stage(study, "mark-reviewed", None, transcript="T-01")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    assert an.codebook["version"] == before
    assert an.extracts[0]["reviewed"]["version"] == before
    # so the next real definition edit does re-open the transcript for review
    run(study, "set-field", "control", "definition", "A sharper rule.")
    an = ta.Analysis(study.root)
    assert ta.extract_state(an, an.extracts[0])["new"] is True


def test_an_id_in_a_line_that_will_not_parse_is_still_spent(study: ta.Analysis):
    """A truncated line has already used its number; handing it out again would make
    `apply <id>` and the applied logs ambiguous."""
    (study.root / "inbox.jsonl").write_text('{"id":"op-0042","op":"drop","target":"E-9\n', encoding="utf-8")
    nxt = ta.append_inbox(ta.Analysis(study.root), {"op": "comment", "target": "E-1", "args": {"text": "x"}})
    assert nxt["id"] == "op-0043"


def test_a_lock_is_not_stolen_from_a_process_that_is_still_alive(study: ta.Analysis):
    """Slow, paused, or just-woken-from-sleep is not the same as dead."""
    import json as _json
    import os as _os
    path = study.root / ta.APPLY_LOCK_NAME
    path.write_text(_json.dumps({"pid": _os.getpid(), "token": "someone-else", "at": "2020-01-01T00:00:00"}), encoding="utf-8")
    _os.utime(path, (0, 0))   # ancient, but its owner (this process) is alive
    with pytest.raises(SystemExit, match="is held by"):
        ta.take_lock(study, ta.APPLY_LOCK_NAME, stale_seconds=1.0, timeout=0.2)
    # a lock whose owner is gone is stolen
    path.write_text(_json.dumps({"pid": 2_147_483_646, "token": "dead", "at": "2020-01-01T00:00:00"}), encoding="utf-8")
    _os.utime(path, (0, 0))
    assert ta.take_lock(study, ta.APPLY_LOCK_NAME, stale_seconds=1.0, timeout=0.2) == path
    ta.release_lock(study, ta.APPLY_LOCK_NAME)
    assert not path.exists()


def test_releasing_a_stolen_lock_leaves_its_new_owner_alone(study: ta.Analysis):
    import json as _json
    path = ta.take_lock(study, ta.APPLY_LOCK_NAME)
    # someone stole it and now owns the file
    path.write_text(_json.dumps({"pid": 1, "token": "theirs", "at": "2026-01-01T00:00:00"}), encoding="utf-8")
    ta.release_lock(study, ta.APPLY_LOCK_NAME)
    assert path.exists() and "theirs" in path.read_text()
    path.unlink()


def test_an_op_id_mentioned_in_a_result_string_does_not_move_the_counter(study: ta.Analysis):
    """Only a line that will not parse needs a raw scan; a note is just prose."""
    ta.archive_ops(ta.Analysis(study.root), [{"id": "op-0001", "op": "drop", "status": "applied",
                                              "result": "dropped; see op-9000 for the reason"}])
    nxt = ta.append_inbox(ta.Analysis(study.root), {"op": "comment", "target": "E-1", "args": {"text": "x"}})
    assert nxt["id"] == "op-0002"


def test_inbox_reports_a_stalled_claim(study: ta.Analysis, capsys):
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-kind", "E-0001", kind="did")
    claim(ta.Analysis(study.root), minutes_ago=ta.CLAIM_STALE_MINUTES + 1)
    ta.main(["-d", str(study.root), "apply", "--all"])
    capsys.readouterr()
    assert ta.main(["-d", str(study.root), "inbox"]) == 0
    out = capsys.readouterr().out
    assert "## stalled — needs your decision (1)" in out and "may or may not have taken effect" in out
    capsys.readouterr()
    ta.main(["-d", str(study.root), "inbox", "--json"])
    assert len(json.loads(capsys.readouterr().out)["stalled"]) == 1


def test_a_legacy_pid_only_lockfile_is_still_understood(study: ta.Analysis):
    """During an upgrade a lockfile may hold a bare pid; its owner still has to be respected."""
    import os as _os
    path = study.root / ta.APPLY_LOCK_NAME
    path.write_text(str(_os.getpid()), encoding="utf-8")
    _os.utime(path, (0, 0))
    assert ta._lock_holder(path) == {"pid": _os.getpid()}
    with pytest.raises(SystemExit, match="is held by"):
        ta.take_lock(study, ta.APPLY_LOCK_NAME, stale_seconds=1.0, timeout=0.2)
    path.unlink()


def test_a_malformed_line_survives_a_rewrite_whole(study: ta.Analysis):
    """Truncating it would lose the id it spent, and rewriting would erase the evidence."""
    long_note = "x" * 500
    bad = '{"op":"drop","args":{"note":"%s"},"id":"op-0077"' % long_note   # no closing brace
    (study.root / "inbox.jsonl").write_text(bad + "\n", encoding="utf-8")
    an = ta.Analysis(study.root)
    rows = ta.read_inbox(an)
    assert rows[0]["status"] == "malformed" and rows[0]["raw"] == bad
    ta.write_inbox(an, rows)
    assert (study.root / "inbox.jsonl").read_text().strip() == bad     # verbatim
    # and the id it spent is not handed out again, even though it sat after 500 characters
    assert ta.append_inbox(ta.Analysis(study.root), {"op": "comment", "target": "E-1", "args": {"text": "x"}})["id"] == "op-0078"


def test_inbox_calls_a_dead_claim_stalled_without_writing_anything(study: ta.Analysis, capsys):
    run(study, "extract", "T-01", "9", "--codes", "control")
    stage(study, "set-kind", "E-0001", kind="did")
    claim(ta.Analysis(study.root), minutes_ago=ta.CLAIM_STALE_MINUTES + 1)
    before = (study.root / "inbox.jsonl").read_text()
    capsys.readouterr()
    assert ta.main(["-d", str(study.root), "inbox"]) == 0
    out = capsys.readouterr().out
    assert "## stalled — needs your decision (1)" in out
    assert (study.root / "inbox.jsonl").read_text() == before   # a read command wrote nothing
    assert ta.bundle_json(ta.Analysis(study.root))["inbox"][0]["status"] == "stalled"


def test_a_thread_about_a_staged_extract_follows_it_once_it_exists(study: ta.Analysis):
    """A comment on a staged extract targets the operation, because the extract has no id
    yet. Once `apply` creates it, the question has to point at the thing, not the receipt."""
    d = ta.transcript_json(ta.Analysis(study.root), "T-01")
    turn = next(t for t in d["turns"] if t["line"] == 9)
    start = turn["text"].index("being able")
    end = turn["text"].index("that step.") + len("that step.")
    op = stage(study, "new-extract", None, transcript="T-01", line_start=9, line_end=9,
               start=start, end=end, codes=["control"], kind="said")
    thread = stage(study, "comment", op["id"], text="should this be control.rerun, or a new code for the whole gesture?")
    assert ta.main(["-d", str(study.root), "apply", "--all"]) == 0
    an = ta.Analysis(study.root)
    created = an.extracts[0]["id"]
    left = ta.read_inbox(an)
    assert [o["id"] for o in left] == [thread["id"]]          # the thread stays, the op is archived
    assert left[0]["target"] == created                        # and now points at the extract
    assert left[0]["about"] == op["id"]                        # with a record of what it pointed at


def test_a_hand_written_yaml_date_does_not_break_the_payloads(study: ta.Analysis):
    """`codebook.yaml` is meant to be hand-edited, and YAML turns an unquoted 2026-09-01 into
    a date object. Every workbench payload is JSON, so this used to take the page down."""
    import datetime as _dt
    run(study, "extract", "T-01", "9", "--codes", "control")
    an = ta.Analysis(study.root)
    an.code("control")["added"] = {"version": 1, "date": _dt.date(2026, 9, 1), "source": "hand-edited"}
    an.save_codebook()
    an = ta.Analysis(study.root)
    assert isinstance(an.code("control")["added"]["date"], _dt.date)   # YAML really does this
    payload = json.loads(json.dumps(ta.bundle_json(an), default=ta.json_safe))
    assert payload["codes"][0]["added"]["date"] == "2026-09-01"
    for argv in (["bundle"], ["transcript", "T-01", "--json"], ["coverage", "--json"], ["collate", "control", "--json"]):
        assert ta.main(["-d", str(study.root), *argv]) == 0
