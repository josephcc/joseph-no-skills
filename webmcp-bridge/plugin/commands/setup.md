---
description: Check the webmcp-daemon and optionally register it as a login item (macOS)
---

You are helping the user set up the webmcp-daemon plugin. Do these steps in order and report plainly.

1. Run `curl -sf http://127.0.0.1:8717/health` with the Bash tool. If it answers, say the daemon is running and show the page count. If not, run `"${CLAUDE_PLUGIN_ROOT}/scripts/ensure-daemon.sh"` and check again.
2. Ask the user whether they want the daemon to start automatically at login (a macOS login item). Explain in one sentence that without it the daemon starts whenever a Claude Code session starts, and that pages opened before that wait. Do not register anything unless they say yes.
3. If they say yes, run `node "${CLAUDE_PLUGIN_ROOT}/daemon/webmcp-daemon.js" install-launchd` (the user will see a permission prompt for this command; that is the consent). Tell them it can be removed with `node "${CLAUDE_PLUGIN_ROOT}/daemon/webmcp-daemon.js" uninstall-launchd`.
4. Remind them: a web page that embeds `webmcp-connector` will ask for approval in a browser tab the first time it connects.
