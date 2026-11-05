# Shared by the plugin's hook scripts. Sourced, not executed.
WEBMCP_PORT="${WEBMCP_DAEMON_PORT:-8717}"
WEBMCP_URL="http://127.0.0.1:${WEBMCP_PORT}"
WEBMCP_DATA="${CLAUDE_PLUGIN_DATA:-$HOME/.webmcp-daemon}"
WEBMCP_STATE="${WEBMCP_DAEMON_STATE:-$WEBMCP_DATA/state}"
webmcp_healthy() { curl -sf --max-time 1 "$WEBMCP_URL/health" >/dev/null 2>&1; }
