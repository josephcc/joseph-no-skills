---
name: interactive-plan
description: Author and review detailed spec/implementation plans in an interactive, taggable markdown format, then open a local web viewer to read, answer questions, pick options, and comment Google-Docs-style. Use this WHENEVER you are about to write or substantially update a plan / spec / design doc in the user's repo at their request — load it first so you author in the correct tagged syntax, and launch the viewer at the end so the user can review and give feedback. After you launch the viewer and share its URL, treat the user as actively reviewing: if you can watch the plan file for changes (preferred) or otherwise run work periodically, respond to their new comment threads in-file as they arrive — surgically, and without resolving the threads (resolving is the user's call).
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
"review my feedback on plan X" — **or, if you're watching (below), you pick it up live** → you read
the answers + open comments, revise, convert answered questions to decisions, and **reply** to
comments (the user resolves them) → 6. repeat until the plan is ready to implement.

## Watch the plan live while the user reviews

The comment threads are meant to be a **live back-and-forth**, not just a batch you read once when
told to. **Once you've launched the viewer and given the user its URL, assume they're actively
reviewing** — and if your harness can **watch the plan file for changes** (or, failing that, run
work on a schedule), open a **watch loop** and answer their comments as they arrive, like a
collaborator in a shared doc. Tell the user you'll be watching (so they know their comments get live
replies) before you start.

**What to look for each pass.** Re-read the file and find **open comments whose _last_ `<note>` is
`by="user"`** — that is exactly the set awaiting you, whether a brand-new thread the user opened or a
reply they added to one of yours. (A thread whose last note is `by="agent"` is waiting on the
*user* — leave it.) User notes are timestamped (`<note by="user" at="2026-06-27T10:02">…`); use the
`at` stamps to see what's arrived since your last pass. Fold in any other fresh user input on the
same pass — new `<answer>`s, reopened items.

**How to respond.**
- **Reply in-thread:** append a `<note by="agent" at="…">` to that comment (a surgical insert — see
  the next section). Answer the question, or say what you changed.
- **Update the plan** when the comment calls for it — a surgical edit to the relevant prose /
  decision / finding — and point to it from your note. The viewer live-reloads, so your reply shows
  up in the user's margin within a second.
- **Never resolve or delete a thread.** *Resolving is the user's role.* When a thread is settled,
  say so and **suggest** they resolve it ("Addressed in D4 — resolve when you're happy"); don't set
  `status="resolved"` / `resolved-by` yourself.

**Cadence & when to stop — watch, don't poll.** Be prompt but don't hammer the file, and prefer
*event-driven* watching over any timed loop:
1. **If your harness can watch a specific file / block until it changes, use that** — you wake
   exactly when the user saves, with zero wasted checks and no polling timer to tune.
2. **Otherwise, if you can run a background process,** block on the viewer's change-stream with this
   `node` one-liner (within the skill's allowed `node` tool) — it's still event-driven (it watches
   the file via the daemon) and prints `changed` the moment the user saves, or `idle` after 10
   minutes. Run it in the **background** and let it re-invoke you:
```bash
# $PLAN = absolute plan path. Arms on connect and fires only on the NEXT change,
# so re-arming right after your own edit won't loop.
node -e 'const fs=require("fs"),h=require("http");let p;try{p=JSON.parse(fs.readFileSync("/tmp/interactive-plan-viewer.json","utf8")).port}catch{console.log("no-daemon");process.exit(1)}h.get({port:p,path:"/api/events?path="+encodeURIComponent(process.argv[1])},r=>{let b="";r.on("data",d=>{b+=d;if(b.includes("event: change")){console.log("changed");process.exit(0)}})}).on("error",()=>{console.log("err");process.exit(1)});setTimeout(()=>{console.log("idle");process.exit(0)},600000)' "$PLAN"
```
On wake: if it printed `changed`, do a pass (above) and **re-arm** it; if it printed `idle`,
**pause** — tell the user you've stopped watching and will pick their feedback up whenever they ask
(or ping you) to resume. (A native file-watch from (1) is handled the same way: wake → pass →
re-watch, and pause after ~10 min idle.)

3. **Only as a last resort** — no file-watch and no background process, just a coarse periodic
   scheduler — poll: start at about **every 5s** and **back off** as nothing changes (5s → 10s → 15s
   → 30s, capped at 30s), **reset to 5s** on any new activity, and **pause after ~10 minutes idle**.

## Editing the plan while the user edits it too

**Assume you and the user are writing to the file at the same time** — they save through the viewer
(which posts the whole file and reloads if it moved under them) while you edit it from here. **You
are the side that must edit carefully and retry**; the viewer already refuses a stale save on its
end. Two rules:

1. **Surgical edits only — never rewrite the whole file.** Don't `Write` over an existing plan. Use
   `Edit` with the **smallest unique `old_string`** that pins just the region you're changing: one
   block's attribute, or — to reply — that thread's **last existing `<note>…</note>`** (unique to
   the thread) with your new `<note>` appended after it, before `</comment>`. A scoped write can't
   clobber an answer or note the user just added elsewhere.
2. **Re-read, then edit; retry on a miss.** Immediately before editing, **re-read the file** so
   you're on the user's latest state (they may have typed a note or answer since your last read). If
   an `Edit` fails because its `old_string` no longer matches, the user just changed that exact
   region — **re-read and reapply your change against the new text.** Don't force it; you're the
   retrying side.
