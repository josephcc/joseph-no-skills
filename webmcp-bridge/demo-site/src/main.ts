import { connect, preamble, type ConnectorStatus, type ToolCallEvent } from 'webmcp-connector';
import { mountChat } from './chat.tsx';

// ---------- page state ----------
const COLOURS = ['#f4a261', '#2a9d8f', '#e9c46a', '#8ab6d6', '#c3b1e1', '#f7cac9', '#b5ead7', '#ffdac1'];
const SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'A page is just a program that forgot it was one.',
  'Every tool call lands exactly where the user is looking.',
  'Colours are cheap; sentences are the expensive part.',
  'Hello from a web page that speaks WebMCP.',
];
const state = { backgroundColor: '', sentence: '', toolCallCount: 0 };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function render() {
  document.body.style.backgroundColor = state.backgroundColor;
  $('sentence').textContent = state.sentence;
  $('swatch').style.backgroundColor = state.backgroundColor;
  $('color').textContent = state.backgroundColor;
}
function snapshot() { return { ...state, backgroundColor: document.body.style.backgroundColor || state.backgroundColor }; }
function isCssColor(value: string): boolean { return CSS.supports('color', value); }
function pick<T>(list: readonly T[], not?: T): T { let v = list[Math.floor(Math.random() * list.length)]!; while (v === not && list.length > 1) v = list[Math.floor(Math.random() * list.length)]!; return v; }
function randomize() { state.backgroundColor = pick(COLOURS, state.backgroundColor); state.sentence = pick(SENTENCES, state.sentence); render(); return snapshot(); }
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
    li.innerHTML = `<code>${t.name}</code>${t.annotations?.readOnlyHint ? ' <small>read-only</small>' : ''} — ${t.description}`;
    return li;
  }));
}
mc.addEventListener('toolchange', () => { void renderTools(); });
void renderTools();

function showStatus(s: ConnectorStatus) {
  const b = $('daemon-badge'); b.dataset.state = s.state;
  b.textContent = `daemon: ${s.state}${s.pageId ? ` (page ${s.pageId})` : ''}`;
  const hints: Record<string, string> = {
    absent: 'No local daemon found on 127.0.0.1:8717. Start Claude Code once (the webmcp-daemon plugin starts it) or run `npx webmcp-daemon`. Retrying…',
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
  li.innerHTML = `<code>${e.name}</code>${args} → ${e.ok ? `<span>${(e.result ?? 'null').slice(0, 120)}</span>` : `<span>${e.error}</span>`} <small>${Math.round(e.durationMs ?? 0)} ms</small>`;
  $('log').prepend(li);
}

// embedded chat (M5)
mountChat($('chat-mount'), page);

// expose for scripted tests
Object.assign(window, { __demo: { state, page, snapshot } });
