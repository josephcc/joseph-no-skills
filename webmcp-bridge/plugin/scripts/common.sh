# Shared by the plugin's hook scripts. Sourced, not executed.
WEBMCP_PORT="${WEBMCP_DAEMON_PORT:-8717}"
WEBMCP_URL="http://127.0.0.1:${WEBMCP_PORT}"
# One well-known state directory shared by the daemon CLI, this plugin, the login item and the webmcp-bridge menu bar app.
WEBMCP_STATE="${WEBMCP_DAEMON_STATE:-$HOME/.webmcp-daemon}"
WEBMCP_DATA="$WEBMCP_STATE"
webmcp_healthy() { curl -sf --max-time 1 "$WEBMCP_URL/health" >/dev/null 2>&1; }
