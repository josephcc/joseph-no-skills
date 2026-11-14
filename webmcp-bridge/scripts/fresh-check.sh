#!/usr/bin/env bash
# Approximates a fresh checkout: copies the repo (without node_modules/dist/bundles) to a temp dir, installs,
# typechecks, tests, builds, then runs the token-free end-to-end checks against the built daemon bundle.
set -euo pipefail
src="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dst="$(mktemp -d /tmp/webmcp-fresh-XXXX)"
rsync -a --exclude node_modules --exclude dist --exclude 'plugin/daemon/*.js' --exclude .git "$src/" "$dst/"
cd "$dst"
bun install >/dev/null
bun run typecheck
bun test 2>&1 | grep -E "pass|fail"
bun run build:plugin >/dev/null && ls -la plugin/daemon | tail -2
(cd packages/connector && bun run build >/dev/null) && ls packages/connector/dist | head -12
node plugin/daemon/webmcp-daemon.js serve --port 8721 --state-dir "$dst/.state" --allow-origin http://127.0.0.1:5176 --no-browser > "$dst/daemon.log" 2>&1 &
DPID=$!
bunx vite --config demo-site/vite.config.ts demo-site --port 5176 > "$dst/vite.log" 2>&1 &
VPID=$!
node scripts/e2e/wait-for.mjs http://127.0.0.1:8721/health; node scripts/e2e/wait-for.mjs http://127.0.0.1:5176/
DEMO_URL="http://127.0.0.1:5176/?daemon=ws%3A%2F%2F127.0.0.1%3A8721" DAEMON_URL=http://127.0.0.1:8721 node scripts/e2e/m1.mjs 2>&1 | python3 -I -c "import json,sys; raw=sys.stdin.read(); d=json.loads(raw[raw.find('{'):raw.rfind('}')+1]); print('m1 fresh:', d.get('status',{}).get('state'), '| tools after bonus:', d.get('toolsAfterBonus'), '| error:', (d.get('error') or '')[:200])"
kill $DPID $VPID 2>/dev/null || true
echo "fresh checkout ok at $dst"
