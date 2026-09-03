#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6"]
# ///
"""ta.py - bookkeeping and audit for a Braun & Clarke thematic analysis.

The analysis folder holds four data files (see references/data-model.md):

  study.yaml      roster of participants + transcripts, analytic stance
  codebook.yaml   codes (at most two levels), definitions, status, changelog
  extracts.jsonl  one coded data extract per line, verbatim, with a locator
  themes.yaml     candidate/accepted themes, the codes they gather, chosen quotes

Every quote that enters the analysis goes through `extract`, which copies the
text out of the transcript file itself, so a quote can never be typed from
memory. `verify` re-checks every stored extract against its transcript, and
`verify-quotes` checks the quotes in any markdown document (a review plan, a
paper draft) against the transcripts. Run with `uv run ta.py ...` (pyyaml is
declared above) or with a python3 that has pyyaml installed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit(
        "pyyaml is not installed. Run this script as `uv run ta.py ...` "
        "(its dependencies are declared in the header) or `pip install pyyaml`."
    )

TURN_RE = re.compile(r"^\[(\d{1,2}:\d{2}:\d{2})\]\s+(.+?):\s+(.*)$")
PLAIN_TURN_RE = re.compile(r"^([A-Z][\w .'\-()]{0,40}?):\s+(.*)$")
CODE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-]*(\.[a-z0-9][a-z0-9\-]*)?$")
EXTRACT_ID_RE = re.compile(r"^E-\d{4,}$")
PARTICIPANT_REF_RE = re.compile(r"\(?\b([A-Z]{1,3}\d{1,3})\b\)?")

CODE_STATUSES = {"candidate", "accepted", "merged", "retired"}
THEME_STATUSES = {"candidate", "accepted", "merged", "dropped"}
IN_PAPER = {"undecided", "headline", "secondary", "no"}
EXTRACT_KINDS = {"said", "did", "intent"}
ROLES = {"participant", "interviewer", "researcher", "other", "unknown"}

STOPWORDS = {
    "a", "an", "the", "of", "to", "in", "on", "for", "and", "or", "with",
    "as", "at", "by", "is", "are", "be", "that", "this", "it", "its", "vs",
    "versus", "about", "from", "their", "they", "user", "users", "participant",
    "participants", "system", "agent",
}


# --------------------------------------------------------------------------- io
class Analysis:
    """The four data files of one analysis folder, loaded lazily and saved on demand."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.study_path = self.root / "study.yaml"
        self.codebook_path = self.root / "codebook.yaml"
        self.extracts_path = self.root / "extracts.jsonl"
        self.themes_path = self.root / "themes.yaml"
        self._study = None
        self._codebook = None
        self._extracts = None
        self._themes = None
        self._transcript_cache: dict[str, list[str]] = {}

    # ---- loading
    @property
    def study(self) -> dict:
        if self._study is None:
            self._study = load_yaml(self.study_path) or {}
            self._study.setdefault("participants", [])
            self._study.setdefault("transcripts", [])
        return self._study

    @property
    def codebook(self) -> dict:
        if self._codebook is None:
            self._codebook = load_yaml(self.codebook_path) or {}
            self._codebook.setdefault("version", 1)
            self._codebook.setdefault("frozen", False)
            self._codebook.setdefault("codes", [])
            self._codebook.setdefault("changelog", [])
        return self._codebook

    @property
    def extracts(self) -> list[dict]:
        if self._extracts is None:
            self._extracts = []
            if self.extracts_path.exists():
                for n, line in enumerate(self.extracts_path.read_text(encoding="utf-8").splitlines(), 1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        self._extracts.append(json.loads(line))
                    except json.JSONDecodeError as exc:
                        raise SystemExit(f"extracts.jsonl line {n}: invalid JSON ({exc})")
        return self._extracts

    @property
    def themes(self) -> dict:
        if self._themes is None:
            self._themes = load_yaml(self.themes_path) or {}
            self._themes.setdefault("themes", [])
        return self._themes

    def reload(self) -> None:
        """Drop every cached file, so state read before a lock was held is not written back."""
        self._study = None
        self._codebook = None
        self._extracts = None
        self._themes = None
        self._transcript_cache.clear()

    # ---- saving
    def save_study(self):
        dump_yaml(self.study_path, self.study)

    def save_codebook(self):
        dump_yaml(self.codebook_path, self.codebook)

    def save_extracts(self):
        with self.extracts_path.open("w", encoding="utf-8") as fh:
            for ex in self.extracts:
                fh.write(json.dumps(ex, ensure_ascii=False, default=json_safe) + "\n")

    def save_themes(self):
        dump_yaml(self.themes_path, self.themes)

    # ---- lookups
    def participants(self, role: str | None = "participant") -> list[dict]:
        ps = self.study.get("participants", [])
        if role is None:
            return ps
        return [p for p in ps if p.get("role") == role]

    def participant(self, pid: str) -> dict | None:
        return next((p for p in self.study.get("participants", []) if p.get("id") == pid), None)

    def participant_for_speaker(self, speaker: str) -> dict | None:
        key = norm(speaker).lower()
        for p in self.study.get("participants", []):
            labels = [norm(str(s)).lower() for s in (p.get("speakers") or [])]
            if key in labels or key == norm(str(p.get("id", ""))).lower():
                return p
        return None

    def transcript(self, tid: str) -> dict | None:
        return next((t for t in self.study.get("transcripts", []) if t.get("id") == tid), None)

    def transcript_path(self, t: dict) -> Path:
        p = Path(t["path"])
        return p if p.is_absolute() else (self.root / p).resolve()

    def transcript_lines(self, t: dict) -> list[str]:
        tid = t["id"]
        if tid not in self._transcript_cache:
            path = self.transcript_path(t)
            if not path.exists():
                raise SystemExit(f"transcript {tid}: file not found at {path}")
            self._transcript_cache[tid] = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return self._transcript_cache[tid]

    def code(self, cid: str) -> dict | None:
        return next((c for c in self.codebook["codes"] if c.get("id") == cid), None)

    def live_codes(self) -> list[dict]:
        return [c for c in self.codebook["codes"] if c.get("status") in ("candidate", "accepted")]

    def resolve_code(self, cid: str) -> str:
        """Follow merged_into chains so old ids still land on a live code."""
        seen = set()
        while True:
            c = self.code(cid)
            if c is None or c.get("status") != "merged" or not c.get("merged_into") or cid in seen:
                return cid
            seen.add(cid)
            cid = c["merged_into"]

    def theme(self, tid: str) -> dict | None:
        return next((t for t in self.themes["themes"] if t.get("id") == tid), None)

    def extract(self, eid: str) -> dict | None:
        return next((e for e in self.extracts if e.get("id") == eid), None)

    def next_extract_id(self) -> str:
        top = 0
        for e in self.extracts:
            m = re.match(r"^E-(\d+)$", str(e.get("id", "")))
            if m:
                top = max(top, int(m.group(1)))
        return f"E-{top + 1:04d}"


def load_yaml(path: Path):
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as fh:
        try:
            return yaml.safe_load(fh)
        except yaml.YAMLError as exc:
            raise SystemExit(f"{path.name}: not valid YAML ({str(exc).splitlines()[0]}). Fix the file; nothing was changed.")


def dump_yaml(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(data, fh, sort_keys=False, allow_unicode=True, width=100)


def today() -> str:
    return dt.date.today().isoformat()


def json_safe(o):
    """Serialise what YAML hands back but JSON does not know.

    An unquoted `date: 2026-09-01` in a hand-edited codebook loads as a `datetime.date`, and
    every payload the workbench reads is JSON — so without this, hand-editing the file the
    skill tells you to hand-edit takes the whole page down.
    """
    if isinstance(o, (dt.date, dt.datetime, dt.time)):
        return o.isoformat()
    if isinstance(o, set):
        return sorted(o)
    return str(o)


# ------------------------------------------------------------------ text utils
def norm(s: str) -> str:
    """Whitespace-collapsed, straight-quoted text. Case is preserved."""
    s = (
        str(s)
        .replace("’", "'").replace("‘", "'")
        .replace("“", '"').replace("”", '"')
        .replace("…", "...").replace(" ", " ")
    )
    return re.sub(r"\s+", " ", s).strip()


def fold(s: str) -> str:
    return norm(s).lower()


def quote_segments(q: str) -> list[str]:
    """Split a presented quote into the verbatim runs it claims.

    Bracketed insertions (`[with Cocoa]`, `[...]`) and ellipses are editorial,
    so they split the quote; each remaining run of 3+ words must exist in a
    transcript for the quote to count as verbatim.
    """
    q = norm(q)
    parts = re.split(r"\[[^\]]*\]|\.\.\.", q)
    segs = []
    for p in parts:
        p = re.sub(r"\s+", " ", p).strip(" ,;:.!?\"'-")
        if len(p.split()) >= 3:
            segs.append(p)
    return segs


def parse_turns(lines: list[str]) -> list[dict]:
    """Return one dict per speaker turn: line (1-indexed), timestamp, speaker, text.

    Prefers the watch-recording format `[HH:MM:SS] Speaker: text`; falls back to
    `Speaker: text` when a file has no timestamped turns at all. Continuation
    lines (no header) are appended to the preceding turn.
    """
    timestamped = any(TURN_RE.match(l) for l in lines)
    turns: list[dict] = []
    for n, raw in enumerate(lines, 1):
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        m = TURN_RE.match(line) if timestamped else None
        if m:
            turns.append({"line": n, "end_line": n, "timestamp": m.group(1), "speaker": m.group(2).strip(), "text": m.group(3)})
            continue
        if not timestamped:
            pm = PLAIN_TURN_RE.match(line)
            if pm:
                turns.append({"line": n, "end_line": n, "timestamp": None, "speaker": pm.group(1).strip(), "text": pm.group(2)})
                continue
        if turns and not line.startswith("#"):
            turns[-1]["text"] += " " + line.strip()
            turns[-1]["end_line"] = n
    return turns


def turn_at(turns: list[dict], line: int) -> dict | None:
    """The turn that contains a given 1-indexed line (header or continuation)."""
    best = None
    for t in turns:
        if t["line"] <= line:
            best = t
        else:
            break
    if best and line <= best["end_line"]:
        return best
    return best if best and best["line"] == line else None


def token_set(name: str) -> set[str]:
    toks = re.findall(r"[a-z0-9]+", name.lower())
    out = set()
    for t in toks:
        if t in STOPWORDS:
            continue
        for suf in ("ing", "ed", "es", "s"):
            if len(t) > 4 and t.endswith(suf):
                t = t[: -len(suf)]
                break
        out.add(t)
    return out


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    return len(a & b) / len(a | b)


# ---------------------------------------------------------------------- init
def cmd_init(an: Analysis, args) -> int:
    an.root.mkdir(parents=True, exist_ok=True)
    if an.study_path.exists() and not args.force:
        print(f"{an.study_path} already exists (use --force to overwrite the roster). Nothing done.")
        return 1
    transcripts = []
    participants: "OrderedDict[str, dict]" = OrderedDict()
    for i, p in enumerate(args.transcripts or [], 1):
        path = Path(p).resolve()
        if not path.exists():
            print(f"warning: {path} does not exist; recorded anyway")
            lines = []
        else:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        try:
            rel = str(path.relative_to(an.root.resolve()))
        except ValueError:
            try:
                rel = str(Path("..") / path.relative_to(an.root.resolve().parent))
            except ValueError:
                rel = str(path)
        tid = f"T-{i:02d}"
        speakers = OrderedDict()
        for t in parse_turns(lines):
            speakers[t["speaker"]] = speakers.get(t["speaker"], 0) + 1
        for spk in speakers:
            key = spk.lower()
            if key not in participants:
                participants[key] = {
                    "id": f"TODO-{re.sub(r'[^a-z0-9]+', '-', key).strip('-')}",
                    "role": "unknown",
                    "speakers": [spk],
                    "notes": "set id (P1, P2, ...) and role (participant | interviewer | researcher | other)",
                }
        transcripts.append({
            "id": tid,
            "path": rel,
            "participants": [],
            "kind": "interview",
            "speakers_seen": {k: v for k, v in speakers.items()},
            "coded_with_version": None,
        })
    study = {
        "study": args.study or an.root.resolve().parent.name,
        "approach": {
            "orientation": "hybrid",
            "level": "semantic",
            "epistemology": "realist",
            "prevalence_unit": "participant",
            "notes": "The skill's default stance for an HCI user study: the research questions and design "
                     "goals shape what is attended to, the codes come from the transcripts, and prevalence is "
                     "reported per participant as n/N. Replace this with wording the method section can reuse, "
                     "and change the fields above only if this study is really deductive, latent, or "
                     "constructionist.",
        },
        "research_questions": [{"id": "RQ1", "text": "TODO"}],
        "participants": list(participants.values()),
        "transcripts": transcripts,
    }
    an._study = study
    an.save_study()
    if not an.codebook_path.exists():
        an._codebook = {"version": 1, "frozen": False, "codes": [], "changelog": [{"version": 1, "date": today(), "change": "codebook created"}]}
        an.save_codebook()
    if not an.extracts_path.exists():
        an.extracts_path.write_text("", encoding="utf-8")
    if not an.themes_path.exists():
        an._themes = {"themes": []}
        an.save_themes()
    (an.root / "reviews").mkdir(exist_ok=True)
    (an.root / "reports").mkdir(exist_ok=True)
    memos = an.root / "memos.md"
    if not memos.exists():
        memos.write_text(
            "# Analytic memos\n\nDated notes written *during* analysis: hunches, why a code exists, tensions "
            "between accounts, alternative readings considered. Braun & Clarke: writing starts in phase 1.\n\n"
            f"## {today()}\n\n- analysis folder created\n",
            encoding="utf-8",
        )
    print(f"initialised {an.root}")
    print(f"  {len(transcripts)} transcript(s), {len(participants)} distinct speaker label(s)")
    print("  next: edit study.yaml -> give every speaker an id and a role, list each transcript's participants")
    return 0


# ------------------------------------------------------------------ validate
def validate(an: Analysis) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    # roster
    ids = [p.get("id") for p in an.study.get("participants", [])]
    for pid in ids:
        if ids.count(pid) > 1:
            errors.append(f"study.yaml: duplicate participant id {pid}")
    for p in an.study.get("participants", []):
        if p.get("role") not in ROLES or p.get("role") == "unknown":
            errors.append(f"study.yaml: participant {p.get('id')} has role {p.get('role')!r}; set participant | interviewer | researcher | other")
        if str(p.get("id", "")).startswith("TODO"):
            errors.append(f"study.yaml: participant id {p.get('id')} is still a placeholder")
    if not an.participants():
        errors.append("study.yaml: no participants with role 'participant'")

    # transcripts
    tids = [t.get("id") for t in an.study.get("transcripts", [])]
    for t in an.study.get("transcripts", []):
        if tids.count(t.get("id")) > 1:
            errors.append(f"study.yaml: duplicate transcript id {t.get('id')}")
        if not an.transcript_path(t).exists():
            errors.append(f"study.yaml: transcript {t.get('id')} path not found: {an.transcript_path(t)}")
        if not t.get("participants"):
            warnings.append(f"study.yaml: transcript {t.get('id')} lists no participants")
        for pid in t.get("participants") or []:
            if an.participant(pid) is None:
                errors.append(f"study.yaml: transcript {t.get('id')} names unknown participant {pid}")

    # codebook
    cids = [c.get("id") for c in an.codebook["codes"]]
    for c in an.codebook["codes"]:
        cid = c.get("id", "")
        if cids.count(cid) > 1:
            errors.append(f"codebook: duplicate code id {cid}")
        if not CODE_ID_RE.match(str(cid)):
            errors.append(f"codebook: code id {cid!r} must be kebab-case, optionally `parent.child`")
        if c.get("status") not in CODE_STATUSES:
            errors.append(f"codebook: code {cid} has status {c.get('status')!r}")
        parent = c.get("parent")
        if parent:
            pc = an.code(parent)
            if pc is None:
                errors.append(f"codebook: code {cid} names missing parent {parent}")
            elif pc.get("parent"):
                errors.append(f"codebook: code {cid} -> {parent} -> {pc.get('parent')}: codes may have at most two levels")
            if "." in cid and not cid.startswith(parent + "."):
                warnings.append(f"codebook: code {cid} has parent {parent} but its id does not start with `{parent}.`")
        elif "." in str(cid):
            errors.append(f"codebook: code {cid} looks like a child id but has no parent")
        if c.get("status") in ("candidate", "accepted"):
            if not (c.get("definition") or "").strip():
                errors.append(f"codebook: code {cid} has no definition")
        if c.get("status") == "merged" and not c.get("merged_into"):
            errors.append(f"codebook: code {cid} is merged but merged_into is empty")
        for eid in c.get("examples") or []:
            ex = an.extract(eid)
            if ex is None:
                errors.append(f"codebook: code {cid} example {eid} does not exist")
            elif cid not in [an.resolve_code(x) for x in ex.get("codes", [])]:
                warnings.append(f"codebook: code {cid} example {eid} is not coded with {cid}")

    # extracts
    eids = [e.get("id") for e in an.extracts]
    for e in an.extracts:
        eid = e.get("id")
        if eids.count(eid) > 1:
            errors.append(f"extracts: duplicate id {eid}")
        if not EXTRACT_ID_RE.match(str(eid)):
            errors.append(f"extracts: id {eid!r} must look like E-0001")
        if an.transcript(e.get("transcript", "")) is None:
            errors.append(f"extracts: {eid} names unknown transcript {e.get('transcript')}")
        p = an.participant(e.get("participant", ""))
        if p is None:
            errors.append(f"extracts: {eid} names unknown participant {e.get('participant')}")
        elif p.get("role") != "participant":
            warnings.append(f"extracts: {eid} is attributed to {p['id']} whose role is {p.get('role')} (coded non-participant speech?)")
        if e.get("kind") not in EXTRACT_KINDS:
            errors.append(f"extracts: {eid} kind {e.get('kind')!r} must be said | did | intent")
        if not e.get("codes"):
            warnings.append(f"extracts: {eid} carries no codes")
        for cid in e.get("codes") or []:
            c = an.code(cid)
            if c is None:
                errors.append(f"extracts: {eid} uses unknown code {cid}")
            elif c.get("status") == "merged":
                warnings.append(f"extracts: {eid} uses merged code {cid} (run `merge-code` again or `recode`)")
            elif c.get("status") == "retired":
                errors.append(f"extracts: {eid} uses retired code {cid}")
        if not (e.get("text") or "").strip():
            errors.append(f"extracts: {eid} has empty text")

    # themes
    thids = [t.get("id") for t in an.themes["themes"]]
    for th in an.themes["themes"]:
        tid = th.get("id")
        if thids.count(tid) > 1:
            errors.append(f"themes: duplicate id {tid}")
        if th.get("status") not in THEME_STATUSES:
            errors.append(f"themes: {tid} status {th.get('status')!r}")
        if th.get("in_paper", "undecided") not in IN_PAPER:
            errors.append(f"themes: {tid} in_paper {th.get('in_paper')!r} must be undecided | headline | secondary | no")
        parent = th.get("parent")
        if parent:
            pt = an.theme(parent)
            if pt is None:
                errors.append(f"themes: {tid} names missing parent {parent}")
            elif pt.get("parent"):
                errors.append(f"themes: {tid} -> {parent} -> {pt.get('parent')}: themes may have at most two levels")
        if th.get("status") in ("candidate", "accepted"):
            if not (th.get("essence") or "").strip():
                errors.append(f"themes: {tid} has no essence (the two-sentence scope statement)")
            if not th.get("codes") and not parent:
                warnings.append(f"themes: {tid} gathers no codes")
            ess = norm(th.get("essence") or "")
            if len(re.findall(r"[.!?](\s|$)", ess)) > 3:
                warnings.append(f"themes: {tid} essence runs past ~2 sentences; Braun & Clarke's test is that scope fits in a couple")
        theme_codes = set()
        for cid in th.get("codes") or []:
            c = an.code(cid)
            if c is None:
                errors.append(f"themes: {tid} gathers unknown code {cid}")
            else:
                # A theme that gathers a parent gathers its children too, so a quote coded
                # only to a child still belongs to the theme.
                theme_codes |= code_family(an, an.resolve_code(cid))
        for eid in (th.get("selected_extracts") or []) + (th.get("tensions") or []):
            ex = an.extract(eid)
            if ex is None:
                errors.append(f"themes: {tid} references missing extract {eid}")
            elif theme_codes and not (theme_codes & {an.resolve_code(x) for x in ex.get("codes", [])}):
                warnings.append(f"themes: {tid} selects {eid}, which carries none of the theme's codes")

    # spans the workbench (and `annotate`) cannot place on the transcript itself
    for e in an.extracts:
        t = an.transcript(e.get("transcript", ""))
        if t is None:
            continue
        try:
            lines = an.transcript_lines(t)
        except SystemExit:
            continue
        turns = parse_turns(lines)
        a, b = int(e.get("line_start") or 0), int(e.get("line_end") or 0)
        covered = [tr for tr in turns if tr["line"] <= b and tr["end_line"] >= a] if a and b else []
        if covered and locate_span(" ".join(tr["text"] for tr in covered), e.get("text", "")) is None:
            warnings.append(f"extracts: {e.get('id')} text cannot be located inside its turn at "
                            f"{e.get('transcript')}:{a}-{b}; re-trim it so the span can be highlighted")

    # the inbox is hand-editable too, so lint it here rather than only in `apply`
    for o in read_inbox(an):
        if o.get("status") == "malformed":
            errors.append(f"inbox: {o.get('id')} is not valid JSON ({o.get('error')})")
        elif o.get("status") in (None, "pending"):
            warnings += [f"inbox: {p}" for p in validate_op(an, o)]
    return errors, warnings


def cmd_validate(an: Analysis, args) -> int:
    errors, warnings = validate(an)
    if getattr(args, "json", False):
        print(json.dumps({"errors": errors, "warnings": warnings}, ensure_ascii=False, indent=2, default=json_safe))
        return 1 if errors else 0
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    print(f"validate: {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


# -------------------------------------------------------------------- extract
def build_extract(an: Analysis, transcript_id: str, line_start: int, line_end: int, codes: list[str],
                  kind: str = "said", frm: str | None = None, to: str | None = None,
                  participant: str | None = None, context: str | None = None, note: str | None = None,
                  allow_non_participant: bool = False, offsets: tuple[int, int] | None = None) -> dict:
    t = an.transcript(transcript_id)
    if t is None:
        raise SystemExit(f"unknown transcript {transcript_id}")
    lines = an.transcript_lines(t)
    if not (1 <= line_start <= line_end <= len(lines)):
        raise SystemExit(f"{transcript_id}: line range {line_start}-{line_end} outside 1-{len(lines)}")
    turns = parse_turns(lines)
    covered = [tr for tr in turns if tr["line"] <= line_end and tr["end_line"] >= line_start]
    if not covered:
        raise SystemExit(f"{transcript_id}: no speaker turn covers lines {line_start}-{line_end}")
    speakers = {tr["speaker"] for tr in covered}
    if len(speakers) > 1:
        raise SystemExit(
            f"{transcript_id}: lines {line_start}-{line_end} span speakers {sorted(speakers)}; "
            "code one speaker's turn at a time so attribution stays exact"
        )
    speaker = covered[0]["speaker"]
    text = norm(" ".join(tr["text"] for tr in covered))
    if offsets is not None:
        # The workbench selects inside the normalised turn text it was given, so the
        # boundary arrives as offsets and the words are still cut from the transcript here.
        a, b = offsets
        if not (0 <= a < b <= len(text)):
            raise SystemExit(f"offsets {a}-{b} fall outside the turn ({len(text)} characters) at {transcript_id}:{line_start}-{line_end}")
        text = text[a:b].strip()
    elif frm or to:
        low = text.lower()
        i = low.find(fold(frm)) if frm else 0
        if i < 0:
            raise SystemExit(f"--from text not found in lines {line_start}-{line_end}: {frm!r}")
        if to:
            j = low.find(fold(to), i)
            if j < 0:
                raise SystemExit(f"--to text not found after --from in lines {line_start}-{line_end}: {to!r}")
            text = text[i: j + len(to)]
        else:
            text = text[i:]
        text = text.strip()
    p = an.participant(participant) if participant else an.participant_for_speaker(speaker)
    if p is None:
        raise SystemExit(
            f"speaker {speaker!r} is not in the roster (study.yaml participants[].speakers); "
            "add the label, or pass --participant to name the id explicitly"
        )
    if p.get("role") != "participant" and not allow_non_participant:
        raise SystemExit(
            f"speaker {speaker!r} is {p['id']} with role {p.get('role')}; interviewer/researcher speech is "
            "context, not data. Pass --allow-non-participant only if you really mean to code it."
        )
    resolved = []
    for cid in codes:
        c = an.code(cid)
        if c is None:
            raise SystemExit(f"unknown code {cid}; add it to codebook.yaml first (status: candidate)")
        if c.get("status") == "retired":
            raise SystemExit(f"code {cid} is retired")
        resolved.append(an.resolve_code(cid))
    if kind not in EXTRACT_KINDS:
        raise SystemExit("kind must be said | did | intent")
    ex = {
        "id": an.next_extract_id(),
        "transcript": transcript_id,
        "participant": p["id"],
        "speaker": speaker,
        "timestamp": covered[0]["timestamp"],
        "line_start": line_start,
        "line_end": line_end,
        "text": text,
        "codes": resolved,
        "kind": kind,
        "context": context,
        "note": note,
        "codebook_version": an.codebook.get("version", 1),
        "added": today(),
    }
    return ex


def parse_lines_arg(s: str) -> tuple[int, int]:
    m = re.match(r"^(\d+)(?:-(\d+))?$", s.strip())
    if not m:
        raise SystemExit(f"lines must look like 42 or 42-44, got {s!r}")
    a = int(m.group(1))
    b = int(m.group(2)) if m.group(2) else a
    return a, b


def cmd_extract(an: Analysis, args) -> int:
    jobs = []
    if args.batch:
        for n, line in enumerate(Path(args.batch).read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                jobs.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{args.batch} line {n}: {exc}")
    else:
        if not (args.transcript and args.lines and args.codes):
            raise SystemExit("extract needs TRANSCRIPT LINES --codes a,b  (or --batch file.jsonl)")
        jobs.append({
            "transcript": args.transcript, "lines": args.lines, "codes": args.codes, "kind": args.kind,
            "from": args.frm, "to": args.to, "participant": args.participant, "context": args.context,
            "note": args.note, "allow_non_participant": args.allow_non_participant,
        })
    added = []
    for job in jobs:
        codes = job["codes"]
        if isinstance(codes, str):
            codes = [c.strip() for c in codes.split(",") if c.strip()]
        a, b = parse_lines_arg(str(job["lines"]))
        ex = build_extract(
            an, job["transcript"], a, b, codes, kind=job.get("kind") or "said", frm=job.get("from"),
            to=job.get("to"), participant=job.get("participant"), context=job.get("context"),
            note=job.get("note"), allow_non_participant=bool(job.get("allow_non_participant")),
        )
        # duplicate guard: same participant, same text already stored
        dup = next((e for e in an.extracts if e["participant"] == ex["participant"] and fold(e["text"]) == fold(ex["text"])), None)
        if dup:
            merged = sorted(set(dup["codes"]) | set(ex["codes"]))
            if merged != sorted(dup["codes"]):
                dup["codes"] = merged
                print(f"{dup['id']}: same extract already stored; added codes -> {', '.join(merged)}")
            else:
                print(f"{dup['id']}: identical extract already stored; nothing added")
            continue
        an.extracts.append(ex)
        added.append(ex)
        print(f"{ex['id']}  {ex['participant']}  [{ex['timestamp'] or '-'}]  {', '.join(ex['codes'])}  ({ex['kind']})")
        print(f"    {ex['text'][:160]}{'...' if len(ex['text']) > 160 else ''}")
    an.save_extracts()
    print(f"extract: {len(added)} added; {len(an.extracts)} total")
    return 0


def cmd_recode(an: Analysis, args) -> int:
    ex = an.extract(args.extract_id)
    if ex is None:
        raise SystemExit(f"no extract {args.extract_id}")
    codes = set(ex.get("codes", []))
    def check(cs):
        for c in cs:
            if an.code(c) is None:
                raise SystemExit(f"unknown code {c}")
        return [an.resolve_code(c) for c in cs]
    if args.set:
        codes = set(check([c.strip() for c in args.set.split(",") if c.strip()]))
    if args.add:
        codes |= set(check([c.strip() for c in args.add.split(",") if c.strip()]))
    if args.remove:
        codes -= set(c.strip() for c in args.remove.split(","))
    ex["codes"] = sorted(codes)
    if args.kind:
        if args.kind not in EXTRACT_KINDS:
            raise SystemExit("kind must be said | did | intent")
        ex["kind"] = args.kind
    if args.note is not None:
        ex["note"] = args.note
    if args.highlight is not None:
        if args.highlight.strip().lower() in ("", "no", "none", "false", "off"):
            ex.pop("highlight", None)
        else:
            ex["highlight"] = args.highlight
    an.save_extracts()
    hl = f"  highlight: {ex['highlight']}" if ex.get("highlight") else ""
    print(f"{ex['id']}: codes -> {', '.join(ex['codes']) or '(none)'}  kind={ex['kind']}{hl}")
    return 0


def cmd_drop(an: Analysis, args) -> int:
    before = len(an.extracts)
    an._extracts = [e for e in an.extracts if e.get("id") not in set(args.extract_ids)]
    gone = before - len(an.extracts)
    an.save_extracts()
    for th in an.themes["themes"]:
        for key in ("selected_extracts", "tensions"):
            if th.get(key):
                th[key] = [x for x in th[key] if x not in set(args.extract_ids)]
    an.save_themes()
    for c in an.codebook["codes"]:
        if c.get("examples"):
            c["examples"] = [x for x in c["examples"] if x not in set(args.extract_ids)]
    an.save_codebook()
    print(f"drop: removed {gone} extract(s). Note why in memos.md.")
    return 0


# --------------------------------------------------------------------- verify
def verify(an: Analysis) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    for e in an.extracts:
        eid = e.get("id")
        t = an.transcript(e.get("transcript", ""))
        if t is None:
            errors.append(f"{eid}: unknown transcript {e.get('transcript')}")
            continue
        try:
            lines = an.transcript_lines(t)
        except SystemExit as exc:
            errors.append(f"{eid}: {exc}")
            continue
        target = fold(e.get("text", ""))
        if not target:
            errors.append(f"{eid}: empty text")
            continue
        a, b = int(e.get("line_start", 0) or 0), int(e.get("line_end", 0) or 0)
        turns = parse_turns(lines)
        covered = [tr for tr in turns if tr["line"] <= b and tr["end_line"] >= a] if a and b else []
        in_range = " ".join(fold(tr["text"]) for tr in covered)
        whole = fold(" ".join(l for l in lines))
        if target in in_range:
            pass
        elif target in whole:
            # locate for the message
            where = next((tr["line"] for tr in turns if target in fold(tr["text"])), "?")
            errors.append(f"{eid}: text is verbatim in {t['id']} but NOT at lines {a}-{b} (found at line {where}); fix the locator")
        else:
            errors.append(f"{eid}: text NOT found verbatim in {t['id']} lines {a}-{b} or anywhere in the file: {e.get('text','')[:90]!r}")
            continue
        # speaker/participant check
        if covered:
            spk = covered[0]["speaker"]
            p = an.participant_for_speaker(spk)
            if p is None:
                warnings.append(f"{eid}: speaker {spk!r} at line {covered[0]['line']} is not in the roster")
            elif p["id"] != e.get("participant"):
                errors.append(f"{eid}: attributed to {e.get('participant')} but the turn at line {covered[0]['line']} is {spk!r} = {p['id']}")
            elif p.get("role") != "participant":
                warnings.append(f"{eid}: {p['id']} has role {p.get('role')}; is this participant data?")
            if e.get("timestamp") and covered[0].get("timestamp") and e["timestamp"] != covered[0]["timestamp"]:
                warnings.append(f"{eid}: stored timestamp {e['timestamp']} differs from the turn's {covered[0]['timestamp']}")
    return errors, warnings


def cmd_verify(an: Analysis, args) -> int:
    errors, warnings = verify(an)
    if getattr(args, "json", False):
        print(json.dumps({"checked": len(an.extracts), "errors": errors, "warnings": warnings}, ensure_ascii=False, indent=2, default=json_safe))
        return 1 if errors else 0
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"ERROR: {e}")
    print(f"verify: {len(an.extracts)} extract(s) checked, {len(errors)} not verbatim/misattributed, {len(warnings)} warning(s)")
    return 1 if errors else 0


# ------------------------------------------------------------- verify-quotes
def find_quotes_in_markdown(md: str) -> list[dict]:
    """Quotes a document presents: blockquotes and inline "..." runs of 5+ words, with any nearby (P3) attribution."""
    out = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith(">"):
            # one blockquote run may stack several quotes; a line opening with **E-0042** starts a new one
            groups: list[tuple[int, list[str]]] = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                body = lines[i].lstrip()[1:].strip()
                if not groups or re.match(r"^\*\*E-\d+\*\*", body) or not body:
                    if body:
                        groups.append((i + 1, [body]))
                else:
                    groups[-1][1].append(body)
                i += 1
            for start, buf in groups:
                text = " ".join(buf)
                attr = None
                pm = re.match(r"^\*\*(E-\d+)\*\*\s+([A-Z]{1,3}\d{1,3})\b(?:\s*\[[^\]]*\])*\s*(?:[*_]\([^)]*\)[*_])?\s*:\s*", text)  # **E-0042** P7 [00:14:22] [did]:
                if pm:
                    attr = pm.group(2)
                    text = text[pm.end():]
                text = re.sub(r"^\*\*\[?\d{2}:\d{2}:\d{2}\]?[^*]*\*\*\s*", "", text)  # **[00:07:17] Dana:** prefix
                m = re.search(r"[-–—]\s*(?:Participant\s+)?([A-Z]{1,3}\d{1,3})\s*$|\(([A-Z]{1,3}\d{1,3})\)\s*$", text)
                if m:
                    attr = m.group(1) or m.group(2)
                    text = text[: m.start()].strip()
                text = strip_presentation(text)
                if len(text.split()) >= 5:
                    out.append({"line": start, "text": text, "attributed": attr, "form": "block"})
            continue
        scan = re.sub(r"<[^<>]*>", lambda m: " " * len(m.group(0)), lines[i])  # blank out tags so attribute quotes are not read as quotations
        for m in re.finditer(r"[\"“]([^\"“”]{20,}?)[\"”]", scan):
            q = strip_presentation(m.group(1))
            if len(q.split()) < 5:
                continue
            tail = lines[i][m.end(): m.end() + 40]
            head = lines[i][max(0, m.start() - 60): m.start()]
            attr = None
            am = re.search(r"\(([A-Z]{1,3}\d{1,3})\)", tail) or re.search(r"\b([A-Z]{1,3}\d{1,3})\b", tail)
            if am:
                attr = am.group(1)
            else:
                hm = list(re.finditer(r"\b([A-Z]{1,3}\d{1,3})\b", head))
                if hm:
                    attr = hm[-1].group(1)
            out.append({"line": i + 1, "text": q, "attributed": attr, "form": "inline"})
        i += 1
    return out


def strip_presentation(text: str) -> str:
    """Remove markers a review document adds around a quote: *(did)*, _(intent)_, trailing italics notes."""
    text = re.sub(r"[*_]\((said|did|intent)[^)]*\)[*_]:?", " ", text)
    text = re.sub(r"\s+\*\([^)]*\)\*\s*$", "", text)  # trailing *(borderline: ...)* note
    return text.strip().strip('"“”').strip()


def locate_segment(an: Analysis, seg: str) -> list[tuple[str, str | None, int]]:
    """Every (transcript id, participant id, line) whose turn contains the segment."""
    hits = []
    key = fold(seg)
    for t in an.study.get("transcripts", []):
        try:
            lines = an.transcript_lines(t)
        except SystemExit:
            continue
        for tr in parse_turns(lines):
            if key in fold(tr["text"]):
                p = an.participant_for_speaker(tr["speaker"])
                hits.append((t["id"], p["id"] if p else None, tr["line"]))
        if not hits:
            whole = fold(" ".join(lines))
            if key in whole:
                hits.append((t["id"], None, 0))
    return hits


def cmd_verify_quotes(an: Analysis, args) -> int:
    md = Path(args.file).read_text(encoding="utf-8")
    quotes = find_quotes_in_markdown(md)
    bad = 0
    for q in quotes:
        segs = quote_segments(q["text"])
        if not segs:
            continue
        seg_hits = [locate_segment(an, s) for s in segs]
        missing = [s for s, h in zip(segs, seg_hits) if not h]
        who = set()
        for h in seg_hits:
            for _, pid, _ in h:
                if pid:
                    who.add(pid)
        label = f"line {q['line']:>4} ({q['form']})"
        if missing:
            bad += 1
            print(f"UNMATCHED {label}: {q['text'][:100]!r}")
            for s in missing:
                print(f"    not in any transcript: {s!r}")
            continue
        if q["attributed"] and who and q["attributed"] not in who:
            bad += 1
            print(f"MISATTRIBUTED {label}: presented as {q['attributed']}, transcript says {sorted(who)}: {q['text'][:80]!r}")
            continue
        if len(who) > 1:
            print(f"ambiguous  {label}: segments match several participants {sorted(who)}; check the join: {q['text'][:80]!r}")
            continue
        if not args.quiet:
            src = ", ".join(f"{t}:{ln}" for t, _, ln in seg_hits[0][:2])
            print(f"ok        {label}: {sorted(who) or ['?']} {src}")
    print(f"verify-quotes: {len(quotes)} quote(s) checked, {bad} problem(s)")
    return 1 if bad else 0


# ------------------------------------------------------------------ coverage
def participants_for_codes(an: Analysis, code_ids: set[str]) -> dict[str, list[str]]:
    """participant id -> extract ids, for extracts carrying any of the codes (resolved)."""
    out: dict[str, list[str]] = defaultdict(list)
    for e in an.extracts:
        ecodes = {an.resolve_code(c) for c in e.get("codes", [])}
        if ecodes & code_ids:
            out[e["participant"]].append(e["id"])
    return out


def code_family(an: Analysis, cid: str) -> set[str]:
    """A code plus its children."""
    fam = {cid}
    for c in an.codebook["codes"]:
        if c.get("parent") == cid and c.get("status") in ("candidate", "accepted"):
            fam.add(c["id"])
    return fam


def coverage_report(an: Analysis) -> str:
    parts = an.participants()
    pids = [p["id"] for p in parts]
    N = len(pids)
    codes = an.live_codes()
    out = [f"# Coverage ({today()})", ""]
    out.append(f"Participants (role=participant): {N}. Extracts: {len(an.extracts)}. Codebook v{an.codebook.get('version')} ({'frozen' if an.codebook.get('frozen') else 'open'}), {len(codes)} live code(s).")
    out.append("")
    # per code
    out += ["## Codes: prevalence at the participant level", "", "| code | status | participants | n/N | extracts | said/did/intent |", "|---|---|---|---|---|---|"]
    zero = []
    for c in sorted(codes, key=lambda c: (c.get("parent") or c["id"], c["id"])):
        fam = code_family(an, c["id"]) if not c.get("parent") else {c["id"]}
        pmap = participants_for_codes(an, fam)
        ps = [p for p in pids if p in pmap]
        n_ex = sum(len(v) for k, v in pmap.items() if k in pids)
        kinds = defaultdict(int)
        for e in an.extracts:
            if {an.resolve_code(x) for x in e.get("codes", [])} & fam and e["participant"] in pids:
                kinds[e.get("kind", "said")] += 1
        indent = "└ " if c.get("parent") else ""
        out.append(f"| {indent}`{c['id']}` {c.get('name','')} | {c.get('status')} | {', '.join(ps) or '-'} | {len(ps)}/{N} | {n_ex} | {kinds['said']}/{kinds['did']}/{kinds['intent']} |")
        if not ps:
            zero.append(c["id"])
    out.append("")
    if zero:
        out.append(f"Codes with **no extracts**: {', '.join(zero)}. A code nobody said is a candidate to retire or a sign a transcript was under-coded.")
        out.append("")
    # per participant
    out += ["## Participants", "", "| participant | transcripts | extracts | distinct codes | codes never applied to them |", "|---|---|---|---|---|"]
    all_top = sorted({an.resolve_code(c["id"]) for c in codes if not c.get("parent")})
    for p in parts:
        pid = p["id"]
        exs = [e for e in an.extracts if e["participant"] == pid]
        pcodes = set()
        for e in exs:
            for c in e.get("codes", []):
                r = an.resolve_code(c)
                cc = an.code(r)
                pcodes.add(cc.get("parent") or r if cc else r)
        missing = [c for c in all_top if c not in pcodes]
        ts = [t["id"] for t in an.study.get("transcripts", []) if pid in (t.get("participants") or [])]
        out.append(f"| {pid} | {', '.join(ts) or '-'} | {len(exs)} | {len(pcodes)} | {', '.join(missing) or '-'} |")
    out.append("")
    silent = [p["id"] for p in parts if not any(e["participant"] == p["id"] for e in an.extracts)]
    if silent:
        out.append(f"Participants with **no extracts**: {', '.join(silent)}.")
        out.append("")
    # transcripts
    out += ["## Transcripts", "", "| transcript | participants | extracts | coded with codebook version | state |", "|---|---|---|---|---|"]
    v = an.codebook.get("version", 1)
    for t in an.study.get("transcripts", []):
        n = sum(1 for e in an.extracts if e.get("transcript") == t["id"])
        cv = t.get("coded_with_version")
        state = "uncoded" if cv is None else ("stale (codebook changed since)" if int(cv) < int(v) else "current")
        out.append(f"| {t['id']} | {', '.join(t.get('participants') or [])} | {n} | {cv if cv is not None else '-'} | {state} |")
    out.append("")
    # themes
    if an.themes["themes"]:
        out += ["## Themes", "", "| theme | status | in paper | codes | participants | n/N | extracts | tensions | selected quotes |", "|---|---|---|---|---|---|---|---|---|"]
        for th in an.themes["themes"]:
            fam = set()
            for c in th.get("codes") or []:
                fam |= code_family(an, an.resolve_code(c))
            for sub in an.themes["themes"]:
                if sub.get("parent") == th.get("id"):
                    for c in sub.get("codes") or []:
                        fam |= code_family(an, an.resolve_code(c))
            pmap = participants_for_codes(an, fam)
            ps = [p for p in pids if p in pmap]
            n_ex = sum(len(v) for k, v in pmap.items() if k in pids)
            indent = "└ " if th.get("parent") else ""
            out.append(f"| {indent}{th.get('id')} {th.get('name','')} | {th.get('status')} | {th.get('in_paper','undecided')} | {', '.join(th.get('codes') or []) or '-'} | {', '.join(ps) or '-'} | {len(ps)}/{N} | {n_ex} | {len(th.get('tensions') or [])} | {len(th.get('selected_extracts') or [])} |")
        out.append("")
    out.append("Prevalence is counted per participant (Braun & Clarke: pick one unit and keep it). Frequency does not determine value; a 3/12 theme can carry the paper if it answers the research question.")
    return "\n".join(out) + "\n"


def cmd_coverage(an: Analysis, args) -> int:
    if getattr(args, "json", False):
        print(json.dumps(coverage_json(an), ensure_ascii=False, indent=2, default=json_safe))
        return 0
    print(coverage_report(an))
    return 0


# --------------------------------------------------------------------- dupes
def find_dupes(an: Analysis, name_threshold: float = 0.5, overlap_threshold: float = 0.5) -> list[str]:
    codes = an.live_codes()
    ex_by_code: dict[str, set[str]] = defaultdict(set)
    for e in an.extracts:
        for c in e.get("codes", []):
            ex_by_code[an.resolve_code(c)].add(e["id"])
    notes = []
    for i, a in enumerate(codes):
        for b in codes[i + 1:]:
            if a.get("parent") == b["id"] or b.get("parent") == a["id"]:
                continue
            ta_, tb_ = token_set(f"{a['id']} {a.get('name','')}"), token_set(f"{b['id']} {b.get('name','')}")
            js = jaccard(ta_, tb_)
            if js >= name_threshold and (ta_ & tb_):
                notes.append(f"names overlap ({js:.2f}): `{a['id']}` \"{a.get('name','')}\" vs `{b['id']}` \"{b.get('name','')}\" -> same idea, or sharpen the definitions?")
            ea, eb = ex_by_code.get(a["id"], set()), ex_by_code.get(b["id"], set())
            if ea and eb:
                jo = jaccard(ea, eb)
                if jo >= overlap_threshold:
                    notes.append(f"extracts overlap ({jo:.2f}, {len(ea & eb)} shared): `{a['id']}` vs `{b['id']}` -> co-occurring by design, or one code wearing two names?")
                elif len(ea) >= 3 and ea <= eb:
                    notes.append(f"`{a['id']}` ({len(ea)}) is a strict subset of `{b['id']}` ({len(eb)}) -> child code, or redundant?")
                elif len(eb) >= 3 and eb <= ea:
                    notes.append(f"`{b['id']}` ({len(eb)}) is a strict subset of `{a['id']}` ({len(ea)}) -> child code, or redundant?")
            da, db = fold(a.get("definition") or ""), fold(b.get("definition") or "")
            if da and da == db:
                notes.append(f"identical definitions: `{a['id']}` and `{b['id']}`")
    return notes


def cmd_dupes(an: Analysis, args) -> int:
    if getattr(args, "json", False):
        print(json.dumps(dupes_json(an), ensure_ascii=False, indent=2, default=json_safe))
        return 0
    notes = find_dupes(an)
    for n in notes:
        print(f"- {n}")
    print(f"dupes: {len(notes)} suspicion(s) across {len(an.live_codes())} live code(s). These are prompts for judgement, not verdicts.")
    return 0


# ---------------------------------------------------------------- code admin
def do_merge_code(an: Analysis, src: str, dst: str, why: str | None = None, bump: bool = True) -> int:
    """Fold SOURCE into TARGET everywhere. Mutates; does not save.

    `bump=False` when this runs inside a pass of staged operations: the pass bumps the
    codebook once at the end and owns the changelog entry, so two merges in one review do
    not move the version twice and leave a later code's `added.version` ahead of it.
    """
    a, b = an.code(src), an.code(dst)
    if a is None or b is None:
        raise SystemExit(f"both codes must exist: {src} -> {dst}")
    if b.get("status") not in ("candidate", "accepted"):
        raise SystemExit(f"target {dst} is {b.get('status')}")
    for child in an.codebook["codes"]:
        if child.get("parent") == src:
            if b.get("parent"):
                raise SystemExit(f"{src} has child {child['id']} and {dst} is itself a child; merging would make three levels")
            child["parent"] = dst
            if "." in child["id"]:
                new_id = dst + "." + child["id"].split(".", 1)[1]
                rename_everywhere(an, child["id"], new_id)
                child["id"] = new_id
    n = 0
    for e in an.extracts:
        if src in e.get("codes", []):
            e["codes"] = sorted((set(e["codes"]) - {src}) | {dst})
            n += 1
    for th in an.themes["themes"]:
        if src in (th.get("codes") or []):
            th["codes"] = sorted((set(th["codes"]) - {src}) | {dst})
    b["examples"] = sorted(set(b.get("examples") or []) | set(a.get("examples") or []))
    a["status"] = "merged"
    a["merged_into"] = dst
    if bump:
        an.codebook["version"] = int(an.codebook.get("version", 1)) + 1
        an.codebook["changelog"].append({"version": an.codebook["version"], "date": today(), "change": f"merged {src} into {dst} ({n} extracts recoded){': ' + why if why else ''}"})
    return n


def cmd_merge_code(an: Analysis, args) -> int:
    n = do_merge_code(an, args.source, args.target, args.why)
    an.save_codebook(); an.save_extracts(); an.save_themes()
    print(f"merged {args.source} -> {args.target}; {n} extract(s) recoded; codebook now v{an.codebook['version']}")
    return 0


def rename_everywhere(an: Analysis, old: str, new: str) -> int:
    n = 0
    for e in an.extracts:
        if old in e.get("codes", []):
            e["codes"] = sorted((set(e["codes"]) - {old}) | {new})
            n += 1
    for th in an.themes["themes"]:
        if old in (th.get("codes") or []):
            th["codes"] = sorted((set(th["codes"]) - {old}) | {new})
    for c in an.codebook["codes"]:
        if c.get("parent") == old:
            c["parent"] = new
        if c.get("merged_into") == old:
            c["merged_into"] = new
    return n


def do_rename_code(an: Analysis, old: str, new: str) -> int:
    """Rename a code id everywhere, carrying its children's ids with it. Mutates; does not save."""
    c = an.code(old)
    if c is None:
        raise SystemExit(f"no code {old}")
    if an.code(new) is not None:
        raise SystemExit(f"{new} already exists; use merge-code")
    if not CODE_ID_RE.match(new):
        raise SystemExit("new id must be kebab-case, optionally parent.child")
    n = rename_everywhere(an, old, new)
    c["id"] = new
    for child in an.codebook["codes"]:
        if child.get("parent") == new and "." in child["id"] and not child["id"].startswith(new + "."):
            new_child = new + "." + child["id"].split(".", 1)[1]
            rename_everywhere(an, child["id"], new_child)
            child["id"] = new_child
    an.codebook["changelog"].append({"version": an.codebook.get("version", 1), "date": today(), "change": f"renamed {old} -> {new} ({n} extracts)"})
    return n


def cmd_rename_code(an: Analysis, args) -> int:
    n = do_rename_code(an, args.old, args.new)
    an.save_codebook(); an.save_extracts(); an.save_themes()
    print(f"renamed {args.old} -> {args.new}; {n} extract(s) updated")
    return 0


def cmd_bump(an: Analysis, args) -> int:
    an.codebook["version"] = int(an.codebook.get("version", 1)) + 1
    if args.freeze:
        an.codebook["frozen"] = True
    an.codebook["changelog"].append({"version": an.codebook["version"], "date": today(), "change": args.change})
    an.save_codebook()
    print(f"codebook v{an.codebook['version']}{' (frozen)' if an.codebook.get('frozen') else ''}: {args.change}")
    return 0


def cmd_mark_coded(an: Analysis, args) -> int:
    t = an.transcript(args.transcript)
    if t is None:
        raise SystemExit(f"no transcript {args.transcript}")
    t["coded_with_version"] = int(an.codebook.get("version", 1))
    an.save_study()
    print(f"{t['id']} marked coded with codebook v{t['coded_with_version']}")
    return 0


def cmd_stale(an: Analysis, args) -> int:
    if getattr(args, "json", False):
        print(json.dumps(stale_json(an), ensure_ascii=False, indent=2, default=json_safe))
        return 0
    v = int(an.codebook.get("version", 1))
    stale = []
    for t in an.study.get("transcripts", []):
        cv = t.get("coded_with_version")
        if cv is None:
            stale.append((t["id"], "never coded"))
        elif int(cv) < v:
            stale.append((t["id"], f"coded with v{cv}, codebook is v{v}"))
    for tid, why in stale:
        print(f"- {tid}: {why}")
    print(f"stale: {len(stale)} of {len(an.study.get('transcripts', []))} transcript(s) need a (re)coding pass")
    return 1 if stale else 0


# ------------------------------------------------------------------- collate
def collate(an: Analysis, target: str) -> str:
    th = an.theme(target)
    if th:
        fam = set()
        for c in th.get("codes") or []:
            fam |= code_family(an, an.resolve_code(c))
        for sub in an.themes["themes"]:
            if sub.get("parent") == th["id"]:
                for c in sub.get("codes") or []:
                    fam |= code_family(an, an.resolve_code(c))
        title = f"theme {th['id']} {th.get('name','')}  (codes: {', '.join(sorted(fam))})"
    else:
        if an.code(target) is None:
            raise SystemExit(f"{target} is neither a code nor a theme id")
        fam = code_family(an, an.resolve_code(target))
        title = f"code {target}  (with children: {', '.join(sorted(fam))})"
    by_p: dict[str, list[dict]] = defaultdict(list)
    for e in an.extracts:
        if {an.resolve_code(c) for c in e.get("codes", [])} & fam:
            by_p[e["participant"]].append(e)
    out = [f"# Collated extracts for {title}", ""]
    N = len(an.participants())
    out.append(f"{len(by_p)}/{N} participants, {sum(len(v) for v in by_p.values())} extracts. Read all of them before judging whether the pattern holds (phase 4, level 1).")
    out.append("")
    for pid in [p["id"] for p in an.participants(None)]:
        if pid not in by_p:
            continue
        out.append(f"## {pid}")
        for e in sorted(by_p[pid], key=lambda e: (e.get("transcript"), e.get("line_start", 0))):
            tag = "" if e.get("kind") == "said" else f" ({e.get('kind')})"
            ctx = f" — {e['context']}" if e.get("context") else ""
            out.append(f"- **{e['id']}** [{e.get('timestamp') or '-'}] {e['transcript']}:{e.get('line_start')}{tag}{ctx} · codes: {', '.join(e.get('codes', []))}")
            out.append(f"  > {e['text']}")
            if e.get("note"):
                out.append(f"  _note: {e['note']}_")
        out.append("")
    return "\n".join(out) + "\n"


def cmd_collate(an: Analysis, args) -> int:
    if getattr(args, "json", False):
        print(json.dumps(collate_json(an, args.target), ensure_ascii=False, indent=2, default=json_safe))
        return 0
    print(collate(an, args.target))
    return 0


def cmd_bundle(an: Analysis, args) -> int:
    """Everything a workbench tab needs, in one process (the daemon calls this)."""
    print(json.dumps(bundle_json(an), ensure_ascii=False, default=json_safe))
    return 0


def cmd_transcript(an: Analysis, args) -> int:
    """One transcript as the review surface: turns, resolved speakers, coded spans."""
    if getattr(args, "json", False):
        print(json.dumps(transcript_json(an, args.transcript), ensure_ascii=False, default=json_safe))
        return 0
    d = transcript_json(an, args.transcript)
    t = d["transcript"]
    print(f"{t['id']} · {', '.join(t['participants'])} · {t['turns']} turns · {d['stats']['extracts']} extracts "
          f"({d['stats']['new']} new) · codebook v{t['coded_with_version']} ({t['state']})")
    for turn in d["turns"]:
        who = turn["participant"] or turn["speaker"]
        mark = "" if turn["role"] == "participant" else f"  ({turn['role']})"
        print(f"[{turn['timestamp'] or '-'}] {who}{mark}: {turn['text'][:120]}{'...' if len(turn['text']) > 120 else ''}")
        for sp in turn["spans"]:
            e = next((x for x in d["extracts"] if x["id"] == sp["extract"]), {})
            loc = f"{sp['start']}-{sp['end']}" if sp["start"] is not None else "unlocated"
            print(f"    {sp['extract']} [{e.get('kind')}] {', '.join(e.get('codes') or [])} · {loc}"
                  + ("  ← new" if e.get("new") else ""))
    return 0


# ------------------------------------------------------------------ annotate
def annotate(an: Analysis, transcript_id: str, plan: bool = True) -> str:
    """The transcript with every coded span marked.

    In plan mode each extract's text is wrapped in an interactive-plan highlight whose comment lists
    the codes, kind, context, and note, so the reviewer can reply on the exact span in the viewer.
    Overlapping spans on one turn cannot nest, so the later one gets an empty anchor after the turn.
    """
    t = an.transcript(transcript_id)
    if t is None:
        raise SystemExit(f"unknown transcript {transcript_id}")
    lines = an.transcript_lines(t)
    turns = parse_turns(lines)
    by_line: dict[int, list[dict]] = defaultdict(list)
    for e in an.extracts:
        if e.get("transcript") == transcript_id:
            by_line[int(e.get("line_start", 0))].append(e)
    pids = t.get("participants") or []
    N = len(an.participants())
    codes_used = Counter()
    for es in by_line.values():
        for e in es:
            for c in e.get("codes", []):
                codes_used[an.resolve_code(c)] += 1
    n_ex = sum(len(v) for v in by_line.values())
    out = []
    if plan:
        out += [f"**Status:** coding review · {transcript_id} ({', '.join(pids)}) · codebook v{an.codebook.get('version')} · {n_ex} extracts",
                f"**Date:** {today()}",
                f"**Scope:** every coded span highlighted; reply on a highlight to dispute a code, a boundary, a kind, or a missed passage",
                "", f"# {transcript_id} · {', '.join(pids)} · coded transcript", "",
                "Highlighted spans are the extracts; the comment on each lists its codes (with the code's one-line name), kind (said / did / intent), and any context or note. "
                "Uncoded participant speech is uncoded on purpose or by omission: comment on it if it should carry a code. Interviewer turns are context, never data.", ""]
        out += ["## Codes applied in this transcript", "", "| code | name | extracts here | participants overall |", "|---|---|---|---|"]
        for cid, n in sorted(codes_used.items()):
            c = an.code(cid) or {}
            fam = code_family(an, cid) if not c.get("parent") else {cid}
            pm = participants_for_codes(an, fam)
            out.append(f"| `{cid}` | {c.get('name','')} | {n} | {len([p for p in an.participants() if p['id'] in pm])}/{N} |")
        out += ["", "## Transcript", ""]
    else:
        out += [f"# {transcript_id} · {', '.join(pids)} · coded transcript (codebook v{an.codebook.get('version')}, {n_ex} extracts)", ""]
    comments = []
    for tr in turns:
        raw = lines[tr["line"] - 1]
        es = sorted(by_line.get(tr["line"], []), key=lambda e: e["id"])
        if not es or not plan:
            out.append(raw)
            if es and not plan:
                for e in es:
                    out.append(f"    ↳ {e['id']} [{e['kind']}] {', '.join(e['codes'])}" + (f" · {e['context']}" if e.get("context") else ""))
            out.append("")
            continue
        # locate each extract's span in the raw line
        spans = []
        for e in es:
            pat = re.escape(norm(e["text"]))
            pat = pat.replace(r"\ ", r"\s+").replace("'", "['’‘]").replace(r"\"", "[\"“”]")
            m = re.search(pat, raw, flags=re.I)
            spans.append((m.start(), m.end(), e) if m else (None, None, e))
        spans.sort(key=lambda x: (x[0] is None, x[0] if x[0] is not None else 0))
        rendered = ""
        cursor = 0
        deferred = []
        for start, end, e in spans:
            hid = f"x-{e['id']}"
            if start is None or start < cursor:
                deferred.append(e)
                continue
            rendered += raw[cursor:start] + f'<user-highlight comment="{hid}">' + raw[start:end] + "</user-highlight>"
            cursor = end
        rendered += raw[cursor:]
        for e in deferred:
            rendered += f' <user-highlight comment="x-{e["id"]}"></user-highlight>'
        out.append(rendered)
        out.append("")
        for e in es:
            names = []
            for c in e.get("codes", []):
                cc = an.code(an.resolve_code(c)) or {}
                names.append(f"`{c}` ({cc.get('name','?')})")
            body = f"**{e['id']}** · kind: {e['kind']} · codes: {'; '.join(names) or '(none)'}"
            if e.get("context"):
                body += f" · context: {e['context']}"
            if e.get("note"):
                body += f" · note: {e['note']}"
            if e.get("highlight"):
                body += f" · ★ highlight: {e['highlight']}"
            comments.append(f'<comment id="x-{e["id"]}" status="open" kind="question">\n  <note by="agent" at="{today()}T12:00">{body}</note>\n</comment>')
    if plan:
        out += ["", "## Extract notes", "", "One thread per extract, anchored to its span above. Reply to dispute; leave alone to accept.", ""]
        out += comments
    return "\n".join(out) + "\n"


def cmd_annotate(an: Analysis, args) -> int:
    md = annotate(an, args.transcript, plan=not args.plain)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(md, encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(md)
    return 0


# ------------------------------------------------------------------- reports
def codebook_table(an: Analysis) -> str:
    pids = [p["id"] for p in an.participants()]
    N = len(pids)
    out = [f"# Codebook v{an.codebook.get('version')} ({today()})", "", "| code | sub-code | status | definition | include / exclude | participants | example |", "|---|---|---|---|---|---|---|"]
    for c in sorted(an.live_codes(), key=lambda c: (c.get("parent") or c["id"], 0 if not c.get("parent") else 1, c["id"])):
        fam = code_family(an, c["id"]) if not c.get("parent") else {c["id"]}
        pmap = participants_for_codes(an, fam)
        n = len([p for p in pids if p in pmap])
        ex_id = (c.get("examples") or [None])[0]
        ex = an.extract(ex_id) if ex_id else None
        if ex is None:
            cand = [e for e in an.extracts if c["id"] in [an.resolve_code(x) for x in e.get("codes", [])]]
            # prefer something a participant said or did over a hypothetical, then the shortest
            ex = min(cand, key=lambda e: (e.get("kind") == "intent", len(e["text"]))) if cand else None
        example = f"\"{ex['text'][:140]}{'...' if len(ex['text']) > 140 else ''}\" ({ex['participant']}, {ex['id']})" if ex else "-"
        inc = (c.get("include") or "").strip()
        exc = (c.get("exclude") or "").strip()
        ie = " / ".join(x for x in (inc, exc) if x) or "-"
        top = "" if c.get("parent") else f"**{c.get('name') or c['id']}** (`{c['id']}`)"
        sub = f"{c.get('name') or c['id']} (`{c['id']}`)" if c.get("parent") else ""
        out.append(f"| {top} | {sub} | {c.get('status')} | {(c.get('definition') or '').strip()} | {ie} | {n}/{N} | {example} |")
    out.append("")
    if an.codebook.get("changelog"):
        out += ["## Changelog", ""]
        for ch in an.codebook["changelog"]:
            out.append(f"- v{ch.get('version')} {ch.get('date')}: {ch.get('change')}")
    return "\n".join(out) + "\n"


def themes_report(an: Analysis) -> str:
    pids = [p["id"] for p in an.participants()]
    N = len(pids)
    out = [f"# Themes ({today()})", ""]
    for th in [t for t in an.themes["themes"] if not t.get("parent")]:
        out += theme_block(an, th, pids, N, level=2)
        for sub in [t for t in an.themes["themes"] if t.get("parent") == th.get("id")]:
            out += theme_block(an, sub, pids, N, level=3)
    return "\n".join(out) + "\n"


def theme_block(an: Analysis, th: dict, pids: list[str], N: int, level: int) -> list[str]:
    fam = set()
    for c in th.get("codes") or []:
        fam |= code_family(an, an.resolve_code(c))
    pmap = participants_for_codes(an, fam)
    ps = [p for p in pids if p in pmap]
    h = "#" * level
    out = [f"{h} {th.get('id')} · {th.get('name','')}  [{th.get('status')}, in paper: {th.get('in_paper','undecided')}]", ""]
    if th.get("rq"):
        out.append(f"*Answers:* {th['rq']}")
    out.append(f"*Essence:* {th.get('essence','')}")
    out.append(f"*Codes:* {', '.join(th.get('codes') or []) or '-'}")
    out.append(f"*Participants:* {len(ps)}/{N} ({', '.join(ps) or '-'}); {sum(len(v) for k, v in pmap.items() if k in pids)} extracts")
    if th.get("story"):
        out += ["", th["story"].strip()]
    if th.get("selected_extracts"):
        out += ["", "*Selected quotes:*"]
        for eid in th["selected_extracts"]:
            e = an.extract(eid)
            if e:
                span = (th.get("quote_spans") or {}).get(eid) or None
                shown = span["text"] if span else e["text"]
                trim = f" _(trimmed from {len(norm(e['text']).split())} words)_" if span else ""
                out.append(f"- {e['id']} ({e['participant']}, [{e.get('timestamp') or '-'}]): \"{shown}\"{trim}")
    if th.get("tensions"):
        out += ["", "*Tensions / accounts that complicate the theme:*"]
        for eid in th["tensions"]:
            e = an.extract(eid)
            if e:
                out.append(f"- {e['id']} ({e['participant']}): \"{e['text']}\"")
    out.append("")
    return out


def quote_bank(an: Analysis) -> str:
    out = [f"# Quote bank ({today()})", "", "Every quote below is verbatim from a transcript (see `verify`). Cite by participant id; the extract id and locator are for our own audit trail and stay out of the paper.", ""]
    flagged = [e for e in an.extracts if e.get("highlight")]
    if flagged:
        out += ["## Highlights flagged during coding", "", "Marked with `recode --highlight` as candidate paper quotes before theme selection; the theme round decides which survive.", ""]
        for e in flagged:
            kind = "" if e.get("kind") == "said" else f" _[{e['kind']}]_"
            out.append(f"- **{e['participant']}**{kind} · {', '.join(e.get('codes', []))} · *{e['highlight']}*")
            out.append(f"  > \"{e['text']}\"")
            out.append(f"  `{e['id']}` {e['transcript']}:{e.get('line_start')} [{e.get('timestamp') or '-'}]")
        out.append("")
    for th in an.themes["themes"]:
        if th.get("in_paper") == "no" or th.get("status") in ("dropped", "merged"):
            continue
        out.append(f"## {th.get('id')} · {th.get('name','')}")
        out.append("")
        for eid in th.get("selected_extracts") or []:
            e = an.extract(eid)
            if not e:
                continue
            kind = "" if e.get("kind") == "said" else f" _[{e['kind']}]_"
            span = (th.get("quote_spans") or {}).get(eid) or None
            shown = span["text"] if span else e["text"]
            out.append(f"- **{e['participant']}**{kind}: \"{shown}\"")
            trail = f"  `{e['id']}` {e['transcript']}:{e.get('line_start')} [{e.get('timestamp') or '-'}]{(' · ' + e['context']) if e.get('context') else ''}"
            if span:
                trail += f" · trimmed to {span['words']} of {len(norm(e['text']).split())} words for inline use"
            out.append(trail)
        if not th.get("selected_extracts"):
            out.append("- (no quotes selected yet)")
        out.append("")
    return "\n".join(out) + "\n"


def cmd_codebook_table(an: Analysis, args) -> int:
    print(codebook_table(an))
    return 0


def cmd_report(an: Analysis, args) -> int:
    rep = an.root / "reports"
    rep.mkdir(exist_ok=True)
    # A reviewer may have left interactive-plan comments on a generated file; never overwrite those silently.
    for f in rep.glob("*.md"):
        if "<comment " in f.read_text(encoding="utf-8"):
            keep = an.root / "reviews" / f"{today()}-{f.stem}-with-comments.md"
            n = 1
            while keep.exists() and keep.read_text(encoding="utf-8") != f.read_text(encoding="utf-8"):
                n += 1
                keep = an.root / "reviews" / f"{today()}-{f.stem}-with-comments-{n}.md"
            keep.parent.mkdir(exist_ok=True)
            keep.write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
            print(f"note: {f.name} carried comments; archived to {keep.relative_to(an.root)} before regenerating. Apply them to the YAML, they are not in the data files.")
    (rep / "coverage.md").write_text(coverage_report(an), encoding="utf-8")
    (rep / "codebook.md").write_text(codebook_table(an), encoding="utf-8")
    (rep / "themes.md").write_text(themes_report(an), encoding="utf-8")
    (rep / "quote-bank.md").write_text(quote_bank(an), encoding="utf-8")
    errors, warnings = validate(an)
    verrors, vwarnings = verify(an)
    audit = [f"# Audit ({today()})", "", f"- validate: {len(errors)} error(s), {len(warnings)} warning(s)", f"- verify: {len(an.extracts)} extracts, {len(verrors)} not verbatim / misattributed, {len(vwarnings)} warning(s)", ""]
    for e in errors + verrors:
        audit.append(f"- ERROR: {e}")
    for w in warnings + vwarnings:
        audit.append(f"- warning: {w}")
    spread = spread_json(an)
    if spread["warnings"]:
        audit += ["", "## Quote selection and attribution spread", ""] + [f"- {w['text']}" for w in spread["warnings"]]
    dupes = find_dupes(an)
    if dupes:
        audit += ["", "## Possible duplicate codes", ""] + [f"- {d}" for d in dupes]
    (rep / "audit.md").write_text("\n".join(audit) + "\n", encoding="utf-8")
    print(f"wrote {rep}/coverage.md codebook.md themes.md quote-bank.md audit.md")
    print(f"audit: validate {len(errors)} error(s); verify {len(verrors)} problem(s); {len(dupes)} duplicate suspicion(s)")
    return 1 if (errors or verrors) else 0



# ==================================================================== payloads
# One computation, two renderings: every table the terminal prints has a --json
# twin the workbench reads, so a number never gets derived twice (principle 6).
def code_change_version(an: Analysis, cid: str) -> int:
    """The codebook version at which this code last changed meaning."""
    c = an.code(an.resolve_code(cid)) or {}
    added = int((c.get("added") or {}).get("version") or 0)
    redefined = int(c.get("redefined_version") or 0)
    return max(added, redefined)


def extract_state(an: Analysis, e: dict) -> dict:
    """Whether an extract is new since the researcher last reviewed it, and why.

    Delta reviewing (principle 2) rests on three facts: it was never reviewed, the agent
    changed it since (which clears the stamp), or one of its codes was added or redefined
    after the review — the same reason `stale` sends you back to a transcript. Nothing
    here compares two clock strings, so two changes in the same second cannot hide one.
    """
    rev = e.get("reviewed") or None
    if not rev:
        return {"new": True, "reason": "changed since you reviewed it" if e.get("updated") else "not reviewed yet"}
    rver = int(rev.get("version") or 0)
    late = sorted({c for c in e.get("codes", []) if code_change_version(an, c) > rver})
    if late:
        return {"new": True, "reason": "code(s) added or redefined since: " + ", ".join(late)}
    return {"new": False, "reason": None}


def code_public(an: Analysis, c: dict, pids: list[str]) -> dict:
    """One code, with the numbers the views need beside it."""
    cid = c["id"]
    fam = sorted(code_family(an, cid)) if not c.get("parent") else [cid]
    pmap = participants_for_codes(an, set(fam))
    direct = participants_for_codes(an, {cid})
    kinds = Counter()
    n_ex = 0
    for e in an.extracts:
        if {an.resolve_code(x) for x in e.get("codes", [])} & set(fam) and e["participant"] in pids:
            kinds[e.get("kind", "said")] += 1
            n_ex += 1
    child_only = 0
    for e in an.extracts:
        ecodes = {an.resolve_code(x) for x in e.get("codes", [])}
        if ecodes & set(fam) and cid not in ecodes and e["participant"] in pids:
            child_only += 1
    return {
        "id": cid,
        "name": c.get("name") or "",
        "parent": c.get("parent"),
        "status": c.get("status"),
        "definition": c.get("definition") or "",
        "include": c.get("include") or "",
        "exclude": c.get("exclude") or "",
        "tags": c.get("tags") or [],
        "examples": c.get("examples") or [],
        "merged_into": c.get("merged_into"),
        "added": c.get("added") or {},
        "proposal": c.get("proposal") or None,
        "reviewed": c.get("reviewed") or None,
        "redefined_version": c.get("redefined_version"),
        "family": fam,
        "participants": [p for p in pids if p in pmap],
        "n": len([p for p in pids if p in pmap]),
        "extracts": n_ex,
        "direct_extracts": sum(len(v) for k, v in direct.items() if k in pids),
        # `extracts` counts distinct extracts in the family; these two partition it, so a
        # parent carrying more than its children is a comparison of like with like.
        "child_extracts": child_only,
        "kinds": {"said": kinds["said"], "did": kinds["did"], "intent": kinds["intent"]},
    }


def extract_public(an: Analysis, e: dict) -> dict:
    out = dict(e)
    out.update(extract_state(an, e))
    out["words"] = len(norm(e.get("text", "")).split())
    return out


def transcript_state(an: Analysis, t: dict) -> str:
    v = int(an.codebook.get("version", 1))
    cv = t.get("coded_with_version")
    if cv is None:
        return "uncoded"
    return "stale" if int(cv) < v else "current"


def coverage_json(an: Analysis) -> dict:
    parts = an.participants()
    pids = [p["id"] for p in parts]
    N = len(pids)
    codes = [code_public(an, c, pids) for c in sorted(an.live_codes(), key=lambda c: (c.get("parent") or c["id"], 0 if not c.get("parent") else 1, c["id"]))]
    # heatmap cells: code -> participant -> {extracts, kinds}
    cells: dict[str, dict[str, dict]] = {}
    for c in codes:
        fam = set(c["family"])
        row: dict[str, dict] = {}
        for e in an.extracts:
            if e["participant"] not in pids:
                continue
            if {an.resolve_code(x) for x in e.get("codes", [])} & fam:
                cell = row.setdefault(e["participant"], {"extracts": [], "kinds": {"said": 0, "did": 0, "intent": 0}})
                cell["extracts"].append(e["id"])
                cell["kinds"][e.get("kind", "said")] = cell["kinds"].get(e.get("kind", "said"), 0) + 1
        cells[c["id"]] = row
    all_top = sorted({an.resolve_code(c["id"]) for c in an.live_codes() if not c.get("parent")})
    participants = []
    for p in parts:
        exs = [e for e in an.extracts if e["participant"] == p["id"]]
        pcodes = set()
        for e in exs:
            for cid in e.get("codes", []):
                r = an.resolve_code(cid)
                cc = an.code(r)
                pcodes.add((cc.get("parent") or r) if cc else r)
        participants.append({
            "id": p["id"], "role": p.get("role"), "group": p.get("group"), "notes": p.get("notes"),
            "speakers": p.get("speakers") or [],
            "transcripts": [t["id"] for t in an.study.get("transcripts", []) if p["id"] in (t.get("participants") or [])],
            "extracts": len(exs), "distinct_codes": len(pcodes),
            "missing_top": [c for c in all_top if c not in pcodes],
        })
    transcripts = []
    for t in an.study.get("transcripts", []):
        exs = [e for e in an.extracts if e.get("transcript") == t["id"]]
        transcripts.append({
            "id": t["id"], "path": str(t.get("path") or ""), "participants": t.get("participants") or [],
            "kind": t.get("kind"), "extracts": len(exs),
            "new_extracts": sum(1 for e in exs if extract_state(an, e)["new"]),
            "coded_with_version": t.get("coded_with_version"), "state": transcript_state(an, t),
        })
    themes = []
    for th in an.themes["themes"]:
        fam = theme_family(an, th)
        pmap = participants_for_codes(an, fam)
        ps = [p for p in pids if p in pmap]
        themes.append({
            "id": th.get("id"), "name": th.get("name") or "", "parent": th.get("parent"),
            "status": th.get("status"), "in_paper": th.get("in_paper", "undecided"),
            "rq": th.get("rq"), "essence": th.get("essence") or "", "story": th.get("story") or "",
            "codes": th.get("codes") or [], "family": sorted(fam),
            "tensions": th.get("tensions") or [], "selected_extracts": th.get("selected_extracts") or [],
            "quote_spans": th.get("quote_spans") or {}, "reviewed": th.get("reviewed") or None,
            "participants": ps, "n": len(ps), "N": N,
            "extracts": sum(len(v) for k, v in pmap.items() if k in pids),
        })
    return {
        "study": an.study.get("study") or "",
        "approach": an.study.get("approach") or {},
        "research_questions": an.study.get("research_questions") or [],
        "codebook_version": int(an.codebook.get("version", 1)),
        "frozen": bool(an.codebook.get("frozen")),
        "N": N,
        "total_extracts": len(an.extracts),
        "codes": codes,
        "cells": cells,
        "participants": participants,
        "roster": an.study.get("participants", []),
        "transcripts": transcripts,
        "themes": themes,
        "zero_codes": [c["id"] for c in codes if c["n"] == 0],
        "silent_participants": [p["id"] for p in participants if p["extracts"] == 0],
    }


def theme_family(an: Analysis, th: dict) -> set[str]:
    """Every code a theme gathers, including its sub-themes' codes and children."""
    fam: set[str] = set()
    for c in th.get("codes") or []:
        fam |= code_family(an, an.resolve_code(c))
    for sub in an.themes["themes"]:
        if sub.get("parent") == th.get("id"):
            for c in sub.get("codes") or []:
                fam |= code_family(an, an.resolve_code(c))
    return fam


def dupes_json(an: Analysis) -> dict:
    """The same suspicions `dupes` prints, as structured pairs the tree can badge."""
    codes = an.live_codes()
    ex_by_code: dict[str, set[str]] = defaultdict(set)
    for e in an.extracts:
        for c in e.get("codes", []):
            ex_by_code[an.resolve_code(c)].add(e["id"])
    out = []
    for i, a in enumerate(codes):
        for b in codes[i + 1:]:
            if a.get("parent") == b["id"] or b.get("parent") == a["id"]:
                continue
            ta_, tb_ = token_set(f"{a['id']} {a.get('name','')}"), token_set(f"{b['id']} {b.get('name','')}")
            js = jaccard(ta_, tb_)
            if js >= 0.5 and (ta_ & tb_):
                out.append({"kind": "names", "a": a["id"], "b": b["id"], "score": round(js, 2), "shared": 0,
                            "text": f"names overlap ({js:.2f})"})
            ea, eb = ex_by_code.get(a["id"], set()), ex_by_code.get(b["id"], set())
            if ea and eb:
                jo = jaccard(ea, eb)
                if jo >= 0.5:
                    out.append({"kind": "extracts", "a": a["id"], "b": b["id"], "score": round(jo, 2),
                                "shared": len(ea & eb), "text": f"{len(ea & eb)} of {len(ea | eb)} extracts shared"})
                elif len(ea) >= 3 and ea <= eb:
                    out.append({"kind": "subset", "a": a["id"], "b": b["id"], "score": 1.0, "shared": len(ea),
                                "text": f"`{a['id']}` ({len(ea)}) is a strict subset of `{b['id']}` ({len(eb)})"})
                elif len(eb) >= 3 and eb <= ea:
                    out.append({"kind": "subset", "a": b["id"], "b": a["id"], "score": 1.0, "shared": len(eb),
                                "text": f"`{b['id']}` ({len(eb)}) is a strict subset of `{a['id']}` ({len(ea)})"})
            da, db = fold(a.get("definition") or ""), fold(b.get("definition") or "")
            if da and da == db:
                out.append({"kind": "identical-definition", "a": a["id"], "b": b["id"], "score": 1.0, "shared": 0,
                            "text": "identical definitions"})
    return {"suspicions": out, "live_codes": len(codes)}


def stale_rows(an: Analysis) -> list[dict]:
    v = int(an.codebook.get("version", 1))
    rows = []
    for t in an.study.get("transcripts", []):
        cv = t.get("coded_with_version")
        if cv is None:
            rows.append({"transcript": t["id"], "coded_with_version": None, "reason": "never coded",
                         "codes_since": [], "severity": "recode"})
        elif int(cv) < v:
            since = sorted({c["id"] for c in an.live_codes() if code_change_version(an, c["id"]) > int(cv)})
            rows.append({"transcript": t["id"], "coded_with_version": int(cv),
                         "reason": f"coded with v{cv}, codebook is v{v}", "codes_since": since,
                         "severity": "recode" if since else "version-only"})
    return rows


def stale_json(an: Analysis) -> dict:
    return {"codebook_version": int(an.codebook.get("version", 1)),
            "transcripts": len(an.study.get("transcripts", [])),
            "stale": stale_rows(an),
            "reread_requests": [r for r in (an.study.get("reread_requests") or []) if r.get("status") != "done"]}


def collate_json(an: Analysis, target: str) -> dict:
    th = an.theme(target)
    if th:
        fam = theme_family(an, th)
        kind, title = "theme", f"{th['id']} {th.get('name','')}"
    else:
        if an.code(target) is None:
            raise SystemExit(f"{target} is neither a code nor a theme id")
        fam = code_family(an, an.resolve_code(target))
        kind, title = "code", target
    by_p: dict[str, list[dict]] = defaultdict(list)
    for e in an.extracts:
        if {an.resolve_code(c) for c in e.get("codes", [])} & fam:
            by_p[e["participant"]].append(e)
    groups = []
    for p in an.participants(None):
        pid = p["id"]
        if pid not in by_p:
            continue
        rows = sorted(by_p[pid], key=lambda e: (e.get("transcript") or "", int(e.get("line_start") or 0)))
        groups.append({"participant": pid, "role": p.get("role"), "extracts": [extract_public(an, e) for e in rows]})
    return {"target": target, "kind": kind, "title": title, "family": sorted(fam),
            "N": len(an.participants()), "participants": len([g for g in groups if g["role"] == "participant"]),
            "total": sum(len(g["extracts"]) for g in groups), "groups": groups}


def locate_span(turn_text: str, extract_text: str) -> tuple[int, int] | None:
    """Character offsets of an extract inside its turn, in normalised coordinates.

    The workbench highlights spans by offset rather than by re-searching in the
    browser, so this is the one place the match is computed — the same
    normalisation `annotate` uses, minus its regex escaping.
    """
    hay, needle = norm(turn_text), norm(extract_text)
    if not needle:
        return None
    i = hay.lower().find(needle.lower())
    if i < 0:
        return None
    return i, i + len(needle)


def transcript_json(an: Analysis, tid: str) -> dict:
    """One transcript as the review surface: turns, resolved speakers, coded spans."""
    t = an.transcript(tid)
    if t is None:
        raise SystemExit(f"unknown transcript {tid}")
    lines = an.transcript_lines(t)
    turns = parse_turns(lines)
    mine = [e for e in an.extracts if e.get("transcript") == tid]
    by_first_line: dict[int, list[dict]] = defaultdict(list)
    for e in mine:
        by_first_line[int(e.get("line_start") or 0)].append(e)
    dupe_codes = set()
    for s in dupes_json(an)["suspicions"]:
        dupe_codes.add(s["a"])
        dupe_codes.add(s["b"])
    out_turns = []
    unlocated: list[str] = []
    for idx, tr in enumerate(turns):
        text = norm(" ".join([tr["text"]]))
        p = an.participant_for_speaker(tr["speaker"])
        spans = []
        for e in sorted(by_first_line.get(tr["line"], []), key=lambda e: e["id"]):
            loc = locate_span(tr["text"], e.get("text", ""))
            if loc is None:
                unlocated.append(e["id"])
                spans.append({"extract": e["id"], "start": None, "end": None})
            else:
                spans.append({"extract": e["id"], "start": loc[0], "end": loc[1]})
        out_turns.append({
            "index": idx, "line": tr["line"], "end_line": tr["end_line"], "timestamp": tr["timestamp"],
            "speaker": tr["speaker"], "participant": (p or {}).get("id"), "role": (p or {}).get("role") or "unknown",
            "text": text, "spans": spans,
        })
    # consistency hints, so the eye lands where the coding was least certain
    line_of = {e["id"]: int(e.get("line_start") or 0) for e in mine}
    fam_of: dict[str, set[str]] = {}
    for e in mine:
        tops = set()
        for cid in e.get("codes", []):
            c = an.code(an.resolve_code(cid)) or {}
            tops.add(c.get("parent") or an.resolve_code(cid))
        fam_of[e["id"]] = tops
    turn_index = {tr["line"]: i for i, tr in enumerate(turns)}
    extracts = []
    for e in mine:
        hints = []
        for cid in e.get("codes", []):
            c = an.code(cid)
            if c is None:
                hints.append({"kind": "unknown-code", "text": f"`{cid}` is not in the codebook"})
            elif c.get("status") == "candidate":
                hints.append({"kind": "candidate-code", "text": f"`{cid}` is still a candidate"})
            elif c.get("status") == "merged":
                hints.append({"kind": "merged-code", "text": f"`{cid}` was merged into `{c.get('merged_into')}`"})
            elif c.get("status") == "retired":
                hints.append({"kind": "retired-code", "text": f"`{cid}` is retired"})
            if cid in dupe_codes:
                hints.append({"kind": "dupe", "text": f"`{cid}` is in a duplicate suspicion"})
        if e["id"] in unlocated:
            hints.append({"kind": "unlocated", "text": "text not found in its turn; fix the locator or re-trim"})
        mi = turn_index.get(line_of.get(e["id"], -1))
        if mi is not None:
            for other in mine:
                if other["id"] == e["id"]:
                    continue
                oi = turn_index.get(line_of.get(other["id"], -1))
                if oi is None or abs(oi - mi) != 1:
                    continue
                if fam_of[e["id"]] & fam_of[other["id"]] and set(e.get("codes", [])) != set(other.get("codes", [])):
                    hints.append({"kind": "family-adjacent",
                                  "text": f"{other['id']} on the neighbouring turn shares a family with different codes"})
                    break
        pub = extract_public(an, e)
        pub["hints"] = hints
        extracts.append(pub)
    pids = [p["id"] for p in an.participants()]
    codes = {c["id"]: code_public(an, c, pids) for c in an.codebook["codes"]}
    frames = frame_index(an, t)
    return {
        "transcript": {
            "id": t["id"], "path": str(t.get("path") or ""), "abs_path": str(an.transcript_path(t)),
            "participants": t.get("participants") or [], "kind": t.get("kind"),
            "coded_with_version": t.get("coded_with_version"), "state": transcript_state(an, t),
            "lines": len(lines), "turns": len(turns),
        },
        "turns": out_turns,
        "extracts": extracts,
        "codes": codes,
        "frames": frames,
        "stats": {
            "extracts": len(mine),
            "new": sum(1 for e in extracts if e["new"]),
            "kinds": {k: sum(1 for e in mine if e.get("kind") == k) for k in ("said", "did", "intent")},
            "unlocated": sorted(set(unlocated)),
        },
    }


def frame_index(an: Analysis, t: dict) -> dict:
    """The `watch-recording` frame grid beside a transcript, if there is one.

    Frames are named HH-MM-SS.jpg one folder up from the transcript; the workbench
    hovers a timestamp and asks for the nearest frame at or before it.
    """
    d = an.transcript_path(t).parent / "video-snapshots"
    if not d.is_dir():
        return {"dir": None, "frames": []}
    rows = []
    for f in sorted(d.iterdir()):
        m = re.match(r"^(?:exact-)?(\d{2})-(\d{2})-(\d{2})\.(jpg|jpeg|png|webp)$", f.name, flags=re.I)
        if not m:
            continue
        secs = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        rows.append({"file": f.name, "timestamp": f"{m.group(1)}:{m.group(2)}:{m.group(3)}", "seconds": secs,
                     "exact": f.name.lower().startswith("exact-")})
    rows.sort(key=lambda r: (r["seconds"], r["exact"]))
    return {"dir": str(d), "frames": rows}


def transcript_files(an: Analysis, t: dict) -> dict:
    """Where a transcript and its frame grid live, for the daemon to serve them from."""
    try:
        path = an.transcript_path(t)
    except Exception:  # a bad path is validate's problem, not the viewer's
        return {"abs_path": None, "frames_dir": None}
    frames = path.parent / "video-snapshots"
    return {"abs_path": str(path), "frames_dir": str(frames) if frames.is_dir() else None}


def spread_json(an: Analysis) -> dict:
    """Attribution spread over the quotes chosen for the paper, with the skill's warnings."""
    pids = [p["id"] for p in an.participants()]
    per_participant: dict[str, list[dict]] = {p: [] for p in pids}
    rows = []
    warnings = []
    for th in an.themes["themes"]:
        if th.get("in_paper") == "no" or th.get("status") in ("dropped", "merged"):
            continue
        sel = th.get("selected_extracts") or []
        kinds = Counter()
        for eid in sel:
            e = an.extract(eid)
            if not e:
                warnings.append({"kind": "missing-extract", "text": f"{th.get('id')} selects {eid}, which no longer exists"})
                continue
            kinds[e.get("kind", "said")] += 1
            per_participant.setdefault(e["participant"], []).append({"theme": th.get("id"), "extract": eid})
        fam = theme_family(an, th)
        available = Counter()
        for e in an.extracts:
            if {an.resolve_code(c) for c in e.get("codes", [])} & fam:
                available[e.get("kind", "said")] += 1
        rows.append({"theme": th.get("id"), "name": th.get("name") or "", "in_paper": th.get("in_paper", "undecided"),
                     "selected": len(sel), "kinds": dict(kinds), "available_kinds": dict(available),
                     "tensions": len(th.get("tensions") or [])})
        if available["did"] and not kinds["did"]:
            warnings.append({"kind": "no-did-quote", "theme": th.get("id"),
                             "text": f"{th.get('id')} has {available['did']} `did` extract(s) but no `did` quote selected"})
        if sel and not (th.get("tensions") or []):
            warnings.append({"kind": "no-tension", "theme": th.get("id"),
                             "text": f"{th.get('id')} has quotes but no tension recorded"})
    for pid, qs in per_participant.items():
        if len(qs) > 3:
            warnings.append({"kind": "over-quoted", "participant": pid,
                             "text": f"{pid} is quoted {len(qs)} times across the paper"})
    unquoted = [p for p in pids if not per_participant.get(p)]
    if unquoted:
        warnings.append({"kind": "unquoted", "text": "quoted nowhere: " + ", ".join(unquoted)})
    return {"themes": rows, "per_participant": {k: v for k, v in per_participant.items()},
            "unquoted": unquoted, "warnings": warnings}


def bundle_json(an: Analysis) -> dict:
    """Everything a workbench tab needs on load, in one process."""
    cov = coverage_json(an)
    memos = (an.root / "memos.md")
    applied = sorted((an.root / "reviews").glob("*-applied.jsonl")) if (an.root / "reviews").is_dir() else []
    return {
        **cov,
        "root": str(an.root.resolve()),
        "dupes": dupes_json(an)["suspicions"],
        "stale": stale_json(an),
        "extracts_all": [extract_public(an, e) for e in an.extracts],
        "changelog": an.codebook.get("changelog") or [],
        "inbox": annotate_claims(read_inbox(an)),
        "spread": spread_json(an),
        "memos": memos.read_text(encoding="utf-8") if memos.exists() else "",
        "transcript_files": {t["id"]: transcript_files(an, t) for t in an.study.get("transcripts", [])},
        "applied_logs": [p.name for p in applied],
        "frozen": bool(an.codebook.get("frozen")),
        "generated": dt.datetime.now().isoformat(timespec="seconds"),
    }


# ======================================================================= inbox
# The workbench never writes a data file. Every gesture it makes lands here as one
# typed operation, and `apply` is the only thing that touches the analysis: the
# script stays the single writer, the cascades run in one place, and the applied
# log is the audit trail of the review itself.
INBOX_NAME = "inbox.jsonl"
LOCK_NAME = ".inbox.lock"
APPLY_LOCK_NAME = ".apply.lock"
LOCK_STALE_SECONDS = 10.0
# A claim (or an apply lock) left behind by a killed run is released after this, so a crash
# cannot strand the researcher's feedback in a state nothing will pick up again.
CLAIM_STALE_MINUTES = 15


class OpError(Exception):
    """A staged operation that cannot be applied as written."""


def inbox_path(an: Analysis) -> Path:
    return an.root / INBOX_NAME


def _lock_path(an: Analysis, name: str = LOCK_NAME) -> Path:
    return an.root / name


def _lock_holder(path: Path) -> dict:
    """Who holds this lock, tolerating a file written by an older version of the script.

    The current format is `{"pid": N, "token": "...", "at": "..."}`. A file holding just a
    pid (the first version) still identifies its owner, which is what the liveness check
    needs; anything unreadable leaves the pid unknown and falls back to the age rule.
    """
    try:
        text = path.read_text(encoding="utf-8").strip()
    except (FileNotFoundError, OSError):
        return {}
    try:
        parsed = json.loads(text or "{}")
    except json.JSONDecodeError:
        return {"pid": int(text)} if text.isdigit() else {}
    if isinstance(parsed, int):
        return {"pid": parsed}
    return parsed if isinstance(parsed, dict) else {}


def _alive(pid: int) -> bool:
    """Is that process still running? (Signal 0 asks without sending anything.)"""
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # someone else's process, but it exists


_HELD: dict[str, str] = {}   # lock name -> the token this process wrote


def take_lock(an: Analysis, name: str = LOCK_NAME, stale_seconds: float = LOCK_STALE_SECONDS,
              timeout: float = 5.0, whose: str = "another process") -> Path:
    """A cross-process advisory lock, so the daemon and the script never interleave.

    A create-exclusive file holding the owner's pid and a token. Two rules keep it honest:
    a lock is only stolen when it is older than `stale_seconds` **and** its owning process
    is gone (so a writer that is merely slow, paused, or resuming from sleep keeps its
    lock), and it is only released by the process whose token is in the file (so a writer
    whose lock *was* stolen cannot delete its successor's).
    """
    import secrets
    import time

    path = _lock_path(an, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(8)
    deadline = time.time() + timeout
    while True:
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
            os.write(fd, json.dumps({"pid": os.getpid(), "token": token,
                                     "at": dt.datetime.now().isoformat(timespec="seconds")}).encode())
            os.close(fd)
            _HELD[name] = token
            return path
        except FileExistsError:
            try:
                age = time.time() - path.stat().st_mtime
            except FileNotFoundError:
                continue
            holder = _lock_holder(path)
            pid = int(holder.get("pid") or 0)
            if age > stale_seconds and not _alive(pid):
                # Take the stale file out of the way by *renaming* it, which is atomic: if
                # two contenders both saw it, only one rename succeeds, and the loser loops
                # round to find either no lock or the winner's live one. Unlinking here
                # instead would let the loser delete the winner's fresh lock.
                gone = path.with_name(f"{path.name}.stale-{token}")
                try:
                    path.replace(gone)
                    gone.unlink()
                except (FileNotFoundError, OSError):
                    pass
                continue
            if time.time() > deadline:
                who = f"{whose} (pid {pid})" if pid else whose
                raise SystemExit(
                    f"{path.name} is held by {who}. Wait for it to finish"
                    + (f"; if that process is gone, delete {path}." if stale_seconds > 60 else ", then try again.")
                )
            time.sleep(0.05)


def release_lock(an: Analysis, name: str = LOCK_NAME) -> None:
    """Release only our own lock: if it was stolen, the file now belongs to someone else."""
    path = _lock_path(an, name)
    mine = _HELD.pop(name, None)
    if not path.exists():
        return
    if mine is not None and _lock_holder(path).get("token") != mine:
        return   # ours was stolen; this file belongs to whoever took it
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def inbox_lock(an: Analysis, timeout: float = 5.0):
    return take_lock(an, LOCK_NAME, LOCK_STALE_SECONDS, timeout)


def inbox_unlock(an: Analysis) -> None:
    release_lock(an, LOCK_NAME)


def apply_lock(an: Analysis):
    """Held for a whole pass: two passes must not load, mutate and rewrite the same
    analysis files from different snapshots, or the later save silently wins."""
    return take_lock(an, APPLY_LOCK_NAME, CLAIM_STALE_MINUTES * 60.0, timeout=1.0,
                     whose="another `apply` on this folder")


def apply_unlock(an: Analysis) -> None:
    release_lock(an, APPLY_LOCK_NAME)


def stale_claim(o: dict) -> bool:
    """An `applying` row whose claiming run is long gone."""
    if o.get("status") != "applying":
        return False
    try:
        claimed = dt.datetime.fromisoformat(str(o.get("claimed_at")))
    except (TypeError, ValueError):
        return True
    return claimed < dt.datetime.now() - dt.timedelta(minutes=CLAIM_STALE_MINUTES)


def annotate_claims(rows: list[dict]) -> list[dict]:
    """For *display*: report a dead claim as stalled without writing anything.

    `apply` is what persists this (`flag_stale_claims`), but `inbox` is the command the
    agent runs first, and the workbench reads the same rows — neither should call a claim
    from a run that died fifteen minutes ago "in flight".
    """
    out = []
    for o in rows:
        if stale_claim(o):
            o = {**o, "status": "stalled",
                 "error": o.get("error") or ("an earlier `apply` died holding this claim; it may or may not have "
                                             "taken effect. Check the data, then apply it again by id, or drop it.")}
        out.append(o)
    return out


def read_inbox(an: Analysis) -> list[dict]:
    """Every line in the inbox. A line that will not parse comes back as `malformed`, so it
    is reported rather than silently skipped, and is never selected for applying."""
    path = inbox_path(an)
    if not path.exists():
        return []
    ops = []
    for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            ops.append(json.loads(line))
        except json.JSONDecodeError as exc:
            # Keep the line whole: `write_inbox` re-emits it verbatim and the id counter
            # scans it, so a truncated `{"id":"op-0042"...` neither vanishes on the next
            # rewrite nor gets handed out again. Only the display truncates.
            ops.append({"id": f"op-bad-{n}", "op": "?", "status": "malformed", "error": str(exc), "raw": line})
    return ops


def applied_log_paths(an: Analysis) -> list[Path]:
    d = an.root / "reviews"
    return sorted(d.glob("*-applied.jsonl")) if d.is_dir() else []


OP_ID_RE = re.compile(r"op-(\d+)")


def next_op_id(an: Analysis, existing: list[dict] | None = None) -> str:
    """The next free operation id. Ids are never reused, so this looks at the inbox *and*
    every applied log — and at the raw text of a line that would not parse, since a
    truncated `{"id":"op-0042"...` still spent that number."""
    top = 0
    raw_texts: list[str] = []
    rows = list(existing if existing is not None else read_inbox(an))
    for path in applied_log_paths(an):
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    raw_texts.append(line)   # only an unparseable line needs a raw scan
        except OSError:
            continue
    for o in rows:
        m = re.fullmatch(r"op-(\d+)", str(o.get("id", "")))
        if m:
            top = max(top, int(m.group(1)))
        if o.get("raw"):
            raw_texts.append(str(o["raw"]))
    for text in raw_texts:
        for m in OP_ID_RE.finditer(text):
            top = max(top, int(m.group(1)))
    return f"op-{top + 1:04d}"


def append_inbox(an: Analysis, op: dict) -> dict:
    """Append one operation under the lock, assigning its id."""
    inbox_lock(an)
    try:
        existing = read_inbox(an)
        op = dict(op)
        op.setdefault("at", dt.datetime.now().isoformat(timespec="minutes"))
        op.setdefault("by", "agent")
        op.setdefault("status", "pending")
        op["id"] = op.get("id") or next_op_id(an, existing)
        with inbox_path(an).open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(op, ensure_ascii=False, default=json_safe) + "\n")
        return op
    finally:
        inbox_unlock(an)


def _inbox_line(o: dict) -> str:
    """A row as one line: a line that never parsed goes back exactly as it came."""
    if o.get("status") == "malformed" and o.get("raw"):
        return str(o["raw"])
    return json.dumps(o, ensure_ascii=False, default=json_safe)


def write_inbox(an: Analysis, rows: list[dict]) -> None:
    """Replace the inbox with these rows, atomically.

    Call it under the lock, having read the file inside the same lock: every writer (this
    script and the daemon) does a full read-modify-write, so no writer has to reason about
    byte offsets in a file another one may have rewritten underneath it.
    """
    path = inbox_path(an)
    body = "".join(_inbox_line(o) + "\n" for o in rows)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(path)


def applied_ids(an: Analysis) -> set[str]:
    """Every operation id that reached an applied log."""
    out: set[str] = set()
    for path in applied_log_paths(an):
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    out.add(str(json.loads(line).get("id")))
                except json.JSONDecodeError:
                    continue
        except OSError:
            continue
    return out


def flag_stale_claims(an: Analysis, rows: list[dict]) -> tuple[list[str], list[str]]:
    """Deal with claims an earlier `apply` never finished — without guessing.

    A claim whose id is already in an applied log completed; the run died before it could
    tidy the inbox, so the row is dropped. Any other stale claim is marked `stalled` rather
    than handed back as pending: whether it took effect is exactly the sort of question this
    skill refuses to answer on the researcher's behalf, and re-running `new-theme` or
    `new-extract` blind would duplicate it. `apply <id>` re-runs one deliberately.
    """
    cutoff = dt.datetime.now() - dt.timedelta(minutes=CLAIM_STALE_MINUTES)
    done = applied_ids(an)
    stalled, completed = [], []
    for o in list(rows):
        if o.get("status") != "applying":
            continue
        try:
            claimed = dt.datetime.fromisoformat(str(o.get("claimed_at")))
        except (TypeError, ValueError):
            claimed = None
        if claimed is not None and claimed >= cutoff:
            continue  # another apply is running right now
        oid = str(o.get("id"))
        if oid in done:
            rows.remove(o)
            completed.append(oid)
        else:
            o["status"] = "stalled"
            o["error"] = ("an earlier `apply` died holding this claim; it may or may not have taken effect. "
                          f"Check the data, then `apply {oid}` to run it again or drop it in the workbench.")
            stalled.append(oid)
    return stalled, completed


def archive_ops(an: Analysis, ops: list[dict]) -> Path:
    d = an.root / "reviews"
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{today()}-applied.jsonl"
    with path.open("a", encoding="utf-8") as fh:
        for o in ops:
            fh.write(json.dumps(o, ensure_ascii=False, default=json_safe) + "\n")
    return path


# ---------------------------------------------------------------- op schema
# view -> what the gesture was; op -> what it does; every op names the ta.py path
# that executes it, so the workbench cannot invent an operation the script has no
# way to perform.
OP_SPECS: dict[str, dict] = {
    # transcript view
    "recode":        {"view": "transcript", "target": "extract", "required": [], "optional": ["add", "remove", "set"]},
    "set-kind":      {"view": "transcript", "target": "extract", "required": ["kind"], "optional": []},
    "set-context":   {"view": "transcript", "target": "extract", "required": [], "optional": ["context"]},
    "set-note":      {"view": "transcript", "target": "extract", "required": [], "optional": ["note"]},
    "retrim":        {"view": "transcript", "target": "extract", "required": [], "optional": ["from", "to", "start", "end", "turn_line"]},
    "drop":          {"view": "transcript", "target": "extract", "required": [], "optional": []},
    "new-extract":   {"view": "transcript", "target": "none", "required": ["transcript", "codes"],
                      "optional": ["line_start", "line_end", "lines", "from", "to", "start", "end", "kind", "context", "note"]},
    "highlight":     {"view": "transcript", "target": "extract", "required": [], "optional": ["reason"]},
    "mark-reviewed": {"view": "transcript", "target": "none", "required": [], "optional": ["transcript", "extracts", "codes", "themes"]},
    # codebook view
    "code-status":   {"view": "codebook", "target": "code", "required": ["status"], "optional": []},
    "set-field":     {"view": "codebook", "target": "code", "required": ["field", "value"], "optional": ["old", "force"]},
    "reparent":      {"view": "codebook", "target": "code", "required": [], "optional": ["parent"]},
    "rename-code":   {"view": "codebook", "target": "code", "required": ["new_id"], "optional": []},
    "merge-code":    {"view": "codebook", "target": "code", "required": ["into"], "optional": ["why"]},
    "split-code":    {"view": "codebook", "target": "code", "required": ["new_id", "extracts"], "optional": ["name", "definition", "include", "exclude"]},
    "new-code":      {"view": "codebook", "target": "none", "required": ["id", "definition"], "optional": ["name", "parent", "include", "exclude", "tags"]},
    # coverage view
    "reread-request": {"view": "coverage", "target": "none", "required": ["transcript"], "optional": ["code", "note"]},
    # themes view
    "new-theme":      {"view": "themes", "target": "none", "required": ["name"], "optional": ["parent", "rq", "essence", "id"]},
    "assign-theme":   {"view": "themes", "target": "code", "required": [], "optional": ["theme"]},
    "set-theme-field": {"view": "themes", "target": "theme", "required": ["field", "value"], "optional": ["old", "force"]},
    "merge-theme":    {"view": "themes", "target": "theme", "required": ["into"], "optional": []},
    "set-tension":    {"view": "themes", "target": "theme", "required": [], "optional": ["add", "remove"]},
    # quotes view
    "select-quote":   {"view": "quotes", "target": "theme", "required": ["extract"], "optional": ["at"]},
    "deselect-quote": {"view": "quotes", "target": "theme", "required": ["extract"], "optional": []},
    "quote-span":     {"view": "quotes", "target": "theme", "required": ["extract"], "optional": ["from", "to", "start", "end", "clear"]},
    # study view
    "set-participant": {"view": "study", "target": "participant", "required": [], "optional": ["id", "role", "group", "notes", "speakers"]},
    "set-transcript":  {"view": "study", "target": "transcript", "required": [], "optional": ["participants", "kind"]},
    "set-stance":      {"view": "study", "target": "none", "required": ["field", "value"], "optional": []},
    "set-rq":          {"view": "study", "target": "none", "required": ["id", "text"], "optional": []},
    # threads: a conversation, never "applied"
    "comment":        {"view": "any", "target": "any", "required": ["text"], "optional": []},
    # `about` is set by `apply` when a thread's target is re-pointed from an operation id to
    # the id of the thing that operation created; it records what it used to point at.
    "reply":          {"view": "any", "target": "thread", "required": ["text"], "optional": []},
}
THREAD_OPS = {"comment", "reply"}
CODEBOOK_OPS = {"code-status", "set-field", "reparent", "rename-code", "merge-code", "split-code", "new-code"}


def validate_op(an: Analysis, op: dict) -> list[str]:
    """Structural check of one staged operation: the workbench's lint."""
    problems = []
    name = op.get("op")
    spec = OP_SPECS.get(str(name))
    if spec is None:
        return [f"unknown op {name!r}"]
    args = op.get("args") or {}
    if not isinstance(args, dict):
        return [f"{op.get('id')}: args must be an object"]
    for key in spec["required"]:
        if args.get(key) in (None, "", []):
            problems.append(f"{op.get('id')} ({name}): missing arg {key}")
    unknown = [k for k in args if k not in spec["required"] and k not in spec["optional"]]
    if unknown:
        problems.append(f"{op.get('id')} ({name}): unknown arg(s) {', '.join(sorted(unknown))}")
    tgt, kind = op.get("target"), spec["target"]
    if kind == "none":
        pass
    elif not tgt:
        problems.append(f"{op.get('id')} ({name}): needs a target")
    elif kind == "extract" and an.extract(tgt) is None:
        problems.append(f"{op.get('id')} ({name}): no extract {tgt}")
    elif kind == "code" and an.code(tgt) is None:
        problems.append(f"{op.get('id')} ({name}): no code {tgt}")
    elif kind == "theme" and an.theme(tgt) is None:
        problems.append(f"{op.get('id')} ({name}): no theme {tgt}")
    elif kind == "participant" and an.participant(tgt) is None:
        problems.append(f"{op.get('id')} ({name}): no participant {tgt}")
    elif kind == "transcript" and an.transcript(tgt) is None:
        problems.append(f"{op.get('id')} ({name}): no transcript {tgt}")
    return problems


# ------------------------------------------------------------- op handlers
def _need_extract(an: Analysis, op: dict) -> dict:
    e = an.extract(op.get("target"))
    if e is None:
        raise OpError(f"no extract {op.get('target')}")
    return e


def _need_code(an: Analysis, cid: str) -> dict:
    c = an.code(cid)
    if c is None:
        raise OpError(f"no code {cid}")
    return c


def _need_theme(an: Analysis, tid: str) -> dict:
    th = an.theme(tid)
    if th is None:
        raise OpError(f"no theme {tid}")
    return th


def _as_list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    return [str(x) for x in v]


def _touch(an: Analysis, e: dict, op: dict, ctx: dict) -> None:
    """Stamp an extract as changed, and as reviewed when the researcher changed it.

    A correction the researcher made is a review of that extract. A change the agent made
    is not, so it drops the stamp and the extract comes back as new in the next pass.
    """
    e["updated"] = dt.datetime.now().isoformat(timespec="seconds")
    if op.get("by", "user") == "user":
        e["reviewed"] = stamped(ctx, {"at": e["updated"], "version": ctx_version(an, ctx)})
    else:
        e.pop("reviewed", None)
    ctx["extracts"] = True


def _check_codes(an: Analysis, cids: list[str]) -> list[str]:
    out = []
    for cid in cids:
        c = an.code(cid)
        if c is None:
            raise OpError(f"unknown code {cid}")
        if c.get("status") == "retired":
            raise OpError(f"code {cid} is retired")
        out.append(an.resolve_code(cid))
    return out


def op_recode(an, op, ctx):
    e = _need_extract(an, op)
    a = op.get("args") or {}
    codes = set(e.get("codes", []))
    if a.get("set"):
        codes = set(_check_codes(an, _as_list(a["set"])))
    if a.get("add"):
        codes |= set(_check_codes(an, _as_list(a["add"])))
    if a.get("remove"):
        codes -= set(_as_list(a["remove"]))
    if not codes:
        raise OpError("that would leave the extract with no codes; drop it instead, or say which code replaces them")
    before = sorted(e.get("codes", []))
    e["codes"] = sorted(codes)
    _touch(an, e, op, ctx)
    return f"{e['id']}: codes {', '.join(before) or '(none)'} -> {', '.join(e['codes'])}"


def op_set_kind(an, op, ctx):
    e = _need_extract(an, op)
    kind = (op.get("args") or {}).get("kind")
    if kind not in EXTRACT_KINDS:
        raise OpError("kind must be said | did | intent")
    before = e.get("kind")
    e["kind"] = kind
    _touch(an, e, op, ctx)
    return f"{e['id']}: kind {before} -> {kind}"


def op_set_context(an, op, ctx):
    e = _need_extract(an, op)
    e["context"] = (op.get("args") or {}).get("context") or None
    _touch(an, e, op, ctx)
    return f"{e['id']}: context set"


def op_set_note(an, op, ctx):
    e = _need_extract(an, op)
    e["note"] = (op.get("args") or {}).get("note") or None
    _touch(an, e, op, ctx)
    return f"{e['id']}: note set"


def op_retrim(an, op, ctx):
    """Re-cut an extract's boundary inside its own turn, keeping its id.

    The new text is sliced out of the transcript by this function, never sent in:
    the workbench passes offsets into the same normalised turn text it was given.
    """
    e = _need_extract(an, op)
    a = op.get("args") or {}
    offsets = None
    if a.get("start") is not None and a.get("end") is not None:
        offsets = (int(a["start"]), int(a["end"]))
    if offsets is None and not (a.get("from") or a.get("to")):
        raise OpError("retrim needs either start/end offsets or from/to text")
    # Offsets only mean something inside the turn they were measured in. The workbench
    # sends the turn it took the selection from; if that is not this extract's own turn,
    # the offsets would cut an unrelated (but perfectly verbatim) slice.
    if a.get("turn_line") is not None:
        tl = int(a["turn_line"])
        if not (int(e["line_start"]) <= tl <= int(e["line_end"]) or tl == int(e["line_start"])):
            raise OpError(
                f"the selection came from line {tl}, but {e['id']} sits at "
                f"{e['transcript']}:{e['line_start']}-{e['line_end']}; select inside the extract's own turn"
            )
    fresh = build_extract(
        an, e["transcript"], int(e["line_start"]), int(e["line_end"]), list(e.get("codes") or []),
        kind=e.get("kind") or "said", frm=a.get("from"), to=a.get("to"), participant=e.get("participant"),
        allow_non_participant=True, offsets=offsets,
    )
    before = e["text"]
    if fold(before) == fold(fresh["text"]):
        return f"{e['id']}: boundary unchanged"
    e["text"] = fresh["text"]
    e["timestamp"] = fresh["timestamp"]
    _touch(an, e, op, ctx)
    return f"{e['id']}: re-trimmed to {len(e['text'].split())} words"


def op_drop(an, op, ctx):
    e = _need_extract(an, op)
    eid = e["id"]
    an._extracts = [x for x in an.extracts if x.get("id") != eid]
    for th in an.themes["themes"]:
        for key in ("selected_extracts", "tensions"):
            if th.get(key):
                th[key] = [x for x in th[key] if x != eid]
        if (th.get("quote_spans") or {}).pop(eid, None) is not None:
            ctx["themes"] = True
    for c in an.codebook["codes"]:
        if c.get("examples"):
            c["examples"] = [x for x in c["examples"] if x != eid]
    ctx["extracts"] = ctx["themes"] = ctx["codebook_meta"] = True
    return f"{eid}: dropped ({op.get('note') or 'no reason given'})"


def op_new_extract(an, op, ctx):
    a = op.get("args") or {}
    if a.get("lines"):
        ls, le = parse_lines_arg(str(a["lines"]))
    else:
        ls = int(a.get("line_start") or 0)
        le = int(a.get("line_end") or ls)
    offsets = None
    if a.get("start") is not None and a.get("end") is not None:
        offsets = (int(a["start"]), int(a["end"]))
    ex = build_extract(
        an, str(a["transcript"]), ls, le, _as_list(a["codes"]), kind=a.get("kind") or "said",
        frm=a.get("from"), to=a.get("to"), context=a.get("context"), note=a.get("note"), offsets=offsets,
    )
    dup = next((e for e in an.extracts if e["participant"] == ex["participant"] and fold(e["text"]) == fold(ex["text"])), None)
    if dup:
        merged = sorted(set(dup["codes"]) | set(ex["codes"]))
        dup["codes"] = merged
        _touch(an, dup, op, ctx)
        return f"{dup['id']}: identical extract already stored; codes now {', '.join(merged)}"
    ex["reviewed"] = stamped(ctx, {"at": dt.datetime.now().isoformat(timespec="seconds"), "version": ctx_version(an, ctx)}) if op.get("by", "user") == "user" else None
    if ex["reviewed"] is None:
        ex.pop("reviewed", None)
    an.extracts.append(ex)
    ctx["extracts"] = True
    op["created"] = ex["id"]
    return f"{ex['id']}: new extract, {a['transcript']}:{ls} {', '.join(ex['codes'])} ({ex['kind']})"


def op_highlight(an, op, ctx):
    e = _need_extract(an, op)
    reason = (op.get("args") or {}).get("reason")
    if reason in (None, "", False) or str(reason).strip().lower() in ("no", "none", "off", "false"):
        e.pop("highlight", None)
        _touch(an, e, op, ctx)
        return f"{e['id']}: highlight cleared"
    e["highlight"] = str(reason)
    _touch(an, e, op, ctx)
    return f"{e['id']}: flagged paper-worthy ({e['highlight']})"


def op_mark_reviewed(an, op, ctx):
    a = op.get("args") or {}
    stamp = {"at": op.get("at") or dt.datetime.now().isoformat(timespec="seconds"), "version": ctx_version(an, ctx)}
    # every copy of it is registered below, so they all move together if the version does
    n = 0
    if a.get("transcript"):
        for e in an.extracts:
            if e.get("transcript") == a["transcript"]:
                e["reviewed"] = stamped(ctx, dict(stamp))
                n += 1
        ctx["extracts"] = True
    for eid in _as_list(a.get("extracts")):
        e = an.extract(eid)
        if e is not None:
            e["reviewed"] = stamped(ctx, dict(stamp))
            n += 1
            ctx["extracts"] = True
    for cid in _as_list(a.get("codes")):
        c = an.code(cid)
        if c is not None:
            c["reviewed"] = stamped(ctx, dict(stamp))
            n += 1
            ctx["codebook_meta"] = True
    for tid in _as_list(a.get("themes")):
        th = an.theme(tid)
        if th is not None:
            th["reviewed"] = stamped(ctx, dict(stamp))
            n += 1
            ctx["themes"] = True
    return f"marked {n} item(s) reviewed at codebook v{stamp['version']}"


def op_code_status(an, op, ctx):
    c = _need_code(an, op.get("target"))
    status = (op.get("args") or {}).get("status")
    if status not in ("candidate", "accepted", "retired"):
        raise OpError("status must be candidate | accepted | retired")
    if status == "retired":
        users = [e["id"] for e in an.extracts if an.resolve_code(op["target"]) in {an.resolve_code(x) for x in e.get("codes", [])}]
        if users:
            raise OpError(f"{c['id']} still codes {len(users)} extract(s) ({', '.join(users[:4])}{'...' if len(users) > 4 else ''}); merge it or recode them first")
        kids = [k["id"] for k in an.codebook["codes"] if k.get("parent") == c["id"] and k.get("status") in ("candidate", "accepted")]
        if kids:
            raise OpError(f"{c['id']} still has live child code(s) {', '.join(kids)}")
    before = c.get("status")
    if before == status:
        return f"{c['id']} is already {status}; nothing changed"
    c["status"] = status
    if status == "accepted":
        c["reviewed"] = stamped(ctx, {"at": dt.datetime.now().isoformat(timespec="seconds"), "version": ctx_version(an, ctx)})
    ctx["codebook"] = True
    ctx["changes"].append(f"{c['id']} {before} -> {status}")
    return f"{c['id']}: {before} -> {status}"


FIELD_NAMES = {"definition", "include", "exclude", "name"}


def op_set_field(an, op, ctx):
    c = _need_code(an, op.get("target"))
    a = op.get("args") or {}
    field = a.get("field")
    if field not in FIELD_NAMES:
        raise OpError(f"field must be one of {', '.join(sorted(FIELD_NAMES))}")
    old, new = a.get("old"), str(a.get("value") or "")
    current = str(c.get(field) or "")
    if old is not None and not a.get("force") and fold(old) != fold(current):
        raise OpError(
            f"{c['id']}.{field} changed since you edited it. On disk now: {current[:120]!r}; "
            f"your edit was against: {str(old)[:120]!r}. Re-read it in the workbench and edit again."
        )
    if fold(new) == fold(current):
        return f"{c['id']}.{field} is already that wording; nothing changed"
    c[field] = new
    if field in ("definition", "include", "exclude"):
        ctx["redefined"].add(c["id"])
    ctx["codebook"] = True
    ctx["changes"].append(f"{c['id']}.{field} reworded")
    return f"{c['id']}: {field} updated ({len(new.split())} words)"


def op_reparent(an, op, ctx):
    c = _need_code(an, op.get("target"))
    parent = (op.get("args") or {}).get("parent") or None
    old_id = c["id"]
    if parent:
        p = _need_code(an, parent)
        if p.get("parent"):
            raise OpError(f"{parent} is itself a child; codes may have at most two levels")
        if p["id"] == c["id"]:
            raise OpError("a code cannot be its own parent")
        kids = [k["id"] for k in an.codebook["codes"] if k.get("parent") == c["id"]]
        if kids:
            raise OpError(f"{c['id']} has child code(s) {', '.join(kids)}; moving it under {parent} would make three levels")
        base = old_id.split(".", 1)[1] if "." in old_id else old_id
        new_id = f"{parent}.{base}"
    else:
        new_id = old_id.split(".", 1)[1] if "." in old_id else old_id
    if new_id != old_id and an.code(new_id) is not None:
        raise OpError(f"{new_id} already exists; rename it first or merge instead")
    c["parent"] = parent
    if new_id != old_id:
        rename_everywhere(an, old_id, new_id)
        c["id"] = new_id
        ctx["extracts"] = ctx["themes"] = True
    ctx["codebook"] = True
    ctx["changes"].append(f"{old_id} -> {'child of ' + parent if parent else 'top level'}{' as ' + new_id if new_id != old_id else ''}")
    return f"{old_id}: now {'a child of ' + parent if parent else 'top level'}" + (f", renamed {new_id}" if new_id != old_id else "")


def op_rename_code(an, op, ctx):
    c = _need_code(an, op.get("target"))
    new = str((op.get("args") or {}).get("new_id") or "")
    if not CODE_ID_RE.match(new):
        raise OpError("new id must be kebab-case, optionally parent.child")
    if an.code(new) is not None:
        raise OpError(f"{new} already exists; merge instead")
    old = c["id"]
    n = do_rename_code(an, old, new)
    ctx["codebook"] = ctx["extracts"] = ctx["themes"] = True
    ctx["changes"].append(f"renamed {old} -> {new}")
    return f"renamed {old} -> {new} ({n} extract(s) updated)"


def op_merge_code(an, op, ctx):
    src = op.get("target")
    dst = (op.get("args") or {}).get("into")
    _need_code(an, src), _need_code(an, dst)
    why = (op.get("args") or {}).get("why")
    n = do_merge_code(an, src, dst, why, bump=False)
    ctx["codebook"] = ctx["extracts"] = ctx["themes"] = True
    ctx["changes"].append(f"merged {src} into {dst}" + (f" ({why})" if why else ""))
    return f"merged {src} -> {dst} ({n} extract(s) recoded)"


def op_split_code(an, op, ctx):
    """Carve a child out of a code, moving the extracts that belong to it."""
    parent = _need_code(an, op.get("target"))
    a = op.get("args") or {}
    if parent.get("parent"):
        raise OpError(f"{parent['id']} is already a child; splitting it would make three levels")
    raw = str(a.get("new_id") or "")
    new_id = raw if raw.startswith(parent["id"] + ".") else f"{parent['id']}.{raw.split('.')[-1]}"
    if not CODE_ID_RE.match(new_id):
        raise OpError(f"{new_id!r} is not a valid code id")
    if an.code(new_id) is not None:
        raise OpError(f"{new_id} already exists")
    moving = _as_list(a.get("extracts"))
    missing = [eid for eid in moving if an.extract(eid) is None]
    if missing:
        raise OpError(f"unknown extract(s) {', '.join(missing)}")
    child = {
        "id": new_id, "name": a.get("name") or new_id.split(".")[-1].replace("-", " ").capitalize(),
        "parent": parent["id"], "definition": a.get("definition") or "", "include": a.get("include") or "",
        "exclude": a.get("exclude") or "", "status": "candidate", "merged_into": None, "tags": parent.get("tags") or [],
        "examples": [], "added": stamped(ctx, {"version": ctx_version(an, ctx), "date": today(), "source": f"split from {parent['id']}"}),
    }
    an.codebook["codes"].append(child)
    n = 0
    for eid in moving:
        e = an.extract(eid)
        codes = set(e.get("codes", []))
        if parent["id"] in codes:
            codes.discard(parent["id"])
        codes.add(new_id)
        e["codes"] = sorted(codes)
        _touch(an, e, op, ctx)
        n += 1
    ctx["codebook"] = ctx["extracts"] = True
    ctx["changes"].append(f"split {new_id} out of {parent['id']} ({n} extracts)")
    op["created"] = new_id
    return f"{new_id}: new candidate child of {parent['id']} with {n} extract(s) moved"


def op_new_code(an, op, ctx):
    a = op.get("args") or {}
    cid = str(a.get("id") or "")
    if not CODE_ID_RE.match(cid):
        raise OpError(f"{cid!r} must be kebab-case, optionally parent.child")
    if an.code(cid) is not None:
        raise OpError(f"{cid} already exists")
    parent = a.get("parent") or (cid.split(".", 1)[0] if "." in cid else None)
    if parent:
        p = _need_code(an, parent)
        if p.get("parent"):
            raise OpError(f"{parent} is itself a child; codes may have at most two levels")
    an.codebook["codes"].append({
        "id": cid, "name": a.get("name") or cid.replace("-", " ").capitalize(), "parent": parent,
        "definition": str(a.get("definition") or ""), "include": a.get("include") or "", "exclude": a.get("exclude") or "",
        "status": "candidate", "merged_into": None, "tags": _as_list(a.get("tags")), "examples": [],
        "added": stamped(ctx, {"version": ctx_version(an, ctx), "date": today(), "source": f"added by {op.get('by', 'user')} in the workbench"}),
    })
    ctx["codebook"] = True
    ctx["changes"].append(f"added {cid}")
    op["created"] = cid
    return f"{cid}: added as a candidate code"


def op_reread_request(an, op, ctx):
    a = op.get("args") or {}
    tid = str(a["transcript"])
    if an.transcript(tid) is None:
        raise OpError(f"no transcript {tid}")
    if a.get("code") and an.code(a["code"]) is None:
        raise OpError(f"no code {a['code']}")
    reqs = an.study.setdefault("reread_requests", [])
    reqs.append({"transcript": tid, "code": a.get("code"), "note": a.get("note"),
                 "asked": op.get("at") or today(), "status": "open"})
    ctx["study"] = True
    ctx["memos"].append(f"re-read requested: {tid}" + (f" for `{a['code']}`" if a.get("code") else "") + (f" — {a['note']}" if a.get("note") else ""))
    return f"re-read requested for {tid}" + (f" / {a['code']}" if a.get("code") else "")


def op_new_theme(an, op, ctx):
    a = op.get("args") or {}
    tid = str(a.get("id") or next_theme_id(an))
    if an.theme(tid) is not None:
        raise OpError(f"{tid} already exists")
    parent = a.get("parent") or None
    if parent:
        pt = _need_theme(an, parent)
        if pt.get("parent"):
            raise OpError(f"{parent} is itself a sub-theme; themes may have at most two levels")
    an.themes["themes"].append({
        "id": tid, "name": str(a["name"]), "parent": parent, "rq": a.get("rq"),
        "essence": a.get("essence") or "", "story": "", "codes": [], "status": "candidate",
        "merged_into": None, "in_paper": "undecided", "tensions": [], "selected_extracts": [],
    })
    ctx["themes"] = True
    op["created"] = tid
    return f"{tid}: new theme \"{a['name']}\""


def next_theme_id(an: Analysis) -> str:
    top = 0
    for th in an.themes["themes"]:
        m = re.match(r"^TH(\d+)$", str(th.get("id", "")))
        if m:
            top = max(top, int(m.group(1)))
    return f"TH{top + 1}"


MISC_THEME = "MISC"


def op_assign_theme(an, op, ctx):
    cid = op.get("target")
    _need_code(an, cid)
    dest = (op.get("args") or {}).get("theme") or None
    if dest == MISC_THEME and an.theme(MISC_THEME) is None:
        an.themes["themes"].append({
            "id": MISC_THEME, "name": "miscellaneous", "parent": None, "rq": None,
            "essence": "Temporary home for codes not yet placed in a theme (Braun & Clarke allow a miscellaneous pile in phase 3).",
            "story": "", "codes": [], "status": "candidate", "merged_into": None, "in_paper": "no",
            "tensions": [], "selected_extracts": [],
        })
    if dest:
        _need_theme(an, dest)
    was = []
    for th in an.themes["themes"]:
        if cid in (th.get("codes") or []):
            was.append(th["id"])
            th["codes"] = [c for c in th["codes"] if c != cid]
    if dest:
        th = an.theme(dest)
        th["codes"] = sorted(set(th.get("codes") or []) | {cid})
    ctx["themes"] = True
    return f"{cid}: {' , '.join(was) or 'unplaced'} -> {dest or 'unplaced'}"


THEME_FIELDS = {"name", "essence", "story", "rq", "in_paper", "status"}


def op_set_theme_field(an, op, ctx):
    th = _need_theme(an, op.get("target"))
    a = op.get("args") or {}
    field = a.get("field")
    if field not in THEME_FIELDS:
        raise OpError(f"field must be one of {', '.join(sorted(THEME_FIELDS))}")
    value = str(a.get("value") or "")
    if field == "in_paper" and value not in IN_PAPER:
        raise OpError(f"in_paper must be one of {', '.join(sorted(IN_PAPER))}")
    if field == "status" and value not in THEME_STATUSES:
        raise OpError(f"status must be one of {', '.join(sorted(THEME_STATUSES))}")
    old = a.get("old")
    current = str(th.get(field) or "")
    if old is not None and not a.get("force") and fold(old) != fold(current):
        raise OpError(f"{th['id']}.{field} changed since you edited it; on disk now: {current[:120]!r}")
    if value == current:
        return f"{th['id']}.{field} is already that; nothing changed"
    th[field] = value
    ctx["themes"] = True
    return f"{th['id']}: {field} updated"


def op_merge_theme(an, op, ctx):
    src = _need_theme(an, op.get("target"))
    dst = _need_theme(an, (op.get("args") or {}).get("into"))
    if src["id"] == dst["id"]:
        raise OpError("a theme cannot be merged into itself")
    for sub in an.themes["themes"]:
        if sub.get("parent") == src["id"]:
            sub["parent"] = dst["id"]
    dst["codes"] = sorted(set(dst.get("codes") or []) | set(src.get("codes") or []))
    dst["tensions"] = list(dict.fromkeys((dst.get("tensions") or []) + (src.get("tensions") or [])))
    dst["selected_extracts"] = list(dict.fromkeys((dst.get("selected_extracts") or []) + (src.get("selected_extracts") or [])))
    # The quotes moved, so their inline trims move with them; a trim the destination
    # already had for the same extract wins, since that is the more recent decision.
    moved_spans = {eid: span for eid, span in (src.get("quote_spans") or {}).items()
                   if eid in dst["selected_extracts"]}
    if moved_spans:
        dst["quote_spans"] = {**moved_spans, **(dst.get("quote_spans") or {})}
    src["codes"] = []
    src["status"] = "merged"
    src["merged_into"] = dst["id"]
    ctx["themes"] = True
    return f"merged {src['id']} into {dst['id']}"


def op_set_tension(an, op, ctx):
    th = _need_theme(an, op.get("target"))
    a = op.get("args") or {}
    tens = list(th.get("tensions") or [])
    for eid in _as_list(a.get("add")):
        if an.extract(eid) is None:
            raise OpError(f"no extract {eid}")
        if eid not in tens:
            tens.append(eid)
    for eid in _as_list(a.get("remove")):
        tens = [x for x in tens if x != eid]
    th["tensions"] = tens
    ctx["themes"] = True
    return f"{th['id']}: {len(tens)} tension(s)"


def op_select_quote(an, op, ctx):
    th = _need_theme(an, op.get("target"))
    a = op.get("args") or {}
    eid = str(a["extract"])
    if an.extract(eid) is None:
        raise OpError(f"no extract {eid}")
    sel = [x for x in (th.get("selected_extracts") or []) if x != eid]
    at = a.get("at")
    if at is None or int(at) >= len(sel):
        sel.append(eid)
    else:
        sel.insert(max(0, int(at)), eid)
    th["selected_extracts"] = sel
    ctx["themes"] = True
    return f"{th['id']}: selected {eid} ({len(sel)} quote(s))"


def op_deselect_quote(an, op, ctx):
    th = _need_theme(an, op.get("target"))
    eid = str((op.get("args") or {})["extract"])
    th["selected_extracts"] = [x for x in (th.get("selected_extracts") or []) if x != eid]
    (th.get("quote_spans") or {}).pop(eid, None)  # the trim belonged to the selection
    ctx["themes"] = True
    return f"{th['id']}: deselected {eid}"


def op_quote_span(an, op, ctx):
    """Record the inline trim of a selected quote, sliced out of the stored extract.

    The paper's shorter quote is derived here from the extract's own text, so it is
    still transcript text and `verify-quotes` still passes on the draft.
    """
    th = _need_theme(an, op.get("target"))
    a = op.get("args") or {}
    eid = str(a["extract"])
    e = an.extract(eid)
    if e is None:
        raise OpError(f"no extract {eid}")
    spans = th.setdefault("quote_spans", {})
    if a.get("clear"):
        spans.pop(eid, None)
        ctx["themes"] = True
        return f"{th['id']}: trim cleared for {eid}"
    text = norm(e.get("text", ""))
    if a.get("start") is not None and a.get("end") is not None:
        s, t = int(a["start"]), int(a["end"])
        if not (0 <= s < t <= len(text)):
            raise OpError(f"offsets {s}-{t} fall outside the extract ({len(text)} characters)")
        cut = text[s:t].strip()
    else:
        low = text.lower()
        i = low.find(fold(a.get("from") or "")) if a.get("from") else 0
        if i < 0:
            raise OpError(f"--from text is not in {eid}")
        if a.get("to"):
            j = low.find(fold(a["to"]), i)
            if j < 0:
                raise OpError(f"--to text is not in {eid} after the start of the trim; nothing was changed")
            cut = text[i: j + len(a["to"])].strip()
        else:
            cut = text[i:].strip()
    if len(cut.split()) < 3:
        raise OpError("a trimmed quote needs at least three words")
    spans[eid] = {"text": cut, "words": len(cut.split()),
                  "from": cut.split()[0], "to": cut.split()[-1]}
    if eid not in (th.get("selected_extracts") or []):
        th["selected_extracts"] = (th.get("selected_extracts") or []) + [eid]
    ctx["themes"] = True
    return f"{th['id']}: {eid} trimmed to {len(cut.split())} words"


def op_set_participant(an, op, ctx):
    p = an.participant(op.get("target"))
    if p is None:
        raise OpError(f"no participant {op.get('target')}")
    a = op.get("args") or {}
    old_id = p["id"]
    if a.get("role"):
        if a["role"] not in ROLES or a["role"] == "unknown":
            raise OpError("role must be participant | interviewer | researcher | other")
        p["role"] = a["role"]
    for key in ("group", "notes"):
        if key in a:
            p[key] = a[key] or None
    if a.get("speakers") is not None:
        p["speakers"] = _as_list(a["speakers"])
    if a.get("id") and a["id"] != old_id:
        new_id = str(a["id"])
        if an.participant(new_id) is not None:
            raise OpError(f"participant {new_id} already exists")
        p["id"] = new_id
        for e in an.extracts:
            if e.get("participant") == old_id:
                e["participant"] = new_id
        for t in an.study.get("transcripts", []):
            t["participants"] = [new_id if x == old_id else x for x in (t.get("participants") or [])]
        ctx["extracts"] = True
    ctx["study"] = True
    return f"{old_id}: roster updated" + (f" (now {p['id']})" if p["id"] != old_id else "")


def op_set_transcript(an, op, ctx):
    t = an.transcript(op.get("target"))
    if t is None:
        raise OpError(f"no transcript {op.get('target')}")
    a = op.get("args") or {}
    if a.get("participants") is not None:
        pids = _as_list(a["participants"])
        for pid in pids:
            if an.participant(pid) is None:
                raise OpError(f"no participant {pid}")
        t["participants"] = pids
    if a.get("kind"):
        t["kind"] = a["kind"]
    ctx["study"] = True
    return f"{t['id']}: {', '.join(t.get('participants') or []) or 'no participants'}"


STANCE_FIELDS = {"orientation", "level", "epistemology", "prevalence_unit", "notes"}


def op_set_stance(an, op, ctx):
    a = op.get("args") or {}
    field = a.get("field")
    if field not in STANCE_FIELDS:
        raise OpError(f"field must be one of {', '.join(sorted(STANCE_FIELDS))}")
    an.study.setdefault("approach", {})[field] = str(a.get("value") or "")
    ctx["study"] = True
    return f"approach.{field} = {a.get('value')}"


def op_set_rq(an, op, ctx):
    a = op.get("args") or {}
    rqs = an.study.setdefault("research_questions", [])
    rid = str(a["id"])
    for rq in rqs:
        if rq.get("id") == rid:
            rq["text"] = str(a["text"])
            ctx["study"] = True
            return f"{rid} updated"
    rqs.append({"id": rid, "text": str(a["text"])})
    ctx["study"] = True
    return f"{rid} added"


HANDLERS = {
    "recode": op_recode, "set-kind": op_set_kind, "set-context": op_set_context, "set-note": op_set_note,
    "retrim": op_retrim, "drop": op_drop, "new-extract": op_new_extract, "highlight": op_highlight,
    "mark-reviewed": op_mark_reviewed, "code-status": op_code_status, "set-field": op_set_field,
    "reparent": op_reparent, "rename-code": op_rename_code, "merge-code": op_merge_code,
    "split-code": op_split_code, "new-code": op_new_code, "reread-request": op_reread_request,
    "new-theme": op_new_theme, "assign-theme": op_assign_theme, "set-theme-field": op_set_theme_field,
    "merge-theme": op_merge_theme, "set-tension": op_set_tension, "select-quote": op_select_quote,
    "deselect-quote": op_deselect_quote, "quote-span": op_quote_span, "set-participant": op_set_participant,
    "set-transcript": op_set_transcript, "set-stance": op_set_stance, "set-rq": op_set_rq,
}


# ------------------------------------------------------------- inbox commands
def op_one_line(an: Analysis, o: dict) -> str:
    a = o.get("args") or {}
    bits = [f"{o.get('id')}", f"[{o.get('by', '?')}]", str(o.get("op"))]
    if o.get("target"):
        bits.append(str(o["target"]))
    detail = ", ".join(f"{k}={json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v}" for k, v in a.items() if k != "text")
    if detail:
        bits.append(f"({detail})")
    if a.get("text"):
        bits.append(f"“{str(a['text'])[:80]}”")
    if o.get("note"):
        bits.append(f"— {o['note']}")
    return " ".join(bits)


def cmd_inbox(an: Analysis, args) -> int:
    ops = annotate_claims(read_inbox(an))
    pending = [o for o in ops if o.get("status") in (None, "pending")]
    failed = [o for o in ops if o.get("status") == "failed"]
    malformed = [o for o in ops if o.get("status") == "malformed"]
    applying = [o for o in ops if o.get("status") == "applying"]
    stalled = [o for o in ops if o.get("status") == "stalled"]
    threads = [o for o in ops if o.get("op") in THREAD_OPS]
    if getattr(args, "json", False):
        print(json.dumps({"pending": pending, "failed": failed, "malformed": malformed,
                          "applying": applying, "stalled": stalled,
                          "problems": [p for o in pending for p in validate_op(an, o)]},
                         ensure_ascii=False, indent=2, default=json_safe))
        return 0
    actionable = [o for o in pending if o.get("op") not in THREAD_OPS]
    by_view: dict[str, list[dict]] = defaultdict(list)
    for o in actionable:
        by_view[str((OP_SPECS.get(str(o.get("op"))) or {}).get("view", "?"))].append(o)
    for view in ("transcript", "codebook", "coverage", "themes", "quotes", "study", "any", "?"):
        rows = by_view.get(view)
        if not rows:
            continue
        print(f"## {view} ({len(rows)})")
        for o in rows:
            print("  " + op_one_line(an, o))
        print()
    open_threads = [o for o in threads if o.get("status") in (None, "pending") and o.get("op") == "comment"]
    if open_threads:
        print(f"## threads ({len(open_threads)} open — reply, do not apply)")
        for o in open_threads:
            print("  " + op_one_line(an, o))
            for r in [x for x in ops if x.get("op") == "reply" and x.get("target") == o.get("id")]:
                print(f"      ↳ [{r.get('by')}] {str((r.get('args') or {}).get('text'))[:100]}")
        print()
    if failed or malformed:
        print(f"## needs attention ({len(failed) + len(malformed)})")
        for o in failed + malformed:
            print(f"  {o.get('id')} {o.get('op')}: {str(o.get('error'))[:200]}")
        print("  fix the cause and apply again; these keep their place in the inbox until they succeed.")
        print()
    if stalled:
        print(f"## stalled — needs your decision ({len(stalled)})")
        for o in stalled:
            print("  " + op_one_line(an, o))
            print(f"      {o.get('error')}")
        print()
    if applying:
        print(f"## in flight ({len(applying)})")
        for o in applying:
            print(f"  {o.get('id')} {o.get('op')} claimed at {o.get('claimed_at')}")
        print(f"  another `apply` is running, or one died; a claim older than {CLAIM_STALE_MINUTES} minutes is released automatically.")
        print()
    problems = [p for o in actionable for p in validate_op(an, o)]
    for p in problems:
        print(f"warning: {p}")
    print(f"inbox: {len(actionable)} operation(s) to apply, {len(open_threads)} open thread(s), "
          f"{len(failed) + len(malformed) + len(stalled)} needing attention"
          + (f", {len(applying)} in flight" if applying else ""))
    if actionable:
        print("apply with: apply --all   (or `apply op-0031 op-0032`)")
    return 0


def thread_rows(rows: list[dict], root_id: str) -> list[dict]:
    """A comment and the replies that hang off it."""
    return [o for o in rows if o.get("id") == root_id or (o.get("op") == "reply" and o.get("target") == root_id)]


def cmd_apply(an: Analysis, args) -> int:
    """Execute what the researcher staged, in the order they staged it.

    Three steps, and the first and last hold the inbox lock: claim the operations this pass
    will run (so a second `apply` cannot take them and the daemon cannot rewrite them out
    from under us), then apply them, then settle the file against a fresh read. `main` holds
    `.apply.lock` around the whole thing, so no other writer can interleave. The pass is
    deliberately not atomic across operations — one that cannot be applied keeps its reason
    and the rest still run, because a partial pass is recoverable and the applied log says
    exactly what happened.
    """
    # ---- 1. claim, under the inbox lock
    inbox_lock(an)
    try:
        rows = read_inbox(an)
        stalled, completed = flag_stale_claims(an, rows)
        wanted = set(args.op_ids or [])
        # `--all` never picks up a stalled claim; naming its id is the deliberate act.
        pending = [o for o in rows if o.get("status") in (None, "pending", "failed")
                   or (o.get("status") == "stalled" and str(o.get("id")) in wanted)]
        selectable = [o for o in pending if o.get("op") not in THREAD_OPS]
        if wanted:
            chosen = [o for o in selectable if o.get("id") in wanted]
            unknown = wanted - {o.get("id") for o in chosen}
            if unknown:
                raise SystemExit(f"no pending operation(s) {', '.join(sorted(unknown))}")
        elif args.all:
            chosen = selectable
        else:
            print("nothing selected. `inbox` lists what is waiting; `apply --all` applies it, or name op ids.")
            return 1
        # A resolved thread is history: archive it with its replies. An open one stays. This
        # is only a first look — step 3 recomputes it from a fresh read, because the
        # researcher may reopen a thread or add a reply while the pass is working.
        threads_done = [x for root in rows if root.get("op") == "comment" and root.get("status") == "resolved"
                        for x in thread_rows(rows, str(root.get("id")))]
        # A malformed operation fails on its own rather than blocking the researcher's
        # other feedback; it keeps its reason in the inbox, like a handler failure.
        invalid: dict[str, str] = {}
        for o in chosen:
            problems = validate_op(an, o)
            if problems:
                invalid[str(o.get("id"))] = "; ".join(problems)
        chosen = [o for o in chosen if str(o.get("id")) not in invalid]
        claimed_at = dt.datetime.now().isoformat(timespec="seconds")
        claimed = {str(o.get("id")) for o in chosen}
        if not args.dry_run:
            for o in rows:
                oid = str(o.get("id"))
                if oid in invalid:
                    o["status"], o["error"] = "failed", invalid[oid]
                    o.pop("claimed_at", None)
                elif oid in claimed:
                    o["status"], o["claimed_at"] = "applying", claimed_at
            if invalid or claimed or stalled or completed:
                write_inbox(an, rows)
        if not chosen and not threads_done:
            for oid, why in invalid.items():
                print(f"FAILED {oid}: {why}")
            open_threads = [o for o in rows if o.get("op") == "comment" and o.get("status") in (None, "pending")]
            print("apply: nothing to apply"
                  + (f"; {len(open_threads)} open thread(s) are a conversation, not an edit — reply to them" if open_threads else ""))
            return 1 if invalid else 0
    finally:
        inbox_unlock(an)
    if completed:
        print(f"cleared {len(completed)} claim(s) an earlier run had already applied: {', '.join(completed)}")
    if stalled:
        print(f"WARNING: {len(stalled)} claim(s) from a run that died: {', '.join(stalled)}. "
              "They are marked `stalled`, not retried — check whether they took effect first.")
    for oid, why in invalid.items():
        print(f"FAILED {oid}: {why}")

    # ---- 2. apply, outside the lock
    # mark-reviewed last: it stamps whatever the other operations leave behind.
    chosen.sort(key=lambda o: (1 if o.get("op") == "mark-reviewed" else 0, str(o.get("id"))))
    version = int(an.codebook.get("version", 1))
    if any(str(o.get("op")) in CODEBOOK_OPS for o in chosen):
        version += 1
    ctx = fresh_ctx(version)
    applied, failed = [], []
    for o in chosen:
        name = str(o.get("op"))
        handler = HANDLERS.get(name)
        if handler is None:
            o["status"], o["error"] = "failed", f"no handler for {name}"
            failed.append(o)
            continue
        try:
            summary = handler(an, o, ctx)
        except (OpError, SystemExit) as exc:
            o["status"], o["error"] = "failed", str(exc)
            failed.append(o)
            print(f"FAILED {o.get('id')} {name}: {exc}")
            continue
        o["status"], o["error"] = "applied", None
        o["applied_at"] = dt.datetime.now().isoformat(timespec="seconds")
        o["result"] = summary
        applied.append(o)
        print(f"applied {o.get('id')} {name}: {summary}")
    if args.dry_run:
        # The handlers have mutated this process's in-memory copy; nothing was claimed and
        # nothing is saved, and the process exits here, so the files on disk are untouched.
        print(f"apply --dry-run: {len(applied)} would apply, {len(failed)} would fail. Nothing written.")
        return 1 if (failed or invalid) else 0
    change = "; ".join(ctx["changes"][:6]) + ("; ..." if len(ctx["changes"]) > 6 else "")
    save_ctx(an, ctx, bump_message=f"applied {len(applied)} reviewed operation(s): {change}")

    # ---- 3. settle the inbox against a fresh read, under the lock
    applied_by_id = {str(o.get("id")): o for o in applied}
    failed_by_id = {str(o.get("id")): o.get("error") for o in failed}
    # A comment on something that did not exist yet (a staged extract, a proposed theme)
    # targets the *operation*. Once the operation has run, the thing has an id, so the
    # thread follows it — otherwise the researcher's question is left pointing at nothing.
    retarget = {oid: str(o["created"]) for oid, o in applied_by_id.items() if o.get("created")}
    repointed = []
    inbox_lock(an)
    try:
        rows = read_inbox(an)
        # Threads are re-read here, not taken from the snapshot: one the researcher reopened
        # while this pass was working stays open, and a reply added meanwhile travels with it.
        threads_done = [x for root in rows if root.get("op") == "comment" and root.get("status") == "resolved"
                        for x in thread_rows(rows, str(root.get("id")))]
        thread_ids = {str(o.get("id")) for o in threads_done}
        keep, archive = [], []
        for o in rows:
            oid = str(o.get("id"))
            if oid in applied_by_id:
                archive.append(applied_by_id[oid])   # the row with its result and applied_at
                continue
            if oid in thread_ids:
                archive.append(o)
                continue
            if oid in failed_by_id:
                o["status"], o["error"] = "failed", failed_by_id[oid]
                o.pop("claimed_at", None)
            elif oid in claimed and o.get("status") == "applying":
                o["status"] = "pending"  # claimed but never reached; hand it back
                o.pop("claimed_at", None)
            if o.get("op") == "comment" and str(o.get("target")) in retarget:
                was = str(o["target"])
                o["target"] = retarget[was]
                o.setdefault("about", was)
                repointed.append(f"{oid}: {was} -> {o['target']}")
            keep.append(o)
        # Archive before the inbox loses the ids, and while still holding the lock, so an
        # operation id is always visible in one file or the other and can never be reused.
        if archive:
            log = archive_ops(an, archive)
            print(f"archived {len(archive)} line(s) to {log.relative_to(an.root)}")
        write_inbox(an, keep)
        for line in repointed:
            print(f"thread re-pointed {line}")
    finally:
        inbox_unlock(an)

    print()
    print(f"apply: {len(applied)} applied, {len(failed) + len(invalid)} failed; codebook v{an.codebook.get('version')}"
          f"{' (frozen)' if an.codebook.get('frozen') else ''}")
    if ctx["codebook"]:
        rows_stale = stale_rows(an)
        for r in rows_stale:
            print(f"  stale: {r['transcript']} — {r['reason']}"
                  + (f"; codes since: {', '.join(r['codes_since'][:6])}" if r["codes_since"] else " (no code changed; nothing to re-read)"))
        if any(r["severity"] == "recode" for r in rows_stale):
            print("  a code added or redefined after a transcript was coded means that transcript needs a pass for it.")
    errors, warnings = validate(an)
    verrors, vwarnings = verify(an)
    for e in errors + verrors:
        print(f"  ERROR: {e}")
    print(f"  validate: {len(errors)} error(s), {len(warnings)} warning(s) · "
          f"verify: {len(an.extracts)} extract(s), {len(verrors)} not verbatim/misattributed, {len(vwarnings)} warning(s)")
    return 1 if (failed or invalid or errors or verrors) else 0


def cmd_stage(an: Analysis, args) -> int:
    """Stage an operation from the command line — how the agent proposes a change.

    A structural proposal belongs where its evidence is, so the agent stages it as a
    `by: agent` op the researcher accepts or rejects in the workbench.
    """
    try:
        payload = json.loads(args.op)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"--op must be JSON: {exc}")
    if isinstance(payload, dict):
        payload = [payload]
    out = []
    for raw in payload:
        op = {"op": raw.get("op"), "target": raw.get("target"), "args": raw.get("args") or {},
              "note": raw.get("note"), "by": raw.get("by") or "agent",
              "view": (OP_SPECS.get(str(raw.get("op"))) or {}).get("view", "any"),
              "status": "pending"}
        problems = validate_op(an, op)
        if problems:
            raise SystemExit("; ".join(problems))
        out.append(append_inbox(an, op))
    for o in out:
        print(f"staged {o['id']}: {op_one_line(an, o)}")
    return 0


def cmd_reply(an: Analysis, args) -> int:
    ops = read_inbox(an)
    thread = next((o for o in ops if o.get("id") == args.thread), None)
    if thread is None:
        raise SystemExit(f"no thread {args.thread} in the inbox")
    if thread.get("op") != "comment":
        raise SystemExit(f"{args.thread} is a {thread.get('op')} operation, not a comment thread")
    o = append_inbox(an, {"op": "reply", "target": args.thread, "args": {"text": args.text},
                          "by": "agent", "view": thread.get("view") or "any"})
    print(f"replied on {args.thread} as {o['id']}")
    return 0


# ------------------------------------------------- one path for every operation
# The CLI and the workbench must not be able to diverge: a command run here goes
# through the same handler `apply` would use, so a fix typed in the terminal and a
# fix clicked in the browser leave identical records.
def fresh_ctx(version: int | None = None) -> dict:
    return {"extracts": False, "codebook": False, "codebook_meta": False, "themes": False,
            "study": False, "redefined": set(), "changes": [], "memos": [], "version": version,
            "stamps": []}


def stamped(ctx: dict | None, stamp: dict) -> dict:
    """Register a `{at, version}` (or `added`) stamp so `save_ctx` can correct its version."""
    if ctx is not None:
        ctx.setdefault("stamps", []).append(stamp)
    return stamp


def ctx_version(an: Analysis, ctx: dict | None) -> int:
    """The codebook version this pass will *end* at.

    A pass bumps the codebook once, at the end, but handlers stamp things as they go —
    `reviewed` on an extract, `added` on a new code. Stamping with the version the pass
    started at would leave an extract the researcher just reviewed looking unreviewed (its
    code changed at a version later than its own stamp), so every stamp reads this.
    """
    v = (ctx or {}).get("version")
    return int(v) if v else int(an.codebook.get("version", 1))


def save_ctx(an: Analysis, ctx: dict, bump_message: str | None = None) -> None:
    if ctx["codebook"]:
        an.codebook["version"] = ctx_version(an, ctx)
        an.codebook.setdefault("changelog", []).append(
            {"version": an.codebook["version"], "date": today(),
             "change": bump_message or ("; ".join(ctx["changes"]) or "codebook edited")})
    # Handlers stamp as they go, against the version the pass *expected* to end at. If the
    # codebook did not move after all (every codebook op no-opped or failed), a stamp
    # claiming the next version would make a future edit at that version invisible to the
    # delta check, so every stamp is corrected to the version that actually holds.
    final = int(an.codebook.get("version", 1))
    for stamp in ctx.get("stamps") or []:
        stamp["version"] = final
    for cid in ctx["redefined"]:
        c = an.code(cid)
        if c is not None:
            c["redefined_version"] = int(an.codebook.get("version", 1))
    if ctx["extracts"]:
        an.save_extracts()
    if ctx["codebook"] or ctx["codebook_meta"] or ctx["redefined"]:
        an.save_codebook()
    if ctx["themes"]:
        an.save_themes()
    if ctx["study"]:
        an.save_study()
    if ctx["memos"]:
        memo = an.root / "memos.md"
        body = memo.read_text(encoding="utf-8") if memo.exists() else "# Analytic memos\n"
        memo.write_text(body.rstrip("\n") + f"\n\n## {today()}\n\n" + "".join(f"- {m}\n" for m in ctx["memos"]),
                        encoding="utf-8")


def run_op_now(an: Analysis, op: dict, quiet: bool = False) -> int:
    """Execute one operation immediately, as the agent's own hand on the data."""
    op = {**op, "by": op.get("by") or "agent", "status": "applied"}
    problems = validate_op(an, op)
    if problems:
        raise SystemExit("; ".join(problems))
    v = int(an.codebook.get("version", 1))
    ctx = fresh_ctx(v + 1 if str(op["op"]) in CODEBOOK_OPS else v)
    try:
        summary = HANDLERS[str(op["op"])](an, op, ctx)
    except OpError as exc:
        raise SystemExit(str(exc))
    save_ctx(an, ctx)
    if not quiet:
        print(summary)
        if ctx["codebook"]:
            print(f"codebook now v{an.codebook.get('version')}; run `stale` to see which transcripts need a pass")
    return 0


def cmd_retrim(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "retrim", "target": args.extract_id,
                           "args": {k: v for k, v in (("from", args.frm), ("to", args.to),
                                                      ("start", args.start), ("end", args.end)) if v is not None}})


def cmd_mark_reviewed(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "mark-reviewed", "args": {k: v for k, v in
                                                           (("transcript", args.transcript), ("extracts", args.extracts),
                                                            ("codes", args.codes), ("themes", args.themes)) if v}})


def cmd_reparent(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "reparent", "target": args.code, "args": {"parent": None if args.root else args.to}})


