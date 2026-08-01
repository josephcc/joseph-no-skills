---
name: interactive-plan
description: Author and review detailed spec/implementation plans in an interactive, taggable markdown format, then open a local web viewer to read, answer questions, pick options, and comment Google-Docs-style. Use this WHENEVER you are about to write or substantially update a plan / spec / design doc in the user's repo at their request — load it first so you author in the correct tagged syntax, and launch the viewer at the end so the user can review and give feedback.
argument-hint: [path to a plan .md to open in the viewer, or a plan to author]
allowed-tools: Read, Write, Edit, Bash(bun:*), Bash(bunx:*), Bash(node:*), Bash(git rev-parse:*), Bash(git diff:*)
---

# Interactive Plan — author, review, iterate

This skill is for the user's core workflow: iterating with you to build a **detailed plan/spec
before coding**, tracking **open questions** and **decisions** as first-class, then reviewing it in a
clean interactive web page instead of raw markdown.

**Always author plans in this format** (the user's standing decision). When the user asks you to
write or substantially revise a plan, spec, or design doc: load this skill, author in the tagged
syntax below, lint it, and launch the viewer so they can review.

Need a shareable copy for people who won't open the viewer? See
[Export a PDF to share](#export-a-pdf-to-share).

The skill lives at `~/.claude/skills/interactive-plan/`:
- `SPEC.md` — the **full** format specification. **Read it** before authoring if you need detail
  beyond the cheatsheet below (exact attributes, round-trip rules, edge cases).
- `app/` — the Vite+React viewer + Node file-API + the linter.
- `examples/` — worked fixtures (`interactive-plan-skill.plan.md`, `demo.plan.md`).

## Authoring cheatsheet (the six tags)

Everything not in a tag is plain markdown (rendered with code-ref linkifying + highlighted code
blocks; the `**Status:** / **Date:** / ...` preamble becomes the header).

**Plans interlink like a wiki.** A plain relative markdown link to another `.md` plan
(`[Pathway](../pathway/main.md)`, `[details](hci/main.md#status)`) is detected by the viewer and
rewritten to open that file **in a new viewer tab** (`?plan=<abs>`) — no special syntax, just a normal
link. Use this to build a portal/thread structure across many plan files. External URLs, in-page
`#anchors`, and non-`.md` links are left as ordinary links.

**Open question** — a fork awaiting the user. Options carry rich markdown; the viewer auto-adds an
"Other" choice + a freeform box, so list only real candidates.
```
<open-question id="Q-A" title="Short label" status="open">
The question, in prose.
<options select="single">   <!-- or select="multi"; omit <options> for a freeform question -->
  <option id="opt1">Rich **markdown** per option.</option>
  <option id="opt2">Another option.</option>
</options>
</open-question>
```

**Decision** — a settled (or proposed) choice. Renders as a compact, lockable row.
```
<decision id="D1" title="One-line summary" status="locked" date="YYYY-MM-DD" from="Q-A">
The decision.
<rationale>Why (collapsible).</rationale>
</decision>
```
`status`: `proposed` | `locked` | `superseded` | `wontfix`. `from` links the question it resolved —
**convert an answered question into a decision** with `from` on each review pass.

**Comment + highlight** — a Google-Docs thread anchored to a span. You may author these to flag
things for the user. **Either of you can reply; resolving is the user's role** — you reply and can
*suggest* resolving, but never set a thread to `resolved` yourself.
```
…prose with a <user-highlight comment="c1">highlighted span</user-highlight> in it…

<comment id="c1" status="open" kind="clarify">   <!-- kind: error|clarify|question|nit -->
  <note by="agent" at="2026-06-27T10:00">Your note.</note>
</comment>
```
An **empty** `<user-highlight comment="cN"></user-highlight>` (no inner text) is a **◆ target**: an
anchor for a whole structured element (decision/finding/check/question) or any phrase a span can't
pin to one occurrence. The viewer adds these via each element's ◆ affordance and as a fallback when
a prose span would be ambiguous; author one to attach a comment to an element. In the viewer the
user can edit their own notes and **delete** a thread (removes the `<comment>` + its anchor) as an
alternative to resolving it.

**Finding** — an audit/review item; renders as a filterable severity matrix.
```
<finding id="F-1" title="Issue summary" severity="p1" status="open" effort="small">
What's wrong, why, suggested fix (markdown, may contain code refs).
</finding>
```
`severity`: `p0`–`p3`. `status`: `open|fixed|wontfix|deferred|partial`.

**Check** — a checkable task item the user (or you) can tick off in the viewer; the click flips
`status` and saves back to the file. Use for tutorials, test scripts, acceptance/QA checklists — any
"tick as you go" list. Each is id-addressed (don't reuse a plain GFM `- [ ]` for a *persisted*
checklist — those render read-only). Consecutive checks render as one tight checklist; `done` shows
struck-through.
```
**✅ Expect**
<check id="k1" status="todo">A welcome modal opens with the **graph name** as its heading.</check>
<check id="k2" status="todo">The `Start Exploring` button is visible.</check>
```
`status`: `todo` | `done` (omit ⇒ `todo`). The label is inline markdown (code refs, `code`, bold).

### Authoring rules
- Stable, unique ids; never renumber; never delete resolved/superseded items (they collapse).
- On a review pass, read every `<answer>` and open `<comment>`; update the plan; convert answered
  questions to decisions; **reply** to comments (leave *resolving* to the user) — **never silently
  drop the user's feedback.**
- Inside fenced code blocks, tags are literal text and are NOT parsed — fine to quote tags there.

## Lint before you launch

Validate that a plan will render correctly (balanced tags, unique ids, anchors resolve, no tags
parsed inside code fences):
```bash
cd ~/.claude/skills/interactive-plan/app && bun run lint:plan <abs-path-to-plan.md>
```
Fix any errors it reports before launching.

## Open the viewer

**One shared daemon serves every plan** (keyed by `?plan=<abs path>`), so you never spawn a second
server. Open a plan with:

```bash
node ~/.claude/skills/interactive-plan/app/server.mjs <abs-path-to-plan.md> [--no-open]
```
- First run installs deps + builds the viewer (~a minute); afterwards it's instant.
- If the daemon isn't running it starts one (kernel-assigned localhost port, recorded at
  `/tmp/interactive-plan-viewer.json`); if it's already running it just registers the new plan and
  prints its URL — same server, no duplicates.
- Pass `--no-open` to skip auto-opening the default browser (use this when you'll drive a controlled
  browser via MCP, then navigate to the printed `http://localhost:<port>/?plan=…` URL).
- The viewer **live-reloads** when you rewrite the plan and **warns on conflicts** if both you and
  the user edited it. Code refs (`file.ts:123`) open in the user's editor (default Zed; configurable
  in `~/.claude/skills/interactive-plan/config.json`).

