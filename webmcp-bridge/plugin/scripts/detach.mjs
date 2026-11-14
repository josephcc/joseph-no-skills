// Portable "start this command detached" (macOS has no setsid): new process group, no inherited stdio,
// output appended to the log file given as the first argument. Usage: node detach.mjs <logfile> -- <cmd> [args...]
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
const [logFile, sep, cmd, ...args] = process.argv.slice(2);
if (sep !== '--' || !cmd) { console.error('usage: detach.mjs <logfile> -- <cmd> [args...]'); process.exit(2); }
const fd = openSync(logFile, 'a');
const child = spawn(cmd, args, { detached: true, stdio: ['ignore', fd, fd], env: process.env });
child.unref();
console.log(String(child.pid));
