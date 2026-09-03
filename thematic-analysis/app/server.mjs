// thematic-analysis review workbench — one long-running local daemon serving many
// analysis folders, keyed by ?analysis=<abs path>.
//
//   node server.mjs <analysis-dir> [--params "view=transcript&t=T-07"] [--no-open]
//   node server.mjs --status        JSON status of the running daemon
//   node server.mjs --stop          stop the daemon, remove the pidfile
//   node server.mjs --serve         [internal] run the daemon
//
// The browser never writes a data file. Every gesture it makes is one operation
// appended to <analysis>/inbox.jsonl, and `ta.py apply` is the only thing that
// touches study.yaml / codebook.yaml / extracts.jsonl / themes.yaml. Everything the
// page displays that is *computed* comes from `ta.py --json`, so a number is never
// derived twice.
// `express` is imported lazily inside runServer(): on a first run this file executes
// *before* the dependencies are installed (installing them is one of its jobs), and a
// top-level import of a missing package fails the whole module.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');
const TA = path.join(SKILL_ROOT, 'scripts', 'ta.py');
const CONFIG_PATH = path.join(SKILL_ROOT, 'app', 'config.json');
const PIDFILE = '/tmp/ta-workbench.json';
const LOGFILE = '/tmp/ta-workbench.log';
// A fixed default so a review document can link to the workbench without knowing a
// kernel-assigned port; if it is taken we fall back and record what we actually got.
const DEFAULT_PORT = 47821;
const DATA_FILES = ['study.yaml', 'codebook.yaml', 'extracts.jsonl', 'themes.yaml', 'inbox.jsonl', 'memos.md'];
const FRAME_RE = /^(?:exact-)?\d{2}-\d{2}-\d{2}\.(?:jpg|jpeg|png|webp)$/i;
const LOCK_STALE_MS = 10_000;
// Mirrors CLAIM_STALE_MINUTES in ta.py: after this, a claim from a dead `apply` is one the
// researcher may discard from the drawer.
const CLAIM_STALE_MS = 15 * 60_000;

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

// ---------- trust boundary ----------
// An analysis folder is one that holds study.yaml. Symlinks are resolved first, so a
// link pointing somewhere else cannot smuggle a different directory past the check.
function validateAnalysis(p) {
  if (typeof p !== 'string' || !p) return null;
  try {
    const real = fs.realpathSync(path.resolve(p));
    if (!fs.statSync(real).isDirectory()) return null;
    if (!fs.existsSync(path.join(real, 'study.yaml'))) return null;
    return real;
  } catch {
    return null;
  }
}

// A file the daemon may read on behalf of a page: it must sit inside `dir` after both
// paths are resolved. Used for transcripts and for frame images.
function insideDir(dir, file) {
  try {
    const base = fs.realpathSync(dir);
    const target = fs.realpathSync(path.resolve(base, file));
    return target === base || target.startsWith(base + path.sep) ? target : null;
  } catch {
    return null;
  }
}

// ---------- ta.py ----------
let runner = null; // 'uv' | 'python3', decided once and reused
function taArgv(dir, args) {
  if (runner === 'python3') return ['python3', [TA, '-d', dir, ...args]];
  return ['uv', ['run', '--quiet', TA, '-d', dir, ...args]];
}

function taSyncProbe() {
  for (const cand of ['uv', 'python3']) {
    try {
      execFileSync(cand, ['--version'], { stdio: 'ignore' });
      return cand;
    } catch {
      /* next */
    }
  }
  return null;
}

function runTa(dir, args, { json = true } = {}) {
  if (runner === null) {
    runner = taSyncProbe();
    if (runner === null) return Promise.reject(new Error('neither uv nor python3 is on PATH; the workbench needs one to run ta.py'));
  }
  const [bin, argv] = taArgv(dir, args);
  return new Promise((resolve, reject) => {
    execFile(bin, argv, { maxBuffer: 64 * 1024 * 1024, cwd: dir }, (err, stdout, stderr) => {
      // ta.py exits non-zero to report findings (validate/verify/apply), so a non-zero
      // exit with usable stdout is a result, not a failure.
      if (err && !stdout) return reject(new Error((stderr || String(err)).slice(0, 4000)));
      if (!json) return resolve(stdout);
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`ta.py ${args.join(' ')} did not return JSON: ${(stderr || stdout || String(e)).slice(0, 2000)}`));
      }
    });
  });
}