### Open from Zed (keybinding + command palette)
The user can open the focused `.md` in the viewer from Zed without an extension: a Zed
**task** runs `server.mjs $ZED_FILE` (idempotent — reuses the shared daemon, never spawns a
duplicate), bound to a key and surfaced in the command palette. Zed has no webview/custom-UI
extension API, so the viewer can't render *inside* an editor tab and there's no right-click
menu item — keybinding + palette is the supported surface. Setup + copy-paste example configs:
[`docs/zed-integration.md`](docs/zed-integration.md).

## Export a PDF to share

When the plan needs to go to people who won't open the viewer — a summary for colleagues, a
decision record for a review — export it. **In the viewer** there's a **PDF** button in the
header, beside the filename; it renders and downloads `<plan>.pdf`. From the CLI:

```bash
cd ~/.claude/skills/interactive-plan/app && bun run pdf <abs-path-to-plan.md> [out.pdf]
```

The button calls `GET /api/pdf?plan=<abs>[&no-comments=1&no-questions=1&no-checks=1]`, which
runs the same renderer and streams the result back as a download. It needs `bun` on `PATH`
(already true if you lint or test this app) and says so plainly if it's missing.

This does **not** print the viewer. The viewer is built for interaction and has no print
stylesheet, so printing it yields a mess. `bun run pdf` renders the same parsed plan through a
print-first presentation (`app/src/print.ts`): the preamble becomes a header card, decisions and
findings become callouts with their status/severity badges, checklists keep their tick state, and
an answered question collapses to **just the chosen option** — a settled question shouldn't read
as an open menu.

