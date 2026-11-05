**Status:** implemented 2026-11-05 — reviewed by Joseph 19:31 (D-1–D-5 locked); R1–R2 in `2d74e8b`, R3 in `bcbfe17`; the README is the deliverable
**Date:** 2026-11-05
**Scope:** Rewrite `README.md` for three audiences (end users, web developers building on the library, contributors to this repo), with screenshots of the demo app and figures of the architecture. Not in scope: new features, the plugin's own docs (`plugin/commands/setup.md`), science-kg's README.
**Inputs:** the current `README.md` (146 lines), `demo-site/src/{main,chat,widgets,state}.ts*`, `packages/connector/src/{index,types,react/index,react/widgets}.ts*`, `plugin/`, `plans/combined/main.md` §5 (the architecture), `plans/in-chat-widgets/main.md` §4 (the widget contract), `plans/daemon-port-discovery/main.md`

# The README for three audiences

## 0. Brief (verbatim)

From Joseph, in chat, 2026-11-05:

> ok now let's improve the readme in this repo, we have multiple audiances,
>
> - from is the end-user user's perspective, what is the users' experience using this? from installing the daemon, to playing with the demo website, include screenshots from the demo app, include both embeded chat (primary) and terminal claude
> - from a website builder's perspective, how do you install and import the library, how do you register your skills and system prompts and in-chat widgets
> - from someone who wants to improve this repo, describe the high-level architecture, include figures to explain how things communicate with each other

## 1. Summary