def cmd_split_code(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "split-code", "target": args.code, "args": {
        "new_id": args.new_id, "extracts": args.extracts, "name": args.name,
        "definition": args.definition, "include": args.include, "exclude": args.exclude}})


def cmd_set_field(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "set-field", "target": args.code,
                           "args": {"field": args.field, "value": args.value, "old": args.old, "force": args.force}})


def cmd_code_status(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "code-status", "target": args.code, "args": {"status": args.status}})


def cmd_new_code(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "new-code", "args": {
        "id": args.id, "name": args.name, "definition": args.definition, "parent": args.parent,
        "include": args.include, "exclude": args.exclude, "tags": args.tags}})


def cmd_reread(an: Analysis, args) -> int:
    reqs = an.study.setdefault("reread_requests", [])
    if args.done:
        n = 0
        for r in reqs:
            if r.get("status") == "open" and r.get("transcript") == args.transcript and (not args.code or r.get("code") == args.code):
                r["status"] = "done"
                r["closed"] = today()
                n += 1
        an.save_study()
        print(f"closed {n} re-read request(s) for {args.transcript}")
        return 0
    if args.transcript:
        return run_op_now(an, {"op": "reread-request", "args": {"transcript": args.transcript, "code": args.code, "note": args.note}})
    open_reqs = [r for r in reqs if r.get("status") == "open"]
    for r in open_reqs:
        print(f"- {r['transcript']}" + (f" / `{r['code']}`" if r.get("code") else "") + (f": {r['note']}" if r.get("note") else "") + f"  (asked {r.get('asked')})")
    print(f"reread: {len(open_reqs)} open request(s)")
    return 0


