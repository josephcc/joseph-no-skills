// interactive-plan viewer — a single long-running local server that opens,
// watches, and edits MANY plan files, keyed by ?plan=<abs path>.
//
//   node server.mjs <plan.md> [--no-open]   ensure the daemon is up, register the
//                                           plan, print its URL, open the browser
//   node server.mjs --status                JSON status of the running daemon
//   node server.mjs --stop                  stop the daemon, remove the pidfile
//   node server.mjs --serve                 [internal] run the daemon
//
// There is at most ONE daemon. It binds a kernel-assigned port on 127.0.0.1 and
// records {port,pid} in /tmp/interactive-plan-viewer.json so any process — or a
// fresh Claude session — can discover it instead of spawning another server.
import express from 'express';
import { createHash } from 'node:crypto';
import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(SKILL_ROOT, 'config.json');
const PIDFILE = '/tmp/interactive-plan-viewer.json';
const LOGFILE = '/tmp/interactive-plan-viewer.log';

// ---------- shared helpers ----------
const hashOf = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { editorCommand: 'zed {path}:{line}:{col}' };
  }
};
const readPidfile = () => {
  try {
    return JSON.parse(fs.readFileSync(PIDFILE, 'utf8'));
  } catch {
    return null;
  }
};
const clearPidfile = () => {
  try {
    fs.unlinkSync(PIDFILE);
  } catch {
    /* ignore */
  }
};

