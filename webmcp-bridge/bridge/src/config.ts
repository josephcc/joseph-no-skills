import { homedir } from 'node:os';
import { join } from 'node:path';
import { CANDIDATE_PORTS, DEFAULT_PORT } from 'webmcp-protocol';

export interface DaemonConfig {
  host: string;
  /** The port in use: the pinned one, or the first free candidate once `serve` has picked it. */
  port: number;
  /** `--port` / WEBMCP_BRIDGE_PORT given: exactly that port, no fallback (plans/daemon-port-discovery D-2). */
  portPinned: boolean;
  /** The ports to walk when not pinned; tests substitute free ones. Default CANDIDATE_PORTS. */
  portCandidates?: readonly number[];
  stateDir: string;
  /** Origins allowed without the approval page (in addition to the persisted store). */
  allowOrigins: string[];
  /** Skip opening a browser for approvals (tests/CI): unknown origins are rejected. */
  noBrowser: boolean;
  /** 'open' = open the approval page in the default browser; 'log' = only log its URL (tests); 'reject' = --no-browser. */
  approval: 'open' | 'log' | 'reject';
  /** Extra ACP agents selectable by the embedded chat: id → command line. 'claude' is always available. */
  agents: Array<{ id: string; name: string; command: string[] }>;
  callTimeoutMs: number;
  idleAgentMs: number;
  claudePath?: string;
  /** Show the webmcp-bridge menu bar item (macOS). Off by default; the plugin hook and the login item turn it on. */
  tray: boolean;
  /** Show the item as text ("● webmcp-bridge") instead of a narrow icon; wide items get hidden under a MacBook notch. */
  trayText: boolean;
  version: string;
}

/** `webmcp-bridge handoff …`: offer (or forget) the calling terminal session to a page (plans/terminal-handoff §2.5). */
export interface HandoffArgs {
  /** Default: $CLAUDE_CODE_SESSION_ID, which every Claude Code session sets for its shell commands. */
  session?: string;
  /** Default: the current directory. */
  cwd?: string;
  origin?: string;
  title?: string;
  note?: string;
  tags: Record<string, string>;
  forget: boolean;
}

