import { PING_INTERVAL_MS, type DaemonFrame, type PageFrame } from './protocol.ts';

export interface LinkEvents {
  open: () => void;
  frame: (frame: DaemonFrame) => void;
  close: (info: { code: number; reason: string; wasClean: boolean; openedBefore: boolean }) => void;
  error: (message: string) => void;
}

/**
 * One WebSocket to the daemon with the small amount of state the protocol needs:
 * answers pings, surfaces frames, and tells the caller how the connection ended so
 * the retry policy can distinguish "nothing listening" from "refused" from "dropped".
 */
export class DaemonLink {
  #ws: WebSocket | undefined;
  #openedAt: number | undefined;
  #handlers: Partial<LinkEvents> = {};
  #watchdog: ReturnType<typeof setTimeout> | undefined;
  readonly #url: string;

  constructor(url: string) { this.#url = url; }

  on<K extends keyof LinkEvents>(event: K, handler: LinkEvents[K]): void {
    this.#handlers[event] = handler;
  }

  get isOpen(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  open(): void {
    this.close();
    const ws = new WebSocket(this.#url);
    this.#ws = ws;
    this.#openedAt = undefined;
    ws.onopen = () => {
      this.#openedAt = Date.now();
      this.#armWatchdog();
      this.#handlers.open?.();
    };
    ws.onmessage = (ev) => {
      this.#armWatchdog();
      let frame: DaemonFrame;
      try { frame = JSON.parse(String(ev.data)) as DaemonFrame; } catch { return; }
      if (frame.type === 'ping') { this.send({ type: 'pong' }); return; }
      this.#handlers.frame?.(frame);
    };
    ws.onerror = () => this.#handlers.error?.('websocket error');
    ws.onclose = (ev) => {
      if (this.#ws !== ws) return;
      clearTimeout(this.#watchdog);
      this.#ws = undefined;
      this.#handlers.close?.({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean, openedBefore: this.#openedAt !== undefined });
    };
  }

  send(frame: PageFrame): boolean {
    if (!this.isOpen) return false;
    this.#ws!.send(JSON.stringify(frame));
    return true;
  }

  close(): void {
    const ws = this.#ws;
    this.#ws = undefined;
    clearTimeout(this.#watchdog);
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.onclose = null;
      ws.close();
    }
  }

  /** The daemon pings every PING_INTERVAL_MS; if nothing arrives for 3 intervals, assume the link is dead. */
  #armWatchdog() {
    clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(() => {
      const ws = this.#ws;
      if (!ws) return;
      this.#ws = undefined;
      ws.onclose = null;
      ws.close();
      this.#handlers.close?.({ code: 4000, reason: 'ping timeout', wasClean: false, openedBefore: true });
    }, PING_INTERVAL_MS * 3);
  }
}
