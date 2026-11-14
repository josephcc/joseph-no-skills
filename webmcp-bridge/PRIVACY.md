# Privacy

Everything in this project runs on your own computer.

- The **daemon** (`webmcp-daemon`) listens only on `127.0.0.1`. It never connects to the internet itself.
- **Web pages** that embed `webmcp-connector` connect to the daemon on your machine. The daemon asks you to approve each page origin the first time (unless you pre-approved it on the command line), and remembers your answer in its state directory (`~/.webmcp-daemon` or the plugin's data directory).
- What a page shares with the daemon: its tool definitions, its instructions, and the UI-state snapshot it chooses to provide. The daemon forwards these to **your** Claude Code (terminal sessions through MCP; the embedded chat through a Claude agent process started on your machine with your own Claude Code login). Nothing is sent to any server other than the ones Claude Code itself talks to.
- The daemon keeps per-page workspaces, logs, and the origin allow-list under its state directory. Delete that directory to remove them.
- The plugin's hooks only read from the local daemon (`curl http://127.0.0.1:<port>/...`, the port the daemon recorded in its state directory). A page finds the daemon by asking `GET /id` on each candidate port; that answer carries the daemon's name, protocol, version and a random instance id, nothing about pages or origins.

The project has no telemetry.
