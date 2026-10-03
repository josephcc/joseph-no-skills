# Interactive Plan Format — Specification (v1)

This document defines the **tagged-markdown plan format** used by the `interactive-plan` skill. A plan
file is **one `.md` file** that is the single source of truth. It is ordinary GitHub-flavored
markdown with a small set of **self-describing XML tags** interleaved into it. The tags carry
structure and state (`status="open"`, `status="locked"`, …) so that *both* a human reading the
rendered web view *and* any Claude agent reading the raw file understand them identically.

Two audiences, one file:
- **The viewer** (a local Vite + React app) parses the tags and renders an interactive,
  Google-Docs-style page where the user answers questions, picks options, comments on highlighted
  spans, and resolves/locks items.
- **A Claude agent** reads the same raw markdown to understand the plan, sees the user's answers
  and comments inline, updates the plan, and re-emits it for another review round.

## Core principles

1. **Single source of truth.** Everything — the plan, the questions, the decisions, the user's
   answers, every comment thread, every finding's status — lives in the one `.md` file. There is
   no sidecar JSON. The file is git-diffable and self-contained.
2. **Tags are additive and semantic.** Anything not inside a known tag is plain markdown (GFM; strikethrough requires `~~`, so a lone LaTeX `~` is literal) and
   renders normally. A reader who ignores the tags still gets a coherent document.
3. **State lives in attributes.** `status`, `by`, `at`, `severity`, etc. are attributes, never
   prose, so they are machine-parseable and unambiguous.
4. **Nothing is destroyed.** Resolved comments, superseded decisions, and answered questions are
   *kept* (collapsed in the UI), never deleted — the file is an auditable history.
5. **Both parties write, in turns.** The user writes via the viewer; the agent writes by editing the
   file. The vocabulary is symmetric — an agent can pose a question or drop a comment for the user,
   and the user can answer or comment for the agent. To avoid racing writes, the two sides take
   turns: the agent revises when the user hands a review pass back, not while the user is actively
   editing in the viewer. One asymmetry: **resolving a thread is the user's action** — the agent
   replies and may suggest resolving, but does not set a comment to `resolved` itself.

---

## File anatomy

```
<status preamble>      ← plain-markdown metadata block, parsed into a sticky header
# Title
…sections of plain markdown, with interactive tags interleaved…
```

### Status preamble (parsed, not a tag)

The bold key-value block at the top of the file is parsed into the sticky header chip bar. No tag
required — keep authoring it exactly as today:

```markdown
**Status:** not-started
**Date:** 2026-06-27
**Related commits:** `a1b2c3d` short message
**Related plans:** `plan/foo.md` — …
```

Recognized keys: `Status`, `Date`, `Related commits`, `Related plans`, `Scope`, `Authored`,
`Update <date>`. Anything else in the block renders as plain text.

### Auto-rendered (no tag needed)

- **Code references** — `file.ts:123`, `App.tsx:1318-1370`, bare 7–40 char commit SHAs, and
  `#123` / PR URLs are auto-linkified (hover shows the path; click opens it / the PR).
- **Inter-plan links** — a plain relative/absolute markdown link to another `.md` plan
  (`[x](../pathway/main.md)`, `[x](hci/main.md#status)`) is resolved against the current plan's path
  and rewritten to open that file in the viewer in a **new tab** (`?plan=<abs>`). Lets plan files
  interlink like a wiki with no special syntax. External URLs, `#anchors`, and non-`.md` links are
  untouched.
- **Code blocks** — fenced blocks are syntax-highlighted with a language label + copy button, and
  collapse behind a "show N lines" toggle when long.
- **Tables, lists, headings, blockquotes** — standard markdown rendering, styled.

---

## The six tags

| Tag | Purpose | Interactive surface |
|---|---|---|
| `<open-question>` | A question awaiting the user's input | choice picker + Other + freeform answer |
| `<decision>` | A decision, proposed or locked | lock / reopen / supersede; collapsible rationale |
| `<comment>` | A threaded margin comment (Google-Docs) | reply by either party; **resolve/reopen by the user** |
| `<user-highlight>` | Inline anchor binding a span to a comment | the highlighted span; click ↔ its comment card |
| `<finding>` | An audit/review finding (severity matrix item) | filter by severity; toggle status |
| `<check>` | A checkable task item (tutorial / QA checklist) | tick the checkbox; flips `status`, saved to file |

ID rule: every tag with an `id` uses a short, stable, human-readable id (`Q-A`, `D3`, `c7`,
`F-B1`). IDs never change once assigned — answers, decisions, and highlights reference them.

---

