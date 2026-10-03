#!/usr/bin/env python3
"""voice_check.py - measure a paper draft against the author's published prose.

Reads .tex or .md files, turns them into plain prose (comments, figure and
table environments, citations and cross-references removed; math, code and
quotations of five or more words replaced by tokens), splits the prose into
sentences, and reports three things:

  1. Tier 1 words and em-dashes: any hit fails the hand-back.
  2. Sentence habits as per-10,000-word rates against the corpus baseline in
     private/corpus_rates.json, each with a verdict. The habits come from a JSON
     registry: private/patterns.json when it exists (the author's own, not in
     the repository), else scripts/patterns.example.json (generic). --ids prints
     the one in use.
  3. A cadence summary: sentence-length distribution against the corpus, flat
     paragraphs, run-ons, short openers and closers.

Verdicts, so a reader can predict them:
  ban    any instance -> FAIL       (Tier 1 words, dashes, What-clefts, ...)
  p0     FAIL when the draft's count is significantly above the corpus rate
         (Poisson upper tail at the draft's length, p < 0.01, at least 2 hits);
         "above" when higher than the corpus rate but not significantly so
  watch  WARN when at least double the corpus rate, at least 2 hits, p < 0.002;
         a habit that is 0 in the corpus warns on a single hit
  move   LOW when one of the author's own moves is used at less than half the corpus rate
         (Poisson lower tail, p < 0.01) - information, never a failure
Change the threshold with --alpha (P0 fails below alpha, watch warns below
alpha/5). --calibrate scores each corpus paper against a baseline built from the
others; on the ten-paper corpus this was built for, 0.01 failed one paper on the
rate habits and 0.05 failed two.
The exit code is 1 when anything FAILs, else 0.

Usage:
  python3 voice_check.py paper/1*.tex paper/2*.tex ...   summary + verdict
  python3 voice_check.py paper/*.tex --list              every flagged instance, with its sentence
  python3 voice_check.py paper/*.tex --list every colon-clause
  python3 voice_check.py paper/*.tex --list cadence      flat paragraphs, run-ons, short openers/closers
  python3 voice_check.py draft.md --all                  every registry row, flagged or not
  python3 voice_check.py --rebuild-baseline              recompute private/corpus_rates.json from private/examples/
  python3 voice_check.py --ids                           print the registry in use (id, class, label)
  python3 voice_check.py draft.md --registry other.json  score with another registry
  python3 voice_check.py --calibrate                     leave-one-paper-out check of the thresholds

Exempting a decided exception so it is not re-flagged on every run: end the
LaTeX line with `% voice-ok` (whole paragraph, every pattern) or
`% voice-ok: every colon-clause` (those ids only); in markdown use
`<!-- voice-ok: ... -->`. Or list sentence substrings in a `voice-check.allow`
file next to the draft (`every: over every triage decision`, or `own: *` to exempt a whole
pattern for this draft), one per line.

Standard library only; Python 3.10+.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import statistics
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent            # scripts/
SKILL = HERE.parent                                # the skill root
PRIVATE = SKILL / "private"                        # gitignored: the author's registry, baseline, examples, profile
EXAMPLE_REGISTRY = HERE / "patterns.example.json"  # generic registry, shipped with the repository
DEFAULT_REGISTRY = PRIVATE / "patterns.json" if (PRIVATE / "patterns.json").exists() else EXAMPLE_REGISTRY
DEFAULT_BASELINE = PRIVATE / "corpus_rates.json"
DEFAULT_EXAMPLES = PRIVATE / "examples"
QUOTE_MIN_WORDS = 5          # quotations of this many words or more become one QUOTE token
REGISTRY_VERSION = 1
PLACEHOLDERS = {"QUOTE", "MATH", "CODE"}
CLASSES = ("ban", "p0", "watch", "move", "info")
GROUPS = ("dash", "t1", "habit", "t2", "t3", "move")

# --------------------------------------------------------------------------- registry
#
# The patterns are data, not code: a JSON file with one row per habit (patterns.example.json
# documents the schema). Which words are never-words, which habits are P0 and which phrases are
# the author's own moves is the author's profile, so the real registry lives in private/ and the
# repository ships a generic example.

@dataclass
class Pat:
    id: str
    label: str
    cls: str                       # ban | p0 | watch | move | info
    rx: "re.Pattern | None"
    fix: str = ""
    group: str = "habit"           # dash | t1 | habit | t2 | t3 | move
    statement: bool = False        # skip sentences that end in '?'
    fn: "object" = None            # custom matcher: fn(sentence_text) -> [(start, end, tag)]


START = r'^(?:["“‘(\[]\s*)?'     # prefix for sentence-initial patterns: an opening quote or bracket may come first

# named matchers a registry row may use instead of a regex; the functions are defined further down
MATCHERS = {
    "colon_clause": lambda s: colon_hits(s, want="clause"),
    "colon_any": lambda s: colon_hits(s, want="any"),
}


def load_registry(path: Path) -> list[Pat]:
    """Read and validate a registry file. Exits naming the file, the row and the reason on any
    problem, so an edited registry fails loudly instead of quietly scoring nothing."""
    path = Path(path)
    if not path.exists():
        sys.exit(f"registry {path} not found")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(f"{path}: not valid JSON ({e})")
    if data.get("version") != REGISTRY_VERSION:
        sys.exit(f"{path}: registry version {data.get('version')!r}; this checker reads version {REGISTRY_VERSION}")
    pats: list[Pat] = []
    seen: set[str] = set()
    for i, row in enumerate(data.get("patterns", [])):
        pid = row.get("id")
        where = f"{path.name}: pattern #{i} ({pid!r})"
        if not isinstance(pid, str) or not re.fullmatch(r"[\w-]+", pid) or pid in seen:
            sys.exit(f"{where}: missing, malformed or duplicate id")
        seen.add(pid)
        cls, group = row.get("class"), row.get("group", "habit")
        if cls not in CLASSES:
            sys.exit(f"{where}: class must be one of {', '.join(CLASSES)}")
        if group not in GROUPS:
            sys.exit(f"{where}: group must be one of {', '.join(GROUPS)}")
        if ("regex" in row) == ("matcher" in row):
            sys.exit(f"{where}: exactly one of regex / matcher")
        rx, fn = None, None
        if "matcher" in row:
            if row["matcher"] not in MATCHERS:
                sys.exit(f"{where}: unknown matcher {row['matcher']!r}; known: {', '.join(MATCHERS)}")
            fn = MATCHERS[row["matcher"]]
        else:
            pattern, flags = row["regex"], re.I
            if row.get("start"):
                pattern, flags = START + pattern, 0   # sentence-initial patterns are case-sensitive
            try:
                rx = re.compile(pattern, flags)
            except re.error as e:
                sys.exit(f"{where}: bad regex ({e})")
        pats.append(Pat(pid, row.get("label", pid), cls, rx, row.get("fix", ""), group, bool(row.get("statement")), fn))
    if not pats:
        sys.exit(f"{path}: no patterns")
    return pats


PATTERNS: list[Pat] = []
PAT_BY_ID: dict[str, Pat] = {}
REGISTRY_SOURCE: Path = Path(DEFAULT_REGISTRY)


def use_registry(pats: list[Pat], source) -> None:
    """Make `pats` the registry the rest of the module scores with."""
    global PATTERNS, PAT_BY_ID, REGISTRY_SOURCE
    PATTERNS = pats
    PAT_BY_ID = {p.id: p for p in pats}
    REGISTRY_SOURCE = Path(source)


use_registry(load_registry(DEFAULT_REGISTRY), DEFAULT_REGISTRY)


# --------------------------------------------------------------------------- colon heuristic

FINITE = set("""is are was were has have had do does did can could will would should may might must shall
became becomes come came went kept made took gave got saw felt found showed let ran spent thought knew put began led drew wrote grew
fell rose lost won seems appears tends differs depends requires allows suggests describes reduces includes provides enables helps
makes takes gives keeps lets shows tells asks turns returns brings offers holds carries opens closes moves sits stays calls sends
follows produces builds tries fails changes increases decreases improves learns writes draws finds looks checks clicks selects
picks decides matters costs pays counts lists marks points treats saves loses wins""".split())
SUBORD = set("as when if once while because since although though whereas after before until unless where it they we he she this these those there here you i one".split())
COLON_RX = re.compile(r"[a-z\)]: [a-z]")


def colon_kind(before: str, after: str) -> str:
    """Classify the text after a mid-sentence colon: 'clause', 'quote', or 'list' (list, appositive, label). A heuristic:
    only unambiguous finite verbs count as clause evidence, and an enumeration wins unless the clause starts at once."""
    toks = re.findall(r"[A-Za-z][A-Za-z'’-]*", after)
    low = [t.lower() for t in toks]
    if len(re.findall(r"[A-Za-z][A-Za-z'’-]*", before)) < 3:
        return "list"                                   # "Comprehensive: how well …" is a label
    if "quote" in low[:3]:
        return "quote"                                  # "P3 put it this way: QUOTE"
    if len(toks) < 4:
        return "list"                                   # "two modes: continuous and stepwise"
    if re.match(r"\s*(?:\(\d+\)|\(?[a-z]\)|\d+\)|first\b)", after, re.I):
        return "list"
    starts_clause = low[0] in SUBORD or any(t in FINITE for t in low[:3])
    if after.count(",") >= 2 and re.search(r"\b(?:and|or)\b", after) and not starts_clause:
        return "list"                                   # "three sources: logs, artifacts, and interviews"
    if starts_clause or any(t in FINITE for t in low[:12]):
        return "clause"
    return "list"


def colon_hits(sentence: str, want: str = "any"):
    out = []
    for m in COLON_RX.finditer(sentence):
        i = m.start() + 1                               # index of ':'
        before, after = sentence[:i], sentence[i + 1:]
        after = re.split(r"[;.!?]", after)[0]
        if before.count("(") > before.count(")") and ")" in after:
            after = after[:after.index(")")]            # "(Jaccard: shared over combined) and …" stays inside the parens
        kind = colon_kind(before, after)
        if want == "any" or kind == want:
            out.append((i, i + 1, kind))
    return out


# --------------------------------------------------------------------------- text extraction

@dataclass
class Segment:
    text: str
    file: str
    line: int
    kind: str                                   # body | caption | description
    allow: "set[str] | None" = None             # {"*"} = all patterns, else pattern ids


def strip_comments(line: str) -> tuple[str, str]:
    """Split a LaTeX line at the first unescaped %; returns (code, comment)."""
    out = []
    i, n = 0, len(line)
    while i < n:
        c = line[i]
        if c == "\\" and i + 1 < n:
            out.append(line[i:i + 2])
            i += 2
            continue
        if c == "%":
            return "".join(out), line[i + 1:]
        out.append(c)
        i += 1
    return "".join(out), ""


def parse_allow(comment: str) -> "set[str] | None":
    m = re.search(r"voice-ok(?:\s*:\s*([\w\s,-]+))?", comment)
    if not m:
        return None
    ids = {x for x in re.split(r"[\s,]+", (m.group(1) or "").strip()) if x}
    return ids or {"*"}


def read_group(s: str, i: int) -> tuple[str, int]:
    """s[i] == '{'; return (content, index after the matching '}')."""
    depth, j = 0, i
    while j < len(s):
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    return s[i + 1:], len(s)


def _scan_macro(s: str, i: int, max_args: int | None = None):
    """At s[i] == '\\' + letters: return (name, args, end). Optional [..] are skipped; groups must be contiguous."""
    j = i + 1
    while j < len(s) and (s[j].isalpha() or s[j] == "@"):
        j += 1
    name = s[i + 1:j]
    if j < len(s) and s[j] == "*":
        j += 1
    args = []
    k = j
    while k < len(s) and (max_args is None or len(args) < max_args):
        if s[k] == "[":
            end = s.find("]", k)
            if end == -1:
                break
            k = end + 1
            continue
        if s[k] == "{":
            content, k = read_group(s, k)
            args.append(content)
            continue
        break
    return name, args, k


def collect_defs(paths: list[Path]) -> dict:
    """\\newcommand / \\def definitions -> {name: (nargs, body or None-to-drop)}."""
    defs: dict = {}
    for p in paths:
        try:
            text = "\n".join(strip_comments(l)[0] for l in p.read_text(encoding="utf-8", errors="replace").split("\n"))
        except OSError:
            continue
        for m in re.finditer(r"\\(?:(?:re)?newcommand|providecommand|DeclareRobustCommand)\*?\s*(\{)?\\([A-Za-z@]+)\}?\s*(?:\[(\d)\])?(?:\[[^\]]*\])?\s*(?=\{)", text):
            name, nargs = m.group(2), int(m.group(3) or 0)
            body, _ = read_group(text, m.end())
            defs[name] = (nargs, body)
        for m in re.finditer(r"\\def\\([A-Za-z@]+)((?:#\d)*)\s*(?=\{)", text):
            name, nargs = m.group(1), len(re.findall(r"#\d", m.group(2)))
            body, _ = read_group(text, m.end())
            defs[name] = (nargs, body)
    for name, (nargs, body) in list(defs.items()):
        # author-note macros such as \newcommand\jc[1]{\textcolor{blue}{JC: #1}} are not paper prose
        if body is not None and nargs >= 1 and re.search(r"\\textcolor\{[^{}]*\}\{[^{}#]*:\s*#1", body):
            defs[name] = (nargs, None)
        elif body is not None and (len(body) > 600 or re.search(r"\\tikz|tikzpicture|\\node|\\draw\b|\\path\b|\\fill\b", body)):
            del defs[name]                              # drawing code or too complex to expand; keep-last-argument applies
    return defs


DROP_MACROS = set("""cite citep citealp citealt citeyear citeyearpar nocite ref autoref cref Cref eqref pageref nameref label
url footref footnotemark index includegraphics input include lstinputlisting vspace hspace setlength addtolength newcommand
renewcommand providecommand usepackage documentclass bibliographystyle bibliography todo pagebreak newpage clearpage
ccsdesc keywords title subtitle author affiliation institution city country email orcid authornote thanks acmConference
acmYear copyrightyear acmDOI acmISBN acmPrice acmBooktitle setcopyright received hline toprule midrule bottomrule cline
vfill hfill xspace strut phantom vphantom hphantom noindent centering raggedright raggedleft small footnotesize scriptsize
tiny large Large LARGE huge Huge normalsize bfseries itshape ttfamily par medskip smallskip bigskip maketitle tableofcontents
appendix balance settopmatter""".split())
AUTHOR_MACROS = {"citet", "citeauthor", "textcite", "Citet"}
HEADING_RX = re.compile(r"\\(?:chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*(?=\{)")
SKIP_ENVS = {"figure", "figure*", "table", "table*", "teaserfigure", "tabular", "tabular*", "tabularx", "align", "align*",
             "equation", "equation*", "eqnarray", "gather", "lstlisting", "verbatim", "minted", "CCSXML", "thebibliography",
             "quote", "quotation", "displayquote", "tikzpicture", "comment"}
ENV_RX = re.compile(r"\\(begin|end)\{([^}]*)\}")
CAPTION_RX = re.compile(r"\\(caption|Description)\s*(?:\[[^\]]*\])?\s*\{")


def expand_user_macros(s: str, defs: dict) -> str:
    if not defs:
        return s
    names = set(defs)
    for _ in range(8):
        changed = False
        out, i, n = [], 0, len(s)
        while i < n:
            if s[i] == "\\" and i + 1 < n and (s[i + 1].isalpha() or s[i + 1] == "@"):
                name, args, end = _scan_macro(s, i, max_args=None)
                if name in names:
                    nargs, body = defs[name]
                    if len(args) < nargs:            # not enough groups: leave for the generic rule
                        out.append(s[i:end]); i = end; continue
                    # zero-arg macros may be followed by an empty {} which LaTeX uses as a separator
                    used, rest = args[:nargs], args[nargs:]
                    if nargs == 0 and rest[:1] == [""]:
                        rest = rest[1:]
                    if body is None:
                        rep = " "
                    else:
                        rep = body
                        for k, a in enumerate(used, 1):
                            rep = rep.replace("#" + str(k), a)
                    out.append(" " + rep + " " + "".join("{" + r + "}" for r in rest))
                    i = end
                    changed = True
                    continue
                out.append(s[i:end]); i = end; continue
            out.append(s[i]); i += 1
        s = "".join(out)
        if not changed:
            break
    return s


def generic_macros(s: str, unknown: Counter | None = None) -> str:
    """Drop DROP_MACROS with their arguments; every other \\name[opt]{arg}… keeps its last argument."""
    out, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c == "\\" and i + 1 < n and (s[i + 1].isalpha() or s[i + 1] == "@"):
            name, args, end = _scan_macro(s, i)
            if name in DROP_MACROS:
                out.append(" ")
            elif name in AUTHOR_MACROS:
                out.append(" Author ")
            elif name in ("enquote", "textquote") and args:
                out.append(" “" + generic_macros(args[-1], unknown) + "” ")
            elif name == "S":
                out.append("§" + "".join("{" + a + "}" for a in args))
            elif name in ("tikz", "tikzpicture"):
                if args:                                  # \tikz[opts]{ \node ... {text}; \draw ... ; } -> the node texts
                    texts = []
                    inner = args[-1]
                    for m in re.finditer(r"\bnode\b[^{;]*\{", inner):
                        content, _ = read_group(inner, m.end() - 1)
                        texts.append(generic_macros(content, unknown))
                    out.append(" " + " ".join(texts) + " ")
                else:                                     # path form: \tikz \draw (0,0) -- (1,1);  -> drop to the ';'
                    semi = s.find(";", end)
                    end = len(s) if semi == -1 else semi + 1
                    out.append(" ")
            elif args:
                if unknown is not None and name not in KEEP_LAST_KNOWN:
                    unknown[name] += 1
                out.append(" " + generic_macros(args[-1], unknown) + " ")
            else:
                out.append(" ")
            i = end
            continue
        out.append(c)
        i += 1
    return "".join(out)


KEEP_LAST_KNOWN = set("""emph textbf textit texttt textsc textsf textrm textup textmd underline textcolor colorbox fcolorbox
mbox hbox makebox parbox raisebox footnote href multicolumn multirow text mathrm caption Description item""".split())


def latex_to_text(s: str, defs: dict | None = None, unknown: Counter | None = None) -> str:
    s = re.sub(r"\\verb(\S)(.*?)\1", " CODE ", s)
    s = re.sub(r"(?<!\\)\$\$.*?(?<!\\)\$\$", " MATH ", s, flags=re.S)
    s = re.sub(r"\\\[.*?\\\]", " MATH ", s, flags=re.S)
    s = re.sub(r"\\\(.*?\\\)", " MATH ", s, flags=re.S)
    s = re.sub(r"(?<!\\)\$[^$]*?(?<!\\)\$", " MATH ", s, flags=re.S)
    s = expand_user_macros(s, defs or {})
    s = re.sub(r"\\item\b(?:\[[^\]]*\])?", " \x01 ", s)
    s = re.sub(r"\\([%&_#$])", lambda m: {"%": "%", "&": "&", "_": "_", "#": "#", "$": "$"}[m.group(1)], s)
    s = re.sub(r"\\([{}])", lambda m: "\x03" if m.group(1) == "{" else "\x04", s)
    s = re.sub(r"\\(?:,|;|:|!|/|@| )", " ", s)
    s = re.sub(r"\\\\\*?(?:\[[^\]]*\])?", " ", s)
    s = re.sub(r"\\(?:newline|linebreak|nolinebreak|-)\b", " ", s)
    s = generic_macros(s, unknown)
    s = s.replace("{", " ").replace("}", " ").replace("\x03", "{").replace("\x04", "}")
    s = s.replace("~", " ")
    s = s.replace("---", "—").replace("--", "–")
    s = s.replace("``", "“").replace("''", "”")
    s = re.sub(r"(?<!\w)`", "‘", s)
    return finalize_text(s)


def finalize_text(s: str) -> str:
    s = mask_quotes(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\s*\x01\s*", " \x01 ", s)
    s = re.sub(r" +([,.;:!?)\]])", r"\1", s)
    s = re.sub(r"([(\[]) +", r"\1", s)
    return s.strip()


def mask_quotes(s: str, min_words: int = QUOTE_MIN_WORDS) -> str:
    """Quotations of min_words or more (participant speech) become one QUOTE token, in corpus and draft alike."""
    def rep(m):
        inner = m.group(1)
        if len(inner.split()) < min_words:
            return m.group(0)
        return " QUOTE" + (inner.rstrip()[-1] if inner.rstrip()[-1:] in ".!?" else "") + " "
    s = re.sub(r"“([^”]{1,1200})”", rep, s, flags=re.S)
    s = re.sub(r'"([^"\n]{1,1200})"', rep, s)
    return s


def latex_segments(path: Path, defs: dict, unknown: Counter | None = None) -> list[Segment]:
    raw = path.read_text(encoding="utf-8", errors="replace").split("\n")
    segs: list[Segment] = []
    depth = 0                                    # nesting depth of skipped environments (figure, table, quote, ...)
    para: list[tuple[int, str]] = []
    para_allow: set[str] | None = None
    cap: dict | None = None                      # a \caption / \Description still accumulating across lines
    fname = str(path)

    def flush():
        nonlocal para, para_allow
        if para:
            text = latex_to_text(" ".join(t for _, t in para), defs, unknown)
            if re.search(r"\w", text):
                segs.append(Segment(text, fname, para[0][0], "body", para_allow))
        para, para_allow = [], None

    def add_prose(text: str, lineno: int, allow):
        nonlocal para_allow
        if re.search(r"\w", latex_to_text(text, defs)):
            if allow is not None:
                para_allow = (para_allow or set()) | allow
            para.append((lineno, text.strip()))

    def finish_caption():
        """Close the pending caption if its braces balance; return the text after the closing brace, else None."""
        nonlocal cap
        if cap is None:
            return None
        buf = cap["buf"]
        if buf.count("{") - buf.count("}") > 0 and not buf.count("\\{"):
            return None                          # still open, keep accumulating
        content, end = read_group(buf, 0)
        text = latex_to_text(content, defs, unknown)
        if re.search(r"\w", text):
            segs.append(Segment(text, fname, cap["line"], cap["kind"], None))
        cap = None
        return buf[end:]

    def consume(rest: str, lineno: int, allow):
        """Walk a line, or what is left of one, in order: prose while outside a skipped environment, captions while
        inside one, and \\begin/\\end markers as they come. Stops when the line is used up or a caption stays open."""
        nonlocal depth, cap
        while rest:
            m_env = ENV_RX.search(rest)
            m_cap = CAPTION_RX.search(rest) if depth > 0 else None
            if m_cap and (m_env is None or m_cap.start() < m_env.start()):
                cap = {"kind": "caption" if m_cap.group(1) == "caption" else "description", "line": lineno,
                       "buf": rest[m_cap.end() - 1:]}
                rest = finish_caption()
                if rest is None:
                    return                       # continues on the next line
                continue
            if m_env is None:
                if depth == 0:
                    add_prose(rest, lineno, allow)
                return
            if depth == 0:
                add_prose(rest[:m_env.start()], lineno, allow)
            kind, name = m_env.group(1), m_env.group(2)
            if name in SKIP_ENVS:
                if kind == "begin":
                    flush()
                    depth += 1
                else:
                    depth = max(0, depth - 1)
            rest = rest[m_env.end():]

    for i, line in enumerate(raw, 1):
        code, comment = strip_comments(line)
        allow = parse_allow(comment)
        if cap is not None:
            cap["buf"] += "\n" + code
            rest = finish_caption()
            if rest is not None:                 # the caption closed here; the rest of the line may close the figure or carry prose
                consume(rest, i, allow)
            continue
        if depth > 0 or any(name in SKIP_ENVS for _, name in ENV_RX.findall(code)):
            consume(code, i, allow)
            continue
        stripped = code.strip()
        if not stripped:
            flush()
            continue
        if HEADING_RX.search(stripped):
            flush()
            # a run-in heading (\paragraph{X} prose…) keeps the prose after it
            m = HEADING_RX.search(stripped)
            _, end = read_group(stripped, m.end())
            rest = stripped[end:].strip()
            if rest:
                para.append((i, rest))
            continue
        if re.match(r"^\\(?:label|lstinputlisting|includegraphics|input|include|maketitle|begin\{document\}|end\{document\}|bibliography|bibliographystyle|appendix|balance|clearpage|newpage|vspace|hspace|noindent|centering)\b", stripped) \
                and not re.search(r"[A-Za-z]{3,}\s+[A-Za-z]{3,}", generic_macros(latex_to_text(stripped, defs))):
            if not re.match(r"^\\(?:noindent|vspace|hspace)", stripped):
                flush()
            continue
        stripped = re.sub(r"\\(?:begin|end)\{(?:abstract|itemize|enumerate|description|document|center|flushleft|flushright|small|footnotesize)\}(?:\[[^\]]*\])?", " ", stripped)
        if not re.search(r"\w", stripped.replace("\\item", "")):
            continue
        if allow is not None:
            para_allow = (para_allow or set()) | allow
        para.append((i, stripped))
    flush()
    return segs


def markdown_segments(path: Path) -> list[Segment]:
    text = path.read_text(encoding="utf-8", errors="replace")
    text = re.sub(r"<!--\s*(voice-ok[^>]*?)\s*-->", lambda m: "\x05" + m.group(1) + "\x06", text)
    text = re.sub(r"<!--.*?-->", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    lines = text.split("\n")
    start = 0
    if lines and lines[0].strip() == "---":
        for j in range(1, len(lines)):
            if lines[j].strip() == "---":
                start = j + 1
                break
    segs: list[Segment] = []
    para: list[tuple[int, str]] = []
    para_allow: set[str] | None = None
    in_fence = False
    fname = str(path)

    def flush():
        nonlocal para, para_allow
        if para:
            t = md_to_text(" ".join(t for _, t in para))
            if re.search(r"\w", t):
                segs.append(Segment(t, fname, para[0][0], "body", para_allow))
        para, para_allow = [], None

    for i in range(start, len(lines)):
        s = lines[i].rstrip()
        lineno = i + 1
        if re.match(r"^\s*(```|~~~)", s):
            in_fence = not in_fence
            flush()
            continue
        if in_fence:
            continue
        if not s.strip():
            flush()
            continue
        if re.match(r"^\s*#{1,6}\s", s) or re.match(r"^\s*>", s) or re.match(r"^\s*\|", s) \
                or re.match(r"^\s*[-:| ]+$", s) or re.match(r"^\s*(?:---|\*\*\*|___)\s*$", s):
            flush()
            continue
        if re.match(r"^\s*!\[", s) or re.match(r"^\s*\[\^[^\]]+\]:", s):
            continue
        for m in re.finditer(r"\x05(voice-ok[^\x06]*)\x06", s):
            a = parse_allow(m.group(1))
            if a is not None:
                para_allow = (para_allow or set()) | a
        s = re.sub(r"\x05[^\x06]*\x06", " ", s)
        s = re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+", " \x01 ", s)
        para.append((lineno, s))
    flush()
    return segs


def md_to_text(s: str) -> str:
    s = re.sub(r"`[^`]*`", " CODE ", s)
    s = re.sub(r"\$\$.*?\$\$", " MATH ", s, flags=re.S)
    s = re.sub(r"(?<!\\)\$[^$\n]*?(?<!\\)\$", " MATH ", s)
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\[[^\]]*\]", r"\1", s)
    s = re.sub(r"\[\^[^\]]+\]", "", s)
    s = re.sub(r"\[[0-9,\s–-]+\]", " ", s)
    s = re.sub(r"\[@[^\]]+\]", " ", s)
    s = re.sub(r"\\cite[tp]?\{[^}]*\}", " ", s)
    s = re.sub(r"</?[a-zA-Z][^>]*>", " ", s)
    s = re.sub(r"(\*\*|__)(.+?)\1", r"\2", s)
    s = re.sub(r"(?<!\w)[*_](?!\s)(.+?)(?<!\s)[*_](?!\w)", r"\1", s)
    s = s.replace("---", "—").replace("--", "–")
    return finalize_text(s)


def load_segments(paths: list[Path], defs_files: list[Path], unknown: Counter | None = None) -> tuple[list[Segment], dict, list[Path]]:
    tex = [p for p in paths if p.suffix.lower() == ".tex"]
    def_sources = list(defs_files)
    prose_paths = []
    for p in paths:
        if p.suffix.lower() == ".tex":
            try:
                head = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if re.search(r"\\documentclass", head):
                def_sources.append(p)                # main.tex: definitions only
                continue
        prose_paths.append(p)
    if tex:
        seen = {p.resolve() for p in def_sources}
        for d in {p.parent for p in tex}:
            for cand in sorted(d.glob("*.tex")) + sorted(d.glob("*.sty")):
                if cand.resolve() in seen:
                    continue
                try:
                    if re.search(r"\\documentclass|\\newcommand|\\def\\", cand.read_text(encoding="utf-8", errors="replace")):
                        if re.search(r"\\documentclass", cand.read_text(encoding="utf-8", errors="replace")) or cand.suffix == ".sty":
                            def_sources.append(cand); seen.add(cand.resolve())
                except OSError:
                    pass
        def_sources = def_sources + [p for p in tex if p.resolve() not in seen]
    defs = collect_defs(def_sources) if tex else {}
    segs: list[Segment] = []
    for p in prose_paths:
        if p.suffix.lower() == ".tex":
            segs.extend(latex_segments(p, defs, unknown))
        else:
            segs.extend(markdown_segments(p))
    return segs, defs, prose_paths


# --------------------------------------------------------------------------- sentences and words

ABBREVS = ["e.g.", "i.e.", "et al.", "etc.", "vs.", "cf.", "viz.", "Fig.", "Figs.", "Sec.", "Secs.", "Eq.", "Eqs.", "Tab.",
           "No.", "Nos.", "Dr.", "Mr.", "Ms.", "Mrs.", "Prof.", "approx.", "resp.", "w.r.t.", "a.k.a.", "Ph.D.", "U.S.", "U.K.",
           "ca.", "incl.", "Vol.", "pp.", "Ch.", "St.", "Jr.", "Sr.", "Inc.", "Ltd.", "Co.", "min.", "max.", "avg.", "std."]
_ABBR_RX = [(re.compile(re.escape(a), re.I if a[0].islower() else 0), a.replace(".", "\x02")) for a in ABBREVS]


def split_sentences(text: str) -> list[str]:
    t = text
    for rx, rep in _ABBR_RX:
        t = rx.sub(rep, t)
    t = re.sub(r"(\d)\.(\d)", "\\1\x02\\2", t)
    t = re.sub(r"\b([A-Z])\.(?=\s*[A-Z]\.)", "\\1\x02", t)
    t = t.replace("...", "\x02\x02\x02").replace("…", "\x02\x02\x02")
    t = re.sub(r'([.!?]["”’)\]]*)\s+(?=["“‘(\[]?[A-Z0-9])', "\\1\x01", t)
    parts = re.split(r"\s*\x01\s*", t)
    return [p.replace("\x02", ".").strip() for p in parts if p.strip()]


WORD_RX = re.compile(r"[^\W\d_][\w'’-]*")


def n_words(s: str) -> int:
    return sum(1 for t in WORD_RX.findall(s) if t not in PLACEHOLDERS)


def sent_len(s: str) -> int:
    return sum(1 for t in s.split() if re.search(r"\w", t))


# --------------------------------------------------------------------------- statistics

def _pois_logpmf(k: int, mu: float) -> float:
    return -mu + k * math.log(mu) - math.lgamma(k + 1)


def poisson_cdf(k: int, mu: float) -> float:
    """P(X <= k) for X ~ Poisson(mu)."""
    if mu <= 0:
        return 1.0
    return min(1.0, sum(math.exp(_pois_logpmf(i, mu)) for i in range(int(k) + 1)))


def poisson_sf(k: int, mu: float) -> float:
    """P(X >= k) for X ~ Poisson(mu)."""
    if k <= 0:
        return 1.0
    if mu <= 0:
        return 0.0
    return max(0.0, 1.0 - poisson_cdf(k - 1, mu))


# --------------------------------------------------------------------------- analysis

@dataclass
class Hit:
    pid: str
    text: str
    file: str
    line: int
    kind: str
    start: int
    end: int
    tag: str = ""
    allowed: bool = False


@dataclass
class Sent:
    text: str
    seg: Segment


def load_allowlist(path: Path | None) -> list[tuple[str | None, str]]:
    if not path or not path.exists():
        return []
    out = []
    for raw in path.read_text(encoding="utf-8").split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([\w-]+)\s*:\s*(.+)$", line)
        if m and m.group(1) in PAT_BY_ID:
            out.append((m.group(1), m.group(2).strip()))
        else:
            out.append((None, line))
    return out


def analyze(segments: list[Segment], allowlist=(), include_captions=False) -> dict:
    body = [Sent(s, seg) for seg in segments if seg.kind == "body" for s in split_sentences(seg.text)]
    caps = [Sent(s, seg) for seg in segments if seg.kind == "caption" for s in split_sentences(seg.text)]
    desc = [Sent(s, seg) for seg in segments if seg.kind == "description" for s in split_sentences(seg.text)]
    rated = body + (caps if include_captions else [])
    words = sum(n_words(s.text) for s in rated)

    def allowed(pid: str, s: Sent) -> bool:
        a = s.seg.allow
        if a and ("*" in a or pid in a):
            return True
        return any((p is None or p == pid) and (sub == "*" or sub in s.text) for p, sub in allowlist)

    hits: dict[str, list[Hit]] = defaultdict(list)
    for pat in PATTERNS:
        targets = rated + (caps if (pat.group in ("t1", "dash") and not include_captions) else [])
        for s in targets:
            if pat.statement and s.text.rstrip().endswith("?"):
                continue
            if pat.fn is not None:
                found = pat.fn(s.text)
            else:
                found = [(m.start(), m.end(), "") for m in pat.rx.finditer(s.text)]
            for a, b, tag in found:
                hits[pat.id].append(Hit(pat.id, s.text, s.seg.file, s.seg.line, s.seg.kind, a, b, tag, allowed(pat.id, s)))

    counts = {p.id: sum(1 for h in hits[p.id] if not h.allowed) for p in PATTERNS}
    n_allowed = sum(1 for hs in hits.values() for h in hs if h.allowed)

    lens = [sent_len(s.text) for s in body]
    lens_c = [l for l in lens if l >= 3]
    flat, runons, openers, closers = [], [], [], []
    for seg in segments:
        if seg.kind != "body":
            continue
        ss = split_sentences(seg.text)
        wl = [sent_len(x) for x in ss]
        if len(wl) >= 4 and all(17 <= w <= 34 for w in wl):
            flat.append((seg.file, seg.line, wl))
        if wl and wl[0] <= 13:
            openers.append((seg.file, seg.line, ss[0]))
        if len(wl) > 1 and wl[-1] <= 13:
            closers.append((seg.file, seg.line, ss[-1]))
        for x, w in zip(ss, wl):
            if w >= 55:
                runons.append((seg.file, seg.line, w, x))
    cadence = {}
    if lens_c:
        q = statistics.quantiles(lens_c, n=20) if len(lens_c) >= 20 else None
        cadence = {
            "n": len(lens_c), "median": statistics.median(lens_c), "mean": round(statistics.mean(lens_c), 1),
            "p10": round(q[1]) if q else None, "p25": round(q[4]) if q else None, "p75": round(q[14]) if q else None,
            "p90": round(q[17]) if q else None,
            "pct_under_15": round(100 * sum(1 for l in lens_c if l < 15) / len(lens_c), 1),
            "pct_over_40": round(100 * sum(1 for l in lens_c if l > 40) / len(lens_c), 1),
        }
    return {
        "words": words, "body_words": sum(n_words(s.text) for s in body), "sentences": len(body),
        "caption_words": sum(n_words(s.text) for s in caps),
        "description_words": sum(n_words(s.text) for s in desc), "counts": counts, "hits": hits, "allowed": n_allowed,
        "cadence": cadence, "flat": flat, "runons": runons, "openers": openers, "closers": closers,
        "include_captions": include_captions,
    }


def score(result: dict, baseline: dict, alpha: float = 0.01) -> list[dict]:
    """Verdict rows. P0 habits fail at p < alpha; watch habits warn at p < alpha / 5."""
    cw = baseline["words"]
    dw = max(result["words"], 1)
    rows = []
    for p in PATTERNS:
        k = result["counts"].get(p.id, 0)
        c = baseline["counts"].get(p.id)
        if c is None:                              # pattern added after the baseline was built
            rows.append({"id": p.id, "cls": p.cls, "group": p.group, "label": p.label, "n": k, "corpus_rate": None,
                         "draft_rate": round(1e4 * k / dw, 1), "expected": None, "p": None, "verdict": "n/a (rebuild baseline)", "fix": p.fix})
            continue
        mu = c / cw * dw
        mu_eff = max(mu, 0.5 / cw * dw)            # half an occurrence in the corpus, so zero-rate habits stay finite
        p_hi = poisson_sf(k, mu_eff)
        p_lo = poisson_cdf(k, mu) if mu > 0 else 1.0
        v = "ok"
        if p.cls == "ban":
            v = "FAIL" if k > 0 else "ok"
        elif p.cls == "p0":
            if k >= 2 and p_hi < alpha:
                v = "FAIL"
            elif k > mu:
                v = "above"
        elif p.cls == "watch":
            if c == 0 and k >= 1:
                v = "WARN"
            elif k >= 2 and k >= 2 * mu and p_hi < alpha / 5:
                v = "WARN"
        elif p.cls == "move":
            if mu >= 3 and k <= mu / 2 and p_lo < alpha:
                v = "LOW"
        rows.append({"id": p.id, "cls": p.cls, "group": p.group, "label": p.label, "n": k,
                     "corpus_rate": round(1e4 * c / cw, 1), "draft_rate": round(1e4 * k / dw, 1),
                     "expected": round(mu, 1), "p": p_hi if p.cls != "move" else p_lo, "verdict": v, "fix": p.fix})
    return rows


# --------------------------------------------------------------------------- baseline

def corpus_files(examples_dir: Path, exclude_ids=()) -> list[Path]:
    files = []
    for f in sorted(examples_dir.glob("*/*.md")):
        if f.name == "prior-citations.md" or f.stem in set(exclude_ids):
            continue
        files.append(f)
    return files


def _display_path(p: Path) -> str:
    """A path for the baseline file that does not record where this machine keeps the skill."""
    try:
        return str(Path(p).resolve().relative_to(SKILL))
    except ValueError:
        return Path(p).name


def build_baseline(examples_dir: Path, exclude_ids=()) -> dict:
    files = corpus_files(examples_dir, exclude_ids)
    if not files:
        sys.exit(f"no example files under {examples_dir} (expected examples/<section>/<corpus_id>.md)")
    segs = []
    for f in files:
        segs.extend(markdown_segments(f))
    r = analyze(segs)
    ids = sorted({f.stem for f in files})
    return {
        "version": REGISTRY_VERSION, "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "examples_dir": _display_path(examples_dir), "files": len(files), "papers": len(ids), "paper_ids": ids,
        "registry": {"source": REGISTRY_SOURCE.name, "patterns": len(PATTERNS)},
        "words": r["words"], "sentences": r["sentences"], "sentence_length": r["cadence"],
        "quote_min_words": QUOTE_MIN_WORDS, "counts": r["counts"],
        "per10k": {k: round(1e4 * v / max(r["words"], 1), 2) for k, v in r["counts"].items()},
        "notes": "Rates are per 10,000 alphabetic word tokens of the author's published sections, with headings and block-quoted "
                 "participant speech dropped, list items counted as their own sentences, citations removed, and quotations "
                 "of %d+ words replaced by a QUOTE token. Regenerate with `voice_check.py --rebuild-baseline`." % QUOTE_MIN_WORDS,
    }


def load_baseline(path: Path) -> dict:
    if not path.exists():
        sys.exit(f"baseline {path} not found; run `python3 {Path(__file__).name} --rebuild-baseline` with private/examples/ present, or pass --baseline")
    b = json.loads(path.read_text(encoding="utf-8"))
    b["_source"] = path.name
    missing = [p.id for p in PATTERNS if p.id not in b.get("counts", {})]
    if missing:
        print(f"note: baseline lacks {len(missing)} newer pattern(s) ({', '.join(missing[:4])}{'…' if len(missing) > 4 else ''}); "
              f"rebuild it with --rebuild-baseline when private/examples/ is available", file=sys.stderr)
    return b


# --------------------------------------------------------------------------- output

def fmt_p(p):
    if p is None:
        return ""
    return "<.001" if p < 0.001 else f"{p:.3f}"


def rel(path: str, roots: list[Path]) -> str:
    p = Path(path)
    for r in roots:
        try:
            return str(p.relative_to(r))
        except ValueError:
            pass
    return p.name


def print_report(result: dict, rows: list[dict], baseline: dict, files: list[Path], show_all: bool, defs_note: str = ""):
    roots = sorted({p.parent for p in files}, key=lambda x: len(str(x)))
    bl = baseline.get("sentence_length", {})
    cap_note = "counted in rates" if result["include_captions"] else "Tier 1 and dashes only"
    print(f"voice_check · {len(files)} file(s) · body {result['words']:,} words / {result['sentences']} sentences · "
          f"captions {result['caption_words']:,} words ({cap_note}) · \\Description {result['description_words']:,} words (ignored)")
    print(f"baseline {baseline.get('_source', '')} · {baseline['words']:,} words from {baseline.get('papers', '?')} papers, "
          f"built {baseline.get('generated', '?')[:10]} · registry {REGISTRY_SOURCE.name} ({len(PATTERNS)} patterns)"
          + (f" · {defs_note}" if defs_note else ""))
    print()
    # bans
    bans = [r for r in rows if r["cls"] == "ban"]
    n_ban = sum(r["n"] for r in bans)
    print(f"Tier 1 words, dashes, and banned sentence shapes — {n_ban} hit(s)")
    for r in bans:
        if r["n"]:
            locs = [f"{rel(h.file, roots)}:{h.line}{' [' + h.kind + ']' if h.kind != 'body' else ''}"
                    for h in result["hits"][r["id"]] if not h.allowed]
            print(f"  FAIL  {r['label']} ×{r['n']}: " + ", ".join(locs[:6]) + (" …" if len(locs) > 6 else ""))
    print()
    # habits table
    order = {"FAIL": 0, "WARN": 1, "above": 2, "LOW": 3, "n/a (rebuild baseline)": 4, "ok": 5}
    habit_rows = [r for r in rows if r["cls"] != "ban"]
    shown = [r for r in habit_rows if show_all or r["verdict"] != "ok" or r["cls"] == "p0"]
    shown.sort(key=lambda r: (order.get(r["verdict"], 9), {"p0": 0, "watch": 1, "move": 2, "info": 3}[r["cls"]], -(r["n"] or 0)))
    print(f"Habits (per 10k words){'' if show_all else ' — flagged rows and P0 rows; --all for every row'}")
    print(f"  {'':4} {'habit':62} {'corpus':>6} {'draft':>6} {'n':>4} {'expect':>6} {'p':>6}  verdict")
    for r in shown:
        tag = {"p0": "P0", "watch": "", "move": "move", "info": "info"}[r["cls"]]
        cr = "" if r["corpus_rate"] is None else f"{r['corpus_rate']:.1f}"
        ex = "" if r["expected"] is None else f"{r['expected']:.1f}"
        print(f"  {tag:4} {r['label'][:62]:62} {cr:>6} {r['draft_rate']:>6.1f} {r['n']:>4} {ex:>6} {fmt_p(r['p']):>6}  {r['verdict']}")
    if not shown:
        print("  (nothing flagged)")
    print()
    c = result["cadence"]
    if c:
        def pair(k, fmt="{}"):
            b = bl.get(k)
            return fmt.format(c[k]) + (f" ({fmt.format(b)})" if b is not None else "")
        print("Cadence · draft (corpus): "
              f"median {pair('median', '{:.0f}')} words · mean {pair('mean', '{:.1f}')} · p10 {pair('p10')} · p90 {pair('p90')} · "
              f"under 15w {pair('pct_under_15', '{:.0f}')}% · over 40w {pair('pct_over_40', '{:.0f}')}%")
        print(f"  flat paragraphs (4+ sentences all 17–34w): {len(result['flat'])} · run-ons ≥55w: {len(result['runons'])} · "
              f"short openers ≤13w: {len(result['openers'])} · short closers ≤13w: {len(result['closers'])}   (--list cadence)")
    print()
    fails = [r for r in rows if r["verdict"] == "FAIL"]
    warns = [r for r in rows if r["verdict"] == "WARN"]
    if fails:
        print(f"Verdict: FAIL — " + "; ".join(f"{r['label'].split(' (')[0]} ×{r['n']}" for r in fails)
              + (f" · {len(warns)} WARN" if warns else "") + "   → --list for the sentences")
    elif warns:
        print(f"Verdict: PASS with {len(warns)} WARN — " + "; ".join(r["label"].split(" (")[0] for r in warns) + "   → --list for the sentences")
    else:
        print("Verdict: PASS")
    if result["allowed"]:
        print(f"  ({result['allowed']} instance(s) exempted by voice-ok markers or the allowlist)")


def mark(h: Hit, width: int = 300) -> str:
    t = h.text
    s = t[:h.start] + "»" + t[h.start:h.end] + "«" + t[h.end:]
    if len(s) <= width:
        return s
    lo = max(0, h.start - width // 2)
    return ("…" if lo else "") + s[lo:lo + width] + ("…" if lo + width < len(s) else "")


def print_listing(result: dict, rows: list[dict], ids: list[str], files: list[Path], show_allowed: bool):
    roots = sorted({p.parent for p in files}, key=lambda x: len(str(x)))
    if not ids:
        ids = [r["id"] for r in rows if r["verdict"] not in ("ok", "LOW") or r["cls"] == "p0"]
        if show_allowed:
            ids += [pid for pid, hs in result["hits"].items() if pid not in ids and any(h.allowed for h in hs)]
    if "cadence" in ids:
        ids.remove("cadence")
        print("Cadence — paragraphs where the rhythm is flat, and the shortest and longest sentences")
        for f, l, wl in result["flat"]:
            print(f"  FLAT     {rel(f, roots)}:{l}  sentence lengths {wl}")
        for f, l, w, x in result["runons"]:
            print(f"  RUN-ON   {rel(f, roots)}:{l}  ({w}w) {x[:220]}")
        for f, l, x in result["openers"]:
            print(f"  OPENER   {rel(f, roots)}:{l}  {x[:160]}")
        for f, l, x in result["closers"]:
            print(f"  CLOSER   {rel(f, roots)}:{l}  {x[:160]}")
        print()
    by_id = {r["id"]: r for r in rows}
    for pid in ids:
        if pid not in PAT_BY_ID:
            print(f"  (unknown pattern id {pid!r}; ids: {', '.join(p.id for p in PATTERNS)})")
            continue
        hs = [h for h in result["hits"][pid] if show_allowed or not h.allowed]
        r = by_id.get(pid, {})
        print(f"{PAT_BY_ID[pid].label} — {len(hs)} instance(s)" + (f", verdict {r['verdict']}" if r else "")
              + (f" · fix: {PAT_BY_ID[pid].fix}" if PAT_BY_ID[pid].fix else ""))
        for h in hs:
            tags = " ".join(x for x in ((h.kind.upper() if h.kind != "body" else ""), (h.tag or ""), ("allowed" if h.allowed else "")) if x)
            print(f"  {rel(h.file, roots)}:{h.line}{' [' + tags + ']' if tags else ''} {mark(h)}")
        print()


# --------------------------------------------------------------------------- calibrate

def calibrate(examples_dir: Path, alpha: float = 0.01):
    files = corpus_files(examples_dir)
    if not files:
        sys.exit(f"no example files under {examples_dir} (expected examples/<section>/<corpus_id>.md); calibration needs the local corpus")
    ids = sorted({f.stem for f in files})
    print(f"leave-one-paper-out over {len(ids)} papers, alpha={alpha}: each paper scored against a baseline built from the other {len(ids) - 1}")
    print(f"  {'paper':12} {'words':>6}  FAIL / WARN / above / LOW")
    tot = Counter()
    for pid in ids:
        base = build_baseline(examples_dir, exclude_ids=[pid])
        segs = []
        for f in files:
            if f.stem == pid:
                segs.extend(markdown_segments(f))
        r = analyze(segs)
        rows = score(r, base, alpha)
        v = Counter(row["verdict"] for row in rows)
        tot.update(v)
        fails = [row["id"] + f"×{row['n']}" for row in rows if row["verdict"] == "FAIL"]
        warns = [row["id"] + f"×{row['n']}" for row in rows if row["verdict"] == "WARN"]
        title = ""
        for f in files:
            if f.stem == pid:
                m = re.match(r"#\s*(.+?)(?::|\()", f.read_text(encoding="utf-8", errors="replace").split("\n")[0])
                title = (m.group(1).strip() if m else "")[:20]
                break
        print(f"  {pid:12} {r['words']:>6}  {v['FAIL']:>4} / {v['WARN']:>4} / {v['above']:>5} / {v['LOW']:>3}   {title:20} "
              + ("FAIL: " + ", ".join(fails) if fails else "") + ("  WARN: " + ", ".join(warns) if warns else ""))
    print(f"  {'total':12} {'':>6}  {tot['FAIL']:>4} / {tot['WARN']:>4} / {tot['above']:>5} / {tot['LOW']:>3}")


# --------------------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog="\n".join(__doc__.split("\n\n")[1:]))
    ap.add_argument("files", nargs="*", type=Path, help=".tex or .md files of the draft (a main.tex is used for macro definitions only)")
    ap.add_argument("--list", nargs="*", metavar="ID", help="list instances (no ids: everything flagged; 'cadence' for rhythm)")
    ap.add_argument("--all", action="store_true", help="show every registry row, not only flagged ones")
    ap.add_argument("--json", action="store_true", help="machine-readable result")
    ap.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE, help="corpus rates file (default private/corpus_rates.json)")
    ap.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY,
                    help="pattern registry (default private/patterns.json when present, else scripts/patterns.example.json)")
    ap.add_argument("--defs", type=Path, action="append", default=[], help="extra .tex/.sty with \\newcommand definitions")
    ap.add_argument("--allow", type=Path, help="allowlist file (default: voice-check.allow next to the first file, if present)")
    ap.add_argument("--show-allowed", action="store_true", help="include exempted instances in --list")
    ap.add_argument("--include-captions", action="store_true", help="count figure/table captions in the habit rates too")
    ap.add_argument("--alpha", type=float, default=0.01, help="P0 habits FAIL below this Poisson tail probability; watch habits WARN below alpha/5 (default 0.01)")
    ap.add_argument("--verbose", action="store_true", help="report unknown macros and macro definitions found")
    ap.add_argument("--rebuild-baseline", action="store_true", help="recompute the baseline from --examples and write --baseline")
    ap.add_argument("--examples", type=Path, default=DEFAULT_EXAMPLES, help="corpus directory (default private/examples)")
    ap.add_argument("--exclude-id", action="append", default=[], help="corpus id to leave out when rebuilding")
    ap.add_argument("--calibrate", action="store_true", help="leave-one-paper-out check of the thresholds over examples/")
    ap.add_argument("--ids", action="store_true", help="print the registry (id, class, label) and exit")
    a = ap.parse_args(argv)
    if Path(a.registry).resolve() != REGISTRY_SOURCE.resolve():
        use_registry(load_registry(a.registry), a.registry)

    if a.ids:
        print(f"# registry: {REGISTRY_SOURCE} ({len(PATTERNS)} patterns)")
        for p in PATTERNS:
            print(f"{p.id:22} {p.cls:6} {p.label}")
        return 0
    if a.calibrate:
        calibrate(a.examples, a.alpha)
        return 0
    if a.rebuild_baseline:
        b = build_baseline(a.examples, a.exclude_id)
        a.baseline.parent.mkdir(parents=True, exist_ok=True)
        a.baseline.write_text(json.dumps(b, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {a.baseline}: {b['words']:,} words, {b['sentences']} sentences, {b['files']} files from {b['papers']} papers")
        return 0
    if not a.files:
        ap.print_usage()
        return 2
    for f in a.files:
        if not f.exists():
            sys.exit(f"no such file: {f}")
    baseline = load_baseline(a.baseline)
    unknown: Counter = Counter()
    segs, defs, prose = load_segments(a.files, a.defs, unknown)
    if not prose:
        sys.exit("no prose files given (main.tex-style files are used for macro definitions only)")
    allow_path = a.allow or (prose[0].parent / "voice-check.allow")
    allowlist = load_allowlist(allow_path)
    result = analyze(segs, allowlist, a.include_captions)
    if result["body_words"] == 0:
        print("error: no body prose was extracted from the given files (only headings, environments, captions or code?); "
              "nothing was checked", file=sys.stderr)
        return 2
    rows = score(result, baseline, a.alpha)
    if a.json:
        out = {"files": [str(p) for p in prose], "words": result["words"], "sentences": result["sentences"],
               "caption_words": result["caption_words"], "cadence": result["cadence"], "rows": rows,
               "hits": {pid: [{"file": h.file, "line": h.line, "kind": h.kind, "tag": h.tag, "allowed": h.allowed,
                               "sentence": h.text, "match": h.text[h.start:h.end]} for h in hs] for pid, hs in result["hits"].items() if hs},
               "flat": result["flat"], "runons": result["runons"], "verdict": "FAIL" if any(r["verdict"] == "FAIL" for r in rows) else "PASS"}
        print(json.dumps(out, indent=1, ensure_ascii=False))
        return 1 if out["verdict"] == "FAIL" else 0
    defs_note = ""
    if defs:
        dropped = [n for n, (_, b) in defs.items() if b is None]
        defs_note = f"{len(defs)} macro definitions found" + (f", author-note macros dropped: " + ", ".join("\\" + d for d in dropped) if dropped else "")
    if a.list is not None:
        print_listing(result, rows, list(a.list), prose, a.show_allowed)
    else:
        print_report(result, rows, baseline, prose, a.all, defs_note)
    if a.verbose:
        if unknown:
            print("\nmacros reduced to their last argument (define them in main.tex or pass --defs if that loses text):")
            for name, k in unknown.most_common(12):
                print(f"  \\{name} ×{k}")
        if defs:
            print("definitions used: " + ", ".join(sorted("\\" + n for n in defs)))
    return 1 if any(r["verdict"] == "FAIL" for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
