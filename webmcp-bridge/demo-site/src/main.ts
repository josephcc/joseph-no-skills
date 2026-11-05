import { connect, preamble, type ConnectorStatus, type ToolCallEvent } from 'webmcp-connector';
import { mountChat, mountFloatingPanel } from './chat.tsx';
import { isCssColor, randomize, render, snapshot, state } from './state.ts';

// ---------- page state (demo-site/src/state.ts; the cards in widgets.tsx use it too) ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = (tag: string, text: string) => { const n = document.createElement(tag); n.textContent = text; return n; };   // text, never HTML
randomize();

// ---------- WebMCP tools (native API, or the connector's shim) ----------
// connect() must run before registerTool so the shim exists in browsers without the flag.
const daemonOverride = new URLSearchParams(location.search).get('daemon') ?? undefined;   // tests point the page at another daemon
const page = connect({
  daemonUrl: daemonOverride,
  title: 'WebMCP demo — colour and sentence',
  instructions: preamble({ pageTitle: 'WebMCP demo' }) + '\n\n' + [
    '## About this page',
    'The page shows one sentence on a coloured background. Keep replies short and playful.',
    'Never use the word "nodes"; say "sentence" and "background".',
    'When the user asks for ideas, options or suggestions for the page, call propose_palette instead of listing them in prose; the card shows them. End an answer with suggest_replies when there are natural next steps.',
  ].join('\n'),
  instructionsSummary: 'This page shows a sentence on a coloured background; tools can read and change both. Keep replies short. Never use the word "nodes".',
  context: () => JSON.stringify({ lookingAt: 'demo page', ...snapshot(), tab: document.visibilityState }, null, 2),
  autoConnect: true,
  onStatus: showStatus,
  onToolCall: logCall,
});
const mc = page.modelContext;
$('api-badge').textContent = `modelContext: ${page.usingShim ? 'shim (flag off)' : 'native'}`;

void mc.registerTool({
  name: 'get_state',
  description: 'Returns the current background colour, the sentence, and how many tool calls the page has served.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: () => { state.toolCallCount++; return snapshot(); },
});
void mc.registerTool({
  name: 'set_background_color',
  description: 'Sets the page background to a CSS colour (name, hex, rgb(), …). Returns the resulting state.',
  inputSchema: { type: 'object', properties: { color: { type: 'string', description: 'Any CSS colour, e.g. "#0066cc" or "teal"' } }, required: ['color'], additionalProperties: false },
  execute: ({ color }: { color: string }) => {
    if (typeof color !== 'string' || !isCssColor(color)) throw new Error(`"${color}" is not a CSS colour`);
    state.toolCallCount++; state.backgroundColor = color; render(); return snapshot();
  },
});
void mc.registerTool({
  name: 'set_sentence',
  description: 'Replaces the headline sentence. Returns the resulting state.',
  inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['text'], additionalProperties: false },
  execute: ({ text }: { text: string }) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error('text must be a non-empty string');
    state.toolCallCount++; state.sentence = text.trim(); render(); return snapshot();
  },
});
void mc.registerTool({
  name: 'randomize',
  description: 'Picks a new random background colour and sentence. Returns the resulting state.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: () => { state.toolCallCount++; return randomize(); },
});

