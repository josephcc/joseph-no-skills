#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { HELP, parseArgs, type DaemonConfig } from './config.ts';
import { createHttpServer } from './http.ts';
import { log } from './log.ts';
import { Registry } from './registry.ts';
import { OriginPolicy } from './security.ts';
import { Workspaces } from './workspace.ts';
import { PageServer } from './ws-server.ts';
import { createMcpHandler } from './mcp.ts';
import { AcpRelay } from './acp.ts';
import { installLaunchd, uninstallLaunchd } from './launchd.ts';
import { Tray } from './tray.ts';

const VERSION = '0.0.1';

export interface Daemon { close(): Promise<void>; port: number; registry: Registry }

export async function serve(config: DaemonConfig): Promise<Daemon> {
  mkdirSync(config.stateDir, { recursive: true });
  const httpBase = `http://${config.host}:${config.port}`;
  const wsBase = `ws://${config.host}:${config.port}`;
  const registry = new Registry();
  const policy = new OriginPolicy(config.stateDir, config.allowOrigins, config.noBrowser, httpBase, config.approval === 'log' ? (url) => log.info(`approval needed (open this URL): ${url}`) : undefined);
  const workspaces = new Workspaces(config.stateDir);
  const mcp = createMcpHandler({ registry, config, version: VERSION });
  const acpRelay = new AcpRelay({ registry, policy, workspaces, config });
  const pages = new PageServer({ registry, policy, workspaces, version: VERSION, callTimeoutMs: config.callTimeoutMs, httpBase, wsBase, agents: () => acpRelay.agents() });
  const server = createHttpServer({ config, registry, policy, pages, mcp: mcp.handle, acpUpgrade: (req, socket, head) => void acpRelay.handleUpgrade(req, socket, head), acpStatus: () => acpRelay.status(), agents: () => acpRelay.agents() });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => { server.off('error', reject); resolve(); });
  });
  const pidFile = join(config.stateDir, 'daemon.json');
  writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: config.port, startedAt: new Date().toISOString(), version: VERSION }));
  log.info(`listening on ${httpBase} (ws: /ws, mcp: /mcp, acp: /acp, state dir: ${config.stateDir}, pre-approved origins: ${config.allowOrigins.join(', ') || 'none'})`);
  registry.on('selection', ({ pageId }: { pageId?: string }) => log.info(`selected page: ${pageId ?? 'none'}`));

  let tray: Tray | undefined;
  const close = async () => {
    tray?.stop();
    await acpRelay.close();
    await mcp.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try { unlinkSync(pidFile); } catch { /* already gone */ }
  };
  if (config.tray) {
    tray = new Tray({ registry, config, agentCount: () => acpRelay.status().length, shutdown: () => { void close().then(() => process.exit(0)); } });
    tray.start();
  }
  return { close, port: config.port, registry };
}

async function main() {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(2), VERSION); } catch (err) { process.stderr.write(`${String(err)}\n${HELP}`); process.exit(2); }
  const { command, config } = parsed;
  if (command === 'help') { process.stdout.write(HELP); return; }
  if (command === 'status') {
    try { const r = await fetch(`http://${config.host}:${config.port}/health`); process.stdout.write((await r.text()) + '\n'); }
    catch { process.stdout.write(`no daemon on ${config.host}:${config.port}\n`); process.exitCode = 1; }
    return;
  }
  if (command === 'stop') {
    try {
      const { pid } = JSON.parse(readFileSync(join(config.stateDir, 'daemon.json'), 'utf8')) as { pid: number };
      process.kill(pid, 'SIGTERM'); process.stdout.write(`sent SIGTERM to ${pid}\n`);
    } catch (err) { process.stdout.write(`nothing to stop (${String(err)})\n`); process.exitCode = 1; }
    return;
  }
  if (command === 'install-launchd') {
    const entry = process.argv[1]!;
    try { process.stdout.write(installLaunchd(config, entry, { dryRun: process.argv.includes('--dry-run') }) + '\n'); } catch (err) { process.stderr.write(String(err) + '\n'); process.exit(1); }
    return;
  }
  if (command === 'uninstall-launchd') { process.stdout.write(uninstallLaunchd() + '\n'); return; }

  const daemon = await serve(config);
  const shutdown = (sig: string) => { log.info(`${sig}: shutting down`); void daemon.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main().catch((err) => { log.error(String(err?.stack ?? err)); process.exit(1); });
