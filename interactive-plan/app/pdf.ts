#!/usr/bin/env bun
// Render a plan .md to a shareable PDF (or to HTML with --html).
// Usage: bun pdf.ts <plan.md> [out.pdf] [--no-comments] [--no-questions] [--no-checks] [--html]
//        (or via `bun run pdf <plan.md>`)
//
// Presentation lives in src/print.ts; this only handles files and the browser.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
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
 * growing is the difference between "works" and "hangs until timeout". Output is sent to
 * /dev/null rather than captured — the browser writes enough to stderr to fill a pipe, and
 * nothing drains it until exit, which deadlocks the render.
 */
async function printToPdf(browser: string, htmlPath: string, out: string, timeoutMs = 180_000) {
  if (existsSync(out)) unlinkSync(out);
  const profile = mkdtempSync(join(tmpdir(), `ip-pdf-${basename(browser)}-`));
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
    { stdio: 'ignore' },
  );

  const deadline = Date.now() + timeoutMs;
  let last = -1;
  let stable = 0;
  let exited = false;
  child.on('exit', () => (exited = true));
  while (Date.now() < deadline) {
    if (exited && existsSync(out)) break;
    const size = existsSync(out) ? statSync(out).size : -1;
    stable = size === last && size > 0 ? stable + 1 : 0;
    last = size;
    if (stable >= 3) break;
    await sleep(500);
  }
  if (!exited) child.kill();
  if (!existsSync(out) || statSync(out).size === 0) {
    throw new Error(`no PDF produced — inspect the HTML at ${htmlPath}`);
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
