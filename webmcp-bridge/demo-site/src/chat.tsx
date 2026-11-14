import { createRoot } from 'react-dom/client';
import { AgentChat, FloatingWidgetPanel } from 'webmcp-connector/react';
import type { PageConnection } from 'webmcp-connector';
import { WIDGETS } from './widgets.tsx';

export function mountChat(el: HTMLElement, page: PageConnection) {
  createRoot(el).render(
    <AgentChat
      page={page}
      title="Local Claude on this page"
      widgets={WIDGETS}
      setup={{ steps: [
        'Install the Claude Code plugin and run `claude` once. The daemon starts, an "webmcp-bridge" item appears in the menu bar, and Claude offers to start it at login (or use the menu bar item). Then close that terminal.',
        'Developers: `bun run daemon -- --allow-origin http://127.0.0.1:5173`.',
      ] }}
      onHandle={(h) => { (window as unknown as { __demo: Record<string, unknown> }).__demo.agent = h; }}
    />,
  );
}

/** Cards for page tool calls that did not come through the chat (terminal Claude), bottom-right of the page. */
export function mountFloatingPanel(page: PageConnection) {
  const el = document.createElement('div');
  el.id = 'floating-widgets';
  document.body.appendChild(el);
  createRoot(el).render(<FloatingWidgetPanel page={page} widgets={WIDGETS} />);
}
