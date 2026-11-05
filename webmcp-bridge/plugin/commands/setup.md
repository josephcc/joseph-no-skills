---
description: Check the webmcp-daemon and optionally register it as a login item (macOS)
---

You are helping the user set up the webmcp-daemon plugin. Do these steps in order and report plainly.

1. Run `curl -sf http://127.0.0.1:8717/health` with the Bash tool. If it answers, say the daemon is running and show the page count. If not, run `"${CLAUDE_PLUGIN_ROOT}/scripts/ensure-daemon.sh"` and check again.
2. Ask the user whether they want the daemon to start automatically at login (a macOS login item). Explain in one sentence that without it the daemon starts whenever a Claude Code session starts, and that pages opened before that wait. Do not register anything unless they say yes.
3. If they say yes, run `node "${CLAUDE_PLUGIN_ROOT}/daemon/webmcp-daemon.js" install-launchd` (the user will see a permission prompt for this command; that is the consent). The daemon, the plugin hooks and the login item all use `~/.webmcp-daemon`, so the SessionStart hook can refresh the login item after plugin updates. Then run `touch ~/.webmcp-daemon/setup-done` so the first-session setup prompt stops appearing. The same login item can be toggled from the "webmcp-bridge" menu bar item (Start at login), which the daemon shows while it runs. Tell them it can be removed with `node "${CLAUDE_PLUGIN_ROOT}/daemon/webmcp-daemon.js" uninstall-launchd`.
4. Remind them: a web page that embeds `webmcp-connector` will ask for approval in a browser tab the first time it connects; and that the page's own chat panel (in the browser) is the intended place to talk to Claude about that page, while this terminal session is only needed for setup and can be closed.
