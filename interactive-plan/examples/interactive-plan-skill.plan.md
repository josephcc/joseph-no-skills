**Status:** in-review — spec drafted (`SPEC.md`); viewer not yet built. This doc is the live test fixture.
**Date:** 2026-06-27
**Related plans:** `SPEC.md` — the tag/attribute/round-trip specification this plan implements.
**Related plans:** `plan/data-pipeline/editable_base_graph_and_canvas_migration.md` — the second fixture we'll convert.

---

# The `interactive-plan` skill — interactive plan authoring, reading & feedback

## 1. Goal

Joseph plans large, complex features by iterating with a Claude agent for 2–3 hours to produce a
**detailed spec + implementation plan** *before* touching code. The plan files track **open
questions**, **decisions already made**, code pointers (`file.ts:123`), and code/pseudocode blocks.
Open questions and prior decisions are the most important constructs — they are the backbone of the
workflow.

The problem: **reading and editing these in raw markdown is tiring.** This skill renders a plan as a
clean, modern, interactive web page where Joseph can read it, **make decisions, pick options, and
<user-highlight comment="c1">comment Google-Docs-style on any span</user-highlight>** — then hand it
back to the agent to revise, in a loop, until the plan is good enough to implement.

<comment id="c1" status="open" kind="question">
  <note by="agent" at="2026-06-27T16:30">Seeded so you can test the comment UI: try replying to this, then resolving it — and notice this thread stays in the file (collapsed) rather than being deleted. Does the resolve/reopen affordance feel like what you wanted?</note>
</comment>

The workflow this enables:

```text
agent writes/updates a tagged plan
  → Joseph opens the viewer: answers questions, picks options, highlights & comments
  → viewer saves answers + comments back into the same .md
  → "review my feedback on plan X" → agent revises (resolves comments, locks decisions)
  → re-open viewer (it live-reloads) → repeat → implement when clean
```

## 2. Decisions made so far

These were settled over the course of the design conversation.

<decision id="D1" title="Single .md file is the source of truth (no sidecar)" status="locked" date="2026-06-27" from="Q-feedback-flow">
One `.md` file holds everything — the plan, questions, decisions, every answer, every comment
thread, every finding's status — as plain markdown with interleaved self-describing XML tags. No
parallel `.json`.
<rationale>
The tags are self-explanatory so both the renderer and any Claude agent read the same file
identically; it stays git-diffable and self-contained. Joseph's "one file, self-explanatory tags,
status: open/locked" steer.
</rationale>
</decision>

<decision id="D2" title="Viewer is Vite + React + a tiny Node file-API" status="locked" date="2026-06-27" from="Q-stack">
The viewer is a Vite + React app (one `bun install` per machine) plus a minimal Node file-API: one
endpoint to load the target plan `.md`, one to write answers/comments back into it. Launched against
any plan file by absolute path, so it works in any repo.
<rationale>
Joseph chose Node/Vite + React over a zero-dependency Python option. A React app can't write files
itself, so the small file-API is required for the round-trip.
</rationale>
</decision>

<decision id="D3" title="v1 tag set is five tags, including <finding>" status="locked" date="2026-06-27" from="Q-finding-v1">
v1 ships: `<open-question>`, `<decision>`, `<comment>` + `<user-highlight>`, and `<finding>`.
Everything else stays plain markdown (status preamble parsed into a header; code refs linkified; code
blocks highlighted).
<rationale>
The first four cover the planning core (questions + decisions + Google-Docs comments). `<finding>`
was pulled into v1 at Joseph's request so audit/severity-matrix docs are first-class too.
</rationale>
</decision>

<decision id="D4" title="Author new plans tagged; convert existing plans on demand" status="locked" date="2026-06-27" from="Q-tag-source">
Going forward the agent authors plans directly in the tagged format (per `SPEC.md`). The skill can
also convert any existing plain-markdown plan into the interactive format on request. For this
session we'll convert `editable_base_graph_and_canvas_migration.md` as a live fixture.
</decision>

<decision id="D5" title="Inline <user-highlight comment=...> anchors, not text offsets" status="locked" date="2026-06-27">
A highlighted span is wrapped inline as `<user-highlight comment="c7">…span…</user-highlight>`,
binding it to a `<comment id="c7">` thread.
<rationale>
Inline wrapping makes the anchor unambiguous to both renderer and agent and survives the agent
rewriting surrounding prose — more robust than stored character offsets. Joseph chose the
`<user-highlight comment=...>` naming over a terse `<hl>`.
</rationale>
</decision>