// ---------- caches, invalidated by mtime ----------
const stamps = (dir, extra = []) =>
  [...DATA_FILES.map((f) => path.join(dir, f)), ...extra]
    .map((f) => {
      try {
        return `${f}:${fs.statSync(f).mtimeMs}`;
      } catch {
        return `${f}:-`;
      }
    })
    .join('|');

const bundleCache = new Map(); // dir -> {key, value}
const transcriptCache = new Map(); // dir::tid -> {key, value}

async function getBundle(dir) {
  const key = stamps(dir);
  const hit = bundleCache.get(dir);
  if (hit && hit.key === key) return hit.value;
  const value = await runTa(dir, ['bundle']);
  bundleCache.set(dir, { key, value });
  return value;
}

async function getTranscript(dir, tid) {
  const b = await getBundle(dir);
  const file = b.transcript_files?.[tid]?.abs_path;
  const key = stamps(dir, file ? [file] : []);
  const ck = `${dir}::${tid}`;
  const hit = transcriptCache.get(ck);
  if (hit && hit.key === key) return hit.value;
  const value = await runTa(dir, ['transcript', tid, '--json']);
  transcriptCache.set(ck, { key, value });
  return value;
}

const invalidate = (dir) => {
  bundleCache.delete(dir);
  for (const k of [...transcriptCache.keys()]) if (k.startsWith(`${dir}::`)) transcriptCache.delete(k);
};

// ---------- the inbox: the one file the browser can change ----------
// The same create-exclusive lockfile protocol ta.py uses — same filename, same
// {pid, token, at} contents, same two rules — so the daemon and the script can never
// interleave a read-modify-write on the inbox: a lock is stolen only when it is stale AND
// its owner is gone, and released only by the process whose token is in the file.
// Tolerates a lockfile written by the first version of this protocol (a bare pid).
const lockHolder = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').trim();
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text || '{}');
    if (typeof parsed === 'number') return { pid: parsed };
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return /^\d+$/.test(text) ? { pid: Number(text) } : {};
  }
};

const alive = (pid) => {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // someone else's process, but it exists
  }
};

async function withInboxLock(dir, fn) {
  const lock = path.join(dir, '.inbox.lock');
  const token = randomBytes(8).toString('hex');
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Infinity;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch (err) {
        if (err.code === 'ENOENT') continue; // vanished between the two calls; try again
      }
      const holder = lockHolder(lock);
      if (age > LOCK_STALE_MS && !alive(Number(holder.pid))) {
        // Rename, don't unlink: renaming is atomic, so of two contenders that both saw the
        // stale file only one wins, and the loser cannot delete the winner's fresh lock.
        const aside = `${lock}.stale-${token}`;
        try {
          fs.renameSync(lock, aside);
          fs.unlinkSync(aside);
        } catch {
          /* someone else won the rename */
        }
        continue;
      }
      if (Date.now() > deadline)
        throw new Error(`the inbox is locked by another process${holder.pid ? ` (pid ${holder.pid})` : ''}; try again in a moment`);
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  try {
    return await fn();
  } finally {
    const holder = fs.existsSync(lock) ? lockHolder(lock) : null;
    if (!holder || holder.token === token) {
      try {
        fs.unlinkSync(lock);
      } catch {
        /* ignore */
      }
    }
  }
}

// A line that will not parse is kept as `{__raw}` rather than dropped: the daemon rewrites
// this file on undo and on resolve, and a hand-edited or truncated line must survive that so
// `ta.py inbox` can still report it. Mirrors read_inbox/write_inbox in the script.
const readJsonl = (file) => {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { __raw: l };
        }
      });
  } catch {
    return [];
  }
};

const serializeRow = (o) => (o && typeof o.__raw === 'string' ? o.__raw : JSON.stringify(o));
const writeJsonl = (file, rows) => fs.writeFileSync(file, rows.map(serializeRow).join('\n') + (rows.length ? '\n' : ''), 'utf8');

