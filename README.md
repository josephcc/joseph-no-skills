# josephcc-skills

> Personal [Claude Code](https://claude.com/claude-code) skills, each built to kill a specific bit
> of friction in how I actually work with coding agents.

Two skills today, in a layout that lets me drop in more. Each top-level directory is one
self-contained skill; install once and Claude Code auto-loads them in any repo.

| Skill | One-liner |
|---|---|
| [**`interactive-plan`**](#-interactive-plan--read--comment-on-plans-like-a-google-doc) | Turn long planning docs into an interactive web page — answer questions, pick options, and comment Google-Docs-style; feedback round-trips into the same `.md`. |
| [**`codex-audit`**](#-codex-audit--a-second-pair-of-eyes-on-your-diff-triaged-with-judgment) | Have the OpenAI Codex CLI audit your diff, then triage its report with independent judgment — verify each finding, reject false positives, fix what's real. |

---

## 🗺️ `interactive-plan` — read & comment on plans like a Google Doc

**Why I built it.** I plan big, complex features by iterating with the agent for *hours* — sometimes
two or three — to produce an extremely detailed spec and implementation plan *before we touch any
code*. The two things that matter most in those docs are the **open questions** and the **decisions
already made**; tracking them is the single most effective way I've found to build large systems
with an agent. The problem was the medium: I was **tired of reading and editing these long plans as
raw markdown**. I wanted to *read* a plan, *make decisions*, and *comment on any line* — like a
Google Doc — then hand it back to the agent to revise, in a loop, until it's ready to implement.

So `interactive-plan` defines a tagged-markdown plan format and a local web viewer for it. The plan
stays a single `.md` file (git-diffable, readable by any agent), but the viewer renders its
`<open-question>`, `<decision>`, `<finding>`, and `<comment>` tags as interactive UI — and every
answer and comment you make **writes straight back into the same file**.

![The interactive-plan viewer rendering a plan: questions with options, a decisions stack, a findings matrix, and a comment in the margin](interactive-plan/docs/hero.png)

Pick options (every choice gets an **"Other" + free-text** escape hatch), and comment on any
highlighted span — threads you and the agent can both reply to and resolve:

![An answered question shown as a green answer card, beside a Google-Docs-style comment thread with an agent note and a user reply](interactive-plan/docs/answer-and-comment.png)

**Highlights**
- **Single `.md` source of truth** — no sidecar; the tags carry state (`status="open|locked"`, …) so both the renderer and any agent understand them.
- **Five tags**: open questions (single/multi choice + Other + freeform), decisions (lockable, with rationale), Google-Docs comments anchored to highlighted spans, and audit findings (filterable severity matrix).
- **Live round-trip**: the viewer watches the file and re-renders when the agent rewrites it, and warns on edit conflicts.
- **Clickable code refs**: `file.ts:123` opens in your editor (default [Zed](https://zed.dev), configurable), resolving shorthand paths against the repo.
- **One shared server** for all plans, keyed by `?plan=<path>` — no swarm of localhost ports.
- **Open straight from Zed**: a keybinding / command-palette task opens the focused `.md` in the viewer (reusing the shared server, never spawning a duplicate) — [setup + copy-paste configs](interactive-plan/docs/zed-integration.md).

**The loop:** agent writes/updates a plan → you open the viewer, answer & comment → it saves back
into the `.md` → "review my feedback on plan X" → agent revises → repeat until you're happy →
implement. Full format spec in [`interactive-plan/SPEC.md`](interactive-plan/SPEC.md).

---

## 🔍 `codex-audit` — a second pair of eyes on your diff, triaged with judgment

**Why I built it.** At the end of a task I always had the **OpenAI Codex CLI review my changes** and
produce an audit report — then I'd paste that report back into the same Claude Code thread and ask
it to **figure out which issues were real and worth addressing**, reminding it that the audit isn't
gospel and to use its own judgment. That back-and-forth — copying reports between two tools, warning
the agent not to trust the audit blindly — was **tedious and manual every single time**. This skill
automates the whole loop.

`codex-audit` scopes the diff, writes a focused brief, runs `codex exec review` (read-only,
sandboxed), then **triages every finding against the actual code** — verifying each claim, rejecting
false positives with evidence, fixing what's genuinely worth fixing, and presenting a disposition
table. Codex is treated as *a capable second opinion, not an authority*.

**Highlights**
- Runs Codex strictly **read-only**; all repo edits are made by Claude after triage, never by Codex.
- Every finding is **re-verified and re-rated** — no blindly applying an external tool's output.
- **Per-repo opt-in** for auto-triggering (an empty `.codex-audit-enabled` marker), since it sends repo context to an external service.
- Defers "how do I verify a fix" to your `CLAUDE.md` rather than hard-coding test commands.

> Meta note: this very repo was built with both skills — `interactive-plan` drove the spec, and
> `codex-audit` reviewed the implementation across three rounds. The audit log lives in
> [`interactive-plan/examples/interactive-plan-skill.plan.md`](interactive-plan/examples/interactive-plan-skill.plan.md).

---

## Install

```bash
git clone git@github.com:josephcc/josephcc-skills.git
cd josephcc-skills
./install.sh        # symlinks each skill into ~/.claude/skills/
```

`install.sh` is re-run safe: it replaces existing symlinks and refuses to overwrite a real
directory (so it won't clobber a skill you've edited in place). To install a subset, edit the
`SKILLS` array at the top of the script. Then run `claude` in any repo — skills load from
`~/.claude/skills/`.

**Per-skill requirements**
- `interactive-plan` — [Bun](https://bun.sh) (the viewer is a Vite/React app + a small Node daemon; first launch runs `bun install` + build automatically). Optional: an editor CLI for click-to-open refs (defaults to Zed; see `interactive-plan/config.json`).
- `codex-audit` — the [OpenAI Codex CLI](https://github.com/openai/codex) (`brew install codex`, then `codex login`) and a git repo.

## Wire the skills into a repo

These skills hook into a couple of `CLAUDE.md` conventions (where plans live, how you verify, when
to run an audit). [`CLAUDE.example.md`](CLAUDE.example.md) is a starter you can copy the relevant
parts of into your repo's `CLAUDE.md`.

## Add your own skill

1. Create a top-level `my-skill/` directory with a `SKILL.md` (copy the frontmatter + body conventions from an existing skill).
2. Add it to the `SKILLS` array in `install.sh` and a row in the table above.
3. Commit, then `./install.sh` links it into `~/.claude/skills/`.

## License

[Apache-2.0](LICENSE) © 2026 Joseph Chang