# ------------------------------------------------------------ theme commands
def cmd_theme_new(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "new-theme", "args": {"name": args.name, "parent": args.parent, "rq": args.rq, "id": args.id}})


def cmd_theme_assign(an: Analysis, args) -> int:
    dest = MISC_THEME if args.misc else (None if args.unplaced else args.to)
    return run_op_now(an, {"op": "assign-theme", "target": args.code, "args": {"theme": dest}})


def cmd_theme_set(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "set-theme-field", "target": args.theme,
                           "args": {"field": args.field, "value": args.value, "old": args.old, "force": args.force}})


def cmd_theme_tension(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "set-tension", "target": args.theme, "args": {"add": args.add, "remove": args.remove}})


def cmd_theme_select(an: Analysis, args) -> int:
    if args.remove:
        for eid in args.remove:
            run_op_now(an, {"op": "deselect-quote", "target": args.theme, "args": {"extract": eid}}, quiet=True)
            print(f"{args.theme}: deselected {eid}")
    for eid in args.add or []:
        run_op_now(an, {"op": "select-quote", "target": args.theme, "args": {"extract": eid, "at": args.at}}, quiet=True)
        print(f"{args.theme}: selected {eid}")
    th = an.theme(args.theme)
    print(f"{args.theme}: {len(th.get('selected_extracts') or [])} quote(s) in order: {', '.join(th.get('selected_extracts') or []) or '-'}")
    return 0


