"""Pins the seams of voice_check.py that would fail silently: LaTeX comment
stripping, macro expansion, the sentence splitter, what is counted where
(body, caption, \\Description, quote environments), the colon heuristic, the
voice-ok exemptions, the markdown mode, and the verdict thresholds. Run:

    cd ~/.claude/skills/write-like-joseph && python3 -m pytest tests -q
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import voice_check as vc  # noqa: E402

FIX = Path(__file__).parent / "fixtures"
REGISTRY = FIX / "registry.json"
# The suite scores with its own synthetic registry, never a real one, so it passes in a clone with no private/.
vc.use_registry(vc.load_registry(REGISTRY), REGISTRY)


# ---------------------------------------------------------------- comments and splitting

def test_strip_comments_honours_escaped_percent():
    code, comment = vc.strip_comments(r"50\% of users % note here")
    assert code == r"50\% of users "
    assert comment == " note here"
    assert vc.strip_comments(r"no comment")[1] == ""
    assert vc.strip_comments(r"\\% starts a comment")[0] == "\\\\"


def test_parse_allow():
    assert vc.parse_allow(" voice-ok") == {"*"}
    assert vc.parse_allow(" voice-ok: every colon-clause") == {"every", "colon-clause"}
    assert vc.parse_allow(" unrelated note") is None


@pytest.mark.parametrize("text, n", [
    ("We used e.g. two tools. They worked.", 2),
    ("Smith et al. found this. We agree.", 2),
    ("The mean was 3.5 words. Then 4.2 words followed.", 2),
    ('She said "no." Then she left.', 2),
    ("It failed (see Fig. 3). We retried.", 2),
    ("One sentence with no terminal punctuation", 1),
    ("Did it work? Yes. Mostly!", 3),
    ("Version 2.0 shipped; users liked it.", 1),
])
def test_split_sentences(text, n):
    assert len(vc.split_sentences(text)) == n


def test_words_exclude_placeholders_and_numbers():
    assert vc.n_words("Participants QUOTE said 3 things MATH") == 3
    assert vc.sent_len("a b 3 QUOTE") == 4


# ---------------------------------------------------------------- latex conversion

def test_latex_to_text_expands_macros_and_drops_noise():
    defs = vc.collect_defs([FIX / "main.tex"])
    assert defs["sysname"] == (0, "Lanternfish")
    assert "chip" not in defs, "tikz-bodied macros are not expanded"
    assert defs["jc"][1] is None, "author-note macros are dropped"
    t = vc.latex_to_text(r"\sysname{} helped \persona{} see \triple{LIME}{\edgeup{increases}}{trust}\cite{a} (\S\ref{s}) $x=y$ 50\% --- done.", defs)
    assert t == "Lanternfish helped Odile see LIME increases trust (§) MATH 50% — done."


def test_latex_to_text_keeps_last_argument_and_quotes():
    assert vc.latex_to_text(r"\textbf{bold} and \textcolor{blue}{blue} ``quoted'' text") == "bold and blue “quoted” text"
    long = vc.latex_to_text("she said ``this is exactly the kind of overview I wanted to have.'' Then left.")
    assert long == "she said QUOTE. Then left."


def test_mask_quotes_keeps_short_terms():
    assert vc.mask_quotes('the "tab overload" problem') == 'the "tab overload" problem'
    assert " ".join(vc.mask_quotes('he said "one two three four five six" and left').split()) == "he said QUOTE and left"


# ---------------------------------------------------------------- segments: what is counted where

@pytest.fixture(scope="module")
def paper():
    unknown = vc.Counter()
    segs, defs, prose = vc.load_segments([FIX / "main.tex", FIX / "section.tex"], [], unknown)
    result = vc.analyze(segs)
    return segs, result


def test_segment_kinds(paper):
    segs, _ = paper
    kinds = vc.Counter(s.kind for s in segs)
    assert kinds["caption"] == 1 and kinds["description"] == 1
    texts = " ".join(s.text for s in segs if s.kind == "body")
    assert "Lanternfish" in texts and "Odile kept every concept" in texts
    assert "TODO tighten" not in texts, "author-note macro content must not leak"
    assert "never use every tab" not in texts, "quote environments are participant speech"
    assert "Findings" not in texts.split("Lanternfish")[0], "headings are not prose"
    assert "\\" not in texts and "{" not in texts


def test_counts_on_fixture(paper):
    _, r = paper
    c = r["counts"]
    assert c["every"] == 2, "voice-ok exempts the first paragraph; caption and quote env are not rated"
    assert r["allowed"] >= 1
    assert c["what-cleft"] == 1
    assert c["where-here"] == 1
    assert c["colon-clause"] == 1 and c["colon-all"] == 2
    assert c["dash"] == 2, "--- in prose and — in a list item"
    assert c["t1-harness"] == 1, "Tier 1 words in captions count"
    assert c["t1-delve"] == 0, "\\Description alt text is not rendered"
    assert c["rather-than"] == 1
    assert c["semicolon"] == 1
    assert c["never"] == 0


def test_colon_kind():
    assert vc.colon_kind("The logs agree", " removals came mostly from four participants") == "clause"
    assert vc.colon_kind("Our analysis draws on three sources of data", " interaction logs, the artifacts participants produced, and interviews") == "list"
    assert vc.colon_kind("There are two modes of co-execution", " continuous and stepwise") == "list"
    assert vc.colon_kind("Comprehensive", " how well the summary provides an overview of the entire section") == "list"
    assert vc.colon_kind("P0 described diverging then converging", " they QUOTE") == "quote"
    assert vc.colon_kind("the benefit has a diminishing return", " as the total number of tabs increases, users lose track") == "clause"


# ---------------------------------------------------------------- markdown mode

def test_markdown_segments_and_counts():
    segs = vc.markdown_segments(FIX / "draft.md")
    kinds = vc.Counter(s.kind for s in segs)
    assert kinds["body"] >= 3
    r = vc.analyze(segs)
    c = r["counts"]
    assert c["every"] == 0, "voice-ok comment exempts its paragraph; blockquote, code and table are dropped"
    assert c["colon-clause"] == 1
    assert c["dash"] == 1, "-- becomes an en-dash used as punctuation"
    assert c["rather-than"] == 1
    assert c["never"] == 0


def test_allowlist_star_exempts_whole_pattern():
    segs = vc.markdown_segments(FIX / "draft.md")
    r = vc.analyze(segs, allowlist=[("rather-than", "*")])
    assert r["counts"]["rather-than"] == 0 and r["allowed"] >= 1


# ---------------------------------------------------------------- statistics and verdicts

def test_poisson():
    assert abs(vc.poisson_cdf(0, 1.0) - 0.3679) < 1e-3
    assert abs(vc.poisson_sf(1, 1.0) - 0.6321) < 1e-3
    assert vc.poisson_sf(0, 5.0) == 1.0
    assert vc.poisson_sf(3, 0.0) == 0.0
    assert abs(vc.poisson_sf(11, 1.7)) < 1e-5


def _baseline(**counts):
    words = 100_000
    base = {p.id: 0 for p in vc.PATTERNS}
    base.update(counts)
    return {"words": words, "counts": base, "sentence_length": {}}


def _result(words, **counts):
    c = {p.id: 0 for p in vc.PATTERNS}
    c.update(counts)
    return {"words": words, "counts": c}


def test_verdicts():
    base = _baseline(every=15, **{"colon-clause": 20, "the-same": 120, "suggests": 55, "at-once": 0})
    rows = {r["id"]: r for r in vc.score(_result(10_000, every=11), base)}
    assert rows["every"]["verdict"] == "FAIL", "11 per 10k against 1.5 is the audited Claude draft"
    rows = {r["id"]: r for r in vc.score(_result(10_000, every=3), base)}
    assert rows["every"]["verdict"] == "above", "3 against 1.5 expected is not significant"
    rows = {r["id"]: r for r in vc.score(_result(10_000, every=1), base)}
    assert rows["every"]["verdict"] == "ok"
    rows = {r["id"]: r for r in vc.score(_result(10_000, **{"the-same": 30}), base)}
    assert rows["the-same"]["verdict"] == "WARN"
    rows = {r["id"]: r for r in vc.score(_result(10_000, **{"at-once": 1}), base)}
    assert rows["at-once"]["verdict"] == "WARN", "a habit that is 0 in the corpus warns on one hit"
    rows = {r["id"]: r for r in vc.score(_result(10_000, suggests=0), base)}
    assert rows["suggests"]["verdict"] == "LOW"
    rows = {r["id"]: r for r in vc.score(_result(10_000, **{"t1-delve": 1}), base)}
    assert rows["t1-delve"]["verdict"] == "FAIL"
    rows = {r["id"]: r for r in vc.score(_result(300, every=1), base)}
    assert rows["every"]["verdict"] == "above", "a single hit in a short abstract never fails"


def test_cli_exit_codes(tmp_path):
    base = vc.build_baseline.__doc__ or ""  # smoke: function exists
    bl = tmp_path / "b.json"
    import json
    json.dump(_baseline(every=15), bl.open("w"))
    rc = vc.main([str(FIX / "main.tex"), str(FIX / "section.tex"), "--baseline", str(bl), "--registry", str(REGISTRY)])
    assert rc == 1, "the fixture has a What-cleft, a Where-opener, dashes and a Tier 1 word"
    rc = vc.main([str(FIX / "draft.md"), "--baseline", str(bl), "--registry", str(REGISTRY)])
    assert rc == 1, "the markdown fixture has an en-dash used as punctuation"


# ---------------------------------------------------------------- regressions from the 2026-09-07 Codex audit

def test_caption_closing_line_also_closes_environment(tmp_path):
    """A caption that ends on the same line as \\end{figure} must not leave the rest of the file skipped."""
    tex = tmp_path / "s.tex"
    tex.write_text(
        "Intro sentence here.\n\n"
        "\\begin{figure}\n  \\caption{What the figure shows is a canvas\n    with every node.} \\end{figure}\n\n"
        "After the figure, every canvas and every relation were kept by participants.\n"
    )
    segs = vc.latex_segments(tex, {})
    body = [s for s in segs if s.kind == "body"]
    assert any("After the figure" in s.text for s in body), "prose after the figure must survive"
    r = vc.analyze(segs)
    assert r["counts"]["every"] == 2, "captions are not rated; the paragraph after the figure is"
    assert r["counts"]["what-cleft"] == 0, "sentence-shape bans do not apply to captions (plan D4)"


def test_show_allowed_lists_fully_exempted_patterns(tmp_path, capsys):
    import json
    bl = tmp_path / "b.json"
    json.dump(_baseline(every=15, **{"rather-than": 20}), bl.open("w"))
    allow = tmp_path / "voice-check.allow"
    allow.write_text("rather-than: *\n")
    vc.main([str(FIX / "draft.md"), "--baseline", str(bl), "--registry", str(REGISTRY), "--allow", str(allow), "--list", "--show-allowed"])
    out = capsys.readouterr().out
    assert "'rather than'" in out and "allowed" in out


def test_calibrate_without_corpus_exits(tmp_path):
    with pytest.raises(SystemExit):
        vc.calibrate(tmp_path)


def test_no_prose_is_an_error_not_a_pass(tmp_path):
    import json
    bl = tmp_path / "b.json"
    json.dump(_baseline(), bl.open("w"))
    md = tmp_path / "empty.md"
    md.write_text("# Only a heading\n\n> and a quote\n")
    assert vc.main([str(md), "--baseline", str(bl), "--registry", str(REGISTRY)]) == 2


def test_serves_as_matches_acts_as():
    rx = vc.PAT_BY_ID["serves-as"].rx
    assert all(rx.search(x) for x in ["acts as", "act as", "acted as", "serves as", "serving as"])
    assert not rx.search("the act was")


def test_same_line_content_after_a_caption_closes(tmp_path):
    """Compact layouts: a wrapped \\Description followed by \\caption{...}\\end{figure} After ... on one line."""
    tex = tmp_path / "c.tex"
    tex.write_text(
        "\\begin{figure}\n  \\Description{Alt text that wraps\n    onto a second line.} \\caption{A harnessed view.}\\end{figure} After the figure, every canvas stayed.\n\n"
        "\\begin{figure}\\caption{Single line.}\\end{figure} Trailing prose with every relation kept.\n"
    )
    segs = vc.latex_segments(tex, {})
    kinds = vc.Counter(s.kind for s in segs)
    assert kinds["description"] == 1 and kinds["caption"] == 2
    body = " ".join(s.text for s in segs if s.kind == "body")
    assert "After the figure" in body and "Trailing prose" in body
    r = vc.analyze(segs)
    assert r["counts"]["t1-harness"] == 1 and r["counts"]["every"] == 2


def test_caption_only_input_is_rejected_even_with_include_captions(tmp_path):
    import json
    bl = tmp_path / "b.json"
    json.dump(_baseline(), bl.open("w"))
    tex = tmp_path / "only.tex"
    tex.write_text("\\begin{figure}\\caption{A caption with several words in it.}\\end{figure}\n")
    assert vc.main([str(tex), "--baseline", str(bl), "--registry", str(REGISTRY), "--include-captions"]) == 2


# ---------------------------------------------------------------- the registry is data

def test_registry_validation_fails_loudly(tmp_path):
    import json

    def rejects(rows):
        p = tmp_path / "r.json"
        json.dump({"version": 1, "patterns": rows}, p.open("w"))
        with pytest.raises(SystemExit):
            vc.load_registry(p)

    rejects([{"id": "a", "class": "ban", "regex": "x"}, {"id": "a", "class": "ban", "regex": "y"}])  # duplicate id
    rejects([{"id": "a", "class": "severe", "regex": "x"}])                                          # unknown class
    rejects([{"id": "a", "class": "ban", "group": "misc", "regex": "x"}])                            # unknown group
    rejects([{"id": "a", "class": "ban", "regex": "x", "matcher": "colon_any"}])                     # both regex and matcher
    rejects([{"id": "a", "class": "ban", "matcher": "nope"}])                                        # unknown matcher
    rejects([{"id": "a", "class": "ban", "regex": "("}])                                             # bad regex
    good = tmp_path / "g.json"
    json.dump({"version": 1, "patterns": [{"id": "x", "class": "watch", "regex": "Both\\b", "start": True}]}, good.open("w"))
    [p] = vc.load_registry(good)
    assert p.rx.search("Both groups") and p.rx.search("“Both groups")
    assert not p.rx.search("both groups") and not p.rx.search("and Both"), "sentence-initial rows are anchored and case-sensitive"


def test_shipped_example_registry_loads_and_takes_no_position():
    pats = vc.load_registry(Path(__file__).resolve().parents[1] / "scripts" / "patterns.example.json")
    assert len(pats) > 50
    assert not any(p.cls == "p0" for p in pats), "the example does not say which habits are P0 for anyone"
    assert any(p.fn is not None for p in pats), "both named matchers are demonstrated"
    assert {p.id for p in pats} >= {"dash", "every", "colon-clause", "rather-than", "serves-as"}
