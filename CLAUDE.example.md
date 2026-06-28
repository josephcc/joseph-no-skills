# Example CLAUDE.md — wiring these skills into a repo

Copy the relevant parts of this into your repo's `CLAUDE.md`. These are the conventions the two
skills assume, distilled from a real project's `CLAUDE.md`. Replace the placeholders (lint/test
commands, paths) with your project's actuals.

---

## Planning workflow

- On-going tasks and TODOs live under `plan/main.md`, which references more detailed plans for
  broad goals under the `plan/` directory.
- **Always author and update plans in the `interactive-plan` tagged-markdown format** (see that
  skill's `SPEC.md`). Whenever you're about to write or substantially revise a plan / spec /
  design doc at my request: load the `interactive-plan` skill so you have the syntax, author in
  it, and launch the viewer at the end so I can review.
- When I say "review my feedback on plan X", re-read the answers and open comments in that file,
  revise the plan, convert answered questions into decisions, resolve/reply to comments — and
  never silently drop my feedback.

## Verification discipline

- **Use test-driven development** when building new features or refactoring: write the failing
  test first, then make it pass.
- After changing code, **run the project's lint + tests** before calling the work done. For this
  repo:
  - `<your test command>`        <!-- e.g. uv run pytest / bun run test -->
  - `<your lint command>`        <!-- e.g. ruff check . / bun run lint -->
  - `<your typecheck command>`   <!-- e.g. mypy src / bunx tsc -b -->
- Define success criteria up front and verify outcomes. For multi-step work, use a concise
  checkable plan: `1. [step] -> verify: [check]`.

(The `codex-audit` and `interactive-plan` skills deliberately defer "how do I verify" to this
section rather than hard-coding commands.)

## End-of-task code review

- At the end of a substantive change, run the `codex-audit` skill for an independent external
  review (it has Codex audit the diff, then triages the findings with judgment — verifying each
  against the code, rejecting false positives, fixing what's real).
- `codex-audit` auto-triggers after a major change **only in repos that opt in** — add an empty
  `.codex-audit-enabled` file at the repo root to enable it here. Otherwise invoke it explicitly.

## Execution guidelines

- **Think before coding.** State assumptions; if multiple interpretations exist, surface them; if
  a simpler approach exists, say so; if something's unclear, ask.
- **Simplicity first.** Minimum code that solves the problem — nothing speculative.
- **Surgical changes.** Touch only what you must; match existing style; every changed line should
  trace to the request.
- Prefer `bun`/`bunx` over `npm`/`npx` (the `interactive-plan` viewer uses Bun).
