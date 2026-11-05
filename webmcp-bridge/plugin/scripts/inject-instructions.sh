#!/usr/bin/env bash
# SessionStart hook: print the connected page's instructions (summary or head + pointers).
# Claude Code adds this hook's stdout to the session context (capped at 10,000 characters).
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/common.sh"
curl -sf --max-time 3 "$WEBMCP_URL/instructions?page=selected" 2>/dev/null || true
exit 0
