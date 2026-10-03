#!/usr/bin/env python3
"""build_profile.py - the numeric sections of a voice profile, computed from the corpus.

Reads private/examples/<section>/<corpus_id>.md (the same files voice_check.py builds
its baseline from, cleaned the same way: headings and block quotes dropped, list items
counted as sentences, citations removed, quotations of five or more words masked) and
prints markdown for the sections of references/voice-profile.template.md that are
numbers rather than judgement:

  2. the dash rate
  3-4. every candidate word in the registry, counted, with a suggested tier
  7. the most common sentence openers
  8. the sentence-length distribution, overall and per section folder
  9. the head of the word and trigram distributions

Paste the output under the template's headings and write the prose around it. Nothing
here decides anything; the thresholds are suggestions and the tiers are yours to set.

Usage:
  python3 build_profile.py                       # private/examples, the registry voice_check.py would load
  python3 build_profile.py --examples DIR --registry FILE --words 80 --trigrams 30 --openers 20

Standard library only; Python 3.10+.
"""
from __future__ import annotations

import argparse
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voice_check as vc  # noqa: E402

TOKEN_RX = re.compile(r"P\d+|[^\W\d_][\w'’-]*")
BANDS = [(1, 9), (10, 14), (15, 19), (20, 24), (25, 29), (30, 34), (35, 39), (40, 49), (50, 10**6)]
NEVER_PER_100K = 2.0          # at or under this rate per 100k words, suggest Tier 1


def tokens(sentence: str) -> list[str]:
    return [t if re.fullmatch(r"P\d+", t) else t.lower() for t in TOKEN_RX.findall(sentence) if t not in vc.PLACEHOLDERS]


def length_table(lens: list[int]) -> str:
    if len(lens) < 20:
        return f"({len(lens)} sentences: too few for quantiles)\n"
    q = statistics.quantiles(lens, n=20)
    head = (f"n = {len(lens)} sentences · median **{statistics.median(lens):.0f}** words · mean {statistics.mean(lens):.1f} · "
            f"p10 = {q[1]:.0f}, p25 = {q[4]:.0f}, p75 = {q[14]:.0f}, p90 = {q[17]:.0f}, p95 = {q[18]:.0f}\n\n")
    rows = ["| Words per sentence | Share |", "|---|---|"]
    for lo, hi in BANDS:
        share = 100 * sum(1 for l in lens if lo <= l <= hi) / len(lens)
        rows.append(f"| {lo}–{hi} | {share:.0f}% |" if hi < 10**6 else f"| {lo}+ | {share:.0f}% |")
    return head + "\n".join(rows) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--examples", type=Path, default=vc.DEFAULT_EXAMPLES, help=f"corpus directory (default {vc.DEFAULT_EXAMPLES})")
    ap.add_argument("--registry", type=Path, default=vc.DEFAULT_REGISTRY, help="pattern registry whose word rows are counted")
    ap.add_argument("--words", type=int, default=80, help="how many words of the frequency head to print")
    ap.add_argument("--trigrams", type=int, default=30)
    ap.add_argument("--openers", type=int, default=20)
    a = ap.parse_args(argv)

    files = vc.corpus_files(a.examples)
    if not files:
        sys.exit(f"no example files under {a.examples} (expected <section>/<corpus_id>.md)")
    vc.use_registry(vc.load_registry(a.registry), a.registry)

    per_section: dict[str, list[int]] = {}
    all_lens: list[int] = []
    words: Counter = Counter()
    trigrams: Counter = Counter()
    openers1: Counter = Counter()
    openers2: Counter = Counter()
    segs = []
    for f in files:
        fs = vc.markdown_segments(f)
        segs.extend(fs)
        for seg in fs:
            if seg.kind != "body":
                continue
            for s in vc.split_sentences(seg.text):
                n = vc.sent_len(s)
                if n < 3:
                    continue
                all_lens.append(n)
                per_section.setdefault(f.parent.name, []).append(n)
                toks = tokens(s)
                words.update(toks)
                trigrams.update(" ".join(toks[i:i + 3]) for i in range(len(toks) - 2))
                lead = re.match(r"[\"“‘(\[]?\s*([A-Za-z][\w'’-]*,?)(?:\s+([A-Za-z][\w'’-]*,?))?", s)
                if lead:
                    openers1[lead.group(1)] += 1
                    if lead.group(2):
                        openers2[lead.group(1) + " " + lead.group(2)] += 1
    result = vc.analyze(segs)
    total = result["words"]
    print(f"<!-- build_profile.py over {len(files)} files, {total:,} words, {len(all_lens)} sentences; registry {a.registry.name} -->\n")

    print("## 2. Punctuation, measured\n")
    for pid in ("dash", "semicolon", "colon-all", "colon-clause"):
        if pid in vc.PAT_BY_ID:
            k = result["counts"].get(pid, 0)
            print(f"- {vc.PAT_BY_ID[pid].label}: {k} ({1e4 * k / max(total, 1):.1f} per 10k words)")
    print()

    print("## 3–4. Candidate words, counted\n")
    print("Suggested tier: never-word when at or under %.0f per 100k words; otherwise yours, so note the sense you use it in.\n" % NEVER_PER_100K)
    print("| id | word | count | per 100k | suggested |")
    print("|---|---|---:|---:|---|")
    cands = [p for p in vc.PATTERNS if p.rx is not None and p.group in ("habit", "t1", "t2") and p.cls in ("ban", "watch")
             and not p.label.startswith("'")]
    for p in sorted(cands, key=lambda p: (-result["counts"].get(p.id, 0), p.id)):
        k = result["counts"].get(p.id, 0)
        rate = 1e5 * k / max(total, 1)
        print(f"| {p.id} | {p.label} | {k} | {rate:.1f} | {'never-word' if rate <= NEVER_PER_100K else 'yours'} |")
    print()

    print("## 7. Sentence openers\n")
    print("First word, then first two words, most common first (count):\n")
    print("> " + " · ".join(f"{w} ({k})" for w, k in openers1.most_common(a.openers)))
    print()
    print("> " + " · ".join(f"{w} ({k})" for w, k in openers2.most_common(a.openers)))
    print()

    print("## 8. Sentence length\n")
    print("**All sections.** " + length_table(all_lens))
    for sec in sorted(per_section, key=lambda s: -len(per_section[s])):
        lens = per_section[sec]
        print(f"\n**{sec}/** · n = {len(lens)} · median {statistics.median(lens):.0f} · mean {statistics.mean(lens):.1f}")
    print()

    print("\n## 9. Word frequencies and trigrams\n")
    distinct = len(words)
    print(f"{sum(words.values()):,} tokens, {distinct:,} distinct, lowercased (participant ids such as P5 kept as their own tokens). Top {a.words}:\n")
    print("> " + " · ".join(f"{w} ({k})" for w, k in words.most_common(a.words)))
    print()
    print(f"Trigrams within sentence boundaries. Top {a.trigrams}:\n")
    print("> " + " · ".join(f"{w} ({k})" for w, k in trigrams.most_common(a.trigrams)))
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
