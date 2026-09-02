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

    # ---- saving
    def save_study(self):
        dump_yaml(self.study_path, self.study)

    def save_codebook(self):
        dump_yaml(self.codebook_path, self.codebook)

    def save_extracts(self):
        with self.extracts_path.open("w", encoding="utf-8") as fh:
            for ex in self.extracts:
                fh.write(json.dumps(ex, ensure_ascii=False) + "\n")

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
            "notes": "Record the stance in words the method section can reuse; change these if the study is deductive/latent/constructionist.",
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
                theme_codes.add(an.resolve_code(cid))
        for eid in (th.get("selected_extracts") or []) + (th.get("tensions") or []):
            ex = an.extract(eid)
            if ex is None:
                errors.append(f"themes: {tid} references missing extract {eid}")
            elif theme_codes and not (theme_codes & {an.resolve_code(x) for x in ex.get("codes", [])}):
                warnings.append(f"themes: {tid} selects {eid}, which carries none of the theme's codes")
    return errors, warnings


def cmd_validate(an: Analysis, args) -> int:
    errors, warnings = validate(an)
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
                  allow_non_participant: bool = False) -> dict:
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
    if frm or to:
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
    notes = find_dupes(an)
    for n in notes:
        print(f"- {n}")
    print(f"dupes: {len(notes)} suspicion(s) across {len(an.live_codes())} live code(s). These are prompts for judgement, not verdicts.")
    return 0


# ---------------------------------------------------------------- code admin
def cmd_merge_code(an: Analysis, args) -> int:
    src, dst = args.source, args.target
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
    an.codebook["version"] = int(an.codebook.get("version", 1)) + 1
    an.codebook["changelog"].append({"version": an.codebook["version"], "date": today(), "change": f"merged {src} into {dst} ({n} extracts recoded){': ' + args.why if args.why else ''}"})
    an.save_codebook(); an.save_extracts(); an.save_themes()
    print(f"merged {src} -> {dst}; {n} extract(s) recoded; codebook now v{an.codebook['version']}")
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


def cmd_rename_code(an: Analysis, args) -> int:
    c = an.code(args.old)
    if c is None:
        raise SystemExit(f"no code {args.old}")
    if an.code(args.new) is not None:
        raise SystemExit(f"{args.new} already exists; use merge-code")
    if not CODE_ID_RE.match(args.new):
        raise SystemExit("new id must be kebab-case, optionally parent.child")
    n = rename_everywhere(an, args.old, args.new)
    c["id"] = args.new
    for child in an.codebook["codes"]:
        if child.get("parent") == args.new and "." in child["id"] and not child["id"].startswith(args.new + "."):
            new_child = args.new + "." + child["id"].split(".", 1)[1]
            rename_everywhere(an, child["id"], new_child)
            child["id"] = new_child
    an.codebook["changelog"].append({"version": an.codebook.get("version", 1), "date": today(), "change": f"renamed {args.old} -> {args.new} ({n} extracts)"})
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
    print(collate(an, args.target))
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
                out.append(f"- {e['id']} ({e['participant']}, [{e.get('timestamp') or '-'}]): \"{e['text']}\"")
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
            out.append(f"- **{e['participant']}**{kind}: \"{e['text']}\"")
            out.append(f"  `{e['id']}` {e['transcript']}:{e.get('line_start')} [{e.get('timestamp') or '-'}]{(' · ' + e['context']) if e.get('context') else ''}")
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
    dupes = find_dupes(an)
    if dupes:
        audit += ["", "## Possible duplicate codes", ""] + [f"- {d}" for d in dupes]
    (rep / "audit.md").write_text("\n".join(audit) + "\n", encoding="utf-8")
    print(f"wrote {rep}/coverage.md codebook.md themes.md quote-bank.md audit.md")
    print(f"audit: validate {len(errors)} error(s); verify {len(verrors)} problem(s); {len(dupes)} duplicate suspicion(s)")
    return 1 if (errors or verrors) else 0


# ------------------------------------------------------------------------ cli
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

    sub.add_parser("validate", help="schema + referential integrity of all four files").set_defaults(fn=cmd_validate)
    sub.add_parser("verify", help="every extract is verbatim at its locator and attributed to the right participant").set_defaults(fn=cmd_verify)

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

    sub.add_parser("coverage", help="participants x codes x themes, zero-coverage warnings, stale transcripts").set_defaults(fn=cmd_coverage)
    sub.add_parser("dupes", help="codes that may be the same code under two names").set_defaults(fn=cmd_dupes)
    sub.add_parser("stale", help="transcripts not coded with the current codebook version").set_defaults(fn=cmd_stale)

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
    p.set_defaults(fn=cmd_collate)

    p = sub.add_parser("annotate", help="the transcript with every coded span highlighted, as an interactive-plan page for review")
    p.add_argument("transcript")
    p.add_argument("-o", "--out", help="write here instead of stdout (e.g. reviews/annotated/T-01.plan.md)")
    p.add_argument("--plain", action="store_true", help="plain markdown with code lines under each turn instead of highlights")
    p.set_defaults(fn=cmd_annotate)

    sub.add_parser("codebook-table", help="markdown codebook for an appendix").set_defaults(fn=cmd_codebook_table)
    sub.add_parser("report", help="write reports/{coverage,codebook,themes,quote-bank,audit}.md").set_defaults(fn=cmd_report)

    args = ap.parse_args(argv)
    an = Analysis(find_root(args.dir))
    if args.cmd != "init" and not an.study_path.exists():
        raise SystemExit(f"no study.yaml in {an.root.resolve()}; run `ta.py init` there or pass --dir")
    return args.fn(an, args)


if __name__ == "__main__":
    sys.exit(main())
