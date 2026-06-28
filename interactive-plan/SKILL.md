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

The skill lives at `~/.claude/skills/interactive-plan/`:
- `SPEC.md` — the **full** format specification. **Read it** before authoring if you need detail
  beyond the cheatsheet below (exact attributes, round-trip rules, edge cases).
- `app/` — the Vite+React viewer + Node file-API + the linter.
- `examples/` — worked fixtures (`interactive-plan-skill.plan.md`, `demo.plan.md`).

## Authoring cheatsheet (the five tags)

Everything not in a tag is plain markdown (rendered with code-ref linkifying + highlighted code
blocks; the `**Status:** / **Date:** / ...` preamble becomes the header).

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
things for the user; the user can reply/resolve, and so can you.
```
…prose with a <user-highlight comment="c1">highlighted span</user-highlight> in it…

<comment id="c1" status="open" kind="clarify">   <!-- kind: error|clarify|question|nit -->
  <note by="agent" at="2026-06-27T10:00">Your note.</note>
</comment>
```

**Finding** — an audit/review item; renders as a filterable severity matrix.
```
<finding id="F-1" title="Issue summary" severity="p1" status="open" effort="small">
What's wrong, why, suggested fix (markdown, may contain code refs).
</finding>
```
`severity`: `p0`–`p3`. `status`: `open|fixed|wontfix|deferred|partial`.

### Authoring rules
- Stable, unique ids; never renumber; never delete resolved/superseded items (they collapse).
- On a review pass, read every `<answer>` and open `<comment>`; update the plan; convert answered
  questions to decisions; reply to / resolve comments — **never silently drop the user's feedback.**
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
questions to decisions, resolve comments → 6. repeat until the plan is ready to implement.