<decision id="D6" title="Comments are Google-Docs-style threads, resolvable by either party" status="locked" date="2026-06-27">
Comments are threaded (`<note by="user|agent">` replies), dock as cards in the right margin aligned
to their highlight, and can be **resolved or reopened by either Joseph or the agent**. Resolved
threads collapse behind a "Show N resolved" toggle and are kept in the file, never deleted. The agent
can also author comments *for* Joseph (symmetric).
</decision>

<decision id="D7" title="Options carry rich markdown; viewer always adds Other + freeform" status="locked" date="2026-06-27">
`<option>` holds block markdown (paragraphs, sub-bullets, tradeoffs), not a one-line label. After the
authored options the viewer always appends an **"Other"** option and a **freeform textarea**, so
every multiple-choice has an escape hatch and a place for nuance.
<rationale>
Matches the real "Option A / Option B" comparisons in the corpus, which carry whole paragraphs per
option; and Joseph's "max flexibility for feedback" requirement.
</rationale>
</decision>

<decision id="D8" title="Decisions render table-compact and are lifecycle-linked to questions" status="locked" date="2026-06-27">
A run of `<decision>` tags renders as a tight, scannable, table-like stack (id · status badge ·
title, expandable to body + rationale). An answered `<open-question>` is converted by the agent into
a `<decision from="Q-…">`, preserving the id link; locked decisions can be reopened.
<rationale>
The most common decision format in the corpus is a "Locked decisions" table — keep that
scannability while making each row individually lockable and commentable.
</rationale>
</decision>

<decision id="D9" title="Findings use a p0–p3 severity scale and render as a filterable matrix" status="locked" date="2026-06-27">
`<finding>` carries `severity` (`p0`–`p3`) and `status` (`open|fixed|wontfix|deferred|partial`); a
run of findings renders as a severity-sorted, filterable matrix with per-row status toggles.
</decision>

<decision id="D10" title="v1 highlights stay within a single block" status="locked" date="2026-06-27" from="Q-highlight-scope">
A `<user-highlight>` spans within one block (paragraph, list item, table cell, or one code line).
Cross-block selections snap to block boundaries; true multi-block ranges are deferred to v2.
</decision>

<decision id="D11" title="Skill is named interactive-plan" status="locked" date="2026-06-27" from="Q-A">
The skill is named **`interactive-plan`** (directory `~/.claude/skills/interactive-plan/`).
<rationale>The most literal description of what it is — a format + viewer for interactive plans. Joseph's pick.</rationale>
</decision>

<decision id="D12" title="Review hand-back is manual; viewer live-watches the file and warns on conflict" status="locked" date="2026-06-27" from="Q-B">
After reviewing, Joseph returns to the chat window and tells the agent to review his decisions and
update the plan — no in-viewer "send" button. The viewer **watches the `.md` for changes and
re-renders in real time**, so when the agent rewrites the plan the view updates live. If both sides
touched the file and a save would clobber the other's changes, the viewer **warns of the conflict**
rather than silently overwriting.
<rationale>
Keeps the loop simple (the file already carries the feedback) while making iteration feel live.
Conflict detection: capture the file's hash at load; on any viewer write, if the on-disk hash no
longer matches, surface a conflict prompt (reload / keep-mine / merge) instead of overwriting.
</rationale>
</decision>

<decision id="D13" title="Code refs open in Zed via the file-API; editor command configurable + globally persisted" status="locked" date="2026-06-27" from="Q-C">
Clicking a `file.ts:123` reference calls the local file-API, which shells out to a configurable
editor command — **default `zed {path}:{line}:{col}`** (Zed CLI confirmed at `/opt/homebrew/bin/zed`;
it opens `path:line:column`). The command template is stored in the skill's **global config**
(`~/.claude/skills/interactive-plan/config.json`) so it persists across repos and can be pointed at
another editor.
<rationale>
Shelling out through the backend is editor-agnostic and avoids depending on a browser URL-scheme
handler; defaulting to Zed matches Joseph's editor, and the config makes it overridable.
</rationale>
</decision>

<decision id="D14" title="Viewer uses the Asta design system" status="locked" date="2026-06-27" from="Q-D">
The viewer is styled with Ai2's **Asta** design tokens, vendored into the skill so it stays
self-contained when run in any repo.
<rationale>Joseph's call; matches the look of his primary repo (`asta-*` Tailwind tokens).</rationale>
</decision>