export function parseArgs(argv: string[], version: string): { command: string; config: DaemonConfig; handoff: HandoffArgs } {
  const config: DaemonConfig = {
    host: '127.0.0.1',
    port: Number(process.env.WEBMCP_BRIDGE_PORT ?? DEFAULT_PORT),
    portPinned: process.env.WEBMCP_BRIDGE_PORT !== undefined,
    stateDir: process.env.WEBMCP_BRIDGE_STATE ?? join(homedir(), '.webmcp-bridge'),
    allowOrigins: [],
    noBrowser: process.env.WEBMCP_BRIDGE_NO_BROWSER === '1',
    approval: process.env.WEBMCP_BRIDGE_NO_BROWSER === '1' ? 'reject' : (process.env.WEBMCP_BRIDGE_APPROVAL as 'open' | 'log' | undefined) ?? 'open',
    agents: [],
    callTimeoutMs: 60_000,
    idleAgentMs: 10 * 60_000,
    claudePath: process.env.CLAUDE_CODE_EXECUTABLE,
    tray: process.env.WEBMCP_BRIDGE_TRAY === '1',
    trayText: process.env.WEBMCP_BRIDGE_TRAY_TEXT === '1',
    version,
  };
  let command = 'serve';
  const handoff: HandoffArgs = { tags: {}, forget: false };
  const args = [...argv];
  while (args.length) {
    const a = args.shift()!;
    const next = () => { const v = args.shift(); if (v === undefined) throw new Error(`missing value for ${a}`); return v; };
    switch (a) {
      case 'serve': case 'stop': case 'status': case 'install-launchd': case 'uninstall-launchd': case 'handoff': command = a; break;
      case '--session': handoff.session = next(); break;
      case '--cwd': handoff.cwd = next(); break;
      case '--origin': handoff.origin = next(); break;
      case '--title': handoff.title = next(); break;
      case '--note': handoff.note = next(); break;
      case '--tag': { const v = next(); const eq = v.indexOf('='); if (eq < 1) throw new Error('--tag expects key=value'); handoff.tags[v.slice(0, eq)] = v.slice(eq + 1); break; }
      case '--forget': handoff.forget = true; break;
      case '--port': config.port = Number(next()); config.portPinned = true; break;
      case '--ports': {
        // A list to walk: it also unpins WEBMCP_BRIDGE_PORT or an earlier --port (the last of --port/--ports wins).
        const ports = next().split(',').map((p) => p.trim()).filter(Boolean).map((p) => { const n = Number(p); if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new Error(`--ports: not a port: ${p}`); return n; });
        if (!ports.length) throw new Error('--ports expects a comma-separated list');
        config.portCandidates = ports; config.port = ports[0]!; config.portPinned = false;
        break;
      }
      case '--state-dir': config.stateDir = next(); break;
      case '--allow-origin': config.allowOrigins.push(...next().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--no-browser': config.noBrowser = true; config.approval = 'reject'; break;
      case '--approval': { const v = next(); if (v !== 'open' && v !== 'log' && v !== 'reject') throw new Error('--approval must be open|log|reject'); config.approval = v; config.noBrowser = v === 'reject'; break; }
      case '--agent': { const v = next(); const eq = v.indexOf('='); if (eq < 1) throw new Error('--agent expects id=<command line>'); const id = v.slice(0, eq).trim(); const cmd = v.slice(eq + 1).trim().split(/\s+/).filter(Boolean); if (!cmd.length) throw new Error('--agent: empty command'); config.agents.push({ id, name: id, command: cmd }); break; }
      case '--call-timeout-ms': config.callTimeoutMs = Number(next()); break;
      case '--idle-agent-ms': config.idleAgentMs = Number(next()); break;
      case '--claude': config.claudePath = next(); break;
      case '--tray': config.tray = true; break;
      case '--no-tray': config.tray = false; break;
      case '--tray-text': config.trayText = true; break;
      case '--dry-run': break;   // consumed by install-launchd
      case '-h': case '--help': command = 'help'; break;
      default: throw new Error(`unknown argument: ${a}`);
    }
  }
  return { command, config, handoff };
}

export const HELP = `webmcp-bridge [serve|status|stop|install-launchd|uninstall-launchd] [options]
  --port <n>                 pin the listen port (default: the first free of ${CANDIDATE_PORTS.join(', ')}; env WEBMCP_BRIDGE_PORT)
  --ports <a,b,…>            the candidate ports to walk instead (tests, private daemons)
  --state-dir <dir>          state directory (default ~/.webmcp-bridge, env WEBMCP_BRIDGE_STATE)
  --allow-origin <origin[,…]> pre-approve page origins (e.g. http://127.0.0.1:5173)
  --no-browser               never open the approval page; unknown origins are rejected
  --approval open|log|reject  what to do for an unknown origin (default open; log = hold and print the URL)
  --agent <id>=<command>     add a selectable ACP agent for the embedded chat (e.g. gemini="gemini --acp")
  --call-timeout-ms <n>      per page-tool call (default 60000)
  --idle-agent-ms <n>        reap idle embedded-chat agents (default 600000)
  --claude <path>            claude executable for the embedded chat (env CLAUDE_CODE_EXECUTABLE)
  --tray / --no-tray         show the webmcp-bridge menu bar item (macOS; env WEBMCP_BRIDGE_TRAY=1)
  install-launchd [--dry-run] register a login item (macOS, opt-in); uninstall-launchd removes it
  handoff [--session <uuid>] [--cwd <dir>] [--origin <origin>] [--title <t>] [--note <n>] [--tag k=v …] [--forget]
                             offer this terminal's Claude Code session to a page's embedded chat (the session id defaults to
                             $CLAUDE_CODE_SESSION_ID, the directory to the current one); --forget withdraws it
`;
