import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { DaemonConfig } from './config.ts';
import { installLaunchd, uninstallLaunchd, LAUNCHD_LABEL } from './launchd.ts';
import { log } from './log.ts';
import type { Registry } from './registry.ts';

type Item = { id?: string; title?: string; enabled?: boolean; checked?: boolean; sep?: boolean };

export interface TrayDeps { registry: Registry; config: DaemonConfig; agentCount: () => number; shutdown: () => void }

/**
 * macOS menu bar presence ("webmcp-bridge"), owned by the daemon: spawns the tiny status-item helper that ships next
 * to the daemon bundle (plugin/daemon/tray/webmcp-bridge-tray) and drives it over JSON lines. The menu bar glyph is an
 * SF Symbol; a PNG next to the helper (webmcp-bridge-icon.png, or WEBMCP_TRAY_ICON) replaces it as a template image
 * when one is shipped. If the helper is missing or we are not on macOS, the daemon simply runs without a tray. Plan D-30.
 */
export class Tray {
  readonly #deps: TrayDeps;
  #child: ChildProcess | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #icon: string | undefined;

  constructor(deps: TrayDeps) { this.#deps = deps; }

  static helperPath(): string | undefined {
    const candidates = [
      process.env.WEBMCP_TRAY_HELPER,
      join(dirname(process.argv[1] ?? ''), 'tray', 'webmcp-bridge-tray'),                      // next to the daemon bundle (plugin, login-item copy)
      join(dirname(process.argv[1] ?? ''), '..', '..', 'plugin', 'daemon', 'tray', 'webmcp-bridge-tray'),   // repo checkout (bridge/src/index.ts)
    ].filter((p): p is string => !!p);
    return candidates.find((p) => existsSync(p));
  }

  /** An optional PNG next to the helper (launchd and the plugin hook copy it alongside when it exists). */
  static iconPath(helper: string): string | undefined {
    const p = process.env.WEBMCP_TRAY_ICON ?? join(dirname(helper), 'webmcp-bridge-icon.png');
    return existsSync(p) ? p : undefined;
  }

  start(): boolean {
    if (process.platform !== 'darwin') return false;
    const helper = Tray.helperPath();
    if (!helper) { log.warn('tray: helper not found; running without a menu bar item'); return false; }
    this.#icon = Tray.iconPath(helper);
    const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.#child = child;
    let buf = '';
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { this.#onMessage(JSON.parse(line) as { type: string; id?: string }); } catch { /* ignore */ }
      }
    });
    child.on('error', (err) => { log.warn(`tray: helper failed: ${err.message}`); this.#child = undefined; });
    child.on('exit', (code) => { log.info(`tray: helper exited (${code})`); this.#child = undefined; clearInterval(this.#timer); });
    this.#deps.registry.on('change', () => this.render());
    this.#deps.registry.on('selection', () => this.render());
    this.#timer = setInterval(() => this.render(), 5_000);
    this.#timer.unref();
    log.info(`tray: showing webmcp-bridge in the menu bar (${helper})`);
    return true;
  }

  render(): void {
    if (!this.#child?.stdin?.writable) return;
    const pages = this.#deps.registry.all().length;
    const agents = this.#deps.agentCount();
    const login = existsSync(join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`));
    const items: Item[] = [
      { id: 'name', title: `webmcp-bridge ${this.#deps.config.version}`, enabled: false },
      { id: 'status', title: `Daemon: running on 127.0.0.1:${this.#deps.config.port} · ${pages} page${pages === 1 ? '' : 's'} · ${agents} chat${agents === 1 ? '' : 's'}`, enabled: false },
      { id: 'page', title: 'Open status page' },
      { sep: true },
      { id: 'login', title: 'Start at login', checked: login },
      { id: 'log', title: 'Open log' },
      { id: 'folder', title: 'Show state folder' },
      { id: 'mcp', title: 'Copy MCP URL for Claude Code' },
      { sep: true },
      { id: 'stop', title: 'Stop daemon' },
    ];
    const text = this.#deps.config.trayText;   // --tray-text: show the label instead of an icon
    this.#send({
      type: 'set',
      title: '● webmcp-bridge',
      image: text ? '' : (this.#icon ?? ''),                                   // the icon
      template: true,                                                          // menu bar convention: monochrome, coloured by the system (white in dark mode, black in light)
      icon: text ? '' : 'point.3.connected.trianglepath.dotted',               // fallback if the PNG is missing
      tooltip: `webmcp-bridge (webmcp-daemon ${this.#deps.config.version}): ${pages} page(s), ${agents} chat(s)`,
      items,
    });
  }

  #onMessage(msg: { type: string; id?: string }): void {
    if (msg.type === 'ready') { this.render(); return; }
    if (msg.type !== 'click') return;
    const { config } = this.#deps;
    try {
      switch (msg.id) {
        case 'login': {
          const installed = existsSync(join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`));
          log.info(installed ? uninstallLaunchd() : installLaunchd(config, process.argv[1]!));
          break;
        }
        case 'page': spawn('open', [`http://${config.host}:${config.port}/`], { stdio: 'ignore', detached: true }).unref(); break;
        case 'log': openPath(join(config.stateDir, existsSync(join(config.stateDir, 'daemon.log')) ? 'daemon.log' : '')); break;
        case 'folder': openPath(config.stateDir); break;
        case 'mcp': spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] }).stdin?.end(`http://${config.host}:${config.port}/mcp`); break;
        case 'stop': log.info('tray: stop requested'); this.#deps.shutdown(); break;
      }
    } catch (err) { log.warn(`tray: ${msg.id} failed: ${String(err)}`); }
    this.render();
  }

  #send(obj: unknown): void { try { this.#child?.stdin?.write(JSON.stringify(obj) + '\n'); } catch { /* helper gone */ } }

  stop(): void { clearInterval(this.#timer); try { this.#child?.stdin?.end(); } catch { /* ignore */ } this.#child = undefined; }
}

function openPath(p: string) { spawn('open', [p], { stdio: 'ignore', detached: true }).unref(); }