<decision id="D15" title="Ship a format linter the main agent can run" status="locked" date="2026-06-27" from="Q-linter">
The skill ships a **linter CLI** (runnable by the main agent, e.g. `bun run lint <plan.md>`) that
validates a plan `.md` against `SPEC.md` before/after authoring: tags well-formed and balanced, only
known attributes, **unique ids**, every `<user-highlight comment="…">` resolves to a real
`<comment id>`, every `<answer chose>` references a real `<option id>`, and **no tags parsed inside
fenced code** (guards F-3). Reports line-numbered errors.
<rationale>
Lets the authoring agent self-check that a generated plan will render correctly without launching the
viewer — closes the loop between authoring and rendering.
</rationale>
</decision>

<decision id="D16" title="Agent learns the format via SKILL.md cheatsheet + SPEC.md" status="locked" date="2026-06-27" from="Q-E">
`SKILL.md` embeds a **compact authoring cheatsheet** (the tag quick-reference), so triggering the
`interactive-plan` skill loads the format into the agent's context. For full detail the agent reads
`SPEC.md` (it lives beside `SKILL.md`). The "always author in this format" policy (D17) is reinforced
by a one-line pointer in plan-heavy repos' `CLAUDE.md`.
</decision>

<decision id="D17" title="Always author plans in this format; auto-trigger the skill on plan authoring" status="locked" date="2026-06-27" from="Q-E">
The agent **always** authors plan files in this tagged format. Whenever the agent is about to author
(or substantially update) a plan file in the user's repo **at the user's request**, it **triggers the
`interactive-plan` skill first** — so it has the syntax — and **spins up the interactive planner at
the end** for the user to review.
<rationale>
Planning is Joseph's core workflow, so the format is the default, not opt-in. The skill's description
is written to fire on "about to write/update a plan/spec/design doc at the user's request," loading
the syntax up front and closing the turn by launching the viewer.
</rationale>
</decision>

## 3. Open questions

_None open — all resolved this round (Q-A→D11 … Q-E→D16/D17). New questions will appear here as the build surfaces them._

## 4. Risks (findings)

<finding id="F-1" title="Anchor drift when the agent rewrites a highlighted span" severity="p2" status="open" effort="design">
If the agent edits prose that a `<user-highlight>` wraps, it may drop or mangle the wrapper, orphaning
the comment. Inline wrapping (D5) is more robust than offsets, but not immune.

**Mitigation to design:** the agent's authoring guidance (SPEC §"Authoring guidance") says never to
silently drop a comment — resolve it with a reply or carry the highlight forward. The viewer should
also visibly flag an orphaned comment (anchor text no longer found) rather than hiding it. The linter
(D15) can additionally warn when a `<comment>` has no matching `<user-highlight>`.
</finding>

<finding id="F-2" title="Large plans may stress parse + render" severity="p3" status="open" effort="small">
Real plans range from ~260 lines (`editable_base…`) to ~1,120 lines (`user_behavior_logging.md`) with
many large code blocks and potentially dozens of comment cards. The renderer must stay snappy —
virtualize the margin rail / collapse long code blocks (already specced) and avoid re-parsing the
whole file on every keystroke (debounce the live-watch in D12).
</finding>

<finding id="F-3" title="Tags appearing inside fenced code blocks must not be parsed" severity="p2" status="open" effort="small">
A plan's code block could literally contain text like `<decision>` or `<user-highlight>` (e.g. this
very plan quotes the tags). The parser must treat fenced code (and inline code spans) as opaque and
**never** interpret tags inside them — otherwise the doc corrupts itself. The linter (D15) enforces
the same rule.
</finding>

## 5. Build order

```text
1.  SPEC.md — tag/attribute/round-trip spec                       -> DONE
2.  Rename skill plan-review → interactive-plan (D11)             -> DONE
3.  Scaffold Vite + React viewer + Node file-API, Asta-themed (D2,D14)  -> verify: loads a .md by path, renders
4.  Parser: markdown + the 5 tags, code-fence-safe (F-3)         -> verify: unit tests on tag extraction
5.  Renderers: question (choice+Other+freeform), decision stack,  -> verify: in-browser, each interactive
    comment margin + highlights, finding matrix
6.  Round-trip writes back into the .md, non-destructive          -> verify: edit in UI, diff the file
7.  Live file-watch + conflict warning (D12)                      -> verify: external edit → hot-reload; concurrent edit → warning
8.  Code-ref → open in Zed via file-API + global config (D13)     -> verify: click a ref opens Zed at the line
9.  Linter CLI (D15)                                              -> verify: catches malformed fixtures; passes valid ones
10. Convert editable_base_…migration.md as a 2nd fixture (D4)     -> verify: preview both fixtures
11. SKILL.md — cheatsheet + SPEC pointer + launch steps (D16)     -> verify: skill triggers, launches viewer
```

