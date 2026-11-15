# codex-audit: where it came from

**Created:** 2026-06-27, in the same initial commit as interactive-plan (`4d13f40`). It has never had a commit of its own since.
**Transcript:** not on disk, for the same reason given in `interactive-plan/plans/origin.md`: the session predates the repo rename on 2026-06-29 and no June transcript mentioning the skill survives.
**Plan:** none. `SKILL.md` is the only record of the brief.

## What can be reconstructed

- The interactive-plan plan (`interactive-plan/examples/interactive-plan-skill.plan.md`) ends with a "Codex audit — 2026-06-27" section and "Codex follow-up rounds — 2026-06-27". That is the loop the skill codifies: run the OpenAI Codex CLI over the diff, triage each finding against the actual code, fix what is real, record the dispositions in the plan file.
- The earliest surviving transcript that uses it is from the s2-table-annotations repo on 2026-07-04 (`~/.claude/projects/-Users-josephc-git-s2-table-annotations/83a3ac5b-c7de-4b5e-9180-85d9b5b1e78f.jsonl`), where the instruction was: "sure, remember to double check everything yourself and with codex again at the end, you have up to 5 call budget". The call budget phrasing recurs in every later session that invokes the skill.
- The opt-in marker `.codex-audit-enabled` and the rule that the triage stays in the main thread rather than a subagent are both stated in `SKILL.md` and have not changed since the initial commit.
