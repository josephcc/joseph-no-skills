/** Self-contained styles for <AgentChat>, injected once; no Tailwind or CSS import required of the host app (D-21). */
export const AGENT_CHAT_CSS = `
.wmc-chat{--wmc-bg:#fff;--wmc-fg:#1a1a1a;--wmc-muted:#6b7280;--wmc-border:#e5e7eb;--wmc-accent:#2563eb;--wmc-user:#eef2ff;--wmc-tool:#f8fafc;--wmc-warn:#fff7ed;--wmc-err:#b91c1c;--wmc-ok:#047857;
  display:flex;flex-direction:column;background:var(--wmc-bg);color:var(--wmc-fg);border:1px solid var(--wmc-border);border-radius:10px;font:14px/1.5 system-ui,sans-serif;min-height:24rem;max-height:70vh;overflow:hidden}
.wmc-head{display:flex;align-items:center;gap:.6rem;padding:.5rem .8rem;border-bottom:1px solid var(--wmc-border);background:#fafafa}
.wmc-head h3{margin:0;font-size:.95rem;font-weight:600;flex:1}
.wmc-badge{font-size:.75rem;padding:.1rem .5rem;border-radius:999px;border:1px solid var(--wmc-border);color:var(--wmc-muted)}
.wmc-badge[data-state=ready]{color:var(--wmc-ok);border-color:var(--wmc-ok)}
.wmc-badge[data-state=prompting]{color:var(--wmc-accent);border-color:var(--wmc-accent)}
.wmc-badge[data-state=error]{color:var(--wmc-err);border-color:var(--wmc-err)}
.wmc-chat button{font:inherit;font-size:.8rem;padding:.25rem .6rem;border-radius:6px;border:1px solid var(--wmc-border);background:#fff;cursor:pointer}
.wmc-chat button:hover{border-color:#9ca3af}.wmc-chat button:disabled{opacity:.5;cursor:default}
.wmc-chat button.wmc-primary{background:var(--wmc-accent);border-color:var(--wmc-accent);color:#fff}
.wmc-chat select{font:inherit;font-size:.8rem;padding:.2rem .4rem;border-radius:6px;border:1px solid var(--wmc-border)}
.wmc-log{flex:1;overflow:auto;padding:.8rem;display:flex;flex-direction:column;gap:.6rem}
.wmc-empty{color:var(--wmc-muted);text-align:center;margin:auto;padding:2rem 1rem}
.wmc-msg{max-width:92%;padding:.5rem .75rem;border-radius:10px;white-space:pre-wrap;word-break:break-word}
.wmc-msg.user{align-self:flex-end;background:var(--wmc-user)}
.wmc-msg.agent{align-self:flex-start;background:#f3f4f6;white-space:normal}
.wmc-msg.agent p{margin:.25rem 0}.wmc-msg.agent pre{overflow:auto;background:#111827;color:#f9fafb;padding:.5rem;border-radius:6px;font-size:.85em}
.wmc-msg.agent code{font-family:ui-monospace,monospace;font-size:.9em}
.wmc-thought{align-self:flex-start;color:var(--wmc-muted);font-size:.85rem;max-width:92%}
.wmc-thought summary{cursor:pointer}
.wmc-tool{align-self:stretch;border:1px solid var(--wmc-border);border-left:3px solid var(--wmc-border);border-radius:8px;background:var(--wmc-tool);font-size:.85rem}
.wmc-tool[data-status=completed]{border-left-color:var(--wmc-ok)}.wmc-tool[data-status=failed]{border-left-color:var(--wmc-err)}.wmc-tool[data-status=in_progress],.wmc-tool[data-status=pending]{border-left-color:var(--wmc-accent)}
.wmc-tool summary{padding:.35rem .6rem;cursor:pointer;display:flex;gap:.5rem;align-items:center}
.wmc-tool summary .wmc-kind{color:var(--wmc-muted);font-size:.75rem}
.wmc-tool summary .wmc-status{margin-left:auto;color:var(--wmc-muted);font-size:.75rem}
.wmc-tool pre{margin:0;padding:.5rem .6rem;border-top:1px solid var(--wmc-border);overflow:auto;max-height:14rem;font-size:.8em;white-space:pre-wrap}
.wmc-perm{border:1px solid #fdba74;background:var(--wmc-warn);border-radius:8px;padding:.5rem .75rem;align-self:stretch}
.wmc-perm .wmc-perm-title{font-weight:600;margin-bottom:.3rem}
.wmc-perm pre{max-height:8rem;overflow:auto;font-size:.8em;background:#fff;padding:.3rem .5rem;border-radius:6px}
.wmc-perm .wmc-perm-actions{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.4rem}
.wmc-plan{align-self:stretch;font-size:.85rem;color:var(--wmc-muted)}
.wmc-plan li[data-status=completed]{text-decoration:line-through}
.wmc-stop{align-self:center;color:var(--wmc-muted);font-size:.75rem}
.wmc-input{display:flex;gap:.5rem;padding:.6rem .8rem;border-top:1px solid var(--wmc-border);background:#fafafa}
.wmc-input textarea{flex:1;font:inherit;resize:none;min-height:2.4rem;max-height:8rem;padding:.4rem .6rem;border-radius:8px;border:1px solid var(--wmc-border)}
.wmc-toggle{font-size:.75rem;color:var(--wmc-muted);display:flex;align-items:center;gap:.3rem;white-space:nowrap}
.wmc-commands{list-style:none;margin:0;padding:.3rem;border-top:1px solid var(--wmc-border);background:#fff;max-height:10rem;overflow:auto}
.wmc-commands li{display:flex;gap:.6rem;padding:.25rem .5rem;cursor:pointer;border-radius:6px}.wmc-commands li:hover{background:var(--wmc-user)}.wmc-commands li span{color:var(--wmc-muted);font-size:.8rem}
.wmc-foot{padding:.25rem .8rem;font-size:.72rem;color:var(--wmc-muted);border-top:1px solid var(--wmc-border);display:flex;gap:1rem}
.wmc-error{color:var(--wmc-err);padding:.3rem .8rem;font-size:.85rem}
`;

let injected = false;
export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-webmcp-connector', 'agent-chat');
  el.textContent = AGENT_CHAT_CSS;
  document.head.appendChild(el);
  injected = true;
}
