const started = Date.now();
export const log = {
  info: (msg: string, extra?: unknown) => write('info', msg, extra),
  warn: (msg: string, extra?: unknown) => write('warn', msg, extra),
  error: (msg: string, extra?: unknown) => write('error', msg, extra),
};
function write(level: string, msg: string, extra?: unknown) {
  const t = ((Date.now() - started) / 1000).toFixed(1).padStart(7);
  const tail = extra === undefined ? '' : ' ' + safe(extra);
  process.stderr.write(`[webmcp-bridge ${t}s ${level}] ${msg}${tail}\n`);
}
function safe(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
}
