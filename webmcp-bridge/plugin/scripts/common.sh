# Shared by the plugin's hook scripts. Sourced, not executed.
# One well-known state directory shared by the daemon CLI, this plugin, the login item and the webmcp-bridge menu bar app.
WEBMCP_STATE="${WEBMCP_DAEMON_STATE:-$HOME/.webmcp-daemon}"
WEBMCP_DATA="$WEBMCP_STATE"
# The ports the daemon tries in order (packages/connector/src/protocol.ts CANDIDATE_PORTS; keep in step).
WEBMCP_CANDIDATE_PORTS="${WEBMCP_CANDIDATE_PORTS:-8717 49217 52431 55893 61307}"
# Is the daemon on this port? Only GET /id is ours to read; anything else on the port is a stranger.
webmcp_is_daemon() { curl -sf --max-time 1 "http://127.0.0.1:$1/id" 2>/dev/null | grep -q '"daemon":"webmcp-daemon"'; }
# The daemon's port (plans/daemon-port-discovery D-3, D-7): pinned by WEBMCP_DAEMON_PORT; else the record the
# daemon wrote in the state directory, if that port answers; else the first candidate that answers; else nothing.
webmcp_resolve_port() {
  if [ -n "${WEBMCP_DAEMON_PORT:-}" ]; then echo "$WEBMCP_DAEMON_PORT"; return 0; fi
  local rec="$WEBMCP_STATE/daemon.json" p
  if [ -f "$rec" ]; then
    p="$(sed -n 's/.*"port":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$rec" | head -1)"
    if [ -n "$p" ] && webmcp_is_daemon "$p"; then echo "$p"; return 0; fi
  fi
  for p in $WEBMCP_CANDIDATE_PORTS; do
    if webmcp_is_daemon "$p"; then echo "$p"; return 0; fi
  done
  return 1
}
WEBMCP_PORT="$(webmcp_resolve_port || true)"
# Empty when no daemon identified itself: a hook must then read nothing, not whatever sits on 8717.
WEBMCP_URL="${WEBMCP_PORT:+http://127.0.0.1:$WEBMCP_PORT}"
webmcp_healthy() { [ -n "$WEBMCP_PORT" ] && curl -sf --max-time 1 "$WEBMCP_URL/health" >/dev/null 2>&1; }
