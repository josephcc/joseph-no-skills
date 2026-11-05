import { createRoot } from 'react-dom/client';
import { AgentChat } from 'webmcp-connector/react';
import type { PageConnection } from 'webmcp-connector';

export function mountChat(el: HTMLElement, page: PageConnection) {
  createRoot(el).render(
    <AgentChat page={page} title="Local Claude on this page" onHandle={(h) => { (window as unknown as { __demo: Record<string, unknown> }).__demo.agent = h; }} />,
  );
}