### 1. `<open-question>`

An unresolved question the plan needs the user to answer. The single most important construct.

**Attributes**
- `id` (required) — e.g. `Q-A`.
- `title` (required) — short label shown in the questions rail.
- `status` — `open` (default) | `answered`. Flips to `answered` when an `<answer>` is present.

**Children**
- Body markdown — the question and any context.
- `<options select="single|multi">` (optional) — discrete choices. Omit for a pure freeform
  question.
  - `<option id="...">` — **rich markdown block content** (paragraphs, sub-bullets, code, tradeoffs
    are all allowed). `id` is the stored choice value.
  - The viewer **always** appends two affordances after the authored options: an **"Other"** option
    and a **freeform textarea**. The author never writes these.
- `<answer>` (written by the viewer when the user answers) — see below.

**`<answer>` shape**
```xml
<answer by="user" at="2026-06-27T10:02" chose="mode-toggle">
Toggle is fine, but it must preserve the chat transcript across modes.
</answer>
```
- `chose` — the selected `<option>` id(s). Comma-separated for `select="multi"`. The literal value
  `other` means the user picked Other (their text is the body). Omit `chose` for a freeform-only
  question. Body text is optional commentary that always travels with the answer.

**Lifecycle** — `open` → (user answers) `answered`. During its review pass the agent typically
**converts an answered question into a `<decision from="...">`** (see below), preserving the id link.

**Rendering** — open questions surface in a right-side **Questions rail** and inline at their
location; answered ones show the chosen option's full text (not just its id) with the answer note
and a *Change answer* control that reopens the full option list.

**Example (the real `Q-A`, converted)**
```xml
<open-question id="Q-A" title="Edit-agent invocation surface" status="open">
How should the base-graph edit agent be invoked, and does it share the chat session?

<options select="single">
  <option id="mode-toggle">A **mode toggle** on the existing chat panel ("Explore ⇄ Edit").
  Cheapest; reuses the panel. Risk: mode confusion.</option>
  <option id="separate-panel">A **separate panel / entry point** dedicated to editing.
  Clearest separation; more UI surface to build.</option>
  <option id="agent-handoff">A **hand-off** the explorer agent triggers when it detects an edit
  intent. Most fluid; hardest to make predictable.</option>
</options>
</open-question>
```

---

### 2. `<decision>`

A decision — either already locked, or proposed and awaiting the user's blessing.

**Attributes**
- `id` (required) — e.g. `D3`.
- `title` (required) — one-line summary shown in the compact list.
- `status` — `proposed` | `locked` | `superseded` | `wontfix`.
- `date` (optional) — when locked.
- `from` (optional) — id of the `<open-question>` this resolves (e.g. `from="Q-A"`).
- `supersedes` (optional) — id of a `<decision>` this replaces.

**Children**
- Body markdown — the decision.
- `<rationale>` (optional) — why; rendered collapsed by default.

**Rendering** — a run of `<decision>` tags renders as a **tight, scannable, table-like stack**:
each row is `id · status badge · title`, expandable to body + rationale. This preserves the
"locked decisions table" scannability while making each row individually lockable/commentable.

**Viewer actions** — Lock a `proposed` decision, **Reopen** a locked one (flips it back toward a
question for the next agent pass), or mark `superseded`/`wontfix`. The viewer writes the
`status`/`date`/`resolved-by` attributes; it does **not** invent new decisions — the agent does
that during review.

**Example (the real `D3`)**
```xml
<decision id="D3" title="Storage = full materialized versions, not deltas" status="locked"
          date="2026-06-27" from="Q-storage">
The durable unit is a full materialized graph-version (a complete `graph_with_ontology.json` +
`findings.json`), stored as a sibling folder `<base>__<versionId>` — not a stored delta. The
op-list is kept as version metadata (provenance + live undo), not the storage-of-record.
<rationale>
Unifies with the bio `parent_job_id` model; reuses the existing load/persist/disk-cache
machinery; self-contained and robust to reducer/schema drift; no load-time replay.
</rationale>
</decision>
```

---

### 3. `<comment>` + 4. `<user-highlight>`

A **Google-Docs-style threaded comment** anchored to a highlighted span. Two coupled tags: an
inline `<user-highlight>` marks the span; a block `<comment>` holds the thread and is floated into
the right margin, vertically aligned to its anchor.

#### `<user-highlight>`
```xml
the durable unit is a <user-highlight comment="c7">full materialized graph-version</user-highlight>, not a delta
```
- `comment` (required) — id of the `<comment>` it binds to.
- Wraps the exact highlighted span **inline**. This makes the anchor unambiguous to both the
  renderer and the agent, and it survives the agent rewriting surrounding prose.