// Widget tools (plan in-chat-widgets §4.10): their results render as cards in the chat (demo-site/src/widgets.tsx).
let paletteSeq = 0;
void mc.registerTool({
  name: 'propose_palette',
  description: 'Shows the user a card with up to four palette ideas (a background colour plus a sentence each, with a one-line reason) under your one-sentence story. Each option has a "Use" button; the user applies one themselves and nothing on the page changes until they do. Returns the card id and the options as shown. Because the card shows the story and every option in full, your message after this call should be empty or add only what the card does not show.',
  inputSchema: { type: 'object', properties: {
    story: { type: 'string', minLength: 1, maxLength: 200, description: 'One sentence on what these ideas have in common.' },
    options: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object', properties: {
      color: { type: 'string', description: 'Any CSS colour, e.g. "#2a9d8f" or "teal"' },
      sentence: { type: 'string', minLength: 1, maxLength: 200 },
      why: { type: 'string', maxLength: 160, description: 'One line on why this pairing works' },
    }, required: ['color', 'sentence'], additionalProperties: false } },
  }, required: ['story', 'options'], additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: ({ story, options }: { story: string; options: Array<{ color: string; sentence: string; why?: string }> }) => {
    if (!Array.isArray(options) || options.length === 0) throw new Error('options must list at least one idea');
    const bad = options.find((o) => !isCssColor(o?.color));
    if (bad) throw new Error(`"${String(bad?.color)}" is not a CSS colour`);
    state.toolCallCount++;
    return { card: `p${++paletteSeq}`, story: String(story ?? ''), options: options.slice(0, 4).map((o, i) => ({ index: i + 1, color: o.color, sentence: String(o.sentence ?? '').trim(), ...(o.why ? { why: String(o.why) } : {}) })) };
  },
});
void mc.registerTool({
  name: 'suggest_replies',
  description: 'Shows the user up to four short follow-up messages as clickable chips under your answer; clicking one sends it as their next message. Use it at the end of an answer when there are natural next steps. Returns how many were shown. Do not repeat the suggestions in your message.',
  inputSchema: { type: 'object', properties: { replies: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 80 } } }, required: ['replies'], additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: ({ replies }: { replies: string[] }) => {
    if (!Array.isArray(replies) || replies.length === 0) throw new Error('replies must list at least one message');
    state.toolCallCount++;
    return { shown: Math.min(replies.length, 4) };
  },
});

// Bonus tool: exercises dynamic registration/unregistration (toolchange → list_changed).
let bonus: AbortController | undefined;
$('bonus-btn').addEventListener('click', () => {
  if (bonus) return;
  bonus = new AbortController();
  void mc.registerTool({
    name: 'shout',
    description: 'Upper-cases the sentence and appends an exclamation mark. Returns the resulting state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => { state.toolCallCount++; state.sentence = state.sentence.toUpperCase().replace(/[.!?]*$/, '!'); render(); return snapshot(); },
  }, { signal: bonus.signal });
  $('bonus-btn').setAttribute('disabled', ''); $('unbonus-btn').removeAttribute('disabled');
});
$('unbonus-btn').addEventListener('click', () => { bonus?.abort(); bonus = undefined; $('unbonus-btn').setAttribute('disabled', ''); $('bonus-btn').removeAttribute('disabled'); });
$('randomize-btn').addEventListener('click', () => { randomize(); });
$('connect-btn').addEventListener('click', () => page.connect());

// ---------- UI: tool list, status, log ----------
async function renderTools() {
  const tools = await mc.getTools();
  $('tool-count').textContent = `(${tools.length})`;
  $('tools').replaceChildren(...tools.map((t) => {
    const li = document.createElement('li');
    li.append(el('code', t.name), t.annotations?.readOnlyHint ? el('small', ' read-only') : '', ` — ${t.description}`);
    return li;
  }));
}
mc.addEventListener('toolchange', () => { void renderTools(); });
void renderTools();

function showStatus(s: ConnectorStatus) {
  const b = $('daemon-badge'); b.dataset.state = s.state;
  b.textContent = `daemon: ${s.state}${s.pageId ? ` (page ${s.pageId})` : ''}`;
  const hints: Record<string, string> = {
    absent: 'No local daemon on 127.0.0.1:8717. Install the Claude Code plugin and run `claude` once (one-time setup: it starts the daemon, which then lives in the menu bar as "webmcp-bridge"); the chat you want is the panel on the left. Retrying…',
    'needs-approval': 'The daemon is asking you to approve this page: look for a new tab titled "approve origin".',
    denied: 'This page was denied by the daemon. Allow it from the approval page or `webmcp-daemon status`.',
  };
  $('hint').textContent = hints[s.state] ?? '';
  $('connect-btn').style.display = s.state === 'connected' || s.state === 'searching' ? 'none' : '';
}

function logCall(e: ToolCallEvent) {
  if (e.phase === 'start') return;
  const li = document.createElement('li');
  li.className = e.ok ? 'log-ok' : 'log-err';
  const args = Object.keys(e.args ?? {}).length ? ` ${JSON.stringify(e.args)}` : '';
  li.append(el('code', e.name), `${args} → `, el('span', e.ok ? (e.result ?? 'null').slice(0, 120) : String(e.error)), ' ', el('small', `${Math.round(e.durationMs ?? 0)} ms`));
  $('log').prepend(li);
}

// embedded chat (M5) and the floating widget panel for calls made outside it (terminal Claude)
mountChat($('chat-mount'), page);
mountFloatingPanel(page);

// expose for scripted tests
Object.assign(window, { __demo: { state, page, snapshot } });