## 6. Out of scope (v1)

- Cross-block highlights (D10 → v2).
- Per-row checkoff on plain, untagged markdown tables (use `<finding>`/`<decision>` instead).
- Real-time multi-user collaboration — this is a single-user local tool (but the file *is* watched, D12).
- Authoring the plan *in* the viewer — the agent authors; the viewer is for reading/answering/commenting.

## Build + review log

Built end-to-end 2026-06-27 (Vite/React viewer + Node daemon + parser/linter). Verified: 15 unit tests, tsc, build, fixtures lint clean, and browser round-trip (answer → file, comment thread → resolve, multi-file daemon, compact-on-scroll header, raw-text/no-double-escape, scrubbed user-link XSS).

## Internal multi-agent review — 2026-06-27

5 reviewers × per-finding adversarial verification: **29 raw → 21 confirmed (7 P2, 14 P3)**. Fixed 14: quote/code-aware inner-tag parsing; unclosed-block lint detection; user-text escaping; server hardening (127.0.0.1 bind, Origin/Host guard, /api/config allowlist, /api/open traversal refusal, editor-command tokenization); fs.watch re-arm; regex lastIndex; "Resolved by you"; composer-clear on reload; single-select lint; diagnostic line numbers. Deferred: selection-anchoring on formatted/duplicate text, 409 merge, preamble key allowlist, single-block-highlight lint.

## Codex audit — 2026-06-27

**Codex verdict:** Substantive correctness/security gaps in the file API, parser/serializer, comment workflow, conflict handling, and user-input rendering.
**Issue counts (Codex's):** P0:0 P1:0 P2:9 P3:0

**Changes made in response:**
- `app/server.mjs` `validatePlanPath` — reject symlinked `.md` paths via a `realpath` re-check (closes arbitrary-file overwrite).
- `app/server.mjs` SSE — clear the rename re-arm timer on connection close (fixes an `fs.watch` handle leak).
- `app/src/parser.ts` `serializeQuestion` — emit `</option>` on its own line so a fenced-code option body can't glue the close tag (which `protectedRanges` would swallow).
- `app/src/parser.ts` `lintPlan` — validate raw block-tag attributes (unknown / missing-required / bad-enum) instead of silently defaulting `severty="p1"` → `p3`.
- `app/src/markdown.tsx` `preprocessHighlights` — skip code regions so quoted `<user-highlight>` examples stay literal; added an `escapeHtml` render path + `javascript:`/`data:` link scrubbing for user-authored notes/answers.
- `app/src/App.tsx` — store user text **raw** (no input-time escaping) so reopening an answer doesn't double-escape; escape at render via `<Markdown escapeHtml>`; preserve the pending edit on a 409 conflict with an "Overwrite with my version" / "Discard" choice.

**Deferred / not actioned:**
- Commenting *inside* decision/finding cards (only prose blocks are selectable for highlight-comments) — documented v1 limitation; SPEC's comment examples are prose / refs / code / tables.

Codex's full final message saved at `/tmp/codex-audit-20260627-182729-report.md` (this run).

### Codex follow-up rounds — 2026-06-27

- **Round 2** (verify the 8 fixes): 6 confirmed correct; 2 flagged incomplete — (a) raw user text could still corrupt the parse via literal structural close tags (`</note>` etc.), and (b) the new attribute linting only covered top-level block tags, not child tags. **Both reworked:** user bodies are now kept raw in the model but entity-encoded at the file boundary and decoded on parse (round-trip stable); child-tag attribute validation added for `options`/`option`/`answer`/`note`/`user-highlight`.
- **Round 3** (verify the rework): Fix A verified complete; Fix B had one residual gap — the attribute-free `<rationale>` child wasn't in the rules table. **Fixed:** added a zero-attribute rule for `<rationale>` (verified directly — a bogus attribute is now flagged). Audit converged.
