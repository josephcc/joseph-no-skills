import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT } from 'webmcp-protocol';

export interface DaemonConfig {
  host: string;
  port: number;
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

export function parseArgs(argv: string[], version: string): { command: string; config: DaemonConfig } {
  const config: DaemonConfig = {
    host: '127.0.0.1',
    port: Number(process.env.WEBMCP_DAEMON_PORT ?? DEFAULT_PORT),
    stateDir: process.env.WEBMCP_DAEMON_STATE ?? join(homedir(), '.webmcp-daemon'),
    allowOrigins: [],
    noBrowser: process.env.WEBMCP_DAEMON_NO_BROWSER === '1',
    approval: process.env.WEBMCP_DAEMON_NO_BROWSER === '1' ? 'reject' : (process.env.WEBMCP_DAEMON_APPROVAL as 'open' | 'log' | undefined) ?? 'open',
    agents: [],
    callTimeoutMs: 60_000,
    idleAgentMs: 10 * 60_000,
    claudePath: process.env.CLAUDE_CODE_EXECUTABLE,
    tray: process.env.WEBMCP_DAEMON_TRAY === '1',
    trayText: process.env.WEBMCP_DAEMON_TRAY_TEXT === '1',
    version,
  };
  let command = 'serve';
  const args = [...argv];
  while (args.length) {
    const a = args.shift()!;
    const next = () => { const v = args.shift(); if (v === undefined) throw new Error(`missing value for ${a}`); return v; };
    switch (a) {
      case 'serve': case 'stop': case 'status': case 'install-launchd': case 'uninstall-launchd': command = a; break;
      case '--port': config.port = Number(next()); break;
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
  return { command, config };
}

export const HELP = `webmcp-daemon [serve|status|stop|install-launchd|uninstall-launchd] [options]
  --port <n>                 listen port (default ${DEFAULT_PORT}, env WEBMCP_DAEMON_PORT)
  --state-dir <dir>          state directory (default ~/.webmcp-daemon, env WEBMCP_DAEMON_STATE)
  --allow-origin <origin[,…]> pre-approve page origins (e.g. http://127.0.0.1:5173)
  --no-browser               never open the approval page; unknown origins are rejected
  --approval open|log|reject  what to do for an unknown origin (default open; log = hold and print the URL)
  --agent <id>=<command>     add a selectable ACP agent for the embedded chat (e.g. gemini="gemini --acp")
  --call-timeout-ms <n>      per page-tool call (default 60000)
  --idle-agent-ms <n>        reap idle embedded-chat agents (default 600000)
  --claude <path>            claude executable for the embedded chat (env CLAUDE_CODE_EXECUTABLE)
  --tray / --no-tray         show the webmcp-bridge menu bar item (macOS; env WEBMCP_DAEMON_TRAY=1)
  install-launchd [--dry-run] register a login item (macOS, opt-in); uninstall-launchd removes it
`;