- **v1 constraint:** a highlight stays within a single block (one paragraph, list item, table cell,
  or one code line). Cross-block selections snap to block boundaries.
- **Empty = a target anchor.** A self-paired `<user-highlight comment="c7"></user-highlight>` with
  no inner text renders as a small clickable **◆ marker** instead of a span. This is the anchor for
  things a span can't reliably wrap: a structured element (decision / finding / check / question),
  or a phrase the viewer can't pin to one occurrence. The viewer appends one to the relevant field
  (a decision's body, a check's label, …) when you comment on that element via its ◆ affordance, and
  falls back to it for prose when a span anchor would be ambiguous. Author one yourself to attach a
  comment to a whole element.

#### `<comment>`
```xml
<comment id="c7" status="open" kind="clarify">
  <note by="user" at="2026-06-27T10:02">Does this survive a base-graph re-extraction, or only manual edits?</note>
  <note by="agent" at="2026-06-27T10:09">Only manual edits — re-extraction is the escape hatch in §3e.</note>
</comment>
```
- `id` (required).
- `status` — `open` | `resolved`.
- `kind` (optional) — `error` | `clarify` | `question` | `nit`; color-codes the highlight so a
  reader can scan for errors.
- `resolved-by` / `resolved-at` (set when resolved) — the card shows "Resolved by you" vs
  "Resolved by agent". The format permits either value, but by convention the **user** resolves, so
  in practice this reads "Resolved by you".
- Children: ordered `<note by="user|agent" at="ISO-8601">…markdown…</note>` — the thread. Either
  party appends notes; **the user resolves or reopens** — the agent replies and may suggest
  resolving, but leaves the `status` to the user. An open thread whose *last* note is `by="user"` is
  the signal that the agent owes a reply.

