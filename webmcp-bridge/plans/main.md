
# Goal

This is an exploration project, the goal is to connect web applications with a local Claude code using a combination of - The WebMCP protocol, a custom chrome extension, and local Claude.

The idea is that the website will implement tools and context management using the WebMCP protocol. This protocol is originally designed so that in-browser LLM agents can interact with the webpage, via tools that are executed within the browser. For example, pushing a button on the webpage for the user.

We do not care about in-browser LLM agents, we want a local claude (or other coding agents) to be interacting with this webpage that lives inside the browser.

The trick we are trying to explore is a custom google chrome extension, that [A] discover the tools and context implemented via the WebMCP protocol, and [B] start its own MCP server on a local port in which a coding agent in a terminal can connect to to 'see' and 'operate' the webpage inside the browser.

An example of an interactive webpage would be the science-kg project (/Users/josephc/git/s2/science-kg/causal-graph-viewer). 


# Exploration stages

Below are tentative plans, I'm doing the best I can without knowing all the technical details. Your job is to investigate if these are feasible, and document trade-offs, and hacks that are required to make them feasible. Or tell me it is infeasible.

## Stage 1
- Study the WebMCP protocol, and figure out whether a chrome extension can discover them.
- Figure out whether a chrome extension can start a local mcp server that allows Claude code to connect to it.
- A proof-of-concept implementation where claude can see a context from a webmcp website (e.g., the current random color of the background and a sentence), and change the website via webmcp (e.g., change the background color and text)
- Architecture: Website - WebMCP - chrome extension - MCP - local claude code

## Stage 2
- Study ACP (agent context protocol), can we embed claude code chat **inside** the website? 
- Architecture: Website - chrome extension - ACP - local claude code

# Plan index

- **science-kg adoption (2026-11-05):** the plans live in science-kg (`plan/webmcp-bridge/stage1-webmcp-tools.md`, `stage2-local-claude.md`, branch `webmcp-bridge`); the handoff is [handoffs/2026-11-05-science-kg-webmcp-bridge.md](handoffs/2026-11-05-science-kg-webmcp-bridge.md). Generic connector changes made for it: React peer `>=18`; 0.0.4 adds `renderHeader` / `renderMessage` / `renderToolCall` / `renderEmpty` / `renderComposer`, `threadFilter`, `sessionStorageKey`, `footer`, and ACP config options (`configOptions` on the snapshot, `handle.setConfigOption`).

- [**In-chat widgets: page-provided cards for tool calls in the embedded chat, and a floating widget panel for terminal Claude**](in-chat-widgets/main.md) — review this one: how science-kg renders proposal cards, suggestion chips and evidence cards from tool calls, and the design for the same in `<AgentChat>` (widget contract, four interaction patterns, activity notes, blocking tools, elicitation forms, a floating widget panel for calls from terminal Claude) (2026-11-05: answered, implemented and verified; see its §12)
- [**Chat threads in the npm package: list, switch, auto mode by default**](threads-and-auto-mode/main.md) — review this one: one ACP connection holding many threads, thread list + switching in `<AgentChat>`, new threads start in Claude Code's auto permission mode (2026-11-05: answered, implemented and verified; see its §11)
- [**Combined plan — WebMCP ⇄ local daemon ⇄ Claude Code (Stages 1 + 2)**](combined/main.md) — review this one: unified architecture, one set of questions/decisions/risks, build order, checklist (2026-11-05, rev 4: implemented and verified end to end; see its §14)
- [Stage 1 — WebMCP ⇄ Chrome extension ⇄ MCP ⇄ Claude Code](stage1-webmcp-bridge/main.md) — feasibility verdicts, architecture, open questions, work breakdown, acceptance checks (2026-11-04, superseded by the combined plan; kept as the investigation record)
- [Stage 2 — Embed a local Claude Code chat inside the website (ACP)](stage2-acp-embed/main.md) — ACP = Agent Client Protocol; verdicts, unified daemon architecture, proposed revisions to Stage 1 (2026-11-04, superseded by the combined plan; kept as the investigation record)
- Evidence: [spike 2026-11-04 — isolated world sees WebMCP tools](../spikes/2026-11-04-webmcp-isolated-world/README.md)
