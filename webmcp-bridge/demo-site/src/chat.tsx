import { createRoot } from 'react-dom/client';
import { AgentChat } from 'webmcp-connector/react';
import type { PageConnection } from 'webmcp-connector';

export function mountChat(el: HTMLElement, page: PageConnection) {
  createRoot(el).render(
    <AgentChat
      page={page}
      title="Local Claude on this page"
      setup={{ steps: [
        'Install the Claude Code plugin and run `claude` once. The daemon starts, an "webmcp-bridge" item appears in the menu bar, and Claude offers to start it at login (or use the menu bar item). Then close that terminal.',
        'Developers: `bun run daemon -- --allow-origin http://127.0.0.1:5173`.',
      ] }}
      onHandle={(h) => { (window as unknown as { __demo: Record<string, unknown> }).__demo.agent = h; }}
    />,
  );
}
