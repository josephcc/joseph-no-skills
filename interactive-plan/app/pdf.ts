#!/usr/bin/env bun
// Render a plan .md to a shareable PDF (or to HTML with --html).
// Usage: bun pdf.ts <plan.md> [out.pdf] [--no-comments] [--no-questions] [--no-checks] [--html]
//        (or via `bun run pdf <plan.md>`)
//
// Presentation lives in src/print.ts; this only handles files and the browser.

import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { planToPrintHtml, type PrintOptions } from './src/print';

// Ordered by how reliably each one produces a PDF headlessly. Chrome is last on purpose:
// its --headless=new --print-to-pdf hangs indefinitely on some macOS builds, where the
// chromium formula renders the same HTML in seconds.
const BROWSERS = [
  'chromium',
  'chromium-browser',
  '/opt/homebrew/bin/chromium',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findBrowser(): string | null {
  // Escape hatch for an unusual install location — and it makes the failure path testable.
  const override = process.env.IP_PDF_BROWSER;
  if (override) return override;
  for (const b of BROWSERS) {
    if (b.startsWith('/')) {
      if (existsSync(b)) return b;
    } else {
      const which = Bun.spawnSync(['which', b]);
      if (which.exitCode === 0) return b.trim();
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Print `html` to `out` with a headless browser.
 *
 * Waits on the *artifact*, not on process exit: the browser reliably writes the PDF but on
 * some platforms never exits when spawned from a script, so polling until the file stops
 * growing is the difference between "works" and "hangs until timeout". It still breaks as
 * soon as the process exits, so a launch failure reports immediately instead of burning the
 * whole timeout.
 *
 * Browser output goes to a log *file*, never a pipe: it writes enough to stderr to fill a pipe
 * buffer, and nothing drains it until exit, which deadlocks the render. A file keeps the
 * diagnostics without that hazard, and the tail is surfaced when no PDF appears.
 */
async function printToPdf(browser: string, htmlPath: string, out: string, timeoutMs = 180_000) {
  if (existsSync(out)) unlinkSync(out);
  const profile = mkdtempSync(join(tmpdir(), `ip-pdf-${basename(browser)}-`));
  const logPath = join(profile, 'browser.log');
  const log = openSync(logPath, 'w');
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${profile}`,
      '--no-pdf-header-footer',
      `--print-to-pdf=${out}`,
      htmlPath,
    ],
    { stdio: ['ignore', log, log] },
  );

  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stable = 0;
  let exited = false;
  let spawnError: Error | null = null;
  child.on('exit', () => (exited = true));
  child.on('error', (e) => ((spawnError = e), (exited = true)));
  while (Date.now() < deadline) {
    if (exited) break;
    const size = existsSync(out) ? statSync(out).size : -1;
    stable = size === last && size > 0 ? stable + 1 : 0;
    last = size;
    if (stable >= 3) break;
    await sleep(500);
  }
  if (!exited) child.kill();
  closeSync(log);
  if (!existsSync(out) || statSync(out).size === 0) {
    const tail = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').slice(-8).join('\n') : '';
    throw new Error(
      [
        `no PDF produced by ${basename(browser)}`,
        spawnError ? `spawn error: ${(spawnError as Error).message}` : '',
        tail ? `browser output:\n${tail}` : '',
        `HTML kept at ${htmlPath}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const src = positional[0];
if (!src) {
  console.error(
    'usage: bun pdf.ts <plan.md> [out.pdf] [--no-comments] [--no-questions] [--no-checks] [--html]',
  );
  process.exit(2);
}
const srcPath = resolve(src);
if (!existsSync(srcPath)) {
  console.error(`not found: ${srcPath}`);
  process.exit(1);
}

const opts: PrintOptions = {
  noComments: flags.has('--no-comments'),
  noQuestions: flags.has('--no-questions'),
  noChecks: flags.has('--no-checks'),
  // Relative images/links in the plan must resolve against the plan's directory, not
  // wherever the HTML happens to be written.
  baseHref: pathToFileURL(dirname(srcPath) + '/').href,
};
const html = planToPrintHtml(readFileSync(srcPath, 'utf8'), opts);
const htmlOut = srcPath.replace(/\.md$/, '') + '.print.html';

if (flags.has('--html')) {
  writeFileSync(htmlOut, html);
  console.log(htmlOut);
  process.exit(0);
}

const out = resolve(positional[1] ?? srcPath.replace(/\.md$/, '') + '.pdf');
const browser = findBrowser();
if (!browser) {
  writeFileSync(htmlOut, html);
  console.error(
    `no headless browser found (tried chromium, Brave, Edge, Chrome).\n` +
      `wrote ${htmlOut} — open it and print to PDF, or install one: brew install --cask chromium`,
  );
  process.exit(1);
}

const tmpHtml = join(mkdtempSync(join(tmpdir(), 'ip-pdf-html-')), basename(htmlOut));
writeFileSync(tmpHtml, html);
try {
  await printToPdf(browser, tmpHtml, out);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}
console.log(`${out}  (${Math.round(statSync(out).size / 1024)} KB, via ${basename(browser)})`);