**Rendering** — highlighted spans (or ◆ targets) in the body; comment cards docked in the right
margin. Resolved threads collapse out of the margin behind a **"Show N resolved"** toggle. Click a
highlight/◆ → opens its card; click a card → flashes the anchor. Two ways to create a thread:
selecting prose shows a floating **💬 Comment** button (anchors the exact selected occurrence as a
span, or a ◆ target if that's ambiguous); every structured element shows a **💬 / ◆** affordance
that anchors a ◆ target to it.

**Editing & deleting** — the user can **edit** their own notes (`by="user"`) in place; agent notes
are read-only in the viewer. **Delete thread** (🗑 on the card) is distinct from *resolve*: it
removes the `<comment>` block *and* strips its `<user-highlight>` anchor(s) from the prose — use it
to discard a thread entirely, vs. resolve which keeps it behind the "Show N resolved" toggle.

**Symmetric authoring** — the agent may proactively add a `<user-highlight>` + `<comment>` to flag
something *for* the user (e.g. "I assumed X here — confirm?"); it appears as an open thread the
user can reply to or resolve.

---

### 5. `<finding>`

An audit/review finding — the interactive form of a severity-matrix row (e.g. a code-audit doc).

**Attributes**
- `id` (required) — e.g. `F-B1` (any stable label).
- `title` (required) — one-line issue summary.
- `severity` (required) — `p0` | `p1` | `p2` | `p3` (P0 = must-fix … P3 = minor).
- `status` — `open` (default) | `fixed` | `wontfix` | `deferred` | `partial`.
- `effort` (optional) — free text fix-size hint (`small`, `design`, …).

**Children** — body markdown: what's wrong, why it matters, suggested fix, `file.ts:line`
references. May contain `<user-highlight>` spans like any prose.

**Rendering** — a run of `<finding>` tags renders as a **filterable, severity-sorted matrix**
(filter by severity/status, toggle a row's status). Each row stays individually commentable.

**Viewer actions** — change a finding's `status` (e.g. open → fixed), filter the matrix. New
findings are authored by the agent, not minted in the viewer.

**Example**
```xml
<finding id="F-B3" title="Pagination cursor survives a filter change" severity="p1" status="open" effort="small">
`useResults()` (`src/results/useResults.ts:142`) holds the cursor in state and resets `filters`
without clearing it, so changing a filter fetches page 2 of the *new* query and renders it as
page 1. The list comes back short rather than visibly wrong, which is how it survived review.

**Suggested fix:** derive the cursor from the filter key so it resets with the query, or clear it
in the same setter that writes `filters`.
</finding>
```

---

### 6. `<check>`

A checkable task item — the persisted, id-addressed form of a checklist line. Use it for tutorials,
manual-test / QA scripts, and acceptance checklists: anything the reader ticks off as they go.
(Plain GFM `- [ ]` still renders, but as a **read-only** checkbox — use `<check>` whenever ticks
must persist.)

**Attributes**
- `id` (required) — short stable label (`k1`, `qa-3`, …).
- `status` — `todo` (default) | `done`.

**Children** — inline label markdown (`code`, **bold**, `file.ts:line` refs). Keep it to one line.

**Rendering** — a run of consecutive `<check>` tags renders as one tight checklist of interactive
checkbox rows; `done` rows are struck through and dimmed. Each row is preceded/followed by normal
prose, so headers like `**✅ Expect**` group the lists naturally.

**Viewer actions** — tick/untick the checkbox; this flips `status` (`todo`↔`done`) and writes it
back to the file through the same block-edit round-trip as a decision's status (no positional
matching — the toggle is addressed by `id`). The agent authors the checks; the user ticks them.

**Example**
```xml
**✅ Expect**
<check id="k1" status="todo">A welcome modal opens with the **graph name** as its heading.</check>
<check id="k2" status="done">The `Start Exploring` button dismisses it.</check>
```

---

## Round-trip: who writes what

| Action | Written by | What changes in the file |
|---|---|---|
| Answer a question | **Viewer** | adds `<answer>`; sets question `status="answered"` |
| Tick / untick a check | **Viewer** | sets `<check status>` (`todo`↔`done`) |
| Comment / reply | **Viewer** or **Agent** | adds `<user-highlight>` + `<comment>` / appends `<note>` |
| Resolve / reopen a comment | **Viewer** (the user) | sets `<comment status>` + `resolved-by`/`resolved-at` |
| Lock / reopen / supersede a decision | **Viewer** or **Agent** | sets `<decision status>`/`date` |
| Change a finding's status | **Viewer** or **Agent** | sets `<finding status>` |
| Convert answered question → decision | **Agent** | replaces `<open-question status="answered">` with `<decision from="Q-…">`, carrying the id link |
| Address a comment in the plan body | **Agent** | edits prose; appends an agent `<note>`; **suggests the user resolve** |
| Pose a new question / add a finding | **Agent** | inserts a new `<open-question>` / `<finding>` |

**Invariants the viewer guarantees:** it only edits attributes and appends `<answer>`/`<note>`
nodes and new `<user-highlight>`/`<comment>` pairs; it never deletes content or rewrites plan prose.
**Invariant the agent must honor:** never silently drop a user's comment or answer — **reply** to it
and carry it forward (leave *resolving* to the user). Revise in turns: edit the plan when the user
hands a review pass back, not while they're actively editing it in the viewer, so the two sides never
race on the same file.

---

## Authoring guidance for agents

**Open with the brief.** Directly after the title, a `## 0. Brief (verbatim)` section quotes the
user's original instruction word for word (blockquoted, dated, with its source), followed by dated
addenda for later instructions in the same thread. It is plain markdown, not a tag, and the agent
never edits it; paraphrases go below it and are labelled as the agent's. See SKILL.md, "The brief".

When writing or updating a plan in this format:

1. **Default to plain markdown.** Only reach for a tag when the content is genuinely one of the
   five semantic kinds. Over-tagging hurts readability.
2. **Every genuinely-open decision point is an `<open-question>`** — give it a stable `id` and a
   `title`, and provide `<options>` whenever there are discrete alternatives (the viewer adds Other
   + freeform automatically, so list only the real candidates). Questions and prior decisions are
   the heart of the workflow.
3. **Record settled choices as `<decision status="locked">`** with a `<rationale>`; link it to its
   originating question with `from`. Use `proposed` when you're recommending but want sign-off.
4. **On each review pass:** read every `<answer>` and open `<comment>`; update the plan; convert
   answered questions to decisions; **reply** to comments (the user resolves them); never discard
   feedback. Do this when the user hands the pass back, not while they're still editing in the viewer.
5. **Preserve ids and history.** Don't renumber. Don't delete resolved/superseded items.
6. **Findings** capture audit issues with a real `severity`; flip `status` as they're addressed.

---

## Rendering summary

- **Interactive:** `<open-question>` (choice + Other + freeform), `<decision>` (lock/reopen),
  `<comment>`/`<user-highlight>` (threaded, resolvable), `<finding>` (filterable matrix).
- **Styled, non-interactive (v1):** status preamble header, linkified code refs, highlighted code
  blocks, tables, phased plans, out-of-scope lists, trade-off/rationale prose.
- **Deferred (v2):** cross-block highlights; richer per-row checkoff on plain (untagged) tables.
