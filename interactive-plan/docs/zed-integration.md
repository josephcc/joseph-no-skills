# Open the viewer from Zed

The viewer is a local web app, and Zed has no extension API for embedding a webview
in an editor tab (the [Visual Extension API](https://github.com/zed-industries/zed/discussions/53403)
is a draft as of mid-2026). So the integration is: bind a key in Zed that opens the
**currently focused `.md`** in the viewer (in your browser), reusing the single shared
daemon. Two trigger points result — a keybinding and the command palette.

> Zed cannot add custom items to the project-panel / editor **right-click menu** either —
> that's the same missing UI API. Keybinding + command palette is the supported surface.

## How it avoids duplicate servers

The task calls `server.mjs <file>`, which is idempotent: it pings the daemon recorded in
`/tmp/interactive-plan-viewer.json`, **reuses it if alive**, and only spawns a new daemon
if none is running. Each keypress is just a short-lived client process (ping → register →
open browser → exit). There is never more than one server.

## Setup

1. **Task** — copy [`docs/zed/tasks.example.json`](zed/tasks.example.json) into
   `~/.config/zed/tasks.json` (merge into the existing array if you have one). Edit the
   absolute path to `server.mjs` for your machine — Zed does not reliably expand `~` in
   `args`, so use a full path. `$ZED_FILE` is the absolute path of the active editor file.

2. **Keybinding** — copy [`docs/zed/keymap.example.json`](zed/keymap.example.json) into
   `~/.config/zed/keymap.json` (again, merge into the existing array). Default binding is
   `cmd-shift-m`; `task_name` must match the task's `label`.

3. **Use it** — open a plan `.md` in Zed and press `cmd-shift-m`, **or** open the command
   palette (`cmd-shift-P`) → "Spawn task" → *Open in interactive-plan viewer*. The viewer
   opens (or focuses) the tab for that plan.

Run it on a non-`.md` file and `server.mjs` just prints an error and exits — harmless.

## Notes

- The reverse direction is already wired: code refs (`file.ts:123`) in the viewer open in
  Zed via `editorCommand` in `config.json` (`zed {path}:{line}:{col}`).
- Stop the daemon with `node app/server.mjs --stop`; check it with `--status`.