One `README.md`, three parts in the order a reader meets the project: **Using it** (install the plugin, run `claude` once, open the demo, chat with the page in the browser, watch terminal Claude's cards land on the page), **Building a site on it** (install and import the library, `connect()` with your instructions and context, register tools, mount the chat, write cards, restyle), and **How it works** (the components, who talks to whom and over what, the port discovery and the single daemon, the layout, how to develop and test). The reference prose the README has today (threads, permission mode, widgets, render props, ports, the menu bar item, privacy, layout, development) is kept and moved under the part it belongs to, so nothing documented is lost. Screenshots are real captures of the demo app, taken by a committed script so they can be regenerated; the figures are Mermaid, which GitHub renders.

## 2. What exists today

- `README.md`: a title paragraph, **Try it (this checkout)**, **For web developers** (connect, tools, the React chat, threads, permission mode, widgets, render props, the floating panel), **The menu bar item** with the ports paragraph, **For Claude Code users** (the two plugin commands and what the first `claude` does), **Privacy**, **Layout**, **Development**. Dense, developer-first, no images.
- The demo (`demo-site/`): a sentence on a coloured background; tools `get_state`, `set_background_color`, `set_sentence`, `shout`, `randomize`, `propose_palette`, `suggest_replies`, `show_output`; cards for the palette proposal, the reply chips and the output box (`widgets.tsx`); the embedded chat (`chat.tsx`: `<AgentChat page widgets setup>`) and the floating panel for terminal Claude's calls; `?daemon=` and `?ports=` for tests.
- The plugin (`plugin/`): `.mcp.json` (the stdio relay), the hooks (ensure the daemon, inject the page's instructions and state), the `setup` command, the `webmcp` skill, the daemon and relay bundles and the menu bar helper.
- No `docs/` directory and no images in the repo.

## 3. Design

### 3.1 Structure

```
# webmcp-bridge — your local Claude Code, inside the web page you are looking at
<one paragraph: what it is, the two ways in (browser chat, terminal), what runs where>
<hero screenshot: the demo page with the embedded chat open, a palette card and reply chips>

## Using it
### Install (two slash commands; what the first `claude` does; the menu bar item; start at login)
### The demo page (how to run it; the approval tab the first time)
### Chat with the page in the browser   ← primary
  <screenshot: a turn with a card the user acts on>
  threads, the permission mode, what Claude sees (context + instructions), what the page sees (activity notes)
### Terminal Claude on the same page
  <rendered transcript: `claude` with the page's tools; a call lands as a card bottom-right>
  <screenshot: the floating card>
### Where things live, how to stop it, privacy (short; links PRIVACY.md)

## Building a site on it
### Install and import (the package is unpublished: git dependency or vendor the built package; React ≥ 18 for the chat)
### Connect the page: instructions (`preamble` + your prompt), `instructionsSummary`, `context()`, `toolPolicy`, `autoConnect`
### Register tools on `document.modelContext` (schema, annotations, errors; what terminal Claude and the chat each see)
### Mount the chat (`<AgentChat page … />`, setup steps, threads, `sessionStorageKey`, the model picker)
### Cards: the widget contract (`WidgetMap`, `WidgetProps`: input/output/status/restored/live/state/setState/prompt/note), placement and latestOnly, the floating panel, what the preamble tells Claude about cards
### Your own look: render props and the CSS variables; the specificity rule
### A worked example: science-kg (one paragraph, no screenshots)

## How it works
### The pieces (figure 1: page + connector · daemon · terminal Claude via the plugin · the embedded chat via the ACP adapter)
### Who talks to whom (figure 2: a page connecting and a terminal tool call; figure 3: an embedded-chat prompt from the composer to a card)
### Finding the daemon, and only one of it (figure 4: the candidate ports, `/id`, `daemon.json`)
### Layout, development, tests and e2e, the plans directory as the design record

## Privacy (kept)
```

### 3.2 Screenshots

Taken by `scripts/docs/screenshots.mjs` (CDP, as the e2e scripts do): a throwaway Chrome at 1280×800 on the demo served by this checkout, against a private daemon started by the script on a free port (`--ports`, `--allow-origin`, `--no-tray`) with the real Claude adapter, so the chat shows a genuine reply. The script sends the prompts, waits for the cards, and saves PNGs under `docs/img/`. Three images: the hero (chat open, the page behind it), the chat turn with the palette card and the reply chips, the floating card after a `/call` from outside the chat (what terminal Claude's call looks like). Cost: two or three real turns, a few cents. Light theme, the daemon badge visible.

### 3.3 Terminal Claude

A screenshot of a terminal is a capture of a window, which the script cannot take honestly; a session with the installed plugin also goes through the old daemon on 8717, which the new demo page cannot pair with. The proposal: run `claude -p` with the plugin against the page once, keep the transcript, and show it as a fenced block styled as a terminal in the README (plain markdown, no image), labelled as a real session's output. Joseph can replace it with a screenshot of his own terminal later ([Q-2](#Q-2)).

### 3.4 Figures

Mermaid: GitHub renders it, it diffs as text, and the plans already use it. Four figures: components, two sequences, port discovery. Node labels name the real endpoints (`/ws`, `/mcp`, `/mcp/by-page/<id>`, `/acp`, `/call`, `/id`) and the real processes (`webmcp-daemon`, `webmcp-mcp`, `claude-agent-acp`).

## 4. Open questions (each resolved below by a proposed decision)

<open-question id="Q-1" title="Figures" status="answered">


<options select="single">
  <option id="mermaid">Mermaid blocks in the README. Rendered by GitHub, text in git, editable without a tool. (Recommended.)
  </option>
  <option id="svg">SVGs drawn once and committed under `docs/img/`. Prettier, but binary-ish assets to redo on every change.
  </option>
</options>

<answer by="user" at="2026-11-05T19:31" chose="mermaid">

</answer>
</open-question>

<open-question id="Q-2" title="Terminal Claude" status="answered">


<options select="single">
  <option id="transcript-block">A real `claude -p` session's transcript as a fenced, terminal-styled block, labelled as such; Joseph may swap in a screenshot of his own terminal. (Recommended.)
  </option>
  <option id="joseph-screenshot">Joseph takes the terminal screenshot now; the README waits for it.
  </option>
  <option id="rendered-image">Render the transcript into a terminal-looking HTML page and screenshot that. Looks like a terminal, is not one.
  </option>
</options>

<answer by="user" at="2026-11-05T19:30" chose="transcript-block">

</answer>
</open-question>

<open-question id="Q-3" title="Screenshot source" status="answered">


<options select="single">
  <option id="script-real-claude">A committed script drives the demo against a private daemon with the real Claude adapter and saves the PNGs; regenerable; costs a few cents per run. (Recommended.)
  </option>
  <option id="script-echo">The same script with the echo agent: free, but the reply reads "echo: …".
  </option>
  <option id="manual">Joseph takes them by hand.
  </option>
</options>

<answer by="user" at="2026-11-05T19:30" chose="script-real-claude">

</answer>
</open-question>

<open-question id="Q-4" title="One file or several" status="answered">


<options select="single">
  <option id="one-readme">One README with the three parts; the current reference prose folded under the part it belongs to. (Recommended.)
  </option>
  <option id="readme-plus-docs">A short README that links three pages under `docs/`. Cleaner for very long docs; harder to skim.
  </option>
</options>

<answer by="user" at="2026-11-05T19:31" chose="one-readme">

</answer>
</open-question>

<open-question id="Q-5" title="Install story for builders" status="answered">
The package is unpublished and the repo is private.

<options select="single">
  <option id="git-or-vendor">Document both: a git dependency on this repo (`"webmcp-connector": "github:josephcc/webmcp-bridge#path:/packages/connector"` is not how bun resolves subpaths, so the honest instruction is: clone, `bun run build:connector`, and depend on the built package by path or vendor it, which is what science-kg does with a refresh script). (Recommended.)
  </option>
  <option id="publish-first">Publish `webmcp-connector` to npm first and document `bun add webmcp-connector`. Out of this plan's scope.
  </option>
</options>

<answer by="user" at="2026-11-05T19:31" chose="publish-first">
Document as published, but don't setup the publication now, do note it in the README that its not published yet
</answer>
</open-question>

## 5. Decisions (locked 2026-11-05 from Joseph's answers)

<decision id="D-1" title="Mermaid figures" status="superseded" date="2026-11-05" from="Q-1">
Four Mermaid figures in the README: components, the page-connects-and-terminal-calls sequence, the embedded-chat sequence, port discovery.
<rationale>Rendered by GitHub and kept as text.</rationale>
</decision>

<decision id="D-2" title="Terminal Claude as a labelled transcript block" status="locked" date="2026-11-05" from="Q-2">
A fenced block from a real `claude -p` session, labelled; a screenshot slot Joseph can fill.
<rationale>No fabricated terminal images; the script cannot capture a real terminal window.</rationale>
</decision>

<decision id="D-3" title="Screenshots by a committed script against the real adapter" status="locked" date="2026-11-05" from="Q-3">
`scripts/docs/screenshots.mjs`, PNGs under `docs/img/`, three images, 1280×800.
<rationale>Regenerable after UI changes; real replies.</rationale>
</decision>

<decision id="D-4" title="One README, three parts, nothing dropped" status="locked" date="2026-11-05" from="Q-4">
The existing reference prose moves under the part it belongs to; `PRIVACY.md` stays and is linked.
</decision>

<decision id="D-5" title="Builders install as if published, with a note that it is not yet" status="locked" date="2026-11-05" from="Q-5">
The README documents `bun add webmcp-connector` (and the `webmcp-connector/react` import) as the install, and says in the same breath that the package is not published yet, with the interim route: clone this repo, `bun run build:connector`, and depend on `packages/connector` by path or vendor the built package (science-kg's `scripts/vendor-webmcp-connector.sh` is the pattern). Publishing itself is not set up in this plan.
<rationale>Joseph, 2026-11-05: "Document as published, but don't setup the publication now, do note it in the README that its not published yet."</rationale>
</decision>

<decision id="D-6" title="Our own SVG figures, laid out by a script, instead of Mermaid" status="locked" date="2026-11-05" from="Q-1">
`scripts/docs/figures.mjs` writes `docs/img/fig-pieces.svg`, `fig-terminal-call.svg`, `fig-chat-card.svg`, `fig-ports.svg`: boxes, arrows and labels with explicit coordinates on a 1200-wide canvas, large type, the daemon's endpoints level with what they talk to. Supersedes D-1.
<rationale>Joseph, after seeing the Mermaid renders: "tiny dense and hard to read … can we roll our own, especially the first plot." Mermaid's auto-layout packs the components figure into small boxes; hand-laid SVG keeps the type readable at README width and stays text in git.</rationale>
</decision>

<decision id="D-7" title="Figure 1: one Local Claude Code box, solid lines, /ws joined to /mcp, a numbered caption" status="locked" date="2026-11-05">
The components figure shows one "Local Claude Code" box (your login, your skills, your plugins) holding the terminal session and the chat's agent; the agent's path to `/mcp` is a plain solid arrow; `/ws` and `/mcp` are joined inside the daemon ("the same tools, mirrored"), so the browser tab visibly reaches `/mcp`; arrows ①–⑤ are explained in a caption under the figure that walks through how the embedded chat works.
<rationale>Joseph, on the first render: "the first figure does not explain how embedded chat works, there's also two blocks of claude code on the right, technically this isnt wrong, but maybe we can have a parent block that says 'Local Claude Code'", then "we dont need the mcp scoped to this page, and the dash line, jsut the same solid line is fine, also why is mcp not connected to the browser tab, that's confusing".</rationale>
</decision>

<decision id="D-8" title="Figure 3: three lanes; the page lane holds the chat panel and the page's tools" status="locked" date="2026-11-05">
The chat-to-card figure uses the same three lanes as the terminal figure (page, daemon, agent); the tool runs in the page lane, since it runs in the same page the panel is in; arrows that cross the daemon lane carry a label naming the endpoints that relay them.
<rationale>Joseph: "why do we need a page tools column, just use the AgentChat / Page first column".</rationale>
</decision>

## 6. Findings and risks

<finding id="F-1" title="Screenshots go stale" severity="p3" status="open" effort="small">
Any UI change dates the images; the script makes regeneration one command, and the README says which commit they came from.
</finding>

<finding id="F-2" title="The repo is private, so README links to it are for people with access" severity="p3" status="open" effort="none">
True today; nothing to do until the repo is public or the package published.
</finding>

## 7. Work breakdown (one commit per step)

1. **R1** — the screenshot script and the three PNGs.
2. **R2** — the terminal transcript (one `claude -p` run against the demo page).
3. **R3** — the README rewrite with the figures.
4. **R4** — plan index and status.

## 8. Acceptance checklist

<check id="c1" status="done">The three PNGs exist under `docs/img/`, are referenced from the README, and were produced by the committed script. — evidence: after Joseph's review of the first set (7e8ae86): four images, one job each — `demo-chat-skill.png` (hero: the chat running the s2-paper-search skill and setting the title; Joseph's own turn in the kept window, captured by CDP), `demo-hero.png` (the cards example), `terminal-claude.png` and `menu-bar.png` (Joseph's screenshots). The script produces the first two; the chat-column crop, the after-terminal card and the text transcript were redundant and are gone.</check>
<check id="c2" status="done">Every section of today's README has a home in the new one (threads, permission mode, widgets, render props, ports, menu bar, plugin commands, privacy, layout, development). — evidence: Try it → Using it/Install and Development; For web developers (connect, tools, the React chat, threads, permission mode, widgets, render props, the floating panel) → Building a site on it; the menu bar item → Development; ports → How it works/Finding the daemon; For Claude Code users → Install; Privacy, Layout (now a table), Development kept.</check>
<check id="c3" status="done">The four figures render on GitHub (checked in the Mermaid live editor or a GitHub preview). — evidence: superseded by D-6: the four figures are now SVGs from `scripts/docs/figures.mjs`, each rendered in Chrome and checked by eye (type 15–22 px at 1200 wide; no overlaps).</check>
<check id="c4" status="done">A web developer can follow the builder part from an empty page to a chat with one card without reading the plans. — evidence: the Building part goes install → `connect()` → `registerTool` → `<AgentChat>` → a `PaletteCard` widget with `note()`, each with a snippet; the demo's files are named for the rest.</check>
<check id="c5" status="done">The contributor part names every process and endpoint that exists in the tree and no others. — evidence: the pieces named are `webmcp-connector`, `webmcp-daemon` (`/ws`, `/mcp`, `/mcp/by-page/<id>`, `/acp`, `/id`), the plugin's `webmcp-mcp` relay, `claude-agent-acp`; the MCP tool names are the daemon's five; nothing else is claimed.</check>

## 9. Status

Done: the README has the three parts, four screenshots (two by the script, two by Joseph) and four hand-laid-out SVG figures (D-6, after Joseph found the Mermaid ones unreadable); the old README's every section has a home. Joseph's review dropped the redundant chat crop, the after-terminal card and the transcript block (D-2's stand-in, superseded by his terminal screenshot). Regenerate the images with `node scripts/docs/screenshots.mjs` after UI changes (a few cents).