Flags, for trimming a working document into something shareable:
- `--no-questions` — drop *unanswered* questions (answered ones stay, as decisions-in-progress)
- `--no-comments` — drop comment threads
- `--no-checks` — drop checklists
- `--html` — emit the styled HTML instead of a PDF (useful to tweak CSS, or to print by hand)

Needs a headless browser; it tries chromium, Brave, Edge, then Chrome, and if none is present it
writes the HTML and tells the user to print it. **Prefer chromium**: Chrome's
`--headless=new --print-to-pdf` hangs indefinitely on some macOS builds where chromium renders the
same page in seconds (`brew install --cask chromium`).

Two things to know if you touch `pdf.ts`: the browser's output must go to `/dev/null` rather than
be captured (it writes enough to stderr to fill a pipe, and nothing drains it until exit, which
deadlocks the render), and it may write the PDF correctly yet never exit — so the CLI polls until
the file stops growing and then kills it, instead of waiting on exit.

**Always look at the result** — `Read` the generated `.pdf` (the Read tool renders PDF pages, and
needs no extra Bash allowance). Layout bugs here are invisible in the HTML and obvious in the
render: a wrapped header line spilling out of its card, markdown showing up as literal
`**asterisks**`, a callout stranded on its own page.

### What the export covers

All six tags render, plus the preamble, tables, and code blocks:

| construct | in the PDF |
|---|---|
| preamble | header card |
| `<decision>` | callout with status badge, date, `from`/`supersedes` |
| `<finding>` | callout with severity badge, status, effort |
| `<check>` | checklist, consecutive checks grouped, `done` struck through |
| `<open-question>` | open → question + options; answered → question + **only the chosen option** + the answer |
| `<comment>` | thread, with its `<user-highlight>` anchor kept visible so a remark has a referent |
| `<user-highlight>` | highlighted span; dropped entirely under `--no-comments`, since there is then nothing to point at |

Three deliberate differences from the viewer, so nobody reports them as bugs:
- **Findings keep source order** rather than being severity-sorted like the viewer's matrix —
  reordering a document's content under the reader would be worse than a mismatched sort.
- **Code refs** (`file.ts:12`) print as code text, not editor links; **inter-plan links** stay
  relative rather than being rewritten to `?plan=…`, since neither target works from a PDF.
- **Resolved comments print inline** instead of collapsing behind a "Show N resolved" toggle.

Two fields are treated as **untrusted** and escaped + link-scrubbed, matching the viewer:
freeform answer text and comment notes. Everything else is plan prose, so intentional inline
HTML in a plan still renders.

### Manage the daemon
```bash
node ~/.claude/skills/interactive-plan/app/server.mjs --status   # JSON: running?, port, pid, open plans
node ~/.claude/skills/interactive-plan/app/server.mjs --stop     # stop the daemon, remove the pidfile
```
There is at most one daemon and it stays alive across sessions — tell the user so it doesn't read as
a leak. Run `--status` if you've lost the port (or `curl -s http://localhost:<port>/api/status`), and
`--stop` to spin it down when the user asks (it removes the `/tmp` pidfile).

## The loop

1. Author/update the plan in this format → 2. lint → 3. launch the viewer → 4. the user answers
questions, picks options, and comments (saved back into the same `.md`) → 5. they tell you to
"review my feedback on plan X" → you read the answers + open comments, revise, convert answered
questions to decisions, and **reply** to comments (the user resolves them) → 6. repeat until the
plan is ready to implement.

Review in **batches, when the user asks** — not by watching the file live. Don't edit the plan while
the user is actively reviewing it in the viewer: concurrent writes from both sides race against each
other. Wait until they hand the pass back to you.