def cmd_theme_trim(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "quote-span", "target": args.theme, "args": {
        "extract": args.extract, "from": args.frm, "to": args.to, "start": args.start, "end": args.end, "clear": args.clear}})


def cmd_theme_merge(an: Analysis, args) -> int:
    return run_op_now(an, {"op": "merge-theme", "target": args.source, "args": {"into": args.target}})


def theme_mermaid(an: Analysis) -> str:
    """The thematic map, drawn from themes.yaml so the document and the board agree."""
    lines = ["graph LR"]
    placed: set[str] = set()
    for th in an.themes["themes"]:
        if th.get("status") in ("merged", "dropped"):
            continue
        tid = str(th.get("id"))
        label = str(th.get("name") or tid).replace("[", "(").replace("]", ")").replace('"', "'")
        lines.append(f'  {tid}["{label}"]')
        if th.get("parent"):
            lines.append(f"  {th['parent']} --> {tid}")
        for cid in th.get("codes") or []:
            node = re.sub(r"[^A-Za-z0-9]", "_", cid)
            lines.append(f"  {tid} --> {node}({cid})")
            placed.add(cid)
    unplaced = [c["id"] for c in an.live_codes() if c["id"] not in placed and not c.get("parent")]
    if unplaced:
        lines.append('  UNPLACED["unplaced"]')
        for cid in unplaced:
            lines.append(f"  UNPLACED --> {re.sub(r'[^A-Za-z0-9]', '_', cid)}({cid})")
    return "\n".join(lines) + "\n"


