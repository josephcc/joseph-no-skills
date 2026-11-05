#!/usr/bin/env bash
# SessionStart hook. Emits JSON (hookSpecificOutput.additionalContext) with: a one-line notice about the browser
# chat, the connected page's instructions (summary or head + pointers), and — only until setup is finished —
# a nudge that makes Claude offer the login-item setup in this first session (plan D-29).
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/common.sh"
inject="${CLAUDE_PLUGIN_OPTION_INJECT_PAGE_CONTEXT:-true}"
instructions=""
if [ "$inject" != "false" ]; then
  instructions="$(curl -sf --max-time 3 "$WEBMCP_URL/instructions?page=selected" 2>/dev/null || true)"
fi
notice="[webmcp] The webmcp-daemon is running (pages that embed webmcp-connector connect to it). A connected page has its own chat panel in the browser; that panel is the intended place to work on the page, and this terminal session is not required for it."
setup_needed=0
if [ ! -f "$WEBMCP_STATE/setup-done" ] && [ ! -f "$HOME/Library/LaunchAgents/com.webmcp.daemon.plist" ] && ! pgrep -x webmcp-bridge >/dev/null 2>&1; then
  setup_needed=1
  notice="$notice Setup is not finished: the daemon currently stops when this computer restarts. Offer to make it start at login (/webmcp-daemon:setup) so the browser chat works without a terminal; afterwards this session can be closed."
fi
context="$notice"
if [ -n "$instructions" ]; then context="$context"$'\n\n'"$instructions"; fi
# Note: `initialUserMessage` is deliberately not used. Claude Code only honours it in -p (print) mode, where it would
# hijack scripted runs; the notice above makes an interactive Claude offer the setup instead.
node -e '
const [context] = process.argv.slice(1);
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
' "$context"
exit 0
