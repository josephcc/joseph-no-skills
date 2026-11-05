import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { log } from './log.ts';

interface OriginStore { allowed: string[]; denied: string[] }

/**
 * Which page origins may talk to the daemon. Browsers set the WebSocket `Origin` header
 * and page JavaScript cannot forge it, so an allow-list of origins is the boundary against
 * other web pages reaching Claude Code through us (plan §5.5, D-8).
 */
export class OriginPolicy {
  readonly #file: string;
  #store: OriginStore = { allowed: [], denied: [] };
  readonly #pending = new Map<string, { origin: string; resolve: (ok: boolean) => void; title?: string; createdAt: number }>();

  readonly #preapproved: string[];
  readonly #noBrowser: boolean;
  readonly #baseUrl: string;
  readonly #open: (url: string) => void;

  constructor(stateDir: string, preapproved: string[], noBrowser: boolean, baseUrl: string, opener: (url: string) => void = openInBrowser) {
    this.#preapproved = preapproved; this.#noBrowser = noBrowser; this.#baseUrl = baseUrl; this.#open = opener;
    mkdirSync(stateDir, { recursive: true });
    this.#file = join(stateDir, 'origins.json');
    try { this.#store = JSON.parse(readFileSync(this.#file, 'utf8')) as OriginStore; } catch { /* first run */ }
  }

  isAllowed(origin: string): boolean { return this.#preapproved.includes(origin) || this.#store.allowed.includes(origin); }
  isDenied(origin: string): boolean { return this.#store.denied.includes(origin); }

  /** Resolve the decision for an unknown origin: opens the approval page and waits (up to 5 minutes). */
  async decide(origin: string, title?: string): Promise<boolean> {
    if (!isSiteOrigin(origin)) { log.warn(`origin ${JSON.stringify(origin)} is not an http(s) site origin: rejecting`); return false; }
    if (this.isAllowed(origin)) return true;
    if (this.isDenied(origin)) return false;
    if (this.#noBrowser) { log.warn(`origin ${origin} unknown and --no-browser set: rejecting`); return false; }
    const id = randomUUID();
    const decision = new Promise<boolean>((resolve) => this.#pending.set(id, { origin, resolve, title, createdAt: Date.now() }));
    const url = `${this.#baseUrl}/approve?id=${id}`;
    log.info(`origin ${origin} wants to connect; opening ${url}`);
    this.#open(url);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5 * 60_000));
    const ok = await Promise.race([decision, timeout]);
    this.#pending.delete(id);
    return ok;
  }

  pending(id: string): { origin: string; title?: string } | undefined {
    const p = this.#pending.get(id); return p ? { origin: p.origin, title: p.title } : undefined;
  }

  settle(id: string, allow: boolean, remember: boolean): boolean {
    const p = this.#pending.get(id); if (!p) return false;
    if (remember) {
      const list = allow ? this.#store.allowed : this.#store.denied;
      if (!list.includes(p.origin)) list.push(p.origin);
      this.#save();
    }
    p.resolve(allow);
    this.#pending.delete(id);
    return true;
  }

  forget(origin: string): void {
    this.#store.allowed = this.#store.allowed.filter((o) => o !== origin);
    this.#store.denied = this.#store.denied.filter((o) => o !== origin);
    this.#save();
  }

  snapshot(): OriginStore & { preapproved: string[] } { return { ...this.#store, preapproved: this.#preapproved }; }

  #save() { writeFileSync(this.#file, JSON.stringify(this.#store, null, 2)); }
}

/** A real site origin: http(s) scheme, normalised form, never the opaque "null" of sandboxed iframes, data:, blob: or file: contexts. */
export function isSiteOrigin(origin: string): boolean {
  try { const u = new URL(origin); return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === origin; } catch { return false; }
}

function openInBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref(); } catch (err) { log.warn(`could not open browser: ${String(err)}`); }
}

export function approvalPageHtml(id: string, origin: string, title?: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<!doctype html><meta charset="utf-8"><title>webmcp-daemon: approve origin</title>
<style>body{font:16px/1.5 system-ui;margin:3rem auto;max-width:36rem;padding:0 1rem}code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px}button{font:inherit;padding:.6rem 1.2rem;margin-right:.5rem;border-radius:6px;border:1px solid #888;cursor:pointer}.allow{background:#0a7;color:#fff;border-color:#0a7}label{display:block;margin:1rem 0}.muted{color:#666}</style>
<h1>A web page wants to use your local Claude</h1>
<p><strong>${esc(title ?? '(untitled page)')}</strong> at <code>${esc(origin)}</code> asked to connect to the webmcp-daemon on this computer.</p>
<p class="muted">If you allow it, that page can expose its tools to Claude Code and, if it embeds a chat, start Claude Code sessions that act on the page. Only allow origins you trust.</p>
<label><input type="checkbox" id="remember" checked> Remember this decision for <code>${esc(origin)}</code></label>
<p><button class="allow" onclick="go(true)">Allow</button><button onclick="go(false)">Deny</button></p>
<p id="out" class="muted"></p>
<script>
async function go(allow){const remember=document.getElementById('remember').checked;
const r=await fetch('/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:${JSON.stringify(id)},allow,remember})});
document.getElementById('out').textContent=r.ok?(allow?'Allowed. You can close this tab.':'Denied. You can close this tab.'):'This request has expired; reload the page that asked.';}
</script>`;
}