// Validate that a requested plan path is an existing .md file (absolute). This
// is the trust boundary for the now-parameterized file API.
function validatePlanPath(p) {
  if (typeof p !== 'string' || !p) return null;
  const abs = path.resolve(p);
  if (!abs.endsWith('.md')) return null;
  try {
    // Resolve symlinks and re-check: a .md symlink pointing at a non-.md file
    // (e.g. ~/.zshrc) must NOT pass — otherwise reads/writes hit the target.
    const real = fs.realpathSync(abs);
    if (!real.endsWith('.md')) return null;
    if (!fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

async function ping() {
  const pf = readPidfile();
  if (!pf?.port) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const r = await fetch(`http://127.0.0.1:${pf.port}/api/status`, { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) return { ...pf, status: await r.json() };
  } catch {
    /* dead */
  }
  return null;
}

// ===================================================================
// DAEMON
// ===================================================================
function runServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  // CSRF / DNS-rebinding guard: only allow same-origin localhost callers on
  // mutating + action routes; reject a cross-site Origin or a foreign Host.
  app.use((req, res, next) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const okHost = host === 'localhost' || host === '127.0.0.1';
    const origin = req.headers.origin;
    let okOrigin = true;
    if (origin) {
      try {
        const h = new URL(origin).hostname;
        okOrigin = h === 'localhost' || h === '127.0.0.1';
      } catch {
        okOrigin = false;
      }
    }
    if (!okHost || !okOrigin) return res.status(403).json({ error: 'cross-origin blocked' });
    next();
  });

  const plans = new Map(); // abs path -> { lastSeen }
  const register = (abs) => plans.set(abs, { lastSeen: Date.now() });

  app.get('/api/status', (_req, res) => {
    res.json({
      running: true,
      port: server.address().port,
      pid: process.pid,
      startedAt,
      plans: [...plans.keys()],
    });
  });

  app.post('/api/register', (req, res) => {
    const abs = validatePlanPath(req.body?.path);
    if (!abs) return res.status(400).json({ error: 'not an existing .md file' });
    register(abs);
    res.json({ ok: true, path: abs });
  });

  app.post('/api/shutdown', (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => {
      clearPidfile();
      process.exit(0);
    }, 50);
  });

  app.get('/api/plan', (req, res) => {
    const abs = validatePlanPath(req.query.path);
    if (!abs) return res.status(400).json({ error: 'not an existing .md file' });
    register(abs);
    const content = fs.readFileSync(abs, 'utf8');
    res.json({ path: abs, content, hash: hashOf(content) });
  });

  app.post('/api/plan', (req, res) => {
    const abs = validatePlanPath(req.body?.path);
    if (!abs) return res.status(400).json({ error: 'not an existing .md file' });
    const { content, baseHash } = req.body ?? {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    const current = fs.readFileSync(abs, 'utf8');
    if (baseHash && hashOf(current) !== baseHash) {
      return res.status(409).json({ conflict: true, currentContent: current, currentHash: hashOf(current) });
    }
    fs.writeFileSync(abs, content, 'utf8');
    res.json({ ok: true, hash: hashOf(content) });
  });

  app.post('/api/open', (req, res) => {
    const planPath = validatePlanPath(req.body?.planPath);
    const ref = String(req.body?.ref ?? '');
    const m = /^(.+?):(\d+)(?::(\d+))?/.exec(ref);
    if (!m) return res.status(400).json({ error: 'bad ref' });
    const [, rel, line, col = '1'] = m;
    const planDir = planPath ? path.dirname(planPath) : process.cwd();
    let repoRoot = planDir;
    try {
      repoRoot = execFileSync('git', ['-C', planDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim() || planDir;
    } catch {
      /* not a git repo */
    }
    // Only open a file that actually exists under the plan's repo or directory —
    // no traversal to arbitrary absolute/`..` paths.
    let target = null;
    for (const base of [repoRoot, planDir]) {
      const candidate = path.resolve(base, rel);
      if ((candidate === base || candidate.startsWith(base + path.sep)) && fs.existsSync(candidate)) {
        target = candidate;
        break;
      }
    }
    // Fallback: plans often cite files by shorthand (`models/ontology.py`,
    // `App.tsx`) relative to a deep source dir. Suffix-match against the repo's
    // tracked files, preferring the longest shared suffix, then the shortest
    // (least-nested) path. Stays within the repo, so no traversal risk.
    if (!target && repoRoot) {
      try {
        const files = execFileSync('git', ['-C', repoRoot, 'ls-files'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
          .split('\n')
          .filter(Boolean);
        const base = rel.split('/').pop();
        let matches = files.filter((f) => f === rel || f.endsWith('/' + rel));
        if (!matches.length) matches = files.filter((f) => f === base || f.endsWith('/' + base));
        matches.sort((a, b) => a.length - b.length);
        if (matches.length) target = path.resolve(repoRoot, matches[0]);
      } catch {
        /* not a git repo / git unavailable */
      }
    }
    if (!target) return res.status(404).json({ error: 'file not found under plan repo/dir' });
    // Tokenize the template FIRST, then substitute, so a path with spaces stays one arg.
    const tokens = (readConfig().editorCommand || 'zed {path}:{line}:{col}').split(' ');
    const args = tokens.map((t) => t.replace('{path}', target).replace('{line}', line).replace('{col}', col));
    const bin = args.shift();
    try {
      spawn(bin, args, { detached: true, stdio: 'ignore' }).unref();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });


  // Render the plan to a PDF and stream it back as a download. The rendering itself lives in
  // pdf.ts (bun + TS, sharing the viewer's parser), so this only validates, spawns, and pipes.
  app.get('/api/pdf', (req, res) => {
    const planPath = validatePlanPath(req.query?.plan);
    if (!planPath) return res.status(400).json({ error: 'bad plan path' });
    const args = [path.join(__dirname, 'pdf.ts'), planPath];
    for (const f of ['no-comments', 'no-questions', 'no-checks']) {
      if (req.query?.[f] === '1') args.push(`--${f}`);
    }
    const out = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ip-pdf-route-')),
      path.basename(planPath).replace(/\.md$/, '') + '.pdf',
    );
    args.push(out);
    // `bun` is already required to lint and test this app, so it is a fair assumption; if it
    // is missing say so plainly rather than failing with ENOENT.
    const child = spawn('bun', args, { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', (d) => (err += d.toString().slice(0, 2000)));
    child.on('error', (e) =>
      res.headersSent
        ? res.end()
        : res.status(500).json({
            error: e.code === 'ENOENT' ? 'bun not found on PATH — needed to render the PDF' : String(e),
          }),
    );
    child.on('close', () => {
      if (res.headersSent) return;
      if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
        return res.status(500).json({ error: err.trim() || 'render produced no PDF' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(out)}"`);
      const stream = fs.createReadStream(out);
      stream.pipe(res);
      // Clean up the temp render once it has been sent either way.
      stream.on('close', () => fs.rm(path.dirname(out), { recursive: true, force: true }, () => {}));
    });
  });

  app.get('/api/config', (_req, res) => res.json(readConfig()));
  app.post('/api/config', (req, res) => {
    // Allow-list: only editorCommand (string). Prevents arbitrary keys.
    const next = readConfig();
    if (typeof req.body?.editorCommand === 'string') next.editorCommand = req.body.editorCommand;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
    res.json(next);
  });

  // SSE live-watch for one plan file, with re-arm across atomic (rename) saves.
  app.get('/api/events', (req, res) => {
    const abs = validatePlanPath(req.query.path);
    if (!abs) return res.status(400).end();
    register(abs);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    let watcher = null;
    let debounce = null;
    let rearm = null;
    let closed = false;
    let lastHash = (() => {
      try {
        return hashOf(fs.readFileSync(abs, 'utf8'));
      } catch {
        return '';
      }
    })();
    const emit = () => {
      let content;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        return;
      }
      const hash = hashOf(content);
      if (hash === lastHash) return;
      lastHash = hash;
      res.write(`event: change\ndata: ${JSON.stringify({ content, hash })}\n\n`);
    };
    const arm = () => {
      try {
        watcher = fs.watch(abs, (eventType) => {
          clearTimeout(debounce);
          debounce = setTimeout(emit, 120);
          if (eventType === 'rename') {
            try {
              watcher.close();
            } catch {
              /* ignore */
            }
            rearm = setTimeout(() => !closed && arm(), 60); // editor wrote a new inode; re-attach
          }
        });
      } catch {
        /* file vanished */
      }
    };
    arm();
    const keepalive = setInterval(() => res.write(': ka\n\n'), 25000);
    req.on('close', () => {
      closed = true;
      clearInterval(keepalive);
      clearTimeout(debounce);
      clearTimeout(rearm); // don't let a pending rename re-arm leak a watcher
      try {
        watcher?.close();
      } catch {
        /* ignore */
      }
    });
  });

  // static viewer + SPA fallback (defined after /api so it never shadows it)
  const dist = path.join(__dirname, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const startedAt = new Date().toISOString();
  const server = app.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    fs.writeFileSync(PIDFILE, JSON.stringify({ port, pid: process.pid, startedAt }));
    console.log(`[interactive-plan] daemon on http://localhost:${port} (pid ${process.pid})`);
  });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => (clearPidfile(), process.exit(0)));
  process.on('exit', clearPidfile);
}

// ===================================================================
// CLI
// ===================================================================
function ensureBuilt() {
  if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
    console.error('[interactive-plan] installing deps (first run)…');
    execSync('bun install', { cwd: __dirname, stdio: 'inherit' });
  }
  if (!fs.existsSync(path.join(__dirname, 'dist'))) {
    console.error('[interactive-plan] building viewer (first run)…');
    execSync('bun run build', { cwd: __dirname, stdio: 'inherit' });
  }
}

async function ensureDaemon() {
  const live = await ping();
  if (live) return live;
  clearPidfile();
  ensureBuilt();
  const out = fs.openSync(LOGFILE, 'a');
  spawn('node', [fileURLToPath(import.meta.url), '--serve'], {
    detached: true,
    stdio: ['ignore', out, out],
  }).unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const p = await ping();
    if (p) return p;
  }
  throw new Error('daemon did not start; see ' + LOGFILE);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--serve')) return runServer();

  if (argv.includes('--status')) {
    const live = await ping();
    console.log(JSON.stringify(live ? { running: true, ...live } : { running: false }, null, 2));
    return;
  }

  if (argv.includes('--stop')) {
    const pf = readPidfile();
    const live = await ping();
    if (live) {
      try {
        await fetch(`http://127.0.0.1:${pf.port}/api/shutdown`, { method: 'POST', headers: { origin: 'http://localhost' } });
      } catch {
        /* ignore */
      }
    }
    if (pf?.pid) {
      try {
        process.kill(pf.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    clearPidfile();
    console.log('[interactive-plan] stopped.');
    return;
  }

  // default: open a plan
  const planArg = argv.find((a) => !a.startsWith('--'));
  if (!planArg) {
    console.error('usage: node server.mjs <plan.md> | --status | --stop');
    process.exit(1);
  }
  const abs = validatePlanPath(planArg);
  if (!abs) {
    console.error(`[interactive-plan] not an existing .md file: ${planArg}`);
    process.exit(1);
  }
  const daemon = await ensureDaemon();
  try {
    await fetch(`http://127.0.0.1:${daemon.port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ path: abs }),
    });
  } catch {
    /* non-fatal */
  }
  const url = `http://localhost:${daemon.port}/?plan=${encodeURIComponent(abs)}`;
  console.log(`[interactive-plan] ${url}`);
  console.log(`[interactive-plan] daemon pid ${daemon.pid} — stop with: node server.mjs --stop`);
  if (!argv.includes('--no-open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* print only */
    }
  }
}

main();