def cmd_theme_mermaid(an: Analysis, args) -> int:
    print(theme_mermaid(an))
    return 0


# ------------------------------------------------------------ open the workbench
def app_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "app"


def preflight(an: Analysis) -> tuple[list[str], list[str]]:
    """What `lint:plan` is to a hand-authored plan, this is to a data-driven page."""
    # `validate` already lints the inbox, so this is only validate + verify; repeating the
    # inbox checks here would report every bad line twice.
    errors, warnings = validate(an)
    verrors, vwarnings = verify(an)
    return errors + verrors, warnings + vwarnings


def resolve_open_target(an: Analysis, target: str | None) -> str:
    views = {"transcript", "codebook", "coverage", "themes", "quotes", "study", "history"}
    if not target:
        return "view=transcript"
    if target in views:
        return f"view={target}"
    if an.transcript(target) is not None:
        return f"view=transcript&t={target}"
    if an.extract(target) is not None:
        e = an.extract(target)
        return f"view=transcript&t={e['transcript']}&e={target}"
    if an.code(target) is not None:
        return f"view=codebook&c={target}"
    if an.theme(target) is not None:
        return f"view=themes&th={target}"
    raise SystemExit(f"{target!r} is not a view, transcript, extract, code, or theme id")


def cmd_open(an: Analysis, args) -> int:
    import shutil as _shutil
    import subprocess

    if not (app_dir() / "server.mjs").exists():
        raise SystemExit(f"the workbench app is missing at {app_dir()}")
    if _shutil.which("node") is None:
        raise SystemExit("node is not on PATH; the workbench needs it (the plan viewer does too)")
    errors, warnings = preflight(an)
    for w in warnings[:12]:
        print(f"warning: {w}")
    if len(warnings) > 12:
        print(f"... and {len(warnings) - 12} more warning(s); run `validate` and `verify` for the full list")
    for e in errors:
        print(f"ERROR: {e}")
    if errors and not args.force:
        print(f"open: {len(errors)} error(s). Fix the data first, or pass --force to open anyway.")
        return 1
    params = resolve_open_target(an, args.target)
    cmd = ["node", str(app_dir() / "server.mjs"), str(an.root.resolve()), "--params", params]
    if args.no_open:
        cmd.append("--no-open")
    res = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(res.stdout)
    if res.returncode != 0:
        sys.stderr.write(res.stderr)
        raise SystemExit(f"the workbench daemon did not start (exit {res.returncode})")
    return 0


