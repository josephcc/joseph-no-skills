#!/usr/bin/env bash
# UserPromptSubmit hook: print the selected page's current UI state so it rides along with the prompt.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/common.sh"
if [ "${CLAUDE_PLUGIN_OPTION_INJECT_PAGE_CONTEXT:-true}" = "false" ]; then exit 0; fi
curl -sf --max-time 5 "$WEBMCP_URL/state?page=selected" 2>/dev/null || true
exit 0
