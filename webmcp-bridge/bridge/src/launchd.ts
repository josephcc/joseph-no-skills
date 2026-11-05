import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DaemonConfig } from './config.ts';

export const LAUNCHD_LABEL = 'com.webmcp.daemon';

/**
 * Opt-in login item (D-26): a per-user LaunchAgent that starts the daemon at login and restarts it if it dies.
 * Never run from a hook; the user triggers it (plugin command or by hand). The plist points at a copy of the
 * daemon under the state dir, because the plugin's own directory moves on every plugin update.
 */
export function launchdPlan(config: DaemonConfig, entry: string): { plistPath: string; binDir: string; plist: string; files: string[] } {
  const binDir = join(config.stateDir, 'bin');
  const daemonCopy = join(binDir, basename(entry));
  const siblings = ['claude-agent-acp.js', 'tray/webmcp-bridge-tray', 'tray/webmcp-bridge-icon.png'].map((f) => join(dirname(entry), f)).filter(existsSync);
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  // The login item walks the candidate ports like any other start unless the user pinned one (D-7).
  const args = [process.execPath, daemonCopy, 'serve', '--state-dir', config.stateDir, ...(config.portPinned ? ['--port', String(config.port)] : []), '--tray'];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key><array>${args.map((a) => `<string>${escapeXml(a)}</string>`).join('')}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(join(config.stateDir, 'launchd.log'))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(join(config.stateDir, 'launchd.log'))}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${escapeXml(process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin')}</string></dict>
</dict></plist>
`;
  return { plistPath, binDir, plist, files: [entry, ...siblings] };
}

export function installLaunchd(config: DaemonConfig, entry: string, { dryRun = false } = {}): string {
  if (process.platform !== 'darwin') throw new Error('install-launchd is macOS only (use a systemd user unit or Task Scheduler elsewhere)');
  const plan = launchdPlan(config, entry);
  if (dryRun) return `# would write ${plan.plistPath}\n# would copy ${plan.files.join(', ')} → ${plan.binDir}\n${plan.plist}`;
  mkdirSync(plan.binDir, { recursive: true });
  for (const f of plan.files) { const rel = basename(dirname(f)) === 'tray' ? join('tray', basename(f)) : basename(f); mkdirSync(dirname(join(plan.binDir, rel)), { recursive: true }); copyFileSync(f, join(plan.binDir, rel)); }
  mkdirSync(dirname(plan.plistPath), { recursive: true });
  try { execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded */ }
  writeFileSync(plan.plistPath, plan.plist);
  execFileSync('launchctl', ['bootstrap', `gui/${process.getuid?.() ?? 501}`, plan.plistPath], { stdio: 'inherit' });
  writeFileSync(join(config.stateDir, 'setup-done'), new Date().toISOString() + '\n');
  return `installed ${plan.plistPath} (daemon copied to ${plan.binDir}); it now starts at login. Remove with: webmcp-daemon uninstall-launchd`;
}

export function uninstallLaunchd(): string {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  try { execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded */ }
  if (existsSync(plistPath)) { unlinkSync(plistPath); return `removed ${plistPath}`; }
  return 'no login item installed';
}

function escapeXml(s: string): string { return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!); }