// Mirrors ta.py's next_op_id: the highest op-N across the inbox and every applied log.
// Ids are never reused, so this looks at the inbox and every applied log — and at the raw
// text of a line that would not parse, since a truncated `{"id":"op-0042"...` still spent
// that number. Mirrors next_op_id in ta.py.
function nextOpId(dir) {
  let top = 0;
  const pools = [readJsonl(path.join(dir, 'inbox.jsonl'))];
  const reviews = path.join(dir, 'reviews');
  try {
    for (const f of fs.readdirSync(reviews)) if (f.endsWith('-applied.jsonl')) pools.push(readJsonl(path.join(reviews, f)));
  } catch {
    /* no reviews dir yet */
  }
  for (const pool of pools) {
    for (const o of pool) {
      const m = /^op-(\d+)$/.exec(String(o.id ?? ''));
      if (m) top = Math.max(top, Number(m[1]));
      if (typeof o.__raw === 'string') {
        for (const raw of o.__raw.matchAll(/op-(\d+)/g)) top = Math.max(top, Number(raw[1]));
      }
    }
  }
  return `op-${String(top + 1).padStart(4, '0')}`;
}

const nowStamp = () => new Date().toISOString().slice(0, 16);

// ===================================================================
// DAEMON
// ===================================================================
async function runServer() {
  const { default: express } = await import('express');
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // CSRF / DNS-rebinding guard, as in the plan viewer: same-origin localhost only.
  app.use((req, res, next) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const okHost = host === 'localhost' || host === '127.0.0.1';
    let okOrigin = true;
    if (req.headers.origin) {
      try {
        const h = new URL(req.headers.origin).hostname;
        okOrigin = h === 'localhost' || h === '127.0.0.1';
      } catch {
        okOrigin = false;
      }
    }
    if (!okHost || !okOrigin) return res.status(403).json({ error: 'cross-origin blocked' });
    next();
  });

  const folders = new Map(); // abs dir -> {lastSeen}
  const register = (dir) => folders.set(dir, { lastSeen: Date.now() });
  const need = (req, res, where = 'query') => {
    const dir = validateAnalysis(where === 'query' ? req.query.analysis : req.body?.analysis);
    if (!dir) {
      res.status(400).json({ error: 'not an analysis folder (no study.yaml)' });
      return null;
    }
    register(dir);
    return dir;
  };
  // A missing or mistyped target is the caller's problem (4xx); anything else is ours.
  const fail = (res) => (e) => {
    const msg = String(e.message ?? e);
    const code = /^no (pending operation|operation|such)/.test(msg)
      ? 404
      : /is a .* operation, not a comment thread|^bad /.test(msg)
        ? 400
        : /locked by another process/.test(msg)
          ? 409   // a conflict the caller should simply retry
          : 500;
    res.status(code).json({ error: msg });
  };

  app.get('/api/status', (_req, res) =>
    res.json({ running: true, port: server.address().port, pid: process.pid, startedAt, folders: [...folders.keys()] }),
  );

  app.post('/api/register', (req, res) => {
    const dir = need(req, res, 'body');
    if (dir) res.json({ ok: true, analysis: dir });
  });

  app.post('/api/shutdown', (_req, res) => {
    res.json({ ok: true });
    setTimeout(() => {
      clearPidfile();
      process.exit(0);
    }, 50);
  });

  app.get('/api/data', (req, res) => {
    const dir = need(req, res);
    if (!dir) return;
    getBundle(dir)
      .then((b) => res.json(b))
      .catch(fail(res));
  });

  app.get('/api/transcript', (req, res) => {
    const dir = need(req, res);
    if (!dir) return;
    const tid = String(req.query.t ?? '');
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(tid)) return res.status(400).json({ error: 'bad transcript id' });
    getTranscript(dir, tid)
      .then((t) => res.json(t))
      .catch(fail(res));
  });

  app.get('/api/collate', (req, res) => {
    const dir = need(req, res);
    if (!dir) return;
    const target = String(req.query.target ?? '');
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(target)) return res.status(400).json({ error: 'bad target' });
    runTa(dir, ['collate', target, '--json'])
      .then((c) => res.json(c))
      .catch(fail(res));
  });

  app.get('/api/audit', (req, res) => {
    const dir = need(req, res);
    if (!dir) return;
    Promise.all([runTa(dir, ['validate', '--json']), runTa(dir, ['verify', '--json'])])
      .then(([validate, verify]) => res.json({ validate, verify }))
      .catch(fail(res));
  });

  app.get('/api/mermaid', (req, res) => {
    const dir = need(req, res);
    if (!dir) return;
    runTa(dir, ['theme', 'mermaid'], { json: false })
      .then((text) => res.json({ mermaid: text }))
      .catch(fail(res));
  });

  // A frame from the recording folder beside the transcript. Served from its path —
  // nothing is inlined — and only from that folder, after both paths are resolved.
  app.get('/api/frame', (req, res) => {
    const dir = need(req, res);
    if (!dir) return;
    const tid = String(req.query.t ?? '');
    getBundle(dir)
      .then((b) => {
        // The bundle is cached on the analysis data files' mtimes, and a frame grid appears
        // beside the *transcript* — often after the analysis folder was first read. Trusting the
        // cached `frames_dir` there means every frame 404s until something else invalidates the
        // bundle, while the header cheerfully reports "25 frames". Re-resolve when it is missing.
        let fdir = b.transcript_files?.[tid]?.frames_dir;
        if (!fdir) {
          const abs = b.transcript_files?.[tid]?.abs_path;
          const guess = abs ? path.join(path.dirname(abs), 'video-snapshots') : null;
          if (guess && fs.existsSync(guess)) fdir = guess;
        }
        if (!fdir) return res.status(404).json({ error: 'no video-snapshots folder beside this transcript' });
        let file = req.query.file ? String(req.query.file) : null;
        if (!file && req.query.at) {
          const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(req.query.at));
          if (!m) return res.status(400).json({ error: 'at must be HH:MM:SS' });
          const want = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          const rows = fs
            .readdirSync(fdir)
            .filter((f) => FRAME_RE.test(f))
            .map((f) => {
              const p = /(\d{2})-(\d{2})-(\d{2})\./.exec(f);
              return { f, s: Number(p[1]) * 3600 + Number(p[2]) * 60 + Number(p[3]) };
            })
            .sort((a, b2) => a.s - b2.s);
          const at = [...rows].reverse().find((r) => r.s <= want) ?? rows[0];
          file = at?.f ?? null;
        }
        if (!file || !FRAME_RE.test(file)) return res.status(400).json({ error: 'bad frame name' });
        const abs = insideDir(fdir, file);
        if (!abs) return res.status(404).json({ error: 'no such frame' });
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.sendFile(abs);
      })
      .catch(fail(res));
  });

  app.post('/api/inbox', (req, res) => {
    const dir = need(req, res, 'body');
    if (!dir) return;
    const { op, target, args, note, by, view } = req.body?.op ?? {};
    if (typeof op !== 'string' || !op) return res.status(400).json({ error: 'op name required' });
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args)))
      return res.status(400).json({ error: 'args must be an object' });
    withInboxLock(dir, async () => {
      const line = {
        id: nextOpId(dir),
        at: nowStamp(),
        by: by === 'agent' ? 'agent' : 'user',
        view: typeof view === 'string' ? view : 'any',
        op,
        target: target ?? null,
        args: args ?? {},
        note: note ?? null,
        status: 'pending',
      };
      fs.appendFileSync(path.join(dir, 'inbox.jsonl'), JSON.stringify(line) + '\n', 'utf8');
      return line;
    })
      .then((line) => {
        invalidate(dir);
        res.json(line);
      })
      .catch(fail(res));
  });

  // Undo before hand-off: drop a pending line the researcher staged by mistake — or discard
  // a whole comment thread, which resolving deliberately does not do.
  app.delete('/api/inbox', (req, res) => {
    const dir = need(req, res, 'body');
    if (!dir) return;
    const id = String(req.body?.id ?? '');
    const withReplies = req.body?.withReplies === true;
    withInboxLock(dir, async () => {
      const file = path.join(dir, 'inbox.jsonl');
      const rows = readJsonl(file);
      const row = rows.find((o) => o.id === id);
      if (!row) throw new Error(`no pending operation ${id}`);
      // A claim from a run that died is discardable too — the workbench shows it as stalled.
      const discardable = (o) =>
        o.status == null ||
        o.status === 'pending' ||
        o.status === 'failed' ||
        o.status === 'stalled' ||
        (o.status === 'applying' && Date.now() - Date.parse(o.claimed_at ?? 0) > CLAIM_STALE_MS);
      // A thread is conversation, never applied, so it can be discarded at any status —
      // including resolved, which is the case resolving alone cannot cover.
      const isThread = row.op === 'comment' || row.op === 'reply';
      if (!isThread && !discardable(row)) throw new Error(`no pending operation ${id}`);
      const doomed = new Set([id]);
      if (withReplies && row.op === 'comment') {
        for (const o of rows) if (o.op === 'reply' && o.target === id) doomed.add(o.id);
      }
      const keep = rows.filter((o) => !doomed.has(o.id));
      writeJsonl(file, keep);
      return { removed: [...doomed], remaining: keep.length };
    })
      .then((out) => {
        invalidate(dir);
        res.json(out);
      })
      .catch(fail(res));
  });

  // Resolving a thread is the researcher's action, as in the plan viewer.
  app.patch('/api/inbox', (req, res) => {
    const dir = need(req, res, 'body');
    if (!dir) return;
    const id = String(req.body?.id ?? '');
    const status = String(req.body?.status ?? '');
    if (!['resolved', 'pending'].includes(status)) return res.status(400).json({ error: 'status must be resolved | pending' });
    withInboxLock(dir, async () => {
      const file = path.join(dir, 'inbox.jsonl');
      const rows = readJsonl(file);
      const row = rows.find((o) => o.id === id);
      if (!row) throw new Error(`no operation ${id}`);
      if (row.op !== 'comment') throw new Error(`${id} is a ${row.op} operation, not a comment thread`);
      row.status = status;
      row.resolved_by = status === 'resolved' ? 'user' : null;
      row.resolved_at = status === 'resolved' ? nowStamp() : null;
      writeJsonl(file, rows);
      return row;
    })
      .then((row) => {
        invalidate(dir);
        res.json(row);
      })
      .catch(fail(res));
  });

  // Open a transcript in the user's editor at a line — the workbench's escape hatch
  // to the raw file, restricted to files this analysis folder actually names.
  app.post('/api/open', (req, res) => {
    const dir = need(req, res, 'body');
    if (!dir) return;
    const tid = String(req.body?.t ?? '');
    const line = Math.max(1, Number(req.body?.line ?? 1) | 0);
    getBundle(dir)
      .then((b) => {
        const abs = b.transcript_files?.[tid]?.abs_path;
        if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'no such transcript' });
        const tokens = (readConfig().editorCommand || 'zed {path}:{line}:{col}').split(' ');
        const argv = tokens.map((t) => t.replace('{path}', abs).replace('{line}', String(line)).replace('{col}', '1'));
        const bin = argv.shift();
        try {
          spawn(bin, argv, { detached: true, stdio: 'ignore' }).unref();
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ error: String(e) });
        }
      })
      .catch(fail(res));
  });

  app.get('/api/config', (_req, res) => res.json(readConfig()));

  // Live reload: one stream per tab, telling it which file moved. Two tabs on the same
  // folder therefore agree about the pending drawer the moment either one stages an op.
  app.get('/api/events', (req, res) => {
    const dir = validateAnalysis(req.query.analysis);
    if (!dir) return res.status(400).end();
    register(dir);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    let debounce = null;
    const changed = new Set();
    const watchers = [];
    const emit = () => {
      const files = [...changed];
      changed.clear();
      invalidate(dir);
      res.write(`event: change\ndata: ${JSON.stringify({ files })}\n\n`);
    };
    const note = (name) => {
      changed.add(name ?? '?');
      clearTimeout(debounce);
      debounce = setTimeout(emit, 150);
    };
    try {
      watchers.push(fs.watch(dir, (_type, name) => note(name)));
    } catch {
      /* folder vanished */
    }
    getBundle(dir)
      .then((b) => {
        for (const t of Object.values(b.transcript_files ?? {})) {
          if (!t.abs_path || !fs.existsSync(t.abs_path)) continue;
          try {
            watchers.push(fs.watch(t.abs_path, () => note(path.basename(t.abs_path))));
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {});
    const keepalive = setInterval(() => res.write(': ka\n\n'), 25000);
    req.on('close', () => {
      clearInterval(keepalive);
      clearTimeout(debounce);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
    });
  });

  const dist = path.join(__dirname, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const startedAt = new Date().toISOString();
  const announce = () => {
    const port = server.address().port;
    fs.writeFileSync(PIDFILE, JSON.stringify({ port, pid: process.pid, startedAt }));
    console.log(`[ta-workbench] daemon on http://localhost:${port} (pid ${process.pid})`);
  };
  // Prefer the conventional port; if something else holds it (a live daemon would have
  // been reused before we got here), take whatever the kernel gives us and record that.
  let server = app.listen(DEFAULT_PORT, '127.0.0.1');
  server.on('listening', announce);
  server.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.error(`[ta-workbench] port ${DEFAULT_PORT} is taken; using a kernel-assigned port`);
    server = app.listen(0, '127.0.0.1');
    server.on('listening', announce);
    server.on('error', (err) => {
      throw err;
    });
  });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => (clearPidfile(), process.exit(0)));
  process.on('exit', clearPidfile);
}

