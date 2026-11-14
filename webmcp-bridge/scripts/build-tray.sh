#!/usr/bin/env bash
# Builds the status-bar helper the daemon spawns on macOS: plugin/daemon/tray/webmcp-bridge-tray (universal binary).
# Needs only the Xcode Command Line Tools (clang + Cocoa). The result is committed with the plugin, next to the
# menu bar icon plugin/daemon/tray/webmcp-bridge-icon.png (regenerate that with scripts/make-tray-icon.py).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/plugin/daemon/tray/webmcp-bridge-tray"
mkdir -p "$(dirname "$out")"
clang -O2 -fobjc-arc -mmacosx-version-min=12.0 -arch arm64 -arch x86_64 -framework Cocoa -o "$out" "$root/menubar/tray.m"
codesign --force --sign - "$out" >/dev/null 2>&1 || true
echo "built $out ($(du -h "$out" | cut -f1))"