def cmd_serve(an: Analysis, args) -> int:
    import subprocess

    cmd = ["node", str(app_dir() / "server.mjs")]
    if args.stop:
        cmd.append("--stop")
    elif args.status:
        cmd.append("--status")
    else:
        cmd += [str(an.root.resolve()), "--no-open"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(res.stdout)
    sys.stderr.write(res.stderr)
    return res.returncode

# ------------------------------------------------------------------------ cli
# Commands that rewrite study.yaml / codebook.yaml / extracts.jsonl / themes.yaml. `stage`
# and `reply` are not here: they only append to the inbox, which has its own lock. `init`
# is not here either: there is no existing state to protect, and no folder to lock in yet.
WRITING_COMMANDS = {
    "extract", "recode", "retrim", "drop", "mark-coded", "mark-reviewed", "bump",
    "merge-code", "rename-code", "reparent", "split-code", "set-field", "code-status",
    "new-code", "reread", "theme", "apply", "report",
}


def find_root(arg: str | None) -> Path:
    if arg:
        return Path(arg)
    for cand in (Path("."), Path("analysis")):
        if (cand / "study.yaml").exists():
            return cand
    return Path(".")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ta.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-d", "--dir", help="analysis folder (default: ./ if it has study.yaml, else ./analysis)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init", help="create study.yaml/codebook.yaml/extracts.jsonl/themes.yaml, rostering speakers from transcripts")
    p.add_argument("--transcripts", nargs="*", help="transcript files (watch-recording transcript.md or Speaker: text files)")
    p.add_argument("--study", help="study name")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_init)

    p = sub.add_parser("validate", help="schema + referential integrity of all four files (and the inbox)")
    p.add_argument("--json", action="store_true", help="machine-readable, for the workbench")
    p.set_defaults(fn=cmd_validate)

    p = sub.add_parser("verify", help="every extract is verbatim at its locator and attributed to the right participant")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_verify)

    p = sub.add_parser("extract", help="add a coded extract by copying text out of the transcript (never by retyping it)")
    p.add_argument("transcript", nargs="?")
    p.add_argument("lines", nargs="?", help="42 or 42-44 (1-indexed, inclusive)")
    p.add_argument("--codes", help="comma-separated code ids")
    p.add_argument("--kind", default="said", help="said | did | intent  (a modal verb is intent, not action)")
    p.add_argument("--from", dest="frm", help="trim: start the quote at this substring")
    p.add_argument("--to", help="trim: end the quote after this substring")
    p.add_argument("--participant", help="force the participant id when the speaker label is not in the roster")
    p.add_argument("--context", help="e.g. condition/system/task the utterance is about")
    p.add_argument("--note")
    p.add_argument("--allow-non-participant", action="store_true")
    p.add_argument("--batch", help="jsonl of {transcript, lines, codes, kind?, from?, to?, context?, note?}")
    p.set_defaults(fn=cmd_extract)

    p = sub.add_parser("recode", help="change an extract's codes/kind/note")
    p.add_argument("extract_id")
    p.add_argument("--set"); p.add_argument("--add"); p.add_argument("--remove"); p.add_argument("--kind"); p.add_argument("--note")
    p.add_argument("--highlight", help="flag as a paper-worthy quote, with the reason (\"no\" clears the flag)")
    p.set_defaults(fn=cmd_recode)

    p = sub.add_parser("drop", help="delete extracts (and dereference them from themes/examples)")
    p.add_argument("extract_ids", nargs="+")
    p.set_defaults(fn=cmd_drop)

    p = sub.add_parser("verify-quotes", help="every quote in a markdown file (review plan, paper draft) is verbatim and attributed correctly")
    p.add_argument("file")
    p.add_argument("--quiet", action="store_true", help="only print problems")
    p.set_defaults(fn=cmd_verify_quotes)

    p = sub.add_parser("coverage", help="participants x codes x themes, zero-coverage warnings, stale transcripts")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_coverage)

    p = sub.add_parser("dupes", help="codes that may be the same code under two names")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_dupes)

    p = sub.add_parser("stale", help="transcripts not coded with the current codebook version")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_stale)

    p = sub.add_parser("merge-code", help="fold SOURCE into TARGET everywhere; bumps the codebook version")
    p.add_argument("source"); p.add_argument("target"); p.add_argument("--why")
    p.set_defaults(fn=cmd_merge_code)

    p = sub.add_parser("rename-code", help="rename a code id everywhere")
    p.add_argument("old"); p.add_argument("new")
    p.set_defaults(fn=cmd_rename_code)

    p = sub.add_parser("bump", help="record a codebook change (new/edited codes) as a new version; --freeze after the last interview")
    p.add_argument("change"); p.add_argument("--freeze", action="store_true")
    p.set_defaults(fn=cmd_bump)

    p = sub.add_parser("mark-coded", help="record that a transcript was fully coded with the current codebook version")
    p.add_argument("transcript")
    p.set_defaults(fn=cmd_mark_coded)

    p = sub.add_parser("collate", help="all extracts for a code (with children) or a theme, grouped by participant")
    p.add_argument("target")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_collate)

    p = sub.add_parser("annotate", help="the transcript with every coded span highlighted, as an interactive-plan page for review")
    p.add_argument("transcript")
    p.add_argument("-o", "--out", help="write here instead of stdout (e.g. reviews/annotated/T-01.plan.md)")
    p.add_argument("--plain", action="store_true", help="plain markdown with code lines under each turn instead of highlights")
    p.set_defaults(fn=cmd_annotate)

    sub.add_parser("codebook-table", help="markdown codebook for an appendix").set_defaults(fn=cmd_codebook_table)
    sub.add_parser("report", help="write reports/{coverage,codebook,themes,quote-bank,audit}.md").set_defaults(fn=cmd_report)

    # ---- the review workbench: staged operations, applied in one pass
    p = sub.add_parser("open", help="open the review workbench on this analysis (preflight, then the browser)")
    p.add_argument("target", nargs="?", help="a transcript / extract / code / theme id, or a view name")
    p.add_argument("--no-open", action="store_true", help="print the URL without opening a browser")
    p.add_argument("--force", action="store_true", help="open even though the preflight found errors")
    p.set_defaults(fn=cmd_open)

    p = sub.add_parser("serve", help="start, inspect, or stop the workbench daemon")
    p.add_argument("--status", action="store_true")
    p.add_argument("--stop", action="store_true")
    p.set_defaults(fn=cmd_serve)

    p = sub.add_parser("inbox", help="the operations the researcher staged in the workbench, grouped by view")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_inbox)

    p = sub.add_parser("apply", help="execute staged operations, run the cascades, archive them to reviews/")
    p.add_argument("op_ids", nargs="*", help="specific op ids; default is none, use --all")
    p.add_argument("--all", action="store_true", help="apply every pending operation")
    p.add_argument("--dry-run", action="store_true", help="say what would happen; write nothing")
    p.set_defaults(fn=cmd_apply)

    p = sub.add_parser("stage", help="stage an operation as a proposal for the researcher (JSON, as the workbench writes it)")
    p.add_argument("--op", required=True, help='{"op": "merge-code", "target": "a", "args": {"into": "b"}, "note": "why"} or a JSON list')
    p.set_defaults(fn=cmd_stage)

    p = sub.add_parser("reply", help="reply to a comment thread the researcher left in the workbench")
    p.add_argument("thread"); p.add_argument("text")
    p.set_defaults(fn=cmd_reply)

    p = sub.add_parser("bundle", help="everything a workbench tab needs, as JSON (used by the daemon)")
    p.set_defaults(fn=cmd_bundle)

    p = sub.add_parser("transcript", help="one transcript with its coded spans, resolved speakers, and hints")
    p.add_argument("transcript")
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_transcript)

    # ---- edits the workbench stages and the CLI can also make directly
    p = sub.add_parser("retrim", help="re-cut an extract's boundary inside its own turn, keeping its id")
    p.add_argument("extract_id")
    p.add_argument("--from", dest="frm"); p.add_argument("--to")
    p.add_argument("--start", type=int, help="character offset into the normalised turn text")
    p.add_argument("--end", type=int)
    p.set_defaults(fn=cmd_retrim)

    p = sub.add_parser("mark-reviewed", help="stamp extracts/codes/themes as reviewed at this codebook version")
    p.add_argument("--transcript", help="every extract in this transcript")
    p.add_argument("--extracts", nargs="*"); p.add_argument("--codes", nargs="*"); p.add_argument("--themes", nargs="*")
    p.set_defaults(fn=cmd_mark_reviewed)

    p = sub.add_parser("reparent", help="make a code a child of another, or promote it to top level")
    p.add_argument("code")
    p.add_argument("--to", help="new parent code id")
    p.add_argument("--root", action="store_true", help="promote to top level")
    p.set_defaults(fn=cmd_reparent)

    p = sub.add_parser("split-code", help="carve a child out of a code, moving the extracts that belong to it")
    p.add_argument("code"); p.add_argument("new_id")
    p.add_argument("--extracts", nargs="+", required=True)
    p.add_argument("--name"); p.add_argument("--definition"); p.add_argument("--include"); p.add_argument("--exclude")
    p.set_defaults(fn=cmd_split_code)

    p = sub.add_parser("set-field", help="reword a code's definition / include / exclude / name")
    p.add_argument("code"); p.add_argument("field", choices=sorted(FIELD_NAMES)); p.add_argument("value")
    p.add_argument("--old", help="the text you edited against; refuses if it changed since")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_set_field)

    p = sub.add_parser("code-status", help="accept, retire, or re-open a code")
    p.add_argument("code"); p.add_argument("status", choices=["candidate", "accepted", "retired"])
    p.set_defaults(fn=cmd_code_status)

    p = sub.add_parser("new-code", help="add a code (status candidate) without going through a review round")
    p.add_argument("id"); p.add_argument("definition")
    p.add_argument("--name"); p.add_argument("--parent"); p.add_argument("--include"); p.add_argument("--exclude")
    p.add_argument("--tags", nargs="*")
    p.set_defaults(fn=cmd_new_code)

    p = sub.add_parser("reread", help="record or close a request to re-read a transcript for a code")
    p.add_argument("transcript", nargs="?")
    p.add_argument("--code"); p.add_argument("--note")
    p.add_argument("--done", action="store_true", help="close the open request(s) for this transcript")
    p.set_defaults(fn=cmd_reread)

    # ---- themes
    p = sub.add_parser("theme", help="theme development: assign codes, edit fields, tensions, quotes, the map")
    tsub = p.add_subparsers(dest="theme_cmd", required=True)

    q = tsub.add_parser("new", help="create a theme (a claim, not a topic)")
    q.add_argument("name"); q.add_argument("--parent"); q.add_argument("--rq"); q.add_argument("--id")
    q.set_defaults(fn=cmd_theme_new)

    q = tsub.add_parser("assign", help="place a code in a theme, in the miscellaneous pile, or nowhere")
    q.add_argument("code")
    q.add_argument("--to"); q.add_argument("--misc", action="store_true"); q.add_argument("--unplaced", action="store_true")
    q.set_defaults(fn=cmd_theme_assign)

    q = tsub.add_parser("set", help="edit name / essence / story / rq / in_paper / status")
    q.add_argument("theme"); q.add_argument("field", choices=sorted(THEME_FIELDS)); q.add_argument("value")
    q.add_argument("--old"); q.add_argument("--force", action="store_true")
    q.set_defaults(fn=cmd_theme_set)

    q = tsub.add_parser("tension", help="keep the accounts that complicate the theme")
    q.add_argument("theme"); q.add_argument("--add", nargs="*"); q.add_argument("--remove", nargs="*")
    q.set_defaults(fn=cmd_theme_tension)

    q = tsub.add_parser("select", help="the quotes that go in the paper, in order")
    q.add_argument("theme"); q.add_argument("--add", nargs="*"); q.add_argument("--remove", nargs="*"); q.add_argument("--at", type=int)
    q.set_defaults(fn=cmd_theme_select)

    q = tsub.add_parser("trim", help="cut a selected quote to its inline form (from the extract's own text)")
    q.add_argument("theme"); q.add_argument("extract")
    q.add_argument("--from", dest="frm"); q.add_argument("--to")
    q.add_argument("--start", type=int); q.add_argument("--end", type=int)
    q.add_argument("--clear", action="store_true")
    q.set_defaults(fn=cmd_theme_trim)

    q = tsub.add_parser("merge", help="fold one theme into another")
    q.add_argument("source"); q.add_argument("target")
    q.set_defaults(fn=cmd_theme_merge)

    q = tsub.add_parser("mermaid", help="the thematic map, drawn from themes.yaml")
    q.set_defaults(fn=cmd_theme_mermaid)

    args = ap.parse_args(argv)
    an = Analysis(find_root(args.dir))
    if args.cmd != "init" and not an.study_path.exists():
        raise SystemExit(f"no study.yaml in {an.root.resolve()}; run `ta.py init` there or pass --dir")
    if args.cmd in WRITING_COMMANDS or (args.cmd == "init" and an.study_path.exists()):
        # Every command that rewrites a data file holds the pass lock, and re-reads the files
        # after taking it: two writers loading, mutating and saving whole files from two
        # snapshots would silently keep only the second one's work. Deciding this here, once,
        # is the only way it stays true as commands are added.
        apply_lock(an)
        an.reload()
        try:
            return args.fn(an, args)
        finally:
            apply_unlock(an)
    return args.fn(an, args)


if __name__ == "__main__":
    sys.exit(main())
