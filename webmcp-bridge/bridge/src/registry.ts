import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { ToolInfo } from 'webmcp-protocol';

export interface PageLink {
  call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string | null>;
  requestContext(): Promise<string>;
  close(reason: string): void;
}

export interface PageRecord {
  id: string;
  origin: string;
  url: string;
  title: string;
  slug: string;
  tools: ToolInfo[];
  instructions?: string;
  instructionsSummary?: string;
  hasContext: boolean;
  contextCache?: { text: string; at: number };
  visible: boolean;
  connectedAt: number;
  lastActiveAt: number;
  link: PageLink;
}

export type RegistryEvent = 'change' | 'selection';

/**
 * Pages currently connected over /ws, their tools, and which page terminal Claude is
 * "looking at" (the selected page). Emits 'change' when any tool list, instructions or
 * membership changes, and 'selection' when the selected page changes.
 */
export class Registry extends EventEmitter {
  readonly #pages = new Map<string, PageRecord>();
  #pinned: string | undefined;

  add(input: Omit<PageRecord, 'id' | 'slug' | 'tools' | 'visible' | 'connectedAt' | 'lastActiveAt'>): PageRecord {
    const now = Date.now();
    const page: PageRecord = { ...input, id: randomUUID().slice(0, 8), slug: slugify(input.origin), tools: [], visible: true, connectedAt: now, lastActiveAt: now };
    this.#pages.set(page.id, page);
    this.#emitChange(page.id);
    return page;
  }

  remove(id: string): void {
    if (!this.#pages.delete(id)) return;
    if (this.#pinned === id) this.#pinned = undefined;
    this.#emitChange(id);
  }

  get(id: string): PageRecord | undefined { return this.#pages.get(id); }
  all(): PageRecord[] { return [...this.#pages.values()]; }

  setTools(id: string, tools: ToolInfo[]): void {
    const page = this.#pages.get(id); if (!page) return;
    page.tools = tools; page.lastActiveAt = Date.now();
    this.#emitChange(id);
  }

  setInstructions(id: string, instructions?: string, summary?: string): void {
    const page = this.#pages.get(id); if (!page) return;
    page.instructions = instructions; page.instructionsSummary = summary;
    this.emit('change', { pageId: id, kind: 'instructions' });
  }

  setVisible(id: string, visible: boolean): void {
    const page = this.#pages.get(id); if (!page) return;
    page.visible = visible; if (visible) page.lastActiveAt = Date.now();
    this.#emitSelectionIfChanged();
  }

  touch(id: string): void { const p = this.#pages.get(id); if (p) p.lastActiveAt = Date.now(); }

  /** Pin a page as the selected one (webmcp_use_page). */
  select(id: string): PageRecord {
    const page = this.#pages.get(id);
    if (!page) throw new Error(`no page ${id}`);
    this.#pinned = id;
    this.#emitSelectionIfChanged();
    return page;
  }

  /** Pinned page, else the most recently active *visible* page with tools, else the most recently active page with tools. */
  selected(): PageRecord | undefined {
    if (this.#pinned && this.#pages.has(this.#pinned)) return this.#pages.get(this.#pinned);
    const withTools = this.all().filter((p) => p.tools.length > 0);
    const byActivity = (a: PageRecord, b: PageRecord) => b.lastActiveAt - a.lastActiveAt;
    return withTools.filter((p) => p.visible).sort(byActivity)[0] ?? withTools.sort(byActivity)[0];
  }

  /** Resolve a page by id prefix or exact id; undefined id → selected page. */
  resolve(pageId?: string): PageRecord | undefined {
    if (!pageId || pageId === 'selected') return this.selected();
    return this.#pages.get(pageId) ?? this.all().find((p) => p.id.startsWith(pageId));
  }

  #lastSelected: string | undefined;
  #emitChange(pageId: string) {
    this.emit('change', { pageId, kind: 'tools' });
    this.#emitSelectionIfChanged();
  }
  #emitSelectionIfChanged() {
    const now = this.selected()?.id;
    if (now !== this.#lastSelected) { this.#lastSelected = now; this.emit('selection', { pageId: now }); }
  }
}

export function slugify(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/[^A-Za-z0-9.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'page';
}
