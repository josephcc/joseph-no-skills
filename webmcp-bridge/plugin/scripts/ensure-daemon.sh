#!/usr/bin/env bash
# SessionStart hook: make sure the webmcp-daemon is running. Idempotent; never installs
# anything persistent (the launchd login item is a separate, opt-in command: D-16, D-26).
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/common.sh"
# If the opt-in login item is installed (D-26), its copy of the bundles lives under $WEBMCP_STATE/bin.
# Refresh that copy when the plugin shipped a newer bundle, and restart the login item so it runs the new code.
bin_dir="$WEBMCP_STATE/bin"
if [ -f "$bin_dir/webmcp-daemon.js" ]; then
  changed=0
  for f in webmcp-daemon.js claude-agent-acp.js tray/webmcp-bridge-tray tray/webmcp-bridge-icon.png; do
    src="$here/../daemon/$f"
    if [ -f "$src" ] && ! cmp -s "$src" "$bin_dir/$f"; then mkdir -p "$(dirname "$bin_dir/$f")" && cp "$src" "$bin_dir/$f" && changed=1; fi
  done
  if [ "$changed" = 1 ] && command -v launchctl >/dev/null 2>&1 && launchctl print "gui/$(id -u)/com.webmcp.daemon" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/com.webmcp.daemon" >/dev/null 2>&1 || true
  fi
fi
if webmcp_healthy; then exit 0; fi
mkdir -p "$WEBMCP_DATA" "$WEBMCP_STATE"
daemon_js="$here/../daemon/webmcp-daemon.js"
daemon_ts="$here/../../bridge/src/index.ts"     # repo checkout (dev) fallback
if [ -f "$daemon_js" ]; then entry="$daemon_js"; elif [ -f "$daemon_ts" ]; then entry="$daemon_ts"; else echo "webmcp-daemon: no daemon bundle found next to the plugin" >&2; exit 0; fi
if ! command -v node >/dev/null 2>&1; then echo "webmcp-daemon: node is required to run the daemon" >&2; exit 0; fi
# Detach fully (new process group, no inherited stdio) so the daemon outlives this hook and the session.
# No --port unless the user pinned one: the daemon takes the first free candidate and records it (D-2, D-7). A second
# start for the same state directory exits 0 as "already running", so racing the login item is harmless (D-3).
# shellcheck disable=SC2086
node "$here/detach.mjs" "$WEBMCP_DATA/daemon.log" -- node "$entry" serve --state-dir "$WEBMCP_STATE" ${WEBMCP_DAEMON_PORT:+--port "$WEBMCP_DAEMON_PORT"} --tray ${WEBMCP_DAEMON_NO_TRAY:+--no-tray} >/dev/null 2>&1 || { echo "webmcp-daemon: failed to spawn the daemon" >&2; exit 0; }
for _ in $(seq 1 40); do
  WEBMCP_PORT="$(webmcp_resolve_port || true)"; WEBMCP_URL="http://127.0.0.1:${WEBMCP_PORT:-8717}"
  if webmcp_healthy; then exit 0; fi
  sleep 0.25
done
echo "webmcp-daemon: started but not healthy yet (see $WEBMCP_DATA/daemon.log)" >&2
exit 0
