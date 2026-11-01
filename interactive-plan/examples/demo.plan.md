**Status:** in-review
**Date:** 2026-06-27
**Related plans:** `SPEC.md` — the format this document uses.

---

# Demo plan — exercising every interactive tag

This is a throwaway fixture for testing the viewer. It has **open questions** to answer, a
decisions stack, a findings matrix, and a <user-highlight comment="c2">Google-Docs comment thread</user-highlight>.
The core data join is the `finding_id` defined in <user-highlight comment="c1">`app/src/parser.ts:42`</user-highlight> —
click that reference to open it in your editor.

## 1. Open questions

<open-question id="Q-1" title="Default port for the viewer" status="open">
Which port should the local viewer bind to by default?

<options select="single">
  <option id="p5177">**5177** — the current default; clashes with nothing common.</option>
  <option id="p3000">**3000** — familiar, but collides with lots of dev servers.</option>
  <option id="p8080">**8080** — also commonly taken.</option>
</options>
</open-question>

<open-question id="Q-2" title="Which extra features matter most next?" status="open">
Pick any that you'd prioritize after v1 ships.

<options select="multi">
  <option id="search">In-document search / jump-to-question.</option>
  <option id="export">Export answered plan to a clean read-only HTML.</option>
  <option id="diff">Show a diff of what the agent changed between review rounds.</option>
  <option id="multi-block">Multi-block highlights (deferred from v1).</option>
</options>
</open-question>

<open-question id="Q-3" title="Anything else on your mind?" status="open">
A pure freeform question — no options, just a text box.
</open-question>

## 2. Decisions

<decision id="D-1" title="Single .md file is the source of truth" status="locked" date="2026-06-27">
Everything lives in one markdown file with interleaved tags.
<rationale>Git-diffable, self-contained, readable by both the viewer and any agent.</rationale>
</decision>

<decision id="D-2" title="Viewer uses the Asta design system" status="locked" date="2026-06-27" from="Q-theme">
Styled with vendored Asta tokens.
</decision>

<decision id="D-3" title="Ship a search box in v1" status="proposed" date="2026-06-27">
Proposed, not yet locked — lock it or reopen it from this row.
</decision>

## 3. Findings

<finding id="F-1" title="Anchor drift when prose is rewritten" severity="p2" status="open" effort="design">
If the agent rewrites a span wrapped by `<user-highlight>`, the anchor can be lost. Mitigate with
authoring guidance + an orphaned-comment warning.
</finding>

<finding id="F-2" title="Large plans may stress the renderer" severity="p3" status="open" effort="small">
Files up to ~1,100 lines exist. Debounce the live-watch and collapse long code blocks.
</finding>

<finding id="F-3" title="Tags inside code fences must not be parsed" severity="p2" status="fixed" effort="small">
Handled — the parser skips fenced code when scanning for tags, verified by a unit test.
</finding>

## 4. Check table

<check-table id="T-papers" title="Papers for the related-work section" checked="p2,p5">
Tick the papers to keep. Click a header to sort, type in the box to filter, shift-click to tick a
range. The citation counts are invented for this fixture.

| id | Title | Venue | Year | Citations |
|----|-------|-------|-----:|----------:|
| p1 | Augmenting Scientific Papers with Just-in-Time, Position-Sensitive Definitions of Terms and Symbols | CHI | 2021 | 210 |
| p2 | Threddy: An Interactive System for Personalized Thread-based Exploration and Organization of Scientific Literature | UIST | 2022 | 64 |
| p3 | CiteSee: Augmenting Citations in Scientific Papers with Persistent and Personalized Historical Context | CHI | 2023 | 71 |
| p4 | Relatedly: Scaffolding Literature Reviews with Existing Related Work Sections | CHI | 2023 | 48 |
| p5 | Synergi: A Mixed-Initiative System for Scholarly Synthesis and Sensemaking | UIST | 2023 | 1,034 |
| p6 | Sensecape: Enabling Multilevel Exploration and Sensemaking with Large Language Models | UIST | 2023 | 152 |
</check-table>

## 5. Notes

Cross-references are plain in-page links: the [open questions](#1-open-questions) above, the
[port question](#Q-1) by its id, or a single decision like [D-2](#D-2). Click one to jump, or rest
the pointer on it for a moment to peek at the target without leaving this spot.

```ts
// This block literally contains a tag and must NOT be parsed as one:
// <decision id="NOPE" title="x" status="locked">should stay text</decision>
const id = `${corpus}:${exp}:${obs}`;
```

<comment id="c2" status="open" kind="clarify">
  <note by="user" at="2026-06-28T06:00">A comment attaches to this exact highlighted span — the yellow text. Click it to jump to the thread, just like a Google Doc.</note>
  <note by="agent" at="2026-06-28T06:01">Right — every comment is anchored to a `<user-highlight>`, so feedback always points at a specific part of the plan rather than floating loose.</note>
</comment>

<comment id="c1" status="open" kind="question">
  <note by="agent" at="2026-06-27T17:00">Seeded comment anchored to the parser reference above — reply, then resolve it to test the Google-Docs flow.</note>
</comment>
