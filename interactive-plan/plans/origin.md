# interactive-plan: where it came from

**Created:** 2026-06-27. Initial commit `4d13f40` ("Initial commit: interactive-plan and codex-audit skills") landed the viewer, `SPEC.md`, `SKILL.md`, and the plan below in one go.
**Transcript:** not on disk. No Claude Code session transcript from before 2026-06-18 exists under `~/.claude/projects/`, and none from June mentions this skill. The repo was renamed from `josephcc-skills` to `joseph-no-skills` on 2026-06-29 (commit `f66bf7a`), so the session was most likely recorded under a project folder named for the old path, which is gone.
**Plan:** `examples/interactive-plan-skill.plan.md`, dated 2026-06-27. It is the original plan, kept as the viewer's live test fixture, and it is the only record of the brief.

## What the plan records

Its goal section, written by the agent from the conversation on 2026-06-27:

> Joseph plans large, complex features by iterating with a Claude agent for 2–3 hours to produce a **detailed spec + implementation plan** *before* touching code. The plan files track **open questions**, **decisions already made**, code pointers (`file.ts:123`), and code/pseudocode blocks. Open questions and prior decisions are the most important constructs — they are the backbone of the workflow.
>
> The problem: **reading and editing these in raw markdown is tiring.** This skill renders a plan as a clean, modern, interactive web page where Joseph can read it, **make decisions, pick options, and comment Google-Docs-style on any span** — then hand it back to the agent to revise, in a loop, until the plan is good enough to implement.

It names a second fixture that was to be converted, `plan/data-pipeline/editable_base_graph_and_canvas_migration.md`, which places the originating work in the science-kg repo.

The seventeen decisions it locked, in order:

1. D1 Single .md file is the source of truth (no sidecar)
2. D2 Viewer is Vite + React + a tiny Node file-API
3. D3 v1 tag set is five tags, including `<finding>`
4. D4 Author new plans tagged; convert existing plans on demand
5. D5 Inline `<user-highlight comment=...>` anchors, not text offsets
6. D6 Comments are Google-Docs-style threads, resolvable by either party
7. D7 Options carry rich markdown; viewer always adds Other + freeform
8. D8 Decisions render table-compact and are lifecycle-linked to questions
9. D9 Findings use a p0–p3 severity scale and render as a filterable matrix
10. D10 v1 highlights stay within a single block
11. D11 Skill is named interactive-plan
12. D12 Review hand-back is manual; viewer live-watches the file and warns on conflict
13. D13 Code refs open in Zed via the file-API; editor command configurable + globally persisted
14. D14 Viewer uses the Asta design system
15. D15 Ship a format linter the main agent can run
16. D16 Agent learns the format via SKILL.md cheatsheet + SPEC.md
17. D17 Always author plans in this format; auto-trigger the skill on plan authoring

The plan ends with a build and review log from the same day: an internal multi-agent review, a Codex audit, and Codex follow-up rounds. That is the first recorded use of what became the codex-audit skill.

## Sessions that extended it, with transcripts

- **2026-08-01**, `~/.claude/projects/-Users-josephc-git-joseph-no-skills/25f98ef3-0427-4549-a938-9849608a8bb6.jsonl`: commits for the PDF export (`e388194` through `98a6fc6`). The export itself was built elsewhere; this session only committed.
- **2026-08-13**, `84cfbaa3-a053-48e2-beec-c5515fb61ae2.jsonl`. Opening prompt: "our interactive plan skill has an export to pdf feature, it also has a user comment feature. I think the PDF format does support comments natively, but right now we just append the user comment at the end of the doc." Commit `021595a`.
- **2026-09-02**, inside the thematic-analysis session: the shared selected state for a highlight and its comment card. Commit `2d7420f`.
- **2026-10-03**, `0ba3d1e1-39f5-457f-b37b-eec5cebee222.jsonl`: figures from the plan's repo, a review PDF with every option, the brief kept verbatim. Commit `8e74dfb`.
- **2026-10-10**, `08bfa5c5-a8f2-41e3-bee2-b3901c297c0a.jsonl`. Opening prompt: "Let's make that interactive-plan skill mobile friendly". Commit `29edbeb`.
- **2026-10-15 to 2026-10-17**, `d354e5cb-9856-4165-b7bf-8abd1927dcd9.jsonl`. Opening prompt: "the pdf export feature is broken with images". Commit `724ccc7`.