// ===================================================================
// CLI
// ===================================================================
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

function ensureBuilt() {
  const pm = (() => {
    try {
      execFileSync('bun', ['--version'], { stdio: 'ignore' });
      return 'bun';
    } catch {
      return 'npm';
    }
  })();
  if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
    console.error('[ta-workbench] installing deps (first run)…');
    execFileSync(pm, ['install'], { cwd: __dirname, stdio: 'inherit' });
  }
  if (!fs.existsSync(path.join(__dirname, 'dist'))) {
    console.error('[ta-workbench] building the workbench (first run)…');
    execFileSync(pm, ['run', 'build'], { cwd: __dirname, stdio: 'inherit' });
  }
}

async function ensureDaemon() {
  const live = await ping();
  if (live) return live;
  clearPidfile();
  ensureBuilt();
  const out = fs.openSync(LOGFILE, 'a');
  spawn('node', [fileURLToPath(import.meta.url), '--serve'], { detached: true, stdio: ['ignore', out, out] }).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const p = await ping();
    if (p) return p;
  }
  throw new Error('the daemon did not start; see ' + LOGFILE);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--serve')) return runServer();  // async: the express import is lazy

  if (argv.includes('--status')) {
    const live = await ping();
    console.log(JSON.stringify(live ? { running: true, ...live } : { running: false }, null, 2));
    return;
  }

  if (argv.includes('--stop')) {
    const pf = readPidfile();
    if (await ping()) {
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
    console.log('[ta-workbench] stopped.');
    return;
  }

  const dirArg = argv.find((a) => !a.startsWith('--'));
  if (!dirArg) {
    console.error('usage: node server.mjs <analysis-dir> [--params "view=transcript&t=T-07"] [--no-open] | --status | --stop');
    process.exit(1);
  }
  const dir = validateAnalysis(dirArg);
  if (!dir) {
    console.error(`[ta-workbench] not an analysis folder (no study.yaml): ${dirArg}`);
    process.exit(1);
  }
  const daemon = await ensureDaemon();
  try {
    await fetch(`http://127.0.0.1:${daemon.port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ analysis: dir }),
    });
  } catch {
    /* non-fatal */
  }
  const pi = argv.indexOf('--params');
  const params = pi >= 0 ? argv[pi + 1] ?? '' : '';
  const url = `http://localhost:${daemon.port}/?analysis=${encodeURIComponent(dir)}${params ? '&' + params : ''}`;
  console.log(`[ta-workbench] ${url}`);
  if (daemon.port !== DEFAULT_PORT) console.log(`[ta-workbench] note: on ${daemon.port}, not the usual ${DEFAULT_PORT}`);
  console.log(`[ta-workbench] daemon pid ${daemon.pid} — stop with: node server.mjs --stop`);
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
